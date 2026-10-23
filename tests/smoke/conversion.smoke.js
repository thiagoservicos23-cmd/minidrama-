// Teste de fumaça do pop-up de assinatura (principal + mini). Roda o index.html real num DOM simulado (jsdom).
// O temporizador de 30 s é capturado (não se espera 30 s de verdade): o teste confere o valor e o dispara na mão.
//   npm install --no-save jsdom && node tests/smoke/conversion.smoke.js
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const html = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log("  ✔", name); } catch (e) { console.log("  ✘", name, "\n     ", e.message); process.exitCode = 1; } };

const P = (id, title, extra = {}) => ({ id, title, posterUrl: "http://x/" + id + ".png", backdropUrl: "http://x/b.png", requiresPlan: "plateia", canWatch: true, hasVideo: true, durationMinutes: 90, releaseYear: 2025, genre: "Drama", synopsis: "s", ...extra });
const CATALOG = ["a1", "a2", "a3", "a4", "a5", "a6"].map((id, i) => P(id, "Novelinha " + i));
const RANDOM = ["r1", "r2", "r3", "r4", "r5"].map((id, i) => P(id, "Sorteada " + i));
const PLANS = [{ id: "plateia", name: "Plateia", price: 0, benefits: [] }, { id: "camarote", name: "Camarote", price: 24.9, benefits: [] }, { id: "balcao", name: "Balcão", price: 14.9, benefits: [] }];
const DAY = 86400000;
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

async function makeEnv(o = {}) {
  const calls = [], timers = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) {
      Object.defineProperty(w.navigator, "userAgent", { value: o.ua || "Mozilla/5.0 (Windows NT 10.0) Chrome/126", configurable: true });
      w.matchMedia = () => ({ matches: false }); w.scrollTo = () => {};
      w.IntersectionObserver = class { observe() {} disconnect() {} };                 // o player real usa; o jsdom não tem
      const real = w.setTimeout.bind(w);
      w.setTimeout = (fn, ms, ...a) => { if (ms === 30000) { timers.push({ fn, ms }); return 0; } return real(fn, ms, ...a); };   // captura SÓ o de 30 s
      w.fetch = async (url, init = {}) => {
        const pth = String(url).replace(/^\/api/, "");
        calls.push(pth);
        const res = (d, st = 200) => ({ ok: st < 400, status: st, json: async () => d });
        if (pth === "/plays/feed/home") return res({ featured: [], novos: CATALOG, genres: [{ id: "drama", label: "Drama", plays: CATALOG, total: 6 }], catalog: [{ id: "drama", label: "Drama" }], total: 6 });
        if (pth === "/plans") return res({ plans: PLANS });
        if (pth === "/me/home") return res({ continue: [], listIds: [] });
        if (pth.startsWith("/plays/random")) return o.randomFail ? res({ error: "fora do ar" }, 500) : res({ plays: RANDOM, total: 50 });
        if (pth.startsWith("/plays/trending")) return res({ plays: [], ranked: 0 });
        if (pth.startsWith("/plays?")) return res({ plays: CATALOG, total: 6, totalPages: 1, page: 1 });
        return res({});
      };
    }
  });
  const w = dom.window;
  for (let t0 = Date.now(); !w.document.querySelector("#site-header") && Date.now() - t0 < 5000;) await tick(20);
  if (o.user) w.eval(`DB.me = ${JSON.stringify({ id: "u1", name: "Ana", role: "user", ...o.user })}; localStorage.setItem("minidrama_token","tok");`);
  return { w, calls, timers };
}
const $ = (e, s) => e.w.document.querySelector(s), $$ = (e, s) => [...e.w.document.querySelectorAll(s)];
const go = async (e, hash, ms = 150) => { e.w.location.hash = hash; await tick(ms); };
const fire = (e) => e.timers[0].fn();
const key = (e, k, opts = {}) => e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
const shown = async (o, hash) => { const e = await makeEnv(o); if (hash) await go(e, hash); fire(e); await tick(60); const r = !!$(e, "#conv-main"); e.w.close(); return r; };

