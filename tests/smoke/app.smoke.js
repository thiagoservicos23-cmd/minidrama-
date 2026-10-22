// Teste de fumaça do "formato app": barra inferior, pesquisa, continuar assistindo e minha lista.
// Roda o index.html real num DOM simulado (jsdom). Não entra no "npm test" (precisa do jsdom):
//   npm install --no-save jsdom && node tests/smoke/app.smoke.js
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const html = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log("  ✔", name); } catch (e) { console.log("  ✘", name, "\n     ", e.message); process.exitCode = 1; } };

const P = (id, title, extra = {}) => ({ id, title, posterUrl: "http://x/p.png", backdropUrl: "http://x/b.png", requiresPlan: "plateia", canWatch: true, hasVideo: true, durationMinutes: 90, releaseYear: 2025, genre: "Drama", synopsis: "s", ...extra });
const CATALOG = [P("p1", "O Silêncio das Cortinas"), P("p2", "Peça Dois"), P("p3", "Peça Três", { requiresPlan: "camarote", canWatch: false })];
const FUTURE = new Date(Date.now() + 20 * 864e5).toISOString();

const HOME = { featured: [], novos: CATALOG, genres: [{ id: "drama", label: "Drama", plays: CATALOG, total: 3 }], catalog: [{ id: "drama", label: "Drama" }], total: 3 };
const PLANS = [{ id: "plateia", name: "Plateia", price: 0, benefits: [] }, { id: "balcao", name: "Balcão", price: 14.9, benefits: [] }, { id: "camarote", name: "Camarote", price: 24.9, benefits: [] }];

async function makeEnv(o = {}) {
  const calls = []; const saved = (o.listPlays || []).slice();
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false }); w.scrollTo = () => {};
      w.Element.prototype.scrollBy = function (a) { w.__scrollBy = a; };
      Object.defineProperty(w.HTMLElement.prototype, "clientWidth", { get() { return 1000; } });   // jsdom não calcula layout
      // posições da barra flutuante: cada aba tem 64px de largura e começa em 10 + 70*índice
      const navIdx = (el) => [...(el.parentElement ? el.parentElement.children : [])].filter(c => c.classList && c.classList.contains("fnav-item")).indexOf(el);
      Object.defineProperty(w.HTMLElement.prototype, "offsetLeft", { get() { const i = navIdx(this); return i >= 0 ? 10 + 70 * i : 0; } });
      Object.defineProperty(w.HTMLElement.prototype, "offsetWidth", { get() { return navIdx(this) >= 0 ? 64 : 0; } });
      w.fetch = async (url, init = {}) => {
        const method = init.method || "GET", pth = String(url).replace(/^\/api/, "");
        calls.push({ method, path: pth });
        const res = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
        if (pth === "/plays/feed/home") return res(HOME);                 // o boot do site precisa terminar de verdade
        if (pth === "/plans") return res({ plans: PLANS });
        if (pth === "/me/home") return res({ continue: o.cont || [], listIds: o.listIds || [] });
        if (pth === "/me/list" && method === "GET") return res({ plays: saved });
        if (pth.startsWith("/me/list/")) {
          if (o.failList) return res({ error: "Falha ao salvar." }, 500);
          const id = pth.split("/").pop(), at = saved.findIndex(p => p.id === id);
          if (method === "DELETE" && at >= 0) saved.splice(at, 1);                    // o servidor simulado lembra do que mudou
          if (method === "PUT" && at < 0) saved.push(CATALOG.find(p => p.id === id) || P(id, id));
          return res({ ok: true });
        }
        const one = pth.match(/^\/plays\/(\w+)$/);
        if (one) return res({ play: { ...(CATALOG.find(p => p.id === one[1]) || CATALOG[0]), videoUrl: "http://x/v.mp4", director: "D", cast: "C" }, canWatch: true, resume: null });
        if (pth.startsWith("/me/progress/")) return res({ ok: true });
        if (pth === "/plays/facets") return res({ years: [], plans: [] });
        if (pth.startsWith("/plays/trending")) return o.trendingFail ? res({ error: "ranking fora do ar" }, 500) : res({ plays: o.trendingEmpty ? [] : CATALOG.slice(0, 2), ranked: 2 });
        if (pth.startsWith("/plays?") && !pth.includes("search=")) return res({ plays: CATALOG, total: CATALOG.length, totalPages: 1, page: 1 });   // catálogo
        const m = pth.match(/^\/plays\?page=(\d+)&pageSize=\d+&search=(.*)$/);
        if (m) { const q = decodeURIComponent(m[2]); const r = o.search ? await o.search(q, Number(m[1])) : { plays: [], total: 0, totalPages: 1 }; return res({ page: Number(m[1]), ...r }); }
        return res({});
      };
    }
  });
  const w = dom.window;
  for (let t0 = Date.now(); !w.document.querySelector("#site-header") && Date.now() - t0 < 5000;) await tick(20);   // espera o boot desenhar a home
  w.eval(`DB.plans = [{id:"plateia",name:"Plateia",price:0,benefits:[]},{id:"balcao",name:"Balcão",price:14.9,benefits:[]},{id:"camarote",name:"Camarote",price:24.9,benefits:[]}];
    DB.me = ${o.visitor ? "null" : JSON.stringify({ id: "u1", name: "Ana Souza", role: "user", plan: o.plan || "plateia", planExpiry: FUTURE })}; localStorage.setItem("minidrama_token","tok");
    DB.home = ${JSON.stringify({ featured: [], novos: CATALOG, genres: [{ id: "drama", label: "Drama", plays: CATALOG, total: 3 }], catalog: [{ id: "drama", label: "Drama" }], total: 3 })};`);
  return { w, calls };
}
const go = async (e, hash, ms = 120) => { e.w.location.hash = hash; await tick(ms); };
const $ = (e, sel) => e.w.document.querySelector(sel), $$ = (e, sel) => [...e.w.document.querySelectorAll(sel)];
const type = async (e, v, wait = 360) => { const i = $(e, "#search-input"); i.value = v; i.dispatchEvent(new e.w.Event("input", { bubbles: true })); await tick(wait); };

