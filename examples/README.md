# Demo apps

Three news-reader apps, one per SDK, that run against a local Dispatch and show the whole
loop: sign-in → newsletter subscriptions → a campaign launched in the console → push on the
phone → tap → deep link → the open recorded in the campaign report.

| App | SDK | Runs on | Signs in as | Subscribes to |
| --- | --- | --- | --- | --- |
| [`ios-demo`](ios-demo) | Swift (`packages/ios-sdk`) | iOS simulator | `demo-reader-ios` | Morning Briefing, Markets Daily |
| [`android-demo`](android-demo) | Kotlin (`packages/android-sdk`) | Android emulator | `demo-reader-android` | Sport Wrap, Tech Weekly |
| [`react-native-demo`](react-native-demo) | React (`packages/react-sdk`) | iOS simulator (Expo dev build), web | `demo-reader-rn` | Morning Briefing, Tech Weekly |

Each app has the same four screens: **For you** (recommendations), **Inbox** (message centre and
in-app pop-ups), **Alerts** (push permission, newsletters, topics, Live Activity / Live Update) and
**Profile** (identity plus a log of what the SDK did).

## Newsletters and topics

Both are *subscription groups*, configured in the console under **Settings → Newsletters & topics**:

- a **newsletter** reaches only people who subscribed (from an app, the email preference centre or
  `POST /api/v1/subscriptions`);
- a **topic** reaches everyone until they opt out.

`npm run demo -- setup` creates four newsletters (`morning-briefing`, `markets-daily`, `sport-wrap`,
`tech-weekly`) and three topics (`breaking`, `markets`, `sport`). Each app subscribes to its own
pair by slug on first sign-in (`setPreferences({ "sport-wrap": true, … })`), so the same campaign
lands on different phones depending on the newsletter it targets.

## Run it

```bash
# 1. Console + database (see the root README), then demo data → examples/demo-config.json
npm run dev
npm run demo -- setup

# 2. Worker in mock mode with the device relay (see "How pushes reach simulators")
npm run worker:demo
```

**iOS** (Xcode 16+, [XcodeGen](https://github.com/yonaskolb/XcodeGen)):

```bash
cd examples/ios-demo && xcodegen && open DispatchDemo.xcodeproj   # run on an iPhone simulator
```

**Android** (Android SDK, an emulator running):

```bash
cd examples/android-demo && ./gradlew :app:installDebug
```

The app reaches your machine at `http://10.0.2.2:3000`; the SDK is compiled from `packages/android-sdk`.

**React Native** (Expo; push needs a development build, not Expo Go):

```bash
cd examples/react-native-demo && npm install
npx expo run:ios          # or: npx expo start --web   (no push on web in this demo)
```

In each app: **Profile → Sign in**, then **Alerts → Enable notifications**.

## Things to try

| Where | What | Who gets it |
| --- | --- | --- |
| Console → Campaigns → New | Mobile Push (FCM) + **All phones**, segment *Demo readers (example apps)*, topic *Breaking news* | all three phones, personalised per reader |
| Console → Campaigns → New | …same, newsletter *Tech Weekly* | Android + React Native only |
| `npm run demo -- newsletter sport-wrap` | launches the Sport Wrap campaign exactly like the console's Launch button | Android only |
| `npm run demo -- breaking "Headline" --section markets` | publishes an article and auto-sends it | every demo phone |
| `npm run demo -- foryou` | "Picked for you" with each reader's top recommendation | every demo phone |
| `npm run demo -- cards` | a pinned election-night card plus a personalised pick in each app's feed | top of *For you*; ✕ dismisses, the pinned card can't be |
| `npm run demo -- inapp` | welcome pop-up plus a message-centre card | appears on the next inbox poll (≈20 s) |
| `npm run demo -- live start` / `update --progress 0.6` / `end` | election-night Live Activity (iOS) / ongoing progress notification (Android) | devices that tapped *Follow election night* |
| `npm run demo -- status` | who is registered, who subscribes to what, sends and opens | — |

Tap a notification: the app opens the article (`dispatchdemo://article/<id>`), the campaign report
shows the open, and the reader's *For you* feed re-ranks toward that section.

## How pushes reach simulators

Real delivery needs your Firebase project (FCM) and an Apple push key (APNs); add them under
**Settings** and nothing below applies. Without them, `npm run worker:demo` runs the worker with
`PUSH_PROVIDER_MODE=mock DEMO_DEVICE_RELAY=true`. The whole pipeline is real (audience, newsletter
filtering, rendering, personalisation, status writes, tracking); only the last hop changes. The
mock provider hands the exact FCM/APNs payload to the device:

- **iOS simulator**: `xcrun simctl push booted <bundle id>`. The React Native app (device ids
  `demo-rn-…`) is `com.dispatch.demo.rn`, the Swift app `com.dispatch.demo`;
- **Android emulator**: `adb shell am broadcast -a com.dispatch.demo.PUSH`, which the demo's
  `DemoPushReceiver` forwards to `Dispatch.handleRemoteMessage` (a production app declares
  `DispatchMessagingService` instead). Without Firebase the Android app registers a stand-in
  `demo-fcm-…` token.

Only devices registered by these apps (device id `demo-…`) are relayed. The relay refuses to run
with `NODE_ENV=production`; see `src/lib/channels/push/demoRelay.ts`.

Known limits of the simulator path: `simctl push` sends no `apns-collapse-id`, so collapse keys
group instead of replacing. In the background, iOS delivery receipts come from the notification
service extension; when it doesn't run for simulator pushes, the message stays *Sent* until it's
opened.
