// "Em alta": ranking por atividade dos últimos 30 dias, com complemento quando há pouca atividade.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const mk = (id, extra = {}) => ({ id, title: "Peça " + id, durationMinutes: 90, releaseYear: 2025, synopsis: "s", posterUrl: "", backdropUrl: "", videoUrl: "", requiresPlan: "plateia", featured: false, createdAt: new Date(2025, 0, Number(id.replace(/\D/g, "")) || 1), updatedAt: new Date(), hasPosterData: false, hasBackdropData: false, announcedAt: null, genres: [], ...extra });
const db = { plays: [], watching: [], saved: [], lastWatchWhere: null, lastSavedWhere: null };
const fake = {
  user: { findUnique: async () => null },
  plan: { findUnique: async () => null, findMany: async () => [{ id: "plateia", sortOrder: 0 }] },
  watchProgress: { groupBy: async ({ where }) => { db.lastWatchWhere = where; return db.watching; } },
  myListItem: { groupBy: async ({ where }) => { db.lastSavedWhere = where; return db.saved; } },
  play: {
    findMany: async ({ where, orderBy, take }) => {
      let rows = db.plays;
      if (where && where.id && where.id.in) rows = rows.filter((p) => where.id.in.includes(p.id));
      if (where && where.id && where.id.notIn) rows = rows.filter((p) => !where.id.notIn.includes(p.id));
      if (orderBy) rows = [...rows].sort((a, b) => (Number(b.featured) - Number(a.featured)) || (b.createdAt - a.createdAt));   // destaque primeiro, depois as mais novas
      return take ? rows.slice(0, take) : rows;
    },
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
const n = (playId, c) => ({ playId, _count: { _all: c } });
function reset() { db.plays = ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => mk(id)); db.watching = []; db.saved = []; }

test("ordena por atividade: quem assiste vale 2, quem salva vale 1", async () => {
  reset();
  db.watching = [n("p1", 3), n("p2", 1)];           // p1 = 6, p2 = 2
  db.saved = [n("p2", 5), n("p3", 1)];              // p2 = 2 + 5 = 7, p3 = 1
  const r = await get("/trending?limit=3");
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r), ["p2", "p1", "p3"]);
  assert.equal(r.body.ranked, 3);
});

test("só conta atividade dos últimos 30 dias", async () => {
  reset(); await get("/trending");
  const since = db.lastWatchWhere.updatedAt.gte, since2 = db.lastSavedWhere.createdAt.gte;
  const days = (Date.now() - since.getTime()) / 86400000;
  assert.ok(days > 29.99 && days < 30.01, "janela de " + days + " dias");
  assert.ok(Math.abs(since - since2) < 1000);
});

test("com pouca atividade, completa com destaques e depois com as mais novas (e diz quantas eram reais)", async () => {
  reset();
  db.plays.find((p) => p.id === "p2").featured = true;     // destaque
  db.watching = [n("p5", 4)];
  const r = await get("/trending?limit=4");
  assert.deepEqual(ids(r), ["p5", "p2", "p6", "p4"]);       // p5 (atividade), p2 (destaque), depois as mais novas: p6, p4
  assert.equal(r.body.ranked, 1);
});

test("sem nenhuma atividade ainda assim devolve peças (a seção nunca fica vazia) com ranked = 0", async () => {
  reset();
  const r = await get("/trending?limit=3");
  assert.equal(r.body.plays.length, 3); assert.equal(r.body.ranked, 0);
});

test("não repete peça já ranqueada no complemento", async () => {
  reset(); db.watching = [n("p1", 1), n("p2", 1)];
  const r = await get("/trending?limit=6");
  assert.equal(new Set(ids(r)).size, 6);
});

test("peça apagada com atividade pendente some do ranking sem quebrar", async () => {
  reset(); db.watching = [n("p-apagada", 9), n("p3", 1)];
  const r = await get("/trending?limit=2");
  assert.equal(r.status, 200); assert.ok(!ids(r).includes("p-apagada")); assert.equal(r.body.ranked, 1);
});

test("limite inválido ou exagerado é contido (1 a 24)", async () => {
  reset();
  assert.equal((await get("/trending?limit=999")).body.plays.length, 6);        // só há 6 peças, mas o teto é 24
  assert.equal((await get("/trending?limit=abc")).body.plays.length, 6);        // inválido cai em 12
  assert.equal((await get("/trending?limit=0")).body.plays.length, 6);
  assert.equal((await get("/trending?limit=-5")).body.plays.length, 1);         // negativo vira 1
});

test("/trending não é confundida com /:id", async () => {
  reset(); const r = await get("/trending"); assert.equal(r.status, 200); assert.ok(Array.isArray(r.body.plays));
});
