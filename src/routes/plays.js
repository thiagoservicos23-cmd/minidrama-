const express = require("express");
const prisma = require("../prismaClient");
const { attachUserIfPresent, requireAuth, requireAdmin } = require("../middleware/auth");
const { userCanWatch } = require("../utils/planRules");
const { withAccess } = require("../utils/playAccess");
const { PLAY_LIST_SELECT, imageFieldUpdate, publicPlay } = require("../utils/images");
const { GENRES, GENRE_IDS, resolveGenre, normTitle, cleanGenreIds, loadLabels, labelOf, currentGenres } = require("../utils/genres");

const router = express.Router();

// Rotas assíncronas do Express 4 não capturam erros sozinhas: sem isto, uma falha do banco deixaria
// o visitante esperando para sempre. Aqui qualquer erro vira uma resposta 500 clara.
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error("[plays]", req.method, req.path, e && e.message);
  if (!res.headersSent) res.status(500).json({ error: "Não foi possível concluir agora. Tente novamente em instantes." });
});

// Garante que os nomes personalizados dos gêneros estejam carregados (cache de 30 s).
router.use(async (req, res, next) => { await loadLabels(); next(); });

// Remove o link do vídeo e acrescenta as flags de acesso.

// Lista pública do catálogo. Nunca inclui o link do vídeo nem imagens pesadas.
// Aceita paginação (?page=&pageSize=) e filtros (?genre=&search=). Sem "page"
// devolve até 120 peças (usado pela Home para montar as seções).
router.get("/", attachUserIfPresent, async (req, res) => {
  try {
    const { page, pageSize, genre, search } = req.query;
    const where = {};
    if (genre && !["Todos", "novos"].includes(String(genre))) where.genres = { some: { genre: String(genre) } };
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

// Dados da página inicial: séries em destaque (banner), "Novos Na Plataforma" (as mais recentes, em ordem de chegada)
// e uma seção por gênero. Uma série com vários gêneros aparece em todas as seções dela.
router.get("/feed/home", attachUserIfPresent, async (req, res) => {
  try {
    const [featured, novos, counts] = await Promise.all([
      prisma.play.findMany({ where: { featured: true }, orderBy: { createdAt: "desc" }, take: 10, select: PLAY_LIST_SELECT }),
      prisma.play.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: PLAY_LIST_SELECT }),
      prisma.playGenre.groupBy({ by: ["genre"], _count: { _all: true } })
    ]);
    const total = await prisma.play.count();
    const countOf = Object.fromEntries(counts.map((c) => [c.genre, c._count._all]));
    const rows = await Promise.all(GENRES.filter((g) => countOf[g.id] > 0).map(async (g) => ({
      id: g.id,
      label: labelOf(g.id),
      total: countOf[g.id],
      plays: await Promise.all((await prisma.play.findMany({ where: { genres: { some: { genre: g.id } } }, orderBy: { createdAt: "desc" }, take: 20, select: PLAY_LIST_SELECT })).map((p) => withAccess(req.user, p)))
    })));
    res.json({
      featured: await Promise.all(featured.map((p) => withAccess(req.user, p))),
      novos: await Promise.all(novos.map((p) => withAccess(req.user, p))),
      genres: rows,
      catalog: currentGenres(),
      total
    });
  } catch (e) {
    console.error("[home]", e);
    res.status(500).json({ error: "Não foi possível carregar a página inicial." });
  }
});

// Admin: lista os gêneros com o nome que aparece no site, o nome original e quantas séries há em cada um.
router.get("/admin/genres", requireAuth, requireAdmin, safe(async (req, res) => {
  await loadLabels(true);
  const counts = await prisma.playGenre.groupBy({ by: ["genre"], _count: { _all: true } });
  const total = Object.fromEntries(counts.map((c) => [c.genre, c._count._all]));
  res.json({ genres: GENRES.map((g) => ({ id: g.id, label: labelOf(g.id), defaultLabel: g.label, renamed: labelOf(g.id) !== g.label, total: total[g.id] || 0 })) });
}));

// Admin: renomeia um gênero. Só o NOME muda: as séries seguem ligadas ao gênero pelo id.
router.put("/admin/genres/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!GENRE_IDS.has(id)) return res.status(404).json({ error: "Gênero não encontrado." });
    const b = req.body || {};
    await loadLabels(true);

    if (b.reset) {                                           // volta ao nome original
      await prisma.genreLabel.deleteMany({ where: { id } });
      await loadLabels(true);
      return res.json({ ok: true, label: labelOf(id) });
    }
    const label = String(b.label || "").trim().replace(/\s+/g, " ");
    if (!label) return res.status(400).json({ error: "Digite o novo nome do gênero." });
    if (label.length > 40) return res.status(400).json({ error: "O nome pode ter no máximo 40 caracteres." });
    if (/[<>]/.test(label)) return res.status(400).json({ error: "O nome não pode ter os símbolos < ou >." });
    const clash = resolveGenre(label);
    if (clash && clash.ignored) return res.status(400).json({ error: "Esse nome é reservado pelo site (seção automática)." });
    if (clash && clash.id && clash.id !== id) return res.status(400).json({ error: `Esse nome já é usado por outro gênero (“${labelOf(clash.id)}”).` });

    const original = GENRES.find((g) => g.id === id).label;
    if (label === original) await prisma.genreLabel.deleteMany({ where: { id } });
    else await prisma.genreLabel.upsert({ where: { id }, update: { label }, create: { id, label } });
    await loadLabels(true);
    res.json({ ok: true, label: labelOf(id) });
  } catch (e) {
    console.error("[renomear gênero]", e.message);
    res.status(500).json({ error: "Não foi possível renomear o gênero." });
  }
});

