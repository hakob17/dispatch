import DispatchSDK
import SwiftUI
import UserNotifications

@main
struct DemoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var state = AppState.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                // Pop-up in-app messages from Dispatch (modal / banner / full screen)
                .dispatchInAppMessages(state.dispatch, pollInterval: 20) { url in state.open(url) }
                .onOpenURL { state.open($0) }
        }
    }
}

/// Owns the notification delegate — the SDK never swizzles; we forward to it.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { @MainActor in AppState.shared.startLiveActivityTracking() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await AppState.shared.registered(token: deviceToken, simulated: false) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Simulators without APNs access: register a demo token so `npm run demo` can target this device
        Task { @MainActor in await AppState.shared.registered(token: AppState.demoToken, simulated: true) }
    }

    // The SDK's calls here are nonisolated and return the Sendable DispatchPush, so the
    // non-Sendable UNNotification objects never cross into the main actor.

    // Foreground delivery: report it and still show the banner
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let push = AppState.client.notificationReceived(notification.request.content.userInfo)
        completionHandler([.banner, .list, .sound])
        if let push { Task { @MainActor in AppState.shared.log("Received “\(push.title ?? "push")” in the foreground") } }
    }

    // Tap (warm or cold start): report the open and follow the deep link
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let push = AppState.client.handle(response)
        completionHandler()
        guard let push else { return }
        Task { @MainActor in
            AppState.shared.log("Opened push “\(push.title ?? push.messageId)”")
            if let url = push.url { AppState.shared.open(url) }
        }
    }
}
