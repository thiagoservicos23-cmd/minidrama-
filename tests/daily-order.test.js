// Ordem do dia: as novelinhas são embaralhadas dentro de cada gênero, mudam à 00:00 e nunca misturam gêneros.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const daily = require("../src/utils/dailyOrder");
const at = (iso) => new Date(iso);                       // 00:00 em Brasília = 03:00 UTC

/* ------------------------------------------------ função pura ------------------------------------------------ */
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: "p" + String(i).padStart(3, "0") }));
const ids = (a) => a.map((x) => x.id);

test("o dia vira EXATAMENTE à 00:00 de Brasília (23:59:59 ainda é o dia anterior)", () => {
  assert.equal(daily.dayKey(at("2026-10-21T02:59:59Z")), "2026-10-20");
  assert.equal(daily.dayKey(at("2026-10-21T03:00:00Z")), "2026-10-21");
  assert.equal(daily.dayKey(at("2026-12-31T23:59:59-03:00")), "2026-12-31");
  assert.equal(daily.dayKey(at("2027-01-01T00:00:00-03:00")), "2027-01-01");
});

test("a ordem é a mesma o dia inteiro e troca na virada", () => {
  const it = items(40);
  const manha = ids(daily.dailyShuffle(it, "genre:a", at("2026-10-21T03:00:00Z")));          // 00:00:00
  const noite = ids(daily.dailyShuffle(it, "genre:a", at("2026-10-22T02:59:59Z")));          // 23:59:59 do mesmo dia
  const amanha = ids(daily.dailyShuffle(it, "genre:a", at("2026-10-22T03:00:00Z")));         // 00:00:00 do dia seguinte
  assert.deepEqual(manha, noite);
  assert.notDeepEqual(manha, amanha);
});

test("é uma permutação: ninguém some, ninguém duplica", () => {
  const it = items(57);
  const out = ids(daily.dailyShuffle(it, "genre:a", at("2026-10-21T15:00:00Z")));
  assert.equal(out.length, 57);
  assert.deepEqual([...out].sort(), ids(it).sort());
});

test("não depende da ordem em que o banco devolve as linhas (qualquer servidor gera a mesma vitrine)", () => {
  const it = items(30), when = at("2026-10-21T15:00:00Z");
  assert.deepEqual(ids(daily.dailyShuffle(it, "genre:a", when)), ids(daily.dailyShuffle([...it].reverse(), "genre:a", when)));
});

test("cada gênero tem a sua própria ordem", () => {
  const it = items(30), when = at("2026-10-21T15:00:00Z");
  assert.notDeepEqual(ids(daily.dailyShuffle(it, "genre:dublados", when)), ids(daily.dailyShuffle(it, "genre:animes", when)));
});

test("ao longo dos dias a primeira posição passa por várias novelinhas (não fica viciada)", () => {
  const it = items(20), firsts = new Set();
  for (let d = 0; d < 120; d++) firsts.add(daily.dailyShuffle(it, "genre:a", new Date(Date.UTC(2026, 0, 1 + d, 15)))[0].id);
  assert.ok(firsts.size >= 14, "só " + firsts.size + " diferentes em 120 dias");
});

test("fuso inválido não derruba o servidor", () => {
  assert.match(daily.dayKey(at("2026-10-21T15:00:00Z"), "Fuso/Que/Nao/Existe"), /^\d{4}-\d{2}-\d{2}$/);
});

