// Renomear um gênero no painel NÃO pode tirar nenhuma série dele (banco simulado).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const db = { users: [], plays: [], pg: [], labels: [] };
const withGenres = (p, select) => ({ ...p, ...(select && select.genres ? { genres: db.pg.filter((x) => x.playId === p.id).map((x) => ({ genre: x.genre })) } : {}) });
const fake = {
  user: { findUnique: async ({ where }) => db.users.find((u) => u.id === where.id) || null },
  plan: { findMany: async () => [], findUnique: async () => null },
  play: {
    findMany: async (a = {}) => {
      const { where = {}, orderBy, take, skip = 0, select } = a;
      let r = db.plays.filter((p) => Object.entries(where).every(([k, v]) => (k === "genres" ? db.pg.some((x) => x.playId === p.id && x.genre === v.some.genre) : (k === "id" && v && typeof v === "object") ? v.in.includes(p.id) : p[k] === v)));
      if (orderBy && orderBy.createdAt === "desc") r = r.slice().sort((a, b) => b.createdAt - a.createdAt);
      if (!select) return r.map((p) => ({ id: p.id, title: p.title }));
      return r.slice(skip, take ? skip + take : undefined).map((p) => withGenres(p, select));
    },
    findUnique: async ({ where, select }) => { const p = db.plays.find((q) => q.id === where.id); return p ? withGenres(p, select) : null; },
    count: async ({ where = {} } = {}) => db.plays.filter((p) => Object.entries(where).every(([k, v]) => (k === "genres" ? db.pg.some((x) => x.playId === p.id && x.genre === v.some.genre) : p[k] === v))).length,
  },
  playGenre: {
    groupBy: async () => { const m = {}; db.pg.forEach((x) => (m[x.genre] = (m[x.genre] || 0) + 1)); return Object.entries(m).map(([genre, n]) => ({ genre, _count: { _all: n } })); },
    deleteMany: async ({ where }) => { const ids = where.playId.in; db.pg = db.pg.filter((x) => !ids.includes(x.playId)); return { count: 0 }; },
    createMany: async ({ data }) => { data.forEach((d) => db.pg.push({ ...d })); return { count: data.length }; },
    findMany: async ({ where } = {}) => (where && where.playId ? db.pg.filter((x) => where.playId.in.includes(x.playId)) : db.pg.map((x) => ({ genre: x.genre, playId: x.playId }))),   // sem where: todos os pares (a home usa isso)
  },
  genreLabel: {
    findMany: async () => db.labels.map((l) => ({ ...l })),
    upsert: async ({ where, update, create }) => { const l = db.labels.find((x) => x.id === where.id); if (l) Object.assign(l, update); else db.labels.push({ ...create }); return {}; },
    deleteMany: async ({ where }) => { db.labels = db.labels.filter((x) => x.id !== where.id); return { count: 1 }; },
  },
  $transaction: async (ops) => Promise.all(ops),
};
const clientPath = require.resolve(path.join(__dirname, "../src/prismaClient"));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };
const express = require("express");
const { signToken } = require("../src/utils/jwt");
const G = require("../src/utils/genres");
const router = require("../src/routes/plays");

