package com.dispatch.sdk

/**
 * Settings for [DispatchClient]. Use an **SDK key** (`dk_pub_…`), never a server key.
 */
data class DispatchConfig(
    val apiKey: String,
    /** e.g. "https://dispatch.example.com" */
    val baseUrl: String,
    /** Queued events are sent at least this often (ms). */
    val flushIntervalMs: Long = 10_000,
    /** …and as soon as this many are queued (the server accepts up to 100 per call). */
    val maxBatchSize: Int = 50,
    val appVersion: String? = null,
    /** Stable per-install id; lets the server retire the old token after a reinstall. */
    val deviceId: String? = null,
    /** Non-fatal errors (network, 4xx/5xx). Default: logged. */
    val onError: ((DispatchException) -> Unit)? = null,
) {
    init {
        require(apiKey.isNotBlank()) { "Dispatch: apiKey is required" }
        require(baseUrl.startsWith("http")) { "Dispatch: baseUrl must be an http(s) URL" }
    }
    internal val batchSize get() = maxBatchSize.coerceIn(1, 100)
}

/** Profile fields for identify / setProfile. Attribute values must be JSON-compatible. */
data class DispatchProfile(
    val email: String? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val phone: String? = null,
    /** BCP-47 language, e.g. Locale.getDefault().toLanguageTag() — selects translated notifications. */
    val language: String? = null,
    val attributes: Map<String, Any?> = emptyMap(),
)

/** The Dispatch fields of a received notification. */
data class DispatchPush(
    val messageId: String,
    /** Deep link / URL — custom scheme or https. Your navigation decides what to do with it. */
    val url: String?,
    val imageUrl: String?,
    val title: String?,
    val body: String?,
    /** Every value in the data payload, including the template's custom data. */
    val data: Map<String, String>,
)

/** An Android Live Update (FCM data message). */
data class DispatchLiveUpdate(
    val activityKey: String,
    val activityType: String,
    val event: String, // start | update | end
    val contentState: Map<String, Any?>,
    val attributes: Map<String, Any?>?,
    val alertTitle: String?,
    val alertBody: String?,
    val staleDate: String?,
)

data class InboxMessage(
    val id: String,
    /** MODAL | BANNER | FULLSCREEN | INBOX */
    val layout: String,
    val title: String,
    val body: String,
    val imageUrl: String?,
    val url: String?,
    val buttons: List<Button>,
    val sentAt: String?,
    val expiresAt: String?,
    val read: Boolean,
    /** Not shown yet and meant to pop up. */
    val display: Boolean,
) {
    data class Button(val label: String, val url: String)
}

data class InboxResult(val unread: Int, val messages: List<InboxMessage>)

/** A card in the reader's content-card feed (pinned first, then newest). */
data class ContentCard(
    val id: String,
    /** CLASSIC | CAPTIONED_IMAGE | BANNER */
    val style: String,
    val title: String,
    val body: String,
    val imageUrl: String?,
    val url: String?,
    val buttonLabel: String?,
    val pinned: Boolean,
    val dismissible: Boolean,
    val category: String?,
    val sentAt: String?,
    val expiresAt: String?,
    val viewed: Boolean,
    val clicked: Boolean,
)

data class ContentCardFeed(val unviewed: Int, val cards: List<ContentCard>)

data class Recommendation(
    val id: String,
    val title: String,
    val url: String,
    val summary: String?,
    val imageUrl: String?,
    val section: String?,
    val score: Double?,
)

enum class RecommendationStrategy(val wire: String) { FOR_YOU("for_you"), TRENDING("trending"), LATEST("latest") }

/** A topic (on until the user opts out) or newsletter (off until they subscribe), configured in the Dispatch console. */
data class PreferenceGroup(
    val id: String,
    val name: String,
    val description: String?,
    val subscribed: Boolean,
    /** Stable key set in the console (e.g. "morning-briefing"); setPreferences accepts it instead of the id. */
    val slug: String? = null,
    val kind: Kind = Kind.TOPIC,
) {
    enum class Kind { NEWSLETTER, TOPIC }
    val isNewsletter: Boolean get() = kind == Kind.NEWSLETTER
}

class DispatchException(
    /** null = network error */
    val status: Int?,
    message: String,
    val retryAfterSeconds: Long? = null,
) : Exception(message) {
    /** Network errors, 429 and 5xx are worth retrying; other 4xx are not. */
    val isRetryable: Boolean get() = status == null || status == 429 || status >= 500
}
