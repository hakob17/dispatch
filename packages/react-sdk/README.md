# @dispatch/react-sdk

Client SDK for Dispatch, for **React Native** and **React (web)** apps. Written in TypeScript with no native code and no runtime dependencies. React is an optional peer dependency.

The SDK handles identity (anonymous and signed-in users), batched events, push-token registration, delivery and open tracking (including cold start), and the in-app preference center.

It deliberately does **not** own the device's push stack. Your app, or its push library (`@react-native-firebase/messaging`, Notifee, `@react-native-community/push-notification-ios`), keeps full control of:

- **the permission prompt:** the SDK never triggers it;
- **the `FirebaseMessagingService` on Android:** the SDK doesn't register one, so any number of systems can coexist during a migration;
- **the iOS Notification Service Extension:** rich images use standard `mutable-content`, so no vendor code or App Group is needed;
- **deep-link routing:** the SDK hands you the URL, and your navigation resolves it.

The SDK adds no permissions, entitlements or background modes.

## Install

```sh
npm install @dispatch/react-sdk
# React Native: also a storage backend so the anonymous id survives restarts
npm install @react-native-async-storage/async-storage
```

## Set up (React Native)

```tsx
// dispatch.ts: create once at module level so background handlers can use it
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DispatchClient } from "@dispatch/react-sdk";
import { Platform } from "react-native";
import DeviceInfo from "react-native-device-info"; // optional, for deviceId/appVersion

export const dispatch = new DispatchClient({
  apiKey: "dk_pub_…",                    // an SDK key; never a server key
  baseUrl: "https://dispatch.example.com",
  storage: AsyncStorage,
  platform: Platform.OS === "ios" ? "ios" : "android",
  deviceId: DeviceInfo.getUniqueIdSync(),
  appVersion: DeviceInfo.getVersion(),
});
```

```tsx
// App.tsx
import messaging from "@react-native-firebase/messaging";
import { DispatchProvider, useNotificationOpened, useNotificationReceived } from "@dispatch/react-sdk";
import { dispatch } from "./dispatch";

// Background/quit-state delivery receipts
messaging().setBackgroundMessageHandler((msg) => dispatch.notificationReceived(msg).then(() => {}));

export default function App() {
  return (
    <DispatchProvider client={dispatch}>
      <Root />
    </DispatchProvider>
  );
}

function Root() {
  const navigation = useNavigation();

  // Taps, including cold start: Linking.getInitialURL() misses these on iOS
  useNotificationOpened({
    getInitialNotification: () => messaging().getInitialNotification(),
    subscribe: (handler) => messaging().onNotificationOpenedApp(handler),
    onOpen: (push) => push.url && navigation.navigate(...routeFor(push.url)),
  });

  // Foreground delivery receipts
  useNotificationReceived({ subscribe: (handler) => messaging().onMessage(handler) });

  useEffect(() => {
    (async () => {
      // YOUR code decides when to ask for permission
      const status = await messaging().requestPermission();
      if (status >= messaging.AuthorizationStatus.AUTHORIZED) {
        await dispatch.registerPushToken(await messaging().getToken(), "FCM");
      }
    })();
    return messaging().onTokenRefresh((t) => dispatch.registerPushToken(t, "FCM"));
  }, []);

  return <Navigator />;
}
```

**Direct APNs (no Firebase on iOS):** pass the hex device token with `dispatch.registerPushToken(token, "APNS")`. The server must have an APNs key configured.

## Identity

```ts
await dispatch.init();                          // anonymous profile, addressable by push right away
dispatch.track("article_read", { id: "a1" });   // batched, persisted offline, retried

// At sign-in: the anonymous history, devices and preferences merge into this user
await dispatch.identify("user-42", { email: "ana@example.com", attributes: { tier: "pro" } });

await dispatch.setAttributes({ favouriteSection: "markets" });

// At sign-out: new anonymous profile; this device keeps getting anonymous pushes
await dispatch.reset();                         // or reset({ keepPushToken: false })
```

A profile can hold any number of devices across iOS, Android and web. Every active device receives the message.

**Signed user tokens.** When the server runs with `SDK_REQUIRE_USER_TOKEN=true`, calls that name an `externalId` must prove it. Your backend calls `POST /api/v1/sdk-tokens {externalId}` with a server key and gives the token to the app:

```ts
await dispatch.identify("user-42", {}, { userToken });
```

## Preference center

```tsx
import { usePreferences } from "@dispatch/react-sdk";

function AlertSettings() {
  const { groups, setSubscribed } = usePreferences();
  return groups?.map((g) => (
    <Switch key={g.id} value={g.subscribed} onValueChange={(v) => setSubscribed(g.id, v)} />
  ));
}
```

## Message centre and in-app messages

```tsx
import { useInbox, useInAppMessage } from "@dispatch/react-sdk";

function Inbox() {
  const { messages, unread, markRead, remove } = useInbox();
  // render your own list; call markRead([id]) when opened, remove([id]) on swipe-to-delete
}

function InAppHost() {
  const { message, dismiss, click } = useInAppMessage();
  if (!message) return null;
  // render message.layout (MODAL | BANNER | FULLSCREEN) with your own views;
  // click(button.url) records the tap — then navigate
}
```

On the web there's a ready-made renderer: `import { DispatchInAppMessage } from "@dispatch/react-sdk/web"`,
then `<DispatchInAppMessage onNavigate={(url) => router.push(url)} />`.

## Recommendations

```tsx
import { useRecommendations } from "@dispatch/react-sdk";

const { items } = useRecommendations({ strategy: "for_you", limit: 5 }); // or "trending" / "latest"
dispatch.articleRead(article.id); // when someone reads an article: teaches "for you"
```

## Live Activities (iOS) and Live Updates (Android)

The ActivityKit / notification code is native (Swift/Kotlin) in your app. The SDK only forwards tokens:

```ts
await dispatch.registerPushToStartToken("ElectionAttributes", hexToken);  // iOS 17.2+
await dispatch.registerLiveActivityToken("election-2026", hexToken);      // each running activity
await dispatch.followLiveActivity("election-2026");                       // Android
// Android data message → your renderer:
const update = extractLiveUpdate(remoteMessage); // { activityKey, event, contentState, alert }
```

## Web push (React web)

```tsx
import { registerWebPush } from "@dispatch/react-sdk/web";

// Copy node_modules/@dispatch/react-sdk/sw/dispatch-sw.js to your public/ folder
<button onClick={() => registerWebPush(dispatch)}>Get breaking-news alerts</button>
```

Web push works in Chrome, Edge, Firefox and Safari 16.4+. On iOS and iPadOS it only works for web apps added to the Home Screen. The service worker reports deliveries and opens.

## Push payload

Each push carries these fields in `data` (FCM) or at the top level (APNs userInfo):

| key | meaning |
|---|---|
| `messageId` | Dispatch message id (used for delivery/open reporting) |
| `url` | deep link: custom scheme (`myapp://story/1`) or https |
| `imageUrl` | rich image, when set on the template |
| *custom* | any key/values from the template's custom data |

`extractPush(payload)` normalises RN Firebase, Notifee, raw APNs userInfo and web payloads into one shape.

## Errors

SDK calls never throw from background work. Failures go to `onError` (default `console.warn`). Events are only dropped on non-retryable 4xx responses. Network errors, 429 and 5xx keep the batch queued and back off, using the server's `Retry-After` when there is one.

## Develop

```sh
npm test          # node:test, mocked fetch
npm run build     # → dist/ (ESM + .d.ts)
```
