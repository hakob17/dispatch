package com.dispatch.demo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dispatch.sdk.Dispatch

/**
 * Emulator stand-in for FirebaseMessagingService.onMessageReceived. The worker's demo relay
 * sends the FCM data payload (plus title/body) as string extras; everything after this point —
 * drawing the notification, the delivery receipt, Live Updates, the open report — is the SDK.
 */
class DemoPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val extras = intent.extras ?: return
        val data = extras.keySet().mapNotNull { k -> extras.getString(k)?.let { k to it } }.toMap()
        val handled = Dispatch.handleRemoteMessage(context, data - "title" - "body", data["title"], data["body"])
        DemoState.log(if (handled) "Push received: ${data["title"] ?: data["alertTitle"] ?: data["dispatchType"]}" else "Ignored a non-Dispatch message")
    }
}
