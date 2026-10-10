// Testes do fluxo de pagamento, com banco e SyncPay SIMULADOS (rodam sem internet nem banco real).
//   Rodar:  npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
process.env.SYNCPAY_CLIENT_ID = "id";
process.env.SYNCPAY_CLIENT_SECRET = "secret";
process.env.SYNCPAY_WEBHOOK_SECRET = "segredo-do-webhook";
process.env.SITE_URL = "https://exemplo.test";

// ---------- banco em memória (só o que o fluxo de pagamento usa) ----------
const db = { users: [], plans: [], payments: [] };
let seq = 0;
const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("not" in v) return row[k] !== v.not;
    if ("in" in v) return v.in.includes(row[k]);
    if ("gt" in v) return row[k] > v.gt;
    if ("lt" in v) return row[k] < v.lt;
  }
  return row[k] === v;
});
const fake = {
  user: {
    findUnique: async ({ where }) => db.users.find((u) => match(u, where)) || null,
    update: async ({ where, data }) => Object.assign(db.users.find((u) => match(u, where)), data),
  },
  plan: {
    findUnique: async ({ where }) => db.plans.find((p) => match(p, where)) || null,
    findMany: async () => db.plans,
  },
  payment: {
    findUnique: async ({ where }) => db.payments.find((p) => match(p, where)) || null,
    findFirst: async ({ where }) => db.payments.find((p) => match(p, where)) || null,
    findMany: async ({ where }) => db.payments.filter((p) => match(p, where)),
    create: async ({ data }) => { const r = { id: "pay" + ++seq, createdAt: new Date(), paidAt: null, validUntil: null, lastCheckAt: null, ...data }; db.payments.push(r); return r; },
    update: async ({ where, data }) => Object.assign(db.payments.find((p) => match(p, where)), data),
    updateMany: async ({ where, data }) => { const rows = db.payments.filter((p) => match(p, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
  },
  emailLog: { create: async () => ({}), count: async () => 0 },
  $transaction: async (fn) => fn(fake),
};
const clientPath = require.resolve(path.join(__dirname, "../src/prismaClient"));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };

// ---------- SyncPay simulada (intercepta fetch) ----------
const sp = { charges: 0, txStatus: {}, txAmount: {} };
global.fetch = async (url, opts = {}) => {
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (String(url).includes("/v1/auth-token")) return json(200, { access_token: "tok", expires_in: 3600 });
  if (String(url).includes("/v1/cash-in")) {
    const body = JSON.parse(opts.body);
    sp.charges++;
    const id = "ident-" + sp.charges;
    sp.txStatus[id] = "pending"; sp.txAmount[id] = body.amount;
    sp.last = body;
    return json(200, { message: "ok", pix_code: "000201PIX" + id, identifier: id });
  }
  const m = String(url).match(/v2\/transactions\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (!(id in sp.txStatus)) return json(404, {});
    return json(200, { data: { transaction: { reference_id: id, status: sp.txStatus[id], amount: sp.txAmount[id], currency: "BRL", paid_at: new Date().toISOString() } } });
  }
  return json(404, {});
};

const express = require("express");
const { signToken } = require("../src/utils/jwt");
const paymentsRouter = require("../src/routes/payments");

let server, base;
test.before(async () => {
  const app = express(); app.set("trust proxy", 1); app.use(express.json()); app.use("/api/payments", paymentsRouter);
  server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/payments`;
});
test.after(() => server.close());

const realFetch = global.fetch;
async function call(method, p, body, token) {
  // chamadas ao NOSSO servidor usam http real; só as da SyncPay são simuladas
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
    });
    req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

function reset() {
  db.users = [
    { id: "u1", name: "Maria Silva", email: "maria@x.com", role: "user", plan: "plateia", planExpiry: new Date(), status: "ativo" },
    { id: "u2", name: "Outro Usuário", email: "outro@x.com", role: "user", plan: "plateia", planExpiry: new Date(), status: "ativo" },
  ];
  db.plans = [
    { id: "plateia", name: "Plateia", price: 0, sortOrder: 0 },
    { id: "balcao", name: "Balcão", price: 14.9, sortOrder: 1 },
    { id: "camarote", name: "Camarote", price: 24.9, sortOrder: 2 },
  ];
  require("../src/utils/rateLimit")._resetForTests();
  db.payments = []; sp.charges = 0; sp.txStatus = {}; sp.txAmount = {}; seq = 0;
}
const tok = (id) => signToken({ id, role: "user" });
const CPF = "529.982.247-25";

test("checkout: exige login", async () => {
  reset();
  const r = await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" });
  assert.equal(r.status, 401);
});

test("checkout: rejeita CPF inválido, telefone inválido e plano gratuito/inexistente", async () => {
  reset();
  assert.equal((await call("POST", "/checkout", { planId: "balcao", cpf: "111.111.111-11", phone: "63999998888" }, tok("u1"))).status, 400);
  assert.equal((await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "123" }, tok("u1"))).status, 400);
  assert.equal((await call("POST", "/checkout", { planId: "plateia", cpf: CPF, phone: "63999998888" }, tok("u1"))).status, 400);
  assert.equal((await call("POST", "/checkout", { planId: "inexistente", cpf: CPF, phone: "63999998888" }, tok("u1"))).status, 400);
  assert.equal(sp.charges, 0, "nenhuma cobrança pode ter sido criada");
});

test("checkout: o VALOR vem do banco, mesmo que o navegador tente enviar outro", async () => {
  reset();
  const r = await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888", amount: 0.01, price: 1 }, tok("u1"));
  assert.equal(r.status, 201);
  assert.equal(sp.last.amount, 14.9);
  assert.equal(db.payments[0].amount, 14.9);
  assert.ok(r.body.qr.startsWith("data:image/png"));
  assert.ok(sp.last.webhook_url.endsWith("/api/payments/webhook/segredo-do-webhook"));
  assert.equal(db.users[0].plan, "plateia", "plano NÃO pode mudar só por criar a cobrança");
});

test("pagar libera o plano por 30 dias, uma única vez (webhook duplicado/concorrente)", async () => {
  reset();
  const r = await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" }, tok("u1"));
  const pay = db.payments[0];
  assert.equal((await call("GET", "/" + pay.id, null, tok("u1"))).body.payment.status, "pending");

  sp.txStatus[pay.providerId] = "completed";
  const hooks = await Promise.all([1, 2, 3].map(() => call("POST", "/webhook/segredo-do-webhook", { id: pay.providerId })));
  hooks.forEach((h) => assert.equal(h.status, 200));

  const u = db.users[0];
  assert.equal(u.plan, "balcao");
  const days = (new Date(u.planExpiry) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days < 30.1, "validade ≈ 30 dias, foi " + days);
  assert.equal(db.payments.filter((p) => p.status === "paid").length, 1);
  assert.equal(db.payments[0].validUntil.getTime(), new Date(u.planExpiry).getTime());
});

test("webhook FALSO (segredo errado) é ignorado", async () => {
  reset();
  await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" }, tok("u1"));
  const pay = db.payments[0]; sp.txStatus[pay.providerId] = "completed";
  const r = await call("POST", "/webhook/chute-errado", { id: pay.providerId });
  assert.equal(r.status, 404);
  assert.equal(db.users[0].plan, "plateia");
});

test("webhook com segredo certo mas pagamento NÃO concluído na SyncPay não libera nada", async () => {
  reset();
  await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" }, tok("u1"));
  const pay = db.payments[0];
  const r = await call("POST", "/webhook/segredo-do-webhook", { id: pay.providerId, status: "completed" }); // corpo mentiroso
  assert.equal(r.status, 200);
  assert.equal(db.users[0].plan, "plateia");
  assert.equal(db.payments[0].status, "pending");
});

test("valor pago MENOR que o devido não libera o plano", async () => {
  reset();
  await call("POST", "/checkout", { planId: "camarote", cpf: CPF, phone: "63999998888" }, tok("u1"));
  const pay = db.payments[0];
  sp.txStatus[pay.providerId] = "completed"; sp.txAmount[pay.providerId] = 1;
  await call("POST", "/webhook/segredo-do-webhook", { id: pay.providerId });
  assert.equal(db.users[0].plan, "plateia");
});

test("um usuário não consegue ver nem acompanhar o pagamento de outro", async () => {
  reset();
  await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" }, tok("u1"));
  const r = await call("GET", "/" + db.payments[0].id, null, tok("u2"));
  assert.equal(r.status, 404);
});

test("PIX recente e pendente é reaproveitado (sem cobrança duplicada)", async () => {
  reset();
  await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" }, tok("u1"));
  const r2 = await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" }, tok("u1"));
  assert.equal(r2.status, 200); assert.equal(r2.body.reused, true);
  assert.equal(sp.charges, 1);
});

test("renovação antecipada do mesmo plano SOMA 30 dias aos dias restantes", async () => {
  reset();
  db.users[0].plan = "balcao"; db.users[0].planExpiry = new Date(Date.now() + 10 * 86400000);
  await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" }, tok("u1"));
  const pay = db.payments[0]; sp.txStatus[pay.providerId] = "completed";
  await call("GET", "/" + pay.id, null, tok("u1"));
  const days = (new Date(db.users[0].planExpiry) - Date.now()) / 86400000;
  assert.ok(days > 39.9 && days < 40.1, "esperado ≈ 40 dias, foi " + days);
});

test("pagamento cancelado na tela, mas pago de fato, ainda é reconhecido na conferência", async () => {
  reset();
  await call("POST", "/checkout", { planId: "balcao", cpf: CPF, phone: "63999998888" }, tok("u1"));
  const pay = db.payments[0];
  await call("POST", `/${pay.id}/cancel`, {}, tok("u1"));
  assert.equal(db.payments[0].status, "canceled");
  assert.equal(db.users[0].plan, "plateia", "cancelar não libera nada");
  sp.txStatus[pay.providerId] = "completed";
  const { reconcile } = require("../src/services/payments");
  const out = await reconcile();
  assert.equal(out.confirmados, 1);
  assert.equal(db.users[0].plan, "balcao");
});

test("limite de tentativas: o 7º checkout seguido é bloqueado", async () => {
  reset();
  let last;
  for (let i = 0; i < 7; i++) last = await call("POST", "/checkout", { planId: "balcao", cpf: "000", phone: "1" }, tok("u1"));
  assert.equal(last.status, 429);
});
