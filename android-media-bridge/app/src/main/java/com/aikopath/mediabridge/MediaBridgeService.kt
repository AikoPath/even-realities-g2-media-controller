package com.aikopath.mediabridge

import android.app.*
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.os.Build
import android.view.KeyEvent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import fi.iki.elonen.NanoHTTPD

class MediaBridgeService : Service() {

    private var httpServer: MediaHttpServer? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(1, buildNotification())

        httpServer = MediaHttpServer(8765, this).also { it.start() }
    }

    override fun onDestroy() {
        httpServer?.stop()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "media_bridge",
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.channel_description)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, "media_bridge")
            .setContentTitle("Media Bridge")
            .setContentText("Listening on localhost:8765")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()
    }

    // ── Get the currently active media session ──
    fun getActiveController(): MediaController? {
        val manager = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
        val cn = ComponentName(this, NotificationListenerService::class.java)
        return try {
            manager.getActiveSessions(cn).firstOrNull()
        } catch (e: SecurityException) {
            null
        }
    }

    fun getAudioManager(): AudioManager {
        return getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }
}

/**
 * Tiny HTTP server on localhost that translates REST calls into Android media commands.
 *
 * Endpoints (all POST):
 *   /play-pause - toggle play/pause
 *   /next       - skip to next track
 *   /prev       - skip to previous track
 *   /vol-up     - increase media volume
 *   /vol-down   - decrease media volume
 *   /status     - get current playback state
 */
class MediaHttpServer(
    port: Int,
    private val service: MediaBridgeService
) : NanoHTTPD("127.0.0.1", port) {

    override fun serve(session: IHTTPSession): Response {
        val headers = mutableMapOf(
            "Access-Control-Allow-Origin" to "*",
            "Access-Control-Allow-Methods" to "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers" to "Content-Type",
        )

        if (session.method == Method.OPTIONS) {
            return newFixedLengthResponse(Response.Status.OK, "text/plain", "").also {
                headers.forEach { (k, v) -> it.addHeader(k, v) }
            }
        }

        val controller = service.getActiveController()
        val transport = controller?.transportControls
        val audio = service.getAudioManager()

        when (session.uri) {
            "/play-pause" -> controller?.dispatchMediaButtonEvent(
                KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            )
            "/next" -> transport?.skipToNext()
            "/prev" -> transport?.skipToPrevious()
            "/vol-up" -> audio.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                AudioManager.ADJUST_RAISE,
                0
            )
            "/vol-down" -> audio.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                AudioManager.ADJUST_LOWER,
                0
            )
            "/status" -> {}
            else -> return jsonResponse("""{"error":"unknown command"}""", headers)
        }

        // Build status response
        val metadata = controller?.metadata
        val title = metadata?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "Unknown"
        val artist = metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: ""
        val volume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)

        val json = buildString {
            append("{")
            append("\"title\":\"${escapeJson(title)}\",")
            append("\"artist\":\"${escapeJson(artist)}\",")
            append("\"volume\":$volume")
            append("}")
        }
        return jsonResponse(json, headers)
    }

    private fun jsonResponse(json: String, headers: Map<String, String>): Response {
        return newFixedLengthResponse(Response.Status.OK, "application/json", json).also {
            headers.forEach { (k, v) -> it.addHeader(k, v) }
        }
    }

    private fun escapeJson(s: String): String {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
    }
}
