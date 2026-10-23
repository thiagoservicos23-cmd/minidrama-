// Teste de fumaça da fase 2: filtros do catálogo (gaveta) e tela Surpresa.
// Roda o index.html real num DOM simulado (jsdom). Não entra no "npm test" (precisa do jsdom):
//   npm install --no-save jsdom && node tests/smoke/phase2.smoke.js
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const html = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log("  ✔", name); } catch (e) { console.log("  ✘", name, "\n     ", e.message); process.exitCode = 1; } };

const P = (id, title, extra = {}) => ({ id, title, posterUrl: "http://x/" + id + ".png", backdropUrl: "http://x/b.png", requiresPlan: "plateia", canWatch: true, hasVideo: true, durationMinutes: 90, releaseYear: 2025, genre: "Drama", synopsis: "Uma sinopse longa.", ...extra });
const CATALOG = [P("p1", "Novelinha Um"), P("p2", "Novelinha Dois"), P("p3", "Novelinha Três", { requiresPlan: "camarote", canWatch: false })];
const HOME = { featured: [], novos: CATALOG, genres: [{ id: "drama", label: "Drama", plays: CATALOG, total: 3 }], catalog: [{ id: "drama", label: "Drama" }], total: 3 };
const PLANS = [{ id: "plateia", name: "Plateia", price: 0, benefits: [] }, { id: "balcao", name: "Balcão", price: 14.9, benefits: [] }, { id: "camarote", name: "Camarote", price: 24.9, benefits: [] }];
const FACETS = { years: [{ year: 2025, count: 3 }, { year: 2024, count: 1 }], plans: [{ id: "plateia", count: 2 }, { id: "camarote", count: 2 }] };

async function makeEnv(o = {}) {
  const calls = [], randomCalls = []; let randomFailed = false;
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false }); w.scrollTo = () => {};
      w.fetch = async (url, init = {}) => {
        const pth = String(url).replace(/^\/api/, "");
        calls.push(pth);
        const res = (d, st = 200) => ({ ok: st < 400, status: st, json: async () => d });
        if (pth === "/plays/feed/home") return res(HOME);
        if (pth === "/plans") return res({ plans: PLANS });
        if (pth === "/me/home") return res({ continue: [], listIds: [] });
        if (pth === "/plays/facets") return res(o.facets || FACETS);
        if (pth.startsWith("/plays/random")) {
          randomCalls.push(pth);
          if (o.randomFailOnce && !randomFailed && pth.includes("count=1")) { randomFailed = true; return res({ error: "Sem conexão." }, 500); }
          const all = o.randomPool || CATALOG, q = new URLSearchParams(pth.split("?")[1]);
          const want = Math.min(Number(q.get("count")) || 1, 12), ex = q.get("exclude");
          const pool = all.filter(p => p.id !== ex);
          return res({ plays: (pool.length ? pool : all).slice(0, want), total: all.length });
        }
        if (pth.startsWith("/plays?")) {
          const isPool = pth.includes("pageSize=100");
          if (isPool && o.poolDelay) await tick(o.poolDelay);
          if (isPool && failPool) { failPool = false; return res({ error: "Sem conexão." }, 500); }
          const plays = isPool ? (o.pool || CATALOG) : (o.catalog ? o.catalog(pth) : CATALOG);
          return res({ plays, total: plays.length, totalPages: 1, page: 1 });
        }
        return res({});
      };
    }
  });
  const w = dom.window;
  for (let t0 = Date.now(); !w.document.querySelector("#site-header") && Date.now() - t0 < 5000;) await tick(20);
  w.eval(`DB.me = ${o.visitor ? "null" : JSON.stringify({ id: "u1", name: "Ana", role: "user", plan: "plateia", planExpiry: new Date(Date.now() + 864e6).toISOString() })}; localStorage.setItem("minidrama_token","tok");`);
  return { w, calls, randomCalls };
}
const $ = (e, s) => e.w.document.querySelector(s), $$ = (e, s) => [...e.w.document.querySelectorAll(s)];
const go = async (e, hash, ms = 150) => { e.w.location.hash = hash; await tick(ms); };
const plays = (e) => e.calls.filter(c => c.startsWith("/plays?page=1&pageSize=24"));
const choose = (e, id, v) => { const s = $(e, id); s.value = v; s.dispatchEvent(new e.w.Event("change", { bubbles: true })); };
const key = (e, k, opts = {}) => e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));

