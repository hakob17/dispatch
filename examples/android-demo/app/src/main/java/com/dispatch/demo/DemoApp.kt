package com.dispatch.demo

import android.app.Application
import com.dispatch.sdk.Dispatch
import com.dispatch.sdk.DispatchConfig

class DemoApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val prefs = getSharedPreferences("demo", MODE_PRIVATE)
        // Demo devices are recognised by the "demo-" device id (see scripts/demo.ts)
        val deviceId = prefs.getString("deviceId", null)
            ?: ("demo-android-" + java.util.UUID.randomUUID().toString().take(8)).also { prefs.edit().putString("deviceId", it).apply() }

        Dispatch.notificationIcon = R.drawable.ic_notification
        Dispatch.init(
            this,
            DispatchConfig(
                apiKey = BuildConfig.DISPATCH_SDK_KEY.ifBlank { "dk_pub_missing" },
                baseUrl = BuildConfig.DISPATCH_BASE_URL,
                flushIntervalMs = 5_000,
                appVersion = "demo-1.0",
                deviceId = deviceId,
                onError = { e -> DemoState.log("⚠︎ ${e.message}") },
            ),
        )
        DemoState.start(this)
    }
}
