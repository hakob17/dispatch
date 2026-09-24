package com.dispatch.sdk

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** One HTTP exchange. Swappable for tests. */
interface HttpTransport {
    data class Response(val status: Int, val body: String, val retryAfter: String?)

    @Throws(IOException::class)
    fun request(method: String, url: String, headers: Map<String, String>, body: String?): Response
}

/** HttpURLConnection: no extra dependencies in the host app. */
class UrlConnectionTransport(private val timeoutMs: Int = 20_000) : HttpTransport {
    override fun request(method: String, url: String, headers: Map<String, String>, body: String?): HttpTransport.Response {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return HttpTransport.Response(status, text, conn.getHeaderField("Retry-After"))
        } finally {
            conn.disconnect()
        }
    }
}

internal object Json {
    fun obj(map: Map<String, Any?>): JSONObject = JSONObject().apply { map.forEach { (k, v) -> wrap(v)?.let { put(k, it) } } }

    /** Converts Kotlin values to org.json; values it can't represent are dropped, never thrown. */
    fun wrap(v: Any?): Any? = when (v) {
        null -> null
        is String, is Boolean, is Int, is Long, is Double -> v
        is Float -> v.toDouble()
        is Number -> v.toDouble()
        is Map<*, *> -> JSONObject().apply { v.forEach { (k, x) -> if (k is String) wrap(x)?.let { put(k, it) } } }
        is Collection<*> -> JSONArray().apply { v.forEach { x -> wrap(x)?.let { put(it) } } }
        is Array<*> -> wrap(v.toList())
        is JSONObject, is JSONArray -> v
        else -> null
    }

    fun toMap(o: JSONObject?): Map<String, Any?> {
        if (o == null) return emptyMap()
        val out = LinkedHashMap<String, Any?>()
        o.keys().forEach { k -> out[k] = unwrap(o.opt(k)) }
        return out
    }

    private fun unwrap(v: Any?): Any? = when (v) {
        is JSONObject -> toMap(v)
        is JSONArray -> (0 until v.length()).map { unwrap(v.opt(it)) }
        JSONObject.NULL -> null
        // org.json versions differ (Android: Double/Long, newer JVM builds: BigDecimal/BigInteger)
        is java.math.BigDecimal -> v.toDouble()
        is java.math.BigInteger -> v.toLong()
        else -> v
    }

    fun optString(o: JSONObject, key: String): String? = if (o.isNull(key)) null else o.optString(key, "").ifEmpty { null }
}

internal fun query(params: Map<String, String?>): String =
    params.filterValues { it != null }.entries.sortedBy { it.key }
        .joinToString("&") { "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}" }
