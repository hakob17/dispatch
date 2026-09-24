import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  LogBox,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  DispatchProvider,
  useContentCards,
  useDispatch,
  useInAppMessage,
  useInbox,
  useNotificationOpened,
  usePreferences,
  useRecommendations,
  type DispatchClient,
  type PreferenceGroup,
  type RecommendationStrategy,
} from "@dispatch/react-sdk";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { baseUrl, getDispatch, sdkKey } from "./src/dispatch";

/** This app's newsletters (the iOS and Android demos pick others), configured in the Dispatch console. */
const DEFAULT_NEWSLETTERS = ["morning-briefing", "tech-weekly"];
const ACCENT = "#d6452b";
const isNative = Platform.OS !== "web";
// Raised by a dependency's own SafeAreaView, not this app (which uses react-native-safe-area-context)
LogBox.ignoreLogs(["SafeAreaView has been deprecated"]);

// Show Dispatch banners while the app is in the foreground too
if (isNative) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// ------------------------------------------------------------------ app state

type Log = (line: string) => void;
const logLines: string[] = [];
const logListeners = new Set<() => void>();
const log: Log = (line) => {
  const t = new Date().toTimeString().slice(0, 8);
  logLines.unshift(`${t}  ${line}`);
  logLines.splice(50);
  logListeners.forEach((l) => l());
};
function useLog(): string[] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    logListeners.add(l);
    return () => void logListeners.delete(l);
  }, []);
  return logLines;
}

