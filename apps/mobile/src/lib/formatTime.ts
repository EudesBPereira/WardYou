import i18n from "@/i18n";

/**
 * Achado de QA 2026-09-11: "Atividade recente" (app/privacy.tsx) e o
 * `closedLabel` de uma viagem (features/trips/queries.ts) chamavam
 * `toLocaleString()` NU -- sem locale, sem opcoes -- o que usa o idioma do
 * SISTEMA OPERACIONAL do aparelho, nao o idioma que o proprio app escolheu
 * (i18next). Resultado visto em campo: app inteiro em portugues, mas a data
 * saindo em formato americano "9/11/2026, 6:55:14 PM" (M/D/AAAA + AM/PM) --
 * facil de ler "9/11" como 9 de novembro quando e 11 de setembro. Usa o
 * idioma ATUAL do app (i18n.language: "pt"/"en"/"es"/"fr", aceitos como BCP-47
 * validos) em vez de deixar o SO decidir, e forca dia/mes/ano com 2 digitos +
 * hora 24h para nao reintroduzir a mesma ambiguidade de ordem.
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(i18n.language, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

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
  // Mesmo idioma do app, nao o do SO -- ver formatDateTime acima.
  return sameDay
    ? d.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleString(i18n.language, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}
