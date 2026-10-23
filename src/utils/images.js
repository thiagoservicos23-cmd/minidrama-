const prisma = require("../prismaClient");
const { ORDER, labelOf } = require("./genres");

// Campos da novelinha que podem ir em listagens (SEM as imagens pesadas em base64
// e SEM o link do vídeo, que só a página de detalhe entrega a quem tem direito).
const PLAY_LIST_SELECT = {
  id: true, title: true, durationMinutes: true, releaseYear: true,
  synopsis: true, director: true, cast: true, posterUrl: true, backdropUrl: true,
  videoUrl: true, requiresPlan: true, featured: true, createdAt: true, updatedAt: true,
  hasPosterData: true, hasBackdropData: true, announcedAt: true,
  genres: { select: { genre: true } }
};

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB por imagem
const DATA_URI_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/;

function isDataUri(v) { return typeof v === "string" && v.startsWith("data:"); }
function isOwnImagePath(v) { return typeof v === "string" && v.startsWith("/api/plays/") && v.includes("/image/"); }

// Valida um data URI de imagem. Devolve { ok, error }.
function validateImageDataUri(v) {
  const m = DATA_URI_RE.exec(v || "");
  if (!m) return { ok: false, error: "Imagem inválida. Use um arquivo PNG, JPEG ou WebP." };
  const approxBytes = Math.floor((m[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) return { ok: false, error: "Imagem muito grande (máximo 4 MB). Reduza o tamanho e tente de novo." };
  return { ok: true };
}

// Decide o que gravar para um campo de imagem (poster/backdrop) vindo do formulário.
// Retorna um objeto parcial do Prisma, ou { error }.
function imageFieldUpdate(kind, incoming) {
  const url = kind === "poster" ? "posterUrl" : "backdropUrl";
  const data = kind === "poster" ? "posterData" : "backdropData";
  const has = kind === "poster" ? "hasPosterData" : "hasBackdropData";

  if (incoming === undefined) return {};                 // campo não enviado: não mexe
  if (isOwnImagePath(incoming)) return {};               // o formulário devolveu o link da própria imagem: mantém
  if (isDataUri(incoming)) {
    const v = validateImageDataUri(incoming);
    if (!v.ok) return { error: v.error };
    return { [url]: "", [data]: incoming, [has]: true };
  }
  const clean = String(incoming || "").trim();
  if (clean && !/^https?:\/\/[^\s'"<>\\]+$/i.test(clean)) return { error: "Link de imagem inválido: precisa começar com http:// ou https:// e não pode ter espaços nem aspas." };
  return { [url]: clean, [data]: null, [has]: false };
}

// Transforma uma novelinha do banco no formato público da API.
function publicPlay(p) {
  const v = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
  const { posterData, backdropData, genres: rawGenres, genre: legacyGenre, ...rest } = p;
  // "genres": ids na ordem oficial; "genreLabels": nomes para exibir; "genre": o 1º nome (compatibilidade).
  const ids = (rawGenres || []).map((g) => (typeof g === "string" ? g : g.genre)).filter((id) => id in ORDER).sort((a, b) => ORDER[a] - ORDER[b]);
  return {
    ...rest,
    genres: ids,
    genreLabels: ids.map((id) => labelOf(id)),
    genre: ids.length ? labelOf(ids[0]) : "",
    posterUrl: p.hasPosterData ? `/api/plays/${p.id}/image/poster?v=${v}` : p.posterUrl,
    backdropUrl: p.hasBackdropData ? `/api/plays/${p.id}/image/backdrop?v=${v}` : (p.backdropUrl || (p.hasPosterData ? `/api/plays/${p.id}/image/poster?v=${v}` : p.posterUrl))
  };
}

// Migração única e segura: imagens antigas que ficaram dentro de posterUrl/backdropUrl
// como "data:..." são movidas para as colunas novas. Pode rodar várias vezes.
async function migrateInlineImages() {
  try {
    const rows = await prisma.play.findMany({
      where: { OR: [{ posterUrl: { startsWith: "data:" } }, { backdropUrl: { startsWith: "data:" } }] },
      select: { id: true, posterUrl: true, backdropUrl: true }
    });
    for (const r of rows) {
      const data = {};
      if (isDataUri(r.posterUrl)) Object.assign(data, { posterData: r.posterUrl, posterUrl: "", hasPosterData: true });
      if (isDataUri(r.backdropUrl)) Object.assign(data, { backdropData: r.backdropUrl, backdropUrl: "", hasBackdropData: true });
      await prisma.play.update({ where: { id: r.id }, data });
    }
    if (rows.length) console.log(`[imagens] ${rows.length} novelinha(s) migrada(s) para o novo armazenamento de imagens.`);
  } catch (e) {
    console.error("[imagens] migração não concluída:", e.message);
  }
}

module.exports = { PLAY_LIST_SELECT, imageFieldUpdate, publicPlay, migrateInlineImages, validateImageDataUri };
