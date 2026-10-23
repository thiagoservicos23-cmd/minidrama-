// Teste de fumaça do StoryReel: roda o index.html de verdade num DOM simulado (jsdom), com a API, o Plyr,
// o hls.js e o IntersectionObserver substituídos por dublês. Não entra no "npm test" (precisa do jsdom):
//   npm install --no-save jsdom && node tests/smoke/storyreel.smoke.js
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const html = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log("  ✔", name); } catch (e) { console.log("  ✘", name, "\n     ", e.message); process.exitCode = 1; } };

const PLAYS = [
  { id: "p1", title: "Só Camarote", requiresPlan: "camarote", canWatch: false, hasVideo: true, durationMinutes: 90, releaseYear: 2025, synopsis: "Sinopse 1", genreLabels: ["Drama"], director: "D", cast: "C" },
  { id: "p2", title: "Novelinha HLS", requiresPlan: "balcao", canWatch: true, hasVideo: true, durationMinutes: 95, releaseYear: 2025, synopsis: ".", genreLabels: [] },
  { id: "p3", title: "Novelinha MP4", requiresPlan: "plateia", canWatch: true, hasVideo: true, durationMinutes: 80, releaseYear: 2024, synopsis: "Sinopse 3", genreLabels: ["Comédia"] },
  { id: "p4", title: "Sem vídeo", requiresPlan: "plateia", canWatch: true, hasVideo: false, durationMinutes: 70, releaseYear: 2024, synopsis: "x", genreLabels: [] },
  { id: "p5", title: "Novelinha YouTube", requiresPlan: "plateia", canWatch: true, hasVideo: true, durationMinutes: 75, releaseYear: 2023, synopsis: "Sinopse 5", genreLabels: [] },
];
const VIDEO = { p2: "https://cdn.x/g/playlist.m3u8", p3: "https://cdn.x/v.mp4", p5: "https://youtu.be/abcdefghijk" };

