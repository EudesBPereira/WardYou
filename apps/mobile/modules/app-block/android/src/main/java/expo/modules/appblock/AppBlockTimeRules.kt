package expo.modules.appblock

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Native evaluation of the TIME-dependent parental rules, against the device's
 * own clock. The JS layer still computes the full policy every ~60s, but that
 * decision is a snapshot: with the WardYou app closed (the normal state on a
 * child's phone) nothing re-evaluates it, so a sleep window would never start
 * blocking and a "liberado por 1h" grant would never expire. Both are enforced
 * here instead, so the AccessibilityService alone is a complete enforcer.
 *
 * Mirrors isWithinWindow/hardBlock in enforcementLogic.ts (same Monday-indexed
 * bitmask and overnight handling).
 */
object AppBlockTimeRules {

  /** True when a sleep window / block-all schedule is active right now. */
  fun isHardBlockActive(context: Context, nowMillis: Long = System.currentTimeMillis()): Boolean {
    return try {
      val arr = JSONArray(AppBlockPrefs.hardBlockWindows(context))
      if (arr.length() == 0) return false
      val cal = Calendar.getInstance().apply { timeInMillis = nowMillis }
      val nowMinutes = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
      val todayBit = dayBit(cal.get(Calendar.DAY_OF_WEEK))
      val yesterdayCal = Calendar.getInstance().apply { timeInMillis = nowMillis - 24 * 60 * 60 * 1000L }
      val yesterdayBit = dayBit(yesterdayCal.get(Calendar.DAY_OF_WEEK))
      for (i in 0 until arr.length()) {
        val w = arr.optJSONObject(i) ?: continue
        val start = w.optInt("s", -1)
        val end = w.optInt("e", -1)
        val days = w.optInt("d", 0)
        if (start < 0 || end < 0 || start == end) continue
        val active = if (start < end) {
          (days and todayBit) != 0 && nowMinutes >= start && nowMinutes < end
        } else {
          // Overnight window (e.g. 22:00–07:00): started today, or carried over
          // from yesterday and hasn't reached its end time yet.
          val startedToday = (days and todayBit) != 0 && nowMinutes >= start
          val fromYesterday = (days and yesterdayBit) != 0 && nowMinutes < end
          startedToday || fromYesterday
        }
        if (active) return true
      }
      false
    } catch (e: Exception) {
      false // never block the whole phone because of a parsing bug
    }
  }

  /**
   * True while a TIMED remote pause ("pausar por 30min") hasn't reached its
   * deadline yet. A pause with no duration (indefinite — `pauseUntilMillis`
   * stays 0) is intentionally NOT covered here: it only lifts on an explicit
   * Resume, same as before. Mirrors isHardBlockActive's role for sleep/
   * schedule windows: without this, `AppBlockPrefs.isBlockAll` (the static
   * flag from the last JS sync) would keep hard-blocking forever once its
   * deadline passed, on a child phone that never reopens the app.
   */
  fun isPauseActive(context: Context, nowMillis: Long = System.currentTimeMillis()): Boolean {
    val until = AppBlockPrefs.pauseUntilMillis(context)
    return until > 0L && nowMillis < until
  }

  /** Packages whose temporary allow is STILL valid at `nowMillis`. */
  fun activeTempAllows(context: Context, nowMillis: Long = System.currentTimeMillis()): Set<String> {
    return try {
      val obj = JSONObject(AppBlockPrefs.tempAllows(context))
      val out = HashSet<String>()
      val keys = obj.keys()
      while (keys.hasNext()) {
        val pkg = keys.next()
        if (obj.optLong(pkg, 0L) > nowMillis) out.add(pkg)
      }
      out
    } catch (e: Exception) {
      emptySet()
    }
  }

  /** Expired temporary allows — must stop being treated as whitelisted. */
  fun expiredTempAllows(context: Context, nowMillis: Long = System.currentTimeMillis()): Set<String> {
    return try {
      val obj = JSONObject(AppBlockPrefs.tempAllows(context))
      val out = HashSet<String>()
      val keys = obj.keys()
      while (keys.hasNext()) {
        val pkg = keys.next()
        if (obj.optLong(pkg, 0L) <= nowMillis) out.add(pkg)
      }
      out
    } catch (e: Exception) {
      emptySet()
    }
  }

  /** Calendar.DAY_OF_WEEK (1=Sun..7=Sat) → Monday-indexed bit (bit0=Mon). */
  private fun dayBit(calendarDay: Int): Int {
    val mondayIndexed = (calendarDay + 5) % 7 // Sun(1)->6, Mon(2)->0, ... Sat(7)->5
    return 1 shl mondayIndexed
  }
}
