// Importação de gêneros por planilha e gravação de vários gêneros por série (banco simulado).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");

process.env.JWT_SECRET = "teste";
const db = { users: [], plays: [], pg: [] };
let seq = 0;
const genresOf = (id) => db.pg.filter((x) => x.playId === id).map((x) => ({ genre: x.genre }));
const fake = {
  user: { findUnique: async ({ where }) => db.users.find((u) => u.id === where.id) || null },
  play: {
    findMany: async () => db.plays.map((p) => ({ id: p.id, title: p.title })),
    create: async ({ data }) => {
      const { genres, ...rest } = data; const p = { id: "n" + ++seq, createdAt: new Date(), updatedAt: new Date(), videoUrl: "", ...rest }; db.plays.push(p);
      (genres.create || []).forEach((g) => db.pg.push({ playId: p.id, genre: g.genre }));
      return { ...p, genres: genresOf(p.id) };
    },
    update: async ({ where, data }) => {
      const p = db.plays.find((x) => x.id === where.id); if (!p) throw new Error("nf");
      const { genres, ...rest } = data; Object.assign(p, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (genres) { if (genres.deleteMany) db.pg = db.pg.filter((x) => x.playId !== p.id); (genres.create || []).forEach((g) => db.pg.push({ playId: p.id, genre: g.genre })); }
      return { ...p, genres: genresOf(p.id) };
    },
  },
  playGenre: {
    deleteMany: async ({ where }) => { const ids = where.playId.in; const n = db.pg.filter((x) => ids.includes(x.playId)).length; db.pg = db.pg.filter((x) => !ids.includes(x.playId)); return { count: n }; },
    createMany: async ({ data }) => { data.forEach((d) => db.pg.push({ ...d })); return { count: data.length }; },
    findMany: async ({ where }) => db.pg.filter((x) => where.playId.in.includes(x.playId)),
  },
  $transaction: async (ops) => Promise.all(ops),
};
const clientPath = require.resolve(path.join(__dirname, "../src/prismaClient"));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };
const express = require("express");
const { signToken } = require("../src/utils/jwt");
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
const gl = (id) => db.pg.filter((x) => x.playId === id).map((x) => x.genre).sort();

function reset() {
  seq = 0;
  db.users = [{ id: "adm", role: "admin", status: "ativo" }, { id: "usr", role: "user", status: "ativo" }];
  db.plays = [
    { id: "a", title: "A Farsa do Silêncio" }, { id: "b", title: "Ventos de Dona Flor" }, { id: "c", title: "Cordel de Vidro" },
    { id: "d", title: "Sala de Espera" }, { id: "e1", title: "Gêmeas" }, { id: "e2", title: "gemeas" },
  ];
  db.pg = [{ playId: "a", genre: "animes" }, { playId: "d", genre: "ia" }, { playId: "d", genre: "dublados" }];
}
const rows = [
  { name: "a farsa do silencio", genres: ["🇧🇷 Brasileiras", "BL & GL"] },
  { name: "A FARSA DO SILÊNCIO", genres: ["Dublados"] },                    // linha repetida: soma os gêneros
  { name: "Ventos de Dona Flor", genres: ["Homem-lobo🐺 e Vampiro🧛"] },
  { name: "Série Que Não Existe", genres: ["Animes"] },
  { name: "Cordel de Vidro", genres: ["Gênero Inventado"] },                 // nenhum gênero reconhecido
  { name: "Gêmeas", genres: ["IA"] },                                        // 2 séries com o mesmo nome
  { name: "Sala de Espera", genres: ["Novos Na Plataforma"] },               // seção automática: ignorada
];

test("só admin importa", async () => {
  reset();
  assert.equal((await call("POST", "/genres-import", { rows })).status, 401);
  assert.equal((await call("POST", "/genres-import", { rows }, signToken({ id: "usr", role: "user" }))).status, 403);
});

