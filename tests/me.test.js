// "Continue Assistindo" e "Minha Lista" (banco simulado).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const db = { users: [], plays: [], wp: [], list: [] };
let clock = 1000;
const full = (p) => ({ ...p, genres: [] });
const fake = {
  user: { findUnique: async ({ where }) => db.users.find((u) => u.id === where.id) || null },
  plan: { findMany: async () => [{ id: "plateia", name: "Plateia", price: 0, sortOrder: 0 }, { id: "balcao", name: "Balcão", price: 14.9, sortOrder: 1 }], findUnique: async () => null },
  play: {
    findMany: async ({ where }) => db.plays.filter((p) => where.id.in.includes(p.id)).map(full),
    findUnique: async ({ where, select }) => { const p = db.plays.find((x) => x.id === where.id); return p ? (select && select.id && Object.keys(select).length === 1 ? { id: p.id } : full(p)) : null; },
  },
  watchProgress: {
    findMany: async ({ where, orderBy, take }) => db.wp.filter((w) => w.userId === where.userId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, take),
    findUnique: async ({ where }) => db.wp.find((w) => w.userId === where.userId_playId.userId && w.playId === where.userId_playId.playId) || null,
    upsert: async ({ where, update, create }) => { const k = where.userId_playId; const w = db.wp.find((x) => x.userId === k.userId && x.playId === k.playId); if (w) Object.assign(w, update, { updatedAt: ++clock }); else db.wp.push({ ...create, updatedAt: ++clock }); return {}; },
    deleteMany: async ({ where }) => { db.wp = db.wp.filter((w) => !(w.userId === where.userId && w.playId === where.playId)); return {}; },
  },
  myListItem: {
    findMany: async ({ where, orderBy }) => db.list.filter((i) => i.userId === where.userId).sort((a, b) => b.createdAt - a.createdAt),
    findUnique: async ({ where }) => db.list.find((i) => i.userId === where.userId_playId.userId && i.playId === where.userId_playId.playId) || null,
    count: async ({ where }) => db.list.filter((i) => i.userId === where.userId).length,
    create: async ({ data }) => { db.list.push({ ...data, createdAt: ++clock }); return {}; },
    deleteMany: async ({ where }) => { db.list = db.list.filter((i) => !(i.userId === where.userId && i.playId === where.playId)); return {}; },
  },
};
const clientPath = require.resolve(path.join(__dirname, "../src/prismaClient"));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };
const express = require("express");
const { signToken } = require("../src/utils/jwt");
const { _resetForTests } = require("../src/utils/rateLimit");
const meRouter = require("../src/routes/me");
const playsRouter = require("../src/routes/plays");

let server, base;
test.before(async () => {
  const app = express(); app.set("trust proxy", 1); app.use(express.json());
  app.use("/api/me", meRouter); app.use("/api/plays", playsRouter);
  server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());
const call = (method, p, body, token) => new Promise((resolve, reject) => {
  const req = http.request(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } }, (res) => {
    let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
  });
  req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
});
const A = () => signToken({ id: "ana", role: "user" });
const B = () => signToken({ id: "beto", role: "user" });

function reset() {
  _resetForTests(); clock = 1000;
  db.users = [{ id: "ana", role: "user", status: "ativo", plan: "balcao", planExpiry: new Date(Date.now() + 864e5) }, { id: "beto", role: "user", status: "ativo", plan: "plateia", planExpiry: new Date() }];
  const mk = (id, plan) => ({ id, title: "Série " + id, durationMinutes: 90, releaseYear: 2024, synopsis: ".", director: "", cast: "", posterUrl: "", backdropUrl: "", videoUrl: "https://segredo/" + id, requiresPlan: plan, featured: false, createdAt: new Date(), updatedAt: new Date(), hasPosterData: false, hasBackdropData: false, announcedAt: null });
  db.plays = [mk("a", "plateia"), mk("b", "plateia"), mk("c", "balcao")];
  db.wp = []; db.list = [];
}
const put = (id, position, duration = 5400, t = A()) => call("PUT", "/me/progress/" + id, { position, duration }, t);