let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use("/api/plays", router);
  server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/plays`;
});
test.after(() => server.close());
const call = (method, p, body, token) => new Promise((resolve, reject) => {
  const req = http.request(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } }, (res) => {
    let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
  });
  req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
});
const adm = () => signToken({ id: "adm", role: "admin" });

function reset() {
  G._resetLabelsForTests();
  db.users = [{ id: "adm", role: "admin", status: "ativo" }, { id: "usr", role: "user", status: "ativo" }];
  db.labels = [];
  const mk = (i) => ({ id: "p" + i, title: "Série " + i, durationMinutes: 90, releaseYear: 2024, synopsis: ".", director: "", cast: "", posterUrl: "", backdropUrl: "", videoUrl: "x", requiresPlan: "balcao", featured: false, createdAt: new Date(2026, 0, 1, 0, 0, i), updatedAt: new Date(), hasPosterData: false, hasBackdropData: false, announcedAt: null });
  db.plays = Array.from({ length: 8 }, (_, i) => mk(i));
  db.pg = [];
  db.plays.forEach((p, i) => { db.pg.push({ playId: p.id, genre: i % 2 ? "dublados" : "animes" }); });
  db.pg.push({ playId: "p0", genre: "dublados" });          // p0: dois gêneros
}

test("só admin renomeia", async () => {
  reset();
  assert.equal((await call("PUT", "/admin/genres/dublados", { label: "X" })).status, 401);
  assert.equal((await call("PUT", "/admin/genres/dublados", { label: "X" }, signToken({ id: "usr", role: "user" }))).status, 403);
  assert.equal((await call("GET", "/admin/genres", null, signToken({ id: "usr", role: "user" }))).status, 403);
});

test("a lista mostra nome atual, nome original e quantas séries há em cada gênero", async () => {
  reset();
  const r = await call("GET", "/admin/genres", null, adm());
  const d = r.body.genres.find((g) => g.id === "dublados");
  assert.equal(r.body.genres.length, 10);
  assert.deepEqual([d.label, d.defaultLabel, d.renamed, d.total], ["Dublados", "Dublados", false, 5]);
});

test("RENOMEAR NÃO TIRA NENHUMA SÉRIE: mesmas séries, mesmas seções, só o nome muda", async () => {
  reset();
  const antes = JSON.stringify(db.pg);
  const feedAntes = (await call("GET", "/feed/home")).body.genres.find((g) => g.id === "dublados");
  const r = await call("PUT", "/admin/genres/dublados", { label: "🎧 Dubladas em PT-BR" }, adm());
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(db.pg), antes, "nenhuma ligação série↔gênero foi alterada");

  const feed = (await call("GET", "/feed/home")).body;
  const row = feed.genres.find((g) => g.id === "dublados");
  assert.equal(row.label, "🎧 Dubladas em PT-BR", "a seção mostra o nome novo");
  assert.deepEqual(row.plays.map((p) => p.id), feedAntes.plays.map((p) => p.id), "as MESMAS séries continuam na seção");
  assert.equal(row.total, feedAntes.total);
  assert.equal(feed.catalog.find((g) => g.id === "dublados").label, "🎧 Dubladas em PT-BR", "o catálogo/filtros também");

  const filtro = await call("GET", "/?page=1&pageSize=50&genre=dublados");          // o filtro continua pelo id
  assert.equal(filtro.body.total, 5);
  assert.ok(filtro.body.plays.every((p) => p.genreLabels.includes("🎧 Dubladas em PT-BR")), "cada série mostra o nome novo");
  const p0 = (await call("GET", "/p0")).body.play;
  assert.deepEqual(p0.genres, ["dublados", "animes"], "p0 continua com os 2 gêneros");
  assert.deepEqual(p0.genreLabels, ["🎧 Dubladas em PT-BR", "Animes"]);
});

test("a planilha de gêneros aceita o nome NOVO e continua aceitando o original", async () => {
  reset();
  await call("PUT", "/admin/genres/animes", { label: "Animê & Cia" }, adm());
  const rows = [{ name: "Série 3", genres: ["Animê & Cia"] }, { name: "Série 5", genres: ["Animes"] }];
  const r = await call("POST", "/genres-import", { rows, mode: "replace", dryRun: true }, adm());
  assert.equal(r.body.playsToUpdate, 2);
  assert.deepEqual(r.body.byGenre, { animes: 2 });
  assert.deepEqual(r.body.unknownGenres, []);
});

test("recusa nome vazio, comprido demais, com < >, reservado ou igual ao de OUTRO gênero", async () => {
  reset();
  const put = (label) => call("PUT", "/admin/genres/dublados", { label }, adm());
  assert.equal((await put("   ")).status, 400);
  assert.equal((await put("x".repeat(41))).status, 400);
  assert.equal((await put("<b>Oi</b>")).status, 400);
  assert.equal((await put("Novos Na Plataforma")).status, 400, "reservado");
  const dup = await put("🤖 IA");
  assert.equal(dup.status, 400); assert.ok(/já é usado/.test(dup.body.error));
  assert.equal((await put("animes")).status, 400, "nome de outro gênero, mesmo sem acento/maiúscula");
  assert.equal((await call("PUT", "/admin/genres/inexistente", { label: "X" }, adm())).status, 404);
  assert.deepEqual(db.labels, [], "nada foi gravado");
});

test("voltar ao nome original: botão 'restaurar' ou digitar o nome original", async () => {
  reset();
  await call("PUT", "/admin/genres/ia", { label: "Inteligência Artificial" }, adm());
  assert.equal(db.labels.length, 1);
  await call("PUT", "/admin/genres/ia", { reset: true }, adm());
  assert.equal(db.labels.length, 0);
  assert.equal((await call("GET", "/admin/genres", null, adm())).body.genres.find((g) => g.id === "ia").label, "🤖 IA");
  await call("PUT", "/admin/genres/ia", { label: "Outro" }, adm());
  await call("PUT", "/admin/genres/ia", { label: "🤖 IA" }, adm());
  assert.equal(db.labels.length, 0, "igual ao original = sem personalização");
});

test("o nome novo pode ser usado por outro gênero depois que o antigo dono troca", async () => {
  reset();
  await call("PUT", "/admin/genres/dublados", { label: "Versão Brasileira" }, adm());
  assert.equal((await call("PUT", "/admin/genres/animes", { label: "Versão Brasileira" }, adm())).status, 400, "ocupado");
  await call("PUT", "/admin/genres/dublados", { label: "Dublados" }, adm());
  assert.equal((await call("PUT", "/admin/genres/animes", { label: "Versão Brasileira" }, adm())).status, 200, "liberado");
});
