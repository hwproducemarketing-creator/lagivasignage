package com.hwproduce.signage

import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var api: ApiClient
    private lateinit var imageView: ImageView
    private lateinit var playerView: PlayerView
    private lateinit var waitingPanel: LinearLayout
    private lateinit var pairingPanel: LinearLayout
    private lateinit var pairingCodeText: TextView
    private lateinit var waitingText: TextView
    private lateinit var debugPanel: ScrollView
    private lateinit var debugText: TextView

    private var player: ExoPlayer? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())
    private var networkOk = false
    private var menuPressCount = 0

    private val pollRunnable = object : Runnable {
        override fun run() {
            scope.launch { pollOnce() }
            handler.postDelayed(this, POLL_MS)
        }
    }

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            scope.launch { sendHeartbeat() }
            handler.postDelayed(this, HEARTBEAT_MS)
        }
    }

    private val pairingRunnable = object : Runnable {
        override fun run() {
            scope.launch { checkPairing() }
            handler.postDelayed(this, PAIRING_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)
        hideSystemUi()

        prefs = Prefs(this)
        api = ApiClient(BuildConfig.SERVER_URL)

        imageView = findViewById(R.id.imageView)
        playerView = findViewById(R.id.playerView)
        waitingPanel = findViewById(R.id.waitingPanel)
        pairingPanel = findViewById(R.id.pairingPanel)
        pairingCodeText = findViewById(R.id.pairingCodeText)
        waitingText = findViewById(R.id.waitingText)
        debugPanel = findViewById(R.id.debugPanel)
        debugText = findViewById(R.id.debugText)

        playerView.useController = false

        showCachedOrWaiting()

        if (prefs.deviceId.isNullOrBlank()) {
            showPairing()
            scope.launch { ensurePairingCode() }
            handler.post(pairingRunnable)
        } else {
            startPlayerLoops()
        }
    }

    private fun startPlayerLoops() {
        handler.removeCallbacks(pairingRunnable)
        pairingPanel.visibility = View.GONE
        handler.post(pollRunnable)
        handler.post(heartbeatRunnable)
    }

    private fun hideSystemUi() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun cacheDirFile(): File = File(filesDir, "cache").also { it.mkdirs() }

    private fun showCachedOrWaiting() {
        val name = prefs.cachedFileName
        val type = prefs.cachedType
        if (name != null) {
            val file = File(cacheDirFile(), name)
            if (file.exists() && file.length() > 0) {
                displayLocal(file, type ?: "image")
                return
            }
        }
        showWaiting()
    }

    private fun showWaiting() {
        waitingPanel.visibility = View.VISIBLE
        waitingText.setText(R.string.waiting)
        pairingPanel.visibility = View.GONE
        imageView.visibility = View.GONE
        playerView.visibility = View.GONE
        stopPlayer()
    }

    private fun showPairing() {
        waitingPanel.visibility = View.GONE
        pairingPanel.visibility = View.VISIBLE
        imageView.visibility = View.GONE
        playerView.visibility = View.GONE
        stopPlayer()
        pairingCodeText.text = prefs.pairingCode ?: "---- ----"
    }

    private suspend fun ensurePairingCode() {
        if (!prefs.pairingCode.isNullOrBlank()) {
            pairingCodeText.text = prefs.pairingCode
            return
        }
        try {
            val code = withContext(Dispatchers.IO) { api.requestPairingCode() }
            prefs.pairingCode = code
            pairingCodeText.text = code
            networkOk = true
        } catch (_: Exception) {
            networkOk = false
            // Retry later via pairingRunnable
        }
    }

    private suspend fun checkPairing() {
        if (!prefs.deviceId.isNullOrBlank()) {
            startPlayerLoops()
            return
        }
        if (prefs.pairingCode.isNullOrBlank()) {
            ensurePairingCode()
            return
        }
        try {
            val status = withContext(Dispatchers.IO) {
                api.pairingStatus(prefs.pairingCode!!)
            }
            networkOk = true
            if (status.status == "registered" && !status.deviceId.isNullOrBlank()) {
                prefs.deviceId = status.deviceId
                withContext(Dispatchers.Main) { startPlayerLoops() }
            }
        } catch (_: Exception) {
            networkOk = false
            if (prefs.pairingCode.isNullOrBlank()) {
                ensurePairingCode()
            }
        }
    }

    private suspend fun pollOnce() {
        val deviceId = prefs.deviceId ?: return
        try {
            val current = withContext(Dispatchers.IO) { api.getCurrent() }
            networkOk = true
            if (current.url.isNullOrBlank() || current.type.isNullOrBlank()) {
                return
            }
            if (current.version == prefs.contentVersion) {
                return
            }
            val ext = when (current.type) {
                "video" -> ".mp4"
                else -> guessExt(current.url)
            }
            val destName = "content_v${current.version}$ext"
            val dest = File(cacheDirFile(), destName)
            val ok = withContext(Dispatchers.IO) { api.downloadToFile(current.url!!, dest) }
            if (!ok) return

            prefs.contentVersion = current.version
            prefs.cachedFileName = destName
            prefs.cachedType = current.type
            prefs.lastSuccessfulUpdate = nowIso()

            // Cleanup older cache files
            cacheDirFile().listFiles()?.forEach { f ->
                if (f.name != destName) f.delete()
            }

            withContext(Dispatchers.Main) {
                displayLocal(dest, current.type!!)
            }
        } catch (_: Exception) {
            networkOk = false
            // Keep showing cached content silently
        }
    }

    private fun guessExt(url: String): String {
        val lower = url.lowercase(Locale.US)
        return when {
            lower.endsWith(".png") -> ".png"
            lower.endsWith(".webp") -> ".webp"
            lower.endsWith(".jpeg") -> ".jpeg"
            else -> ".jpg"
        }
    }

    private fun displayLocal(file: File, type: String) {
        waitingPanel.visibility = View.GONE
        pairingPanel.visibility = View.GONE
        if (type == "video") {
            imageView.visibility = View.GONE
            playerView.visibility = View.VISIBLE
            playVideo(file)
        } else {
            stopPlayer()
            playerView.visibility = View.GONE
            imageView.visibility = View.VISIBLE
            val bmp = BitmapFactory.decodeFile(file.absolutePath)
            if (bmp != null) {
                imageView.setImageBitmap(bmp)
            }
        }
    }

    private fun playVideo(file: File) {
        stopPlayer()
        val exo = ExoPlayer.Builder(this).build().also { player = it }
        playerView.player = exo
        exo.repeatMode = Player.REPEAT_MODE_ONE
        exo.volume = 0f
        exo.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
        exo.prepare()
        exo.playWhenReady = true
    }

    private fun stopPlayer() {
        playerView.player = null
        player?.release()
        player = null
    }

    private suspend fun sendHeartbeat() {
        val deviceId = prefs.deviceId ?: return
        try {
            withContext(Dispatchers.IO) {
                api.heartbeat(deviceId, prefs.contentVersion.coerceAtLeast(0), BuildConfig.APP_VERSION)
            }
            prefs.lastHeartbeat = nowIso()
            networkOk = true
        } catch (_: Exception) {
            networkOk = false
        }
    }

    private fun nowIso(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date())

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_INFO) {
            menuPressCount++
            if (menuPressCount >= 3) {
                menuPressCount = 0
                toggleDebug()
            }
            handler.postDelayed({ menuPressCount = 0 }, 2000)
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_BACK && debugPanel.visibility == View.VISIBLE) {
            debugPanel.visibility = View.GONE
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun toggleDebug() {
        if (debugPanel.visibility == View.VISIBLE) {
            debugPanel.visibility = View.GONE
            return
        }
        debugText.text = buildString {
            appendLine("H&W Signage Debug")
            appendLine("Device ID: ${prefs.deviceId ?: "(not registered)"}")
            appendLine("App version: ${BuildConfig.APP_VERSION}")
            appendLine("Server URL: ${BuildConfig.SERVER_URL}")
            appendLine("Signage version: ${prefs.contentVersion}")
            appendLine("Cached type: ${prefs.cachedType}")
            appendLine("Cached file: ${prefs.cachedFileName}")
            appendLine("Last successful update: ${prefs.lastSuccessfulUpdate ?: "—"}")
            appendLine("Last heartbeat: ${prefs.lastHeartbeat ?: "—"}")
            appendLine("Network: ${if (networkOk) "OK" else "Unavailable (using cache)"}")
            appendLine()
            appendLine("Press BACK to close")
        }
        debugPanel.visibility = View.VISIBLE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
        stopPlayer()
        super.onDestroy()
    }

    companion object {
        private const val POLL_MS = 10_000L
        private const val HEARTBEAT_MS = 30_000L
        private const val PAIRING_MS = 3_000L
    }
}
