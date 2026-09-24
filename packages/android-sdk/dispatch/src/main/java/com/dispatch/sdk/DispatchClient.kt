package com.dispatch.sdk

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * The Dispatch client (pure Kotlin — the Android glue lives in [Dispatch]).
 *
 * It never asks for notification permission and never registers a
 * FirebaseMessagingService on its own; your app keeps ownership and forwards
 * tokens and messages.
 */
class DispatchClient(
    val config: DispatchConfig,
    private val store: KeyValueStore,
    private val http: HttpTransport = UrlConnectionTransport(),
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val scope = CoroutineScope(SupervisorJob() + io)
    private val lock = Mutex()
    private val flushLock = Mutex()
    private var flushJob: Job? = null

    private var anonymousId: String = store.get(K_ANON) ?: UUID.randomUUID().toString().also { store.set(K_ANON, it) }
    private var externalId: String? = store.get(K_EXTERNAL)
    private var userToken: String? = store.get(K_USER_TOKEN)
    private val queue: MutableList<JSONObject> = loadQueue()
    private var pausedUntil = 0L
    private var push: Pair<String, String>? = store.get(K_PUSH)?.split("|", limit = 2)?.takeIf { it.size == 2 }?.let { it[0] to it[1] }
    private val reportedOpens = Collections.synchronizedSet(HashSet<String>())

    val currentAnonymousId: String get() = anonymousId
    val currentExternalId: String? get() = externalId
    /** "FCM" to token, once registered. */
    val currentPushToken: String? get() = push?.second

    /** Registers the (anonymous) profile and starts the periodic flush. Safe to call more than once. */
    fun start() {
        if (flushJob != null) return
        if (config.flushIntervalMs > 0) {
            flushJob = scope.launch {
                while (isActive) {
                    delay(config.flushIntervalMs)
                    flush()
                }
            }
        }
        scope.launch {
            safe { post("/api/sdk/v1/identify", ref()) }
            if (queueSize() > 0) flush()
        }
    }

    fun stop() {
        flushJob?.cancel()
        flushJob = null
    }

    // ---------------------------------------------------------------- identity

    /**
     * Call at sign-in. The anonymous profile's history, devices and preferences
     * merge into this user. [userToken] is required when the server enforces
     * signed user tokens (your backend mints it via POST /api/v1/sdk-tokens).
     */
    suspend fun identify(externalId: String, profile: DispatchProfile = DispatchProfile(), userToken: String? = null) {
        flush() // attribute queued anonymous events before switching
        lock.withLock {
            this.externalId = externalId
            store.set(K_EXTERNAL, externalId)
            this.userToken = userToken
            store.set(K_USER_TOKEN, userToken)
        }
        post("/api/sdk/v1/identify", ref() + profileMap(profile))
    }

    suspend fun setProfile(profile: DispatchProfile) {
        post("/api/sdk/v1/identify", ref() + profileMap(profile))
    }

    /**
     * Sign-out: a fresh anonymous profile. This device's push token moves to it
     * (anonymous/breaking-news pushes keep working) unless [keepPushToken] is false.
     */
    suspend fun reset(keepPushToken: Boolean = true) {
        flush()
        val token = lock.withLock {
            externalId = null
            userToken = null
            store.set(K_EXTERNAL, null)
            store.set(K_USER_TOKEN, null)
            anonymousId = UUID.randomUUID().toString()
            store.set(K_ANON, anonymousId)
            push
        }
        safe { post("/api/sdk/v1/identify", ref()) }
        if (token != null) {
            if (keepPushToken) safe { sendRegistration(token.first, token.second) } else unregisterPushToken()
        }
    }

    // ------------------------------------------------------------------ events

    /** Queue a custom event. Batched, persisted while offline, retried. */
    fun track(name: String, properties: Map<String, Any?> = emptyMap()) {
        if (name.isBlank()) return
        val event = JSONObject().put("name", name).put("properties", Json.obj(properties)).put("timestamp", iso(Date()))
        scope.launch {
            val size = lock.withLock {
                queue.add(event)
                while (queue.size > MAX_QUEUE) queue.removeAt(0)
                persistQueue()
                queue.size
            }
            if (size >= config.batchSize) flush()
        }
    }

    /** The reader opened an article — teaches "for you" recommendations. */
    fun articleRead(articleId: String, properties: Map<String, Any?> = emptyMap()) =
        track("article_read", properties + ("itemId" to articleId))

    /** Send queued events now (errors go to onError, not thrown). */
    suspend fun flush() {
        if (!flushLock.tryLock()) return
        try {
            while (true) {
                if (System.currentTimeMillis() < pausedUntil) return
                val batch = lock.withLock { queue.take(config.batchSize).toList() }
                if (batch.isEmpty()) return
                try {
                    post("/api/sdk/v1/events", ref() + ("events" to JSONArray(batch)))
                } catch (e: DispatchException) {
                    report(e)
                    if (e.isRetryable) {
                        pausedUntil = System.currentTimeMillis() + (e.retryAfterSeconds ?: 30) * 1000
                        return // keep the batch; back off
                    }
                    // 4xx: malformed batch — drop it so it can't block the queue
                }
                lock.withLock {
                    repeat(batch.size.coerceAtMost(queue.size)) { queue.removeAt(0) }
                    persistQueue()
                }
            }
        } finally {
            flushLock.unlock()
        }
    }

    // -------------------------------------------------------------------- push

    /** Pass FirebaseMessaging's token at startup and from onNewToken. */
    suspend fun registerFcmToken(token: String) {
        sendRegistration("FCM", token)
        lock.withLock {
            push = "FCM" to token
            store.set(K_PUSH, "FCM|$token")
        }
    }

    /** Stop pushes to this device (the user turned notifications off in your app). */
    suspend fun unregisterPushToken() {
        val token = lock.withLock { push } ?: return
        safe { post("/api/sdk/v1/push/unregister", mapOf("channel" to token.first, "token" to token.second)) }
        lock.withLock {
            push = null
            store.set(K_PUSH, null)
        }
    }

    private suspend fun sendRegistration(channel: String, token: String) {
        post(
            "/api/sdk/v1/push/register",
            ref() + mapOf("channel" to channel, "token" to token, "platform" to "android", "deviceId" to config.deviceId, "appVersion" to config.appVersion),
        )
    }

    /** Delivery receipt; returns the parsed push (null if it isn't a Dispatch push). */
    fun notificationReceived(data: Map<String, String?>, title: String? = null, body: String? = null): DispatchPush? {
        val p = Payloads.parsePush(data, title, body) ?: return null
        scope.launch { safe { post("/api/sdk/v1/push/received", mapOf("messageId" to p.messageId)) } }
        return p
    }

    /** The user tapped a notification (warm or cold start). Reported once per message. */
    fun notificationOpened(data: Map<String, String?>, action: String? = null): DispatchPush? {
        val p = Payloads.parsePush(data) ?: return null
        if (reportedOpens.add(p.messageId)) {
            scope.launch { safe { post("/api/sdk/v1/push/opened", mapOf("messageId" to p.messageId, "action" to action)) } }
        }
        return p
    }

    // --------------------------------------------------------- live activities

    /** Android Live Updates: follow (or unfollow) an activity with this device's FCM token. */
    suspend fun followLiveActivity(activityKey: String, follow: Boolean = true) {
        val token = lock.withLock { push }?.takeIf { it.first == "FCM" }?.second
            ?: throw IllegalStateException("Dispatch: register an FCM token before following a live activity")
        post("/api/sdk/v1/live-activities/follow", ref() + mapOf("activityKey" to activityKey, "token" to token, "unfollow" to !follow))
    }

    // ---------------------------------------------------------- message centre

    suspend fun inbox(limit: Int = 50): InboxResult {
        val o = JSONObject(get("/api/sdk/v1/inbox", refQuery() + ("limit" to limit.toString())))
        val arr = o.optJSONArray("messages") ?: JSONArray()
        val messages = (0 until arr.length()).map { i ->
            val m = arr.getJSONObject(i)
            val buttons = m.optJSONArray("buttons") ?: JSONArray()
            InboxMessage(
                id = m.getString("id"),
                layout = m.optString("layout", "MODAL"),
                title = m.optString("title"),
                body = m.optString("body"),
                imageUrl = Json.optString(m, "imageUrl"),
                url = Json.optString(m, "url"),
                buttons = (0 until buttons.length()).map { b -> buttons.getJSONObject(b).let { InboxMessage.Button(it.optString("label"), it.optString("url")) } },
                sentAt = Json.optString(m, "sentAt"),
                expiresAt = Json.optString(m, "expiresAt"),
                read = m.optBoolean("read"),
                display = m.optBoolean("display"),
            )
        }
        return InboxResult(o.optInt("unread"), messages)
    }

    suspend fun markRead(ids: List<String>) { if (ids.isNotEmpty()) post("/api/sdk/v1/inbox/read", ref() + ("messageIds" to ids)) }
    suspend fun deleteMessages(ids: List<String>) { if (ids.isNotEmpty()) post("/api/sdk/v1/inbox/delete", ref() + ("messageIds" to ids)) }

    /** A pop-up in-app message was shown (counts as opened; it won't pop up again). */
    suspend fun reportDisplayed(id: String) = safe { post("/api/sdk/v1/inbox/displayed", ref() + ("messageIds" to listOf(id))) }

    /** The user tapped the message or a button. */
    suspend fun reportClicked(id: String, url: String? = null) =
        safe { post("/api/sdk/v1/inbox/clicked", ref() + mapOf("messageIds" to listOf(id), "url" to url)) }

    // ---------------------------------------------------------- content cards

    /** The reader's card feed. Pass [category] for a per-topic feed. */
    suspend fun contentCards(category: String? = null, limit: Int = 50): ContentCardFeed {
        val o = JSONObject(get("/api/sdk/v1/cards", refQuery() + mapOf("limit" to limit.toString(), "category" to category)))
        val arr = o.optJSONArray("cards") ?: JSONArray()
        val cards = (0 until arr.length()).map { i ->
            val c = arr.getJSONObject(i)
            ContentCard(
                id = c.getString("id"),
                style = c.optString("style", "CLASSIC"),
                title = c.optString("title"),
                body = c.optString("body"),
                imageUrl = Json.optString(c, "imageUrl"),
                url = Json.optString(c, "url"),
                buttonLabel = Json.optString(c, "buttonLabel"),
                pinned = c.optBoolean("pinned"),
                dismissible = c.optBoolean("dismissible", true),
                category = Json.optString(c, "category"),
                sentAt = Json.optString(c, "sentAt"),
                expiresAt = Json.optString(c, "expiresAt"),
                viewed = c.optBoolean("viewed"),
                clicked = c.optBoolean("clicked"),
            )
        }
        return ContentCardFeed(o.optInt("unviewed"), cards)
    }

    /** Cards the reader actually saw — counts as an impression. */
    suspend fun logCardsViewed(ids: List<String>) {
        if (ids.isNotEmpty()) safe { post("/api/sdk/v1/cards/viewed", ref() + ("messageIds" to ids)) }
    }

    /** The reader tapped a card or its button; your code does the navigation. */
    suspend fun logCardClicked(id: String, url: String? = null) =
        safe { post("/api/sdk/v1/cards/clicked", ref() + mapOf("messageIds" to listOf(id), "url" to url)) }

    /** Swipe cards away — removed on every device (cards marked non-dismissible stay). */
    suspend fun dismissCards(ids: List<String>) {
        if (ids.isNotEmpty()) post("/api/sdk/v1/cards/dismissed", ref() + ("messageIds" to ids))
    }

    // ------------------------------------------------ recommendations / prefs

    suspend fun recommendations(strategy: RecommendationStrategy = RecommendationStrategy.FOR_YOU, limit: Int = 5, section: String? = null): List<Recommendation> {
        val o = JSONObject(get("/api/sdk/v1/recommendations", refQuery() + mapOf("strategy" to strategy.wire, "limit" to limit.toString(), "section" to section)))
        val arr = o.optJSONArray("items") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            arr.getJSONObject(i).let {
                Recommendation(it.getString("id"), it.optString("title"), it.optString("url"), Json.optString(it, "summary"),
                    Json.optString(it, "imageUrl"), Json.optString(it, "section"), if (it.has("score")) it.optDouble("score") else null)
            }
        }
    }

    suspend fun preferences(): List<PreferenceGroup> = parseGroups(JSONObject(get("/api/sdk/v1/preferences", refQuery())))

    suspend fun setPreferences(groups: Map<String, Boolean>): List<PreferenceGroup> =
        parseGroups(JSONObject(send("PUT", "/api/sdk/v1/preferences", Json.obj(ref() + ("groups" to groups)).toString())))

    private fun parseGroups(o: JSONObject): List<PreferenceGroup> {
        val arr = o.optJSONArray("groups") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val g = arr.getJSONObject(i)
            PreferenceGroup(
                g.getString("id"), g.optString("name"), Json.optString(g, "description"), g.optBoolean("subscribed"),
                slug = Json.optString(g, "slug"),
                kind = if (g.optString("kind") == "newsletter") PreferenceGroup.Kind.NEWSLETTER else PreferenceGroup.Kind.TOPIC,
            )
        }
    }

    // --------------------------------------------------------------- internals

    private fun ref(): Map<String, Any?> = mapOf("anonymousId" to anonymousId, "externalId" to externalId)
    private fun refQuery(): Map<String, String?> = mapOf("anonymousId" to anonymousId, "externalId" to externalId)

    private fun profileMap(p: DispatchProfile): Map<String, Any?> = buildMap {
        p.email?.let { put("email", it) }
        p.firstName?.let { put("firstName", it) }
        p.lastName?.let { put("lastName", it) }
        p.phone?.let { put("phone", it) }
        p.language?.let { put("language", it) }
        if (p.attributes.isNotEmpty()) put("attributes", p.attributes)
    }

    private suspend fun post(path: String, body: Map<String, Any?>): String = send("POST", path, Json.obj(body).toString())

    private suspend fun get(path: String, params: Map<String, String?>): String = send("GET", "$path?${query(params)}", null)

    private suspend fun send(method: String, pathAndQuery: String, body: String?): String = withContext(io) {
        val headers = buildMap {
            put("Authorization", "Bearer ${config.apiKey}")
            put("Accept", "application/json")
            if (body != null) put("Content-Type", "application/json")
            userToken?.let { put("X-Dispatch-User-Token", it) }
        }
        val res = try {
            http.request(method, config.baseUrl.trimEnd('/') + pathAndQuery, headers, body)
        } catch (e: Exception) {
            throw DispatchException(null, "network error: ${e.message}")
        }
        if (res.status !in 200..299) {
            val msg = runCatching { JSONObject(res.body).optString("error") }.getOrNull()?.ifEmpty { null } ?: "HTTP ${res.status}"
            throw DispatchException(res.status, "$method ${pathAndQuery.substringBefore('?')}: $msg", res.retryAfter?.toLongOrNull())
        }
        res.body
    }

    /** Background calls must never crash the host app. */
    private suspend fun safe(block: suspend () -> Unit) {
        try { block() } catch (e: DispatchException) { report(e) } catch (e: Exception) { report(DispatchException(null, e.message ?: e.toString())) }
    }

    private fun report(e: DispatchException) {
        config.onError?.invoke(e) ?: System.err.println("[Dispatch] ${e.message}")
    }

    private suspend fun queueSize() = lock.withLock { queue.size }

    private fun loadQueue(): MutableList<JSONObject> {
        val raw = store.get(K_QUEUE) ?: return mutableListOf()
        return runCatching { JSONArray(raw).let { a -> (0 until a.length()).map { a.getJSONObject(it) }.toMutableList() } }.getOrElse { mutableListOf() }
    }

    private fun persistQueue() = store.set(K_QUEUE, if (queue.isEmpty()) null else JSONArray(queue).toString())

    private fun iso(d: Date): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(d)

    companion object {
        private const val K_ANON = "dispatch.anonymousId"
        private const val K_EXTERNAL = "dispatch.externalId"
        private const val K_USER_TOKEN = "dispatch.userToken"
        private const val K_QUEUE = "dispatch.eventQueue"
        private const val K_PUSH = "dispatch.pushToken"
        private const val MAX_QUEUE = 1000
    }
}
