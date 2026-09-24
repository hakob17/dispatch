package com.dispatch.sdk

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL

/**
 * Android entry point. Call [init] once in `Application.onCreate`, then wire
 * FCM in whichever way suits the app:
 *
 *  - declare [DispatchMessagingService] in your manifest, or
 *  - from your own FirebaseMessagingService call [onNewToken] and
 *    [handleRemoteMessage] (returns false for non-Dispatch messages, so other
 *    push providers keep working side by side during a migration).
 *
 * In your launcher activity's `onCreate` and `onNewIntent` call
 * [handleNotificationOpen] to report the tap and get the deep link — this
 * covers cold starts too.
 */
object Dispatch {
    const val CHANNEL_BREAKING = "dispatch_breaking"
    const val CHANNEL_DEFAULT = "dispatch_default"
    const val CHANNEL_LIVE = "dispatch_live"
    private const val TAG = "Dispatch"
    private const val EXTRA_FROM_DISPATCH = "com.dispatch.sdk.OPENED"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var instance: DispatchClient? = null
    @Volatile private var appContext: Context? = null

    /** Small icon for notifications the SDK draws (defaults to the app icon). */
    @JvmStatic var notificationIcon: Int = 0

    /** Override how Live Updates are drawn; return null to fall back to the default renderer. */
    @JvmStatic var liveUpdateRenderer: ((Context, DispatchLiveUpdate) -> Notification?)? = null

    @JvmStatic
    val client: DispatchClient
        get() = instance ?: error("Dispatch.init(context, config) must be called first (Application.onCreate)")

    @JvmStatic
    @Synchronized
    fun init(context: Context, config: DispatchConfig): DispatchClient {
        instance?.let { return it }
        val app = context.applicationContext
        appContext = app
        val version = config.appVersion ?: runCatching { app.packageManager.getPackageInfo(app.packageName, 0).versionName }.getOrNull()
        val c = DispatchClient(config.copy(appVersion = version), SharedPreferencesStore(app))
        instance = c
        createChannels(app)
        c.start()
        return c
    }

    // --------------------------------------------------------------- FCM glue

    /** Forward FirebaseMessagingService.onNewToken (and the token at startup). */
    @JvmStatic
    fun onNewToken(token: String) {
        val c = instance ?: return
        scope.launch { runCatching { c.registerFcmToken(token) }.onFailure { Log.w(TAG, "token registration failed: ${it.message}") } }
    }

    /**
     * Forward FirebaseMessagingService.onMessageReceived. Shows Dispatch alerts
     * that arrive while the app is in the foreground (in the background Android
     * draws them from the notification payload itself), renders Live Updates,
     * and reports delivery. Returns false when the message isn't from Dispatch.
     */
    @JvmStatic
    fun handleRemoteMessage(context: Context, data: Map<String, String>, notificationTitle: String?, notificationBody: String?): Boolean {
        val c = instance ?: return false
        Payloads.parseLiveUpdate(data)?.let { update ->
            showLiveUpdate(context, update)
            return true
        }
        val push = c.notificationReceived(data, notificationTitle, notificationBody) ?: return false
        // FCM calls onMessageReceived off the main thread; other callers (a BroadcastReceiver,
        // a custom bridge) may not — the image download must never run on the main thread.
        if (Looper.myLooper() == Looper.getMainLooper()) scope.launch { showNotification(context.applicationContext, push) }
        else showNotification(context, push)
        return true
    }

    /** Overload taking Firebase's RemoteMessage directly. */
    @JvmStatic
    fun handleRemoteMessage(context: Context, message: com.google.firebase.messaging.RemoteMessage): Boolean =
        handleRemoteMessage(context, message.data, message.notification?.title, message.notification?.body)

    /**
     * Call from the launcher activity's onCreate and onNewIntent. Reports the
     * open (once) and returns the push — navigate to [DispatchPush.url].
     * Works for notifications drawn by the SDK and by the system (background).
     */
    @JvmStatic
    fun handleNotificationOpen(intent: Intent?): DispatchPush? {
        val extras = intent?.extras ?: return null
        val data = bundleToMap(extras)
        if (data["messageId"] == null) return null
        val push = instance?.notificationOpened(data)
        // Don't report again if the activity is recreated with the same intent
        intent.removeExtra("messageId")
        return push
    }

