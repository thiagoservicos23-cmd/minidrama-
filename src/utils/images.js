const prisma = require("../prismaClient");

// Campos da peça que podem ir em listagens (SEM as imagens pesadas em base64
// e SEM o link do vídeo, que só a página de detalhe entrega a quem tem direito).
const PLAY_LIST_SELECT = {
  id: true, title: true, genre: true, durationMinutes: true, releaseYear: true,
  synopsis: true, director: true, cast: true, posterUrl: true, backdropUrl: true,
  videoUrl: true, requiresPlan: true, featured: true, createdAt: true, updatedAt: true,
  hasPosterData: true, hasBackdropData: true, announcedAt: true
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
  if (clean && !/^https?:\/\//i.test(clean)) return { error: "O link da imagem precisa começar com http:// ou https://" };
  return { [url]: clean, [data]: null, [has]: false };
}

// Transforma uma peça do banco no formato público da API.
function publicPlay(p) {
  const v = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
  const { posterData, backdropData, ...rest } = p;
  return {
    ...rest,
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
    if (rows.length) console.log(`[imagens] ${rows.length} peça(s) migrada(s) para o novo armazenamento de imagens.`);
  } catch (e) {
    console.error("[imagens] migração não concluída:", e.message);
  }
}

module.exports = { PLAY_LIST_SELECT, imageFieldUpdate, publicPlay, migrateInlineImages, validateImageDataUri };
