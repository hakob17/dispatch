# Dispatch Android SDK

A Kotlin library for minSdk 23. Its only dependencies are androidx.core and coroutines; Firebase is `compileOnly`, so it uses your app's
existing Firebase. It never registers a `FirebaseMessagingService` or asks for permission on its own.

```kotlin
// settings.gradle.kts: includeBuild("path/to/packages/android-sdk")   dependencies: implementation("com.dispatch:dispatch")
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Dispatch.init(this, DispatchConfig(apiKey = "dk_pub_…", baseUrl = "https://dispatch.example.com"))
    }
}
val dispatch = Dispatch.client
lifecycleScope.launch { dispatch.identify("user-42", DispatchProfile(language = Locale.getDefault().toLanguageTag())) }
dispatch.track("article_read", mapOf("itemId" to "a1"))
```

## Push (FCM)

Pick one of these:

- **Dispatch is your only provider:** declare the ready-made service.
  ```xml
  <service android:name="com.dispatch.sdk.DispatchMessagingService" android:exported="false">
      <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
  </service>
  ```
- **You already have a service** (for example during a migration): forward from it.
  ```kotlin
  override fun onNewToken(token: String) { Dispatch.onNewToken(token) }
  override fun onMessageReceived(m: RemoteMessage) { if (!Dispatch.handleRemoteMessage(this, m)) otherProvider.handle(m) }
  ```

Then report taps. This covers the cold-start case too:

```kotlin
override fun onCreate(s: Bundle?) { super.onCreate(s); Dispatch.handleNotificationOpen(intent)?.url?.let(router::open) }
override fun onNewIntent(i: Intent) { super.onNewIntent(i); Dispatch.handleNotificationOpen(i)?.url?.let(router::open) }
```

- **Notification channels.** The SDK creates `dispatch_breaking` (high importance), `dispatch_default` and `dispatch_live`.
- **Foreground alerts.** The SDK draws alerts that arrive while the app is open, with a big picture and collapse key. In the
  background, Android draws them from the FCM notification payload.
- **Permission.** `POST_NOTIFICATIONS` is declared, but asking for it is your app's job.

## Live Updates

```kotlin
dispatch.followLiveActivity("election-2026")
Dispatch.liveUpdateRenderer = { ctx, update -> /* your own Notification, or null for the default */ null }
```

The default renderer is an ongoing progress notification per activity, which asks for promoted Live Update treatment on Android 16.

## Message centre, recommendations, preferences

```kotlin
val inbox = dispatch.inbox()
dispatch.reportDisplayed(msg.id); dispatch.reportClicked(msg.id, button.url)
val picks = dispatch.recommendations(RecommendationStrategy.FOR_YOU, 5)
dispatch.articleRead(article.id)
val topics = dispatch.preferences(); dispatch.setPreferences(mapOf(topics[0].id to false))
```

Test with `./gradlew :dispatch:testDebugUnitTest`. Build with `./gradlew :dispatch:assembleRelease`.
