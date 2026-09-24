package com.dispatch.sdk

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Ready-made FirebaseMessagingService. Declare it in your app's manifest if
 * Dispatch is your only push provider:
 *
 *     <service android:name="com.dispatch.sdk.DispatchMessagingService" android:exported="false">
 *         <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
 *     </service>
 *
 * With another provider in the same app, keep your own service and call
 * Dispatch.onNewToken / Dispatch.handleRemoteMessage from it instead —
 * or subclass this and override [onOtherMessage].
 */
open class DispatchMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Dispatch.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (!Dispatch.handleRemoteMessage(this, message)) onOtherMessage(message)
    }

    /** Messages that didn't come from Dispatch. */
    open fun onOtherMessage(message: RemoteMessage) {}
}
