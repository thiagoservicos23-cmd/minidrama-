// Pesquisa do catálogo: ignora acentos e maiúsculas, olha título/direção/elenco e ordena por relevância.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const mk = (id, title, director = "", cast = "") => ({ id, title, director, cast, durationMinutes: 90, releaseYear: 2025, synopsis: "s", posterUrl: "", backdropUrl: "", videoUrl: "", requiresPlan: "plateia", featured: false, createdAt: new Date(), updatedAt: new Date(), hasPosterData: false, hasBackdropData: false, announcedAt: null, genres: [] });
const ROWS = [
  mk("a", "O Silêncio das Cortinas", "Marina Alves", "Paulo Reis"),
  mk("b", "Silêncio", "Zeca", ""),
  mk("c", "Ventos de Dona Flor", "Rita Silêncio Lima", "Joana"),
  mk("d", "Casa de Bonecas", "Ana", "Carlos Dona"),
  mk("e", "Dona Flor e Seus Dois Maridos", "Lia", ""),
];
let lastCountCalled = false;
const fake = {
  user: { findUnique: async () => null },
  plan: { findUnique: async () => null, findMany: async () => [{ id: "plateia", sortOrder: 0 }] },
  play: {
    findMany: async ({ where, select, skip = 0, take = 1000 }) => {
      let rows = ROWS;
      if (where && where.id && where.id.in) rows = rows.filter((r) => where.id.in.includes(r.id));
      rows = rows.slice(skip, skip + take);
      return select && !select.genres ? rows.map(({ id, title, director, cast }) => ({ id, title, director, cast })) : rows;
    },
    count: async () => { lastCountCalled = true; return ROWS.length; },
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
const ids = (r) => r.body.plays.map((p) => p.id);

test("ignora acentos e maiúsculas: 'SILENCIO' acha 'Silêncio'", async () => {
  const r = await get("/?page=1&search=" + encodeURIComponent("SILENCIO"));
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r).slice(0, 2), ["b", "a"]);
});

test("ordem por relevância: título igual, começa com, contém, e só depois direção/elenco", async () => {
  const r = await get("/?page=1&search=" + encodeURIComponent("silêncio"));
  assert.deepEqual(ids(r), ["b", "a", "c"]);                 // b = igual, a = contém no título, c = só na direção
  assert.equal(r.body.total, 3);
});

test("encontra pelo elenco e pela direção", async () => {
  assert.deepEqual(ids(await get("/?page=1&search=carlos")), ["d"]);
  assert.deepEqual(ids(await get("/?page=1&search=" + encodeURIComponent("MARINA"))), ["a"]);
});

test("quem COMEÇA com a busca vem antes de quem só a contém; elenco com só uma das palavras não entra", async () => {
  const r = await get("/?page=1&search=" + encodeURIComponent("dona flor"));
  assert.deepEqual(ids(r), ["e", "c"]);                       // e começa com "dona flor"; c contém; d só tem "Dona" no elenco
});

test("sem resultado devolve lista vazia; busca só de símbolos não devolve o catálogo inteiro", async () => {
  const none = await get("/?page=1&search=xyzxyz");
  assert.deepEqual(none.body.plays, []); assert.equal(none.body.total, 0);
  const symbols = await get("/?page=1&search=" + encodeURIComponent("?!?"));
  assert.deepEqual(symbols.body.plays, []);
});

test("paginação da pesquisa respeita pageSize e mantém o total", async () => {
  const p1 = await get("/?page=1&pageSize=1&search=" + encodeURIComponent("silencio"));
  const p2 = await get("/?page=2&pageSize=1&search=" + encodeURIComponent("silencio"));
  assert.deepEqual([ids(p1), ids(p2)], [["b"], ["a"]]);
  assert.equal(p1.body.total, 3); assert.equal(p1.body.totalPages, 3);
});

test("sem pesquisa continua listando normalmente", async () => {
  const r = await get("/?page=1");
  assert.equal(r.body.total, ROWS.length);
  assert.equal(ids(r).length, ROWS.length);
});
