import XCTest
@testable import DispatchSDK
#if canImport(UserNotifications)
import UserNotifications
@testable import DispatchNotificationService
#endif

/// Records requests and answers from a per-path script (default 200 {"ok":true}).
final class StubProtocol: URLProtocol, @unchecked Sendable {
    struct Recorded { let method: String; let path: String; let query: [String: String]; let body: [String: Any]; let headers: [String: String] }
    struct Reply { let status: Int; let body: Data; let headers: [String: String] }

    nonisolated(unsafe) static var requests: [Recorded] = []
    nonisolated(unsafe) static var replies: [String: [Reply]] = [:]
    static let lock = NSLock()

    static func reset() { lock.withLock { requests = []; replies = [:] } }
    static func reply(_ path: String, _ status: Int, _ json: String = "{}", headers: [String: String] = [:]) {
        lock.withLock { replies[path, default: []].append(Reply(status: status, body: Data(json.utf8), headers: headers)) }
    }
    static func calls(_ path: String) -> [Recorded] { lock.withLock { requests.filter { $0.path == path } } }
    static var paths: [String] { lock.withLock { requests.map(\.path) } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let url = request.url!
        var bodyData = request.httpBody
        if bodyData == nil, let stream = request.httpBodyStream {
            stream.open()
            var d = Data()
            let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            while stream.hasBytesAvailable { let n = stream.read(buf, maxLength: 4096); if n <= 0 { break }; d.append(buf, count: n) }
            buf.deallocate()
            stream.close()
            bodyData = d
        }
        let body = bodyData.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        let reply: Reply = StubProtocol.lock.withLock {
            StubProtocol.requests.append(Recorded(method: request.httpMethod ?? "GET", path: url.path, query: query, body: body, headers: request.allHTTPHeaderFields ?? [:]))
            if var queue = StubProtocol.replies[url.path], !queue.isEmpty {
                let r = queue.removeFirst()
                StubProtocol.replies[url.path] = queue
                return r
            }
            if url.path.hasSuffix(".png") { return Reply(status: 200, body: Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), headers: ["Content-Type": "image/png"]) }
            return Reply(status: 200, body: Data(#"{"ok":true}"#.utf8), headers: [:])
        }
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers.merging(["Content-Type": reply.headers["Content-Type"] ?? "application/json"]) { a, _ in a })!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }
}

/// Thread-safe collector for the client's onError callback.
final class ErrorSink: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [DispatchError] = []
    func add(_ e: DispatchError) { lock.withLock { items.append(e) } }
    var all: [DispatchError] { lock.withLock { items } }
}

final class DispatchSDKTests: XCTestCase {
    var session: URLSession!
    var sink = ErrorSink()
    var errors: [DispatchError] { sink.all }