test("prévia (dryRun): conta tudo e NÃO altera nada", async () => {
  reset();
  const before = JSON.stringify(db.pg);
  const r = await call("POST", "/genres-import", { rows, mode: "replace", dryRun: true }, adm());
  assert.equal(r.status, 200);
  assert.equal(r.body.applied, false);
  assert.equal(r.body.playsToUpdate, 4, "a, b e as 2 'gêmeas'");
  assert.deepEqual(r.body.unmatched, ["Série Que Não Existe"]);
  assert.equal(r.body.ambiguousCount, 1);
  assert.deepEqual(r.body.noGenre.sort(), ["Cordel de Vidro", "Sala de Espera"].sort(), "sem gênero reconhecido: não mexe");
  assert.deepEqual(r.body.unknownGenres, [{ name: "Gênero Inventado", count: 1 }], "'Novos Na Plataforma' não conta como erro");
  assert.deepEqual(r.body.byGenre, { brasileiras: 1, "bl-gl": 1, dublados: 1, "homem-lobo-e-vampiro": 1, ia: 2 });
  assert.equal(JSON.stringify(db.pg), before, "banco intacto");
});

test("aplicar (substituir): vários gêneros por série, linhas repetidas somam, o resto fica intacto", async () => {
  reset();
  const r = await call("POST", "/genres-import", { rows, mode: "replace" }, adm());
  assert.equal(r.body.applied, true); assert.equal(r.body.updated, 4);
  assert.deepEqual(gl("a"), ["bl-gl", "brasileiras", "dublados"], "3 gêneros; o 'animes' antigo foi substituído");
  assert.deepEqual(gl("b"), ["homem-lobo-e-vampiro"]);
  assert.deepEqual(gl("e1"), ["ia"]); assert.deepEqual(gl("e2"), ["ia"]);
  assert.deepEqual(gl("d"), ["dublados", "ia"], "Sala de Espera só tinha 'Novos' na planilha: continua como estava");
  assert.deepEqual(gl("c"), [], "Cordel de Vidro não foi alterada");
});

test("modo acrescentar: mantém os gêneros que já tinha e não duplica", async () => {
  reset();
  await call("POST", "/genres-import", { rows: [{ name: "A Farsa do Silêncio", genres: ["Animes", "Dublados"] }], mode: "add" }, adm());
  assert.deepEqual(gl("a"), ["animes", "dublados"], "animes já existia: sem duplicar");
  assert.equal(db.pg.filter((x) => x.playId === "a" && x.genre === "animes").length, 1);
});

test("separar em vários gêneros numa célula é feito no painel; o servidor recebe a lista pronta", async () => {
  reset();
  const r = await call("POST", "/genres-import", { rows: [{ name: "Cordel de Vidro", genres: ["Dublados", "Animes", "IA"] }] }, adm());
  assert.equal(r.status, 200); assert.deepEqual(gl("c"), ["animes", "dublados", "ia"]);
});

test("planilha vazia é recusada", async () => {
  reset();
  assert.equal((await call("POST", "/genres-import", { rows: [] }, adm())).status, 400);
});

test("criar série com vários gêneros: ids inválidos são descartados e ficam na ordem oficial", async () => {
  reset();
  const r = await call("POST", "/", { title: "Nova", durationMinutes: 90, genres: ["animes", "inventado", "dublados", "animes"] }, adm());
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.play.genres, ["dublados", "animes"]);
  assert.deepEqual(r.body.play.genreLabels, ["Dublados", "Animes"]);
});

test("editar: enviar 'genres' substitui; não enviar mantém", async () => {
  reset();
  await call("PUT", "/a", { genres: ["ia", "bl-gl"] }, adm());
  assert.deepEqual(gl("a"), ["bl-gl", "ia"].sort());
  await call("PUT", "/a", { title: "Outro título" }, adm());
  assert.deepEqual(gl("a"), ["bl-gl", "ia"].sort(), "sem 'genres' no pedido: gêneros intactos");
  await call("PUT", "/a", { genres: [] }, adm());
  assert.deepEqual(gl("a"), [], "lista vazia remove todos");
});
