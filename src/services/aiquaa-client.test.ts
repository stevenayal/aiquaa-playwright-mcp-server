import test from "node:test";
import assert from "node:assert/strict";
import { AiquaaClient, clearBusinessRulesCache } from "./aiquaa-client.js";

const BASE = { baseUrl: "https://api.test", accessToken: "jwt-1", sleep: async () => {} };

function rulesPage(page: number, totalPages: number, count = 2): Response {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `RN-${page}${index}`,
    title: `Regla ${page}${index}`,
    description: "",
  }));
  return new Response(JSON.stringify({ items, page, pageSize: 100, total: totalPages * count, totalPages }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("un backend que no responde corta por timeout con un mensaje accionable", async () => {
  const client = new AiquaaClient({
    ...BASE,
    timeoutMs: 25,
    maxRetries: 0,
    fetchImpl: async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    },
  });
  await assert.rejects(
    () => client.getFeatureContent("feat_1"),
    /AIQUAA no respondió en 25 ms.*AIQUAA_TIMEOUT_MS/s,
  );
});

test("un 429 se reintenta respetando Retry-After y termina resolviendo", async () => {
  clearBusinessRulesCache();
  const delays: number[] = [];
  let calls = 0;
  const client = new AiquaaClient({
    ...BASE,
    accessToken: "jwt-429",
    maxRetries: 2,
    sleep: async (ms) => {
      delays.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "1" } });
      return rulesPage(1, 1);
    },
  });
  const result = await client.listBusinessRules("prj", { page: 1, pageSize: 100 });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1_000]);
  assert.equal(result.items.length, 2);
});

test("un 401 no se reintenta y explica cómo renovar el token", async () => {
  let calls = 0;
  const client = new AiquaaClient({
    ...BASE,
    fetchImpl: async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    },
  });
  await assert.rejects(() => client.getFeatureContent("feat_1"), /Renová AIQUAA_ACCESS_TOKEN/);
  assert.equal(calls, 1);
});

test("el paginado completo corta en el tope y lo reporta", async () => {
  clearBusinessRulesCache();
  let calls = 0;
  const client = new AiquaaClient({
    ...BASE,
    accessToken: "jwt-cap",
    maxPages: 3,
    fetchImpl: async () => {
      calls += 1;
      return rulesPage(calls, 50);
    },
  });
  const catalog = await client.getAllBusinessRulesDetailed("prj");
  assert.equal(calls, 3, "no debe pedir las 50 páginas que anuncia el backend");
  assert.equal(catalog.truncated, true);
  assert.equal(catalog.rules.length, 6);
});

test("la caché evita repaginar el catálogo dentro del TTL", async () => {
  clearBusinessRulesCache();
  let calls = 0;
  const client = new AiquaaClient({
    ...BASE,
    accessToken: "jwt-cache",
    fetchImpl: async () => {
      calls += 1;
      return rulesPage(1, 1);
    },
  });
  await client.getAllBusinessRulesDetailed("prj");
  await client.getAllBusinessRulesDetailed("prj");
  assert.equal(calls, 1);

  // Un token distinto es otro usuario: no debe leer la caché ajena.
  const other = new AiquaaClient({
    ...BASE,
    accessToken: "jwt-otro",
    fetchImpl: async () => {
      calls += 1;
      return rulesPage(1, 1);
    },
  });
  await other.getAllBusinessRulesDetailed("prj");
  assert.equal(calls, 2);
});

test("el error upstream no filtra tokens al transcript", async () => {
  const client = new AiquaaClient({
    ...BASE,
    fetchImpl: async () =>
      new Response('{"error":"bad","token":"eyJhbGciOiJIUzI1NiJ9.super-secreto"}', { status: 400 }),
  });
  await assert.rejects(() => client.getFeatureContent("feat_1"), (error: Error) => {
    assert.doesNotMatch(error.message, /super-secreto/);
    assert.match(error.message, /<oculto>/);
    return true;
  });
});
