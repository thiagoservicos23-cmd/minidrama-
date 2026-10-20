// Filtros do catálogo: ordenação, ano, plano e a lista de opções (/facets).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
let lastFind = null;
const fake = {
  user: { findUnique: async () => null },
  plan: { findUnique: async () => null, findMany: async () => [{ id: "plateia", sortOrder: 0 }] },
  play: {
    findMany: async (args) => { lastFind = args; return []; },
    count: async () => 0,
    groupBy: async ({ by }) => by[0] === "releaseYear"
      ? [{ releaseYear: 2025, _count: { _all: 3 } }, { releaseYear: 2023, _count: { _all: 1 } }]
      : [{ requiresPlan: "plateia", _count: { _all: 2 } }, { requiresPlan: "camarote", _count: { _all: 2 } }],
  },
};
const clientPath = require.resolve(path.join(__dirname, "../src/prismaClient"));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };
const express = require("express");
const playsRouter = require("../src/routes/plays");
let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use("/api/plays", playsRouter);
  server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/plays`;
});
test.after(() => server.close());
const get = (q) => new Promise((resolve, reject) => {
  http.get(base + q, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) })); }).on("error", reject);
});

test("sem parâmetros: mais recentes primeiro, sem filtros", async () => {
  await get("/?page=1");
  assert.deepEqual(lastFind.orderBy, { createdAt: "desc" });
  assert.deepEqual(lastFind.where, {});
});

test("cada ordenação vira o orderBy certo", async () => {
  await get("/?page=1&sort=title");    assert.deepEqual(lastFind.orderBy, { title: "asc" });
  await get("/?page=1&sort=longest");  assert.deepEqual(lastFind.orderBy, { durationMinutes: "desc" });
  await get("/?page=1&sort=shortest"); assert.deepEqual(lastFind.orderBy, { durationMinutes: "asc" });
  await get("/?page=1&sort=year");     assert.deepEqual(lastFind.orderBy, [{ releaseYear: "desc" }, { createdAt: "desc" }]);
});

test("ordenação desconhecida cai em 'mais recentes' (não quebra nem vaza nada)", async () => {
  for (const bad of ["xyz", "__proto__", "constructor", "title;drop", ""]) {
    const r = await get("/?page=1&sort=" + encodeURIComponent(bad));
    assert.equal(r.status, 200, bad);
    assert.deepEqual(lastFind.orderBy, { createdAt: "desc" }, bad);
  }
});

test("filtra por ano e por plano, e combina com gênero", async () => {
  await get("/?page=1&year=2024&plan=camarote&genre=Drama");
  assert.equal(lastFind.where.releaseYear, 2024);
  assert.equal(lastFind.where.requiresPlan, "camarote");
  assert.deepEqual(lastFind.where.genres, { some: { genre: "Drama" } });
});

test("ano inválido é ignorado em vez de virar NaN no banco", async () => {
  for (const bad of ["abc", "20x4", "99999", "-2024", "2024; DROP"]) {
    const r = await get("/?page=1&year=" + encodeURIComponent(bad));
    assert.equal(r.status, 200, bad);
    assert.equal("releaseYear" in lastFind.where, false, bad);
  }
});

test("/facets devolve só anos e planos que existem, com contagem (e não é confundido com /:id)", async () => {
  const r = await get("/facets");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.years, [{ year: 2025, count: 3 }, { year: 2023, count: 1 }]);
  assert.deepEqual(r.body.plans, [{ id: "plateia", count: 2 }, { id: "camarote", count: 2 }]);
});
