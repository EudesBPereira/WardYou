/**
 * "A posição mostrada pode não ser a de agora" — item pedido pelo fundador
 * (2026-09-11) depois de confirmar por código que o rastreamento de
 * localização SÓ existe: (a) durante uma viagem ativa, com a permissão de
 * segundo plano concedida, ou (b) enquanto o app está aberto na Home da
 * criança (heartbeat de 60s via setInterval, morre no fechamento do app).
 * Fora dessas duas janelas, NADA reporta posição — nem um serviço de
 * segundo plano genérico existe para isso (confirmado: só duas
 * TaskManager.defineTask no projeto inteiro, viagem e push, nenhuma de
 * localização solta).
 *
 * Consequência real: o responsável pode abrir o mapa e ver a posição de
 * ONTEM, ao lado de um selo "Online agora" vindo do heartbeat (presença) —
 * dois fatos verdadeiros que, lidos juntos, sugerem um terceiro que é falso
 * ("está aqui agora"). `family/[memberId].tsx` já separa os dois rótulos;
 * isto adiciona o destaque visual que falta quando a posição está velha o
 * bastante pra a suposição de atualidade deixar de ser razoável.
 */

/** Acima disto, uma legenda de "visto às HH:mm" deixa de ser suficiente —
 *  precisa de destaque visual, nao so o timestamp cru. 30min: generoso o
 *  bastante para nao acender por um app fechado ha poucos minutos, apertado
 *  o bastante para nao deixar "a posicao de ontem" passar em silencio. */
export const LOCATION_STALE_THRESHOLD_MS = 30 * 60_000;

export function isLocationStale(capturedAtIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!capturedAtIso) return false; // sem timestamp nenhum: nada a marcar como velho aqui
  const capturedAt = new Date(capturedAtIso).getTime();
  if (Number.isNaN(capturedAt)) return false;
  return now.getTime() - capturedAt > LOCATION_STALE_THRESHOLD_MS;
}