(async () => {
  console.log("\nA) Temporizador e conteúdo");
  let e = await makeEnv({});
  ok("o site registra UM temporizador de exatamente 30000 ms ao carregar", () => { assert.equal(e.timers.length, 1); assert.equal(e.timers[0].ms, 30000); });
  ok("antes dos 30 s o pop-up não existe", () => { assert.equal($(e, "#conv-main"), null); assert.equal($(e, "#conv-mini"), null); });
  await go(e, "#/catalogo", 150); await go(e, "#/home", 150);
  ok("navegar entre telas NÃO reinicia nem duplica o temporizador (a contagem é do carregamento do site)", () => assert.equal(e.timers.length, 1));
  fire(e); await tick(80);
  ok("ao disparar, abre o pop-up principal como diálogo modal acessível", () => { const m = $(e, "#conv-main"); assert.ok(m); assert.equal(m.getAttribute("role"), "dialog"); assert.equal(m.getAttribute("aria-modal"), "true"); assert.equal(e.w.document.getElementById(m.getAttribute("aria-labelledby")).textContent, "Assista novelinhas sem limite"); });
  ok("trava a rolagem do fundo enquanto está aberto", () => assert.ok(e.w.document.body.classList.contains("conv-open")));
  ok("tem o baralho de 5 capas com as MESMAS classes do baralho da tela Surpresa (mesma função, mesmo CSS)", () => {
    const d = $(e, "#conv-deck"); assert.equal(d.className, "deck"); assert.equal(d.querySelectorAll(".deck-card").length, 5);
    const surpresa = new e.w.DOMParser().parseFromString(e.w.eval('deckHtml(DB.plays, "deck")'), "text/html").querySelector(".deck");
    assert.equal(surpresa.className, d.className); assert.deepEqual([...surpresa.children].map(c => c.className), [...d.children].map(c => c.className));
    assert.match(html, /\$\{deckHtml\(convPlays\(\), "conv-deck"\)\}/); assert.ok(!/conv-deck-card/.test(html));
  });
  ok("as capas do baralho são sorteadas entre TODAS (/plays/random?count=5) e substituem as iniciais", () => {
    assert.ok(e.calls.includes("/plays/random?count=5"));
    const bg = $$(e, "#conv-deck .deck-card").map(c => c.getAttribute("style")).join(" ");
    assert.match(bg, /\/r\d\.png/); assert.ok(!/\/a\d\.png/.test(bg));
  });
  ok("botão principal leva a #/planos e mostra o preço REAL do plano pago mais barato (R$ 14,90)", () => { const c = $(e, "#conv-main [data-conv-cta]"); assert.equal(c.getAttribute("href"), "#/planos"); assert.match(c.textContent, /Ver planos · a partir de R\$ 14,90/); });
  ok("texto sem urgência falsa (nada de contagem, desconto, vagas ou % inventados)", () => assert.ok(!/desconto|limitad|últimas?\s+vagas|expira|só hoje|restam|%/i.test($(e, "#conv-card").textContent), $(e, "#conv-card").textContent));
  ok("visitante lê o convite para criar conta; o foco já vai para o botão principal", () => { assert.match($(e, ".conv-sub").textContent, /Crie sua conta grátis/); assert.equal(e.w.document.activeElement, $(e, "#conv-main [data-conv-cta]")); });
  e.w.close();
  e = await makeEnv({ user: { plan: "plateia" } }); fire(e); await tick(60);
  ok("conta gratuita lê que está no plano gratuito", () => assert.match($(e, ".conv-sub").textContent, /plano gratuito/));
  e.w.close();
  e = await makeEnv({ randomFail: true }); fire(e); await tick(100);
  ok("se o sorteio das capas falhar, o pop-up continua aberto com as capas que já estavam na página (e sem erro na cara do usuário)", () => { assert.ok($(e, "#conv-main")); assert.equal($$(e, "#conv-deck .deck-card").length, 5); assert.ok(!/fora do ar/.test($(e, "#toast-host").textContent)); });
  e.w.close();

  console.log("\nB) Quem vê o pop-up");
  assert.equal(await shown({}), true); passed++; console.log("  ✔ visitante (não cadastrado) vê");
  assert.equal(await shown({ user: { plan: "plateia" } }), true); passed++; console.log("  ✔ cadastrado no plano gratuito vê");
  assert.equal(await shown({ user: { plan: "balcao", planExpiry: new Date(Date.now() - 2 * DAY).toISOString() } }), true); passed++; console.log("  ✔ cadastrado com plano pago VENCIDO vê");
  assert.equal(await shown({ user: { plan: "balcao", planExpiry: new Date(Date.now() + 20 * DAY).toISOString() } }), false); passed++; console.log("  ✔ cadastrado com plano pago ATIVO não vê");
  assert.equal(await shown({ user: { plan: "camarote", planExpiry: new Date(Date.now() + 2 * DAY).toISOString() } }), false); passed++; console.log("  ✔ idem para o plano mais alto (Camarote) ativo");
  assert.equal(await shown({ user: { role: "admin", plan: "plateia" } }), true); passed++; console.log("  ✔ administrador SEM plano também vê (regra aplicada ao pé da letra; o painel admin nunca mostra)");

  console.log("\nC) Toda vez que a página é acessada (nada fica guardado)");
  e = await makeEnv({}); fire(e); await tick(60);
  const before = JSON.stringify(Object.keys(e.w.localStorage).sort());
  $(e, "[data-conv-close]").click(); await tick(450);
  ok("fechar não grava nada no navegador (por isso volta a cada acesso)", () => { assert.equal(JSON.stringify(Object.keys(e.w.localStorage).sort()), before); assert.equal(e.w.sessionStorage.length, 0); });
  ok("o código do pop-up não usa localStorage/sessionStorage/cookies", () => { const a = html.indexOf("const CONV_DELAY_MS"), b = html.indexOf("function startConversionTimer"); assert.ok(a > 0 && b > a); assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(html.slice(a, b))); });
  e.w.close();
  e = await makeEnv({}); fire(e); await tick(60);
  ok("um acesso novo (nova carga) abre o pop-up de novo", () => assert.ok($(e, "#conv-main")));
  e.w.close();

  console.log("\nD) Fechar vira o mini pop-up");
  e = await makeEnv({}); fire(e); await tick(60);
  $(e, "#conv-main .conv-close").click();
  ok("ao fechar, o cartão encolhe em direção ao canto (animação) antes de sair", () => assert.ok($(e, "#conv-card").classList.contains("closing")));
  await tick(450);
  ok("o principal some, a rolagem é liberada e aparece o MINI fixo no canto", () => { assert.equal($(e, "#conv-main"), null); assert.ok(!e.w.document.body.classList.contains("conv-open")); assert.ok($(e, "#conv-mini")); assert.ok(e.w.document.body.classList.contains("has-conv-mini")); });
  ok("o mini mostra miniaturas das capas (3) e o chamado para assinar", () => { const t = $$(e, "#conv-mini .conv-mini-thumbs i"); assert.equal(t.length, 3); assert.ok(t.every(i => /url\('http:\/\/x\/r\d\.png'\)/.test(i.getAttribute("style")))); assert.match($(e, "#conv-mini").textContent, /Assine agora/); });
  ok("o mini leva a #/planos", () => assert.equal($(e, "#conv-mini [data-conv-cta]").getAttribute("href"), "#/planos"));
  ok("o mini PULA: animação de 'bounce' infinita, só com translateY para cima, e desligada para quem pede menos movimento", () => {
    assert.match(html, /\.conv-mini\{[^}]*animation:conv-bounce 2\.2s ease-in-out infinite/);
    assert.match(html, /@keyframes conv-bounce\{[\s\S]*?translateY\(-13px\)/); assert.ok(!/@keyframes conv-bounce\{[\s\S]*?translateY\(\d/.test(html.slice(html.indexOf('@keyframes conv-bounce'), html.indexOf('@keyframes conv-bounce') + 330).replace(/translateY\(0\)/g, '')), 'o bounce só deve subir');
    assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{ \.conv-overlay, \.conv-card, \.conv-card\.closing, \.conv-mini\{animation:none;\} \}/);
  });
  ok("o mini fica fixo no canto direito, acima da barra de navegação", () => assert.match(html, /\.conv-mini\{position:fixed; right:14px; bottom:calc\(96px \+ env\(safe-area-inset-bottom,0px\)\); z-index:75;/));
  e.w.eval("refreshConversion()");
  ok("o pop-up principal NÃO reabre sozinho depois de fechado", () => { assert.equal($(e, "#conv-main"), null); assert.equal($$(e, "#conv-mini").length, 1); });
  await go(e, "#/catalogo", 200);
  ok("o mini acompanha a navegação entre telas (continua fixo, um só)", () => assert.equal($$(e, "#conv-mini").length, 1));
  await go(e, "#/planos", 200);
  ok("na página de Planos o convite sai da frente (a pessoa já está assinando)", () => { assert.equal($(e, "#conv-mini"), null); assert.equal($(e, "#conv-main"), null); });
  await go(e, "#/home", 200);
  ok("ao sair de Planos o mini volta (e o principal não)", () => { assert.ok($(e, "#conv-mini")); assert.equal($(e, "#conv-main"), null); });
  $(e, "#conv-mini .conv-mini-x").click(); await go(e, "#/catalogo", 150);
  ok("o × do mini dispensa a oferta até o próximo acesso (não volta ao navegar)", () => { assert.equal($(e, "#conv-mini"), null); e.w.eval("refreshConversion()"); assert.equal($(e, "#conv-mini"), null); });
  e.w.close();

  e = await makeEnv({}); fire(e); await tick(60);
  key(e, "Escape"); await tick(450);
  ok("Esc fecha o principal e vira mini", () => { assert.equal($(e, "#conv-main"), null); assert.ok($(e, "#conv-mini")); });
  e.w.close();
  e = await makeEnv({}); fire(e); await tick(60);
  $(e, "#conv-card").dispatchEvent(new e.w.MouseEvent("click", { bubbles: true })); await tick(450);
  ok("clicar DENTRO do cartão não fecha", () => assert.ok($(e, "#conv-main")));
  $(e, "#conv-main").dispatchEvent(new e.w.MouseEvent("click", { bubbles: true })); await tick(450);
  ok("clicar no fundo escuro fecha e vira mini", () => { assert.equal($(e, "#conv-main"), null); assert.ok($(e, "#conv-mini")); });
  e.w.close();
  e = await makeEnv({}); fire(e); await tick(60);
  $(e, ".conv-later").click(); await tick(450);
  ok("'Agora não' fecha e vira mini", () => assert.ok($(e, "#conv-mini") && !$(e, "#conv-main")));
  e.w.close();
  e = await makeEnv({}); fire(e); await tick(60);
  $(e, "#conv-main [data-conv-cta]").click(); await tick(100);
  ok("clicar em 'Ver planos' fecha o principal na hora (sem animar) e o mini fica guardado para depois", () => { assert.equal($(e, "#conv-main"), null); assert.ok(!e.w.document.body.classList.contains("conv-open")); });
  e.w.close();

  console.log("\nE) Acessibilidade do pop-up principal");
  e = await makeEnv({});
  const antes = e.w.document.createElement("button"); antes.id = "antes"; e.w.document.body.appendChild(antes); antes.focus();
  fire(e); await tick(60);
  const f = $$(e, "#conv-main button, #conv-main a[href]"), primeiro = f[0], ultimo = f[f.length - 1];
  ultimo.focus(); key(e, "Tab");
  ok("Tab no último item volta ao primeiro (o foco fica preso dentro do pop-up)", () => assert.equal(e.w.document.activeElement, primeiro));
  key(e, "Tab", { shiftKey: true });
  ok("Shift+Tab no primeiro vai ao último", () => assert.equal(e.w.document.activeElement, ultimo));
  $(e, ".conv-later").click(); await tick(450);
  ok("ao fechar, o foco volta para onde estava antes de abrir", () => assert.equal(e.w.document.activeElement.id, "antes"));
  e.w.close();

  console.log("\nF) Não interrompe quem está ocupado: espera uma tela livre");
  e = await makeEnv({}); await go(e, "#/planos", 200); fire(e); await tick(80);
  ok("disparou em Planos: não aparece ali", () => assert.equal($(e, "#conv-main"), null));
  await go(e, "#/home", 200);
  ok("…e aparece assim que a pessoa vai para uma tela livre", () => assert.ok($(e, "#conv-main")));
  e.w.close();
  e = await makeEnv({}); await go(e, "#/login", 200); fire(e); await tick(80);
  ok("disparou na tela de login (digitando senha): não atrapalha", () => assert.equal($(e, "#conv-main"), null));
  e.w.close();
  e = await makeEnv({}); e.w.eval("reel = { __fake: true }"); fire(e); await tick(80);
  ok("disparou com o player aberto (assistindo): não interrompe o vídeo", () => assert.equal($(e, "#conv-main"), null));
  e.w.eval("reel = null"); await go(e, "#/catalogo", 200);
  ok("quando sai do player, o convite que estava esperando aparece", () => assert.ok($(e, "#conv-main")));
  e.w.close();
  e = await makeEnv({}); fire(e); await tick(60); await go(e, "#/reel/a1", 200);
  ok("se o pop-up está aberto e a pessoa entra no player, ele sai da frente e vira mini", () => { assert.equal($(e, "#conv-main"), null); assert.ok(!e.w.document.body.classList.contains("conv-open")); });
  e.w.close();

  console.log("\nG) Deixa de aparecer quando a pessoa assina");
  e = await makeEnv({}); fire(e); await tick(60); $(e, ".conv-later").click(); await tick(450);
  ok("(mini visível)", () => assert.ok($(e, "#conv-mini")));
  e.w.eval(`DB.me = { id: "u1", name: "Ana", role: "user", plan: "balcao", planExpiry: "${new Date(Date.now() + 25 * DAY).toISOString()}" }; localStorage.setItem("minidrama_token","tok");`);
  await go(e, "#/catalogo", 200);
  ok("plano pago ativo: o mini some", () => { assert.equal($(e, "#conv-mini"), null); assert.ok(!e.w.document.body.classList.contains("has-conv-mini")); });
  e.w.close();

  console.log("\nH) Convivência com o balão de instalar o app");
  e = await makeEnv({ ua: UA_ANDROID });
  e.w.eval("installReady = true");
  fire(e); await tick(60);
  e.w.eval("refreshInstallBanner()");
  ok("com o pop-up principal aberto, o balão de instalar espera", () => assert.equal($(e, "#install-banner"), null));
  $(e, ".conv-later").click(); await tick(450);
  ok("ao fechar o pop-up, o balão de instalar pode aparecer", () => assert.ok($(e, "#install-banner")));
  ok("com o mini presente, o balão sobe para não ficar por baixo dele", () => { assert.ok(e.w.document.body.classList.contains("has-conv-mini")); assert.match(html, /body\.has-conv-mini \.install-banner\{bottom:calc\(176px/); });
  e.w.close();

  console.log(`\n${passed} verificações passaram${process.exitCode ? " — COM FALHAS" : ""}`);
  process.exit(process.exitCode || 0);
})().catch(err => { console.error("ERRO NO HARNESS:", err); process.exit(2); });
