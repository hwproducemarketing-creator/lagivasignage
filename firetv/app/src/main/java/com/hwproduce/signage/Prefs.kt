package com.hwproduce.signage

import android.content.Context

class Prefs(context: Context) {
    private val prefs = context.getSharedPreferences("hw_signage", Context.MODE_PRIVATE)

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var pairingCode: String?
        get() = prefs.getString(KEY_PAIRING, null)
        set(value) = prefs.edit().putString(KEY_PAIRING, value).apply()

    var contentVersion: Int
        get() = prefs.getInt(KEY_VERSION, -1)
        set(value) = prefs.edit().putInt(KEY_VERSION, value).apply()

    var cachedFileName: String?
        get() = prefs.getString(KEY_CACHE_FILE, null)
        set(value) = prefs.edit().putString(KEY_CACHE_FILE, value).apply()

    var cachedType: String?
        get() = prefs.getString(KEY_CACHE_TYPE, null)
        set(value) = prefs.edit().putString(KEY_CACHE_TYPE, value).apply()

    var lastSuccessfulUpdate: String?
        get() = prefs.getString(KEY_LAST_UPDATE, null)
        set(value) = prefs.edit().putString(KEY_LAST_UPDATE, value).apply()

    var lastHeartbeat: String?
        get() = prefs.getString(KEY_LAST_HB, null)
        set(value) = prefs.edit().putString(KEY_LAST_HB, value).apply()

    companion object {
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_PAIRING = "pairing_code"
        private const val KEY_VERSION = "content_version"
        private const val KEY_CACHE_FILE = "cache_file"
        private const val KEY_CACHE_TYPE = "cache_type"
        private const val KEY_LAST_UPDATE = "last_update"
        private const val KEY_LAST_HB = "last_heartbeat"
    }
}