// Admin: atualiza os gêneros das séries que JÁ estão no site, a partir de uma planilha (nome + gênero).
// Primeiro "dryRun" (só mostra o que aconteceria), depois aplica. Uma série pode ter vários gêneros.
router.post("/genres-import", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows, mode, dryRun } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: "A planilha está vazia." });
    if (rows.length > 50000) return res.status(400).json({ error: "Planilha grande demais (máximo 50.000 linhas)." });
    const replace = mode !== "add";

    const plays = await prisma.play.findMany({ select: { id: true, title: true } });
    const byTitle = new Map();
    for (const p of plays) { const k = normTitle(p.title); if (!k) continue; if (!byTitle.has(k)) byTitle.set(k, []); byTitle.get(k).push(p.id); }

    const wanted = new Map();            // nome normalizado -> { name, genres:Set }
    const unknown = new Map();           // texto de gênero não reconhecido -> quantas linhas
    for (const r of rows) {
      const name = String((r && r.name) || "").trim().slice(0, 300);
      const k = normTitle(name);
      if (!k) continue;
      const e = wanted.get(k) || { name, genres: new Set() };
      for (const raw of (Array.isArray(r.genres) ? r.genres : []).slice(0, 30)) {
        const g = resolveGenre(String(raw).slice(0, 120));
        if (g && g.id) e.genres.add(g.id);
        else if (g === null) unknown.set(String(raw).trim(), (unknown.get(String(raw).trim()) || 0) + 1);
      }
      wanted.set(k, e);
    }

    const plan = new Map();              // playId -> Set(genreId)
    const unmatched = [], ambiguous = [], noGenre = [];
    for (const [k, e] of wanted) {
      const ids = byTitle.get(k);
      if (!ids) { unmatched.push(e.name); continue; }
      if (!e.genres.size) { noGenre.push(e.name); continue; }   // sem gênero reconhecido: não mexe (evita apagar por engano)
      if (ids.length > 1) ambiguous.push(e.name);
      for (const id of ids) plan.set(id, e.genres);
    }

    const byGenre = {};
    for (const set of plan.values()) for (const g of set) byGenre[g] = (byGenre[g] || 0) + 1;

    const summary = {
      dryRun: !!dryRun, mode: replace ? "replace" : "add",
      namesInSheet: wanted.size, playsToUpdate: plan.size, byGenre,
      unmatchedCount: unmatched.length, unmatched: unmatched.slice(0, 30),
      ambiguousCount: ambiguous.length, ambiguous: ambiguous.slice(0, 10),
      noGenreCount: noGenre.length, noGenre: noGenre.slice(0, 10),
      unknownGenres: [...unknown.entries()].slice(0, 20).map(([name, count]) => ({ name, count }))
    };
    if (dryRun || plan.size === 0) return res.json({ ...summary, applied: false });

    const ids = [...plan.keys()];
    const ops = [];
    let pairs = [];
    if (replace) {
      for (let i = 0; i < ids.length; i += 1000) ops.push(prisma.playGenre.deleteMany({ where: { playId: { in: ids.slice(i, i + 1000) } } }));
      for (const [playId, set] of plan) for (const genre of set) pairs.push({ playId, genre });
    } else {
      const have = new Set();
      for (let i = 0; i < ids.length; i += 1000) {
        (await prisma.playGenre.findMany({ where: { playId: { in: ids.slice(i, i + 1000) } } })).forEach((x) => have.add(x.playId + "|" + x.genre));
      }
      for (const [playId, set] of plan) for (const genre of set) if (!have.has(playId + "|" + genre)) pairs.push({ playId, genre });
    }
    for (let i = 0; i < pairs.length; i += 1000) ops.push(prisma.playGenre.createMany({ data: pairs.slice(i, i + 1000) }));
    await prisma.$transaction(ops);            // tudo ou nada: se algo falhar, nenhuma série fica pela metade
    res.json({ ...summary, applied: true, updated: plan.size });
  } catch (e) {
    console.error("[genres-import]", e);
    res.status(500).json({ error: "Não foi possível atualizar os gêneros. Nada foi alterado." });
  }
});

