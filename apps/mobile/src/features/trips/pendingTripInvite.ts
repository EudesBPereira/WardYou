import { storage } from "@/lib/storage";

// Achado de QA 2026-09-11: o link de convite de viagem que o servidor gera
// (`wardyou://travel/invite/CODE`, ver apps/api/src/routes/trips.ts) NAO tinha
// NENHUM handler no app -- nao existia `app/travel/invite/[code].tsx`, entao
// tocar no link nao levava a lugar nenhum. Testado ao vivo: o convite chegou
// no destinatario ("Acompanhe meu trajeto no WardYou. Codigo: ... -- wardyou://
// travel/invite/..."), mas o unico caminho que funcionava era digitar o
// codigo manualmente em "Entrar com codigo". Espelha o mecanismo ja existente
// pra convite de familia (pendingInvite.ts / useConsumePendingInvite) -- um
// codigo capturado do deep link ANTES de haver sessao autenticada precisa
// sobreviver ate o login/registro terminar.
const KEY = "wardyou_pending_trip_invite";

export const pendingTripInvite = {
  get: () => storage.getItem(KEY),
  set: (code: string) => storage.setItem(KEY, code),
  clear: () => storage.removeItem(KEY),
};
