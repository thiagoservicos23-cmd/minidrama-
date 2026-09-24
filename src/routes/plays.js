const express = require("express");
const prisma = require("../prismaClient");
const { attachUserIfPresent, requireAuth, requireAdmin } = require("../middleware/auth");
const { userCanWatch, getPlanLevel } = require("../utils/planRules");

const router = express.Router();

// Lista pública do catálogo. Nunca inclui o link do vídeo aqui — só a
// página de detalhe entrega o vídeo, e só para quem tem direito.
router.get("/", attachUserIfPresent, async (req, res) => {
  const plays = await prisma.play.findMany({ orderBy: { createdAt: "desc" } });
  const withAccess = await Promise.all(plays.map(async (p) => {
    const { videoUrl, ...rest } = p;
    const canWatch = await userCanWatch(req.user, p);
    return { ...rest, hasVideo: !!videoUrl, canWatch };
  }));
  res.json({ plays: withAccess });
});

// Detalhe de uma peça. Só devolve a URL real do vídeo se o visitante tiver direito.
router.get("/:id", attachUserIfPresent, async (req, res) => {
  const play = await prisma.play.findUnique({ where: { id: req.params.id } });
  if (!play) return res.status(404).json({ error: "Peça não encontrada." });
  const canWatch = await userCanWatch(req.user, play);
  const payload = { ...play };
  if (!canWatch) payload.videoUrl = "";
  res.json({ play: payload, canWatch });
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const duration = parseInt(b.durationMinutes, 10);
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: "Informe o título da peça." });
    if (!duration || duration < 60) return res.status(400).json({ error: "A peça precisa ter no mínimo 60 minutos de duração." });

    const play = await prisma.play.create({
      data: {
        title: b.title.trim(),
        genre: b.genre || "Drama",
        durationMinutes: duration,
        releaseYear: parseInt(b.releaseYear, 10) || new Date().getFullYear(),
        synopsis: b.synopsis || "",
        director: b.director || "",
        cast: b.cast || "",
        posterUrl: b.posterUrl || "",
        backdropUrl: b.backdropUrl || b.posterUrl || "",
        videoUrl: b.videoUrl || "",
        requiresPlan: b.requiresPlan || "plateia",
        featured: !!b.featured
      }
    });
    res.status(201).json({ play });
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
        posterUrl: b.posterUrl,
        backdropUrl: b.backdropUrl,
        videoUrl: b.videoUrl,
        requiresPlan: b.requiresPlan,
        featured: typeof b.featured === "boolean" ? b.featured : undefined
      }
    });
    res.json({ play });
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

module.exports = router;
