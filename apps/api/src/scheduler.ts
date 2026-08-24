import { prisma } from "./db.js";
import { ROLE } from "./services/familyService.js";
import { getManagerUserIds } from "./services/elderService.js";
import { AUDIT_ACTION } from "./services/auditService.js";
import { pushToUser, pushToUsers } from "./services/pushService.js";
import { emitToUsers } from "./realtime.js";
import { localParts, localDayStartUtc } from "./lib/localTime.js";

/**
 * Elder-care scheduler: a single in-process 60s ticker (this API runs as one
 * container — no distributed locking needed; if that ever changes, gate this
 * behind a leader election). Everything is push-based so it works with the
 * elder's/caregiver's app closed:
 *
 *  1. Medication reminders — a push to the elder at each configured HH:mm.
 *  2. Check-in reminder    — a push to the elder at ELDER_CHECKIN_REMINDER
 *     (default 09:00 local) if they haven't checked in today.
 *  3. Inactivity alert     — a push to the caregivers at ELDER_INACTIVITY_ALERT
 *     (default 14:00 local) if the elder STILL hasn't checked in.
 *
 * Times are family-local (lib/localTime, env ELDER_TZ). In-memory dedupe keyed
 * by local date — a restart may re-send at most the current minute's batch.
 * Disable entirely with ELDER_SCHEDULER=off (e.g. in tests).
 */

const REMINDER_HHMM = normalizeHhmm(process.env.ELDER_CHECKIN_REMINDER, "09:00");
const ALERT_HHMM = normalizeHhmm(process.env.ELDER_INACTIVITY_ALERT, "14:00");
const TICK_MS = 60_000;

const fired = new Set<string>();
let firedDate = "";
let timer: ReturnType<typeof setInterval> | null = null;

function normalizeHhmm(raw: string | undefined, fallback: string): string {
  return raw && /^\d{2}:\d{2}$/.test(raw.trim()) ? raw.trim() : fallback;
}

function once(key: string, date: string): boolean {
  if (firedDate !== date) {
    fired.clear();
    firedDate = date;
  }
  const full = `${date}:${key}`;
  if (fired.has(full)) return false;
  fired.add(full);
  return true;
}

/** Elder-role members with a real account (userId), deduped. */
async function elderUserIds(): Promise<string[]> {
  const rows = await prisma.family_members.findMany({
    where: { Role: ROLE.elder, UserId: { not: null } },
    select: { UserId: true },
  });
  return [...new Set(rows.map((r) => r.UserId!).filter(Boolean))];
}

async function hasCheckedInToday(elderUserId: string): Promise<boolean> {
  const last = await prisma.audit_logs.findFirst({
    where: {
      ActorUserId: elderUserId,
      Action: AUDIT_ACTION.ElderCheckIn,
      CreatedAt: { gte: localDayStartUtc() },
    },
    select: { Id: true },
  });
  return !!last;
}

async function tickMedications(hhmm: string, dayBit: number, date: string): Promise<void> {
  const meds = await prisma.medication_reminders.findMany({ where: { IsActive: true } });
  for (const med of meds) {
    const times = med.Times.split(",").map((t) => t.trim());
    if (!times.includes(hhmm)) continue;
    // DaysOfWeek 0 = every day (legacy convention), otherwise Monday-bit mask.
    if (med.DaysOfWeek !== 0 && (med.DaysOfWeek & dayBit) === 0) continue;
    if (!once(`med:${med.Id}:${hhmm}`, date)) continue;
    void pushToUser(med.ElderUserId, {
      title: "💊 Hora do remédio",
      body: med.Dosage ? `${med.Name} — ${med.Dosage}` : med.Name,
      data: { type: "elder-medication", medicationId: med.Id, time: hhmm },
      highPriority: true,
    });
  }
}

async function tickCheckIns(hhmm: string, date: string): Promise<void> {
  const isReminder = hhmm === REMINDER_HHMM;
  const isAlert = hhmm === ALERT_HHMM;
  if (!isReminder && !isAlert) return;

  for (const elderId of await elderUserIds()) {
    if (await hasCheckedInToday(elderId)) continue;

    if (isReminder && once(`checkin-reminder:${elderId}`, date)) {
      void pushToUser(elderId, {
        title: "💚 Como você está hoje?",
        body: "Toque para avisar sua família de que está tudo bem.",
        data: { type: "elder-check-in-reminder" },
      });
    }

    if (isAlert && once(`inactivity-alert:${elderId}`, date)) {
      const managers = await getManagerUserIds(elderId);
      if (managers.length === 0) continue;
      const elder = await prisma.users.findFirst({ where: { Id: elderId }, select: { FullName: true } });
      emitToUsers(managers, "ElderInactivityAlert", { elderUserId: elderId });
      void pushToUsers(managers, {
        title: "⚠️ Sem sinal hoje",
        body: `${elder?.FullName ?? "Seu familiar"} ainda não confirmou que está bem hoje. Que tal ligar?`,
        data: { type: "elder-inactivity", elderUserId: elderId },
        highPriority: true,
      });
    }
  }
}

async function tick(): Promise<void> {
  try {
    const { date, hhmm, dayBit } = localParts();
    await tickMedications(hhmm, dayBit, date);
    await tickCheckIns(hhmm, date);
  } catch {
    /* a failed tick never kills the server; next minute retries */
  }
}

export function startElderScheduler(): void {
  if (process.env.ELDER_SCHEDULER?.trim().toLowerCase() === "off") return;
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  // unref so tests / graceful shutdowns aren't held open by the interval.
  timer.unref?.();
}

export function stopElderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
