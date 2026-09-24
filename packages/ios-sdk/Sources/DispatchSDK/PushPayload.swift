import Foundation

public enum PushPayload {
    /// Pull the Dispatch fields out of an APNs `userInfo` (direct APNs or FCM-on-iOS).
    /// Returns nil for notifications that didn't come from Dispatch.
    public static func parse(_ userInfo: [AnyHashable: Any]) -> DispatchPush? {
        // FCM on iOS puts data keys at the top level too; some wrappers nest them under "data"
        var fields: [String: Any] = [:]
        for (k, v) in userInfo { if let k = k as? String { fields[k] = v } }
        if let nested = fields["data"] as? [String: Any], nested["messageId"] != nil {
            fields.merge(nested) { _, new in new }
        }
        guard let messageId = fields["messageId"] as? String, !messageId.isEmpty else { return nil }

        var strings: [String: String] = [:]
        for (k, v) in fields where k != "aps" {
            if let s = v as? String { strings[k] = s }
            else if let n = v as? NSNumber { strings[k] = n.stringValue }
        }

        var title: String?
        var body: String?
        if let aps = fields["aps"] as? [String: Any] {
            if let alert = aps["alert"] as? [String: Any] {
                title = alert["title"] as? String
                body = alert["body"] as? String
            } else if let alert = aps["alert"] as? String {
                body = alert
            }
        }

        let url = (strings["url"]).flatMap { $0 == "/" || $0.isEmpty ? nil : URL(string: $0) }
        let image = (strings["imageUrl"] ?? strings["image"]).flatMap(URL.init(string:))
        return DispatchPush(messageId: messageId, url: url, imageURL: image, title: title, body: body, data: strings)
    }
}
