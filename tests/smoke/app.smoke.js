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
  ok("barra inferior tem 5 abas e 'Início' ativa; logada vê 'Conta'", () => { const tabs = $$(e, ".tabbar a"); assert.equal(tabs.length, 5); assert.equal($(e, ".tabbar a.active").textContent.trim(), "Início"); assert.equal(tabs[4].textContent.trim(), "Conta"); });
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
  ok("página de busca abre com o campo em foco; a lupa do topo continua e nenhuma aba fica marcada", () => { assert.ok($(e, "#search-input")); assert.equal(e.w.document.activeElement.id, "search-input"); assert.ok($(e, '.header-actions a[href="#/buscar"]')); assert.equal($(e, ".tabbar a.active"), null); });
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
  ok("lista mostra as peças salvas, a contagem e a aba ativa", () => { assert.equal($$(e, "#list-grid .card").length, 2); assert.equal($(e, "#list-count").textContent, "2 peças salvas"); assert.equal($(e, ".tabbar a.active").textContent.trim(), "Minha lista"); });
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

  console.log(`\n${passed} verificações passaram${process.exitCode ? " — COM FALHAS" : ""}`);
  process.exit(process.exitCode || 0);
})().catch(err => { console.error("ERRO NO HARNESS:", err); process.exit(2); });
