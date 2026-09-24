# DispatchSDK (iOS)

A Swift package for iOS 15+. It has no dependencies, is Swift 6 concurrency-safe, and never swizzles delegates. Your app keeps its
`UNUserNotificationCenter` delegate, its permission prompt, and its one Notification Service Extension.

```swift
// Package.swift / Xcode: add packages/ios-sdk, link DispatchSDK (app) and DispatchNotificationService (extension)
import DispatchSDK

let dispatch = DispatchClient(configuration: .init(apiKey: "dk_pub_…", baseURL: URL(string: "https://dispatch.example.com")!))
await dispatch.start()                                   // anonymous profile, addressable right away
try await dispatch.identify(externalId: "user-42",       // at sign-in: anonymous history merges in
    profile: .init(language: Locale.current.identifier))
dispatch.track("article_read", ["itemId": "a1"])          // batched, persisted offline, retried
await dispatch.reset()                                   // at sign-out
```

## Push

```swift
// Your code asks for permission, when it wants to:
try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
UIApplication.shared.registerForRemoteNotifications()

func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    Task { try? await dispatch.registerDeviceToken(token) }        // direct APNs
    // or with Firebase: try await dispatch.registerFCMToken(fcmToken)
}

// UNUserNotificationCenterDelegate, the one you already have. `handle` / `notificationReceived`
// are nonisolated and return a Sendable DispatchPush, so this compiles under Swift 6 strict concurrency:
nonisolated func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                        withCompletionHandler done: @escaping () -> Void) {
    let push = dispatch.handle(response)          // reports the open (cold start included)
    done()
    if let url = push?.url { Task { @MainActor in router.open(url) } }
}
nonisolated func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification,
                                        withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    dispatch.notificationReceived(n.request.content.userInfo)
    done([.banner, .sound])
}
```

Deep links are delivered as `push.url` (a custom scheme or https) and never opened automatically.

## Rich images and delivery receipts (Notification Service Extension)

```swift
import DispatchNotificationService
class NotificationService: DispatchNotificationService {}   // + DispatchAPIKey / DispatchBaseURL in the extension's Info.plist
```

If you already have an extension, call `DispatchNotificationService.enrich(request, apiKey:baseURL:completion:)` from it.
It needs no App Group, and notifications from other senders pass through untouched.

## Live Activities

```swift
dispatch.trackLiveActivities(ElectionAttributes.self) { $0.attributes.raceId }   // push-to-start + update tokens
```

The server's `activityType` must be the Swift type name (`ElectionAttributes`).

## Message centre, in-app messages, recommendations, preferences

```swift
ContentView().dispatchInAppMessages(dispatch) { url in router.open(url) }   // pop-ups (modal / banner / full screen)
let inbox = try await dispatch.inbox()                                          // message centre
let picks = try await dispatch.recommendations(.forYou, limit: 5)
dispatch.articleRead(article.id)
let topics = try await dispatch.preferences()
_ = try await dispatch.setPreferences([topics[0].id: false])
```

Test with `swift test` (macOS) or `xcodebuild test -scheme DispatchSDK-Package -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`.
