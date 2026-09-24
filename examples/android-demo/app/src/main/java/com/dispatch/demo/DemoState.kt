package com.dispatch.demo

import android.content.Context
import com.dispatch.sdk.Dispatch
import com.dispatch.sdk.DispatchProfile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** App-wide demo state; the screens observe these flows. */
object DemoState {
    /** This app's newsletters — the iOS and React Native demos pick others. Configured in the Dispatch console. */
    val defaultNewsletters = listOf("sport-wrap", "tech-weekly")

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val externalId = MutableStateFlow<String?>(null)
    val anonymousId = MutableStateFlow("")
    val pushStatus = MutableStateFlow("Not enabled")
    val activity = MutableStateFlow<List<String>>(emptyList())
    val openArticle = MutableStateFlow<String?>(null)
    val unread = MutableStateFlow(0)

    private lateinit var prefs: android.content.SharedPreferences
    private val client get() = Dispatch.client

    fun start(context: Context) {
        prefs = context.getSharedPreferences("demo", Context.MODE_PRIVATE)
        anonymousId.value = client.currentAnonymousId
        externalId.value = client.currentExternalId
        log(if (BuildConfig.DISPATCH_SDK_KEY.isBlank()) "⚠︎ No demo-config.json — run `npm run demo -- setup` and rebuild" else "SDK started (anonymous profile)")
        if (prefs.getBoolean("pushEnabled", false)) registerDemoToken()
        scope.launch { subscribeDefaultNewsletters() }
    }

    fun log(line: String) {
        val time = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        activity.update { (listOf("$time  $line") + it).take(50) }
    }

    fun signIn(id: String) = scope.launch {
        runCatching { client.identify(id, DispatchProfile(firstName = "Sam", language = Locale.getDefault().toLanguageTag())) }
            .onSuccess {
                externalId.value = id
                log("Signed in as $id — anonymous history merged")
                subscribeDefaultNewsletters()
            }
            .onFailure { log("⚠︎ sign-in failed: ${it.message}") }
    }

    fun signOut() = scope.launch {
        client.reset()
        externalId.value = null
        anonymousId.value = client.currentAnonymousId
        log("Signed out — new anonymous profile, push token kept")
    }

    /** Once per user: subscribe by slug. */
    private suspend fun subscribeDefaultNewsletters() {
        val id = externalId.value ?: return
        val key = "newslettersDefaulted.$id"
        if (prefs.getBoolean(key, false)) return
        runCatching { client.setPreferences(defaultNewsletters.associateWith { true }) }
            .onSuccess { groups ->
                prefs.edit().putBoolean(key, true).apply()
                log("Subscribed to " + groups.filter { it.isNewsletter && it.subscribed }.joinToString(" + ") { it.name })
            }
            .onFailure { log("⚠︎ newsletters: ${it.message}") }
    }

    /**
     * Without a Firebase project the emulator has no FCM token, so the demo registers a
     * stand-in. The worker's demo relay recognises this device and delivers over adb.
     * With Firebase: `FirebaseMessaging.getInstance().token` → Dispatch.onNewToken(token).
     */
    fun registerDemoToken() {
        val token = prefs.getString("demoToken", null)
            ?: ("demo-fcm-" + java.util.UUID.randomUUID().toString().replace("-", "")).also { prefs.edit().putString("demoToken", it).apply() }
        prefs.edit().putBoolean("pushEnabled", true).apply()
        scope.launch {
            runCatching { client.registerFcmToken(token) }
                .onSuccess { pushStatus.value = "Registered (FCM · demo token)"; log("Push token registered: ${token.take(18)}…") }
                .onFailure { pushStatus.value = "Registration failed"; log("⚠︎ token: ${it.message}") }
        }
    }

    fun followElection() = scope.launch {
        runCatching { client.followLiveActivity("election-2026") }
            .onSuccess { log("Following election night — Live Updates will appear as an ongoing notification") }
            .onFailure { log("⚠︎ follow: ${it.message} (enable notifications first)") }
    }

    /** dispatchdemo://article/<id> → article screen; anything else is ignored in the demo. */
    fun open(url: String?) {
        val u = url ?: return
        if (u.startsWith("dispatchdemo://article/")) openArticle.value = u.removePrefix("dispatchdemo://article/")
    }
}
