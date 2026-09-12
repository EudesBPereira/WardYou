import { storage } from "@/lib/storage";
import type { TripDelivery } from "./tripDeliveryRules";

/** Persistencia do instrumento de entrega. A REGRA pura (e seus testes) vive
 *  em tripDeliveryRules.ts -- separada porque o runner de teste do Node nao
 *  resolve o alias `@/`, o mesmo motivo de enforcementLogic.ts ser separado. */

const KEY = "wardyou_trip_delivery";

export async function readTripDelivery(): Promise<TripDelivery | null> {
  try {
    const raw = await storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TripDelivery;
    return typeof parsed?.armedAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}

async function patch(campos: Partial<TripDelivery>): Promise<void> {
  try {
    const atual = await readTripDelivery();
    const proximo: TripDelivery = { armedAt: atual?.armedAt ?? Date.now(), ...atual, ...campos };
    await storage.setItem(KEY, JSON.stringify(proximo));
  } catch {
    /* best-effort: um diagnostico que nao consegue gravar nao pode derrubar o
       rastreamento que ele esta observando */
  }
}

/** Rastreamento armado. Preserva os carimbos anteriores: re-armar por causa de
 *  uma troca de viagem nao pode zerar o historico de entrega. */
export async function markTripTrackingArmed(): Promise<void> {
  const atual = await readTripDelivery();
  if (!atual) await patch({ armedAt: Date.now() });
}

/** A tarefa nativa foi INVOCADA pelo SO. Gravado no topo do callback, antes de
 *  qualquer guard -- ver o porque em tripDeliveryRules.ts. */
export async function markTripTaskRan(): Promise<void> {
  await patch({ lastRunAt: Date.now() });
}

/** O SO entregou uma localizacao de fato (passou do guard de `locations`). */
export async function markTripFixReceived(): Promise<void> {
  await patch({ lastFixAt: Date.now() });
}

/** Um POST de posicao foi aceito pelo servidor. Chamado pelos DOIS caminhos
 *  (primeiro plano e tarefa nativa) -- o diagnostico mede ENTREGA, e nao
 *  importa por qual dos dois ela aconteceu. */
export async function markTripPostOk(): Promise<void> {
  await patch({ lastOkAt: Date.now(), lastError: null });
}

/** Falha de envio, guardada em texto: no aparelho de teste o storage nao e
 *  legivel por fora (app nao-debuggable) e a UI pode estar atras do app lock,
 *  entao o motivo precisa sobreviver ate alguem conseguir abrir o app. */
export async function markTripPostFailed(motivo: string): Promise<void> {
  await patch({ lastError: motivo.slice(0, 200), lastErrorAt: Date.now() });
}

export async function clearTripDelivery(): Promise<void> {
  try {
    await storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export { isTripDeliveryStalled, tripDeliveryStage, TRIP_DELIVERY_STALL_MS } from "./tripDeliveryRules";
export type { TripDelivery, TripDeliveryStage } from "./tripDeliveryRules";
