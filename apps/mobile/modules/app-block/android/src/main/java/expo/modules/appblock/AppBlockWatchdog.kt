package expo.modules.appblock

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

/**
 * Last line of defence for "protection must survive the app being closed".
 *
 * If an OEM task killer (MIUI/HyperOS et al.) kills the whole process, both the
 * RN app AND the shield foreground service go with it. An AlarmManager alarm,
 * however, lives in the SYSTEM — it still fires and wakes our process back up,
 * which restarts the shield and lets the OS rebind the AccessibilityService.
 *
 * Re-armed on every fire (a repeating one-shot) so it can use the
 * allow-while-idle variants that survive Doze — cheap: one wakeup every 15 min,
 * doing nothing but a prefs read when everything is already healthy.
 */
object AppBlockWatchdog {
  const val ACTION_TICK = "com.wardyou.app.APPBLOCK_WATCHDOG"
  // 10 min: short enough that a killed process is back quickly, long enough to
  // stay within the OEM/Doze budget for allow-while-idle alarms. The shield's
  // own 5-min heartbeat covers the "process still alive" case for free.
  private const val INTERVAL_MS = 10 * 60 * 1000L
  private const val REQUEST_CODE = 4213

  fun schedule(context: Context) {
    try {
      val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val pi = pendingIntent(context) ?: return
      val triggerAt = SystemClock.elapsedRealtime() + INTERVAL_MS
      // Exact-while-idle where allowed (we ask for the battery exemption in the
      // setup guide); otherwise the inexact variant still fires, just later.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        try {
          am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
        } catch (e: SecurityException) {
          // Android 12+ without SCHEDULE_EXACT_ALARM — inexact is fine here.
          am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
        }
      } else {
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
      }
    } catch (e: Exception) {
      // best-effort — the shield's START_STICKY and the a11y service self-heal
      // are the other layers
    }
  }

  fun cancel(context: Context) {
    try {
      val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      pendingIntent(context)?.let { am.cancel(it) }
    } catch (e: Exception) {
      // ignore
    }
  }

  private fun pendingIntent(context: Context): PendingIntent? {
    return try {
      val intent = Intent(context, AppBlockBootReceiver::class.java).setAction(ACTION_TICK)
      PendingIntent.getBroadcast(
        context,
        REQUEST_CODE,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    } catch (e: Exception) {
      null
    }
  }
}