async function makeEnv(opts = {}) {
  const calls = [];            // { method, path, body, keepalive }
  const plyrs = [], hlss = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false });
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () { w.__scrolled = this.dataset && this.dataset.i; };
      w.HTMLMediaElement.prototype.load = () => {};
      // Tela cheia simulada: "native" (Android/PC), "reject" (o navegador recusa) ou ausente; opts.ios liga o <video> nativo do iPhone.
      w.__fs = { el: null, req: [], exit: 0, lock: [], unlock: 0, ios: 0, plyrToggle: 0 };
      Object.defineProperty(w.document, "fullscreenElement", { get: () => w.__fs.el, configurable: true });
      w.document.exitFullscreen = () => { w.__fs.exit++; w.__fs.el = null; w.document.dispatchEvent(new w.Event("fullscreenchange")); return Promise.resolve(); };
      if (opts.fs === "native" || opts.fs === "reject") w.Element.prototype.requestFullscreen = function () { w.__fs.req.push(this.className); if (opts.fs === "reject") return Promise.reject(new Error("denied")); w.__fs.el = this; w.document.dispatchEvent(new w.Event("fullscreenchange")); return Promise.resolve(); };
      if (opts.ios) w.HTMLMediaElement.prototype.webkitEnterFullscreen = function () { w.__fs.ios++; };
      Object.defineProperty(w.screen, "orientation", { value: { lock: (o) => { w.__fs.lock.push(o); return Promise.resolve(); }, unlock: () => { w.__fs.unlock++; } }, configurable: true });
      w.__ios = [];
      w.IntersectionObserver = class { constructor(cb) { this.cb = cb; w.__ios.push(this); this.els = []; } observe(e) { this.els.push(e); } disconnect() { this.dead = true; } };
      w.fire = (i) => { const io = w.__ios[w.__ios.length - 1]; const el = io.els.find(e => e.dataset.i == i); io.cb([{ isIntersecting: true, intersectionRatio: 1, target: el }]); };
      w.Plyr = class {
        constructor(el, o) { this.el = el; this.o = o; this.h = {}; this.destroyed = false; this.currentTime = 0; this.duration = 5400; this.paused = true; this.muted = !!o.muted; plyrs.push(this); this.fullscreen = { toggle() { w.__fs.plyrToggle++; } }; }
        on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
        emit(e) { (this.h[e] || []).forEach(f => f()); }
        play() { if (opts.blockUnmutedAutoplay && !this.muted) return Promise.reject(new Error("NotAllowedError")); this.paused = false; return Promise.resolve(); }
        pause() { this.paused = true; }
        destroy() { this.destroyed = true; }
      };
      w.Hls = class { constructor(c) { this.c = c; this.destroyed = false; hlss.push(this); } static isSupported() { return true; } loadSource(u) { this.src = u; } attachMedia() {} on() {} destroy() { this.destroyed = true; } };
      w.Hls.Events = { ERROR: "hlsError" }; w.Hls.ErrorTypes = { NETWORK_ERROR: "n", MEDIA_ERROR: "m" };
      w.fetch = async (url, o = {}) => {
        const path = String(url).replace(/^\/api/, "");
        if (path === "/plays/feed/home") return { ok: true, status: 200, json: async () => ({ featured: [], novos: PLAYS, genres: [], catalog: [], total: PLAYS.length }) };   // o boot precisa terminar de verdade
        if (path === "/plans") return { ok: true, status: 200, json: async () => ({ plans: [] }) };
        calls.push({ method: o.method || "GET", path, body: o.body, keepalive: !!o.keepalive });
        const res = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
        if (path.startsWith("/plays?")) return res({ plays: opts.listOverride || PLAYS });
        const m = path.match(/^\/plays\/(\w+)$/);
        if (m) {
          if (opts.failDetail === m[1]) return res({ error: "Servidor fora do ar." }, 500);
          const p = PLAYS.find(x => x.id === m[1]); if (!p) return res({ error: "Novelinha não encontrada." }, 404);
          return res({ play: { ...p, videoUrl: p.canWatch ? (VIDEO[p.id] || "") : "" }, canWatch: p.canWatch, resume: m[1] === "p2" && opts.resume ? { position: 120, duration: 5700 } : null });
        }
        if (path.startsWith("/me/progress/")) return res({ ok: true });
        return res({});
      };
    }
  });
  const w = dom.window;
  for (let t0 = Date.now(); !w.document.querySelector("#site-header") && Date.now() - t0 < 5000;) await tick(20);   // espera o boot desenhar a home
  w.eval(`DB.plans = [{id:"plateia",name:"Plateia",price:0,benefits:[]},{id:"balcao",name:"Balcão",price:14.9,benefits:[]},{id:"camarote",name:"Camarote",price:24.9,benefits:[]}];
          DB.me = ${opts.visitor ? "null" : `{id:"u1",name:"Ana Souza",role:"user",plan:"balcao"}`}; localStorage.setItem("minidrama_token","tok");`);
  return { dom, w, calls, plyrs, hlss };
}
const open = async (env, id) => { env.w.location.hash = id ? "#/reel/" + id : "#/reel"; await tick(120); };
const slides = (w) => [...w.document.querySelectorAll(".reel-slide")];
const ids = (w) => slides(w).map(s => s.dataset.id || "(fim)");

