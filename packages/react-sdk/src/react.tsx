import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DispatchClient } from "./client.js";
import type { ContentCard, DispatchConfig, DispatchPush, InboxMessage, PreferenceGroup, Recommendation, RecommendationStrategy } from "./types.js";

const DispatchContext = createContext<DispatchClient | null>(null);

/**
 * Provides a DispatchClient to the tree and runs `init()` once.
 * Pass either a ready `client` (recommended — create it at module level so
 * background handlers can use it too) or a `config`.
 */
export function DispatchProvider({
  client,
  config,
  children,
}: {
  client?: DispatchClient;
  config?: DispatchConfig;
  children: ReactNode;
}) {
  const [instance] = useState(() => {
    if (client) return client;
    if (!config) throw new Error("DispatchProvider needs a client or config");
    return new DispatchClient(config);
  });
  useEffect(() => {
    void instance.init();
  }, [instance]);
  return <DispatchContext.Provider value={instance}>{children}</DispatchContext.Provider>;
}

export function useDispatch(): DispatchClient {
  const client = useContext(DispatchContext);
  if (!client) throw new Error("useDispatch must be used inside <DispatchProvider>");
  return client;
}

type Unsubscribe = (() => void) | void;

/**
 * Wire notification taps — warm and cold start — to your navigation, and
 * report opens. Library-agnostic: pass your push library's functions.
 *
 * React Native Firebase:
 *   useNotificationOpened({
 *     getInitialNotification: () => messaging().getInitialNotification(),
 *     subscribe: (handler) => messaging().onNotificationOpenedApp(handler),
 *     onOpen: (push) => push.url && navigateToDeepLink(push.url),
 *   });
 *
 * Notifee: getInitialNotification: () => notifee.getInitialNotification(),
 *          subscribe: (h) => notifee.onForegroundEvent((e) => e.type === EventType.PRESS && h(e.detail))
 */
