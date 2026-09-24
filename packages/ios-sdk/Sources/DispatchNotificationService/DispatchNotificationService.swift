import Foundation
#if canImport(UserNotifications)
import UserNotifications

/// Notification Service Extension support: attach the rich image and report
/// the delivery receipt. It needs no App Group and no identity — only the
/// (public) SDK key and base URL — so it can live alongside other vendors'
/// code in the one extension iOS allows.
///
/// Either subclass it as your extension's principal class, with
/// `DispatchAPIKey` / `DispatchBaseURL` in the extension's Info.plist:
///
///     class NotificationService: DispatchNotificationService {}
///
/// or call `DispatchNotificationService.enrich` from your existing extension.
open class DispatchNotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?

    open override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        bestAttempt = request.content.mutableCopy() as? UNMutableNotificationContent
        let info = Bundle.main.infoDictionary ?? [:]
        let apiKey = info["DispatchAPIKey"] as? String
        let baseURL = (info["DispatchBaseURL"] as? String).flatMap(URL.init(string:))
        Self.enrich(request, apiKey: apiKey, baseURL: baseURL) { content in
            contentHandler(content)
        }
    }

    /// iOS is about to kill the extension: deliver whatever we have.
    open override func serviceExtensionTimeWillExpire() {
        if let contentHandler, let bestAttempt { contentHandler(bestAttempt) }
    }

    /// Download `imageUrl` as an attachment and POST the delivery receipt.
    /// Non-Dispatch notifications pass through untouched.
    public static func enrich(
        _ request: UNNotificationRequest,
        apiKey: String?,
        baseURL: URL?,
        session: URLSession = .shared,
        completion: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            return completion(request.content)
        }
        let info = content.userInfo
        guard let messageId = info["messageId"] as? String else { return completion(content) }

        let group = DispatchGroup()

        if let apiKey, let baseURL {
            group.enter()
            var receipt = URLRequest(url: baseURL.appendingPathComponent("/api/sdk/v1/push/received"))
            receipt.httpMethod = "POST"
            receipt.timeoutInterval = 8
            receipt.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            receipt.setValue("application/json", forHTTPHeaderField: "Content-Type")
            receipt.httpBody = try? JSONSerialization.data(withJSONObject: ["messageId": messageId])
            session.dataTask(with: receipt) { _, _, _ in group.leave() }.resume()
        }

        let box = AttachmentBox()
        if let raw = (info["imageUrl"] as? String) ?? (info["image"] as? String), let url = URL(string: raw) {
            group.enter()
            session.downloadTask(with: url) { tmp, response, _ in
                defer { group.leave() }
                guard let tmp else { return }
                let ext = Self.fileExtension(url: url, mime: response?.mimeType)
                let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ext)
                guard (try? FileManager.default.moveItem(at: tmp, to: dest)) != nil else { return }
                box.attachment = try? UNNotificationAttachment(identifier: "dispatch-image", url: dest)
            }.resume()
        }

        group.notify(queue: .main) {
            if let a = box.attachment { content.attachments = [a] }
            completion(content)
        }
    }

    static func fileExtension(url: URL, mime: String?) -> String {
        switch mime {
        case "image/png": return ".png"
        case "image/gif": return ".gif"
        case "image/webp": return ".webp"
        case "image/jpeg", "image/jpg": return ".jpg"
        default:
            let ext = url.pathExtension.lowercased()
            return ["png", "gif", "webp", "jpg", "jpeg"].contains(ext) ? ".\(ext)" : ".jpg"
        }
    }
}

private final class AttachmentBox: @unchecked Sendable {
    var attachment: UNNotificationAttachment?
}
#endif
