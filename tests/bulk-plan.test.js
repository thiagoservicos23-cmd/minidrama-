// Testes da mudança de plano em massa (banco simulado).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const db = { users: [], plans: [], plays: [] };
const fake = {
  user: { findUnique: async ({ where }) => db.users.find((u) => u.id === where.id) || null },
  plan: { findUnique: async ({ where }) => db.plans.find((p) => p.id === where.id) || null, findMany: async () => db.plans },
  play: {
    groupBy: async () => { const m = {}; db.plays.forEach((p) => (m[p.requiresPlan] = (m[p.requiresPlan] || 0) + 1)); return Object.entries(m).map(([k, n]) => ({ requiresPlan: k, _count: { _all: n } })); },
    updateMany: async ({ where, data }) => { const rows = db.plays.filter((p) => p.requiresPlan === where.requiresPlan); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
  },
};
const clientPath = require.resolve(path.join(__dirname, "../src/prismaClient"));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };

const express = require("express");
const { signToken } = require("../src/utils/jwt");
const playsRouter = require("../src/routes/plays");
let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use("/api/plays", playsRouter);
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
function reset() {
  db.users = [{ id: "adm", role: "admin", status: "ativo" }, { id: "usr", role: "user", status: "ativo" }];
  db.plans = [{ id: "plateia", name: "Plateia", price: 0 }, { id: "balcao", name: "Balcão", price: 14.9 }, { id: "camarote", name: "Camarote", price: 24.9 }];
  db.plays = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: "a" + i, requiresPlan: "plateia" })),
    { id: "b0", requiresPlan: "balcao" }, { id: "c0", requiresPlan: "camarote" },
  ];
}
const adm = () => signToken({ id: "adm", role: "admin" });
const usr = () => signToken({ id: "usr", role: "user" });

test("só admin consegue mover em massa (visitante e usuário comum são barrados)", async () => {
  reset();
  assert.equal((await call("POST", "/bulk-plan", { from: "plateia", to: "balcao" })).status, 401);
  assert.equal((await call("POST", "/bulk-plan", { from: "plateia", to: "balcao" }, usr())).status, 403);
  assert.equal((await call("GET", "/admin/plan-counts", null, usr())).status, 403);
  assert.ok(db.plays.filter((p) => p.requiresPlan === "plateia").length === 4, "nada mudou");
});

test("move todas de Plateia para Balcão e não mexe nas outras", async () => {
  reset();
  const r = await call("POST", "/bulk-plan", { from: "plateia", to: "balcao" }, adm());
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, 4);
  assert.equal(db.plays.filter((p) => p.requiresPlan === "plateia").length, 0);
  assert.equal(db.plays.filter((p) => p.requiresPlan === "balcao").length, 5);
  assert.equal(db.plays.find((p) => p.id === "c0").requiresPlan, "camarote", "Camarote intacto");
});

test("recusa planos iguais, ausentes ou inexistentes", async () => {
  reset();
  assert.equal((await call("POST", "/bulk-plan", { from: "balcao", to: "balcao" }, adm())).status, 400);
  assert.equal((await call("POST", "/bulk-plan", { from: "balcao" }, adm())).status, 400);
  assert.equal((await call("POST", "/bulk-plan", { from: "balcao", to: "fantasma" }, adm())).status, 400);
  assert.equal((await call("POST", "/bulk-plan", { from: "fantasma", to: "balcao" }, adm())).status, 400);
});

test("contagem por plano para o aviso antes de mover", async () => {
  reset();
  const r = await call("GET", "/admin/plan-counts", null, adm());
  assert.deepEqual(r.body.counts, { plateia: 4, balcao: 1, camarote: 1 });
  assert.equal(r.body.total, 6);
});
