package expo.modules.appblock

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.net.Uri
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Enforces WardYou's parental app-blocking policy on-device. Soft enforcement
 * only: when a blocked (or, in firewall/block-all mode, any non-allowed)
 * package comes to the foreground, it sends the user Home. No Device Admin /
 * real lock (out of scope).
 *
 * Firewall mode = block-all + a whitelist of allowed apps. To avoid bricking
 * the phone (and an infinite Home loop) it ALWAYS allows a small set of
 * essentials — the launcher itself, the dialer, Settings and system UI — on top
 * of WardYou and whatever the guardian allowed.
 *
 * Website blocking (added 2026-09-11): for a recognized browser app, also
 * reads the browser's OWN address-bar text (never page content, passwords, or
 * anything typed into a page) via canRetrieveWindowContent, and Home-kicks the
 * same way when it matches a blocked domain — independent of whether the
 * browser app itself is allowed, since the point is to allow the browser but
 * block specific sites inside it. See checkBlockedWebsite() below for the
 * documented limits of this approach (incognito tabs, in-app webviews,
 * unrecognized browsers are NOT reliably covered).
 */
class AppBlockAccessibilityService : AccessibilityService() {
  private var essentials: Set<String>? = null

  // Apps capable of opening a web link — i.e. installed browsers, discovered
  // dynamically via PackageManager instead of a hardcoded list, so a browser
  // this code doesn't recognize by resource id is still IN SCOPE for
  // detection (best-effort fallback in findAddressBarText), just not
  // guaranteed to match. Resolved once and cached, like essentialAllow().
  private var browsers: Set<String>? = null

  // Debounce for the website check: TYPE_WINDOW_CONTENT_CHANGED fires in
  // bursts while a page loads (title, favicon, layout all changing); walking
  // the node tree on every single one is wasteful.
  private var lastWebsiteCheckAt: Long = 0L

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

