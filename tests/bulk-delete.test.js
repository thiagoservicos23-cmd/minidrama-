// Exclusão em massa de todas as novelinhas de um plano (banco simulado).
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
    count: async ({ where }) => db.plays.filter((p) => p.requiresPlan === where.requiresPlan).length,
    deleteMany: async ({ where }) => {
      const before = db.plays.length;
      db.plays = db.plays.filter((p) => p.requiresPlan !== where.requiresPlan);
      return { count: before - db.plays.length };
    },
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
    { id: "b0", requiresPlan: "balcao" },
    ...Array.from({ length: 3 }, (_, i) => ({ id: "c" + i, requiresPlan: "camarote" })),
  ];
}
const adm = () => signToken({ id: "adm", role: "admin" });
const usr = () => signToken({ id: "usr", role: "user" });
const ids = (plan) => db.plays.filter((p) => p.requiresPlan === plan).length;

test("só admin consegue excluir (visitante e usuário comum são barrados)", async () => {
  reset();
  const body = { plan: "camarote", confirmName: "Camarote", expectedCount: 3 };
  assert.equal((await call("POST", "/bulk-delete", body)).status, 401);
  assert.equal((await call("POST", "/bulk-delete", body, usr())).status, 403);
  assert.equal(db.plays.length, 8, "nada foi apagado");
});

test("exclui só as novelinhas do plano escolhido e não mexe nos outros", async () => {
  reset();
  const r = await call("POST", "/bulk-delete", { plan: "camarote", confirmName: "Camarote", expectedCount: 3 }, adm());
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, 3);
  assert.equal(r.body.plan, "Camarote");
  assert.equal(ids("camarote"), 0);
  assert.equal(ids("plateia"), 4, "Plateia intacta");
  assert.equal(ids("balcao"), 1, "Balcão intacto");
  assert.ok(db.plans.find((p) => p.id === "camarote"), "o plano em si continua existindo");
});

test("funciona para Plateia também, e o nome digitado ignora maiúsculas e espaços", async () => {
  reset();
  const r = await call("POST", "/bulk-delete", { plan: "plateia", confirmName: "  pLaTeIa ", expectedCount: 4 }, adm());
  assert.equal(r.status, 200);
  assert.equal(ids("plateia"), 0);
  assert.equal(db.plays.length, 4);
});

test("recusa sem o nome do plano ou com nome errado", async () => {
  reset();
  assert.equal((await call("POST", "/bulk-delete", { plan: "camarote", expectedCount: 3 }, adm())).status, 400);
  assert.equal((await call("POST", "/bulk-delete", { plan: "camarote", confirmName: "Balcão", expectedCount: 3 }, adm())).status, 400);
  assert.equal(db.plays.length, 8, "nada foi apagado");
});

test("recusa quando a quantidade mudou desde que o modal abriu (409) ou veio sem quantidade", async () => {
  reset();
  assert.equal((await call("POST", "/bulk-delete", { plan: "camarote", confirmName: "Camarote", expectedCount: 2 }, adm())).status, 409);
  assert.equal((await call("POST", "/bulk-delete", { plan: "camarote", confirmName: "Camarote" }, adm())).status, 409);
  assert.equal((await call("POST", "/bulk-delete", { plan: "camarote", confirmName: "Camarote", expectedCount: "3" }, adm())).status, 409);
  assert.equal(ids("camarote"), 3, "nada foi apagado");
});

test("recusa plano ausente, inexistente ou vazio", async () => {
  reset();
  assert.equal((await call("POST", "/bulk-delete", {}, adm())).status, 400);
  assert.equal((await call("POST", "/bulk-delete", { plan: "fantasma", confirmName: "x", expectedCount: 1 }, adm())).status, 400);
  db.plays = db.plays.filter((p) => p.requiresPlan !== "camarote");
  const r = await call("POST", "/bulk-delete", { plan: "camarote", confirmName: "Camarote", expectedCount: 0 }, adm());
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Nenhuma novelinha/);
});
