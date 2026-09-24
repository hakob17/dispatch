#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

public extension DispatchClient {
    /// Forward every token ActivityKit issues for one `ActivityAttributes` type:
    ///  - push-to-start tokens (iOS 17.2+), so the server can start the activity remotely
    ///  - each running activity's update token, keyed by `activityKey(activity)`
    ///
    /// The server's `activityType` must equal the Swift type name (`String(describing: A.self)`).
    ///
    ///     dispatch.trackLiveActivities(ElectionAttributes.self) { $0.attributes.raceId }
    ///
    /// Call once at launch; the observation runs for the app's lifetime.
    /// Runs on the main actor, where ActivityKit's non-Sendable `Activity` lives.
    @available(iOS 16.2, *)
    @MainActor
    func trackLiveActivities<A: ActivityAttributes & Sendable>(
        _ type: A.Type,
        activityKey: @escaping @Sendable @MainActor (Activity<A>) -> String
    ) {
        let typeName = String(describing: A.self)
        if #available(iOS 17.2, *) {
            Task { @MainActor in
                for await token in Activity<A>.pushToStartTokenUpdates {
                    try? await self.registerPushToStartToken(activityType: typeName, token: token)
                }
            }
        }
        // Activities already running when the app launched, then every new one
        for activity in Activity<A>.activities { observeTokens(activity, key: activityKey(activity)) }
        Task { @MainActor in
            for await activity in Activity<A>.activityUpdates {
                self.observeTokens(activity, key: activityKey(activity))
            }
        }
    }

    @available(iOS 16.2, *)
    @MainActor
    private func observeTokens<A: ActivityAttributes & Sendable>(_ activity: Activity<A>, key: String) {
        Task { @MainActor in
            for await token in activity.pushTokenUpdates {
                try? await self.registerLiveActivityToken(activityKey: key, token: token)
            }
        }
    }
}
#endif