    override func setUp() {
        StubProtocol.reset()
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubProtocol.self]
        session = URLSession(configuration: cfg)
        sink = ErrorSink()
    }

    func makeClient(store: DispatchStore = MemoryStore(), batch: Int = 3) -> DispatchClient {
        DispatchClient(
            configuration: DispatchConfiguration(
                apiKey: "dk_pub_test", baseURL: URL(string: "https://dispatch.test")!, flushInterval: 0, maxBatchSize: batch,
                appVersion: "5.2.0", deviceId: "iphone-1",
                onError: { [sink] e in sink.add(e) },
                urlSession: session
            ),
            store: store
        )
    }

    /// Let fire-and-forget Tasks (track, notificationOpened) reach the actor.
    func settle() async { for _ in 0..<20 { await Task.yield() }; try? await Task.sleep(nanoseconds: 50_000_000) }

    func testStartRegistersAnonymousProfileAndPersistsId() async {
        let store = MemoryStore()
        let c = makeClient(store: store)
        await c.start()
        let anon = await c.currentAnonymousId
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/identify").first?.body["anonymousId"] as? String, anon)
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/identify").first?.headers["Authorization"], "Bearer dk_pub_test")
        let again = makeClient(store: store)
        let anon2 = await again.currentAnonymousId
        XCTAssertEqual(anon, anon2, "same install keeps its anonymous id")
    }

    func testEventsBatchAndFlush() async {
        let c = makeClient()
        c.track("a")
        c.track("b", ["n": 1])
        await settle()
        XCTAssertTrue(StubProtocol.calls("/api/sdk/v1/events").isEmpty)
        c.track("c")
        await settle()
        await c.flush()
        let sent = StubProtocol.calls("/api/sdk/v1/events")
        XCTAssertEqual(sent.count, 1)
        let names = (sent[0].body["events"] as? [[String: Any]])?.compactMap { $0["name"] as? String }
        XCTAssertEqual(names, ["a", "b", "c"])
    }

    func testRetryAfterKeepsEventsAnd4xxDropsThem() async {
        StubProtocol.reply("/api/sdk/v1/events", 429, #"{"error":"rate_limited"}"#, headers: ["Retry-After": "7"])
        StubProtocol.reply("/api/sdk/v1/events", 400, #"{"error":"bad"}"#)
        let store = MemoryStore()
        let c = makeClient(store: store, batch: 50)
        c.track("keep-me")
        await settle()
        await c.flush()
        XCTAssertEqual(errors.first?.status, 429)
        XCTAssertEqual(errors.first?.retryAfter, 7)
        XCTAssertNotNil(store.data("dispatch.eventQueue"), "429 keeps the queue")

        // A restarted client picks the queued event up (and isn't paused)
        let c2 = makeClient(store: store, batch: 50)
        await c2.flush()
        XCTAssertEqual(errors.last?.status, 400)
        XCTAssertNil(store.data("dispatch.eventQueue"), "4xx drops the batch")
        let names = StubProtocol.calls("/api/sdk/v1/events").compactMap { ($0.body["events"] as? [[String: Any]])?.first?["name"] as? String }
        XCTAssertEqual(names, ["keep-me", "keep-me"])
    }

    func testIdentifyFlushesAnonymousEventsFirstAndSendsUserToken() async throws {
        let c = makeClient(batch: 50)
        let anon = await c.currentAnonymousId
        c.track("before-login")
        await settle()
        try await c.identify(externalId: "user-42", profile: DispatchProfile(firstName: "Ana", language: "de-DE", attributes: ["tier": "pro"]), userToken: "tok")
        let paths = StubProtocol.paths
        XCTAssertLessThan(paths.firstIndex(of: "/api/sdk/v1/events")!, paths.lastIndex(of: "/api/sdk/v1/identify")!)
        let events = StubProtocol.calls("/api/sdk/v1/events")[0]
        XCTAssertEqual(events.body["anonymousId"] as? String, anon)
        XCTAssertNil(events.body["externalId"])
        let identify = StubProtocol.calls("/api/sdk/v1/identify").last!
        XCTAssertEqual(identify.body["externalId"] as? String, "user-42")
        XCTAssertEqual(identify.body["anonymousId"] as? String, anon)
        XCTAssertEqual(identify.body["language"] as? String, "de-DE")
        XCTAssertEqual((identify.body["attributes"] as? [String: Any])?["tier"] as? String, "pro")
        XCTAssertEqual(identify.headers["X-Dispatch-User-Token"], "tok")
    }

    func testDeviceTokenIsHexAndMovesToNewAnonymousProfileOnReset() async throws {
        let c = makeClient()
        try await c.identify(externalId: "user-42")
        try await c.registerDeviceToken(Data([0xde, 0xad, 0xbe, 0xef, 0x01]))
        let reg = StubProtocol.calls("/api/sdk/v1/push/register")[0].body
        XCTAssertEqual(reg["token"] as? String, "deadbeef01")
        XCTAssertEqual(reg["channel"] as? String, "APNS")
        XCTAssertEqual(reg["platform"] as? String, "ios")
        XCTAssertEqual(reg["deviceId"] as? String, "iphone-1")
        XCTAssertEqual(reg["appVersion"] as? String, "5.2.0")

        let old = await c.currentAnonymousId
        await c.reset()
        let new = await c.currentAnonymousId
        XCTAssertNotEqual(old, new)
        let externalAfterReset = await c.currentExternalId
        XCTAssertNil(externalAfterReset)
        let rereg = StubProtocol.calls("/api/sdk/v1/push/register").last!.body
        XCTAssertEqual(rereg["anonymousId"] as? String, new)
        XCTAssertNil(rereg["externalId"])

        await c.reset(keepPushToken: false)
        XCTAssertEqual(StubProtocol.paths.last, "/api/sdk/v1/push/unregister")
    }

    func testPayloadParsingDirectAPNsFCMAndNested() {
        let apns: [AnyHashable: Any] = ["aps": ["alert": ["title": "Breaking", "body": "News"], "mutable-content": 1], "messageId": "m1", "url": "myapp://story/9", "imageUrl": "https://img.test/a.jpg", "section": "world"]
        let p = PushPayload.parse(apns)!
        XCTAssertEqual(p.messageId, "m1")
        XCTAssertEqual(p.url?.absoluteString, "myapp://story/9")
        XCTAssertEqual(p.imageURL?.absoluteString, "https://img.test/a.jpg")
        XCTAssertEqual(p.title, "Breaking")
        XCTAssertEqual(p.data["section"], "world")

        let nested: [AnyHashable: Any] = ["gcm.message_id": "fcm-internal", "data": ["messageId": "m2", "url": "/"]]
        let q = PushPayload.parse(nested)!
        XCTAssertEqual(q.messageId, "m2")
        XCTAssertNil(q.url, "\"/\" means no deep link")

        XCTAssertNil(PushPayload.parse(["aps": ["alert": "someone else's"]]))
    }

    func testOpenReportedOncePerMessage() async {
        let c = makeClient()
        let info: [AnyHashable: Any] = ["messageId": "m9", "url": "myapp://x"]
        let push = c.notificationOpened(info)
        XCTAssertEqual(push?.url?.absoluteString, "myapp://x")
        c.notificationOpened(info) // cold start + delegate can both fire
        await settle()
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/push/opened").count, 1)
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/push/opened")[0].body["messageId"] as? String, "m9")
        XCTAssertNil(c.notificationOpened(["foo": "bar"]))
    }

    func testMessageCentreAndRecommendations() async throws {
        StubProtocol.reply("/api/sdk/v1/inbox", 200, #"{"unread":1,"messages":[{"id":"m1","layout":"MODAL","title":"Hi","body":"B","imageUrl":null,"url":"myapp://a","buttons":[{"label":"Read","url":"myapp://r"}],"sentAt":"2026-09-24T10:00:00Z","expiresAt":null,"read":false,"display":true}]}"#)
        StubProtocol.reply("/api/sdk/v1/recommendations", 200, #"{"strategy":"trending","items":[{"id":"a1","title":"Story","url":"https://x/a1","summary":null,"imageUrl":null,"section":"world","publishedAt":"2026-09-24T10:00:00Z","score":0.9}]}"#)
        let c = makeClient()
        try await c.identify(externalId: "user-1")
        let inbox = try await c.inbox(limit: 10)
        XCTAssertEqual(inbox.unread, 1)
        XCTAssertEqual(inbox.messages[0].layout, .modal)
        XCTAssertEqual(inbox.messages[0].buttons[0].label, "Read")
        let get = StubProtocol.calls("/api/sdk/v1/inbox")[0]
        XCTAssertEqual(get.method, "GET")
        XCTAssertEqual(get.query["externalId"], "user-1")
        XCTAssertEqual(get.query["limit"], "10")

        try await c.markRead(["m1"])
        await c.reportDisplayed("m1")
        await c.reportClicked("m1", url: "myapp://r")
        try await c.deleteMessages(["m1"])
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/inbox/clicked")[0].body["url"] as? String, "myapp://r")
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/inbox/delete")[0].body["messageIds"] as? [String], ["m1"])

        let recs = try await c.recommendations(.trending, limit: 3)
        XCTAssertEqual(recs.first?.id, "a1")
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/recommendations")[0].query["strategy"], "trending")

        c.articleRead("a1", ["section": "world"])
        await settle()
        await c.flush()
        let ev = (StubProtocol.calls("/api/sdk/v1/events").last?.body["events"] as? [[String: Any]])?.first
        XCTAssertEqual(ev?["name"] as? String, "article_read")
        XCTAssertEqual((ev?["properties"] as? [String: Any])?["itemId"] as? String, "a1")
    }

    func testPreferencesDecodeNewslettersAndOlderServers() async throws {
        StubProtocol.reply("/api/sdk/v1/preferences", 200, #"{"groups":[{"id":"g1","name":"Markets","description":null,"subscribed":true},{"id":"g2","slug":"morning-briefing","name":"Morning Briefing","description":"7am","kind":"newsletter","subscribed":false}]}"#)
        let c = makeClient()
        try await c.identify(externalId: "user-1")
        let groups = try await c.setPreferences(["morning-briefing": true])
        XCTAssertEqual(groups[0].kind, .topic, "no kind from an older server means topic")
        XCTAssertTrue(groups[1].isNewsletter)
        XCTAssertEqual(groups[1].slug, "morning-briefing")
        XCTAssertEqual((StubProtocol.calls("/api/sdk/v1/preferences")[0].body["groups"] as? [String: Bool])?["morning-briefing"], true)
    }

    func testContentCards() async throws {
        StubProtocol.reply("/api/sdk/v1/cards", 200, #"{"unviewed":1,"cards":[{"id":"c1","style":"CAPTIONED_IMAGE","title":"Live","body":"B","imageUrl":null,"url":"app://live","buttonLabel":"Follow","pinned":true,"dismissible":false,"category":"live","sentAt":"2026-09-24T10:00:00Z","expiresAt":null,"viewed":false,"clicked":false}]}"#)
        let c = makeClient()
        try await c.identify(externalId: "user-1")
        let feed = try await c.contentCards(category: "live")
        XCTAssertEqual(feed.cards.first?.style, .captionedImage)
        XCTAssertTrue(feed.cards[0].pinned)
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/cards")[0].query["category"], "live")
        await c.logCardsViewed(["c1"])
        await c.logCardClicked("c1", url: "app://live")
        try await c.dismissCards(["c1"])
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/cards/clicked")[0].body["url"] as? String, "app://live")
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/cards/dismissed")[0].body["messageIds"] as? [String], ["c1"])
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/cards/viewed").count, 1)
    }

    func testLiveActivityTokensAreHex() async throws {
        let c = makeClient()
        try await c.registerLiveActivityToken(activityKey: "election-2026", token: Data([0xab, 0xcd]))
        try await c.registerPushToStartToken(activityType: "ElectionAttributes", token: Data([0x01]))
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/live-activities/token")[0].body["token"] as? String, "abcd")
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/live-activities/push-to-start")[0].body["activityType"] as? String, "ElectionAttributes")
    }

    func testNonJSONAttributesAreDroppedNotCrashing() async throws {
        let c = makeClient()
        try await c.setProfile(DispatchProfile(attributes: ["ok": 1, "bad": Date()]))
        let attrs = StubProtocol.calls("/api/sdk/v1/identify").last?.body["attributes"] as? [String: Any]
        XCTAssertEqual(attrs?["ok"] as? Int, 1)
        XCTAssertNil(attrs?["bad"])
    }

    #if canImport(UserNotifications)
    func testNotificationServiceReportsReceiptAndAttachesImage() {
        let content = UNMutableNotificationContent()
        content.title = "Breaking"
        content.userInfo = ["messageId": "m5", "imageUrl": "https://img.test/photo.png"]
        let request = UNNotificationRequest(identifier: "n1", content: content, trigger: nil)
        let done = expectation(description: "enriched")
        DispatchNotificationService.enrich(request, apiKey: "dk_pub_test", baseURL: URL(string: "https://dispatch.test")!, session: session) { result in
            XCTAssertEqual(result.title, "Breaking")
            XCTAssertEqual(result.attachments.count, 1)
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/push/received").first?.body["messageId"] as? String, "m5")

        let plain = UNNotificationRequest(identifier: "n2", content: UNNotificationContent(), trigger: nil)
        let passthrough = expectation(description: "passthrough")
        DispatchNotificationService.enrich(plain, apiKey: "k", baseURL: URL(string: "https://dispatch.test")!, session: session) { _ in passthrough.fulfill() }
        wait(for: [passthrough], timeout: 2)
        XCTAssertEqual(StubProtocol.calls("/api/sdk/v1/push/received").count, 1, "non-Dispatch notifications aren't reported")
        XCTAssertEqual(DispatchNotificationService.fileExtension(url: URL(string: "https://x/a")!, mime: "image/webp"), ".webp")
    }
    #endif
}
