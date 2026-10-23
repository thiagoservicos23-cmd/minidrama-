// Sorteio: sai de TODAS as novelinhas cadastradas (não só das mais recentes).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");
const { sampleIds } = require("../src/utils/randomPick");

/* ------------------------------------------------ função pura ------------------------------------------------ */
const ids = (n) => Array.from({ length: n }, (_, i) => "p" + i);

test("devolve exatamente `count` ids distintos, todos da lista", () => {
  const all = ids(50), r = sampleIds(all, 7, "");
  assert.equal(r.length, 7); assert.equal(new Set(r).size, 7); assert.ok(r.every((x) => all.includes(x)));
});
test("nunca devolve a excluída (a anterior) quando há outras", () => {
  for (let i = 0; i < 500; i++) assert.ok(!sampleIds(ids(5), 3, "p2").includes("p2"));
});
test("se só existe a excluída, devolve ela mesma em vez de nada; lista vazia devolve vazio", () => {
  assert.deepEqual(sampleIds(["a"], 1, "a"), ["a"]);
  assert.deepEqual(sampleIds([], 1, ""), []);
});
test("pedir mais do que existe devolve só o que existe; count inválido vira 1", () => {
  assert.equal(sampleIds(ids(3), 99, "").length, 3);
  assert.equal(sampleIds(ids(3), 0, "").length, 1);
  assert.equal(sampleIds(ids(3), -4, "").length, 1);
});
test("é uniforme: com 6 novelinhas e 6000 sorteios, cada uma sai perto de 1000 vezes", () => {
  const c = {}; ids(6).forEach((x) => (c[x] = 0));
  for (let i = 0; i < 6000; i++) c[sampleIds(ids(6), 1, "")[0]]++;
  Object.values(c).forEach((n) => assert.ok(n > 800 && n < 1200, JSON.stringify(c)));
});
test("a primeira e a última posições podem sair (sem viés de borda) e um gerador ruim não estoura o índice", () => {
  assert.equal(sampleIds(ids(10), 1, "", () => 0)[0], "p0");
  assert.equal(sampleIds(ids(10), 1, "", () => 0.9999999)[0], "p9");
  assert.equal(sampleIds(ids(10), 1, "", () => 1)[0], "p9");
});

/* ------------------------------------------------ rota (banco simulado) ------------------------------------------------ */
process.env.JWT_SECRET = "teste";
const db = { plays: [], idQueries: [] };
const fake = {
  user: { findUnique: async () => null },
  plan: { findUnique: async () => null, findMany: async () => [{ id: "plateia", sortOrder: 0 }, { id: "balcao", sortOrder: 1 }] },
  play: {
    findMany: async (a = {}) => {
      if (a.select && a.select.id && Object.keys(a.select).length === 1) db.idQueries.push(a);   // a consulta "só ids"
      let rows = db.plays;
      if (a.where && a.where.id && a.where.id.in) rows = rows.filter((p) => a.where.id.in.includes(p.id));
      return rows.map((p) => ({ ...p }));
    },
  },
};
const clientPath = require.resolve(path.join(__dirname, "../src/prismaClient"));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };
const express = require("express");
const router = require("../src/routes/plays");
let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use("/api/plays", router);
  server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/plays`;
});
test.after(() => server.close());
const get = (p) => new Promise((resolve, reject) => http.get(base + p, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) })); }).on("error", reject));
function seed(n = 500) {
  db.idQueries = [];
  db.plays = Array.from({ length: n }, (_, i) => ({ id: "n" + String(i).padStart(3, "0"), title: "Novelinha " + i, durationMinutes: 90, releaseYear: 2024, synopsis: ".", director: "", cast: "", posterUrl: "", backdropUrl: "", videoUrl: "https://segredo/" + i, requiresPlan: i % 2 ? "balcao" : "plateia", featured: false, createdAt: new Date(2020, 0, 1, 0, 0, i), updatedAt: new Date(), hasPosterData: false, hasBackdropData: false, announcedAt: null, genres: [] }));
}

test("rota: sorteia entre TODAS, inclusive as mais antigas (não só as últimas postadas)", async () => {
  seed(500);
  const seen = new Set();
  for (let i = 0; i < 300; i++) (await get("/random?count=12")).body.plays.forEach((p) => seen.add(p.id));
  assert.ok(seen.size >= 475, "só " + seen.size + " de 500 apareceram");
  assert.ok(seen.has("n000"), "a mais antiga nunca saiu");
  const antigas = [...seen].filter((id) => id < "n400").length;        // as 400 mais antigas = 80% do catálogo
  assert.ok(antigas > 300, "o sorteio está viciado nas mais novas: " + antigas);
});

test("rota: lê só os ids de TODAS as linhas — sem limite (take), sem ordenação e sem filtro de data", async () => {
  seed(40); await get("/random");
  const q = db.idQueries[0];
  assert.ok(q, "não fez a consulta só de ids");
  assert.equal(q.take, undefined); assert.equal(q.orderBy, undefined); assert.equal(q.where, undefined);
});

test("rota: não repete a anterior (exclude) e devolve o total cadastrado", async () => {
  seed(30);
  for (let i = 0; i < 100; i++) { const r = await get("/random?exclude=n007"); assert.equal(r.body.plays.length, 1); assert.notEqual(r.body.plays[0].id, "n007"); assert.equal(r.body.total, 30); }
});

test("rota: count é contido entre 1 e 12 e valores inválidos viram 1", async () => {
  seed(50);
  assert.equal((await get("/random?count=999")).body.plays.length, 12);
  assert.equal((await get("/random?count=abc")).body.plays.length, 1);
  assert.equal((await get("/random?count=0")).body.plays.length, 1);
  assert.equal((await get("/random?count=5")).body.plays.length, 5);
});

test("rota: catálogo vazio devolve lista vazia sem erro; e /random não é confundida com /:id", async () => {
  seed(0); const r = await get("/random");
  assert.equal(r.status, 200); assert.deepEqual(r.body.plays, []); assert.equal(r.body.total, 0);
});

test("rota: o link do vídeo nunca vaza (é lista, não detalhe)", async () => {
  seed(20);
  (await get("/random?count=12")).body.plays.forEach((p) => assert.ok(!("videoUrl" in p) || !p.videoUrl, "vazou videoUrl"));
});
