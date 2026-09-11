package expo.modules.appblock

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.provider.Settings

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
 *
 * The exact-vs-inexact choice below is not just about timing precision. Since
 * Android 12, a BroadcastReceiver generally CANNOT call startForegroundService()
 * — which is exactly what AppBlockBootReceiver does on every tick to bring
 * AppBlockShieldService back — unless the triggering event is on Android's
 * documented exemption list (developer.android.com "Restrictions on starting
 * a foreground service from the background"). "Your app invokes an exact
 * alarm" IS on that list; a plain inexact AlarmManager.set() is NOT. Confirmed
 * on-device (Redmi Note 10, Android 12, 2026-09-11) via
 * `dumpsys dropbox --print`: a tick that fell back to the inexact path (no
 * SCHEDULE_EXACT_ALARM permission was declared at the time) produced
 * `Background started FGS: Disallowed ... code:DENIED`, i.e. the watchdog
 * fired but its resurrection attempt was silently thrown away by the OS. The
 * manifest now declares SCHEDULE_EXACT_ALARM (auto-granted on API 31-32 just
 * by declaring it; API 33+ additionally needs the user to grant it via
 * Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM — see
 * AppBlockModule.canScheduleExactAlarms/requestScheduleExactAlarm). Without
 * that grant, schedule() below still degrades to the inexact alarm — timers
 * still fire eventually, but the FGS-start-on-tick will keep getting denied
 * on API 31+, so the watchdog alone can't resurrect the shield after a kill.
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
          // API 31+ without an effective SCHEDULE_EXACT_ALARM grant. Inexact
          // still fires, just later — but per the class doc above, it also
          // means the tick's startForegroundService() call will be denied by
          // the FGS-background-start restriction. Not just a timing downgrade.
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

  /** Whether the exact-alarm exemption from the class doc above is actually
   *  in effect right now. Below API 31 there's no such restriction to begin
   *  with (true). On API 31-32 the SCHEDULE_EXACT_ALARM manifest declaration
   *  alone grants it (true, no user action). On API 33+ the OS additionally
   *  requires the user to grant it via Settings — see
   *  requestScheduleExactAlarm() — since a general parental-control app
   *  doesn't qualify for the alarm-clock/calendar auto-grant categories.
   *  Exposed so the JS layer (AppBlockModule) can show this as a real,
   *  specific gap instead of the watchdog silently degrading. */
  fun canScheduleExactAlarms(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
    return am.canScheduleExactAlarms()
  }

  /** Opens the system "Allow setting alarms and reminders" screen for this
   *  app (API 31+ only — canScheduleExactAlarms() is unconditionally true
   *  below that, so this is never needed there). A visible permission ask:
   *  whether/when to surface it in the UI is a product decision, not made by
   *  this module — it only provides the capability. */
  fun requestScheduleExactAlarm(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    try {
      val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        data = android.net.Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    } catch (e: Exception) {
      // OEM without the standard flow — nothing else to fall back to here.
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
