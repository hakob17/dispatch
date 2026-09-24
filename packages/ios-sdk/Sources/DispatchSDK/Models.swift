import Foundation

/// Settings for a `DispatchClient`. Use an **SDK key** (`dk_pub_…`), never a server key.
public struct DispatchConfiguration: Sendable {
    public var apiKey: String
    public var baseURL: URL
    /// Share identity with app extensions (e.g. a Notification Service Extension) through this App Group.
    public var appGroup: String?
    /// Queued events are sent at least this often.
    public var flushInterval: TimeInterval
    /// …and as soon as this many are queued (the server accepts up to 100 per call).
    public var maxBatchSize: Int
    public var appVersion: String?
    /// Stable per-install id; lets the server retire the old token when a reinstall issues a new one.
    public var deviceId: String?
    /// Non-fatal errors (network, 4xx/5xx). Default: printed in DEBUG builds.
    public var onError: (@Sendable (DispatchError) -> Void)?
    /// For tests / proxies.
    public var urlSession: URLSession

    public init(
        apiKey: String,
        baseURL: URL,
        appGroup: String? = nil,
        flushInterval: TimeInterval = 10,
        maxBatchSize: Int = 50,
        appVersion: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
        deviceId: String? = nil,
        onError: (@Sendable (DispatchError) -> Void)? = nil,
        urlSession: URLSession = .shared
    ) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.appGroup = appGroup
        self.flushInterval = flushInterval
        self.maxBatchSize = min(100, max(1, maxBatchSize))
        self.appVersion = appVersion
        self.deviceId = deviceId
        self.onError = onError
        self.urlSession = urlSession
    }
}

/// Profile fields for `identify` / `setProfile`. `attributes` must be JSON-compatible.
public struct DispatchProfile: @unchecked Sendable {
    public var email: String?
    public var firstName: String?
    public var lastName: String?
    public var phone: String?
    /// BCP-47, e.g. `Locale.current.identifier` — selects translated notifications.
    public var language: String?
    public var attributes: [String: Any]

    public init(email: String? = nil, firstName: String? = nil, lastName: String? = nil, phone: String? = nil,
                language: String? = nil, attributes: [String: Any] = [:]) {
        self.email = email
        self.firstName = firstName
        self.lastName = lastName
        self.phone = phone
        self.language = language
        self.attributes = attributes
    }

    var json: [String: Any] {
        var out: [String: Any] = [:]
        if let email { out["email"] = email }
        if let firstName { out["firstName"] = firstName }
        if let lastName { out["lastName"] = lastName }
        if let phone { out["phone"] = phone }
        if let language { out["language"] = language }
        // Sanitise per key: one non-JSON value mustn't drop every attribute
        let clean = JSON.sanitized(attributes)
        if !clean.isEmpty { out["attributes"] = clean }
        return out
    }
}

/// The Dispatch fields of a received notification.
public struct DispatchPush: Sendable, Equatable {
    public let messageId: String
    /// Deep link / URL — custom scheme or https. Your navigation decides what to do with it.
    public let url: URL?
    public let imageURL: URL?
    public let title: String?
    public let body: String?
    /// Every string value in the payload, including the template's custom data.
    public let data: [String: String]
}

public struct InboxMessage: Sendable, Codable, Identifiable, Equatable {
    public enum Layout: String, Sendable, Codable { case modal = "MODAL", banner = "BANNER", fullscreen = "FULLSCREEN", inbox = "INBOX" }
    public struct Button: Sendable, Codable, Equatable {
        public let label: String
        public let url: String
    }
    public let id: String
    public let layout: Layout
    public let title: String
    public let body: String
    public let imageUrl: String?
    public let url: String?
    public let buttons: [Button]
    public let sentAt: String?
    public let expiresAt: String?
    public var read: Bool
    /// Not shown yet and meant to pop up.
    public var display: Bool
}

public struct InboxResult: Sendable, Codable {
    public let unread: Int
    public let messages: [InboxMessage]
}

/// A card in the reader's content-card feed (pinned first, then newest).
public struct ContentCard: Sendable, Codable, Identifiable, Equatable {
    public enum Style: String, Sendable, Codable { case classic = "CLASSIC", captionedImage = "CAPTIONED_IMAGE", banner = "BANNER" }
    public let id: String
    public let style: Style
    public let title: String
    public let body: String
    public let imageUrl: String?
    public let url: String?
    public let buttonLabel: String?
    public let pinned: Bool
    public let dismissible: Bool
    public let category: String?
    public let sentAt: String?
    public let expiresAt: String?
    public var viewed: Bool
    public var clicked: Bool
}

public struct ContentCardFeed: Sendable, Codable {
    public let unviewed: Int
    public let cards: [ContentCard]
}

public struct Recommendation: Sendable, Codable, Identifiable, Equatable {
    public let id: String
    public let title: String
    public let url: String
    public let summary: String?
    public let imageUrl: String?
    public let section: String?
    public let score: Double?
}

public enum RecommendationStrategy: String, Sendable { case forYou = "for_you", trending, latest }

/// A topic (on until the user opts out) or newsletter (off until they subscribe), configured in the Dispatch console.
public struct PreferenceGroup: Sendable, Codable, Identifiable, Equatable {
    public enum Kind: String, Sendable, Codable { case newsletter, topic }

    public let id: String
    /// Stable key set in the console (e.g. "morning-briefing"); `setPreferences` accepts it instead of the id.
    public let slug: String?
    public let name: String
    public let description: String?
    public let kind: Kind
    public var subscribed: Bool

    public var isNewsletter: Bool { kind == .newsletter }

    public init(id: String, slug: String? = nil, name: String, description: String? = nil, kind: Kind = .topic, subscribed: Bool) {
        self.id = id; self.slug = slug; self.name = name; self.description = description; self.kind = kind; self.subscribed = subscribed
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = try c.decodeIfPresent(String.self, forKey: .slug)
        name = try c.decode(String.self, forKey: .name)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        // Older servers don't send a kind: everything was a topic
        kind = (try? c.decodeIfPresent(Kind.self, forKey: .kind)) ?? .topic
        subscribed = try c.decode(Bool.self, forKey: .subscribed)
    }
}

public struct DispatchError: Error, Sendable, CustomStringConvertible {
    /// nil = network error
    public let status: Int?
    public let message: String
    public let retryAfter: TimeInterval?

    /// Network errors, 429 and 5xx are worth retrying; other 4xx are not.
    public var isRetryable: Bool { status == nil || status == 429 || (status ?? 0) >= 500 }
    public var description: String { "Dispatch \(status.map(String.init) ?? "network"): \(message)" }
}
