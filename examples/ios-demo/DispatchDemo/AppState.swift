import ActivityKit
import DispatchSDK
import SwiftUI
import UserNotifications

struct DemoConfig: Decodable, Sendable {
    var baseUrl: String?
    var sdkKey: String?

    /// Written into the bundle at build time from examples/demo-config.json (npm run demo -- setup)
    nonisolated static func load() -> DemoConfig {
        guard let url = Bundle.main.url(forResource: "demo-config", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let cfg = try? JSONDecoder().decode(DemoConfig.self, from: data) else { return DemoConfig() }
        return cfg
    }
}

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    /// Created once, usable from any isolation (DispatchClient is an actor).
    nonisolated static let client: DispatchClient = {
        let config = DemoConfig.load()
        let deviceId = "demo-ios-" + String(UUID().uuidString.prefix(8)).lowercased()
        return DispatchClient(configuration: DispatchConfiguration(
            apiKey: config.sdkKey ?? "dk_pub_missing",
            baseURL: URL(string: config.baseUrl ?? "http://localhost:3000")!,
            flushInterval: 5,
            appVersion: "demo-1.0",
            deviceId: UserDefaults.standard.string(forKey: "demo.deviceId") ?? {
                UserDefaults.standard.set(deviceId, forKey: "demo.deviceId")
                return deviceId
            }(),
            onError: { e in Task { @MainActor in AppState.shared.log("⚠︎ \(e.message)") } }
        ))
    }()

    var dispatch: DispatchClient { Self.client }
    let config = DemoConfig.load()
    @Published var externalId: String?
    @Published var anonymousId = ""
    @Published var pushStatus = "Not enabled"
    @Published var activity: [String] = []
    @Published var openArticleId: String?
    @Published var unread = 0

    nonisolated static let demoToken = Data((0..<32).map { _ in UInt8.random(in: 0...255) })

    private init() {
        Task {
            await dispatch.start()
            anonymousId = await dispatch.currentAnonymousId
            externalId = await dispatch.currentExternalId
            log(config.sdkKey == nil ? "⚠︎ No demo-config.json — run `npm run demo -- setup` and rebuild" : "SDK started (anonymous profile)")
            await subscribeDefaultNewsletters() // users signed in before newsletters existed
        }
    }

    func log(_ line: String) {
        let time = Date().formatted(date: .omitted, time: .standard)
        activity.insert("\(time)  \(line)", at: 0)
        if activity.count > 50 { activity.removeLast() }
    }

    // MARK: identity

    func signIn(_ id: String) async {
        do {
            try await dispatch.identify(externalId: id, profile: DispatchProfile(firstName: "Alex", language: Locale.current.identifier))
            externalId = id
            log("Signed in as \(id) — anonymous history merged")
            await subscribeDefaultNewsletters()
        } catch { log("⚠︎ sign-in failed: \(error)") }
    }

    /// This app's newsletters (the Android and React Native demos pick others), subscribed
    /// once per user by slug. The newsletters themselves are configured in the Dispatch console.
    static let defaultNewsletters = ["morning-briefing", "markets-daily"]

    private func subscribeDefaultNewsletters() async {
        guard let id = externalId else { return }
        let key = "demo.newslettersDefaulted.\(id)"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        do {
            let groups = try await dispatch.setPreferences(Dictionary(uniqueKeysWithValues: Self.defaultNewsletters.map { ($0, true) }))
            UserDefaults.standard.set(true, forKey: key)
            let names = groups.filter { $0.isNewsletter && $0.subscribed }.map(\.name)
            log("Subscribed to \(names.joined(separator: " + "))")
        } catch { log("⚠︎ newsletters: \(error)") }
    }

    func signOut() async {
        await dispatch.reset()
        externalId = nil
        anonymousId = await dispatch.currentAnonymousId
        log("Signed out — new anonymous profile, push token kept")
    }

    // MARK: push

    func enablePush() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        pushStatus = granted ? "Registering…" : "Permission denied"
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }

    func registered(token: Data, simulated: Bool) async {
        do {
            try await dispatch.registerDeviceToken(token)
            pushStatus = simulated ? "Registered (simulator demo token)" : "Registered with APNs"
            log(simulated ? "Push: simulator can't reach APNs — registered a demo token" : "Push token registered")
        } catch { pushStatus = "Registration failed"; log("⚠︎ \(error)") }
    }

    // MARK: deep links

    func open(_ url: URL) {
        // dispatchdemo://article/<id>
        guard url.scheme == "dispatchdemo", url.host == "article" else { return }
        let id = url.lastPathComponent
        guard !id.isEmpty, id != "article" else { return }
        openArticleId = id
    }

    // MARK: live activities

    func startLiveActivityTracking() {
        dispatch.trackLiveActivities(ElectionAttributes.self) { _ in "election-2026" }
    }

    func followElection() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return log("⚠︎ Live Activities are disabled in Settings") }
        let state = ElectionAttributes.ContentState(title: "Election night", subtitle: "Waiting for first results", progress: 0, leader: "—")
        do {
            _ = try Activity.request(attributes: ElectionAttributes(race: "National election"),
                                     content: .init(state: state, staleDate: nil), pushType: .token)
            log("Live Activity started — its push token goes to Dispatch")
        } catch { log("⚠︎ Live Activity: \(error.localizedDescription)") }
    }
}
