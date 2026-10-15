// A página inicial: banner SEMPRE presente, "Novos Na Plataforma" e seções por gênero (vários gêneros por série).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const db = { plays: [], pg: [], plans: [{ id: "plateia", name: "Plateia", price: 0, sortOrder: 0 }, { id: "balcao", name: "Balcão", price: 14.9, sortOrder: 1 }] };
const withGenres = (p, select) => ({ ...p, ...(select && select.genres ? { genres: db.pg.filter((x) => x.playId === p.id).map((x) => ({ genre: x.genre })) } : {}) });
const sel = (a = {}) => {
  const { where = {}, orderBy, take, skip = 0, select } = a;
  let r = db.plays.filter((p) => Object.entries(where).every(([k, v]) => {
    if (k === "genres") return db.pg.some((x) => x.playId === p.id && x.genre === v.some.genre);
    return p[k] === v;
  }));
  if (orderBy && orderBy.createdAt === "desc") r = r.slice().sort((a, b) => b.createdAt - a.createdAt);
  return r.slice(skip, take ? skip + take : undefined).map((p) => withGenres(p, select));
};
const fake = {
  user: { findUnique: async () => null },
  plan: { findMany: async () => db.plans, findUnique: async ({ where }) => db.plans.find((p) => p.id === where.id) || null },
  play: { findMany: async (a) => sel(a), count: async (a) => sel({ where: (a && a.where) || {} }).length },
  playGenre: { groupBy: async () => { const m = {}; db.pg.forEach((x) => (m[x.genre] = (m[x.genre] || 0) + 1)); return Object.entries(m).map(([genre, n]) => ({ genre, _count: { _all: n } })); } },
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
  const mk = (i, over) => ({ id: "p" + i, title: "Série " + i, durationMinutes: 90, releaseYear: 2024, synopsis: ".", director: "", cast: "", posterUrl: "", backdropUrl: "", videoUrl: "https://segredo/" + i, requiresPlan: "balcao", featured: false, createdAt: new Date(2026, 0, 1, 0, 0, i), updatedAt: new Date(), hasPosterData: false, hasBackdropData: false, announcedAt: null, ...over });
  db.plays = []; db.pg = [];
  for (let i = 0; i < 3; i++) db.plays.push(mk(i, { featured: true, createdAt: new Date(2020, 0, 1 + i) }));   // destaques ANTIGOS
  for (let i = 3; i < 403; i++) db.plays.push(mk(i));
  const ids = ["dublados", "animes", "ia"];
  db.plays.forEach((p, i) => { db.pg.push({ playId: p.id, genre: ids[i % 3] }); });
  db.pg.push({ playId: "p402", genre: "animes" });   // p402 (dublados) também é anime: aparece nas duas seções
}

test("o banner mostra os destaques mesmo sendo os mais antigos de 400+ séries", async () => {
  seed();
  const r = await get("/feed/home");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.featured.map((p) => p.id).sort(), ["p0", "p1", "p2"]);
});

test("'Novos Na Plataforma' = as mais recentes, na ordem em que foram adicionadas (máx. 20)", async () => {
  seed();
  const r = await get("/feed/home");
  assert.equal(r.body.novos.length, 20);
  assert.equal(r.body.novos[0].id, "p402");
  assert.equal(r.body.novos[19].id, "p383");
});

test("uma série com 2 gêneros aparece nas duas seções; só entram seções com séries", async () => {
  seed();
  const r = await get("/feed/home");
  const ids = r.body.genres.map((g) => g.id);
  assert.deepEqual(ids, ["ia", "animes", "dublados"].sort((a, b) => ["dublados", "brasileiras", "ia", "animes"].indexOf(a) - ["dublados", "brasileiras", "ia", "animes"].indexOf(b)), "ordem oficial, sem seções vazias");
  const inRow = (g) => r.body.genres.find((x) => x.id === g).plays.map((p) => p.id);
  // p402 está em "animes" e "dublados"; o catálogo traz as 20 mais novas de cada, então confere pela listagem do gênero:
  return Promise.all([get("/?page=1&pageSize=100&genre=animes"), get("/?page=1&pageSize=100&genre=dublados")]).then(([a, d]) => {
    assert.ok(a.body.plays.some((p) => p.id === "p402"));
    assert.ok(d.body.plays.some((p) => p.id === "p402"));
    assert.ok(inRow("animes").length <= 20 && inRow("dublados").length <= 20);
  });
});

test("a série traz os gêneros em ids, nomes para exibir e o primeiro nome em 'genre'", async () => {
  seed();
  const r = await get("/?page=1&pageSize=100&genre=animes");
  const p402 = r.body.plays.find((p) => p.id === "p402");
  assert.deepEqual(p402.genres, ["dublados", "animes"].sort((a, b) => ["dublados", "animes"].indexOf(a) - ["dublados", "animes"].indexOf(b)));
  assert.deepEqual(p402.genreLabels, ["Dublados", "Animes"]);
  assert.equal(p402.genre, "Dublados");
});

test("filtrar por gênero só traz séries daquele gênero; 'novos'/'Todos' não filtram", async () => {
  seed();
  const ia = await get("/?page=1&pageSize=100&genre=ia");
  assert.ok(ia.body.plays.length > 0 && ia.body.plays.every((p) => p.genres.includes("ia")));
  const all = await get("/?page=1&pageSize=5&genre=novos");
  assert.equal(all.body.total, 403);
  assert.equal((await get("/?page=1&pageSize=5&genre=Todos")).body.total, 403);
});

test("a lista de gêneros do catálogo vem na resposta e o link do vídeo nunca vaza", async () => {
  seed();
  const r = await get("/feed/home");
  assert.equal(r.body.catalog.length, 10);
  assert.equal(r.body.catalog[1].label, "🇧🇷 Brasileiras");
  assert.equal(r.body.total, 403);
  assert.ok(!JSON.stringify(r.body).includes("segredo"));
});
