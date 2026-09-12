import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTripDeliveryStalled,
  tripDeliveryStage,
  TRIP_DELIVERY_STALL_MS,
} from "./tripDeliveryRules.ts";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => NOW - ms;
const VELHO = TRIP_DELIVERY_STALL_MS + 10_000;

test("nada armado: nao acusa (nao ha rastreamento a cobrar)", () => {
  assert.equal(isTripDeliveryStalled(null, NOW), false);
  assert.equal(tripDeliveryStage(null, NOW), "ok");
});

test("armou agora e ainda nao entregou: nao acusa (tem que dar tempo do 1o envio)", () => {
  assert.equal(isTripDeliveryStalled({ armedAt: ago(5_000) }, NOW), false);
});

test("armou ha muito tempo e NUNCA entregou: acusa", () => {
  assert.equal(isTripDeliveryStalled({ armedAt: ago(VELHO) }, NOW), true);
});

test("entregou agora: nao acusa", () => {
  const d = { armedAt: ago(600_000), lastRunAt: ago(1_000), lastFixAt: ago(1_000), lastOkAt: ago(1_000) };
  assert.equal(isTripDeliveryStalled(d, NOW), false);
  assert.equal(tripDeliveryStage(d, NOW), "ok");
});

test("logo abaixo do limiar: nao acusa (engasgo de rede nao e falha)", () => {
  const d = { armedAt: ago(600_000), lastOkAt: ago(TRIP_DELIVERY_STALL_MS - 5_000) };
  assert.equal(isTripDeliveryStalled(d, NOW), false);
});

test("logo acima do limiar: acusa", () => {
  const d = { armedAt: ago(600_000), lastOkAt: ago(VELHO) };
  assert.equal(isTripDeliveryStalled(d, NOW), true);
});

// --- em QUAL etapa a corrente arrebentou -------------------------------

test("etapa: o SO nem invoca a tarefa", () => {
  const d = { armedAt: ago(600_000), lastRunAt: ago(VELHO), lastFixAt: ago(VELHO), lastOkAt: ago(VELHO) };
  assert.equal(tripDeliveryStage(d, NOW), "sem-invocacao");
});

test("etapa: invoca mas NAO entrega posicao (a hipotese do caso de campo)", () => {
  // Exatamente o medido no Redmi: tarefa disparando de 10 em 10s com o app
  // fechado, e nenhuma posicao chegando ao servidor.
  const d = { armedAt: ago(900_000), lastRunAt: ago(3_000), lastFixAt: ago(VELHO), lastOkAt: ago(240_000) };
  assert.equal(tripDeliveryStage(d, NOW), "sem-posicao");
});

test("etapa: entrega posicao mas o envio nao chega ao servidor", () => {
  const d = { armedAt: ago(900_000), lastRunAt: ago(3_000), lastFixAt: ago(3_000), lastOkAt: ago(240_000) };
  assert.equal(tripDeliveryStage(d, NOW), "sem-envio");
});

test("etapa nunca acusa quando a entrega esta em dia", () => {
  const d = { armedAt: ago(900_000), lastRunAt: ago(VELHO), lastFixAt: ago(VELHO), lastOkAt: ago(2_000) };
  assert.equal(tripDeliveryStage(d, NOW), "ok");
});
