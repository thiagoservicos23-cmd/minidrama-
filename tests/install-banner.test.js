// Balão de instalar o app: qual convite mostrar em cada situação (função pura extraída do index.html).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const a = html.indexOf("function installBannerMode("), b = html.indexOf("function currentInstallMode(");
assert.ok(a > 0 && b > a, "installBannerMode não encontrada");
const ctx = { INSTALL_SNOOZE_MS: 3 * 86400000 };
vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + "\nthis.mode = installBannerMode;", ctx);
const mode = ctx.mode;
const base = { standalone: false, inApp: false, dismissedAt: 0, now: 1_000_000_000_000, hasPrompt: false, ios: false, mobile: false };

test("Android/Chrome com o aviso nativo: botão 'Instalar app'", () => assert.equal(mode({ ...base, mobile: true, hasPrompt: true }), "button"));
test("o aviso nativo que chega DEPOIS também vira botão (antes o convite nunca era reavaliado)", () => {
  assert.equal(mode({ ...base, mobile: true }), "manual");                       // 1º: ainda sem aviso nativo
  assert.equal(mode({ ...base, mobile: true, hasPrompt: true }), "button");      // 2º: o navegador liberou
});
test("iPhone/iPad (Safari ou Chrome): ensina o caminho pelo Compartilhar", () => assert.equal(mode({ ...base, mobile: true, ios: true }), "ios"));
test("celular Android sem aviso nativo (Firefox, Samsung…): ensina o menu do navegador", () => assert.equal(mode({ ...base, mobile: true }), "manual"));
test("computador sem aviso nativo: não incomoda", () => assert.equal(mode({ ...base }), null));
test("computador com aviso nativo (Chrome/Edge): oferece o botão", () => assert.equal(mode({ ...base, hasPrompt: true }), "button"));
test("app já instalado (aberto como app): nunca mostra", () => assert.equal(mode({ ...base, mobile: true, hasPrompt: true, standalone: true }), null));
test("navegador embutido (Instagram, Facebook…): não dá para instalar, não mostra", () => assert.equal(mode({ ...base, mobile: true, ios: true, inApp: true }), null));

test("depois de fechar, some por 3 dias e volta depois", () => {
  const st = { ...base, mobile: true, hasPrompt: true, dismissedAt: base.now - 86400000 };
  assert.equal(mode(st), null);                                                  // 1 dia depois
  assert.equal(mode({ ...st, dismissedAt: base.now - 2.9 * 86400000 }), null);   // quase 3 dias
  assert.equal(mode({ ...st, dismissedAt: base.now - 3.1 * 86400000 }), "button"); // passou
});

test("a página tem o manifesto liberando a rotação e o convite é reavaliado quando o navegador avisa", () => {
  assert.match(html, /addEventListener\("beforeinstallprompt"[^\n]*refreshInstallBanner\(\)/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/manifest.webmanifest"), "utf8"));
  assert.equal(manifest.orientation, "any");                                     // "portrait" impedia a tela cheia deitada no app instalado
  assert.equal(manifest.display, "standalone");
});