    /** Best-effort map of browser package → its address bar's resource id.
     *  Chrome/Firefox/Edge confirmed against public documentation and
     *  community references; Samsung Internet/Opera/DuckDuckGo are lower
     *  confidence (not independently verified on a real device) — a wrong or
     *  stale id here just falls through to findUrlLikeNodeText's generic
     *  scan, it never crashes. Extend as new browsers are confirmed. */
    private val KNOWN_ADDRESS_BAR_IDS = mapOf(
      "com.android.chrome" to "url_bar",
      "com.chrome.beta" to "url_bar",
      "com.chrome.dev" to "url_bar",
      "com.chrome.canary" to "url_bar",
      "com.microsoft.emmx" to "url_bar", // Edge — Chromium-based, same id
      "com.brave.browser" to "url_bar", // Brave — Chromium-based, same id
      "com.opera.browser" to "url_field",
      "com.opera.browser.beta" to "url_field",
      "com.opera.mini.native" to "url_field",
      "org.mozilla.firefox" to "mozac_browser_toolbar_url_view",
      "org.mozilla.firefox_beta" to "mozac_browser_toolbar_url_view",
      "org.mozilla.fenix" to "mozac_browser_toolbar_url_view",
      "org.mozilla.focus" to "mozac_browser_toolbar_url_view",
      "com.duckduckgo.mobile.android" to "omnibarTextInput",
      "com.sec.android.app.sbrowser" to "location_bar_edit_text",
    )
  }

  /** Throttle for the "is the shield still up?" check in onAccessibilityEvent. */
  private var lastShieldCheckAt: Long = 0L

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    // The shield (and its watchdog) must NOT depend on the RN app being alive:
    // the guardian closes WardYou, the OEM kills the process, and enforcement
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

    if (event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
      // TYPE_WINDOW_CONTENT_CHANGED fires for EVERY foreground app's UI
      // updates (typing, scrolling, a video's progress bar) — far too chatty
      // to run the full app-level evaluation below on every one. Route it
      // through the website check ONLY (a cheap set lookup for anything
      // that isn't a browser), and leave the rest of this method — the
      // app-level enforcement — gated to TYPE_WINDOW_STATE_CHANGED, exactly
      // as before this feature existed.
      if (essentialAllow().contains(packageName)) return
      if (browserPackages().contains(packageName)) checkBlockedWebsite(packageName)
      return
    }

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

    // Website block, checked on the window-state-changed transition too (a
    // blocked tab already showing the instant the browser comes to the
    // foreground, without waiting for the first content-changed tick).
    // Independent of the app-level checks below: a browser can be a fully
    // allowed app and still have specific sites blocked inside it.
    if (browserPackages().contains(packageName) && checkBlockedWebsite(packageName)) return

    // Time rules re-evaluated natively on every event (device clock), so they
    // hold with the RN app closed — the cached JS decision alone would freeze:
    // a sleep window would never start, a temp allow would never expire, and
    // (since 2026-09-11) a TIMED remote pause would never lift. This is now
    // load-bearing, not just a self-heal nicety: enforcementLogic.ts stops
    // collapsing `whitelistedPackages` to a stale snapshot for hard-block
    // causes that are natively self-checkable (sleep window, schedule
    // block-all window, timed pause), relying on THIS check to gate them
    // instead — so it must cover every one of those causes, or a normally
    // whitelisted app would be let straight through during an active one.
    val hardBlockNow = AppBlockTimeRules.isHardBlockActive(applicationContext) ||
      AppBlockTimeRules.isPauseActive(applicationContext)
    val tempAllowed = AppBlockTimeRules.activeTempAllows(applicationContext)
    val expiredTemp = AppBlockTimeRules.expiredTempAllows(applicationContext)

    if (tempAllowed.contains(packageName)) return // temp grant pierces even a hard block

    val whitelisted = AppBlockPrefs.whitelistedPackages(applicationContext).contains(packageName) &&
      !expiredTemp.contains(packageName) // an expired grant is no longer a pass
    // During sleep/schedule the whitelist collapses (only WardYou + live temp
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

  // --- Website blocking -----------------------------------------------
  //
  // HONEST SCOPE (read this before trusting a "site blocked" claim on a real
  // device): this reads a browser's OWN address bar via accessibility, the
  // same technique competitor apps (Kids360 etc.) use. It has real holes:
  //  - An unrecognized browser (not in KNOWN_ADDRESS_BAR_IDS) falls back to a
  //    heuristic scan (findUrlLikeNodeText) that may miss or, rarely, grab
  //    the wrong node.
  //  - A private/incognito tab was NOT verified on-device to be covered or
  //    not — Chrome's incognito blocks SCREENSHOTS (FLAG_SECURE-like), but
  //    that is a different mechanism than hiding content from an
  //    accessibility service, and nothing found says Chrome does the latter
  //    for its own address bar. Treat as "probably still works" until
  //    confirmed on a real device, not as guaranteed.
  //  - A site opened inside ANOTHER app's built-in browser (e.g. Instagram's
  //    in-app webview) is NOT covered at all — that surface has no
  //    "address bar" node of the kind this scans for, and the foreground
  //    package is the social app, not a browser we watch.
  //  - There is an inherent RACE: the address bar updates as soon as
  //    navigation starts, but the network fetch/page paint happens in
  //    parallel — a fast/cached page can render before this service's
  //    Home-kick lands. This is a "kick out fast", not a "never see it" guarantee.
  // See websites.tsx for the same disclosure surfaced to the guardian.

  private fun checkBlockedWebsite(packageName: String): Boolean {
    val blocked = AppBlockPrefs.blockedWebsites(applicationContext)
    if (blocked.isEmpty()) return false
    val now = System.currentTimeMillis()
    if (now - lastWebsiteCheckAt < 300L) return false // debounce content-changed bursts
    lastWebsiteCheckAt = now
    val root = rootInActiveWindow ?: return false
    try {
      val barText = findAddressBarText(root, packageName) ?: return false
      val host = AppBlockWebsiteRules.extractHost(barText) ?: return false
      if (!AppBlockWebsiteRules.isHostBlocked(host, blocked)) return false
      showBlockedOverlay(packageName) { performGlobalAction(GLOBAL_ACTION_HOME) }
      return true
    } finally {
      root.recycle()
    }
  }

  /** Apps capable of opening a web link — i.e. installed browsers. Resolved
   *  via PackageManager (not a hardcoded package list) so an unmapped browser
   *  is still IN SCOPE for the fallback heuristic below, just not guaranteed
   *  to match by resource id. Cached like essentialAllow(). */
  private fun browserPackages(): Set<String> {
    browsers?.let { return it }
    val pm = applicationContext.packageManager
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"))
    val set = try {
      pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        .mapNotNull { it.activityInfo?.packageName }
        .toHashSet()
    } catch (e: Exception) {
      HashSet()
    }
    browsers = set
    return set
  }

  /** Reads the current address-bar text for a known browser by its resource
   *  id (fast: an indexed lookup, not a tree walk), or falls back to a
   *  bounded heuristic scan for one this map doesn't cover. */
  private fun findAddressBarText(root: AccessibilityNodeInfo, packageName: String): String? {
    val knownId = KNOWN_ADDRESS_BAR_IDS[packageName]
    if (knownId != null) {
      val nodes = try {
        root.findAccessibilityNodeInfosByViewId("$packageName:id/$knownId")
      } catch (e: Exception) {
        null
      }
      try {
        val text = nodes?.firstOrNull()?.text?.toString()
        if (!text.isNullOrBlank()) return text
      } finally {
        nodes?.forEach { it.recycle() }
      }
    }
    return findUrlLikeNodeText(root)
  }

  /** Best-effort fallback for a browser not in KNOWN_ADDRESS_BAR_IDS: scans
   *  the visible tree for an editable node sitting in the top ~20% of the
   *  screen whose text is URL-shaped. Bounded by both depth and a total
   *  node-visit budget so a page's own (potentially huge, since
   *  canRetrieveWindowContent is now on) accessibility tree can't make this
   *  expensive — worst case ~400 cheap node visits, and it stops at the
   *  first match. */
  private fun findUrlLikeNodeText(root: AccessibilityNodeInfo): String? {
    val budget = intArrayOf(400)
    return scanForUrlNode(root, depth = 0, budget = budget)
  }

  private fun scanForUrlNode(node: AccessibilityNodeInfo, depth: Int, budget: IntArray): String? {
    if (depth > 12 || budget[0] <= 0) return null
    budget[0]--
    val className = node.className?.toString()
    if (node.isEditable || className == "android.widget.EditText") {
      val text = node.text?.toString()
      if (!text.isNullOrBlank()) {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        val topBand = applicationContext.resources.displayMetrics.heightPixels / 5
        if (bounds.top in 0 until topBand && AppBlockWebsiteRules.extractHost(text) != null) return text
      }
    }
    for (i in 0 until node.childCount) {
      val child = node.getChild(i) ?: continue
      try {
        val found = scanForUrlNode(child, depth + 1, budget)
        if (found != null) return found
      } finally {
        child.recycle()
      }
      if (budget[0] <= 0) return null
    }
    return null
  }

  override fun onInterrupt() {}
}
