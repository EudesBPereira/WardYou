package expo.modules.appblock

/**
 * One-way "poke" channel from the AccessibilityService (separate lifecycle,
 * same process) to the AppBlockModule instance, which forwards it to JS as an
 * event. The payload itself travels via the AppBlockPrefs pending-request
 * queue — the poke only says "there's something to drain", so a missed poke
 * (JS runtime dead) costs nothing: the queue is also drained on app open and
 * on the ChildHome tick.
 */
object AppBlockEventBus {
  @Volatile
  var listener: (() -> Unit)? = null

  fun poke() {
    try {
      listener?.invoke()
    } catch (e: Exception) {
      // JS side gone — queue survives in prefs
    }
  }
}
