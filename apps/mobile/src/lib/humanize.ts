/**
 * Last-resort fallback for backend enum-style names (PascalCase, e.g.
 * "ParentalTemporaryAllow") that don't have an explicit i18n entry yet.
 *
 * QA bug: `privacy.tsx` rendered untranslated audit-log actions as the raw
 * enum string next to properly translated ones (e.g. "SOS acionado" beside
 * a bare "ParentalTemporaryAllow"), which read as a broken app. Every
 * *known* action must still get a real translated phrase in
 * `audit.action.*` across all 4 locales — this is only the safety net for
 * an action the backend adds before the client is updated to translate it.
 */
export function humanizePascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}
