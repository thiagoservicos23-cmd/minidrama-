// Surpresa: o sorteio (extraído do próprio index.html).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const a = html.indexOf("function pickRandom("), b = html.indexOf("function shuffled(");
assert.ok(a > 0 && b > a, "pickRandom não encontrada");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + "\nthis.pickRandom = pickRandom;", ctx);
const { pickRandom } = ctx;
const P = (id) => ({ id });

test("lista vazia não sorteia nada", () => assert.equal(pickRandom([], null), null));

test("com uma só peça, devolve ela mesma (mesmo que seja a anterior)", () => {
  assert.equal(pickRandom([P("a")], "a").id, "a");
});

test("nunca repete a peça anterior quando há outras", () => {
  const pool = [P("a"), P("b"), P("c")];
  for (let i = 0; i < 300; i++) assert.notEqual(pickRandom(pool, "b").id, "b");
});

test("alcança todas as outras peças (a escolha é uniforme, não viciada)", () => {
  const pool = [P("a"), P("b"), P("c"), P("d")];
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(pickRandom(pool, "a").id);
  assert.deepEqual([...seen].sort(), ["b", "c", "d"]);
});

test("usa o gerador injetado, inclusive nos extremos (0 e quase 1), sem sair da lista", () => {
  const pool = [P("a"), P("b"), P("c")];
  assert.equal(pickRandom(pool, null, () => 0).id, "a");
  assert.equal(pickRandom(pool, null, () => 0.9999999).id, "c");
  assert.equal(pickRandom(pool, null, () => 1).id, "c");        // um gerador mal-comportado não estoura o índice
});

test("não trava em laço se todas as peças tiverem o mesmo id da anterior", () => {
  assert.equal(pickRandom([P("a"), P("a")], "a").id, "a");
});
