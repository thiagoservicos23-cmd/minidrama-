const express = require("express");
const prisma = require("../prismaClient");
const { attachUserIfPresent, requireAuth, requireAdmin } = require("../middleware/auth");
const { userCanWatch } = require("../utils/planRules");
const { PLAY_LIST_SELECT, imageFieldUpdate, publicPlay } = require("../utils/images");

const router = express.Router();

// Remove o link do vídeo e acrescenta as flags de acesso.
async function withAccess(user, p) {
  const { videoUrl, ...rest } = publicPlay(p);
  const canWatch = await userCanWatch(user, p);
  return { ...rest, hasVideo: !!videoUrl, canWatch };
}

// Lista pública do catálogo. Nunca inclui o link do vídeo nem imagens pesadas.
// Aceita paginação (?page=&pageSize=) e filtros (?genre=&search=). Sem "page"
// devolve até 120 peças (usado pela Home para montar as seções).
router.get("/", attachUserIfPresent, async (req, res) => {
  try {
    const { page, pageSize, genre, search } = req.query;
    const where = {};
    if (genre && genre !== "Todos") where.genre = String(genre);
    if (search) where.title = { contains: String(search) };

    const usePagination = !!page;
    const take = usePagination ? Math.min(parseInt(pageSize, 10) || 24, 100) : 120;
    const skip = usePagination ? Math.max(parseInt(page, 10) - 1, 0) * take : 0;

    const [plays, total] = await Promise.all([
      prisma.play.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: PLAY_LIST_SELECT }),
      prisma.play.count({ where })
    ]);

    const list = await Promise.all(plays.map((p) => withAccess(req.user, p)));
    res.json({
      plays: list,
      total,
      page: usePagination ? parseInt(page, 10) : 1,
      pageSize: take,
      totalPages: Math.max(Math.ceil(total / take), 1)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível carregar o catálogo." });
  }
});

// Imagem da peça (poster ou backdrop) enviada por arquivo. Cache longo no navegador:
// o "?v=" muda sempre que a peça é editada, então nunca fica desatualizada.
router.get("/:id/image/:kind", async (req, res) => {
  const kind = req.params.kind === "backdrop" ? "backdrop" : "poster";
  const field = kind === "poster" ? "posterData" : "backdropData";
  const p = await prisma.play.findUnique({ where: { id: req.params.id }, select: { posterData: true, backdropData: true } });
  const data = (p && p[field]) || (kind === "backdrop" && p && p.posterData) || null;
  const m = data && /^data:(image\/[a-z]+);base64,([\s\S]+)$/.exec(data);
  if (!m) return res.status(404).end();
  res.set("Content-Type", m[1]);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(Buffer.from(m[2], "base64"));
});

// Admin: quantas peças existem em cada plano (para o aviso antes de mover em massa).
router.get("/admin/plan-counts", requireAuth, requireAdmin, async (req, res) => {
  const rows = await prisma.play.groupBy({ by: ["requiresPlan"], _count: { _all: true } });
  const counts = {};
  rows.forEach((r) => { counts[r.requiresPlan] = r._count._all; });
  res.json({ counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
});

// Admin: move TODAS as peças de um plano para outro (ex.: de Plateia para Balcão).
router.post("/bulk-plan", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: "Escolha o plano de origem e o de destino." });
    if (from === to) return res.status(400).json({ error: "Escolha dois planos diferentes." });
    const [a, b] = await Promise.all([
      prisma.plan.findUnique({ where: { id: String(from) } }),
      prisma.plan.findUnique({ where: { id: String(to) } })
    ]);
    if (!a || !b) return res.status(400).json({ error: "Plano inválido." });
    const r = await prisma.play.updateMany({ where: { requiresPlan: a.id }, data: { requiresPlan: b.id } });
    res.json({ ok: true, moved: r.count, from: a.name, to: b.name });
  } catch (e) {
    console.error("[bulk-plan]", e.message);
    res.status(500).json({ error: "Não foi possível mover as peças." });
  }
});

// Detalhe de uma peça. Só devolve a URL real do vídeo se o visitante tiver direito.
router.get("/:id", attachUserIfPresent, async (req, res) => {
  const play = await prisma.play.findUnique({ where: { id: req.params.id }, select: PLAY_LIST_SELECT });
  if (!play) return res.status(404).json({ error: "Peça não encontrada." });
  const canWatch = await userCanWatch(req.user, play);
  const payload = publicPlay(play);
  if (!canWatch) payload.videoUrl = "";
  res.json({ play: payload, canWatch });
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const duration = parseInt(b.durationMinutes, 10);
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: "Informe o título da peça." });
    if (!duration || duration < 60) return res.status(400).json({ error: "A peça precisa ter no mínimo 60 minutos de duração." });

    const poster = imageFieldUpdate("poster", b.posterUrl || "");
    // Banner vazio fica vazio: na hora de EXIBIR, o site usa a capa como reserva (ver publicPlay).
    const backdrop = imageFieldUpdate("backdrop", b.backdropUrl || "");
    if (poster.error || backdrop.error) return res.status(400).json({ error: poster.error || backdrop.error });

    const play = await prisma.play.create({
      data: {
        title: b.title.trim(),
        genre: b.genre || "Drama",
        durationMinutes: duration,
        releaseYear: parseInt(b.releaseYear, 10) || new Date().getFullYear(),
        synopsis: b.synopsis || "",
        director: b.director || "",
        cast: b.cast || "",
        videoUrl: b.videoUrl || "",
        requiresPlan: b.requiresPlan || "plateia",
        featured: !!b.featured,
        ...poster,
        ...backdrop
      },
      select: PLAY_LIST_SELECT
    });
    res.status(201).json({ play: publicPlay(play) });
    if (play.featured) triggerFeaturedAnnouncements();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível salvar a peça." });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const duration = parseInt(b.durationMinutes, 10);
    if (duration && duration < 60) return res.status(400).json({ error: "A peça precisa ter no mínimo 60 minutos de duração." });

    const poster = imageFieldUpdate("poster", b.posterUrl);
    const backdrop = imageFieldUpdate("backdrop", b.backdropUrl);
    if (poster.error || backdrop.error) return res.status(400).json({ error: poster.error || backdrop.error });

    const play = await prisma.play.update({
      where: { id: req.params.id },
      data: {
        title: b.title?.trim(),
        genre: b.genre,
        durationMinutes: duration || undefined,
        releaseYear: b.releaseYear ? parseInt(b.releaseYear, 10) : undefined,
        synopsis: b.synopsis,
        director: b.director,
        cast: b.cast,
        videoUrl: b.videoUrl,
        requiresPlan: b.requiresPlan,
        featured: typeof b.featured === "boolean" ? b.featured : undefined,
        ...poster,
        ...backdrop
      },
      select: PLAY_LIST_SELECT
    });
    res.json({ play: publicPlay(play) });
    if (play.featured) triggerFeaturedAnnouncements();
  } catch (e) {
    console.error(e);
    res.status(404).json({ error: "Peça não encontrada." });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.play.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: "Peça não encontrada." });
  }
});

// Quando uma obra entra no banner da home, avisa os usuários por e-mail (em segundo plano).
function triggerFeaturedAnnouncements() {
  try {
    const { sendFeaturedAnnouncements } = require("../services/emailJobs");
    setImmediate(() => sendFeaturedAnnouncements().catch((e) => console.error("[email] destaque:", e.message)));
  } catch (e) { /* e-mail ainda não configurado: ignora */ }
}

module.exports = router;
