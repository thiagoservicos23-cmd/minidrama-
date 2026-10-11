// Testes da recuperação de senha por e-mail (banco e envio de e-mail SIMULADOS).
//   Rodar:  npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "teste";
process.env.SITE_URL = "https://exemplo.test";
process.env.BREVO_API_KEY = "k";
process.env.MAIL_FROM_EMAIL = "no-reply@exemplo.test";

const db = { users: [], resets: [] };
let seq = 0;
const eq = (row, where = {}) => Object.entries(where).every(([k, v]) => (v === null ? row[k] === null || row[k] === undefined : row[k] === v));
const fake = {
  user: {
    findUnique: async ({ where }) => db.users.find((u) => eq(u, where)) || null,
    update: async ({ where, data }) => Object.assign(db.users.find((u) => eq(u, where)), data),
  },
  passwordReset: {
    create: async ({ data }) => { const r = { id: "r" + ++seq, usedAt: null, createdAt: new Date(), ...data }; db.resets.push(r); return r; },
    findUnique: async ({ where }) => db.resets.find((r) => eq(r, where)) || null,
    updateMany: async ({ where, data }) => { const rows = db.resets.filter((r) => eq(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
    deleteMany: async ({ where }) => { const keep = db.resets.filter((r) => !eq(r, where)); const n = db.resets.length - keep.length; db.resets = keep; return { count: n }; },
  },
  $transaction: async (fn) => fn(fake),
};
const clientPath = require.resolve(path.join(__dirname, "../src/prismaClient"));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };

const mailer = require("../src/services/mailer");
const sent = [];
mailer.sendMail = async (m) => { sent.push(m); return { ok: true }; };   // captura em vez de enviar

const express = require("express");
const authRouter = require("../src/routes/auth");
const { _resetForTests } = require("../src/utils/rateLimit");

let server, base;
test.before(async () => {
  const app = express(); app.set("trust proxy", 1); app.use(express.json()); app.use("/api/auth", authRouter);
  server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
test.after(() => server.close());

function call(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
    });
    req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
const settle = () => new Promise((r) => setTimeout(r, 120));   // o servidor continua trabalhando depois de responder
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const tokenFromEmail = (m) => /redefinir-senha\?token=([a-f0-9]{64})/.exec(m.html)[1];

function reset() {
  _resetForTests(); sent.length = 0; db.resets = []; seq = 0;
  db.users = [
    { id: "u1", name: "Maria Silva", email: "maria@x.com", role: "user", status: "ativo", password: bcrypt.hashSync("senhaantiga1", 4), plan: "plateia", planExpiry: new Date(), lastSeenAt: new Date(), passwordChangedAt: null },
    { id: "u2", name: "Bloqueado", email: "bloq@x.com", role: "user", status: "bloqueado", password: bcrypt.hashSync("x", 4), plan: "plateia", planExpiry: new Date(), lastSeenAt: new Date(), passwordChangedAt: null },
  ];
}

test("a resposta é idêntica para e-mail cadastrado e não cadastrado (ninguém descobre quem tem conta)", async () => {
  reset();
  const a = await call("POST", "/forgot-password", { email: "maria@x.com" });
  const b = await call("POST", "/forgot-password", { email: "naoexiste@x.com" });
  await settle();
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(a.body, b.body);
  assert.equal(sent.length, 1, "só a conta existente recebe e-mail");
  assert.equal(sent[0].to, "maria@x.com");
});

test("conta bloqueada não recebe link; e-mail em formato inválido é recusado", async () => {
  reset();
  await call("POST", "/forgot-password", { email: "bloq@x.com" });
  await settle();
  assert.equal(sent.length, 0);
  assert.equal((await call("POST", "/forgot-password", { email: "isso-nao-e-email" })).status, 400);
});

test("o banco guarda só o HASH do token, nunca o token", async () => {
  reset();
  await call("POST", "/forgot-password", { email: "maria@x.com" }); await settle();
  const token = tokenFromEmail(sent[0]);
  assert.equal(db.resets.length, 1);
  assert.equal(db.resets[0].tokenHash, sha(token));
  assert.ok(!JSON.stringify(db.resets).includes(token));
  assert.ok(sent[0].html.includes("https://exemplo.test/#/redefinir-senha?token="));
  const mins = (db.resets[0].expiresAt - Date.now()) / 60000;
  assert.ok(mins > 59 && mins <= 60, "validade ≈ 60 min, foi " + mins);
});

test("fluxo completo: o link troca a senha, vale UMA vez e derruba logins antigos", async () => {
  reset();
  const oldTok = jwt.sign({ sub: "u1", role: "user", iat: Math.floor(Date.now() / 1000) - 120 }, "teste", { expiresIn: "30d" });
  assert.equal((await call("GET", "/me", null, oldTok)).status, 200, "login antigo funciona antes");

  await call("POST", "/forgot-password", { email: "maria@x.com" }); await settle();
  const token = tokenFromEmail(sent[0]);

  const r = await call("POST", "/reset-password", { token, newPassword: "NovaSenha123" });
  assert.equal(r.status, 200);
  await settle();
  assert.ok(await bcrypt.compare("NovaSenha123", db.users[0].password));
  assert.ok(sent.some((m) => /alterada/i.test(m.subject)), "avisa por e-mail que a senha mudou");

  assert.equal((await call("POST", "/reset-password", { token, newPassword: "OutraSenha456" })).status, 400, "o mesmo link NÃO pode ser usado de novo");
  assert.ok(await bcrypt.compare("NovaSenha123", db.users[0].password), "senha continua a primeira nova");

  assert.equal((await call("GET", "/me", null, oldTok)).status, 401, "login antigo deixou de valer");
  assert.equal((await call("POST", "/login", { email: "maria@x.com", password: "senhaantiga1" })).status, 401, "senha antiga não entra mais");
  const login = await call("POST", "/login", { email: "maria@x.com", password: "NovaSenha123" });
  assert.equal(login.status, 200);
  assert.equal((await call("GET", "/me", null, login.body.token)).status, 200, "login novo funciona");
});

test("pedir um novo link invalida o anterior", async () => {
  reset();
  await call("POST", "/forgot-password", { email: "maria@x.com" }); await settle();
  const first = tokenFromEmail(sent[0]);
  await call("POST", "/forgot-password", { email: "maria@x.com" }); await settle();
  const second = tokenFromEmail(sent[1]);
  assert.notEqual(first, second);
  assert.equal((await call("POST", "/reset-password", { token: first, newPassword: "NovaSenha123" })).status, 400);
  assert.equal((await call("POST", "/reset-password", { token: second, newPassword: "NovaSenha123" })).status, 200);
});

test("link expirado, token falso e senha curta são recusados", async () => {
  reset();
  await call("POST", "/forgot-password", { email: "maria@x.com" }); await settle();
  const token = tokenFromEmail(sent[0]);
  assert.equal((await call("POST", "/reset-password", { token: "a".repeat(64), newPassword: "NovaSenha123" })).status, 400, "token falso");
  assert.equal((await call("POST", "/reset-password", { token: "curto", newPassword: "NovaSenha123" })).status, 400);
  assert.equal((await call("POST", "/reset-password", { token, newPassword: "123" })).status, 400, "senha curta");
  assert.ok(await bcrypt.compare("senhaantiga1", db.users[0].password), "nada mudou até aqui");
  db.resets[0].expiresAt = new Date(Date.now() - 1000);
  assert.equal((await call("POST", "/reset-password", { token, newPassword: "NovaSenha123" })).status, 400, "expirado");
  assert.ok(await bcrypt.compare("senhaantiga1", db.users[0].password));
});

test("dois usos simultâneos do mesmo link: só um funciona", async () => {
  reset();
  await call("POST", "/forgot-password", { email: "maria@x.com" }); await settle();
  const token = tokenFromEmail(sent[0]);
  const rs = await Promise.all([call("POST", "/reset-password", { token, newPassword: "SenhaA12345" }), call("POST", "/reset-password", { token, newPassword: "SenhaB12345" })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400]);
});

test("limite: no máximo 3 e-mails por hora para o mesmo endereço", async () => {
  reset();
  for (let i = 0; i < 5; i++) { await call("POST", "/forgot-password", { email: "maria@x.com" }); await settle(); }
  assert.equal(sent.length, 3);
});

test("limite por IP: o 9º pedido seguido é bloqueado", async () => {
  reset();
  let last;
  for (let i = 0; i < 9; i++) last = await call("POST", "/forgot-password", { email: `x${i}@x.com` });
  assert.equal(last.status, 429);
});

test("sem e-mail configurado o site avisa em vez de fingir que enviou", async () => {
  reset();
  const k = process.env.BREVO_API_KEY; delete process.env.BREVO_API_KEY;
  const r = await call("POST", "/forgot-password", { email: "maria@x.com" });
  process.env.BREVO_API_KEY = k;
  assert.equal(r.status, 503);
});

test("trocar a senha logado devolve um login novo e derruba os antigos", async () => {
  reset();
  const oldTok = jwt.sign({ sub: "u1", role: "user", iat: Math.floor(Date.now() / 1000) - 120 }, "teste", { expiresIn: "30d" });
  const r = await call("POST", "/change-password", { currentPassword: "senhaantiga1", newPassword: "NovaSenha123" }, oldTok);
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal((await call("GET", "/me", null, oldTok)).status, 401, "login antigo caiu");
  assert.equal((await call("GET", "/me", null, r.body.token)).status, 200, "login novo (deste aparelho) segue valendo");
  assert.equal((await call("POST", "/change-password", { currentPassword: "errada", newPassword: "OutraSenha123" }, r.body.token)).status, 400);
});