// Imagem da peça (poster ou backdrop) enviada por arquivo. Cache longo no navegador:
// o "?v=" muda sempre que a peça é editada, então nunca fica desatualizada.
router.get("/:id/image/:kind", safe(async (req, res) => {
  const kind = req.params.kind === "backdrop" ? "backdrop" : "poster";
  const field = kind === "poster" ? "posterData" : "backdropData";
  const p = await prisma.play.findUnique({ where: { id: req.params.id }, select: { posterData: true, backdropData: true } });
  const data = (p && p[field]) || (kind === "backdrop" && p && p.posterData) || null;
  const m = data && /^data:(image\/[a-z]+);base64,([\s\S]+)$/.exec(data);
  if (!m) return res.status(404).end();
  res.set("Content-Type", m[1]);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(Buffer.from(m[2], "base64"));
}));

// Admin: quantas peças existem em cada plano (para o aviso antes de mover em massa).
router.get("/admin/plan-counts", requireAuth, requireAdmin, safe(async (req, res) => {
  const rows = await prisma.play.groupBy({ by: ["requiresPlan"], _count: { _all: true } });
  const counts = {};
  rows.forEach((r) => { counts[r.requiresPlan] = r._count._all; });
  res.json({ counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
}));

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

// Admin: EXCLUI todas as peças de um plano (ex.: tudo de Camarote). Não tem volta.
// Duas travas: (1) é preciso digitar o nome do plano; (2) a quantidade vista na tela precisa ser a de agora
// (se outra pessoa mexeu enquanto o modal estava aberto, recusa e pede para conferir de novo).
// Gêneros, progresso de quem assistia e "Minha lista" dessas peças saem junto (onDelete: Cascade).
router.post("/bulk-delete", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { plan, confirmName, expectedCount } = req.body || {};
    if (!plan) return res.status(400).json({ error: "Escolha o plano." });
    const p = await prisma.plan.findUnique({ where: { id: String(plan) } });
    if (!p) return res.status(400).json({ error: "Plano inválido." });
    if (String(confirmName || "").trim().toLowerCase() !== String(p.name).trim().toLowerCase()) {
      return res.status(400).json({ error: `Para confirmar, digite o nome do plano: ${p.name}.` });
    }
    const n = await prisma.play.count({ where: { requiresPlan: p.id } });
    if (n === 0) return res.status(400).json({ error: `Nenhuma peça está no plano ${p.name}.` });
    if (!Number.isInteger(expectedCount) || expectedCount !== n) {
      return res.status(409).json({ error: `A quantidade mudou (agora são ${n} peça${n === 1 ? "" : "s"} em ${p.name}). Feche e abra de novo para conferir.` });
    }
    const r = await prisma.play.deleteMany({ where: { requiresPlan: p.id } });
    console.log(`[bulk-delete] ${r.count} peça(s) do plano ${p.id} excluída(s) por ${req.user && req.user.id}`);
    res.json({ ok: true, deleted: r.count, plan: p.name });
  } catch (e) {
    console.error("[bulk-delete]", e.message);
    res.status(500).json({ error: "Não foi possível excluir as peças." });
  }
});

