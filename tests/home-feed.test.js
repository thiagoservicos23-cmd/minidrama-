// A página inicial precisa mostrar o banner (séries em destaque) MESMO com centenas de séries no catálogo.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const db = { plays: [], plans: [{ id: "plateia", name: "Plateia", price: 0, sortOrder: 0 }, { id: "balcao", name: "Balcão", price: 14.9, sortOrder: 1 }] };
const sel = (list, { where = {}, orderBy, take, skip = 0 } = {}) => {
  let r = list.filter((p) => Object.entries(where).every(([k, v]) => p[k] === v));
  if (orderBy && orderBy.createdAt === "desc") r = r.slice().sort((a, b) => b.createdAt - a.createdAt);
  return r.slice(skip, take ? skip + take : undefined);
};
const fake = {
  user: { findUnique: async () => null },
  plan: { findMany: async () => db.plans, findUnique: async ({ where }) => db.plans.find((p) => p.id === where.id) || null },
  play: {
    findMany: async (a) => sel(db.plays, a).map((p) => ({ ...p })),
    count: async () => db.plays.length,
    groupBy: async () => { const m = {}; db.plays.forEach((p) => (m[p.genre] = (m[p.genre] || 0) + 1)); return Object.entries(m).map(([genre, n]) => ({ genre, _count: { _all: n } })); },
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

function seed() {
  // 400 séries "novas" sem destaque + 3 séries ANTIGAS em destaque (as mais velhas do catálogo)
  const mk = (i, over) => ({ id: "p" + i, title: "Série " + i, genre: ["Drama", "Comédia", "Romance"][i % 3], durationMinutes: 90, releaseYear: 2024, synopsis: ".", director: "", cast: "", posterUrl: "", backdropUrl: "", videoUrl: "https://segredo/" + i, requiresPlan: "balcao", featured: false, createdAt: new Date(2026, 0, 1, 0, 0, i), updatedAt: new Date(), hasPosterData: false, hasBackdropData: false, announcedAt: null, ...over });
  db.plays = [];
  for (let i = 0; i < 3; i++) db.plays.push(mk(i, { featured: true, createdAt: new Date(2020, 0, 1 + i) }));
  for (let i = 3; i < 403; i++) db.plays.push(mk(i));
}

test("o banner mostra as séries em destaque mesmo sendo as mais antigas de 400+ séries", async () => {
  seed();
  const r = await get("/feed/home");
  assert.equal(r.status, 200);
  assert.equal(r.body.featured.length, 3);
  assert.deepEqual(r.body.featured.map((p) => p.id).sort(), ["p0", "p1", "p2"]);
});

test("a lista antiga (120 mais novas) NÃO continha os destaques — era o defeito", async () => {
  seed();
  const r = await get("/");   // comportamento antigo, sem paginação
  assert.equal(r.body.plays.length, 120);
  assert.equal(r.body.plays.filter((p) => p.featured).length, 0);
});

test("cada gênero traz no máximo 20 séries, com o total real, e não vaza o link do vídeo", async () => {
  seed();
  const r = await get("/feed/home");
  assert.equal(r.body.total, 403);
  for (const g of r.body.genres) {
    assert.ok(g.plays.length <= 20);
    assert.ok(g.total > 20);
    assert.ok(g.plays.every((p) => p.genre === g.genre));
  }
  assert.ok(!JSON.stringify(r.body).includes("segredo"), "videoUrl não pode aparecer");
  assert.ok(r.body.featured.every((p) => p.hasVideo === true && "canWatch" in p));
});

test("a resposta é pequena (nada de carregar o catálogo inteiro)", async () => {
  seed();
  const r = await get("/feed/home");
  const n = r.body.genres.reduce((a, g) => a + g.plays.length, 0);
  assert.ok(n <= 60, "séries nas seções: " + n);
});