/* ------------------------------------------------ rotas (banco simulado) ------------------------------------------------ */
const db = { plays: [], pg: [], plans: [{ id: "plateia", name: "Plateia", price: 0, sortOrder: 0 }, { id: "balcao", name: "Balcão", price: 14.9, sortOrder: 1 }] };
const withGenres = (p, select) => ({ ...p, ...(select && select.genres ? { genres: db.pg.filter((x) => x.playId === p.id).map((x) => ({ genre: x.genre })) } : {}) });
const sel = (a = {}) => {
  const { where = {}, orderBy, take, skip = 0, select } = a;
  let r = db.plays.filter((p) => Object.entries(where).every(([k, v]) => {
    if (k === "genres") return db.pg.some((x) => x.playId === p.id && x.genre === v.some.genre);
    if (k === "id" && v && typeof v === "object") return v.in ? v.in.includes(p.id) : !v.notIn.includes(p.id);
    return p[k] === v;
  }));
  const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
  if (ob && ob.createdAt === "desc") r = r.slice().sort((a, b) => b.createdAt - a.createdAt);
  return r.slice(skip, take ? skip + take : undefined).map((p) => withGenres(p, select));
};
const fake = {
  user: { findUnique: async () => null },
  plan: { findMany: async () => db.plans, findUnique: async ({ where }) => db.plans.find((p) => p.id === where.id) || null },
  play: { findMany: async (a) => sel(a), count: async (a) => sel({ where: (a && a.where) || {} }).length },
  playGenre: { findMany: async () => db.pg.map((x) => ({ genre: x.genre, playId: x.playId })) },
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
test.after(() => { server.close(); daily.clock.now = () => new Date(); });
const get = (p) => new Promise((resolve, reject) => http.get(base + p, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) })); }).on("error", reject));
const today = (iso) => { daily.clock.now = () => at(iso); };

// 3 gêneros x 60 novelinhas; p059 também é "animes" (aparece em dois gêneros). createdAt cresce com o número.
function seed() {
  const mk = (i, over) => ({ id: "p" + String(i).padStart(3, "0"), title: "Novelinha " + i, durationMinutes: 90, releaseYear: i % 2 ? 2024 : 2025, synopsis: ".", director: "", cast: "", posterUrl: "", backdropUrl: "", videoUrl: "https://segredo/" + i, requiresPlan: i % 3 ? "balcao" : "plateia", featured: false, createdAt: new Date(2026, 0, 1, 0, 0, i), updatedAt: new Date(), hasPosterData: false, hasBackdropData: false, announcedAt: null, ...over });
  db.plays = []; db.pg = [];
  const g = ["dublados", "animes", "ia"];
  for (let i = 0; i < 180; i++) { db.plays.push(mk(i)); db.pg.push({ playId: db.plays[i].id, genre: g[i % 3] }); }
  db.pg.push({ playId: "p179", genre: "animes" });
}
const row = (r, id) => r.body.genres.find((x) => x.id === id);

test("home: cada fileira só tem novelinhas do PRÓPRIO gênero (nada se mistura)", async () => {
  seed(); today("2026-10-21T15:00:00Z");
  const r = await get("/feed/home");
  assert.equal(r.status, 200);
  for (const g of r.body.genres) { assert.ok(g.plays.length > 0); assert.ok(g.plays.every((p) => p.genres.includes(g.id)), "mistura em " + g.id); }
});

test("home: a ordem é embaralhada (não é mais por data), tem 20 por fileira e o total do gênero continua certo", async () => {
  seed(); today("2026-10-21T15:00:00Z");
  const r = await get("/feed/home");
  const dub = row(r, "dublados");
  assert.equal(dub.plays.length, 20); assert.equal(dub.total, 60);
  const porData = db.plays.filter((p) => db.pg.some((x) => x.playId === p.id && x.genre === "dublados")).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((p) => p.id);
  assert.notDeepEqual(dub.plays.map((p) => p.id), porData);
});

test("home: a ordem é igual o dia todo e muda à 00:00", async () => {
  seed();
  today("2026-10-21T03:00:01Z"); const a = (await get("/feed/home")).body;
  today("2026-10-22T02:59:59Z"); const b = (await get("/feed/home")).body;
  today("2026-10-22T03:00:01Z"); const c = (await get("/feed/home")).body;
  const ord = (x) => x.genres.map((g) => g.plays.map((p) => p.id).join(","));
  assert.deepEqual(ord(a), ord(b));
  assert.notDeepEqual(ord(a), ord(c));
  assert.equal(a.shuffleDay, "2026-10-21"); assert.equal(c.shuffleDay, "2026-10-22");
});