test("tudo exige login", async () => {
  reset();
  assert.equal((await call("GET", "/me/home")).status, 401);
  assert.equal((await call("PUT", "/me/progress/a", { position: 100, duration: 5400 })).status, 401);
  assert.equal((await call("PUT", "/me/list/a")).status, 401);
});

test("salvar progresso e ver em 'Continue Assistindo', mais recente primeiro, sem vazar o vídeo", async () => {
  reset();
  assert.equal((await put("a", 600)).status, 200);
  assert.equal((await put("b", 1200)).status, 200);
  assert.equal((await put("a", 900)).status, 200);
  const r = await call("GET", "/me/home", null, A());
  assert.deepEqual(r.body.continue.map((p) => p.id), ["a", "b"]);
  assert.equal(r.body.continue[0].progress.position, 900);
  assert.equal(r.body.continue[0].canWatch, true);
  assert.ok(!JSON.stringify(r.body).includes("segredo"));
});

test("terminar (95%+) tira do 'Continue Assistindo'; começo (<5 s) não é gravado", async () => {
  reset();
  await put("a", 600);
  assert.equal((await put("a", 5200)).body.finished, true);
  assert.equal((await call("GET", "/me/home", null, A())).body.continue.length, 0);
  assert.equal((await put("b", 2)).body.ignored, true);
  assert.equal(db.wp.length, 0);
});

test("cada pessoa só vê o próprio progresso e a própria lista", async () => {
  reset();
  await put("a", 600, 5400, A());
  await call("PUT", "/me/list/b", null, A());
  const beto = (await call("GET", "/me/home", null, B())).body;
  assert.deepEqual(beto.continue, []); assert.deepEqual(beto.listIds, []);
  assert.deepEqual((await call("GET", "/me/home", null, A())).body.listIds, ["b"]);
});

test("recusa dados inválidos e série inexistente", async () => {
  reset();
  assert.equal((await put("a", -5)).status, 400);
  assert.equal((await put("a", 100, 10)).status, 400, "duração menor que 1 min");
  assert.equal((await put("a", 99999, 5400)).status, 400, "posição maior que a duração");
  assert.equal((await call("PUT", "/me/progress/a", { position: "x", duration: 5400 }, A())).status, 400);
  assert.equal((await put("naoexiste", 600)).status, 404);
});

test("Minha Lista: adicionar é idempotente, listar e remover", async () => {
  reset();
  await call("PUT", "/me/list/a", null, A()); await call("PUT", "/me/list/a", null, A()); await call("PUT", "/me/list/c", null, A());
  assert.equal(db.list.length, 2, "sem duplicar");
  const l = await call("GET", "/me/list", null, A());
  assert.deepEqual(l.body.plays.map((p) => p.id), ["c", "a"], "mais recente primeiro");
  assert.equal((await call("PUT", "/me/list/naoexiste", null, A())).status, 404);
  await call("DELETE", "/me/list/a", null, A());
  assert.deepEqual((await call("GET", "/me/home", null, A())).body.listIds, ["c"]);
});

test("o detalhe da série devolve 'resume' só para quem está logado e pode assistir", async () => {
  reset();
  await put("a", 1234);
  assert.deepEqual((await call("GET", "/plays/a", null, A())).body.resume, { position: 1234, duration: 5400 });
  assert.equal((await call("GET", "/plays/a")).body.resume, null, "visitante: sem resume");
  assert.equal((await call("GET", "/plays/a", null, B())).body.resume, null, "outro usuário: sem resume");
  await put("c", 600);
  assert.equal((await call("GET", "/plays/c", null, B())).body.resume, null, "sem direito ao plano: sem resume");
});

test("remover do 'Continue Assistindo'", async () => {
  reset();
  await put("a", 600);
  await call("DELETE", "/me/progress/a", null, A());
  assert.equal((await call("GET", "/me/home", null, A())).body.continue.length, 0);
});