// Detalhe de uma peça. Só devolve a URL real do vídeo se o visitante tiver direito.
router.get("/:id", attachUserIfPresent, safe(async (req, res) => {
  const play = await prisma.play.findUnique({ where: { id: req.params.id }, select: PLAY_LIST_SELECT });
  if (!play) return res.status(404).json({ error: "Peça não encontrada." });
  const canWatch = await userCanWatch(req.user, play);
  const payload = publicPlay(play);
  if (!canWatch) payload.videoUrl = "";
  // Onde a pessoa parou (para retomar de onde estava). Falha aqui nunca derruba a página.
  let resume = null;
  if (req.user && canWatch) {
    try {
      const w = await prisma.watchProgress.findUnique({ where: { userId_playId: { userId: req.user.id, playId: play.id } } });
      if (w && w.duration > 0 && w.position / w.duration < 0.95) resume = { position: w.position, duration: w.duration };
    } catch (e) { resume = null; }
  }
  res.json({ play: payload, canWatch, resume });
}));

// O link do vídeo (HLS, mp4, YouTube...) precisa ser http(s). Vazio é permitido (peça sem vídeo ainda).
function invalidVideoUrl(v) {
  if (v === undefined || v === null || v === "") return false;
  if (typeof v !== "string") return true;
  try { const u = new URL(v.trim()); return u.protocol !== "http:" && u.protocol !== "https:"; } catch (e) { return true; }
}
const VIDEO_URL_ERROR = "O link do vídeo é inválido. Ele precisa começar com http:// ou https://.";

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const duration = parseInt(b.durationMinutes, 10);
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: "Informe o título da peça." });
    if (!duration || duration < 60) return res.status(400).json({ error: "A peça precisa ter no mínimo 60 minutos de duração." });
    if (invalidVideoUrl(b.videoUrl)) return res.status(400).json({ error: VIDEO_URL_ERROR });

    const poster = imageFieldUpdate("poster", b.posterUrl || "");
    // Banner vazio fica vazio: na hora de EXIBIR, o site usa a capa como reserva (ver publicPlay).
    const backdrop = imageFieldUpdate("backdrop", b.backdropUrl || "");
    if (poster.error || backdrop.error) return res.status(400).json({ error: poster.error || backdrop.error });

    const play = await prisma.play.create({
      data: {
        title: b.title.trim(),
        durationMinutes: duration,
        releaseYear: parseInt(b.releaseYear, 10) || new Date().getFullYear(),
        synopsis: b.synopsis || "",
        director: b.director || "",
        cast: b.cast || "",
        videoUrl: (b.videoUrl || "").trim(),
        requiresPlan: b.requiresPlan || "plateia",
        featured: !!b.featured,
        genres: { create: cleanGenreIds(b.genres).map((g) => ({ genre: g })) },
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
    if (invalidVideoUrl(b.videoUrl)) return res.status(400).json({ error: VIDEO_URL_ERROR });

    const poster = imageFieldUpdate("poster", b.posterUrl);
    const backdrop = imageFieldUpdate("backdrop", b.backdropUrl);
    if (poster.error || backdrop.error) return res.status(400).json({ error: poster.error || backdrop.error });

    const play = await prisma.play.update({
      where: { id: req.params.id },
      data: {
        title: b.title?.trim(),
        durationMinutes: duration || undefined,
        releaseYear: b.releaseYear ? parseInt(b.releaseYear, 10) : undefined,
        synopsis: b.synopsis,
        director: b.director,
        cast: b.cast,
        videoUrl: typeof b.videoUrl === "string" ? b.videoUrl.trim() : b.videoUrl,
        requiresPlan: b.requiresPlan,
        featured: typeof b.featured === "boolean" ? b.featured : undefined,
        ...(Array.isArray(b.genres) ? { genres: { deleteMany: {}, create: cleanGenreIds(b.genres).map((g) => ({ genre: g })) } } : {}),
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