(async () => {
  console.log("\nA) Abre no meio da lista, usuária logada (Balcão)");
  let e = await makeEnv({ resume: true });
  await open(e, "p2");
  ok("rota #/reel/p2 monta o feed: escolhida primeiro, bloqueada/sem vídeo ficam de fora, + tela de fim", () => assert.deepEqual(ids(e.w), ["p2", "p3", "p5", "(fim)"]));
  ok("o site não desenha header e trava a rolagem do corpo", () => { assert.ok(!e.w.document.querySelector(".site-header")); assert.ok(e.w.document.body.classList.contains("reel-open")); });
  ok("nada é montado antes de a tela ficar ativa", () => assert.equal(e.plyrs.length, 0));
  e.w.fire(0); await tick(150);
  ok("tela ativa busca o link em /plays/p2 (a lista nunca traz o link)", () => assert.ok(e.calls.some(c => c.path === "/plays/p2")));
  ok("HLS: hls.js criado com a posição salva (120s) e Plyr montado só nela", () => { assert.equal(e.hlss.length, 1); assert.equal(e.hlss[0].c.startPosition, 120); assert.equal(e.hlss[0].src, VIDEO.p2); assert.equal(e.plyrs.length, 1); });
  ok("Plyr recebe teclas desligadas (o reel trata o teclado) e textos em pt-BR", () => { assert.equal(e.plyrs[0].o.keyboard.focused, false); assert.equal(e.plyrs[0].o.i18n.play, "Reproduzir"); });
  ok("começa tocando", () => assert.equal(e.plyrs[0].paused, false));
  ok("contador mostra 1 / 3 e URL acompanha a novelinha", () => { assert.equal(e.w.document.getElementById("reel-count").textContent, "1 / 3"); assert.equal(e.w.location.hash, "#/reel/p2"); });
  ok("pré-carrega só o TEXTO do próximo (/plays/p3), sem montar player", () => { assert.ok(e.calls.some(c => c.path === "/plays/p3")); assert.equal(e.plyrs.length, 1); });
  ok("sinopse '.' (importada em lote) não aparece", () => assert.equal(slides(e.w)[0].querySelector(".reel-syn"), null));

  e.plyrs[0].currentTime = 600; e.plyrs[0].emit("pause");
  ok("pausar salva o progresso (PUT /me/progress/p2, keepalive)", () => { const c = e.calls.find(x => x.method === "PUT" && x.path === "/me/progress/p2"); assert.ok(c && c.keepalive); assert.deepEqual(JSON.parse(c.body), { position: 600, duration: 5400 }); });

  e.w.fire(1); await tick(150);
  ok("trocar de tela destrói o player e o hls.js anteriores (sem vazar memória)", () => { assert.equal(e.plyrs[0].destroyed, true); assert.equal(e.hlss[0].destroyed, true); });
  ok("mp4 monta novo player com src direto", () => { assert.equal(e.plyrs.length, 2); assert.equal(e.plyrs[1].el.getAttribute("src"), VIDEO.p3); });
  e.w.fire(2); await tick(150);
  ok("YouTube usa o provider do Plyr com o id certo", () => { const p = e.plyrs[2]; assert.equal(p.el.dataset.plyrProvider, "youtube"); assert.equal(p.el.dataset.plyrEmbedId, "abcdefghijk"); });
  e.w.fire(3); await tick(60);
  ok("tela de fim: contador 'Fim', sem player ativo", () => { assert.equal(e.w.document.getElementById("reel-count").textContent, "Fim"); assert.equal(e.plyrs[2].destroyed, true); });

  console.log("\nB) Teclado e ações");
  e.w.fire(0); await tick(150);
  ok("voltar à novelinha 1 retoma de onde parou (600s salvos), não dos 120s do servidor", () => assert.equal(e.hlss[e.hlss.length - 1].c.startPosition, 600));
  const key = (k) => e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  key("ArrowDown"); ok("↓ rola para a próxima tela", () => assert.equal(e.w.__scrolled, "1"));
  key("ArrowUp"); ok("↑ rola para a anterior", () => assert.equal(e.w.__scrolled, "0"));
  key("m"); ok("M alterna o som e sincroniza o botão", () => { const b = e.w.document.querySelector('.reel-slide[data-i="0"] [data-act="sound"]'); assert.equal(b.getAttribute("aria-pressed"), "false"); });
  key("i"); ok("I abre a ficha da novelinha; Esc fecha a ficha sem sair do reel", () => { const sh = e.w.document.getElementById("reel-sheet"); assert.ok(sh.classList.contains("open")); key("Escape"); assert.ok(!sh.classList.contains("open")); assert.ok(e.w.location.hash.startsWith("#/reel/")); });
  e.w.document.querySelector('.reel-slide[data-i="0"] [data-act="info"]').click();
  ok("ficha mostra título escapado e link para a página da novelinha", () => assert.ok(e.w.document.querySelector("#reel-sheet a[href='#/novelinha/p2']")));

  const last = e.plyrs[e.plyrs.length - 1];
  const nCalls = e.calls.length; last.currentTime = 5400; last.emit("ended"); await tick(20);
  ok("fim do vídeo: avança sozinho para a próxima novelinha e marca como terminada (posição = duração)", () => {
    assert.equal(e.w.__scrolled, "1");
    const put = e.calls.slice(nCalls).find(c => c.method === "PUT"); assert.deepEqual(JSON.parse(put.body), { position: 5400, duration: 5400 });
  });
  Object.defineProperty(last.el, "videoWidth", { value: 720 }); Object.defineProperty(last.el, "videoHeight", { value: 1280 });
  last.emit("loadedmetadata");
  ok("vídeo 9:16 detectado: a tela vira modo 'em pé' (tela cheia)", () => assert.ok(slides(e.w)[0].classList.contains("is-tall")));

  console.log("\nC) Sair do reel");
  e.w.location.hash = "#/planos"; await tick(120);
  ok("navegar para outra rota destrói o player ativo", () => assert.equal(e.plyrs.filter(p => !p.destroyed).length, 0));
  ok("libera a rolagem do corpo e remove o reel", () => { assert.ok(!e.w.document.body.classList.contains("reel-open")); assert.equal(e.w.document.getElementById("reel"), null); });
  const before = e.calls.length; key("ArrowDown");
  ok("teclado do reel deixa de responder depois de sair", () => assert.equal(e.calls.length, before));
  e.w.close();

  console.log("\nD) Começa por novelinha BLOQUEADA");
  e = await makeEnv();
  await open(e, "p1");
  ok("feed: bloqueada primeiro, depois as liberadas", () => assert.deepEqual(ids(e.w), ["p1", "p2", "p3", "p5", "(fim)"]));
  ok("mostra painel 'Conteúdo do plano Camarote' com botão para os planos", () => { const s = slides(e.w)[0]; assert.match(s.querySelector(".reel-panel").textContent, /plano Camarote/); assert.ok(s.querySelector('a[href="#/planos"]')); });
  e.w.fire(0); await tick(120);
  ok("NÃO pede o link do vídeo da novelinha bloqueada nem cria player", () => { assert.ok(!e.calls.some(c => c.path === "/plays/p1")); assert.equal(e.plyrs.length, 0); });
  ok("novelinha bloqueada não tem botão de som", () => assert.equal(slides(e.w)[0].querySelector('[data-act="sound"]'), null));
  e.w.close();

  console.log("\nE) Navegador barra autoplay com som");
  e = await makeEnv({ blockUnmutedAutoplay: true });
  await open(e, "p3"); e.w.fire(0); await tick(150);
  ok("reabre mudo e tocando (e avisa como ativar o som)", () => { assert.equal(e.plyrs[0].muted, true); assert.equal(e.plyrs[0].paused, false); assert.match(e.w.document.getElementById("toast-host").textContent, /som/i); });
  e.w.close();

  console.log("\nF) Falha de rede ao buscar o vídeo");
  e = await makeEnv({ failDetail: "p3" });
  await open(e, "p3"); e.w.fire(0); await tick(150);
  ok("mostra o erro do servidor com 'Tentar de novo' em vez de travar", () => { const p = slides(e.w)[0].querySelector(".reel-panel"); assert.match(p.textContent, /Servidor fora do ar/); assert.ok(p.querySelector('[data-act="retry"]')); });
  e.w.close();

  console.log("\nG) Visitante e casos de borda");
  e = await makeEnv({ visitor: true });
  await open(e, "p3"); e.w.fire(0); await tick(150);
  ok("visitante assiste, mas progresso NÃO é enviado ao servidor", () => { e.plyrs[0].currentTime = 300; e.plyrs[0].emit("pause"); assert.ok(!e.calls.some(c => c.path.startsWith("/me/progress"))); });
  e.w.close();
  e = await makeEnv({ listOverride: [] });
  await open(e, "p3"); await tick(100);
  ok("novelinha fora da lista é buscada sozinha (/plays/p3) e abre", () => { assert.ok(e.calls.some(c => c.path === "/plays/p3")); assert.deepEqual(ids(e.w), ["p3"]); });
  ok("feed de 1 novelinha não tem tela de fim nem dica de deslizar", () => { assert.equal(e.w.document.getElementById("reel-hint"), null); });
  e.w.close();

  console.log("\nH) Título malicioso não injeta HTML");
  e = await makeEnv({ listOverride: [{ ...PLAYS[2], title: '<img src=x onerror="window.__pwn=1">Novelinha "X"', synopsis: "<script>window.__pwn=2</script>texto longo", cast: "<b>x</b>" }] });
  await open(e, "p3"); e.w.document.querySelector('[data-act="info"]').click(); await tick(50);
  ok("nem a tela, nem a ficha interpretam o HTML do título/sinopse/elenco", () => {
    assert.equal(e.w.document.querySelectorAll(".reel img[src='x']").length, 0);
    assert.equal(e.w.document.querySelectorAll(".reel script, .reel-sheet b").length, 0);
    assert.equal(e.w.__pwn, undefined);
    assert.match(slides(e.w)[0].querySelector(".reel-title").textContent, /<img src=x/);
  });
  e.w.close();


  console.log("\nI) Tela cheia (celular e PC)");
  const startReel = async (o) => { const env = await makeEnv(o); await open(env, "p3"); env.w.fire(0); await tick(150); return env; };
  const fsBtn = (env) => env.w.document.querySelector('.reel-slide[data-i="0"] [data-act="fs"]');
  e = await startReel({ fs: "native" });
  ok("botão de tela cheia existe no celular e o do computador fica escondido por CSS (regra de ponteiro fino)", () => { assert.ok(fsBtn(e)); assert.match(html, /@media \(hover:hover\) and \(pointer:fine\)\{ \.reel-btn-fs\{display:none;\} \}/); });
  fsBtn(e).click(); await tick(40);
  ok("1) pede tela cheia nativa para o PALCO do vídeo (não para a página)", () => { assert.equal(e.w.__fs.req.length, 1); assert.match(e.w.__fs.req[0], /reel-stage/); });
  ok("vídeo deitado: gira o celular para o modo paisagem sozinho", () => assert.deepEqual(e.w.__fs.lock, ["landscape"]));
  fsBtn(e).click(); await tick(40);
  ok("tocar de novo sai da tela cheia e devolve a rotação", () => { assert.equal(e.w.__fs.exit, 1); assert.ok(e.w.__fs.unlock >= 1); });
  key("f"); await tick(40);
  ok("tecla F também entra em tela cheia (computador)", () => assert.equal(e.w.__fs.req.length, 2));
  e.w.location.hash = "#/planos"; await tick(120);
  ok("sair do reel com a tela cheia ativa fecha a tela cheia", () => assert.ok(e.w.__fs.exit >= 2));
  e.w.close();

  e = await startReel({ fs: "native" });
  Object.defineProperty(e.plyrs[0].el, "videoWidth", { value: 720 }); Object.defineProperty(e.plyrs[0].el, "videoHeight", { value: 1280 }); e.plyrs[0].emit("loadedmetadata");
  fsBtn(e).click(); await tick(40);
  ok("vídeo em pé (9:16): entra em tela cheia mas NÃO força a tela deitada", () => { assert.equal(e.w.__fs.req.length, 1); assert.deepEqual(e.w.__fs.lock, []); });
  e.w.close();

  e = await startReel({ fs: "reject", ios: true });
  fsBtn(e).click(); await tick(40);
  ok("2) se o navegador recusar a nativa, usa o player nativo do vídeo (iPhone)", () => { assert.equal(e.w.__fs.req.length, 1); assert.equal(e.w.__fs.ios, 1); assert.ok(!e.w.document.querySelector(".is-fs")); });
  e.w.close();
  e = await startReel({ ios: true });
  fsBtn(e).click(); await tick(40);
  ok("iPhone (sem tela cheia para elementos): vai direto para o player nativo do vídeo", () => assert.equal(e.w.__fs.ios, 1));
  e.w.close();

  e = await startReel({});
  fsBtn(e).click(); await tick(40);
  ok("3) sem nenhum suporte: tela cheia por CSS — o palco cobre a tela e título/botões somem", () => {
    const slide = e.w.document.querySelector('.reel-slide[data-i="0"]');
    assert.ok(slide.classList.contains("is-fs")); assert.ok(e.w.document.getElementById("reel").classList.contains("fs-css"));
    assert.match(html, /\.reel-slide\.is-fs \.reel-info, \.reel-slide\.is-fs \.reel-rail, \.reel-slide\.is-fs::before\{display:none;\}/);
  });
  key("Escape"); await tick(40);
  ok("Esc sai da tela cheia por CSS SEM sair do reel", () => { assert.ok(!e.w.document.querySelector(".is-fs")); assert.ok(e.w.document.getElementById("reel")); });
  fsBtn(e).click(); await tick(30); e.w.fire(1); await tick(150);
  ok("trocar de novelinha limpa a tela cheia por CSS (não fica preso)", () => { assert.ok(!e.w.document.querySelector(".is-fs")); assert.ok(!e.w.document.getElementById("reel").classList.contains("fs-css")); });
  e.w.close();

  e = await startReel({ fs: "native" });
  const host = e.w.document.querySelector(".reel-player");
  host.insertAdjacentHTML("beforeend", '<div class="plyr__controls"><button data-plyr="fullscreen" id="fake-fs">fs</button></div>');
  e.w.document.getElementById("fake-fs").click(); await tick(40);
  ok("o botão de tela cheia do próprio Plyr passa pela nossa função (e o do Plyr não roda)", () => { assert.equal(e.w.__fs.req.length, 1); assert.equal(e.w.__fs.plyrToggle, 0); });
  e.w.document.getElementById("fake-fs").dispatchEvent(new e.w.MouseEvent("dblclick", { bubbles: true, cancelable: true })); await tick(40);
  ok("duplo clique nos controles não alterna a tela cheia", () => assert.equal(e.w.__fs.exit, 0));
  host.querySelector("video").dispatchEvent(new e.w.MouseEvent("dblclick", { bubbles: true, cancelable: true })); await tick(40);
  ok("duplo toque no vídeo alterna a tela cheia (sai, pois já estava ativa)", () => assert.equal(e.w.__fs.exit, 1));
  e.w.close();

  console.log("\nJ) O título não fica na frente do vídeo");
  e = await startReel({});
  const info = () => e.w.document.querySelector('.reel-slide[data-i="0"] .reel-info');
  ok("enquanto carrega, título e dados aparecem sobre a capa", () => assert.notEqual(e.w.getComputedStyle(info()).visibility, "hidden"));
  e.plyrs[0].emit("playing"); await tick(20);
  ok("assim que o vídeo toca, o título some de cima da imagem (e continua assim se pausar)", () => {
    assert.ok(e.w.document.querySelector(".reel-stage").classList.contains("is-live"));
    assert.equal(e.w.getComputedStyle(info()).visibility, "hidden");
    e.plyrs[0].emit("pause"); assert.equal(e.w.getComputedStyle(info()).visibility, "hidden");
  });
  ok("os detalhes continuam acessíveis pelo botão ⓘ", () => { e.w.document.querySelector('[data-act="info"]').click(); assert.ok(e.w.document.querySelector("#reel-sheet .reel-title, #reel-sheet h3")); });
  e.w.close();

  console.log(`\n${passed} verificações passaram${process.exitCode ? " — COM FALHAS" : ""}`);
  process.exit(process.exitCode || 0);
})().catch(err => { console.error("ERRO NO HARNESS:", err); process.exit(2); });
