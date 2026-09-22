package com.hwproduce.signage

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

data class CurrentContent(
    val version: Int,
    val type: String?,
    val url: String?,
    val updatedAt: String?,
    val filename: String?,
)

class ApiClient(private val baseUrl: String) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private fun url(path: String): String {
        val base = baseUrl.trimEnd('/')
        return if (path.startsWith("http")) path else base + path
    }

    fun requestPairingCode(): String {
        val req = Request.Builder()
            .url(url("/api/devices/pairing-code"))
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("pairing-code failed: $body")
            return JSONObject(body).getString("pairingCode")
        }
    }

    fun pairingStatus(code: String): PairingStatus {
        val req = Request.Builder()
            .url(url("/api/devices/pairing-status/$code"))
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("pairing-status failed")
            val json = JSONObject(body)
            return PairingStatus(
                status = json.getString("status"),
                deviceId = if (json.isNull("deviceId")) null else json.optString("deviceId"),
                name = if (json.isNull("name")) null else json.optString("name"),
            )
        }
    }

    fun getCurrent(): CurrentContent {
        val req = Request.Builder()
            .url(url("/api/screen/current"))
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("current failed")
            val json = JSONObject(body)
            return CurrentContent(
                version = json.optInt("version", 0),
                type = if (json.isNull("type")) null else json.optString("type").takeIf { it.isNotBlank() },
                url = when {
                    !json.isNull("url") && json.optString("url").isNotBlank() -> json.optString("url")
                    !json.isNull("imageUrl") && json.optString("imageUrl").isNotBlank() -> json.optString("imageUrl")
                    else -> null
                },
                updatedAt = if (json.isNull("updatedAt")) null else json.optString("updatedAt").takeIf { it.isNotBlank() },
                filename = if (json.isNull("filename")) null else json.optString("filename").takeIf { it.isNotBlank() },
            )
        }
    }

    fun heartbeat(deviceId: String, currentVersion: Int, appVersion: String) {
        val payload = JSONObject()
            .put("deviceId", deviceId)
            .put("currentVersion", currentVersion)
            .put("appVersion", appVersion)
            .toString()
        val req = Request.Builder()
            .url(url("/api/screen/heartbeat"))
            .post(payload.toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IllegalStateException("heartbeat failed")
        }
    }

    fun downloadToFile(pathOrUrl: String, dest: File): Boolean {
        val req = Request.Builder().url(url(pathOrUrl)).get().build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return false
            val body = res.body ?: return false
            dest.parentFile?.mkdirs()
            val tmp = File(dest.parentFile, dest.name + ".part")
            tmp.outputStream().use { out ->
                body.byteStream().copyTo(out)
            }
            if (tmp.length() <= 0L) {
                tmp.delete()
                return false
            }
            if (dest.exists()) dest.delete()
            return tmp.renameTo(dest)
        }
    }
}

data class PairingStatus(
    val status: String,
    val deviceId: String?,
    val name: String?,
)
