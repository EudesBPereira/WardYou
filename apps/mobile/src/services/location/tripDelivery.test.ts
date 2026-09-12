import { test } from "node:test";
import assert from "node:assert/strict";
import { isTripDeliveryStalled, TRIP_DELIVERY_STALL_MS } from "./tripDeliveryRules.ts";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => NOW - ms;

test("nada armado: nao acusa (nao ha rastreamento a cobrar)", () => {
  assert.equal(isTripDeliveryStalled(null, NOW), false);
});

test("armou agora e ainda nao entregou: nao acusa (tem que dar tempo do 1o envio)", () => {
  assert.equal(isTripDeliveryStalled({ armedAt: ago(5_000), lastRunAt: null, lastOkAt: null }, NOW), false);
});

test("armou ha muito tempo e NUNCA entregou: acusa", () => {
  const d = { armedAt: ago(TRIP_DELIVERY_STALL_MS + 10_000), lastRunAt: null, lastOkAt: null };
  assert.equal(isTripDeliveryStalled(d, NOW), true);
});

test("entregou agora: nao acusa", () => {
  const d = { armedAt: ago(600_000), lastRunAt: ago(1_000), lastOkAt: ago(1_000) };
  assert.equal(isTripDeliveryStalled(d, NOW), false);
});

test("logo abaixo do limiar: nao acusa (engasgo de rede nao e falha)", () => {
  const d = { armedAt: ago(600_000), lastRunAt: null, lastOkAt: ago(TRIP_DELIVERY_STALL_MS - 5_000) };
  assert.equal(isTripDeliveryStalled(d, NOW), false);
});

test("logo acima do limiar: acusa", () => {
  const d = { armedAt: ago(600_000), lastRunAt: null, lastOkAt: ago(TRIP_DELIVERY_STALL_MS + 5_000) };
  assert.equal(isTripDeliveryStalled(d, NOW), true);
});

test("o caso de campo: tarefa RODANDO mas nenhum envio aceito ha 4min -- acusa", () => {
  // Exatamente o medido no Redmi: lastRunAt fresco (o SO entrega, a tarefa
  // roda) e lastOkAt parado -- o sintoma que nenhum pre-requisito pegava.
  const d = { armedAt: ago(900_000), lastRunAt: ago(3_000), lastOkAt: ago(240_000) };
  assert.equal(isTripDeliveryStalled(d, NOW), true);
});
