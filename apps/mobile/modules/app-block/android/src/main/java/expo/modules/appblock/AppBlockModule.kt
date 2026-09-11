package expo.modules.appblock

import android.accessibilityservice.AccessibilityService
import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.text.TextUtils
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONArray
import org.json.JSONObject
import java.io.Serializable
import java.util.Calendar

class EnforcementStateRecord(
  @Field var enabled: Boolean = false,
  @Field var blockAll: Boolean = false,
  @Field var blockedPackages: List<String> = emptyList(),
  @Field var whitelistedPackages: List<String> = emptyList(),
  /** `[{"s":1320,"e":420,"d":127}]` sleep/block-all windows, evaluated natively
   *  so they still fire with the app closed. */
  @Field var hardBlockWindowsJson: String = "[]",
  /** `{"com.pkg": <epochMs>}` temporary allows + deadlines, expired natively. */
  @Field var tempAllowsJson: String = "{}",
  /** Epoch ms deadline of a timed remote pause, as a string ("0" = none —
   *  encoded as a string like the other JSON fields to sidestep any bridge
   *  precision concerns with a 13-digit epoch through a numeric Field).
   *  Evaluated natively (see AppBlockTimeRules.isPauseActive) so a closed
   *  child phone doesn't stay hard-blocked past the guardian's intended
   *  pause duration — see enforcementLogic.ts `pauseDeadlineMillis`. */
  @Field var pauseUntilMillis: String = "0",
) : Record, Serializable

/**
 * JS bridge for the on-device app-blocking enforcement. The JS layer (see
 * apps/mobile/src/features/parental/enforcement.ts) is the source of truth for
 * *what* to block — it evaluates the parental policy fetched from the API
 * against the device's own local clock (so sleep/schedule windows are correct
 * regardless of server timezone) and calls setEnforcementState() roughly once
 * a minute. This module just relays that decision into the SharedPreferences
 * cache the AccessibilityService reads.
 */
class AppBlockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppBlock")

    // Fired by the AccessibilityService's blocked-screen overlay after it
    // queues a request in prefs — tells JS "drain the queue now". JS also
    // drains on app open + on the ChildHome tick, so a missed poke is fine.
    Events("onAppBlockPoke")

    OnCreate {
      AppBlockEventBus.listener = {
        try {
          sendEvent("onAppBlockPoke", emptyMap<String, Any>())
        } catch (e: Exception) {
          // JS runtime not up — queue stays in prefs for the next drain
        }
      }
    }

    OnDestroy {
      AppBlockEventBus.listener = null
    }

    // Returns and clears the pending overlay requests as a JSON array string
    // `[{"type":"access","packageName":"...","label":"..."},{"type":"extra","minutes":30}]`.
    Function("drainPendingRequestsJson") {
      val context = appContext.reactContext ?: return@Function "[]"
      AppBlockPrefs.drainPendingRequests(context)
    }

    // Self-diagnostic of the last blocked-screen overlay attempt, as JSON
    // `{"result":"a11y-overlay|app-overlay|failed: ...","at":<epochMs>}` (empty
    // object if never shown). Lets the setup screen prove the panel rendered.
    Function("lastOverlayResultJson") {
      val context = appContext.reactContext ?: return@Function "{}"
      val result = AppBlockPrefs.lastOverlayResult(context) ?: return@Function "{}"
      JSONObject().put("result", result).put("at", AppBlockPrefs.lastOverlayResultAt(context)).toString()
    }

    // `isServiceEnabled()` only reads Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES —
    // the OS list of services the USER granted. It stays true even after the
    // service PROCESS has crashed: Android's AccessibilityManagerService then
    // marks it "crashed" internally (`dumpsys accessibility` shows it under
    // "Crashed services", bound nowhere) and does NOT retry binding it on its
    // own — the settings list is untouched, so this would keep reporting
    // "protected" while onAccessibilityEvent never fires again and app-block
    // silently stops enforcing. Confirmed on-device (Redmi Note 10, Android 12,
    // 2026-09-11): the service crashed at some point before this session: the
    // only fix was `am force-stop` + re-adding it to the settings list — a
    // user-visible re-grant, not something this process can trigger itself.
    // `instance` (set in onServiceConnected, cleared in onDestroy) is the real
    // liveness signal: non-null only while a bound instance is actually
    // receiving events. Checking both means the child device's own heartbeat
    // (`hasAccessibility`, see childQueries.ts useHeartbeat) and the
    // ChildHome/ProtectionStatusCard UI stop claiming protection is active
    // when the enforcer is actually dead.
    Function("isAccessibilityServiceEnabled") {
      isServiceEnabled() && AppBlockAccessibilityService.instance != null
    }

    Function("openAccessibilitySettings") {
      val context = appContext.reactContext ?: return@Function Unit
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    Function("setEnforcementState") { state: EnforcementStateRecord ->
      val context = appContext.reactContext ?: return@Function Unit
      AppBlockPrefs.write(
        context,
        state.enabled,
        state.blockAll,
        state.blockedPackages,
        state.whitelistedPackages,
        state.hardBlockWindowsJson,
        state.tempAllowsJson,
        state.pauseUntilMillis,
      )
      // The shield FGS tracks enforcement: alive while a policy is enabled,
      // gone the moment the guardian disables it. Keeps the process (and with
      // it the AccessibilityService toggle) alive under OEM task killers.
      if (state.enabled) {
        AppBlockShieldService.start(context)
        AppBlockWatchdog.schedule(context)
      } else {
        AppBlockShieldService.stop(context)
        AppBlockWatchdog.cancel(context)
      }
    }

    // --- Keep-alive / exact-alarm permission (watchdog resurrection) ---
    // Without this, AppBlockWatchdog's AlarmManager tick degrades to an
    // inexact alarm and its startForegroundService() call gets silently
    // denied by Android 12+'s background-FGS-start restriction — confirmed
    // on-device (Redmi Note 10, Android 12, 2026-09-11), see AppBlockWatchdog
    // for the full chain. Auto-granted on API 31-32 by the manifest
    // declaration alone (canScheduleExactAlarms() below is then always true,
    // requestScheduleExactAlarm() a no-op); API 33+ needs this explicit,
    // user-visible grant.

    Function("canScheduleExactAlarms") {
      val context = appContext.reactContext ?: return@Function false
      AppBlockWatchdog.canScheduleExactAlarms(context)
    }

    Function("requestScheduleExactAlarm") {
      val context = appContext.reactContext ?: return@Function Unit
      AppBlockWatchdog.requestScheduleExactAlarm(context)
    }

    // --- Keep-alive / OEM battery-killer hardening ---

    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function false
      val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager ?: return@Function false
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Opens the system "let this app ignore battery optimizations?" dialog.
    // Allowed on Play for parental-control apps (core feature justification).
    Function("requestIgnoreBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function Unit
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = android.net.Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      } catch (e: Exception) {
        // Some OEMs hide this dialog — fall back to the battery settings list.
        try {
          val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(fallback)
        } catch (e2: Exception) {
          // give up silently — guidance card still points the user at Settings
        }
      }
    }

    // --- Uninstall protection (Device Admin) ---
    // While the admin is active Android refuses to uninstall the app, closing
    // the "long-press the icon → Desinstalar" hole on the child's device.

    Function("isDeviceAdminActive") {
      val context = appContext.reactContext ?: return@Function false
      isAdminActive(context)
    }

    // Opens the system's "activate device administrator?" screen, with our
    // honest explanation of what it's for.
    Function("requestDeviceAdmin") {
      val context = appContext.reactContext ?: return@Function Unit
      try {
        val intent = Intent(android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
          putExtra(
            android.app.admin.DevicePolicyManager.EXTRA_DEVICE_ADMIN,
            android.content.ComponentName(context, AppBlockDeviceAdminReceiver::class.java),
          )
          putExtra(
            android.app.admin.DevicePolicyManager.EXTRA_ADD_EXPLANATION,
            context.getString(R.string.app_block_admin_description),
          )
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      } catch (e: Exception) {
        // OEM without the standard flow — the guidance card still explains it
      }
    }

    // True once since the last check if the admin was deactivated (tamper).
    // Consumed by the heartbeat so the guardian gets told even though the app
    // was closed when it happened.
    Function("consumeAdminDisabledFlag") {
      val context = appContext.reactContext ?: return@Function false
      val flagged = AppBlockPrefs.adminDisabledFlag(context)
      if (flagged) AppBlockPrefs.setAdminDisabledFlag(context, false)
      flagged
    }

    // Overlay permission — the fallback path for the blocked-app panel when an
    // OEM suppresses the accessibility overlay (see AppBlockOverlay).
    Function("canDrawOverlays") {
      val context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(context) else true
    }

    Function("requestOverlayPermission") {
      val context = appContext.reactContext ?: return@Function Unit
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function Unit
      try {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          android.net.Uri.parse("package:${context.packageName}"),
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        context.startActivity(intent)
      } catch (e: Exception) {
        try {
          val fallback = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(fallback)
        } catch (e2: Exception) {
          // give up silently
        }
      }
    }

    // MIUI/HyperOS (Xiaomi/Redmi/POCO) need two extra manual switches to keep
    // background services alive: Autostart + unrestricted battery. Detection
    // lets the JS layer show the guidance card only where it applies.
    Function("isAggressiveOem") {
      val brand = (Build.BRAND ?: "").lowercase()
      val manufacturer = (Build.MANUFACTURER ?: "").lowercase()
      listOf("xiaomi", "redmi", "poco", "huawei", "honor", "oppo", "realme", "vivo", "oneplus")
        .any { brand.contains(it) || manufacturer.contains(it) }
    }

    // Best-effort jump straight to the OEM's autostart manager (MIUI Security
    // Center etc.); falls back to the app's own settings page.
    Function("openAutostartSettings") {
      val context = appContext.reactContext ?: return@Function Unit
      val candidates = listOf(
        // MIUI / HyperOS
        Intent().setClassName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
        // Huawei
        Intent().setClassName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        // Oppo/Realme
        Intent().setClassName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        // Vivo
        Intent().setClassName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
      )
      for (intent in candidates) {
        try {
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(intent)
          return@Function Unit
        } catch (e: Exception) {
          // try the next OEM activity
        }
      }
      try {
        val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = android.net.Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(fallback)
      } catch (e: Exception) {
        // ignore
      }
    }

    // Ajustes de LOCALIZACAO do sistema. Diferente da permissao do app: o
    // usuario pode ter concedido a permissao e ter o GPS desligado no aparelho,
    // e ai nada funciona sem que nada avise.
    Function("openLocationSettings") {
      val context = appContext.reactContext ?: return@Function Unit
      try {
        val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      } catch (e: Exception) {
        // ignore
      }
    }

    // App details page — where MIUI keeps "Exibir janelas pop-up em segundo
    // plano" (needed for the blocked screen) and battery saver per-app modes.
    Function("openAppSettings") {
      val context = appContext.reactContext ?: return@Function Unit
      try {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = android.net.Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      } catch (e: Exception) {
        // ignore
      }
    }

    // --- Antifurto (Modo Guarda) screen lock ---
    // Locks the device like the power button (unlock requires the owner's
    // biometrics/device PIN) via the AccessibilityService global action — no
    // Device Admin needed. Requires the WardYou accessibility service to be
    // enabled and Android 9+ (GLOBAL_ACTION_LOCK_SCREEN is API 28).

    Function("canLockScreen") {
      val context = appContext.reactContext
      // Either path works: the a11y global action (API 28+) or, now that we
      // register a device admin with force-lock, DevicePolicyManager.lockNow().
      (Build.VERSION.SDK_INT >= 28 && AppBlockAccessibilityService.instance != null) ||
        (context != null && isAdminActive(context))
    }

    Function("lockScreen") {
      val context = appContext.reactContext
      val service = AppBlockAccessibilityService.instance
      if (Build.VERSION.SDK_INT >= 28 && service != null) {
        if (service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)) return@Function true
      }
      // Fallback via device admin (force-lock policy) — also covers Android < 9.
      if (context != null && isAdminActive(context)) {
        try {
          val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE)
            as? android.app.admin.DevicePolicyManager
          dpm?.lockNow()
          return@Function true
        } catch (e: Exception) {
          return@Function false
        }
      }
      false
    }

    // --- UsageStats (real screen-time tracking) ---

    Function("hasUsageAccess") {
      hasUsageAccess()
    }

    Function("openUsageAccessSettings") {
      val context = appContext.reactContext ?: return@Function Unit
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    // Per-package foreground minutes since local midnight, as a JSON string
    // `[{"packageName":"...","minutes":N}]`. JSON keeps the bridge simple. The
    // JS layer reports this to POST /usage-summary so the server's daily limit
    // actually enforces (remaining=0 → blockAll).
    Function("getUsageTodayJson") {
      getUsageTodayJson()
    }

    // Launchable apps installed on this device, as JSON
    // `[{"packageName":"...","label":"..."}]`. Reported to the backend so the
    // guardian sees the child's real apps (exact package names) and allows/
    // time-limits each one (firewall/allowlist model).
    Function("getInstalledAppsJson") {
      getInstalledAppsJson()
    }
  }

  private fun isAdminActive(context: Context): Boolean {
    return try {
      val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE)
        as? android.app.admin.DevicePolicyManager ?: return false
      dpm.isAdminActive(android.content.ComponentName(context, AppBlockDeviceAdminReceiver::class.java))
    } catch (e: Exception) {
      false
    }
  }

  // Single source of truth for "package -> friendly name", shared by the
  // installed-apps list AND the usage-stats report below. Two independent
  // resolvers (one per collector) is exactly how "com.miui.home" ends up on
  // the guardian's screen instead of "Launcher" — this app had that bug for
  // usage (see getUsageTodayJson) while the installed-apps path already
  // worked. Never returns the raw package: last-resort is a humanized guess.
  private fun resolveLabel(pm: android.content.pm.PackageManager, pkg: String): String {
    val label = try {
      val appInfo = pm.getApplicationInfo(pkg, 0)
      pm.getApplicationLabel(appInfo)?.toString()
    } catch (e: Exception) {
      null
    }
    return if (!label.isNullOrBlank()) label else humanizePackageName(pkg)
  }

  // Last-resort fallback when PackageManager has no label for the package
  // (uninstalled since, restricted profile, OEM quirk). "com.google.foo_bar"
  // -> "Foo bar" — never as good as the real label, but never the raw
  // dotted package id either.
  private fun humanizePackageName(pkg: String): String {
    val last = pkg.substringAfterLast('.').ifBlank { pkg }
    val spaced = last.replace('_', ' ').replace('-', ' ').trim()
    if (spaced.isEmpty()) return pkg
    return spaced.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
  }

  private fun getInstalledAppsJson(): String {
    val context = appContext.reactContext ?: return "[]"
    val pm = context.packageManager
    val seen = HashSet<String>()
    val arr = JSONArray()

    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val activities = try {
      pm.queryIntentActivities(intent, 0)
    } catch (e: Exception) {
      emptyList()
    }
    for (ri in activities) {
      val pkg = ri.activityInfo?.packageName ?: continue
      if (pkg == context.packageName) continue
      if (!seen.add(pkg)) continue
      arr.put(JSONObject().put("packageName", pkg).put("label", resolveLabel(pm, pkg)))
    }

    // Keyboards (IMEs) commonly have NO launcher activity of their own — Gboard's
    // settings open via Settings > Idiomas, not a home-screen icon — so the
    // LAUNCHER query above silently drops them: the child can rack up real
    // screen time on Gboard and the guardian never gets a rule row to allow/
    // limit it, or gets one later with no resolved name. InputMethodManager
    // exposes installed/enabled IMEs directly, no launcher intent needed.
    try {
      val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE)
        as? android.view.inputmethod.InputMethodManager
      for (imi in imm?.enabledInputMethodList ?: emptyList()) {
        val pkg = imi.packageName
        if (pkg == context.packageName || !seen.add(pkg)) continue
        arr.put(JSONObject().put("packageName", pkg).put("label", resolveLabel(pm, pkg)))
      }
    } catch (e: Exception) {
      // best-effort — worst case the IME stays missing from the list, same as before
    }

    return arr.toString()
  }

  private fun hasUsageAccess(): Boolean {
    val context = appContext.reactContext ?: return false
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun getUsageTodayJson(): String {
    val context = appContext.reactContext ?: return "[]"
    if (!hasUsageAccess()) return "[]"
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return "[]"
    val cal = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val start = cal.timeInMillis
    val end = System.currentTimeMillis()
    val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end) ?: return "[]"
    val totals = HashMap<String, Long>()
    for (s in stats) {
      if (s.totalTimeInForeground > 0) {
        totals[s.packageName] = (totals[s.packageName] ?: 0L) + s.totalTimeInForeground
      }
    }
    val pm = context.packageManager
    val arr = JSONArray()
    for ((pkg, ms) in totals) {
      val minutes = (ms / 60000L).toInt()
      if (minutes > 0) {
        // Resolve the friendly name HERE, same as getInstalledAppsJson (see
        // resolveLabel) — this used to be the one collector that skipped it,
        // so the server stored the raw package as AppDisplayName forever
        // (saveUsageSummary only falls back to the package when the client
        // sends nothing at all).
        arr.put(JSONObject().put("packageName", pkg).put("minutes", minutes).put("label", resolveLabel(pm, pkg)))
      }
    }
    return arr.toString()
  }

  private fun isServiceEnabled(): Boolean {
    val context = appContext.reactContext ?: return false
    val expectedComponent = "${context.packageName}/${AppBlockAccessibilityService::class.java.canonicalName}"
    val enabledServices = Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabledServices)
    while (splitter.hasNext()) {
      if (splitter.next().equals(expectedComponent, ignoreCase = true)) return true
    }
    return false
  }
}
