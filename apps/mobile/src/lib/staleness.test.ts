import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocationStale, LOCATION_STALE_THRESHOLD_MS } from "./staleness.ts";

const NOW = new Date(2026, 8, 11, 22, 0, 0); // 2026-09-11 22:00 local
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

test("sem timestamp: nao afirma que esta velho", () => {
  assert.equal(isLocationStale(null, NOW), false);
  assert.equal(isLocationStale(undefined, NOW), false);
});

test("timestamp invalido: nao afirma que esta velho", () => {
  assert.equal(isLocationStale("nao-e-uma-data", NOW), false);
});

test("posicao de agora: nao esta velha", () => {
  assert.equal(isLocationStale(iso(0), NOW), false);
});

test("logo abaixo do limiar: ainda nao esta velha", () => {
  assert.equal(isLocationStale(iso(LOCATION_STALE_THRESHOLD_MS - 1_000), NOW), false);
});

test("logo acima do limiar: esta velha", () => {
  assert.equal(isLocationStale(iso(LOCATION_STALE_THRESHOLD_MS + 1_000), NOW), true);
});

test("posicao de ontem: esta velha (o caso que gerou o achado de campo)", () => {
  assert.equal(isLocationStale(iso(26 * 60 * 60_000), NOW), true);
});

test("timestamp no FUTURO (relogio do aparelho adiantado): nao marca como velha", () => {
  // Um fix "do futuro" e estranho, mas chamar isso de velho seria pior:
  // acenderia um aviso permanente num aparelho com o relogio errado.
  assert.equal(isLocationStale(new Date(NOW.getTime() + 60_000).toISOString(), NOW), false);
});
