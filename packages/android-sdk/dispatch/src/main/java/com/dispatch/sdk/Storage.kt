package com.dispatch.sdk

import android.content.Context
import java.util.concurrent.ConcurrentHashMap

/** Persistent key/value storage for the anonymous id, current user, event queue and push token. */
interface KeyValueStore {
    fun get(key: String): String?
    fun set(key: String, value: String?)
}

class SharedPreferencesStore(context: Context, name: String = "dispatch_sdk") : KeyValueStore {
    private val prefs = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun set(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}

/** In-memory store (tests, previews). */
class MemoryStore : KeyValueStore {
    private val map = ConcurrentHashMap<String, String>()
    override fun get(key: String): String? = map[key]
    override fun set(key: String, value: String?) {
        if (value == null) map.remove(key) else map[key] = value
    }
}
