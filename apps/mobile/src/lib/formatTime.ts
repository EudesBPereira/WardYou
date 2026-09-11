/**
 * "HH:mm" for a timestamp from today (device-local calendar day), else
 * "DD/MM, HH:mm".
 *
 * Bug de campo #5: trip member "last seen" always rendered as a bare
 * time-of-day ("Visto às 7:18 PM"), even for a fix reported the previous
 * evening. Next to the current clock that reads as an impossible *future*
 * timestamp instead of what it actually is — a stale, ~20h-old position.
 * Including the date whenever it isn't today removes the illusion.
 */
export function formatSeenAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
