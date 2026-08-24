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
 * The AccessibilityService itself is re-bound by the system; this only restores
 * the keep-alive shield that stops the process from being killed again.
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