(async () => {
  console.log("\nA) Home logada: continuar assistindo, corações e barra inferior");
  const CONT = [{ ...P("p2", "Peça Dois"), progress: { position: 4020, duration: 5400 } }, { ...P("p3", "Bloqueada", { canWatch: false }), progress: { position: 100, duration: 3600 } }];
  let e = await makeEnv({ cont: CONT, listIds: ["p1"] });
  await go(e, "#/home", 200);
  ok("a fileira 'Continue assistindo' aparece no topo, antes dos gêneros", () => { const heads = $$(e, ".section-title").map(h => h.textContent); assert.equal(heads[0], "Continue assistindo"); assert.equal($$(e, ".cw-card").length, 2); });
  ok("mostra a barra de progresso (74%) e '23min restantes'", () => { const c = $$(e, ".cw-card")[0]; assert.equal(c.querySelector(".cw-bar i").style.width, "74%"); assert.match(c.querySelector(".cw-left").textContent, /^23min restantes$/); });
  ok("retomar abre o reel; peça sem acesso abre a página (com o aviso de plano)", () => { const hs = $$(e, ".cw-link").map(a => a.getAttribute("href")); assert.deepEqual(hs, ["#/reel/p2", "#/peca/p3"]); });
  ok("corações vêm marcados conforme a lista do servidor", () => { const on = $$(e, ".card [data-heart]").filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.heart); assert.ok(on.includes("p1")); assert.ok(!on.includes("p2")); });
  ok("barra flutuante tem 5 abas e 'Início' ativa; logada vê 'Conta'", () => { const tabs = $$(e, ".fnav-item"); assert.equal(tabs.length, 5); assert.equal($(e, ".fnav-item.active").textContent.trim(), "Início"); assert.equal(tabs[4].textContent.trim(), "Conta"); assert.equal($(e, ".fnav-item.active").getAttribute("aria-current"), "page"); });
  ok("card de peça liberada abre DIRETO no player; peça bloqueada abre a página da peça", () => {
    const hrefs = Object.fromEntries($$(e, ".section-row .card").map(a => [a.querySelector("[data-heart]").dataset.heart, a.getAttribute("href")]));
    assert.equal(hrefs.p1, "#/reel/p1"); assert.equal(hrefs.p2, "#/reel/p2"); assert.equal(hrefs.p3, "#/peca/p3");
  });
  ok("plano gratuito vê o botão 'Assinar' no topo", () => assert.ok($(e, ".header-actions a.btn-sub")));
  ok("fileiras têm setas para o computador", () => assert.ok($$(e, ".rail-wrap .rail-arrow").length >= 2));
  $(e, ".rail-arrow.right").click();
  ok("seta direita rola a fileira para frente", () => assert.ok(e.w.__scrollBy && e.w.__scrollBy.left > 0));

  const heart = () => $$(e, ".section-row ~ * .card [data-heart], .card [data-heart]").find(b => b.dataset.heart === "p2");
  heart().click(); await tick(40);
  ok("tocar no coração salva (PUT /me/list/p2) e marca na hora", () => { assert.ok(e.calls.some(c => c.method === "PUT" && c.path === "/me/list/p2")); assert.equal(heart().getAttribute("aria-pressed"), "true"); });
  ok("tocar no coração NÃO abre a página da peça", () => assert.equal(e.w.location.hash, "#/home"));
  heart().click(); await tick(40);
  ok("tocar de novo remove (DELETE)", () => { assert.ok(e.calls.some(c => c.method === "DELETE" && c.path === "/me/list/p2")); assert.equal(heart().getAttribute("aria-pressed"), "false"); });
  $(e, "[data-cw-remove='p2']").click(); await tick(40);
  ok("X do continuar assistindo apaga o progresso e tira o card", () => { assert.ok(e.calls.some(c => c.method === "DELETE" && c.path === "/me/progress/p2")); assert.equal($$(e, ".cw-card").length, 1); });
  e.w.close();

  console.log("\nB) Falha ao salvar na lista; visitante; plano pago");
  e = await makeEnv({ failList: true, plan: "balcao" });
  await go(e, "#/home", 200);
  const h2 = $$(e, ".card [data-heart]").find(b => b.dataset.heart === "p2"); h2.click(); await tick(60);
  ok("se o servidor falhar, o coração volta ao estado anterior e avisa", () => { assert.equal(h2.getAttribute("aria-pressed"), "false"); assert.match($(e, "#toast-host").textContent, /Falha ao salvar/); });
  ok("plano pago ativo NÃO mostra o botão 'Assinar'", () => assert.equal($(e, ".header-actions a.btn-sub"), null));
  e.w.close();
  e = await makeEnv({ visitor: true });
  await go(e, "#/home", 150);
  $$(e, ".card [data-heart]")[0].click(); await tick(60);
  ok("visitante que toca no coração é levado ao login (sem chamar o servidor)", () => { assert.equal(e.w.location.hash, "#/login"); assert.ok(!e.calls.some(c => c.path.startsWith("/me/list"))); });
  ok("visitante não tem fileira de continuar assistindo", () => assert.equal($(e, "#cw-slot"), null));
  e.w.close();

  console.log("\nC) Pesquisa");
  const R = (...pl) => ({ plays: pl, total: pl.length, totalPages: 1 });
  e = await makeEnv({ listIds: [], search: async (q, page) => { if (q === "sil") { await tick(450); return R(P("old", "RESULTADO VELHO")); } if (q === "silencio") return R(CATALOG[0]); if (q === "nada") return R(); if (q === "muitas") return page === 1 ? { plays: [P("m1", "M1")], total: 2, totalPages: 2 } : { plays: [P("m2", "M2")], total: 2, totalPages: 2 }; return R(); } });
  await go(e, "#/buscar", 100);
  ok("página de busca abre com o campo em foco; a lupa do topo continua e nenhuma aba fica marcada", () => { assert.ok($(e, "#search-input")); assert.equal(e.w.document.activeElement.id, "search-input"); assert.ok($(e, '.header-actions a[href="#/buscar"]')); assert.ok($(e, ".fnav-item")); assert.equal($(e, ".fnav-item.active"), null); });
  await type(e, "sil", 330); await type(e, "silencio", 330); await tick(250);
  ok("resposta atrasada de uma digitação antiga NÃO sobrescreve a atual", () => { const t = $$(e, "#search-grid .card-title").map(x => x.textContent); assert.deepEqual(t, ["O Silêncio das Cortinas"]); assert.ok(!$(e, "#search-out").textContent.includes("VELHO")); });
  ok("mostra a contagem e a URL acompanha a busca", () => { assert.match($(e, ".search-count").textContent, /1 resultado para “silencio”/); assert.equal(e.w.location.hash, "#/buscar/silencio"); });
  await type(e, "nada");
  ok("sem resultados mostra mensagem útil", () => assert.match($(e, ".search-empty").textContent, /Nenhuma peça para “nada”/));
  await type(e, "muitas");
  $(e, "#search-more").click(); await tick(60);
  ok("'Ver mais' acrescenta a página 2 e some quando acaba", () => { assert.deepEqual($$(e, "#search-grid .card-title").map(x => x.textContent), ["M1", "M2"]); assert.equal($(e, "#search-more"), null); });
  const inp = $(e, "#search-input"); inp.value = "silencio"; inp.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await tick(80);
  ok("Enter guarda a busca recente", () => assert.deepEqual(JSON.parse(e.w.localStorage.getItem("md_recent_searches")), ["silencio"]));
  $(e, "#search-clear").click(); await tick(40);
  ok("limpar volta ao estado inicial com a busca recente em destaque", () => { assert.equal($(e, "#search-input").value, ""); assert.equal($$(e, "[data-recent]").length, 1); });
  $(e, "[data-recent]").click(); await tick(80);
  ok("tocar na busca recente refaz a pesquisa", () => assert.equal($$(e, "#search-grid .card").length, 1));
  await type(e, '<img src=x onerror="window.__pwn=1">'); 
  ok("HTML digitado na busca é escapado", () => { assert.equal(e.w.__pwn, undefined); assert.equal($$(e, "#search-out img").length, 0); });
  e.w.close();

  console.log("\nD) Sair da pesquisa com busca pendente");
  e = await makeEnv({ search: async () => R(CATALOG[0]) });
  await go(e, "#/buscar", 100); await type(e, "silen", 50); await go(e, "#/home", 120); await tick(400);
  ok("busca agendada não mexe na URL depois que a pessoa já saiu da tela", () => assert.equal(e.w.location.hash, "#/home"));
  e.w.close();

  console.log("\nE) Minha lista");
  e = await makeEnv({ visitor: true });
  await go(e, "#/minha-lista", 100);
  ok("visitante é mandado para o login", () => assert.equal(e.w.location.hash, "#/login"));
  e.w.close();
  e = await makeEnv({ listPlays: [CATALOG[0], CATALOG[1]], listIds: ["p1", "p2"] });
  await go(e, "#/minha-lista", 150);
  ok("lista mostra as peças salvas, a contagem e a aba ativa", () => { assert.equal($$(e, "#list-grid .card").length, 2); assert.equal($(e, "#list-count").textContent, "2 peças salvas"); assert.equal($(e, ".fnav-item.active").textContent.trim(), "Minha lista"); });
  ok("todos os corações da lista aparecem marcados", () => assert.ok($$(e, "#list-grid [data-heart]").every(b => b.getAttribute("aria-pressed") === "true")));
  $$(e, "#list-grid [data-heart]")[0].click(); await tick(60);
  ok("desfavoritar na lista tira o card na hora e atualiza a contagem", () => { assert.equal($$(e, "#list-grid .card").length, 1); assert.equal($(e, "#list-count").textContent, "1 peça salva"); });
  $$(e, "#list-grid [data-heart]")[0].click(); await tick(150);
  ok("ao esvaziar, mostra o estado vazio com convite ao catálogo", () => assert.match($(e, ".search-empty").textContent, /Sua lista está vazia/));
  e.w.close();

  console.log("\nF) Página da peça");
  e = await makeEnv({ listIds: ["p1"] });
  await go(e, "#/peca/p1", 200);
  ok("botão 'Minha lista' na página da peça reflete se já está salva", () => { const b = $(e, ".detail-actions [data-heart]"); assert.ok(b); assert.equal(b.getAttribute("aria-pressed"), "true"); });
  e.w.close();


  console.log("\nG2) Barra de navegação flutuante (embaixo)");
  e = await makeEnv({});
  await go(e, "#/home", 200);
  ok("a navegação saiu do topo: sem menu, hambúrguer nem gaveta; o cabeçalho só tem marca, busca e conta", () => { assert.equal($(e, ".main-nav"), null); assert.equal($(e, ".hamburger"), null); assert.equal($(e, ".mobile-drawer"), null); assert.ok($(e, ".site-header .brand")); assert.ok($(e, ".fnav .fnav-bar")); });
  ok("a barra fica dentro da tela inferior (fixa, centralizada e com margem da área segura do iPhone)", () => assert.match(html, /\.fnav\{position:fixed; left:50%; bottom:calc\(14px \+ env\(safe-area-inset-bottom,0px\)\)/));
  await tick(60);
  ok("indicador fica sob a aba ativa (Início = 1ª aba: x=10, largura 64)", () => { const i = $(e, "#fnav-ind"); assert.equal(i.style.width, "64px"); assert.equal(i.style.transform, "translateX(10px)"); assert.equal(i.style.opacity, "1"); });
  ok("a nova tela já nasce com o indicador na posição ANTIGA (é isso que faz ele deslizar entre telas)", () => assert.match(e.w.eval('FloatingNav(currentUser(), "#/catalogo")'), /id="fnav-ind" style="width:64px; transform:translateX\(10px\);"/));
  await go(e, "#/catalogo", 250);
  ok("ao ir para o Catálogo o indicador vai para a 2ª aba (x=80) e a aba fica ativa", () => { assert.equal($(e, ".fnav-item.active").textContent.trim(), "Catálogo"); assert.equal($(e, "#fnav-ind").style.transform, "translateX(80px)"); });
  ok("o indicador anima por transição de CSS e respeita 'reduzir movimento'", () => { assert.match(html, /\.fnav-ind\{[^}]*transition:transform \.4s/); assert.match(html, /prefers-reduced-motion:reduce\)\{ \.fnav-ind\{transition:opacity \.2s;\} \}/); });
  await go(e, "#/peca/p1", 250);
  ok("numa tela sem aba (ex.: página da peça) o indicador some em vez de ficar parado na aba errada", () => { assert.equal($(e, ".fnav-item.active"), null); assert.equal($(e, "#fnav-ind").style.opacity, "0"); });
  ok("aviso (toast) e balão de instalar ficam ACIMA da barra, não por baixo dela", () => { assert.match(html, /#toast-host\{position:fixed; bottom:calc\(96px/); assert.match(html, /\.install-banner\{position:fixed; left:12px; right:12px; bottom:calc\(98px/); });
  e.w.close();
  e = await makeEnv({ visitor: true });
  await go(e, "#/home", 200);
  ok("visitante vê: Início, Catálogo, Surpresa, Minha lista e Entrar (sem Admin)", () => assert.deepEqual($$(e, ".fnav-item").map(a => a.textContent.trim()), ["Início", "Catálogo", "Surpresa", "Minha lista", "Entrar"]));
  await go(e, "#/login", 150);
  ok("tela de login não mostra a barra de navegação", () => assert.equal($(e, ".fnav"), null));
  e.w.close();
  e = await makeEnv({});
  e.w.eval('DB.me.role = "admin"');
  await go(e, "#/home", 200);
  ok("administrador ganha a aba 'Admin' (6 abas)", () => { const t = $$(e, ".fnav-item").map(a => a.textContent.trim()); assert.equal(t.length, 6); assert.equal(t[5], "Admin"); assert.equal($$(e, ".fnav-item")[5].getAttribute("href"), "#/admin"); });
  e.w.close();


  console.log("\nG3) Em alta no começo do catálogo");
  e = await makeEnv({});
  await go(e, "#/catalogo", 250);
  ok("catálogo abre com a seção 'Em alta' ANTES das peças e do filtro", () => {
    const row = $(e, "#trending-row"); assert.ok(row); assert.equal(row.querySelector(".section-title").textContent, "Em alta");
    assert.equal($$(e, "#trending-row .card").length, 2);
    assert.ok(row.compareDocumentPosition($(e, ".catalog-bar")) & e.w.Node.DOCUMENT_POSITION_FOLLOWING, "Em alta deve vir antes da barra de filtros");
    assert.equal($$(e, ".section-title")[1].textContent, "Todas as peças");
  });
  ok("pede ao servidor 12 peças em alta, uma única vez", () => assert.equal(e.calls.filter(c => c.path === "/plays/trending?limit=12").length, 1));
  ok("peças em alta também abrem direto no player", () => assert.ok($$(e, "#trending-row .card").every(a => /^#\/reel\//.test(a.getAttribute("href")))));
  $$(e, "#genre-filters .chip")[1].click(); await tick(150);
  ok("escolher um gênero esconde 'Em alta' (a pessoa pediu algo específico)", () => assert.equal($(e, "#trending-row"), null));
  e.w.close();
  e = await makeEnv({});
  await go(e, "#/catalogo", 250);
  const before = e.calls.filter(c => c.path.startsWith("/plays/trending")).length;
  e.w.eval("catalogFilters.year = '2025'"); await e.w.eval("reloadCatalog()");
  ok("com filtros aplicados, 'Em alta' some e o servidor nem é consultado", () => { assert.equal($(e, "#trending-row"), null); assert.equal(e.calls.filter(c => c.path.startsWith("/plays/trending")).length, before); });
  e.w.close();
  e = await makeEnv({ trendingFail: true });
  await go(e, "#/catalogo", 250);
  ok("se o ranking falhar, o catálogo abre normalmente sem a seção", () => { assert.equal($(e, "#trending-row"), null); assert.equal($$(e, ".card").length, 3); assert.ok($(e, ".catalog-bar")); });
  e.w.close();
  e = await makeEnv({ trendingEmpty: true });
  await go(e, "#/catalogo", 250);
  ok("sem peças em alta não mostra título solto nem 'Todas as peças' sobrando", () => { assert.equal($(e, "#trending-row"), null); assert.ok(!$$(e, ".section-title").some(h => h.textContent === "Todas as peças")); });
  e.w.close();

  console.log(`\n${passed} verificações passaram${process.exitCode ? " — COM FALHAS" : ""}`);
  process.exit(process.exitCode || 0);
})().catch(err => { console.error("ERRO NO HARNESS:", err); process.exit(2); });
