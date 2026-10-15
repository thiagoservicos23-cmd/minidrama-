// Lista OFICIAL de gêneros do catálogo (fonte única: o site e o painel leem daqui).
// Cada série pode ter vários gêneros e aparece em todas as seções correspondentes.
// "Novos Na Plataforma" NÃO é um gênero gravado: é uma seção automática com as séries mais recentes.
const GENRES = [
  { id: "dublados", label: "Dublados", aliases: ["dublados", "dublado", "dublagem", "dub"] },
  { id: "brasileiras", label: "🇧🇷 Brasileiras", aliases: ["brasileiras", "brasileira", "brasileiros", "brasileiro", "brasil", "br", "nacional", "nacionais"] },
  { id: "ia", label: "🤖 IA", aliases: ["ia", "ai", "inteligencia artificial"] },
  { id: "animes", label: "Animes", aliases: ["animes", "anime"] },
  { id: "bl-gl", label: "BL & GL", aliases: ["bl gl", "bl", "gl", "boys love", "girls love"] },
  { id: "identidade-escondida", label: "Identidade Escondida", aliases: ["identidade escondida", "identidade secreta", "identidade oculta"] },
  { id: "amor-a-primeira-vista", label: "Amor à Primeira Vista", aliases: ["amor a primeira vista"] },
  { id: "bebes-e-gravidezes", label: "Bebês e Gravidezes", aliases: ["bebes gravidezes", "bebes gravidez", "bebe gravidez", "bebes", "bebe", "gravidez", "gravidezes"] },
  { id: "relacionamento-tabu", label: "Relacionamento Tabu", aliases: ["relacionamento tabu", "relacionamentos tabu", "tabu"] },
  { id: "homem-lobo-e-vampiro", label: "Homem-lobo🐺 e Vampiro🧛", aliases: ["homem lobo vampiro", "lobisomem vampiro", "homem lobo", "lobisomem", "vampiro", "vampiros", "werewolf vampire"] }
];

const GENRE_IDS = new Set(GENRES.map((g) => g.id));
const ORDER = Object.fromEntries(GENRES.map((g, i) => [g.id, i]));
const LABEL = Object.fromEntries(GENRES.map((g) => [g.id, g.label]));

// Comparação "solta": ignora maiúsculas, acentos, emojis, pontuação, "&" e a palavrinha "e".
function norm(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " e ").replace(/[^a-z0-9]+/g, " ").trim();
}
function key(s) { return norm(s).split(" ").filter((w) => w && w !== "e").join(" "); }

const ALIAS = new Map();
GENRES.forEach((g) => { ALIAS.set(key(g.id), g.id); ALIAS.set(key(g.label), g.id); g.aliases.forEach((a) => ALIAS.set(key(a), g.id)); });
// ---- Nomes personalizados (o admin pode renomear; o id do gênero nunca muda) ----
let custom = new Map();      // id -> nome personalizado
let dynAlias = new Map();    // chave do nome personalizado -> id
let loadedAt = 0;

// Lê os nomes personalizados do banco (com cache curto de 30 s, para não pesar nas requisições).
async function loadLabels(force = false) {
  if (!force && Date.now() - loadedAt < 30000) return;
  try {
    const prisma = require("../prismaClient");
    if (!prisma.genreLabel) { loadedAt = Date.now(); return; }
    const rows = await prisma.genreLabel.findMany();
    const c = new Map(), d = new Map();
    for (const r of rows) if (GENRE_IDS.has(r.id) && r.label) { c.set(r.id, r.label); d.set(key(r.label), r.id); }
    custom = c; dynAlias = d; loadedAt = Date.now();
  } catch (e) {
    loadedAt = Date.now() - 20000;       // falhou: tenta de novo em ~10 s, mantendo o que já tinha
  }
}
function labelOf(id) { return custom.get(id) || LABEL[id] || id; }
function currentGenres() { return GENRES.map((g) => ({ id: g.id, label: labelOf(g.id) })); }
function _resetLabelsForTests() { custom = new Map(); dynAlias = new Map(); loadedAt = 0; }

const IGNORED = new Set(["novos na plataforma", "novos", "novo", "todos"]);   // seções automáticas, não são gêneros

// Resolve um nome digitado (ex.: "🇧🇷 brasileiras", "BL e GL") para o id do gênero.
// Retorna { id } | { ignored: true } | { empty: true } | null (não reconhecido).
function resolveGenre(raw) {
  const k = key(raw);
  if (!k) return { empty: true };
  if (IGNORED.has(k)) return { ignored: true };
  const id = ALIAS.get(k) || dynAlias.get(k);       // nomes originais OU o nome personalizado atual
  return id ? { id } : null;
}

// Mesma regra usada para comparar nomes de séries (título do site x nome da planilha).
function normTitle(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_\-.]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim(); }

// Valida e organiza uma lista de ids vinda do formulário.
function cleanGenreIds(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String))].filter((id) => GENRE_IDS.has(id)).sort((a, b) => ORDER[a] - ORDER[b]);
}

module.exports = { GENRES, GENRE_IDS, LABEL, ORDER, resolveGenre, normTitle, cleanGenreIds, loadLabels, labelOf, currentGenres, _resetLabelsForTests };
