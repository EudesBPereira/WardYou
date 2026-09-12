/**
 * "A posicao esta mesmo CHEGANDO?" — medicao de RESULTADO, nao de pre-requisito.
 *
 * Achado de QA 2026-09-11, com o app fechado e a viagem ativa no Redmi: a
 * tarefa nativa disparou 18 vezes em 150s (pontual, de 10 em 10s), o servico
 * de primeiro plano estava de pe (`isForeground=true`), a notificacao
 * persistente visivel, a permissao de segundo plano concedida e o GPS ligado
 * -- e NENHUMA posicao chegou ao servidor nesse periodo.
 *
 * O logcat mostrou 131 "blocked - too fast/too close" do FusedLocation, o que
 * a principio parecia throttling do SO. NAO E: conferido no fonte do AOSP
 * (LocationProviderManager.acceptLocationChange), "too close" so ocorre quando
 * `minUpdateDistanceMeters > 0` -- e nos pedimos `distanceInterval: 0`, entao
 * essas linhas nem sao nossas; e "too fast" e o filtro normal de intervalo
 * (provedor a ~1Hz, cliente pedindo 10s => ~9 descartes por entrega aceita,
 * proporcao que bate com o medido). Restricao de rede tambem foi descartada
 * (`dumpsys netpolicy`: rules=0, e o app ainda ganha isencao temporaria de
 * economia de energia no instante em que o broadcast de localizacao dispara).
 *
 * O que sobra e o pior tipo de silencio: a tarefa RODA e nada chega ao
 * servidor, sem nenhuma camada registrando o porque. Tudo que o app conseguia
 * verificar era PRE-REQUISITO (permissao concedida? GPS ligado? tarefa
 * registrada?), e todos respondiam "sim" enquanto nada funcionava.
 *
 * Por isso sao TRES carimbos, nao um -- cada um marca uma etapa diferente da
 * corrente, e e a diferenca entre eles que aponta onde ela arrebenta:
 *
 *   lastRunAt  a tarefa foi INVOCADA (gravado no topo do callback, antes de
 *              qualquer guard -- foi exatamente esse o erro da primeira
 *              versao deste instrumento: gravar depois do `if (!latest)
 *              return`, que no cenario investigado nunca e alcancado, e ai os
 *              dois carimbos envelheciam juntos sem separar nada).
 *   lastFixAt  o SO ENTREGOU uma localizacao (passou do guard).
 *   lastOkAt   o servidor ACEITOU o envio.
 *
 * lastRunAt fresco + lastFixAt velho  => o SO invoca mas nao entrega posicao.
 * lastFixAt fresco + lastOkAt velho   => entrega, mas o envio falha.
 * os tres frescos                     => funcionando.
 */

export interface TripDelivery {
  /** Quando o rastreamento foi armado. Base para "armou e nunca entregou". */
  armedAt: number;
  /** Tarefa invocada pelo SO (antes de qualquer guard). */
  lastRunAt?: number | null;
  /** O SO entregou uma localizacao de fato. */
  lastFixAt?: number | null;
  /** Ultimo POST de posicao aceito pelo servidor. */
  lastOkAt?: number | null;
  /** Ultima falha de envio, em texto, para o caso de nao dar para ler o log. */
  lastError?: string | null;
  lastErrorAt?: number | null;
}

/**
 * Acima disto, "nao chegou nada" deixa de ser engasgo e vira sinal confiavel.
 * A cadencia configurada e de 10s (ver timeInterval em startTrackingService e
 * BROADCAST_INTERVAL_MS): 90s tolera alguns ticks perdidos e uma retentativa
 * de rede sem acusar nada, e ainda assim detecta a falha em menos de dois
 * minutos. Poucos segundos NAO seriam sinal de coisa nenhuma.
 */
export const TRIP_DELIVERY_STALL_MS = 90_000;

/**
 * Pura, exportada para teste: a entrega ao SERVIDOR esta parada?
 *
 * `null` (nada armado) devolve `false` de proposito -- sem rastreamento armado
 * nao ha o que acusar, e afirmar falha sem ter medido e o erro que esta
 * auditoria inteira persegue.
 */
export function isTripDeliveryStalled(
  d: TripDelivery | null,
  now: number = Date.now(),
  thresholdMs: number = TRIP_DELIVERY_STALL_MS,
): boolean {
  if (!d) return false;
  // Armou e nunca entregou nada: so acusa depois de dar tempo do primeiro
  // envio acontecer, senao acusaria todo mundo nos primeiros segundos.
  if (d.lastOkAt == null) return now - d.armedAt > thresholdMs;
  return now - d.lastOkAt > thresholdMs;
}

/**
 * Em qual etapa a corrente arrebentou? Para o texto do diagnostico e para o
 * relato de QA -- responde "onde parou", nao so "parou".
 */
export type TripDeliveryStage = "ok" | "sem-invocacao" | "sem-posicao" | "sem-envio";

export function tripDeliveryStage(
  d: TripDelivery | null,
  now: number = Date.now(),
  thresholdMs: number = TRIP_DELIVERY_STALL_MS,
): TripDeliveryStage {
  if (!isTripDeliveryStalled(d, now, thresholdMs) || !d) return "ok";
  const fresco = (t: number | null | undefined) => t != null && now - t <= thresholdMs;
  if (!fresco(d.lastRunAt)) return "sem-invocacao"; // o SO nem chama a tarefa
  if (!fresco(d.lastFixAt)) return "sem-posicao"; // chama, mas nao entrega fix
  return "sem-envio"; // entrega, mas o POST nao chega ao servidor
}
