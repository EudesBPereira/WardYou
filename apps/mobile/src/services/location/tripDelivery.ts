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
    if (typeof parsed?.armedAt !== "number") return null;
    return { armedAt: parsed.armedAt, lastRunAt: parsed.lastRunAt ?? null, lastOkAt: parsed.lastOkAt ?? null };
  } catch {
    return null;
  }
}

async function write(d: TripDelivery): Promise<void> {
  try {
    await storage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* best-effort: um diagnostico que nao consegue gravar nao pode derrubar o
       rastreamento que ele esta observando */
  }
}

/** Rastreamento armado. Preserva `lastOkAt` se ja havia um (re-armar por causa
 *  de uma troca de viagem nao pode zerar o historico de entrega). */
export async function markTripTrackingArmed(): Promise<void> {
  const atual = await readTripDelivery();
  await write({
    armedAt: atual?.armedAt ?? Date.now(),
    lastRunAt: atual?.lastRunAt ?? null,
    lastOkAt: atual?.lastOkAt ?? null,
  });
}

/**
 * A tarefa nativa rodou COM uma localizacao em maos -- ou seja, o SO entregou.
 *
 * Separar isto de `markTripPostOk` e o que distingue as duas causas que
 * passamos horas sem conseguir separar: "o SO nao esta entregando localizacao"
 * (roda sem nunca chegar aqui) de "entrega, mas o envio ao servidor falha"
 * (chega aqui e nunca em lastOkAt). Sem essa distincao, os dois casos
 * produzem exatamente o mesmo sintoma: silencio.
 */
export async function markTripTaskRan(): Promise<void> {
  const atual = await readTripDelivery();
  await write({
    armedAt: atual?.armedAt ?? Date.now(),
    lastRunAt: Date.now(),
    lastOkAt: atual?.lastOkAt ?? null,
  });
}

/** Um POST de posicao foi aceito pelo servidor. Chamado pelos DOIS caminhos. */
export async function markTripPostOk(): Promise<void> {
  const atual = await readTripDelivery();
  const agora = Date.now();
  await write({ armedAt: atual?.armedAt ?? agora, lastRunAt: atual?.lastRunAt ?? agora, lastOkAt: agora });
}

export async function clearTripDelivery(): Promise<void> {
  try {
    await storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export { isTripDeliveryStalled, TRIP_DELIVERY_STALL_MS } from "./tripDeliveryRules";
export type { TripDelivery } from "./tripDeliveryRules";
