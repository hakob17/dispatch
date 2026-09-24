# SDK footprint (RFP 2.3)

Measured 2026-09-24 from this repository's SDKs, Release builds.

| SDK | What was measured | Size |
| --- | --- | --- |
| React / React Native (`packages/react-sdk`) | core entry (`@dispatch/react-sdk`), bundled + minified with esbuild, React external | 14.1 KB minified, **4.8 KB gzipped** |
| | web helpers (`@dispatch/react-sdk/web`) | 4.3 KB minified, 2.1 KB gzipped |
| | web push service worker (`dispatch-sw.js`) | 1.8 KB |
| iOS (`packages/ios-sdk`, Swift, arm64 device, `-O`) | `DispatchSDK` + `DispatchNotificationService` object code (text + data segments) | **≈ 254 KB** before the app's linker strips unused code |
| Android (`packages/android-sdk`, Kotlin) | release AAR | 110 KB |
| | SDK classes dexed (d8, min API 23, no R8) | 101 KB dex, **≈ 42 KB** compressed in an APK; R8 in the host app reduces it further |

Dependencies: the React SDK has none (React is an optional peer). The iOS SDK uses only
Apple frameworks. The Android SDK uses `androidx.core` and `kotlinx-coroutines-android`, which
most apps already ship; Firebase Messaging is `compileOnly` (the app's own dependency).

## Startup impact

The SDKs do no work on the launch-critical path beyond object creation:

- **init/start** reads a handful of keys from local storage (UserDefaults / SharedPreferences /
  AsyncStorage) and then sends one asynchronous `identify` request. No network call blocks the
  main thread, and nothing is drawn.
- Events are queued in memory and persisted, then flushed in batches on a timer (default 10 s)
  or at 50 events.
- The SDK never shows the OS permission prompt; the app decides when to ask (RFP 2.8).

To reproduce: `npx esbuild packages/react-sdk/dist/index.js --bundle --minify --external:react`;
`xcodebuild -scheme DispatchSDK -destination 'generic/platform=iOS' -configuration Release` then
`size -m DispatchSDK.o`; `./gradlew :dispatch:assembleRelease` then `d8 --release` on the AAR's
`classes.jar`.
