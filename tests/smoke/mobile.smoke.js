// Teste de fumaça das correções de celular: telas de acesso (login/cadastro/recuperação) e balão de instalar o app.
// Roda o index.html real num DOM simulado (jsdom). Não entra no "npm test" (precisa do jsdom):
//   npm install --no-save jsdom && node tests/smoke/mobile.smoke.js
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const html = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log("  ✔", name); } catch (e) { console.log("  ✘", name, "\n     ", e.message); process.exitCode = 1; } };

const UA = {
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};
const P = (id, title, extra = {}) => ({ id, title, posterUrl: "http://x/" + id + ".png", backdropUrl: "http://x/b.png", requiresPlan: "plateia", canWatch: true, hasVideo: true, durationMinutes: 90, releaseYear: 2025, genre: "Drama", synopsis: "s", ...extra });
const CATALOG = [P("p1", "Novelinha Um"), P("p2", "Novelinha Dois"), P("p3", "Novelinha Três"), P("p4", "Novelinha Quatro"), P("p5", "Novelinha Cinco"), P("p6", "Novelinha Seis")];
const PLANS = [{ id: "plateia", name: "Plateia", price: 0, benefits: [] }];

async function makeEnv(o = {}) {
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) {
      Object.defineProperty(w.navigator, "userAgent", { value: o.ua || UA.desktop, configurable: true });   // a opção userAgent do jsdom não muda o navigator
      w.matchMedia = (q) => ({ matches: !!(o.standalone && String(q).includes("standalone")) });
      w.scrollTo = () => {};
      w.fetch = async (url, init = {}) => {
        const pth = String(url).replace(/^\/api/, ""), method = init.method || "GET";
        calls.push({ method, path: pth, body: init.body });
        const res = (d, st = 200) => ({ ok: st < 400, status: st, json: async () => d });
        if (pth === "/plays/feed/home") return res({ featured: [], novos: o.noPlays ? [] : CATALOG, genres: [], catalog: [], total: o.noPlays ? 0 : CATALOG.length });
        if (pth === "/plans") return res({ plans: PLANS });
        if (pth === "/auth/me") return res({ user: { id: "u1", name: "Ana Souza", role: "user", plan: "plateia" } });
        if (pth === "/auth/login") { await tick(o.loginDelay || 0); return o.loginFail ? res({ error: "E-mail ou senha incorretos." }, 401) : res({ token: "tok", user: { id: "u1", name: "Ana Souza", role: "user", plan: "plateia" } }); }
        if (pth === "/auth/signup") return o.signupFail ? res({ error: "Este e-mail já está cadastrado." }, 409) : res({ token: "tok", user: { id: "u2", name: "Bia Lima", role: "user", plan: "plateia" } });
        if (pth === "/auth/forgot-password") return res({ message: "Se o e-mail existir, enviamos o link." });
        if (pth === "/auth/reset-password") return res({ ok: true });
        if (pth === "/me/home") return res({ continue: [], listIds: [] });
        if (pth === "/plays/facets") return res({ years: [], plans: [] });
        if (pth.startsWith("/plays/trending")) return res({ plays: CATALOG.slice(0, 3), ranked: 0 });
        if (pth.startsWith("/plays?")) return res({ plays: CATALOG, total: CATALOG.length, totalPages: 1, page: 1 });
        return res({});
      };
    }
  });
  const w = dom.window;
  for (let t0 = Date.now(); !w.document.querySelector("#site-header") && Date.now() - t0 < 5000;) await tick(20);
  return { w, calls };
}
const $ = (e, s) => e.w.document.querySelector(s), $$ = (e, s) => [...e.w.document.querySelectorAll(s)];
const go = async (e, hash, ms = 150) => { e.w.location.hash = hash; await tick(ms); };
const submit = (e, form) => form.dispatchEvent(new e.w.Event("submit", { bubbles: true, cancelable: true }));
const fill = (el, v) => { el.value = v; };