export default function App() {
  const [client, setClient] = useState<DispatchClient | null>(null);
  useEffect(() => {
    void getDispatch().then(async (c) => {
      await c.init();
      log(
        sdkKey
          ? "SDK started (anonymous profile)"
          : "⚠︎ No demo-config.json — run `npm run demo -- setup` and restart",
      );
      setClient(c);
    });
  }, []);
  if (!client) return <ActivityIndicator style={{ flex: 1 }} color={ACCENT} />;
  return (
    <SafeAreaProvider>
      <DispatchProvider client={client}>
        <Shell />
      </DispatchProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const dispatch = useDispatch();
  const [tab, setTab] = useState<"foryou" | "inbox" | "alerts" | "profile">(
    "foryou",
  );
  const [article, setArticle] = useState<string | null>(null);
  const [externalId, setExternalId] = useState(dispatch.getExternalId());
  const inbox = useInbox({ pollMs: 15_000 });

  const open = useCallback((url?: string | null) => {
    if (url?.startsWith("dispatchdemo://article/"))
      setArticle(url.slice("dispatchdemo://article/".length));
  }, []);

  // Push taps — warm and cold start. The SDK reports the open once.
  useNotificationOpened({
    getInitialNotification: isNative
      ? async () =>
          (await Notifications.getLastNotificationResponseAsync())?.notification
      : undefined,
    subscribe: isNative
      ? (handler) => {
          const sub = Notifications.addNotificationResponseReceivedListener(
            (r) => handler(r.notification),
          );
          return () => sub.remove();
        }
      : undefined,
    onOpen: (push) => {
      log(`Opened push “${push.title ?? push.messageId}”`);
      open(push.url);
    },
  });

  // Delivery receipts for pushes that arrive while the app is open
  useEffect(() => {
    if (!isNative) return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      void dispatch
        .notificationReceived(n) // the SDK finds the payload (Expo keeps direct APNs data on the trigger)
        .then((p) => p && log(`Push received: ${p.title}`));
    });
    return () => sub.remove();
  }, [dispatch]);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <Text style={s.title}>
        {
          {
            foryou: "Dispatch News",
            inbox: "Message centre",
            alerts: "Alerts",
            profile: "Profile",
          }[tab]
        }
      </Text>
      <View style={{ flex: 1 }}>
        {tab === "foryou" && (
          <ForYou onOpen={setArticle} onOpenUrl={open} refreshKey={article} />
        )}
        {tab === "inbox" && <Inbox inbox={inbox} onOpen={open} />}
        {tab === "alerts" && <Alerts externalId={externalId} />}
        {tab === "profile" && (
          <Profile externalId={externalId} onChange={setExternalId} />
        )}
      </View>
      <View style={s.tabs}>
        {(
          [
            ["foryou", "For you"],
            ["inbox", inbox.unread ? `Inbox (${inbox.unread})` : "Inbox"],
            ["alerts", "Alerts"],
            ["profile", "Profile"],
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} style={s.tab} onPress={() => setTab(key)}>
            <Text
              style={[
                s.tabText,
                tab === key && { color: ACCENT, fontWeight: "700" },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <InAppMessage onOpen={open} />
      <Modal
        visible={!!article}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setArticle(null)}
      >
        {article && <Article id={article} onClose={() => setArticle(null)} />}
      </Modal>
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------ screens

function ForYou({
  onOpen,
  onOpenUrl,
  refreshKey,
}: {
  onOpen: (id: string) => void;
  onOpenUrl: (url?: string | null) => void;
  refreshKey: string | null;
}) {
  const [strategy, setStrategy] = useState<RecommendationStrategy>("for_you");
  const { items, loading, reload } = useRecommendations({
    strategy,
    limit: 10,
  });
  useEffect(() => {
    if (refreshKey === null) void reload();
  }, [refreshKey, reload]);
  return (
    <ScrollView>
      <View style={s.chips}>
        {(["for_you", "trending", "latest"] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setStrategy(k)}
            style={[s.chip, strategy === k && s.chipOn]}
          >
            <Text style={strategy === k ? { color: "white" } : undefined}>
              {
                { for_you: "For you", trending: "Trending", latest: "Latest" }[
                  k
                ]
              }
            </Text>
          </Pressable>
        ))}
      </View>
      <Cards onOpen={onOpenUrl} refreshKey={refreshKey} />
      {loading && !items.length && <ActivityIndicator color={ACCENT} />}
      {items.map((item) => (
        <Pressable key={item.id} style={s.row} onPress={() => onOpen(item.id)}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={s.thumb} />
          ) : (
            <View style={s.thumb} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.section}>
              {(item.section ?? "news").toUpperCase()}
            </Text>
            <Text style={s.headline}>{item.title}</Text>
            {item.score != null && (
              <Text style={s.muted}>score {item.score.toFixed(3)}</Text>
            )}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Content-card feed (pinned first). Impressions are logged as cards render; ✕ dismisses. */
function Cards({
  onOpen,
  refreshKey,
}: {
  onOpen: (url?: string | null) => void;
  refreshKey: string | null;
}) {
  const { cards, markViewed, click, dismiss, refresh } = useContentCards({
    pollMs: 30_000,
  });
  useEffect(() => {
    if (refreshKey === null) void refresh();
  }, [refreshKey, refresh]);
  useEffect(() => {
    markViewed(cards.map((c) => c.id));
  }, [cards, markViewed]);
  return (
    <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 6 }}>
      {cards.map((card) => (
        <Pressable
          key={card.id}
          accessibilityRole="button"
          accessibilityHint={card.buttonLabel ?? "Opens the story"}
          onPress={() => {
            click(card);
            log(`Tapped card “${card.title}”`);
            onOpen(card.url);
          }}
          style={s.card}
        >
          {card.style !== "CLASSIC" && card.imageUrl ? (
            <Image
              source={{ uri: card.imageUrl }}
              style={{
                width: "100%",
                height: card.style === "BANNER" ? 110 : 150,
              }}
            />
          ) : null}
          {card.style !== "BANNER" && (
            <View style={{ flexDirection: "row", gap: 12, padding: 12 }}>
              {card.style === "CLASSIC" && card.imageUrl ? (
                <Image
                  source={{ uri: card.imageUrl }}
                  style={{ width: 56, height: 56, borderRadius: 6 }}
                />
              ) : null}
              <View style={{ flex: 1, paddingRight: 28 }}>
                <Text style={{ fontWeight: "600" }}>{card.title}</Text>
                {card.body ? (
                  <Text style={s.muted} numberOfLines={3}>
                    {card.body}
                  </Text>
                ) : null}
                {card.buttonLabel ? (
                  <Text
                    style={{ color: ACCENT, fontWeight: "600", marginTop: 4 }}
                  >
                    {card.buttonLabel} →
                  </Text>
                ) : null}
              </View>
            </View>
          )}
          <View
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              flexDirection: "row",
              gap: 4,
            }}
          >
            {card.pinned ? (
              <Text accessibilityLabel="Pinned" style={{ padding: 6 }}>
                📌
              </Text>
            ) : null}
            {card.dismissible ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss card"
                hitSlop={8}
                onPress={() => {
                  void dismiss(card);
                  log(`Dismissed card “${card.title}”`);
                }}
                style={{ padding: 6 }}
              >
                <Text style={{ fontSize: 16, color: "#444" }}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function Article({ id, onClose }: { id: string; onClose: () => void }) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch.articleRead(id);
    log(`Read article ${id}`);
  }, [dispatch, id]);
  return (
    <SafeAreaView style={s.root}>
      <View style={{ padding: 20 }}>
        <Pressable onPress={onClose} style={{ alignSelf: "flex-end" }}>
          <Text style={{ color: ACCENT, fontSize: 17 }}>Done</Text>
        </Pressable>
        <Image
          source={{ uri: `https://picsum.photos/seed/${id}/800/450` }}
          style={s.hero}
        />
        <Text style={[s.title, { paddingHorizontal: 0 }]}>Article {id}</Text>
        <Text style={s.muted}>
          This screen stands in for your article page. Opening it sent an
          article_read event, so this story won&apos;t be recommended again and
          its section now weighs more in your For you feed.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function Inbox({
  inbox,
  onOpen,
}: {
  inbox: ReturnType<typeof useInbox>;
  onOpen: (url?: string | null) => void;
}) {
  const dispatch = useDispatch();
  return (
    <ScrollView>
      {!inbox.messages.length && (
        <Text style={s.hint}>No messages — try npm run demo -- inapp</Text>
      )}
      {inbox.messages.map((m) => (
        <Pressable
          key={m.id}
          style={s.row}
          onPress={async () => {
            await inbox.markRead([m.id]);
            log(`Read inbox message “${m.title}”`);
            if (m.url) {
              await dispatch.reportClicked(m.id, m.url);
              onOpen(m.url);
            }
          }}
        >
          <View
            style={[
              s.dot,
              { backgroundColor: m.read ? "transparent" : ACCENT },
            ]}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: m.read ? "400" : "600" }}>
              {m.title}
            </Text>
            <Text style={s.muted} numberOfLines={2}>
              {m.body}
            </Text>
          </View>
          <Pressable onPress={() => inbox.remove([m.id])}>
            <Text style={{ color: ACCENT }}>Delete</Text>
          </Pressable>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function InAppMessage({ onOpen }: { onOpen: (url?: string | null) => void }) {
  const { message, dismiss, click } = useInAppMessage({ pollMs: 20_000 });
  if (!message || message.layout === "INBOX") return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={s.backdrop}>
        <View style={s.dialog}>
          {message.imageUrl ? (
            <Image source={{ uri: message.imageUrl }} style={s.hero} />
          ) : null}
          <Text style={s.headline}>{message.title}</Text>
          <Text style={[s.muted, { marginVertical: 10 }]}>{message.body}</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {(message.buttons.length
              ? message.buttons
              : [{ label: "Open", url: message.url ?? "" }]
            ).map((b, i) => (
              <Pressable
                key={b.label}
                style={[s.button, i > 0 && s.buttonGhost]}
                onPress={() => {
                  if (b.url) {
                    click(b.url);
                    onOpen(b.url);
                  } else dismiss();
                }}
              >
                <Text
                  style={{ color: i > 0 ? ACCENT : "white", fontWeight: "600" }}
                >
                  {b.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Alerts({ externalId }: { externalId: string | null }) {
  const dispatch = useDispatch();
  const { groups, setSubscribed, reload } = usePreferences();
  const [status, setStatus] = useState(
    isNative ? "Not enabled" : "Web: in-app + inbox only in this demo",
  );
  useEffect(() => void reload(), [externalId, reload]);

  const enable = async () => {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return setStatus("Permission denied");
    try {
      // The raw APNs / FCM token — Dispatch talks to Apple and Google directly, no Expo push service
      const token = await Notifications.getDevicePushTokenAsync();
      await dispatch.registerPushToken(
        String(token.data),
        Platform.OS === "ios" ? "APNS" : "FCM",
      );
      setStatus(`Registered (${Platform.OS === "ios" ? "APNs" : "FCM"})`);
      log(`Push token registered: ${String(token.data).slice(0, 12)}…`);
    } catch (e) {
      setStatus("Registration failed");
      log(`⚠︎ token: ${(e as Error).message}`);
    }
  };

  const toggle = async (g: PreferenceGroup, on: boolean) => {
    await setSubscribed(g.id, on);
    log(`${on ? "Subscribed to" : "Unsubscribed from"} ${g.name}`);
  };
  const list = (items: PreferenceGroup[]) =>
    items.map((g) => (
      <View key={g.id} style={s.pref}>
        <View style={{ flex: 1 }}>
          <Text>{g.name}</Text>
          {g.description ? <Text style={s.muted}>{g.description}</Text> : null}
        </View>
        <Switch
          value={g.subscribed}
          onValueChange={(v) => void toggle(g, v)}
          trackColor={{ true: ACCENT }}
        />
      </View>
    ));

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={s.h2}>Push notifications</Text>
      <Text>Status: {status}</Text>
      {isNative && (
        <Pressable
          style={[s.button, { alignSelf: "flex-start", marginTop: 8 }]}
          onPress={enable}
        >
          <Text style={{ color: "white", fontWeight: "600" }}>
            Enable notifications
          </Text>
        </Pressable>
      )}
      <Text style={s.h2}>Newsletters</Text>
      <Text style={s.hint}>
        Configured in the Dispatch console. This app signs you up to Morning
        Briefing and Tech Weekly.
      </Text>
      {list((groups ?? []).filter((g) => g.kind === "newsletter"))}
      <Text style={s.h2}>Topics</Text>
      <Text style={s.hint}>On for everyone until you turn them off.</Text>
      {list((groups ?? []).filter((g) => g.kind !== "newsletter"))}
    </ScrollView>
  );
}

function Profile({
  externalId,
  onChange,
}: {
  externalId: string | null;
  onChange: (id: string | null) => void;
}) {
  const dispatch = useDispatch();
  const [userId, setUserId] = useState("demo-reader-rn");
  const lines = useLog();

  const signIn = async () => {
    await dispatch.identify(userId, { firstName: "Robin" });
    onChange(userId);
    log(`Signed in as ${userId} — anonymous history merged`);
    const groups = await dispatch.setPreferences(
      Object.fromEntries(DEFAULT_NEWSLETTERS.map((slug) => [slug, true])),
    );
    log(
      `Subscribed to ${groups
        .filter((g) => g.kind === "newsletter" && g.subscribed)
        .map((g) => g.name)
        .join(" + ")}`,
    );
  };
  const signOut = async () => {
    await dispatch.reset();
    onChange(null);
    log("Signed out — new anonymous profile, push token kept");
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={s.h2}>Identity</Text>
      <Text>Anonymous id: {dispatch.getAnonymousId()?.slice(0, 13)}…</Text>
      <Text>Signed in as: {externalId ?? "—"}</Text>
      {externalId ? (
        <Pressable
          style={[
            s.button,
            s.buttonGhost,
            { alignSelf: "flex-start", marginTop: 8 },
          ]}
          onPress={signOut}
        >
          <Text style={{ color: ACCENT }}>Sign out</Text>
        </Pressable>
      ) : (
        <>
          <TextInput
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="none"
            style={s.input}
          />
          <Pressable
            style={[s.button, { alignSelf: "flex-start" }]}
            onPress={signIn}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>Sign in</Text>
          </Pressable>
        </>
      )}
      <Text style={s.h2}>Server</Text>
      <Text>{baseUrl}</Text>
      <Text>SDK key: {sdkKey ? `${sdkKey.slice(0, 14)}…` : "missing"}</Text>
      <Text style={s.h2}>What the SDK did</Text>
      {lines.map((l, i) => (
        <Text key={i} style={s.mono}>
          {l}
        </Text>
      ))}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ styles

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fbf8f3" },
  title: {
    fontSize: 30,
    fontWeight: "800",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  h2: { color: ACCENT, fontWeight: "700", marginTop: 20, marginBottom: 6 },
  hint: {
    color: "#888",
    fontSize: 12,
    marginVertical: 6,
    paddingHorizontal: 0,
  },
  muted: { color: "#888", fontSize: 13 },
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 11,
    marginVertical: 1,
  },
  chips: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  row: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    alignItems: "flex-start",
  },
  thumb: { width: 88, height: 64, borderRadius: 8, backgroundColor: "#eee" },
  section: { color: ACCENT, fontSize: 11, fontWeight: "700" },
  headline: { fontSize: 16, fontWeight: "600" },
  hero: {
    width: "100%",
    height: 180,
    borderRadius: 12,
    backgroundColor: "#eee",
    marginVertical: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  tabs: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    backgroundColor: "white",
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 14 },
  tabText: { color: "#555" },
  pref: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    backgroundColor: "white",
  },
  button: {
    backgroundColor: ACCENT,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: ACCENT,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 24,
  },
  card: { backgroundColor: "#efebe4", borderRadius: 12, overflow: "hidden" },
  dialog: { backgroundColor: "white", borderRadius: 16, padding: 20 },
});
