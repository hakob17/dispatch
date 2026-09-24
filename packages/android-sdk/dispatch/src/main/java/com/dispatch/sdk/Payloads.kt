package com.dispatch.sdk

import org.json.JSONObject

/** Parsing of Dispatch push data (FCM `data` map or notification-tap intent extras). */
object Payloads {
    /** Dispatch alert push, or null for anything else. */
    fun parsePush(data: Map<String, String?>, title: String? = null, body: String? = null): DispatchPush? {
        if (data["dispatchType"] == "live_update") return null
        val messageId = data["messageId"]?.takeIf { it.isNotBlank() } ?: return null
        val clean = data.filterValues { it != null }.mapValues { it.value!! }
        val url = clean["url"]?.takeIf { it.isNotBlank() && it != "/" }
        return DispatchPush(
            messageId = messageId,
            url = url,
            imageUrl = clean["imageUrl"] ?: clean["image"],
            title = title ?: clean["title"],
            body = body ?: clean["body"],
            data = clean,
        )
    }

    /** Live Update data message, or null. */
    fun parseLiveUpdate(data: Map<String, String?>): DispatchLiveUpdate? {
        if (data["dispatchType"] != "live_update") return null
        val key = data["activityKey"]?.takeIf { it.isNotBlank() } ?: return null
        fun json(s: String?) = s?.let { runCatching { Json.toMap(JSONObject(it)) }.getOrNull() }
        return DispatchLiveUpdate(
            activityKey = key,
            activityType = data["activityType"].orEmpty(),
            event = when (data["event"]) { "start" -> "start"; "end" -> "end"; else -> "update" },
            contentState = json(data["contentState"]) ?: emptyMap(),
            attributes = json(data["attributes"]),
            alertTitle = data["alertTitle"],
            alertBody = data["alertBody"],
            staleDate = data["staleDate"],
        )
    }
}
