import { defaultStorage, randomId } from "./storage.js";
import { extractPush } from "./notification.js";
import {
  DispatchError,
  type DispatchConfig,
  type DispatchPush,
  type InboxMessage,
  type KeyValueStorage,
  type Recommendation,
  type RecommendationStrategy,
  type PreferenceGroup,
  type ContentCard,
  type PushChannel,
  type TrackedEvent,
  type UserProfile,
} from "./types.js";

const KEYS = {
  anonymousId: "dispatch.anonymousId",
  externalId: "dispatch.externalId",
  queue: "dispatch.eventQueue",
  push: "dispatch.pushToken",
  userToken: "dispatch.userToken",
};
const MAX_QUEUE = 1000; // oldest events are dropped beyond this while offline

interface StoredPush {
  channel: PushChannel;
  token: string;
  subscription?: PushSubscriptionJSON;
}

/**
 * Dispatch client. Framework-free: works in React Native, React web and plain
 * JS. It never asks for notification permission and never touches native push
 * APIs — your app (or its push library) owns those and hands tokens and
 * payloads to the SDK.
 *
 *   const dispatch = new DispatchClient({ apiKey, baseUrl, storage: AsyncStorage });
 *   await dispatch.init();
 *   dispatch.track("article_read", { id });
 *   await dispatch.registerPushToken(fcmToken, "FCM");
 *   await dispatch.identify("user-42");        // at sign-in
 */
export class DispatchClient {
  private readonly cfg: Required<Pick<DispatchConfig, "apiKey" | "baseUrl" | "flushIntervalMs" | "maxBatchSize">> & DispatchConfig;
  private readonly storage: KeyValueStorage;
  private readonly fetchImpl: typeof fetch;
  private anonymousId: string | null = null;
  private externalId: string | null = null;
  private userToken: string | null = null;
  private queue: TrackedEvent[] = [];
  private pushState: StoredPush | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private pausedUntil = 0;
  private readonly reportedOpens = new Set<string>();
  private initPromise: Promise<void> | null = null;

  constructor(config: DispatchConfig) {
    if (!config.apiKey) throw new Error("Dispatch: apiKey is required");
    if (!config.baseUrl) throw new Error("Dispatch: baseUrl is required");
    if (config.apiKey.startsWith("dk_") && !config.apiKey.startsWith("dk_pub_")) {
      console.warn("Dispatch: this looks like a SERVER key. Use an SDK key (dk_pub_…) in apps.");
    }
    this.cfg = { flushIntervalMs: 10_000, maxBatchSize: 50, ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
    this.storage = config.storage ?? defaultStorage();
    const f = config.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) throw new Error("Dispatch: no fetch implementation available");
    this.fetchImpl = f.bind(globalThis);
  }

  /** Load persisted state and register the (anonymous) profile. Safe to call more than once. */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      this.anonymousId = await this.storage.getItem(KEYS.anonymousId);
      if (!this.anonymousId) {
        this.anonymousId = randomId();
        await this.storage.setItem(KEYS.anonymousId, this.anonymousId);
      }
      this.externalId = await this.storage.getItem(KEYS.externalId);
      this.userToken = await this.storage.getItem(KEYS.userToken);
      this.queue = parse<TrackedEvent[]>(await this.storage.getItem(KEYS.queue)) ?? [];
      this.pushState = parse<StoredPush>(await this.storage.getItem(KEYS.push));