export function useNotificationOpened(opts: {
  getInitialNotification?: () => Promise<unknown> | unknown;
  subscribe?: (handler: (payload: unknown) => void) => Unsubscribe;
  onOpen: (push: DispatchPush) => void;
}): void {
  const client = useDispatch();
  const onOpen = useRef(opts.onOpen);
  useEffect(() => {
    onOpen.current = opts.onOpen;
  });
  const { getInitialNotification, subscribe } = opts;

  useEffect(() => {
    let cancelled = false;
    const handle = async (payload: unknown) => {
      const push = await client.notificationOpened(payload);
      if (push && !cancelled) onOpen.current(push);
    };
    if (getInitialNotification) {
      void Promise.resolve(getInitialNotification()).then((p) => p && handle(p));
    }
    const unsub = subscribe?.((p) => void handle(p));
    return () => {
      cancelled = true;
      if (typeof unsub === "function") unsub();
    };
    // Library functions are expected to be stable; re-subscribing on every render would double-report
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
}

/**
 * Report delivery of pushes that arrive while the app is in the foreground.
 *   useNotificationReceived({ subscribe: (h) => messaging().onMessage(h) })
 * For background delivery receipts call `client.notificationReceived(msg)`
 * from `messaging().setBackgroundMessageHandler`.
 */
export function useNotificationReceived(opts: {
  subscribe: (handler: (payload: unknown) => void) => Unsubscribe;
  onReceive?: (push: DispatchPush) => void;
}): void {
  const client = useDispatch();
  const onReceive = useRef(opts.onReceive);
  useEffect(() => {
    onReceive.current = opts.onReceive;
  });
  const { subscribe } = opts;
  useEffect(() => {
    const unsub = subscribe(async (payload) => {
      const push = await client.notificationReceived(payload);
      if (push) onReceive.current?.(push);
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
}

/** In-app preference center: topics + toggle. */
export function usePreferences(): {
  groups: PreferenceGroup[] | null;
  loading: boolean;
  error: Error | null;
  setSubscribed: (groupId: string, subscribed: boolean) => Promise<void>;
  reload: () => Promise<void>;
} {
  const client = useDispatch();
  const [groups, setGroups] = useState<PreferenceGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setGroups(await client.getPreferences());
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    queueMicrotask(() => void reload()); // load after the effect, not synchronously inside it
  }, [reload]);

  const setSubscribed = useCallback(
    async (groupId: string, subscribed: boolean) => {
      // Optimistic toggle, rolled back on failure
      const prev = groups;
      setGroups((g) => g?.map((x) => (x.id === groupId ? { ...x, subscribed } : x)) ?? g);
      try {
        setGroups(await client.setPreferences({ [groupId]: subscribed }));
      } catch (e) {
        setGroups(prev);
        setError(e as Error);
      }
    },
    [client, groups]
  );

  return { groups, loading, error, setSubscribed, reload };
}

/**
 * Message centre: messages, unread count, and actions. Refreshes every
 * `pollMs` (default 60 s) and whenever you call `refresh()` — e.g. when the
 * app returns to the foreground.
 */
export function useInbox(opts: { pollMs?: number } = {}): {
  messages: InboxMessage[];
  unread: number;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
} {
  const client = useDispatch();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const pollMs = opts.pollMs ?? 60_000;

  const refresh = useCallback(async () => {
    try {
      const res = await client.getInbox();
      setMessages(res.messages);
      setUnread(res.unread);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    if (!pollMs) return;
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  const markRead = useCallback(
    async (ids: string[]) => {
      setMessages((m) => m.map((x) => (ids.includes(x.id) ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - ids.length));
      await client.markRead(ids);
    },
    [client]
  );
  const remove = useCallback(
    async (ids: string[]) => {
      setMessages((m) => m.filter((x) => !ids.includes(x.id)));
      await client.deleteMessages(ids);
      void refresh();
    },
    [client, refresh]
  );
  return { messages, unread, loading, error, refresh, markRead, remove };
}

/**
 * Content-card feed with actions. Cards are reported as viewed once each when you call
 * `markViewed` (e.g. from a visibility callback); `click` reports the tap, `dismiss` removes it.
 */
export function useContentCards(opts: { category?: string; pollMs?: number } = {}): {
  cards: ContentCard[];
  unviewed: number;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  markViewed: (ids: string[]) => void;
  click: (card: ContentCard) => void;
  dismiss: (card: ContentCard) => Promise<void>;
} {
  const client = useDispatch();
  const [cards, setCards] = useState<ContentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const reported = useRef(new Set<string>());
  const { category } = opts;
  const pollMs = opts.pollMs ?? 60_000;

  const refresh = useCallback(async () => {
    try {
      setCards((await client.getCards({ category })).cards);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [client, category]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    if (!pollMs) return;
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  const markViewed = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter((id) => !reported.current.has(id));
      if (!fresh.length) return;
      fresh.forEach((id) => reported.current.add(id));
      setCards((cs) => cs.map((c) => (fresh.includes(c.id) ? { ...c, viewed: true } : c)));
      void client.logCardsViewed(fresh);
    },
    [client]
  );
  const click = useCallback(
    (card: ContentCard) => {
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, viewed: true, clicked: true } : c)));
      void client.logCardClicked(card.id, card.url);
    },
    [client]
  );
  const dismiss = useCallback(
    async (card: ContentCard) => {
      if (!card.dismissible) return;
      setCards((cs) => cs.filter((c) => c.id !== card.id));
      await client.dismissCards([card.id]);
    },
    [client]
  );
  const unviewed = cards.filter((c) => !c.viewed).length;
  return { cards, unviewed, loading, error, refresh, markViewed, click, dismiss };
}

/**
 * The next pop-up in-app message to show (modal / banner / full screen), or
 * null. Showing it reports a display once; `dismiss()` hides it; `click(url)`
 * reports the tap and hides it — your code handles the navigation.
 */
export function useInAppMessage(opts: { pollMs?: number } = {}): {
  message: InboxMessage | null;
  dismiss: () => void;
  click: (url?: string | null) => void;
} {
  const client = useDispatch();
  const [queue, setQueue] = useState<InboxMessage[]>([]);
  const shown = useRef(new Set<string>());
  const pollMs = opts.pollMs ?? 60_000;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await client.getInbox({ limit: 20 });
        if (cancelled) return;
        // Append new pop-ups (oldest first); keep the one on screen — it's already in `shown`
        setQueue((q) => {
          const queued = new Set(q.map((m) => m.id));
          const fresh = res.messages.filter((m) => m.display && !shown.current.has(m.id) && !queued.has(m.id)).reverse();
          return fresh.length ? [...q, ...fresh] : q;
        });
      } catch {
        // offline: try again next tick
      }
    };
    void load();
    const t = pollMs ? setInterval(load, pollMs) : undefined;
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [client, pollMs]);

  const message = queue[0] ?? null;
  useEffect(() => {
    if (message && !shown.current.has(message.id)) {
      shown.current.add(message.id);
      void client.reportDisplayed(message.id);
    }
  }, [client, message]);

  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  const click = useCallback(
    (url?: string | null) => {
      if (message) void client.reportClicked(message.id, url ?? message.url ?? undefined);
      next();
    },
    [client, message, next]
  );
  return { message, dismiss: next, click };
}

/** Article recommendations for the current user. */
export function useRecommendations(opts: { strategy?: RecommendationStrategy; limit?: number; section?: string } = {}): {
  items: Recommendation[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
} {
  const client = useDispatch();
  const [items, setItems] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { strategy, limit, section } = opts;
  const reload = useCallback(async () => {
    try {
      setItems(await client.getRecommendations({ strategy, limit, section }));
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [client, strategy, limit, section]);
  useEffect(() => {
    queueMicrotask(() => void reload()); // load after the effect, not synchronously inside it
  }, [reload]);
  return { items, loading, error, reload };
}
