package expo.modules.appblock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * "Escudo" foreground service: a lightweight always-on FGS whose only job is
 * to keep the Wityu process at foreground priority while parental enforcement
 * is enabled, so aggressive OEM task killers (MIUI/EMUI/ColorOS…) don't kill
 * the process and silently flip the AccessibilityService toggle off. It does
 * no work of its own — the AccessibilityService enforces; this keeps it alive.
 * START_STICKY: if the OS still kills us, it restarts the service.
 */
class AppBlockShieldService : Service() {
  companion object {
    private const val CHANNEL_ID = "wityu_protection"
    private const val NOTIFICATION_ID = 4211
    /** Enforcement state passed IN, so this service never has to read
     *  SharedPreferences: it runs in its own process (`:shield`) where a prefs
     *  instance written by the main process could be stale. */
    const val EXTRA_ENABLED = "enabled"
    /** Self-heartbeat: while this process is alive it re-arms the watchdog on
     *  its own, so protection doesn't depend on alarms surviving an OEM. */
    private const val HEARTBEAT_MS = 5 * 60 * 1000L

    fun start(context: Context, enabled: Boolean = true) {
      val intent = Intent(context, AppBlockShieldService::class.java)
        .putExtra(EXTRA_ENABLED, enabled)
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
        else context.startService(intent)
      } catch (e: Exception) {
        // Background-start restriction — the AccessibilityService still works;
        // the shield just won't add priority until the next app open.
      }
    }

    fun stop(context: Context) {
      try {
        context.stopService(Intent(context, AppBlockShieldService::class.java))
      } catch (e: Exception) {
        // ignore
      }
    }
  }

  /** Last known enforcement flag (from the start intent — see EXTRA_ENABLED). */
  private var enforcementEnabled = true
  private val heartbeatHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val heartbeat = object : Runnable {
    override fun run() {
      // Alive-process self-check: re-arm the alarm and keep going. Costs one
      // trivial call every 5 min and needs no OEM permission to work.
      if (enforcementEnabled) AppBlockWatchdog.schedule(applicationContext)
      heartbeatHandler.postDelayed(this, HEARTBEAT_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    heartbeatHandler.postDelayed(heartbeat, HEARTBEAT_MS)
  }

  override fun onDestroy() {
    heartbeatHandler.removeCallbacks(heartbeat)
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // START_STICKY restarts deliver a null intent — keep the previous value.
    if (intent != null && intent.hasExtra(EXTRA_ENABLED)) {
      enforcementEnabled = intent.getBooleanExtra(EXTRA_ENABLED, true)
    }
    startForeground(NOTIFICATION_ID, buildNotification())
    // Keep the system-side watchdog armed: if this process is killed anyway,
    // the alarm fires and brings the shield (and the process) back.
    AppBlockWatchdog.schedule(applicationContext)
    return START_STICKY
  }

  /**
   * The guardian swiped Wityu out of recents ("fechar todos"). On aggressive
   * OEMs that kills the app's task — but this service lives in its OWN process
   * (`android:process=":shield"` + stopWithTask="false"), so it stays up and
   * the child's phone remains enforced with the app closed. Re-assert anyway.
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    if (enforcementEnabled) {
      AppBlockWatchdog.schedule(applicationContext)
      start(applicationContext, true)
    }
    super.onTaskRemoved(rootIntent)
  }

  private fun buildNotification(): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        getString(R.string.app_block_shield_channel),
        // MIN importance: silent, no status-bar icon clutter on most OEMs —
        // the point is the FGS priority, not user attention.
        NotificationManager.IMPORTANCE_MIN,
      ).apply { setShowBadge(false) }
      nm.createNotificationChannel(channel)
    }

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = if (launchIntent != null) {
      PendingIntent.getActivity(
        this,
        0,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    } else null

    // Reuse the app's push notification icon (expo-notifications generates
    // `notification_icon`); fall back to the launcher icon resource.
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
      .setContentTitle(getString(R.string.app_block_shield_title))
      .setContentText(getString(R.string.app_block_shield_body))
      .setSmallIcon(icon)
      .setOngoing(true)
      .apply { if (contentIntent != null) setContentIntent(contentIntent) }
      .build()
  }
}
