// Pure host/domain matching for the parental "blocked websites" feature — zero
// React Native / native-module imports, so it runs under a plain Node test
// runner (see websiteBlocking.test.ts), same pattern as enforcementLogic.ts.
//
// This is the SPEC, not the enforcer: the actual blocking decision happens
// on-device, natively, in Kotlin (AppBlockWebsiteRules.kt,
// apps/mobile/modules/app-block/android/src/main/java/expo/modules/appblock/),
// because it has to run off the browser's address-bar text read via
// AccessibilityService — there is no ~60s JS sync loop involved here, unlike
// app-level enforcement. AppBlockWebsiteRules.kt deliberately mirrors the two
// functions below line-for-line; if you change the matching rule here, change
// it there too (and vice versa) or the two enforcement paths silently diverge.

/**
 * Pulls a bare host out of whatever text a browser's address bar is showing —
 * a full URL, just a host, or a typed search query — or `null` when there's
 * nothing URL-shaped to check (a plain search query with no dot, an empty or
 * placeholder bar like "Pesquisar ou digitar URL").
 */
export function extractHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let h = raw.trim().toLowerCase();
  if (!h || h.includes(" ")) return null; // "melhores memes 2026" — a search, not a URL
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
  const at = h.indexOf("@");
  if (at >= 0) h = h.slice(at + 1); // strip userinfo (user:pass@host)
  const cut = h.search(/[/?#]/);
  if (cut >= 0) h = h.slice(0, cut); // strip path/query/fragment
  const colon = h.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(h.slice(colon + 1))) h = h.slice(0, colon); // strip :port
  if (!h || !h.includes(".")) return null; // no TLD-shaped tail — not a real host
  return h;
}

/**
 * True if `host` is `domain` itself or any subdomain of it. "g1.com.br"
 * matches "www.g1.com.br" and "m.g1.com.br" (subdomains), but never
 * "naog1.com.br" (a different registrable domain that merely contains the
 * string) — the whole point of comparing on a `.`-boundary suffix instead of
 * a raw substring/`includes()` check.
 */
export function isHostBlocked(host: string, blockedDomains: string[]): boolean {
  const h = host.trim().toLowerCase().replace(/^www\./, "");
  if (!h) return false;
  for (const raw of blockedDomains) {
    const d = raw.trim().toLowerCase().replace(/^www\./, "");
    if (!d) continue;
    if (h === d || h.endsWith(`.${d}`)) return true;
  }
  return false;
}
