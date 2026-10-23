// StoryReel: lógica pura (extraída do próprio index.html) e garantias estruturais do player.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const a = html.indexOf("/* ---- funções puras"), b = html.indexOf("function waitFor(");
assert.ok(a > 0 && b > a, "bloco de funções puras do StoryReel não encontrado");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + "\nthis.ytId = ytId; this.buildReelFeed = buildReelFeed; this.reelIsTall = reelIsTall;", ctx);
const { ytId, buildReelFeed, reelIsTall } = ctx;

const P = (id, canWatch = true, hasVideo = true) => ({ id, canWatch, hasVideo });

test("ytId reconhece os formatos de link do YouTube", () => {
  assert.equal(ytId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.equal(ytId("https://www.youtube.com/watch?v=abcdefghijk&t=3"), "abcdefghijk");
  assert.equal(ytId("https://www.youtube.com/embed/abcdefghijk"), "abcdefghijk");
  assert.equal(ytId("https://www.youtube.com/shorts/abcdefghijk"), "abcdefghijk");
  assert.equal(ytId("https://cdn.x/video.mp4"), null);
  assert.equal(ytId(""), null);
});

test("feed: a novelinha escolhida vem primeiro e só entram novelinhas que a pessoa pode assistir", () => {
  const plays = [P("a"), P("b", false), P("c", true, false), P("d"), P("e")];
  assert.deepEqual(Array.from(buildReelFeed(plays, "d"), (p) => p.id), ["d", "a", "e"]);
});

test("feed: novelinha escolhida bloqueada ou sem vídeo ainda abre (para mostrar o motivo)", () => {
  const plays = [P("a"), P("b", false), P("c", true, false)];
  assert.deepEqual(Array.from(buildReelFeed(plays, "b"), (p) => p.id), ["b", "a"]);
  assert.deepEqual(Array.from(buildReelFeed(plays, "c"), (p) => p.id), ["c", "a"]);
});

test("feed sem novelinha escolhida (#/reel) traz só as assistíveis; id desconhecido é ignorado", () => {
  const plays = [P("a"), P("b", false), P("c")];
  assert.deepEqual(Array.from(buildReelFeed(plays, ""), (p) => p.id), ["a", "c"]);
  assert.deepEqual(Array.from(buildReelFeed(plays, "zzz"), (p) => p.id), ["a", "c"]);
  assert.deepEqual(Array.from(buildReelFeed([], "a")), []);
});

test("reelIsTall: 9:16 ocupa a tela; 16:9, quadrado e sem metadados ficam na caixa horizontal", () => {
  assert.equal(reelIsTall(720, 1280), true);
  assert.equal(reelIsTall(1920, 1080), false);
  assert.equal(reelIsTall(1080, 1080), false);
  assert.equal(reelIsTall(0, 0), false);
  assert.equal(reelIsTall(undefined, undefined), false);
});

test("o player antigo foi substituído: Plyr com versão fixa e rota #/reel presentes, <video> HLS embutido ausente", () => {
  assert.match(html, /plyr@3\.7\.8\/dist\/plyr\.min\.js/);
  assert.match(html, /plyr@3\.7\.8\/dist\/plyr\.css/);
  assert.match(html, /hash\.startsWith\("#\/reel\/"\)/);
  assert.ok(!html.includes('id="hls-player"'));
});

test("scroll-snap em CSS puro e respeito a movimento reduzido", () => {
  assert.match(html, /scroll-snap-type:y mandatory/);
  assert.match(html, /scroll-snap-stop:always/);
  assert.match(html, /prefers-reduced-motion:no-preference\)\{ \.reel-scroller\{scroll-behavior:smooth/);
});
