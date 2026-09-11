package expo.modules.appblock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Keeps the protection alive without anyone opening the app:
 *  - BOOT_COMPLETED / MY_PACKAGE_REPLACED → restore the shield after a reboot
 *    or an app update.
 *  - Watchdog tick (AlarmManager) → restart the shield if an OEM task killer
 *    took the process down, and re-arm the next tick.
 *
 * The AccessibilityService itself is re-bound by the system WHEN THE PROCESS IS
 * KILLED (a fresh process start rebinds normally bound services). It is NOT
 * re-bound after the service itself CRASHES while the process stays alive:
 * Android's AccessibilityManagerService then parks it in a "crashed" set
 * (visible in `dumpsys accessibility` under "Crashed services") and never
 * retries on its own — confirmed on-device (Redmi Note 10, Android 12,
 * 2026-09-11), where it stayed crashed for the rest of the session with no
 * enforcement happening, `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`
 * still listing it as enabled the whole time. Recovering needs a real
 * re-grant (`am force-stop` + re-adding it to the settings list) — nothing
 * this process can trigger on itself without WRITE_SECURE_SETTINGS. This
 * receiver only restores the keep-alive shield that stops the PROCESS from
 * being killed again; see `AppBlockModule.isAccessibilityServiceEnabled` for
 * the liveness check that now catches the crashed-but-still-enabled case.
 */
class AppBlockBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val known = action == Intent.ACTION_BOOT_COMPLETED ||
      action == Intent.ACTION_MY_PACKAGE_REPLACED ||
      action == "android.intent.action.QUICKBOOT_POWERON" ||
      action == AppBlockWatchdog.ACTION_TICK
    if (!known) return
    if (!AppBlockPrefs.isEnabled(context)) {
      // Protection is off — make sure we're not burning wakeups for nothing.
      if (action == AppBlockWatchdog.ACTION_TICK) AppBlockWatchdog.cancel(context)
      return
    }
    AppBlockShieldService.start(context)
    // Always re-arm: the alarm is a repeating one-shot (see AppBlockWatchdog).
    AppBlockWatchdog.schedule(context)
  }
}