(async () => {
  console.log("\nA) Tela de login (novo visual)");
  let e = await makeEnv();
  await go(e, "#/login");
  ok("logo do app num círculo, nome do site como título e subtítulo", () => { assert.equal($(e, ".auth-logo img").getAttribute("src"), "/icons/icon-192.png"); assert.equal($(e, "h1.auth-brand").textContent, "Mini Drama"); assert.match($(e, ".auth-sub").textContent, /continuar assistindo/); });
  ok("campos arredondados com placeholder, rótulo para leitor de tela e dica de preenchimento automático", () => {
    const [em, pw] = $$(e, "#login-form .auth-input");
    assert.equal(em.placeholder, "E-mail"); assert.equal(em.getAttribute("aria-label"), "E-mail"); assert.equal(em.autocomplete, "email");
    assert.equal(pw.type, "password"); assert.equal(pw.getAttribute("autocomplete"), "current-password");
  });
  ok("botão principal 'Entrar', botão secundário 'Criar conta grátis' e link 'Esqueci minha senha'", () => { assert.equal($(e, "#login-form .auth-btn-primary").textContent.trim(), "Entrar"); assert.equal($(e, ".auth-btn-secondary").getAttribute("href"), "#/cadastro"); assert.equal($(e, '.auth-foot a[href="#/esqueci-senha"]').textContent, "Esqueci minha senha"); });
  ok("sem botão de Google nem promessas falsas (o servidor não tem login social)", () => assert.ok(!/google/i.test($(e, ".auth-wrap").innerHTML)));
  ok("sem barra de navegação por cima do login", () => assert.equal($(e, ".fnav"), null));
  ok("prova social VERDADEIRA: conta as novelinhas reais e mostra até 4 capas delas", () => {
    assert.match($(e, ".auth-proof p").textContent, /^6 novelinhas para assistir/);
    const imgs = $$(e, ".auth-covers img"); assert.equal(imgs.length, 4);
    assert.ok(imgs.every(i => /^http:\/\/x\/p\d\.png$/.test(i.getAttribute("src"))));
    assert.equal(new Set(imgs.map(i => i.src)).size, 4);
  });
  ok("o desenho segue o componente: cartão de 24rem com gradiente e vidro, e campos de 16px no celular (sem zoom no iPhone)", () => {
    assert.match(html, /\.auth-card\{[^}]*max-width:24rem[^}]*border-radius:1\.5rem[^}]*linear-gradient\(to right, rgba\(255,255,255,\.063\), #121212\)[^}]*backdrop-filter:blur\(4px\)/);
    assert.match(html, /@media \(max-width:640px\)\{ \.auth-input, \.auth-card \.field input\{font-size:16px;\} \}/);
  });
  fill($(e, "#login-form [name=email]"), "ana@x.com"); fill($(e, "#login-form [name=password]"), "errada");
  e.w.close();

  e = await makeEnv({ loginFail: true });
  await go(e, "#/login");
  fill($(e, "#login-form [name=email]"), "ana@x.com"); fill($(e, "#login-form [name=password]"), "errada");
  submit(e, $(e, "#login-form")); await tick(80);
  ok("senha errada: mostra o erro do servidor e libera o botão de novo", () => { assert.match($(e, "#auth-msg").textContent, /incorretos/); assert.equal($(e, "#auth-msg").getAttribute("role"), "alert"); const b = $(e, "#login-form button"); assert.equal(b.disabled, false); assert.equal(b.textContent, "Entrar"); });
  e.w.close();

  e = await makeEnv({ loginDelay: 150 });
  await go(e, "#/login");
  fill($(e, "#login-form [name=email]"), "ana@x.com"); fill($(e, "#login-form [name=password]"), "certa123");
  const form = $(e, "#login-form"); submit(e, form); submit(e, form); submit(e, form);
  ok("clique duplo/triplo envia UM só pedido de login e o botão mostra 'Entrando...'", () => { assert.equal(e.calls.filter(c => c.path === "/auth/login").length, 1); assert.equal($(e, "#login-form button").textContent, "Entrando..."); assert.equal($(e, "#login-form button").disabled, true); });
  await tick(500);
  ok("login certo guarda a sessão, dá boas-vindas e vai para a home", () => { assert.equal(e.w.location.hash, "#/home"); assert.equal(e.w.localStorage.getItem("minidrama_token"), "tok"); assert.match($(e, "#toast-host").textContent, /Bem-vindo\(a\) de volta, Ana/); });
  e.w.close();

  e = await makeEnv({ noPlays: true });
  await go(e, "#/login");
  ok("sem novelinhas cadastradas, o bloco de prova social não aparece (nada de '0 novelinhas')", () => assert.equal($(e, ".auth-proof"), null));
  e.w.close();

  console.log("\nB) Cadastro e recuperação de senha");
  e = await makeEnv({ signupFail: true });
  await go(e, "#/cadastro");
  ok("cadastro: 3 campos com preenchimento automático correto e botão 'Criar conta'", () => { const f = $$(e, "#signup-form .auth-input"); assert.deepEqual(f.map(i => i.getAttribute("autocomplete")), ["name", "email", "new-password"]); assert.equal($(e, "#signup-form button").textContent.trim(), "Criar conta"); assert.ok($(e, '.auth-foot a[href="#/login"]')); });
  fill($(e, "#signup-form [name=name]"), "Bia Lima"); fill($(e, "#signup-form [name=email]"), "bia@x.com"); fill($(e, "#signup-form [name=password]"), "123456");
  submit(e, $(e, "#signup-form")); await tick(80);
  ok("e-mail já cadastrado: mostra o aviso e libera o botão", () => { assert.match($(e, "#auth-msg").textContent, /já está cadastrado/); assert.equal($(e, "#signup-form button").disabled, false); assert.equal($(e, "#signup-form button").textContent, "Criar conta"); });
  e.w.close();
  e = await makeEnv({});
  await go(e, "#/cadastro");
  fill($(e, "#signup-form [name=name]"), "Bia Lima"); fill($(e, "#signup-form [name=email]"), "bia@x.com"); fill($(e, "#signup-form [name=password]"), "123456");
  submit(e, $(e, "#signup-form")); await tick(300);
  ok("cadastro certo entra na conta e vai para a home", () => { assert.equal(e.w.location.hash, "#/home"); assert.match($(e, "#toast-host").textContent, /Conta criada/); });
  e.w.close();

  e = await makeEnv({});
  await go(e, "#/esqueci-senha");
  ok("'esqueci a senha' usa o mesmo visual (logo, título, botão em pílula) e não tem prova social", () => { assert.ok($(e, ".auth-logo")); assert.ok($(e, "#forgot-form .auth-btn-primary")); assert.equal($(e, ".auth-proof"), null); assert.ok($(e, "#forgot-form label[for=forgot-email]")); });
  fill($(e, "#forgot-form [name=email]"), "ana@x.com"); submit(e, $(e, "#forgot-form")); await tick(80);
  ok("envia o pedido, mostra a confirmação e esconde o formulário", () => { assert.ok(e.calls.some(c => c.path === "/auth/forgot-password")); assert.match($(e, "#auth-msg").textContent, /enviamos o link/); assert.equal($(e, "#forgot-form").style.display, "none"); });
  await go(e, "#/redefinir-senha");
  e.w.close();
  e = await makeEnv({});
  await go(e, "#/redefinir-senha?token=abc");
  fill($(e, "#reset-form [name=password]"), "novasenha1"); fill($(e, "#reset-form [name=confirm]"), "diferente1"); submit(e, $(e, "#reset-form")); await tick(60);
  ok("nova senha: avisa quando as duas não são iguais (sem chamar o servidor)", () => { assert.match($(e, "#auth-msg").textContent, /não são iguais/); assert.ok(!e.calls.some(c => c.path === "/auth/reset-password")); });
  fill($(e, "#reset-form [name=confirm]"), "novasenha1"); submit(e, $(e, "#reset-form")); await tick(80);
  ok("senhas iguais: chama o servidor com o token do link", () => { const c = e.calls.find(c => c.path === "/auth/reset-password"); assert.ok(c); assert.equal(JSON.parse(c.body).token, "abc"); });
  e.w.close();
  e = await makeEnv({});
  await go(e, "#/redefinir-senha");
  ok("link de redefinição sem token oferece pedir um novo", () => assert.equal($(e, "a.auth-btn-primary").getAttribute("href"), "#/esqueci-senha"));
  e.w.close();

  console.log("\nC) Balão de instalar o app");
  const banner = (env) => env.w.document.getElementById("install-banner");
  const ready = (env) => env.w.eval("installReady = true; refreshInstallBanner();");
  const nativePrompt = (env, outcome = "accepted") => { const ev = new env.w.Event("beforeinstallprompt", { cancelable: true }); ev.prompt = () => { env.prompted = (env.prompted || 0) + 1; }; ev.userChoice = Promise.resolve({ outcome }); env.w.dispatchEvent(ev); return ev; };

  e = await makeEnv({ ua: UA.android });
  nativePrompt(e); await tick(20);
  ok("Android: o aviso nativo chegando ANTES do tempo de espera não mostra nada ainda", () => assert.equal(banner(e), null));
  ready(e);
  ok("passado o tempo, mostra o balão com o botão 'Instalar app'", () => { assert.ok(banner(e)); assert.equal(banner(e).dataset.mode, "button"); assert.match(banner(e).textContent, /Instalar app/); });
  banner(e).querySelector("button.btn").click(); await tick(60);
  ok("tocar em 'Instalar app' abre o diálogo do navegador e o balão some", () => { assert.equal(e.prompted, 1); assert.equal(banner(e), null); });
  e.w.close();

  e = await makeEnv({ ua: UA.android });
  ready(e);
  ok("Android SEM aviso nativo (Firefox, Samsung…): mostra o balão com o passo a passo do menu ⋮", () => { assert.equal(banner(e).dataset.mode, "manual"); assert.match(banner(e).textContent, /menu/); assert.match(banner(e).textContent, /Instalar app/); assert.equal(banner(e).querySelector("button.btn"), null); });
  nativePrompt(e); await tick(20);
  ok("se o navegador liberar a instalação DEPOIS (caso do bug), o balão vira o botão em vez de ficar sem aparecer", () => { assert.equal($$(e, "#install-banner").length, 1); assert.equal(banner(e).dataset.mode, "button"); });
  banner(e).querySelector(".ib-close").click();
  ok("fechar o balão o esconde e guarda a data (volta só depois de 3 dias)", () => { assert.equal(banner(e), null); assert.ok(Number(e.w.localStorage.getItem("md_install_dismissed")) > 0); e.w.eval("refreshInstallBanner()"); assert.equal(banner(e), null); });
  e.w.localStorage.setItem("md_install_dismissed", String(Date.now() - 4 * 86400000)); e.w.eval("refreshInstallBanner()");
  ok("passados 4 dias, o convite pode voltar", () => assert.ok(banner(e)));
  e.w.close();

  e = await makeEnv({ ua: UA.iphone }); ready(e);
  ok("iPhone (Safari): ensina Compartilhar → Adicionar à Tela de Início", () => { assert.equal(banner(e).dataset.mode, "ios"); assert.match(banner(e).textContent, /Compartilhar/); assert.match(banner(e).textContent, /Adicionar à Tela de Início/); });
  e.w.close();
  e = await makeEnv({ ua: UA.iphoneChrome }); ready(e);
  ok("iPhone com Chrome também recebe o convite (antes só o Safari recebia)", () => assert.equal(banner(e) && banner(e).dataset.mode, "ios"));
  e.w.close();
  e = await makeEnv({ ua: UA.android, standalone: true }); nativePrompt(e); ready(e);
  ok("app já aberto como instalado: nunca mostra o balão", () => assert.equal(banner(e), null));
  e.w.close();
  e = await makeEnv({ ua: UA.instagram }); ready(e);
  ok("navegador embutido do Instagram: não mostra (não dá para instalar de lá)", () => assert.equal(banner(e), null));
  e.w.close();
  e = await makeEnv({ ua: UA.desktop }); ready(e);
  ok("computador sem aviso nativo: não incomoda; com aviso nativo (Chrome/Edge) oferece o botão", () => { assert.equal(banner(e), null); nativePrompt(e); assert.equal(banner(e).dataset.mode, "button"); });
  e.w.close();

  e = await makeEnv({ ua: UA.android });
  e.w.eval('DB.me = null');
  await go(e, "#/home", 100); ready(e); banner(e) && banner(e).remove();
  e.w.eval('reel = { __fake: true }'); e.w.eval("refreshInstallBanner()");
  ok("nunca aparece por cima do StoryReel", () => assert.equal(banner(e), null));
  e.w.eval("reel = null"); await go(e, "#/catalogo", 200);
  ok("ao sair do reel e abrir uma tela normal, o convite pendente aparece", () => assert.ok(banner(e)));
  e.w.close();

  e = await makeEnv({ ua: UA.android });
  e.w.eval('promptInstall()'); await tick(30);
  ok("o link 'Instalar o app' do rodapé ensina o caminho no Android mesmo sem aviso nativo", () => assert.equal(banner(e) && banner(e).dataset.mode, "manual"));
  e.w.close();
  e = await makeEnv({ ua: UA.iphone });
  e.w.eval('promptInstall()'); await tick(30);
  ok("e no iPhone mostra o passo a passo do Compartilhar", () => assert.equal(banner(e) && banner(e).dataset.mode, "ios"));
  e.w.close();

  console.log(`\n${passed} verificações passaram${process.exitCode ? " — COM FALHAS" : ""}`);
  process.exit(process.exitCode || 0);
})().catch(err => { console.error("ERRO NO HARNESS:", err); process.exit(2); });
