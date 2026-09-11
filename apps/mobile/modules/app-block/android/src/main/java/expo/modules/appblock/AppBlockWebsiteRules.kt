package expo.modules.appblock

/**
 * Pure host/domain matching for the parental "blocked websites" feature.
 * Deliberately mirrors
 * apps/mobile/src/features/parental/websiteBlocking.ts (extractHost /
 * isHostBlocked) LINE FOR LINE — that TS file is the tested spec (see
 * websiteBlocking.test.ts, run under plain `node --test`, no device needed);
 * this Kotlin copy is what actually enforces it on-device, off the browser's
 * address-bar text read via AccessibilityService. If you change the matching
 * rule in one place, change it in the other or the two diverge silently.
 */
object AppBlockWebsiteRules {

  /**
   * Pulls a bare host out of whatever text a browser's address bar is
   * currently showing — a full URL, just a host, or a typed search query —
   * or null when there's nothing URL-shaped to check (a plain search query
   * with no dot, an empty/placeholder bar like "Pesquisar ou digitar URL").
   */
  fun extractHost(raw: String?): String? {
    if (raw.isNullOrBlank()) return null
    var h = raw.trim().lowercase()
    if (h.contains(' ')) return null // "melhores memes 2026" — a search, not a URL
    h = h.replaceFirst(Regex("^[a-z][a-z0-9+.-]*://"), "") // strip scheme
    val at = h.indexOf('@')
    if (at >= 0) h = h.substring(at + 1) // strip userinfo (user:pass@host)
    val cut = h.indexOfFirst { it == '/' || it == '?' || it == '#' }
    if (cut >= 0) h = h.substring(0, cut) // strip path/query/fragment
    val colon = h.lastIndexOf(':')
    if (colon > 0 && h.substring(colon + 1).all { it.isDigit() }) h = h.substring(0, colon) // strip :port
    if (h.isEmpty() || !h.contains('.')) return null // no TLD-shaped tail — not a real host
    return h
  }

  /**
   * True if `host` is `domain` itself or any subdomain of it. "g1.com.br"
   * matches "www.g1.com.br" and "m.g1.com.br" (subdomains), but never
   * "naog1.com.br" (a different registrable domain that merely contains the
   * string) — the whole point of comparing on a `.`-boundary suffix instead
   * of a raw substring/`contains()` check.
   */
  fun isHostBlocked(host: String, blockedDomains: Collection<String>): Boolean {
    val h = host.trim().lowercase().removePrefix("www.")
    if (h.isEmpty()) return false
    for (raw in blockedDomains) {
      val d = raw.trim().lowercase().removePrefix("www.")
      if (d.isEmpty()) continue
      if (h == d || h.endsWith(".$d")) return true
    }
    return false
  }
}
