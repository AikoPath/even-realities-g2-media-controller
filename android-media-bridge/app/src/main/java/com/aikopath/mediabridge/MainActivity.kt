package com.aikopath.mediabridge

import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        val statusText = TextView(this).apply {
            text = "Media Bridge"
            textSize = 24f
        }

        val permissionText = TextView(this).apply {
            text = if (isNotificationListenerEnabled()) {
                "✓ Notification access granted"
            } else {
                "⚠ Notification access required"
            }
            textSize = 16f
            setPadding(0, 24, 0, 24)
        }

        val permissionBtn = Button(this).apply {
            text = "Grant Notification Access"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }

        val startBtn = Button(this).apply {
            text = "Start Media Bridge"
            setOnClickListener {
                val intent = Intent(this@MainActivity, MediaBridgeService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(intent)
                } else {
                    startService(intent)
                }
                statusText.text = "Media Bridge Running on port 8765"
            }
        }

        val stopBtn = Button(this).apply {
            text = "Stop"
            setOnClickListener {
                stopService(Intent(this@MainActivity, MediaBridgeService::class.java))
                statusText.text = "Media Bridge Stopped"
            }
        }

        layout.addView(statusText)
        layout.addView(permissionText)
        layout.addView(permissionBtn)
        layout.addView(startBtn)
        layout.addView(stopBtn)

        setContentView(layout)
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val cn = ComponentName(this, NotificationListenerService::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return flat?.contains(cn.flattenToString()) == true
    }
}
