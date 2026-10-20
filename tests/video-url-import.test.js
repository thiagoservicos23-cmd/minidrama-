// Planilha com url_video: parser do front (extraído do index.html) + validação do link no backend.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const vm = require("vm");

/* ---------------- parser da planilha (código real do index.html) ---------------- */
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
function grab(startMarker, endMarker) {
  const a = html.indexOf(startMarker), b = html.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, "trecho não encontrado: " + startMarker);
  return html.slice(a, b);
}
const code = [
  grab("function isYoutube(", "function embedYoutube("),
  grab("function isHls(", "// Lê a duração"),
  grab("function normName(", "// Lê CSV"),
  grab("function parseCsv(", "// Tipo do link de vídeo"),
  grab("function videoKind(", "// Acha a capa"),
].join("\n");
const ctx = { URL };
vm.createContext(ctx);
vm.runInContext(code + "\nthis.parseCoverCsv = parseCoverCsv; this.videoKind = videoKind;", ctx);
const { parseCoverCsv, videoKind } = ctx;

test("planilha só com capas continua funcionando (nome;url_capa)", () => {
  const r = parseCoverCsv("nome;url_capa\nA Farsa;https://x.com/a.png\nDona Flor;https://x.com/b.jpg");
  assert.equal(r.map.size, 2);
  assert.equal(r.map.get("a farsa").url, "https://x.com/a.png");
  assert.equal(r.map.get("a farsa").video, "");
});

test("lê url_video e duracao, em qualquer ordem de colunas", () => {
  const r = parseCoverCsv("url_video,nome,duracao,url_capa\nhttps://cdn.x/abc/playlist.m3u8,Ventos de Dona Flor,95,https://x.com/b.jpg");
  const e = r.map.get("ventos de dona flor");
  assert.equal(e.video, "https://cdn.x/abc/playlist.m3u8");
  assert.equal(e.url, "https://x.com/b.jpg");
  assert.equal(e.minutes, 95);
});

test("linha com vídeo mas sem capa é aceita; link de vídeo inválido mantém só a capa", () => {
  const r = parseCoverCsv("nome;url_capa;url_video\nSó Vídeo;;https://x.com/v.mp4\nVídeo Quebrado;https://x.com/c.png;javascript:alert(1)\nNada;;");
  assert.equal(r.map.get("so video").video, "https://x.com/v.mp4");
  assert.equal(r.map.get("so video").url, "");
  assert.equal(r.map.get("video quebrado").video, "");
  assert.equal(r.map.get("video quebrado").url, "https://x.com/c.png");
  assert.deepEqual(Array.from(r.invalidVideo), ["Vídeo Quebrado"]);
  assert.deepEqual(Array.from(r.invalid), ["Nada"]);
});

test("sem cabeçalho: nome;capa;video;duracao e nomes repetidos valem o primeiro", () => {
  const r = parseCoverCsv("Peça A;https://x.com/a.png;https://x.com/a.mp4;80\nPeça A;https://x.com/z.png;https://x.com/z.mp4;10");
  assert.equal(r.map.size, 1);
  assert.equal(r.map.get("peca a").video, "https://x.com/a.mp4");
  assert.equal(r.map.get("peca a").minutes, 80);
  assert.deepEqual(Array.from(r.duplicates), ["Peça A"]);
});

test("classifica o tipo de link e avisa de páginas que não tocam", () => {
  assert.equal(videoKind("https://cdn.x/g/playlist.m3u8").ok, true);
  assert.equal(videoKind("https://youtu.be/abcdefghij").label, "YouTube");
  assert.equal(videoKind("https://x.com/a.mp4?v=1").label, "vídeo direto");
  assert.equal(videoKind("https://drive.google.com/file/d/1/view").ok, false);
  assert.equal(videoKind("https://iframe.mediadelivery.net/embed/1/2").ok, false);
});

/* ---------------- backend: videoUrl só http(s) ---------------- */
process.env.JWT_SECRET = "teste";
const db = { plays: [] };
const fake = {
  user: { findUnique: async ({ where }) => (where.id === "adm" ? { id: "adm", role: "admin", status: "ativo" } : null) },
  plan: { findUnique: async () => null, findMany: async () => [] },
  play: {
    create: async ({ data }) => { const p = { id: "p" + (db.plays.length + 1), ...data, genres: [], posterUrl: data.posterUrl || "", backdropUrl: data.backdropUrl || "" }; delete p.genres; p.genres = []; db.plays.push(p); return p; },
    update: async ({ where, data }) => { const p = db.plays.find((x) => x.id === where.id); if (!p) throw new Error("nf"); Object.entries(data).forEach(([k, v]) => { if (v !== undefined && k !== "genres") p[k] = v; }); return p; },
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
const call = (method, p, body) => new Promise((resolve, reject) => {
  const req = http.request(base + p, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + signToken({ id: "adm", role: "admin" }) } }, (res) => {
    let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
  });
  req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
});
const base_ = { title: "Peça", durationMinutes: 90, genres: [] };

test("cria peça com link direto de vídeo (.m3u8) e capa por URL", async () => {
  const r = await call("POST", "/", { ...base_, videoUrl: " https://cdn.x/abc/playlist.m3u8 ", posterUrl: "https://x.com/capa.png" });
  assert.equal(r.status, 201);
  assert.equal(db.plays[0].videoUrl, "https://cdn.x/abc/playlist.m3u8");
});

test("recusa link de vídeo que não seja http(s)", async () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x/y.mp4", "isso não é link"]) {
    assert.equal((await call("POST", "/", { ...base_, videoUrl: bad })).status, 400, bad);
  }
  const ok = await call("POST", "/", { ...base_ });   // sem vídeo ainda continua permitido
  assert.equal(ok.status, 201);
  assert.equal((await call("PUT", "/" + ok.body.play.id, { videoUrl: "javascript:alert(1)" })).status, 400);
  assert.equal((await call("PUT", "/" + ok.body.play.id, { videoUrl: "https://cdn.x/v.mp4" })).status, 200);
});
