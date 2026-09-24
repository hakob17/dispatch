/** Anything with an async (or sync) key/value API — AsyncStorage, MMKV wrappers, localStorage. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export type PushChannel = "FCM" | "APNS" | "WEB_PUSH";
export type Platform = "ios" | "android" | "web";

export interface DispatchConfig {
  /** An SDK-scoped key (dk_pub_…). Never ship a server key in an app. */
  apiKey: string;
  /** Your Dispatch deployment, e.g. https://dispatch.example.com */
  baseUrl: string;
  /**
   * Where the anonymous id, current user and unsent events are persisted.
   * React Native: pass AsyncStorage. Browsers default to localStorage.
   * Without one, state lives in memory only (a new anonymous user per launch).
   */
  storage?: KeyValueStorage;
  /** Flush queued events at least this often (ms). Default 10000. */
  flushIntervalMs?: number;
  /** Flush as soon as this many events are queued. Default 50 (server max 100). */
  maxBatchSize?: number;
  platform?: Platform;
  appVersion?: string;
  /** Stable per-install id, used to retire the old token when a reinstall issues a new one. */
  deviceId?: string;
  /** Custom fetch (tests, proxies). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Called with non-fatal errors (network, 4xx/5xx). Default: console.warn in dev. */
  onError?: (error: DispatchError) => void;
}

export interface UserProfile {
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  /** BCP-47 language, e.g. the device locale ("de-DE") — selects translated notifications */
  language?: string | null;
  /** Custom attributes, merged into the profile */
  attributes?: Record<string, unknown>;
}

export interface TrackedEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: string;
}

/**
 * A topic (on until the user opts out) or newsletter (off until they
 * subscribe), configured in the Dispatch console.
 */
export interface PreferenceGroup {
  id: string;
  /** Stable key set in the console, e.g. "morning-briefing"; setPreferences accepts it instead of the id */
  slug: string | null;
  name: string;
  description: string | null;
  kind: "newsletter" | "topic";
  subscribed: boolean;
}

/** What Dispatch puts in every push payload's data. */
export interface DispatchPush {
  messageId: string;
  /** Deep link / URL to open — custom scheme or https */
  url: string | null;
  imageUrl: string | null;
  title: string | null;
  body: string | null;
  /** All data keys, including your template's custom data */
  data: Record<string, string>;
}

/** A message in the user's message centre (and, when `display`, one to pop up). */
export interface InboxMessage {
  id: string;
  layout: "MODAL" | "BANNER" | "FULLSCREEN" | "INBOX";
  title: string;
  body: string;
  imageUrl: string | null;
  url: string | null;
  buttons: { label: string; url: string }[];
  sentAt: string;
  expiresAt: string | null;
  read: boolean;
  /** not shown yet and meant to pop up */
  display: boolean;
}

/** A card in the reader's content-card feed. */
export interface ContentCard {
  id: string;
  style: "CLASSIC" | "CAPTIONED_IMAGE" | "BANNER";
  title: string;
  body: string;
  imageUrl: string | null;
  url: string | null;
  buttonLabel: string | null;
  pinned: boolean;
  dismissible: boolean;
  category: string | null;
  sentAt: string;
  expiresAt: string | null;
  viewed: boolean;
  clicked: boolean;
}

export interface Recommendation {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  imageUrl: string | null;
  section: string | null;
  publishedAt: string;
  score: number;
}

export type RecommendationStrategy = "for_you" | "trending" | "latest";

/** An Android Live Update delivered as an FCM data message; render it as an ongoing notification. */
export interface DispatchLiveUpdate {
  activityKey: string;
  activityType: string;
  event: "start" | "update" | "end";
  contentState: Record<string, unknown>;
  attributes: Record<string, unknown> | null;
  alert: { title: string; body: string } | null;
  staleDate: string | null;
}

export class DispatchError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly body?: unknown,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "DispatchError";
  }

  /** Network errors, 429 and 5xx are worth retrying; other 4xx are not. */
  get retryable(): boolean {
    return this.status === null || this.status === 429 || this.status >= 500;
  }
}
