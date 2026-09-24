package com.dispatch.sdk

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections

/** Records requests; answers from a per-path script (default 200 {"ok":true}). */
class FakeTransport : HttpTransport {
    data class Call(val method: String, val path: String, val query: String?, val headers: Map<String, String>, val body: JSONObject?)

    val calls: MutableList<Call> = Collections.synchronizedList(mutableListOf())
    private val scripted = HashMap<String, ArrayDeque<HttpTransport.Response>>()

    fun reply(path: String, status: Int, body: String = "{}", retryAfter: String? = null) {
        synchronized(scripted) { scripted.getOrPut(path) { ArrayDeque() }.addLast(HttpTransport.Response(status, body, retryAfter)) }
    }

    fun calls(path: String) = calls.filter { it.path == path }

    override fun request(method: String, url: String, headers: Map<String, String>, body: String?): HttpTransport.Response {
        val u = java.net.URI(url)
        calls.add(Call(method, u.path, u.rawQuery, headers, body?.let { JSONObject(it) }))
        return synchronized(scripted) { scripted[u.path]?.removeFirstOrNull() } ?: HttpTransport.Response(200, """{"ok":true}""", null)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class DispatchClientTest {
    private val errors = Collections.synchronizedList(mutableListOf<DispatchException>())

    private fun TestScope.client(http: FakeTransport, store: KeyValueStore = MemoryStore(), batch: Int = 3) =
        DispatchClient(
            DispatchConfig(apiKey = "dk_pub_test", baseUrl = "https://dispatch.test/", flushIntervalMs = 0, maxBatchSize = batch,
                appVersion = "5.2.0", deviceId = "pixel-1", onError = { errors.add(it) }),
            store, http, StandardTestDispatcher(testScheduler),
        )

    @Test fun startRegistersAnonymousProfileAndIdIsStable() = runTest {
        val http = FakeTransport()
        val store = MemoryStore()
        val c = client(http, store)
        c.start(); advanceUntilIdle()
        val call = http.calls("/api/sdk/v1/identify").single()
        assertEquals(c.currentAnonymousId, call.body!!.getString("anonymousId"))
        assertEquals("Bearer dk_pub_test", call.headers["Authorization"])
        assertEquals(c.currentAnonymousId, client(http, store).currentAnonymousId)
        c.stop()
    }

    @Test fun eventsBatchAndFlush() = runTest {
        val http = FakeTransport()
        val c = client(http)
        c.track("a"); c.track("b", mapOf("n" to 1)); advanceUntilIdle()
        assertTrue(http.calls("/api/sdk/v1/events").isEmpty())
        c.track("c"); advanceUntilIdle()
        val sent = http.calls("/api/sdk/v1/events").single().body!!.getJSONArray("events")
        assertEquals(listOf("a", "b", "c"), (0 until sent.length()).map { sent.getJSONObject(it).getString("name") })
        assertEquals(1, sent.getJSONObject(1).getJSONObject("properties").getInt("n"))
    }

    @Test fun retryAfterKeepsQueueAnd4xxDropsIt() = runTest {
        val http = FakeTransport()
        http.reply("/api/sdk/v1/events", 429, """{"error":"rate_limited"}""", retryAfter = "7")
        http.reply("/api/sdk/v1/events", 400, """{"error":"bad"}""")
        val store = MemoryStore()
        val c = client(http, store, batch = 50)
        c.track("keep-me"); advanceUntilIdle()
        c.flush()
        assertEquals(429, errors.first().status)
        assertEquals(7L, errors.first().retryAfterSeconds)
        assertNotNull("429 keeps the queue", store.get("dispatch.eventQueue"))

        val c2 = client(http, store, batch = 50) // restarted app picks the queue up
        c2.flush()
        assertEquals(400, errors.last().status)
        assertNull("4xx drops the batch", store.get("dispatch.eventQueue"))
    }

    @Test fun identifyFlushesAnonymousEventsFirstAndSendsUserToken() = runTest {
        val http = FakeTransport()
        val c = client(http, batch = 50)
        val anon = c.currentAnonymousId
        c.track("before-login"); advanceUntilIdle()
        c.identify("user-42", DispatchProfile(firstName = "Ana", language = "de-DE", attributes = mapOf("tier" to "pro", "bad" to Any())), userToken = "tok")
        val order = http.calls.map { it.path }
        assertTrue(order.indexOf("/api/sdk/v1/events") < order.lastIndexOf("/api/sdk/v1/identify"))
        assertFalse(http.calls("/api/sdk/v1/events").single().body!!.has("externalId"))
        val id = http.calls("/api/sdk/v1/identify").last()
        assertEquals("user-42", id.body!!.getString("externalId"))
        assertEquals(anon, id.body.getString("anonymousId"))
        assertEquals("de-DE", id.body.getString("language"))
        assertEquals("pro", id.body.getJSONObject("attributes").getString("tier"))
        assertFalse("non-JSON values are dropped, not thrown", id.body.getJSONObject("attributes").has("bad"))
        assertEquals("tok", id.headers["X-Dispatch-User-Token"])
    }

    @Test fun fcmTokenRegistrationThenResetMovesItToAFreshAnonymousProfile() = runTest {
        val http = FakeTransport()
        val c = client(http)
        c.identify("user-42")
        c.registerFcmToken("fcm-token-123")
        val reg = http.calls("/api/sdk/v1/push/register").single().body!!
        assertEquals("FCM", reg.getString("channel"))
        assertEquals("android", reg.getString("platform"))
        assertEquals("pixel-1", reg.getString("deviceId"))
        assertEquals("5.2.0", reg.getString("appVersion"))

        val old = c.currentAnonymousId
        c.reset()
        assertNotEquals(old, c.currentAnonymousId)
        assertNull(c.currentExternalId)
        val rereg = http.calls("/api/sdk/v1/push/register").last().body!!
        assertEquals(c.currentAnonymousId, rereg.getString("anonymousId"))
        assertFalse(rereg.has("externalId"))

        c.reset(keepPushToken = false)
        assertEquals("/api/sdk/v1/push/unregister", http.calls.last().path)
    }

    @Test fun openReportedOnceAndPayloadParsing() = runTest {
        val http = FakeTransport()
        val c = client(http)
        val data = mapOf("messageId" to "m1", "url" to "myapp://story/9", "imageUrl" to "https://img/a.jpg", "section" to "world")
        val p = c.notificationOpened(data)!!
        assertEquals("myapp://story/9", p.url)
        assertEquals("world", p.data["section"])
        c.notificationOpened(data) // cold start + onNewIntent
        advanceUntilIdle()
        assertEquals(1, http.calls("/api/sdk/v1/push/opened").size)
        assertNull(c.notificationOpened(mapOf("foo" to "bar")))
        assertNull(Payloads.parsePush(mapOf("messageId" to "m2", "url" to "/"))!!.url)

        c.notificationReceived(mapOf("messageId" to "m3"), "Title", "Body"); advanceUntilIdle()
        assertEquals("m3", http.calls("/api/sdk/v1/push/received").single().body!!.getString("messageId"))
    }

    @Test fun liveUpdateParsingAndFollow() = runTest {
        val u = Payloads.parseLiveUpdate(mapOf("dispatchType" to "live_update", "activityKey" to "election-2026", "activityType" to "Election",
            "event" to "update", "contentState" to """{"progress":0.42,"title":"Counting"}""", "alertTitle" to "Update"))!!
        assertEquals(0.42, u.contentState["progress"])
        assertEquals("update", u.event)
        assertNull(Payloads.parsePush(mapOf("dispatchType" to "live_update", "messageId" to "x")))

        val http = FakeTransport()
        val c = client(http)
        assertThrows(IllegalStateException::class.java) { kotlinx.coroutines.runBlocking { c.followLiveActivity("election-2026") } }
        c.registerFcmToken("fcm-1")
        c.followLiveActivity("election-2026")
        val f = http.calls("/api/sdk/v1/live-activities/follow").single().body!!
        assertEquals("fcm-1", f.getString("token"))
        assertFalse(f.getBoolean("unfollow"))
    }

    @Test fun messageCentreRecommendationsPreferences() = runTest {
        val http = FakeTransport()
        http.reply("/api/sdk/v1/inbox", 200, """{"unread":1,"messages":[{"id":"m1","layout":"BANNER","title":"Hi","body":"B","imageUrl":null,"url":"myapp://a","buttons":[{"label":"Read","url":"myapp://r"}],"sentAt":"2026-09-24T10:00:00Z","expiresAt":null,"read":false,"display":true}]}""")
        http.reply("/api/sdk/v1/recommendations", 200, """{"items":[{"id":"a1","title":"Story","url":"https://x/a1","summary":null,"imageUrl":null,"section":"world","score":0.9}]}""")
        http.reply("/api/sdk/v1/preferences", 200, """{"groups":[{"id":"g1","name":"Markets","description":null,"subscribed":false},{"id":"g2","slug":"morning-briefing","name":"Morning Briefing","description":"7am","kind":"newsletter","subscribed":true}]}""")
        val c = client(http)
        c.identify("user-1")
        val inbox = c.inbox(10)
        assertEquals(1, inbox.unread)
        assertEquals("BANNER", inbox.messages[0].layout)
        assertNull(inbox.messages[0].imageUrl)
        assertEquals("Read", inbox.messages[0].buttons[0].label)
        val q = http.calls("/api/sdk/v1/inbox").single()
        assertEquals("GET", q.method)
        assertTrue(q.query!!.contains("externalId=user-1") && q.query.contains("limit=10"))

        c.markRead(listOf("m1")); c.reportDisplayed("m1"); c.reportClicked("m1", "myapp://r"); c.deleteMessages(listOf("m1"))
        assertEquals("myapp://r", http.calls("/api/sdk/v1/inbox/clicked").single().body!!.getString("url"))

        val recs = c.recommendations(RecommendationStrategy.TRENDING, 3)
        assertEquals("a1", recs.single().id)
        assertTrue(http.calls("/api/sdk/v1/recommendations").single().query!!.contains("strategy=trending"))

        val prefs = c.setPreferences(mapOf("g1" to false, "morning-briefing" to true))
        assertFalse(prefs[0].subscribed)
        assertEquals(PreferenceGroup.Kind.TOPIC, prefs[0].kind)
        assertTrue(prefs[1].isNewsletter && prefs[1].subscribed)
        assertEquals("morning-briefing", prefs[1].slug)
        assertTrue(http.calls("/api/sdk/v1/preferences").single().body!!.getJSONObject("groups").getBoolean("morning-briefing"))
        assertEquals("PUT", http.calls("/api/sdk/v1/preferences").single().method)

        c.articleRead("a1"); advanceUntilIdle(); c.flush()
        val ev = http.calls("/api/sdk/v1/events").last().body!!.getJSONArray("events").getJSONObject(0)
        assertEquals("article_read", ev.getString("name"))
        assertEquals("a1", ev.getJSONObject("properties").getString("itemId"))
    }

    @Test fun contentCards() = runTest {
        val http = FakeTransport()
        http.reply("/api/sdk/v1/cards", 200, """{"unviewed":1,"cards":[{"id":"c1","style":"BANNER","title":"T","body":"B","imageUrl":"https://i/x.jpg","url":"app://c","buttonLabel":null,"pinned":true,"dismissible":false,"category":"offers","sentAt":"2026-09-24T10:00:00Z","expiresAt":null,"viewed":false,"clicked":false}]}""")
        val c = client(http)
        c.identify("user-1")
        val feed = c.contentCards(category = "offers")
        assertEquals(1, feed.unviewed)
        assertEquals("BANNER", feed.cards[0].style)
        assertTrue(feed.cards[0].pinned)
        assertFalse(feed.cards[0].dismissible)
        assertNull(feed.cards[0].buttonLabel)
        assertTrue(http.calls("/api/sdk/v1/cards").single().query!!.contains("category=offers"))
        c.logCardsViewed(listOf("c1")); c.logCardClicked("c1", "app://c"); c.dismissCards(listOf("c1")); c.logCardsViewed(emptyList())
        assertEquals(1, http.calls("/api/sdk/v1/cards/viewed").size)
        assertEquals("app://c", http.calls("/api/sdk/v1/cards/clicked").single().body!!.getString("url"))
        assertEquals("c1", http.calls("/api/sdk/v1/cards/dismissed").single().body!!.getJSONArray("messageIds").getString(0))
    }
}