test("home: o sorteio vale para o gênero INTEIRO (senão só as 20 mais novas girariam e a vitrine pareceria parada)", async () => {
  seed();
  const novas = new Set(db.plays.filter((p) => db.pg.some((x) => x.playId === p.id && x.genre === "dublados")).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((p) => p.id));
  let sawOld = false;
  for (let d = 0; d < 10 && !sawOld; d++) { today(`2026-11-${String(10 + d)}T15:00:00Z`); sawOld = row(await get("/feed/home"), "dublados").plays.some((p) => !novas.has(p.id)); }
  assert.ok(sawOld, "em 10 dias nenhuma novelinha antiga apareceu na fileira");
});

test("home: 'Novos' continua por data de postagem, em qualquer dia", async () => {
  seed();
  for (const d of ["2026-10-21T15:00:00Z", "2026-10-22T15:00:00Z"]) { today(d); const r = await get("/feed/home"); assert.equal(r.body.novos[0].id, "p179"); assert.equal(r.body.novos[19].id, "p160"); }
});

test("a banco devolver as linhas em outra ordem não muda a vitrine (outro servidor, mesma ordem)", async () => {
  seed(); today("2026-10-21T15:00:00Z");
  const a = (await get("/feed/home")).body.genres.map((g) => g.plays.map((p) => p.id).join(","));
  db.plays.reverse(); db.pg.reverse();
  const b = (await get("/feed/home")).body.genres.map((g) => g.plays.map((p) => p.id).join(","));
  assert.deepEqual(a, b);
});

test("catálogo com gênero: usa a MESMA ordem da fileira da home e só traz aquele gênero", async () => {
  seed(); today("2026-10-21T15:00:00Z");
  const home = row(await get("/feed/home"), "animes").plays.map((p) => p.id);
  const cat = await get("/?page=1&pageSize=20&genre=animes");
  assert.deepEqual(cat.body.plays.map((p) => p.id), home);
  assert.ok(cat.body.plays.every((p) => p.genres.includes("animes")));
});

test("catálogo com gênero: as páginas somam o gênero inteiro, sem repetir nem perder ninguém", async () => {
  seed(); today("2026-10-21T15:00:00Z");
  const seen = [];
  for (let page = 1; page <= 4; page++) { const r = await get(`/?page=${page}&pageSize=16&genre=dublados`); assert.equal(r.body.total, 60); seen.push(...r.body.plays.map((p) => p.id)); }
  assert.equal(seen.length, 60); assert.equal(new Set(seen).size, 60);
});

test("catálogo: sem gênero (Todos/Novos) ou com ordenação escolhida, continua por data", async () => {
  seed(); today("2026-10-21T15:00:00Z");
  const todos = await get("/?page=1&pageSize=5");
  assert.deepEqual(todos.body.plays.map((p) => p.id), ["p179", "p178", "p177", "p176", "p175"]);
  const explicita = await get("/?page=1&pageSize=5&genre=ia&sort=recent");
  assert.ok(explicita.body.plays.every((p, i, a) => i === 0 || a[i - 1].id > p.id), "sort=recent deve ser por data");
});

test("catálogo: filtro de ano/plano mantém a ordem relativa do gênero inteiro", async () => {
  seed(); today("2026-10-21T15:00:00Z");
  const todas = (await get("/?page=1&pageSize=100&genre=ia")).body.plays.map((p) => p.id);
  const so2024 = await get("/?page=1&pageSize=100&genre=ia&year=2024");
  const esperado = todas.filter((id) => db.plays.find((p) => p.id === id).releaseYear === 2024);
  assert.ok(esperado.length > 0);
  assert.deepEqual(so2024.body.plays.map((p) => p.id), esperado);
});

test("catálogo: a ordem do gênero muda na virada do dia", async () => {
  seed();
  today("2026-10-21T15:00:00Z"); const a = (await get("/?page=1&pageSize=60&genre=ia")).body.plays.map((p) => p.id);
  today("2026-10-22T15:00:00Z"); const b = (await get("/?page=1&pageSize=60&genre=ia")).body.plays.map((p) => p.id);
  assert.notDeepEqual(a, b); assert.deepEqual([...a].sort(), [...b].sort());
});
