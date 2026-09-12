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
 * proporcao que bate com o medido). Ou seja: a entrega estava funcionando.
 *
 * O que sobra e o pior tipo de silencio: a tarefa RODOU 18 vezes e nada chegou
 * ao servidor, e nenhuma camada registrou o porque. Tudo que o app conseguia
 * verificar era PRE-REQUISITO (permissao concedida? GPS ligado? tarefa
 * registrada?), e todos respondiam "sim" enquanto nada funcionava.
 *
 * E a mesma licao do diagnostico de acessibilidade: parar de inferir a partir
 * do que DEVERIA funcionar e passar a observar o que de fato acontece. Por
 * isso o carimbo e gravado pelos DOIS caminhos que postam -- o de primeiro
 * plano (useTripLocationBroadcast) e a tarefa NATIVA headless
 * (tripLocationTracking.native.ts). Gravar so no primeiro plano deixaria o
 * valor velho exatamente no cenario que queremos medir: o app fechado.
 */
export interface TripDelivery {
  /** Quando o rastreamento foi armado. Base para "armou e nunca entregou". */
  armedAt: number;
  /** Ultima vez que a tarefa nativa RODOU com uma localizacao em maos (ou seja,
   *  o SO entregou). `null` = nunca rodou com dado. */
  lastRunAt: number | null;
  /** Ultimo POST de posicao aceito pelo servidor. `null` = nenhum ainda. */
  lastOkAt: number | null;
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
 * Pura, exportada para teste: a entrega esta parada?
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
