import ActivityKit
import Foundation

/// Election-night Live Activity. The server's `activityType` must be "ElectionAttributes".
struct ElectionAttributes: ActivityAttributes, Sendable {
    struct ContentState: Codable, Hashable, Sendable {
        var title: String
        var subtitle: String
        var progress: Double
        var leader: String
    }
    var race: String
}
