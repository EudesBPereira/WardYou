package expo.modules.appblock

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

/**
 * Device Admin registration — the only thing that stops a child from simply
 * long-pressing the WardYou icon and tapping "Desinstalar": while an app is an
 * active device administrator, Android REFUSES to uninstall it (the option
 * fails with "this app is a device administrator"). Deactivating it first is a
 * deliberate, multi-step trip into Settings → Security → Device admin apps,
 * which we warn about and report to the guardian.
 *
 * Policies requested are deliberately minimal (force-lock only — also reused by
 * the antifurto "lock the phone" flow); no wipe, no password control, nothing
 * that could brick the child's device.
 */
class AppBlockDeviceAdminReceiver : DeviceAdminReceiver() {

  override fun onEnabled(context: Context, intent: Intent) {
    super.onEnabled(context, intent)
    AppBlockPrefs.setAdminDisabledFlag(context, false)
  }

  /** Shown by the system when someone tries to deactivate the admin. */
  override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
    return context.getString(R.string.app_block_admin_disable_warning)
  }

  override fun onDisabled(context: Context, intent: Intent) {
    super.onDisabled(context, intent)
    // Protection was weakened: flag it so the next heartbeat tells the guardian
    // (the RN app may well be closed right now — the flag survives in prefs).
    AppBlockPrefs.setAdminDisabledFlag(context, true)
  }
}
