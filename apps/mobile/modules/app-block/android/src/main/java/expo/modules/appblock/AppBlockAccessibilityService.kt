package expo.modules.appblock

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

/**
 * Enforces Wityu's parental app-blocking policy on-device. Soft enforcement
 * only: when a blocked (or, in firewall/block-all mode, any non-allowed)
 * package comes to the foreground, it sends the user Home. No Device Admin /
 * real lock (out of scope).
 *
 * Firewall mode = block-all + a whitelist of allowed apps. To avoid bricking
 * the phone (and an infinite Home loop) it ALWAYS allows a small set of
 * essentials — the launcher itself, the dialer, Settings and system UI — on top
 * of Wityu and whatever the guardian allowed. Only reads the foreground package
 * name; never screen content, never sends anything off-device.
 */
class AppBlockAccessibilityService : AccessibilityService() {
  private var essentials: Set<String>? = null

  // Debounce for the blocked-screen launch: kicking to Home is instant and
  // repeats freely, but relaunching our "app blocked" screen for every
  // accessibility event would spam the task stack (events fire in bursts).
  private var lastBlockedLaunchPkg: String? = null
  private var lastBlockedLaunchAt: Long = 0L

  companion object {
    /**
     * Live instance while the service is bound, so AppBlockModule can invoke
     * performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN) for the antifurto "lock
     * the phone after a snatch" flow (Modo Guarda). Volatile: written from the
     * service lifecycle thread, read from the JS bridge thread.
     */
    @Volatile
    var instance: AppBlockAccessibilityService? = null
      private set
  }

  /** Throttle for the "is the shield still up?" check in onAccessibilityEvent. */
  private var lastShieldCheckAt: Long = 0L

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    // The shield (and its watchdog) must NOT depend on the RN app being alive:
    // the guardian closes Wityu, the OEM kills the process, and enforcement
    // used to die with it. This service is OS-bound and survives/rebinds on its
    // own, so IT is the right owner of the keep-alive — start both from here
    // whenever a policy is active. Idempotent.
    if (AppBlockPrefs.isEnabled(applicationContext)) {
      AppBlockShieldService.start(applicationContext)
      AppBlockWatchdog.schedule(applicationContext)
    }
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    AppBlockOverlay.hide(this)
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val packageName = event?.packageName?.toString() ?: return
    if (packageName == applicationContext.packageName) return
    if (!AppBlockPrefs.isEnabled(applicationContext)) return

    // Cheap self-heal (throttled to 1/min): if an OEM task killer stopped the
    // shield/watchdog while this service kept running, bring them back. This
    // runs on real user activity, so it costs nothing when the phone is idle.
    val nowMs = System.currentTimeMillis()
    if (nowMs - lastShieldCheckAt > 60_000L) {
      lastShieldCheckAt = nowMs
      AppBlockShieldService.start(applicationContext)
      AppBlockWatchdog.schedule(applicationContext)
    }
    if (essentialAllow().contains(packageName)) return

    // Time rules re-evaluated natively on every event (device clock), so they
    // hold with the RN app closed — the cached JS decision alone would freeze:
    // a sleep window would never start and a temp allow would never expire.
    val hardBlockNow = AppBlockTimeRules.isHardBlockActive(applicationContext)
    val tempAllowed = AppBlockTimeRules.activeTempAllows(applicationContext)
    val expiredTemp = AppBlockTimeRules.expiredTempAllows(applicationContext)

    if (tempAllowed.contains(packageName)) return // temp grant pierces even a hard block

    val whitelisted = AppBlockPrefs.whitelistedPackages(applicationContext).contains(packageName) &&
      !expiredTemp.contains(packageName) // an expired grant is no longer a pass
    // During sleep/schedule the whitelist collapses (only Wityu + live temp
    // allows survive) — same rule as computeEnforcementState's hardBlock.
    if (whitelisted && !hardBlockNow) return

    val shouldBlock = hardBlockNow ||
      AppBlockPrefs.isBlockAll(applicationContext) ||
      AppBlockPrefs.blockedPackages(applicationContext).contains(packageName)

    if (shouldBlock) {
      // Overlay FIRST, then Home. Order matters on MIUI/HyperOS: going Home
      // starts a window transition, and adding a window DURING that transition
      // is what throws BadTokenException / gets the overlay dismissed. Adding
      // it over the (still-stable) blocked app's window, then kicking Home as a
      // backstop, avoids that race. The overlay (accessibility type) stays on
      // top through the Home transition, so the block is still enforced.
      // `onShown` fires after the add attempt (success or fail) → Home always
      // runs, so enforcement never depends on the overlay succeeding.
      showBlockedOverlay(packageName) { performGlobalAction(GLOBAL_ACTION_HOME) }
    }
  }

  /** Shows the native "app blocked" overlay, then runs `onShown` (used to kick
   *  Home as a backstop after the overlay has attached). Debounced per package
   *  so event bursts from a single launch attempt don't re-animate it — but the
   *  backstop still fires each time so a debounced repeat is never left
   *  un-blocked. */
  private fun showBlockedOverlay(blockedPkg: String, onShown: () -> Unit) {
    val now = System.currentTimeMillis()
    if (blockedPkg == lastBlockedLaunchPkg && now - lastBlockedLaunchAt < 5000L) {
      onShown()
      return
    }
    lastBlockedLaunchPkg = blockedPkg
    lastBlockedLaunchAt = now
    val pm = applicationContext.packageManager
    val label = try {
      pm.getApplicationLabel(pm.getApplicationInfo(blockedPkg, 0)).toString()
    } catch (e: Exception) {
      blockedPkg
    }
    AppBlockOverlay.show(this, blockedPkg, label, onShown)
  }

  /** Never-block set: the launcher, dialer, Settings, system UI + our own app.
   *  Resolved once and cached (perf; onAccessibilityEvent fires constantly). */
  private fun essentialAllow(): Set<String> {
    essentials?.let { return it }
    val pm = applicationContext.packageManager
    val set = HashSet<String>()
    set.add(applicationContext.packageName)
    set.add("com.android.systemui")
    set.add("android")
    resolvePackage(pm, Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))?.let { set.add(it) }
    resolvePackage(pm, Intent(Intent.ACTION_DIAL))?.let { set.add(it) }
    resolvePackage(pm, Intent("android.intent.action.CALL_BUTTON"))?.let { set.add(it) }
    // Settings itself must never be blocked — otherwise, once firewall mode is on,
    // there is no way to get back into Accessibility/Usage-Access settings to fix
    // permissions. Resolved via intent (not hardcoded "com.android.settings") since
    // OEM skins (Samsung, Xiaomi, etc.) ship their own Settings package.
    resolvePackage(pm, Intent(Settings.ACTION_SETTINGS))?.let { set.add(it) }
    essentials = set
    return set
  }

  private fun resolvePackage(pm: PackageManager, intent: Intent): String? {
    return try {
      pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
    } catch (e: Exception) {
      null
    }
  }

  override fun onInterrupt() {}
}
