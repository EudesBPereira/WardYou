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
 * still listing it as enabled the whole time.
 *
 * Read against current AOSP (frameworks/base,
 * AccessibilityManagerService#updateServicesLocked): a component sitting in
 * `mCrashedServices` is unconditionally skipped — the system won't even
 * attempt to bind it again — regardless of whether it's still in the enabled
 * list. Only three call sites ever remove a component from that set:
 * `onPackageRemovedLocked` (the package is uninstalled), `onPackageUpdateFinished`
 * (the package is reinstalled/updated — meaning a Play Store update, not just
 * an app relaunch, self-heals this), and `onPackagesForceStoppedLocked` (a
 * real `force-stop`, which is what fixed it in the field test). None of the
 * three is reachable by this app on itself: no public API lets an app
 * uninstall/update/force-stop itself, and the settings-list rewrite this
 * receiver's siblings can do doesn't touch `mCrashedServices` at all — so
 * merely toggling the accessibility switch off/on WITHOUT an intervening
 * force-stop or reboot does NOT recover it (a natural thing to try first;
 * confirmed not to work by this same code path). The only user-reachable
 * fixes are Settings → Apps → WardYou → Force stop, or a device reboot
 * (which reinitializes AccessibilityManagerService's state from scratch).
 * There is no in-app recovery — this is a hard Android platform limit, not a
 * gap in this code.
 *
 * This receiver only restores the keep-alive shield that stops the PROCESS
 * from being killed again (which reduces how often a crash like this gets
 * triggered in the first place — see AppBlockShieldService's manifest entry
 * for the 2026-09-11 process-alignment fix); it cannot undo a crash that
 * already happened. See `AppBlockModule.isAccessibilityServiceEnabled` for
 * the liveness check that catches the crashed-but-still-enabled case so the
 * app and guardian are told honestly instead of assuming protection holds.
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