    // ---------------------------------------------------------- notifications

    private fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CHANNEL_BREAKING, "Breaking news", NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(CHANNEL_DEFAULT, "News", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CHANNEL_LIVE, "Live coverage", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
            )
        )
    }

    private fun smallIcon(context: Context): Int =
        if (notificationIcon != 0) notificationIcon else context.applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info

    private fun openIntent(context: Context, data: Map<String, String>, requestCode: Int): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        data.forEach { (k, v) -> launch.putExtra(k, v) }
        launch.putExtra(EXTRA_FROM_DISPATCH, true)
        return PendingIntent.getActivity(context, requestCode, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    @SuppressLint("MissingPermission") // the app owns the POST_NOTIFICATIONS request; notify() is a no-op without it
    private fun showNotification(context: Context, push: DispatchPush) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val channel = push.data["androidChannelId"]
            ?: if (push.data["priority"] == "NORMAL") CHANNEL_DEFAULT else CHANNEL_BREAKING
        val collapse = push.data["collapseKey"]
        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(smallIcon(context))
            .setContentTitle(push.title)
            .setContentText(push.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(push.body))
            .setAutoCancel(true)
            .setPriority(if (channel == CHANNEL_BREAKING) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(openIntent(context, push.data, push.messageId.hashCode()))
        push.imageUrl?.let { downloadBitmap(it) }?.let { bmp ->
            builder.setLargeIcon(bmp).setStyle(NotificationCompat.BigPictureStyle().bigPicture(bmp).setSummaryText(push.body))
        }
        // Same collapse key → replace the earlier notification instead of stacking
        val id = (collapse ?: push.messageId).hashCode()
        NotificationManagerCompat.from(context).notify(collapse ?: "dispatch", id, builder.build())
    }

    @SuppressLint("MissingPermission")
    private fun showLiveUpdate(context: Context, update: DispatchLiveUpdate) {
        val nm = NotificationManagerCompat.from(context)
        val id = update.activityKey.hashCode()
        val custom = runCatching { liveUpdateRenderer?.invoke(context, update) }.getOrNull()
        if (custom != null) {
            if (nm.areNotificationsEnabled()) nm.notify("dispatch-live", id, custom)
            return
        }
        if (!nm.areNotificationsEnabled()) return
        val state = update.contentState
        val title = update.alertTitle ?: state["title"] as? String ?: update.activityType
        val text = update.alertBody ?: state["subtitle"] as? String ?: state["status"] as? String
        val progress = when (val p = state["progress"]) {
            is Number -> if (p.toDouble() <= 1.0) (p.toDouble() * 100).toInt() else p.toInt()
            else -> null
        }?.coerceIn(0, 100)
        val ended = update.event == "end"
        val extras = Bundle().apply { putBoolean("android.requestPromotedOngoing", !ended) } // Android 16 Live Updates
        val builder = NotificationCompat.Builder(context, CHANNEL_LIVE)
            .setSmallIcon(smallIcon(context))
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(update.alertTitle == null) // updates are silent unless they carry an alert
            .setOngoing(!ended)
            .setAutoCancel(ended)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .addExtras(extras)
            .setContentIntent(openIntent(context, mapOf("activityKey" to update.activityKey), id))
        if (progress != null && !ended) builder.setProgress(100, progress, false)
        if (ended) builder.setTimeoutAfter(15 * 60_000L)
        nm.notify("dispatch-live", id, builder.build())
    }

    private fun downloadBitmap(url: String): Bitmap? = runCatching {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 5_000
        conn.readTimeout = 5_000
        try { conn.inputStream.use { BitmapFactory.decodeStream(it) } } finally { conn.disconnect() }
    }.onFailure { Log.w(TAG, "image download failed: ${it.message}") }.getOrNull()

    private fun bundleToMap(b: Bundle): Map<String, String> {
        val out = HashMap<String, String>()
        for (k in b.keySet()) {
            @Suppress("DEPRECATION") val v = b.get(k)
            if (v is String) out[k] = v
        }
        return out
    }
}

