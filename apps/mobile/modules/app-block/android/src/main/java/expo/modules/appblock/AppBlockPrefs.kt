package expo.modules.appblock

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray

private const val PREFS_NAME = "wityu_app_block_prefs"
private const val KEY_ENABLED = "enforcement_enabled"
private const val KEY_BLOCK_ALL = "block_all"
private const val KEY_BLOCKED_PACKAGES = "blocked_packages"
private const val KEY_WHITELISTED_PACKAGES = "whitelisted_packages"

/**
 * Enforcement state cache shared between the JS layer (writer — computes the
 * decision every ~60s from the parental API, in the child device's own local
 * time) and the AccessibilityService (reader — a separate OS-managed process
 * that keeps enforcing the last known decision even if the RN app isn't
 * running). SharedPreferences is the simplest cross-process-safe store for
 * this; there is no sensitive data in it (just package names/booleans).
 */
object AppBlockPrefs {
  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun write(
    context: Context,
    enabled: Boolean,
    blockAll: Boolean,
    blockedPackages: List<String>,
    whitelistedPackages: List<String>,
    hardBlockWindowsJson: String = "[]",
    tempAllowsJson: String = "{}",
  ) {
    prefs(context).edit()
      .putBoolean(KEY_ENABLED, enabled)
      .putBoolean(KEY_BLOCK_ALL, blockAll)
      .putString(KEY_BLOCKED_PACKAGES, JSONArray(blockedPackages).toString())
      .putString(KEY_WHITELISTED_PACKAGES, JSONArray(whitelistedPackages).toString())
      .putString(KEY_HARD_WINDOWS, hardBlockWindowsJson)
      .putString(KEY_TEMP_ALLOWS, tempAllowsJson)
      .apply()
  }

  // Time-dependent rules, evaluated NATIVELY against the device clock so they
  // keep working with the RN app closed (the cached decision alone would freeze
  // in time: a sleep window would never start, and a "liberado por 1h" grant
  // would never expire — a real hole while the app is killed).
  private const val KEY_HARD_WINDOWS = "hard_block_windows"
  private const val KEY_TEMP_ALLOWS = "temp_allows"

  /** `[{"s":1320,"e":420,"d":127}]` — start/end in minutes since midnight,
   *  `d` = days bitmask (bit0=Mon). Any active window ⇒ hard block. */
  fun hardBlockWindows(context: Context): String =
    prefs(context).getString(KEY_HARD_WINDOWS, null) ?: "[]"

  /** `{"com.pkg": <epochMs>}` — temporary allows and their deadlines. */
  fun tempAllows(context: Context): String =
    prefs(context).getString(KEY_TEMP_ALLOWS, null) ?: "{}"

  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

  fun isBlockAll(context: Context): Boolean = prefs(context).getBoolean(KEY_BLOCK_ALL, false)

  fun blockedPackages(context: Context): Set<String> =
    toSet(prefs(context).getString(KEY_BLOCKED_PACKAGES, null))

  fun whitelistedPackages(context: Context): Set<String> =
    toSet(prefs(context).getString(KEY_WHITELISTED_PACKAGES, null))

  private fun toSet(json: String?): Set<String> {
    if (json.isNullOrEmpty()) return emptySet()
    return try {
      val arr = JSONArray(json)
      (0 until arr.length()).map { arr.getString(it) }.toSet()
    } catch (e: Exception) {
      emptySet()
    }
  }

  // --- Pending child requests (blocked-screen overlay → JS → API) ---
  // The overlay can't call the API (no auth session in native land); it queues
  // here and the JS layer drains + posts. Capped so a button-mashing kid can't
  // grow the prefs unbounded; the server throttles duplicates anyway.

  private const val KEY_PENDING_REQUESTS = "pending_requests"
  private const val MAX_PENDING = 20

  @Synchronized
  fun queuePendingRequest(context: Context, type: String, packageName: String?, label: String?, minutes: Int?) {
    try {
      val arr = try {
        JSONArray(prefs(context).getString(KEY_PENDING_REQUESTS, null) ?: "[]")
      } catch (e: Exception) {
        JSONArray()
      }
      if (arr.length() >= MAX_PENDING) return
      val obj = org.json.JSONObject().put("type", type)
      if (packageName != null) obj.put("packageName", packageName)
      if (label != null) obj.put("label", label)
      if (minutes != null) obj.put("minutes", minutes)
      arr.put(obj)
      prefs(context).edit().putString(KEY_PENDING_REQUESTS, arr.toString()).apply()
    } catch (e: Exception) {
      // best-effort
    }
  }

  @Synchronized
  fun drainPendingRequests(context: Context): String {
    val json = prefs(context).getString(KEY_PENDING_REQUESTS, null) ?: "[]"
    prefs(context).edit().remove(KEY_PENDING_REQUESTS).apply()
    return json
  }

  // --- Overlay self-diagnostic ---
  // The last blocked-screen overlay outcome ("a11y-overlay" / "app-overlay" /
  // "failed: ...") + when. Lets the setup screen confirm the panel actually
  // rendered on this exact device/OEM, turning a subjective "did it appear?"
  // into a hard signal.
  private const val KEY_OVERLAY_RESULT = "overlay_result"
  private const val KEY_OVERLAY_AT = "overlay_result_at"

  fun setLastOverlayResult(context: Context, result: String) {
    prefs(context).edit()
      .putString(KEY_OVERLAY_RESULT, result)
      .putLong(KEY_OVERLAY_AT, System.currentTimeMillis())
      .apply()
  }

  fun lastOverlayResult(context: Context): String? = prefs(context).getString(KEY_OVERLAY_RESULT, null)

  fun lastOverlayResultAt(context: Context): Long = prefs(context).getLong(KEY_OVERLAY_AT, 0L)

  // --- Device admin tamper flag ---
  // Set when the device-admin (uninstall protection) is deactivated. Survives
  // in prefs because the RN app is usually closed when it happens; the next
  // heartbeat forwards it to the guardian.
  private const val KEY_ADMIN_DISABLED = "admin_disabled"

  fun setAdminDisabledFlag(context: Context, disabled: Boolean) {
    prefs(context).edit().putBoolean(KEY_ADMIN_DISABLED, disabled).apply()
  }

  fun adminDisabledFlag(context: Context): Boolean = prefs(context).getBoolean(KEY_ADMIN_DISABLED, false)
}
