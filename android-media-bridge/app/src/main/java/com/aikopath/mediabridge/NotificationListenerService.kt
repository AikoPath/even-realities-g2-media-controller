package com.aikopath.mediabridge

import android.service.notification.NotificationListenerService as NLS
import android.service.notification.StatusBarNotification

/**
 * Empty notification listener — its mere existence in the manifest grants
 * the app permission to call MediaSessionManager.getActiveSessions().
 */
class NotificationListenerService : NLS() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {}
    override fun onNotificationRemoved(sbn: StatusBarNotification?) {}
}
