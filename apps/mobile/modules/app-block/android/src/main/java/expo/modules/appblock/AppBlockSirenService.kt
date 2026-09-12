package expo.modules.appblock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Foreground-service wrapper around AppBlockSirenPlayer (see that class for
 * why playback itself is synchronous and volume-enforced natively).
 *
 * This Service's only job is to declare foreground-service status —
 * `startForeground()` — so the OS treats the anti-theft siren as a
 * legitimate, high-priority background audio session instead of throttling
 * or killing it a few seconds after the app leaves the foreground, exactly
 * like AppBlockShieldService does for enforcement. `specialUse` (not
 * `mediaPlayback`) to match that already-reviewed pattern and reuse the
 * `FOREGROUND_SERVICE_SPECIAL_USE` permission already declared in the
 * manifest — no new permission needed.
 *
 * Deliberately NOT a MediaStyle/MediaSession notification: any lock-screen
 * transport control — even a generic system-provided "pause" — would hand
 * the thief a button that defeats the whole point. The notification below
 * has no actions, no MediaSession token, `setOngoing(true)` (can't be
 * swiped away), and its own tap target just opens the app (which still
 * requires the owner's device auth to do anything, per the app's lock
 * screen). See AntifurtoAlarmOverlay.tsx for the matching comment on why
 * `setActiveForLockScreen` was avoided there.
 *
 * `stopWithTask=false`: swiping WardYou from Recents (the thief's first
 * move) must not silence the siren.
 */
class AppBlockSirenService : Service() {
  companion object {
    private const val CHANNEL_ID = "wardyou_antifurto_siren"
    private const val NOTIFICATION_ID = 4213

    fun start(context: Context) {
      val intent = Intent(context, AppBlockSirenService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
        else context.startService(intent)
      } catch (e: Exception) {
        // Background-start restriction on some OEM/Android combos — the
        // actual playback (AppBlockSirenPlayer) is started independently by
        // AppBlockModule.startSiren() regardless of whether this succeeds,
        // so the siren still sounds; it just runs without the extra
        // foreground-priority protection this service would have added.
      }
    }

    fun stop(context: Context) {
      try {
        context.stopService(Intent(context, AppBlockSirenService::class.java))
      } catch (e: Exception) {
        // ignore
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, buildNotification())
    // START_STICKY restarts deliver a null intent with no playback state to
    // resume from (a fresh process has no MediaPlayer to recover) — the
    // notification alone is harmless in that case and the next explicit
    // AppBlock.startSiren() call from JS rebuilds everything from scratch.
    return START_STICKY
  }

  override fun onDestroy() {
    // Belt-and-braces: if something stops this service directly (rather than
    // via AppBlock.stopSiren()), don't leave the siren playing with no
    // foreground-service backing it.
    AppBlockSirenPlayer.stop()
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        getString(R.string.app_block_siren_channel),
        // The siren sound IS the alert; this channel's own notification
        // sound would just add a redundant ding on top of it.
        NotificationManager.IMPORTANCE_LOW,
      ).apply { setShowBadge(false) }
      nm.createNotificationChannel(channel)
    }

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = if (launchIntent != null) {
      android.app.PendingIntent.getActivity(
        this,
        0,
        launchIntent,
        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
      )
    } else null

    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 }
      ?: resources.getIdentifier("ic_launcher", "mipmap", packageName)

    val builder = if (Build.VERSION.SDK_INT >= 26) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle(getString(R.string.app_block_siren_title))
      .setContentText(getString(R.string.app_block_siren_body))
      .setSmallIcon(icon)
      .setOngoing(true) // not swipe-dismissible; no actions added anywhere above
      .setCategory(Notification.CATEGORY_ALARM)
      .apply { if (contentIntent != null) setContentIntent(contentIntent) }
      .build()
  }
}
