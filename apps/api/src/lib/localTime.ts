/**
 * Family-local time helpers. The legacy schema stores no per-user timezone, so
 * "today", medication times and reminder hours are evaluated in a single
 * configurable timezone (env ELDER_TZ, default America/Sao_Paulo — the
 * product's launch market). All helpers lean on Intl so DST is handled by ICU.
 */

const TZ = process.env.ELDER_TZ?.trim() || "America/Sao_Paulo";

interface LocalParts {
  /** "YYYY-MM-DD" in the local timezone. */
  date: string;
  /** "HH:mm" in the local timezone. */
  hhmm: string;
  /** Monday-indexed day bit (bit0=Mon … bit6=Sun) — matches DaysOfWeek masks. */
  dayBit: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hour12: false,
});

const WEEKDAY_BIT: Record<string, number> = {
  Mon: 1 << 0,
  Tue: 1 << 1,
  Wed: 1 << 2,
  Thu: 1 << 3,
  Fri: 1 << 4,
  Sat: 1 << 5,
  Sun: 1 << 6,
};

export function localParts(now: Date = new Date()): LocalParts {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // Intl may render midnight as "24" with hour12:false — normalize.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${hour}:${parts.minute}`,
    dayBit: WEEKDAY_BIT[parts.weekday] ?? 0,
  };
}

/** UTC instant of the local day's start (local midnight) for `now`. */
export function localDayStartUtc(now: Date = new Date()): Date {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const elapsedMs =
    hour * 3_600_000 + Number(parts.minute) * 60_000 + Number(parts.second) * 1_000;
  return new Date(now.getTime() - elapsedMs - now.getMilliseconds());
}