      if (this.cfg.flushIntervalMs > 0 && !this.timer) {
        this.timer = setInterval(() => void this.flush(), this.cfg.flushIntervalMs);
        (this.timer as { unref?: () => void }).unref?.();
      }
      await this.safe(() => this.post("/api/sdk/v1/identify", this.ref()));
      if (this.queue.length) void this.flush();
    })();
    return this.initPromise;
  }

  // ---------------------------------------------------------------- identity

  /** Endpoint + (public) SDK key, e.g. for a web push service worker. */
  getEndpoint(): { baseUrl: string; apiKey: string } {
    return { baseUrl: this.cfg.baseUrl, apiKey: this.cfg.apiKey };
  }

  getAnonymousId(): string | null {
    return this.anonymousId;
  }

  getExternalId(): string | null {
    return this.externalId;
  }

  /**
   * Call at sign-in with your user id. The anonymous profile's history,
   * devices and preferences are merged into the known user.
   * `userToken` is required when the server runs with SDK_REQUIRE_USER_TOKEN
   * (mint it on your backend via POST /api/v1/sdk-tokens).
   */
  async identify(externalId: string, profile: UserProfile = {}, opts: { userToken?: string } = {}): Promise<void> {
    await this.init();
    await this.flush(); // attribute queued anonymous events before switching
    this.externalId = externalId;
    await this.storage.setItem(KEYS.externalId, externalId);
    await this.setUserToken(opts.userToken ?? null);
    await this.post("/api/sdk/v1/identify", { ...this.ref(), ...profile });
  }

  /** Replace the signed user token (e.g. after your backend rotates it). */
  async setUserToken(token: string | null): Promise<void> {
    this.userToken = token;
    if (token) await this.storage.setItem(KEYS.userToken, token);
    else await this.storage.removeItem(KEYS.userToken);
  }

  /** Update profile fields / custom attributes for the current user. */
  async setProfile(profile: UserProfile): Promise<void> {
    await this.init();
    await this.post("/api/sdk/v1/identify", { ...this.ref(), ...profile });
  }

  setAttributes(attributes: Record<string, unknown>): Promise<void> {
    return this.setProfile({ attributes });
  }

  /**
   * Sign-out. Starts a fresh anonymous profile; the device's push token moves
   * to it (so the device can still get anonymous/breaking-news pushes) unless
   * `keepPushToken: false`, in which case it is unregistered.
   */
  async reset(opts: { keepPushToken?: boolean } = {}): Promise<void> {
    await this.init();
    await this.flush();
    const push = this.pushState;
    this.externalId = null;
    this.anonymousId = randomId();
    await this.setUserToken(null);
    await this.storage.removeItem(KEYS.externalId);
    await this.storage.setItem(KEYS.anonymousId, this.anonymousId);
    await this.safe(() => this.post("/api/sdk/v1/identify", this.ref()));
    if (push) {
      if (opts.keepPushToken === false) await this.unregisterPushToken();
      else await this.safe(() => this.sendRegistration(push));
    }
  }

  // ------------------------------------------------------------------ events

  /** Queue a custom event. Events are batched, persisted while offline, and retried. */
  track(name: string, properties?: Record<string, unknown>): void {
    if (!name) return;
    this.queue.push({ name, properties, timestamp: new Date().toISOString() });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    void this.persistQueue();
    if (this.queue.length >= this.cfg.maxBatchSize) void this.flush();
  }

  /** Send queued events now. Resolves when done (errors are reported, not thrown). */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        await this.init();
        while (this.queue.length && Date.now() >= this.pausedUntil) {
          const batch = this.queue.slice(0, Math.min(this.cfg.maxBatchSize, 100));
          try {
            await this.post("/api/sdk/v1/events", { ...this.ref(), events: batch });
          } catch (err) {
            const e = toDispatchError(err);
            if (e.retryable) {
              // Keep the batch; back off (server-provided Retry-After on 429)
              this.pausedUntil = Date.now() + (e.retryAfterSeconds ?? 30) * 1000;
              this.report(e);
              return;
            }
            this.report(e); // malformed batch — drop it so it can't block the queue
          }
          this.queue.splice(0, batch.length);
          await this.persistQueue();
        }
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  // -------------------------------------------------------------------- push

  /**
   * Register this device's push token. Call on every launch and whenever your
   * push library reports a refreshed token.
   *   FCM:  await messaging().getToken()             → registerPushToken(t, "FCM")
   *   APNs: hex device token (direct APNs, no Firebase) → registerPushToken(t, "APNS")
   */
  async registerPushToken(token: string, channel: Exclude<PushChannel, "WEB_PUSH"> = "FCM"): Promise<void> {
    await this.init();
    const state: StoredPush = { channel, token };
    await this.sendRegistration(state);
    this.pushState = state;
    await this.storage.setItem(KEYS.push, JSON.stringify(state));
  }

  /** Browser push: pass PushSubscription.toJSON(). See `registerWebPush` in "@dispatch/react-sdk/web". */
  async registerWebPushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
    await this.init();
    if (!subscription.endpoint) throw new Error("Dispatch: subscription has no endpoint");
    const state: StoredPush = { channel: "WEB_PUSH", token: subscription.endpoint, subscription };
    await this.sendRegistration(state);
    this.pushState = state;
    await this.storage.setItem(KEYS.push, JSON.stringify(state));
  }

  /** Stop pushes to this device (user turned notifications off in your app). */
  async unregisterPushToken(): Promise<void> {
    await this.init();
    const push = this.pushState;
    if (!push) return;
    await this.safe(() => this.post("/api/sdk/v1/push/unregister", { channel: push.channel, token: push.token }));
    this.pushState = null;
    await this.storage.removeItem(KEYS.push);
  }

  /**
   * Delivery receipt: call when a Dispatch push arrives (foreground message
   * handler, background handler, or your Notification Service Extension via
   * your own bridge). Returns the parsed push, or null if it isn't ours.
   */
  async notificationReceived(payload: unknown): Promise<DispatchPush | null> {
    const push = extractPush(payload);
    if (!push) return null;
    await this.safe(() => this.post("/api/sdk/v1/push/received", { messageId: push.messageId }));
    return push;
  }

  /**
   * Open tracking: call when the user taps a notification — including the
   * cold-start case (e.g. `messaging().getInitialNotification()`), where
   * React Native's Linking.getInitialURL() does not see the link.
   * Returns the parsed push (use `.url` to navigate); duplicate reports of the
   * same message are ignored.
   */
  async notificationOpened(payload: unknown, action?: string): Promise<DispatchPush | null> {
    const push = extractPush(payload);
    if (!push) return null;
    if (!this.reportedOpens.has(push.messageId)) {
      this.reportedOpens.add(push.messageId);
      await this.safe(() => this.post("/api/sdk/v1/push/opened", { messageId: push.messageId, ...(action ? { action } : {}) }));
    }
    return push;
  }

  // --------------------------------------------------------- live activities

  /**
   * iOS: a Live Activity is running on this device (started locally or by
   * push-to-start). Forward each token from `activity.pushTokenUpdates`
   * (bridged from Swift) so server updates reach it.
   */
  async registerLiveActivityToken(activityKey: string, token: string): Promise<void> {
    await this.init();
    await this.post("/api/sdk/v1/live-activities/token", { ...this.ref(), activityKey, token });
  }

  /**
   * iOS 17.2+: forward `Activity<YourAttributes>.pushToStartTokenUpdates` so the
   * server can start that activity type on this device (e.g. at kick-off).
   */
  async registerPushToStartToken(activityType: string, token: string): Promise<void> {
    await this.init();
    await this.post("/api/sdk/v1/live-activities/push-to-start", { ...this.ref(), activityType, token });
  }

  /**
   * Android: follow a live activity; its updates arrive as FCM data messages
   * (parse with `extractLiveUpdate`). Uses the FCM token registered earlier.
   */
  async followLiveActivity(activityKey: string, follow = true): Promise<void> {
    await this.init();
    const push = this.pushState;
    if (!push || push.channel !== "FCM") throw new Error("Dispatch: register an FCM token before following a live activity");
    await this.post("/api/sdk/v1/live-activities/follow", { ...this.ref(), activityKey, token: push.token, unfollow: !follow });
  }

  // ------------------------------------------------- message centre / in-app

  /** The user's message centre, newest first. Fetching counts as delivery. */
  async getInbox(opts: { limit?: number } = {}): Promise<{ unread: number; messages: InboxMessage[] }> {
    await this.init();
    const qs = new URLSearchParams({ ...(this.ref() as Record<string, string>), ...(opts.limit ? { limit: String(opts.limit) } : {}) });
    return this.request("GET", `/api/sdk/v1/inbox?${qs}`);
  }

  async markRead(messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    await this.init();
    await this.post("/api/sdk/v1/inbox/read", { ...this.ref(), messageIds });
  }

  async deleteMessages(messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    await this.init();
    await this.post("/api/sdk/v1/inbox/delete", { ...this.ref(), messageIds });
  }

  /** Call when you show a pop-up in-app message, so it counts as opened and won't pop up again. */
  async reportDisplayed(messageId: string): Promise<void> {
    await this.init();
    await this.safe(() => this.post("/api/sdk/v1/inbox/displayed", { ...this.ref(), messageIds: [messageId] }));
  }

  /** Call when the user taps the message or a button (pass the button's url). */
  async reportClicked(messageId: string, url?: string): Promise<void> {
    await this.init();
    await this.safe(() => this.post("/api/sdk/v1/inbox/clicked", { ...this.ref(), messageIds: [messageId], ...(url ? { url } : {}) }));
  }

  // ----------------------------------------------------------- content cards

  /** The reader's card feed: pinned first, then newest. Pass `category` for a per-topic feed. */
  async getCards(opts: { category?: string; limit?: number } = {}): Promise<{ unviewed: number; cards: ContentCard[] }> {
    await this.init();
    const qs = new URLSearchParams({
      ...(this.ref() as Record<string, string>),
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
    });
    return this.request("GET", `/api/sdk/v1/cards?${qs}`);
  }

  /** Cards the reader actually saw (e.g. scrolled into view) — counts as an impression. */
  async logCardsViewed(cardIds: string[]): Promise<void> {
    if (!cardIds.length) return;
    await this.init();
    await this.safe(() => this.post("/api/sdk/v1/cards/viewed", { ...this.ref(), messageIds: cardIds }));
  }

  /** The reader tapped a card or its button; your code does the navigation. */
  async logCardClicked(cardId: string, url?: string | null): Promise<void> {
    await this.init();
    await this.safe(() => this.post("/api/sdk/v1/cards/clicked", { ...this.ref(), messageIds: [cardId], ...(url ? { url } : {}) }));
  }

  /** Swipe cards away — removed on every device (cards marked non-dismissible stay). */
  async dismissCards(cardIds: string[]): Promise<void> {
    if (!cardIds.length) return;
    await this.init();
    await this.post("/api/sdk/v1/cards/dismissed", { ...this.ref(), messageIds: cardIds });
  }

  // --------------------------------------------------------- recommendations

  /** Articles for this user: "for_you" (personal), "trending", or "latest" (optionally in a section). */
  async getRecommendations(opts: { strategy?: RecommendationStrategy; limit?: number; section?: string } = {}): Promise<Recommendation[]> {
    await this.init();
    const qs = new URLSearchParams({
      ...(this.ref() as Record<string, string>),
      ...(opts.strategy ? { strategy: opts.strategy } : {}),
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
      ...(opts.section ? { section: opts.section } : {}),
    });
    const res = await this.request<{ items: Recommendation[] }>("GET", `/api/sdk/v1/recommendations?${qs}`);
    return res.items;
  }

  /** Record that the user read an article, so recommendations learn from it. */
  articleRead(articleId: string, properties: Record<string, unknown> = {}): void {
    this.track("article_read", { ...properties, itemId: articleId });
  }

  // ------------------------------------------------------------ preferences

  /** Topics (subscription groups) and whether this user is opted in. */
  async getPreferences(): Promise<PreferenceGroup[]> {
    await this.init();
    const qs = new URLSearchParams(this.ref() as Record<string, string>).toString();
    const res = await this.request<{ groups: PreferenceGroup[] }>("GET", `/api/sdk/v1/preferences?${qs}`);
    return res.groups;
  }

  /** e.g. setPreferences({ [marketsGroupId]: false }) */
  async setPreferences(groups: Record<string, boolean>): Promise<PreferenceGroup[]> {
    await this.init();
    const res = await this.request<{ groups: PreferenceGroup[] }>("PUT", "/api/sdk/v1/preferences", { ...this.ref(), groups });
    return res.groups;
  }

  /** Server-side client config (web push VAPID key). */
  async getConfig(): Promise<{ webPush: { vapidPublicKey: string } | null }> {
    return this.request("GET", "/api/sdk/v1/config");
  }

  /** Stop the flush timer (tests, hot reload). */
  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // --------------------------------------------------------------- internals

  private ref(): { anonymousId?: string; externalId?: string } {
    return {
      ...(this.anonymousId ? { anonymousId: this.anonymousId } : {}),
      ...(this.externalId ? { externalId: this.externalId } : {}),
    };
  }

  private sendRegistration(push: StoredPush): Promise<unknown> {
    return this.post("/api/sdk/v1/push/register", {
      ...this.ref(),
      channel: push.channel,
      ...(push.channel === "WEB_PUSH" ? { subscription: push.subscription } : { token: push.token }),
      platform: this.cfg.platform ?? (push.channel === "APNS" ? "ios" : push.channel === "WEB_PUSH" ? "web" : undefined),
      ...(this.cfg.deviceId ? { deviceId: this.cfg.deviceId } : {}),
      ...(this.cfg.appVersion ? { appVersion: this.cfg.appVersion } : {}),
    });
  }

  private post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.cfg.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(this.userToken ? { "X-Dispatch-User-Token": this.userToken } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new DispatchError(`network error: ${String(err)}`, null);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after")) || undefined;
      const msg = isRecord(json) && typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
      throw new DispatchError(`${method} ${path}: ${msg}`, res.status, json, retryAfter);
    }
    return json as T;
  }

  /** Fire-and-report: SDK background calls must never crash the host app. */
  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.report(toDispatchError(err));
    }
  }

  private report(e: DispatchError): void {
    if (this.cfg.onError) this.cfg.onError(e);
    else console.warn(`[dispatch] ${e.message}`);
  }

  private async persistQueue(): Promise<void> {
    try {
      if (this.queue.length) await this.storage.setItem(KEYS.queue, JSON.stringify(this.queue));
      else await this.storage.removeItem(KEYS.queue);
    } catch {
      // storage full/unavailable — events stay in memory
    }
  }
}

function toDispatchError(err: unknown): DispatchError {
  return err instanceof DispatchError ? err : new DispatchError(String(err), null);
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