(async () => {
  console.log("\nA) Catálogo: gaveta de filtros");
  let e = await makeEnv();
  await go(e, "#/catalogo", 200);
  ok("catálogo mostra os chips de gênero e o botão Filtros (sem contador no início)", () => { assert.ok($(e, "#genre-filters .chip")); assert.ok($(e, "#open-filters")); assert.equal($(e, "#open-filters .chip-count"), null); });
  ok("pedido inicial não manda ordenação, ano nem plano", () => assert.match(plays(e).pop(), /^\/plays\?page=1&pageSize=24&genre=novos$/));
  $(e, "#open-filters").click(); await tick(80);
  ok("abrir os filtros busca /plays/facets e mostra a gaveta travando a rolagem do fundo", () => { assert.ok(e.calls.includes("/plays/facets")); assert.ok($(e, "#filters-drawer")); assert.ok(e.w.document.body.classList.contains("fdrawer-open")); });
  ok("anos e planos mostram só o que existe, com contagem, e o foco vai para o primeiro campo", () => {
    assert.deepEqual($$(e, "#f-year option").map(o => o.textContent), ["Todos", "2025 (3)", "2024 (1)"]);
    assert.deepEqual($$(e, "#f-plan option").map(o => o.textContent), ["Todos", "Plateia (2)", "Camarote (2)"]);
    assert.equal(e.w.document.activeElement.id, "f-sort");
  });
  choose(e, "#f-sort", "title"); choose(e, "#f-year", "2024"); choose(e, "#f-plan", "camarote");
  $(e, "[data-fapply]").click(); await tick(120);
  ok("Aplicar envia ordenação, ano e plano ao servidor e fecha a gaveta", () => { assert.match(plays(e).pop(), /genre=novos&sort=title&year=2024&plan=camarote$/); assert.equal($(e, "#filters-drawer"), null); assert.ok(!e.w.document.body.classList.contains("fdrawer-open")); });
  ok("o botão mostra quantos filtros estão ativos (3)", () => assert.equal($(e, "#open-filters .chip-count").textContent, "3"));
  ok("o foco volta para o botão Filtros ao fechar", () => assert.equal(e.w.document.activeElement.id, "open-filters"));
  $$(e, "#genre-filters .chip")[1].click(); await tick(120);
  ok("trocar de gênero mantém os filtros da gaveta", () => assert.match(plays(e).pop(), /genre=drama&sort=title&year=2024&plan=camarote$/));
  $(e, "#open-filters").click(); await tick(80);
  ok("a gaveta reabre já mostrando o que está aplicado", () => { assert.equal($(e, "#f-sort").value, "title"); assert.equal($(e, "#f-year").value, "2024"); assert.equal($(e, "#f-genre").value, "drama"); });
  const before = plays(e).length; choose(e, "#f-year", ""); key(e, "Escape"); await tick(60);
  ok("Esc fecha sem aplicar o que foi mexido", () => { assert.equal($(e, "#filters-drawer"), null); assert.equal(plays(e).length, before); });
  $(e, "#open-filters").click(); await tick(60); $(e, "#filters-drawer").dispatchEvent(new e.w.MouseEvent("click", { bubbles: true }));
  ok("clicar fora da gaveta também fecha", () => assert.equal($(e, "#filters-drawer"), null));
  $(e, "#open-filters").click(); await tick(60);
  const first = $(e, "[data-fclose]"), lastBtn = $(e, "[data-fapply]"); lastBtn.focus(); key(e, "Tab");
  ok("Tab no último botão volta ao primeiro item da gaveta (foco preso dentro dela)", () => assert.equal(e.w.document.activeElement, first));
  key(e, "Tab", { shiftKey: true });
  ok("Shift+Tab no primeiro item vai ao último botão", () => assert.equal(e.w.document.activeElement, lastBtn));
  $(e, "[data-fclear]").click(); await tick(120);
  ok("Limpar zera tudo e volta ao pedido simples", () => { assert.match(plays(e).pop(), /genre=novos$/); assert.equal($(e, "#open-filters .chip-count"), null); });
  e.w.close();

  console.log("\nB) Catálogo: sem resultados e saída com gaveta aberta");
  e = await makeEnv({ facets: { years: [{ year: 1999, count: 1 }], plans: [] }, catalog: (p) => (p.includes("year=1999") ? [] : CATALOG) });
  await go(e, "#/catalogo", 200);
  $(e, "#open-filters").click(); await tick(80);
  choose(e, "#f-year", "1999"); $(e, "[data-fapply]").click(); await tick(120);
  ok("sem resultados: mensagem com 'filtros' e atalho para limpar", () => { assert.match($(e, ".catalog-empty").textContent, /Nenhuma novelinha encontrada com esses filtros/); assert.ok($(e, "[data-fclear-inline]")); });
  $(e, "[data-fclear-inline]").click(); await tick(120);
  ok("'Limpar filtros' traz o catálogo de volta", () => { assert.equal($$(e, ".card").length, 3); assert.equal($(e, ".catalog-empty"), null); });
  $(e, "#open-filters").click(); await tick(80); await go(e, "#/home", 150);
  ok("sair do catálogo com a gaveta aberta fecha a gaveta e destrava a rolagem", () => { assert.equal($(e, "#filters-drawer"), null); assert.ok(!e.w.document.body.classList.contains("fdrawer-open")); });
  e.w.close();

  console.log("\nC) Surpresa (sorteio no servidor, entre TODAS as novelinhas)");
  e = await makeEnv({ randomPool: [P("old1", "A Mais Antiga"), P("n2", "Novelinha Dois"), P("n3", "Novelinha Três")] });
  await go(e, "#/surpresa", 60);
  ok("a tela abre com o baralho de 5 cartas e o botão JÁ habilitado (não espera carregar uma lista)", () => { assert.equal($$(e, "#deck .deck-card").length, 5); assert.equal($(e, "#surprise-go").disabled, false); assert.match($(e, "#surprise-go").textContent, /Sortear novelinha/); });
  ok("as capas do baralho vêm do sorteio entre todas (/plays/random?count=5) e não de uma lista das mais recentes", () => { assert.ok(e.randomCalls.includes("/plays/random?count=5")); assert.ok(!e.calls.some(c => c.includes("pageSize=100"))); });
  ok("barra flutuante: Surpresa ativa, 5 abas, sem 'Buscar' (a lupa fica no topo)", () => { const t = $$(e, ".fnav-item").map(a => a.textContent.trim()); assert.equal(t.length, 5); assert.ok(t.includes("Surpresa")); assert.ok(!t.includes("Buscar")); assert.equal($(e, ".fnav-item.active").textContent.trim(), "Surpresa"); });
  ok("o rodapé mostra a versão (para conferir se o deploy novo está no ar)", () => assert.match($(e, ".footer-bottom").textContent, /v\d{4}\.\d{2}\.\d{2}-/));
  $(e, "#surprise-go").click(); $(e, "#surprise-go").click(); $(e, "#surprise-go").click();
  ok("ao sortear, o baralho embaralha, o botão trava e clique repetido NÃO dispara vários sorteios", () => { assert.ok($(e, "#deck").classList.contains("shuffling")); assert.equal($(e, "#surprise-go").disabled, true); assert.equal(e.randomCalls.filter(c => c.startsWith("/plays/random?count=1")).length, 1); });
  await tick(1000);
  ok("mostra a novelinha sorteada com link para o player e o botão vira 'Sortear outra'", () => {
    const pick = $(e, ".pick"); assert.ok(pick);
    assert.match(pick.querySelector(".btn-gold").getAttribute("href"), /^#\/reel\/(old1|n2|n3)$/);
    assert.match($(e, "#surprise-go").textContent, /Sortear outra/); assert.equal($(e, "#surprise-go").disabled, false);
    assert.ok($(e, "#deck").classList.contains("done"));
  });
  const firstCall = e.randomCalls.filter(c => c.startsWith("/plays/random?count=1"))[0];
  const firstId = $(e, ".pick .btn-gold").getAttribute("href").split("/").pop();
  ok("1º sorteio sem 'exclude'", () => assert.equal(firstCall, "/plays/random?count=1"));
  $(e, "#surprise-go").click(); await tick(1000);
  ok("2º sorteio pede ao servidor para excluir a anterior e nunca repete", () => { const second = e.randomCalls.filter(c => c.startsWith("/plays/random?count=1"))[1]; assert.equal(second, "/plays/random?count=1&exclude=" + firstId); assert.notEqual($(e, ".pick .btn-gold").getAttribute("href").split("/").pop(), firstId); });
  ok("só há UM cartão de resultado por vez (sem listeners duplicados)", () => assert.equal($$(e, ".pick").length, 1));
  e.w.close();

  console.log("\nD) Surpresa: casos de borda");
  e = await makeEnv({ randomPool: [P("l1", "Só Bloqueada", { canWatch: false, requiresPlan: "camarote" })] });
  await go(e, "#/surpresa", 120); $(e, "#surprise-go").click(); await tick(1000);
  ok("a sorteada pode ser de plano que a pessoa não tem: mostra o plano, 'Ver detalhes' e 'Ver planos' (sorteio é de TODAS)", () => { assert.match($(e, ".pick-note").textContent, /plano Camarote/); assert.match($(e, ".pick .btn-gold").textContent, /Ver detalhes/); assert.match($(e, ".pick .btn-gold").getAttribute("href"), /^#\/novelinha\/l1$/); assert.equal($(e, '.pick a[href="#/planos"]').textContent, "Ver planos"); });
  e.w.close();
  e = await makeEnv({ randomPool: [] });
  await go(e, "#/surpresa", 200);
  ok("catálogo vazio: botão desabilitado com aviso claro", () => { assert.match($(e, "#surprise-go").textContent, /Ainda não há novelinhas/); assert.equal($(e, "#surprise-go").disabled, true); });
  e.w.close();
  e = await makeEnv({ randomFailOnce: true });
  await go(e, "#/surpresa", 150);
  $(e, "#surprise-go").click(); await tick(1000);
  ok("falha ao sortear: avisa o erro, mostra 'Tentar de novo' e libera o botão (sem travar)", () => { assert.match($(e, "#toast-host").textContent, /Sem conexão/); assert.match($(e, "#surprise-go").textContent, /Tentar de novo/); assert.equal($(e, "#surprise-go").disabled, false); assert.equal($(e, ".pick"), null); });
  $(e, "#surprise-go").click(); await tick(1000);
  ok("'Tentar de novo' sorteia e gera exatamente um resultado", () => { assert.equal($$(e, ".pick").length, 1); assert.match($(e, "#surprise-go").textContent, /Sortear outra/); });
  e.w.close();
  e = await makeEnv();
  await go(e, "#/surpresa", 150); $(e, "#surprise-go").click(); await go(e, "#/home", 1000);
  ok("sair da Surpresa no meio do sorteio não quebra nem desenha por cima da home", () => { assert.equal($(e, ".pick"), null); assert.equal(e.w.location.hash, "#/home"); });
  e.w.close();

  console.log(`\n${passed} verificações passaram${process.exitCode ? " — COM FALHAS" : ""}`);
  process.exit(process.exitCode || 0);
})().catch(err => { console.error("ERRO NO HARNESS:", err); process.exit(2); });
