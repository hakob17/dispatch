import Foundation
#if canImport(UserNotifications)
import UserNotifications
#endif

/// The Dispatch client. Thread-safe (an actor); fire-and-forget calls like
/// `track` are `nonisolated` so they can be used from anywhere.
///
/// It never asks for notification permission and never swizzles app or
/// notification delegates — your app keeps ownership and forwards what the
/// SDK needs (token, notification response).
///
///     let dispatch = DispatchClient(configuration: .init(apiKey: "dk_pub_…", baseURL: url))
///     await dispatch.start()
///     dispatch.track("article_read", ["itemId": "a1"])
///     await dispatch.identify(externalId: "user-42")
public actor DispatchClient {
    public nonisolated let configuration: DispatchConfiguration
    private let transport: Transport
    private let store: DispatchStore

    private var anonymousId: String
    private var externalId: String?
    private var userToken: String?
    private var queue: [QueuedEvent]
    private var pausedUntil: Date?
    private var push: StoredPush?
    private var flushLoop: Task<Void, Never>?
    private var flushing = false
    private var reportedOpens = Set<String>()
    private var started = false

    private enum Key {
        static let anonymousId = "dispatch.anonymousId"
        static let externalId = "dispatch.externalId"
        static let userToken = "dispatch.userToken"
        static let queue = "dispatch.eventQueue"
        static let push = "dispatch.pushToken"
    }
    private static let maxQueue = 1000

    public init(configuration: DispatchConfiguration, store: DispatchStore? = nil) {
        self.configuration = configuration
        self.transport = Transport(configuration: configuration)
        let store = store ?? UserDefaultsStore(suiteName: configuration.appGroup)
        self.store = store
        if let existing = store.string(Key.anonymousId) {
            anonymousId = existing
        } else {
            anonymousId = UUID().uuidString.lowercased()
            store.setString(anonymousId, Key.anonymousId)
        }
        externalId = store.string(Key.externalId)
        userToken = store.string(Key.userToken)
        queue = store.data(Key.queue).flatMap { try? JSONDecoder().decode([QueuedEvent].self, from: $0) } ?? []
        push = store.data(Key.push).flatMap { try? JSONDecoder().decode(StoredPush.self, from: $0) }
    }

    /// Registers the (anonymous) profile and starts the periodic flush. Safe to call more than once.
    public func start() async {
        guard !started else { return }
        started = true
        let interval = configuration.flushInterval
        if interval > 0 {
            flushLoop = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                    await self?.flush()
                }
            }
        }
        await safe { try await self.post("/api/sdk/v1/identify", self.ref()) }
        if !queue.isEmpty { await flush() }
    }

    public func stop() {
        flushLoop?.cancel()
        flushLoop = nil
        started = false
    }

    // MARK: Identity

    public var currentAnonymousId: String { anonymousId }
    public var currentExternalId: String? { externalId }

    /// Call at sign-in. The anonymous profile's history, devices and preferences
    /// merge into this user. `userToken` is required when the server enforces
    /// signed user tokens (mint it on your backend via POST /api/v1/sdk-tokens).
    public func identify(externalId: String, profile: DispatchProfile = DispatchProfile(), userToken: String? = nil) async throws {
        await flush() // attribute queued anonymous events before switching
        self.externalId = externalId
        store.setString(externalId, Key.externalId)
        setUserToken(userToken)
        try await post("/api/sdk/v1/identify", ref().merging(JSON.sanitized(profile.json)) { $1 })
    }

    public func setUserToken(_ token: String?) {
        userToken = token
        store.setString(token, Key.userToken)
    }

    public func setProfile(_ profile: DispatchProfile) async throws {
        try await post("/api/sdk/v1/identify", ref().merging(JSON.sanitized(profile.json)) { $1 })
    }

    /// Sign-out: a fresh anonymous profile. The device's push token moves to it
    /// (anonymous/breaking-news pushes keep working) unless `keepPushToken` is false.
    public func reset(keepPushToken: Bool = true) async {
        await flush()
        let token = push
        externalId = nil
        store.setString(nil, Key.externalId)
        setUserToken(nil)
        anonymousId = UUID().uuidString.lowercased()
        store.setString(anonymousId, Key.anonymousId)
        await safe { try await self.post("/api/sdk/v1/identify", self.ref()) }
        if let token {
            if keepPushToken { await safe { try await self.sendRegistration(token) } }
            else { await unregisterPushToken() }
        }
    }

    // MARK: Events

    /// Queue a custom event. Batched, persisted while offline, retried. Properties must be JSON-compatible.
    public nonisolated func track(_ name: String, _ properties: [String: Any] = [:]) {
        guard !name.isEmpty else { return }
        let props = JSON.data(JSON.sanitized(properties))
        let timestamp = ISO8601DateFormatter().string(from: Date())
        Task { await self.enqueue(QueuedEvent(name: name, properties: props, timestamp: timestamp)) }
    }

    /// The reader opened an article — teaches "for you" recommendations.
    public nonisolated func articleRead(_ articleId: String, _ properties: [String: Any] = [:]) {
        var props = properties
        props["itemId"] = articleId
        track("article_read", props)
    }

    private func enqueue(_ event: QueuedEvent) async {
        queue.append(event)
        if queue.count > Self.maxQueue { queue.removeFirst(queue.count - Self.maxQueue) }
        persistQueue()
        if queue.count >= configuration.maxBatchSize { await flush() }
    }

    /// Send queued events now (errors are reported to `onError`, not thrown).
    public func flush() async {
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }
        while !queue.isEmpty {
            if let until = pausedUntil, until > Date() { return }
            let batch = Array(queue.prefix(configuration.maxBatchSize))
            let events: [[String: Any]] = batch.map {
                ["name": $0.name, "properties": JSON.object($0.properties), "timestamp": $0.timestamp]
            }
            do {
                try await post("/api/sdk/v1/events", ref().merging(["events": events]) { $1 })
            } catch let e as DispatchError where e.isRetryable {
                pausedUntil = Date().addingTimeInterval(e.retryAfter ?? 30) // keep the batch, back off
                report(e)
                return
            } catch {
                report(error) // malformed batch: drop it so it can't block the queue
            }
            queue.removeFirst(min(batch.count, queue.count))
            persistQueue()
        }
    }

    // MARK: Push

    /// Direct APNs: pass the token from `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    public func registerDeviceToken(_ token: Data) async throws {
        try await register(StoredPush(channel: "APNS", token: token.hexString))
    }

    /// Firebase on iOS: pass `Messaging.messaging().fcmToken` (and every refresh).
    public func registerFCMToken(_ token: String) async throws {
        try await register(StoredPush(channel: "FCM", token: token))
    }

    private func register(_ token: StoredPush) async throws {
        try await sendRegistration(token)
        push = token
        store.setData(try? JSONEncoder().encode(token), Key.push)
    }

    /// Stop pushes to this device (the user turned notifications off in your app).
    public func unregisterPushToken() async {
        guard let token = push else { return }
        await safe { try await self.post("/api/sdk/v1/push/unregister", ["channel": token.channel, "token": token.token]) }
        push = nil
        store.setData(nil, Key.push)
    }

    private func sendRegistration(_ token: StoredPush) async throws {
        var body = ref()
        body["channel"] = token.channel
        body["token"] = token.token
        body["platform"] = "ios"
        if let d = configuration.deviceId { body["deviceId"] = d }
        if let v = configuration.appVersion { body["appVersion"] = v }
        try await post("/api/sdk/v1/push/register", body)
    }

    /// Delivery receipt for a push that reached the app (foreground, or a
    /// content-available background wake). The Notification Service Extension
    /// helper reports receipts for alerts the app never sees.
    @discardableResult
    public nonisolated func notificationReceived(_ userInfo: [AnyHashable: Any]) -> DispatchPush? {
        guard let push = PushPayload.parse(userInfo) else { return nil }
        Task { await self.safe { try await self.post("/api/sdk/v1/push/received", ["messageId": push.messageId]) } }
        return push
    }

    /// The user tapped a notification (including launching the app from it).
    /// Reports the open once per message and returns the payload — navigate to `push.url`.
    @discardableResult
    public nonisolated func notificationOpened(_ userInfo: [AnyHashable: Any], action: String? = nil) -> DispatchPush? {
        guard let push = PushPayload.parse(userInfo) else { return nil }
        Task { await self.reportOpen(push.messageId, action: action) }
        return push
    }

    #if canImport(UserNotifications)
    /// Convenience for `userNotificationCenter(_:didReceive:withCompletionHandler:)`.
    @discardableResult
    public nonisolated func handle(_ response: UNNotificationResponse) -> DispatchPush? {
        let action = response.actionIdentifier == UNNotificationDefaultActionIdentifier ? nil : response.actionIdentifier
        return notificationOpened(response.notification.request.content.userInfo, action: action)
    }
    #endif

    private func reportOpen(_ messageId: String, action: String?) async {
        guard reportedOpens.insert(messageId).inserted else { return }
        var body: [String: Any] = ["messageId": messageId]
        if let action { body["action"] = action }
        await safe { try await self.post("/api/sdk/v1/push/opened", body) }
    }

    // MARK: Live Activities

    /// A Live Activity is running on this device: register its update token.
    public func registerLiveActivityToken(activityKey: String, token: Data) async throws {
        try await post("/api/sdk/v1/live-activities/token", ref().merging(["activityKey": activityKey, "token": token.hexString]) { $1 })
    }

    /// iOS 17.2+: lets the server start this activity type on the device.
    public func registerPushToStartToken(activityType: String, token: Data) async throws {
        try await post("/api/sdk/v1/live-activities/push-to-start", ref().merging(["activityType": activityType, "token": token.hexString]) { $1 })
    }

    // MARK: Message centre

    public func inbox(limit: Int = 50) async throws -> InboxResult {
        let data = try await transport.send("GET", "/api/sdk/v1/inbox", query: refQuery().merging(["limit": String(limit)]) { $1 }, userToken: userToken)
        return try JSONDecoder().decode(InboxResult.self, from: data)
    }

    public func markRead(_ ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        try await post("/api/sdk/v1/inbox/read", ref().merging(["messageIds": ids]) { $1 })
    }

    public func deleteMessages(_ ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        try await post("/api/sdk/v1/inbox/delete", ref().merging(["messageIds": ids]) { $1 })
    }

    /// A pop-up in-app message was shown (counts as opened; it won't pop up again).
    public func reportDisplayed(_ id: String) async {
        await safe { try await self.post("/api/sdk/v1/inbox/displayed", self.ref().merging(["messageIds": [id]]) { $1 }) }
    }

    /// The user tapped the message or one of its buttons.
    public func reportClicked(_ id: String, url: String? = nil) async {
        var extra: [String: Any] = ["messageIds": [id]]
        if let url { extra["url"] = url }
        await safe { try await self.post("/api/sdk/v1/inbox/clicked", self.ref().merging(extra) { $1 }) }
    }

    // MARK: Content cards

    /// The reader's card feed. Pass `category` for a per-topic feed.
    public func contentCards(category: String? = nil, limit: Int = 50) async throws -> ContentCardFeed {
        var q = refQuery().merging(["limit": String(limit)]) { $1 }
        if let category { q["category"] = category }
        let data = try await transport.send("GET", "/api/sdk/v1/cards", query: q, userToken: userToken)
        return try JSONDecoder().decode(ContentCardFeed.self, from: data)
    }

    /// Cards the reader actually saw (e.g. `onAppear` in a list) — counts as an impression.
    public func logCardsViewed(_ ids: [String]) async {
        guard !ids.isEmpty else { return }
        await safe { try await self.post("/api/sdk/v1/cards/viewed", self.ref().merging(["messageIds": ids]) { $1 }) }
    }

    /// The reader tapped a card or its button; your code does the navigation.
    public func logCardClicked(_ id: String, url: String? = nil) async {
        var extra: [String: Any] = ["messageIds": [id]]
        if let url { extra["url"] = url }
        await safe { try await self.post("/api/sdk/v1/cards/clicked", self.ref().merging(extra) { $1 }) }
    }

    /// Swipe cards away — removed on every device (cards marked non-dismissible stay).
    public func dismissCards(_ ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        try await post("/api/sdk/v1/cards/dismissed", ref().merging(["messageIds": ids]) { $1 })
    }

    // MARK: Recommendations & preferences

    public func recommendations(_ strategy: RecommendationStrategy = .forYou, limit: Int = 5, section: String? = nil) async throws -> [Recommendation] {
        var q = refQuery()
        q["strategy"] = strategy.rawValue
        q["limit"] = String(limit)
        if let section { q["section"] = section }
        let data = try await transport.send("GET", "/api/sdk/v1/recommendations", query: q, userToken: userToken)
        struct Response: Decodable { let items: [Recommendation] }
        return try JSONDecoder().decode(Response.self, from: data).items
    }

    public func preferences() async throws -> [PreferenceGroup] {
        let data = try await transport.send("GET", "/api/sdk/v1/preferences", query: refQuery(), userToken: userToken)
        struct Response: Decodable { let groups: [PreferenceGroup] }
        return try JSONDecoder().decode(Response.self, from: data).groups
    }

    public func setPreferences(_ groups: [String: Bool]) async throws -> [PreferenceGroup] {
        let body = JSON.data(ref().merging(["groups": groups]) { $1 })
        let data = try await transport.send("PUT", "/api/sdk/v1/preferences", body: body, userToken: userToken)
        struct Response: Decodable { let groups: [PreferenceGroup] }
        return try JSONDecoder().decode(Response.self, from: data).groups
    }

    // MARK: Internals

    private func ref() -> [String: Any] {
        var r: [String: Any] = ["anonymousId": anonymousId]
        if let externalId { r["externalId"] = externalId }
        return r
    }

    private func refQuery() -> [String: String] {
        var r = ["anonymousId": anonymousId]
        if let externalId { r["externalId"] = externalId }
        return r
    }

    @discardableResult
    private func post(_ path: String, _ body: [String: Any]) async throws -> Data {
        try await transport.send("POST", path, body: JSON.data(body), userToken: userToken)
    }

    /// Background calls must never crash or block the host app.
    private func safe(_ work: () async throws -> Void) async {
        do { try await work() } catch { report(error) }
    }

    private func report(_ error: Error) {
        let e = (error as? DispatchError) ?? DispatchError(status: nil, message: String(describing: error), retryAfter: nil)
        if let handler = configuration.onError { handler(e) }
        else {
            #if DEBUG
            print("[Dispatch] \(e)")
            #endif
        }
    }

    private func persistQueue() {
        store.setData(queue.isEmpty ? nil : try? JSONEncoder().encode(queue), Key.queue)
    }
}

struct QueuedEvent: Codable, Sendable {
    let name: String
    let properties: Data
    let timestamp: String
}

struct StoredPush: Codable, Sendable {
    let channel: String // APNS | FCM
    let token: String
}
