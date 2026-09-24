import Foundation

/// JSON over HTTPS to /api/sdk/v1/*.
final class Transport: Sendable {
    private let baseURL: URL
    private let apiKey: String
    private let session: URLSession

    init(configuration: DispatchConfiguration) {
        baseURL = configuration.baseURL
        apiKey = configuration.apiKey
        session = configuration.urlSession
    }

    func send(_ method: String, _ path: String, query: [String: String] = [:], body: Data? = nil, userToken: String? = nil) async throws -> Data {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        if let userToken { request.setValue(userToken, forHTTPHeaderField: "X-Dispatch-User-Token") }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw DispatchError(status: nil, message: error.localizedDescription, retryAfter: nil)
        }
        guard let http = response as? HTTPURLResponse else {
            throw DispatchError(status: nil, message: "no HTTP response", retryAfter: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let message = (json?["error"] as? String) ?? "HTTP \(http.statusCode)"
            let retryAfter = (http.value(forHTTPHeaderField: "Retry-After")).flatMap(TimeInterval.init)
            throw DispatchError(status: http.statusCode, message: "\(method) \(path): \(message)", retryAfter: retryAfter)
        }
        return data
    }
}

enum JSON {
    static func data(_ object: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: object, options: [])) ?? Data("{}".utf8)
    }

    static func object(_ data: Data) -> [String: Any] {
        ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:]
    }

    /// Drops values JSONSerialization can't encode (so a bad attribute never crashes the host app).
    static func sanitized(_ dict: [String: Any]) -> [String: Any] {
        dict.filter { JSONSerialization.isValidJSONObject(["v": $0.value]) }
    }
}

/// Persistent key/value storage. UserDefaults by default (an App Group suite when configured).
public protocol DispatchStore: Sendable {
    func string(_ key: String) -> String?
    func setString(_ value: String?, _ key: String)
    func data(_ key: String) -> Data?
    func setData(_ value: Data?, _ key: String)
}

public final class UserDefaultsStore: DispatchStore, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(suiteName: String? = nil) {
        defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard
    }

    public func string(_ key: String) -> String? { defaults.string(forKey: key) }
    public func setString(_ value: String?, _ key: String) { value == nil ? defaults.removeObject(forKey: key) : defaults.set(value, forKey: key) }
    public func data(_ key: String) -> Data? { defaults.data(forKey: key) }
    public func setData(_ value: Data?, _ key: String) { value == nil ? defaults.removeObject(forKey: key) : defaults.set(value, forKey: key) }
}

/// In-memory store (tests, previews).
public final class MemoryStore: DispatchStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Any] = [:]
    public init() {}
    public func string(_ key: String) -> String? { lock.withLock { values[key] as? String } }
    public func setString(_ value: String?, _ key: String) { lock.withLock { values[key] = value } }
    public func data(_ key: String) -> Data? { lock.withLock { values[key] as? Data } }
    public func setData(_ value: Data?, _ key: String) { lock.withLock { values[key] = value } }
}

extension Data {
    /// APNs device / Live Activity tokens → the hex string the server expects.
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
