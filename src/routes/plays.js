const express = require("express");
const prisma = require("../prismaClient");
const { attachUserIfPresent, requireAuth, requireAdmin } = require("../middleware/auth");
const { userCanWatch } = require("../utils/planRules");
const { withAccess } = require("../utils/playAccess");
const { PLAY_LIST_SELECT, imageFieldUpdate, publicPlay } = require("../utils/images");
const { GENRES, GENRE_IDS, resolveGenre, normTitle, cleanGenreIds, loadLabels, labelOf, currentGenres } = require("../utils/genres");
const { dailyShuffle, dayKey, TZ } = require("../utils/dailyOrder");
const { sampleIds } = require("../utils/randomPick");

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
// devolve até 120 novelinhas (usado pela Home para montar as seções).
// Ordenações aceitas pelo catálogo (?sort=). Qualquer outro valor cai em "recent".
const LIST_SORTS = {
  recent: { createdAt: "desc" },
  title: { title: "asc" },
  year: [{ releaseYear: "desc" }, { createdAt: "desc" }],
  longest: { durationMinutes: "desc" },
  shortest: { durationMinutes: "asc" }
};

router.get("/", attachUserIfPresent, async (req, res) => {
  try {
    const { page, pageSize, genre, search, sort, year, plan } = req.query;
    const where = {};
    if (genre && !["Todos", "novos"].includes(String(genre))) where.genres = { some: { genre: String(genre) } };
    if (year !== undefined && /^\d{4}$/.test(String(year))) where.releaseYear = parseInt(year, 10);   // filtro do catálogo: ano
    if (plan) where.requiresPlan = String(plan);                                                       // filtro do catálogo: plano exigido
    const sortGiven = Object.prototype.hasOwnProperty.call(LIST_SORTS, String(sort));          // só chaves próprias: "constructor"/"__proto__" não valem
    const orderBy = sortGiven ? LIST_SORTS[String(sort)] : LIST_SORTS.recent;
    const genreId = genre && !["Todos", "novos"].includes(String(genre)) ? String(genre) : null;

    const usePagination = !!page;
    const take = usePagination ? Math.min(parseInt(pageSize, 10) || 24, 100) : 120;
    const skip = usePagination ? Math.max(parseInt(page, 10) - 1, 0) * take : 0;

    let plays, total;
    if (search !== undefined && String(search).trim() !== "") {
      // Pesquisa que ignora maiúsculas e acentos (o "contains" do Postgres diferencia os dois). Procura no título,
      // na direção e no elenco; o que bate no título vem antes. O catálogo é pequeno, então comparar em memória é barato.
      const q = normTitle(search);
      if (!q) { plays = []; total = 0; }
      else {
        const rows = await prisma.play.findMany({ where, orderBy: { createdAt: "desc" }, select: { id: true, title: true, director: true, cast: true }, take: 5000 });
        const rank = (r) => {
          const t = normTitle(r.title);
          if (t === q) return 0;
          if (t.startsWith(q)) return 1;
          if (t.includes(q)) return 2;
          return [r.director, r.cast].some((f) => normTitle(f).includes(q)) ? 3 : -1;
        };
        const ranked = rows.map((r) => ({ id: r.id, k: rank(r) })).filter((r) => r.k >= 0).sort((a, b) => a.k - b.k);
        total = ranked.length;
        const pageIds = ranked.slice(skip, skip + take).map((r) => r.id);
        const found = pageIds.length ? await prisma.play.findMany({ where: { id: { in: pageIds } }, select: PLAY_LIST_SELECT }) : [];
        const byId = new Map(found.map((p) => [p.id, p]));
        plays = pageIds.map((id) => byId.get(id)).filter(Boolean);
      }
    } else if (genreId && !sortGiven) {
      // Gênero escolhido e nenhuma ordenação pedida: usa a ordem do dia do gênero (a mesma da fileira da home).
      // Com filtro de ano/plano, mantém a ordem relativa do gênero inteiro (as novelinhas não "pulam" de lugar).
      const hasExtra = where.releaseYear !== undefined || where.requiresPlan !== undefined;
      const allRows = await prisma.play.findMany({ where: { genres: { some: { genre: genreId } } }, select: { id: true }, take: 5000 });
      const rank = new Map(dailyShuffle(allRows, "genre:" + genreId).map((p, i) => [p.id, i]));
      const rows = hasExtra ? await prisma.play.findMany({ where, select: { id: true }, take: 5000 }) : allRows;
      const ordered = rows.map((r) => r.id).sort((a, b) => rank.get(a) - rank.get(b));
      total = ordered.length;
      const pageIds = ordered.slice(skip, skip + take);
      const found = pageIds.length ? await prisma.play.findMany({ where: { id: { in: pageIds } }, select: PLAY_LIST_SELECT }) : [];
      const byId = new Map(found.map((p) => [p.id, p]));
      plays = pageIds.map((id) => byId.get(id)).filter(Boolean);
    } else {
      [plays, total] = await Promise.all([
        prisma.play.findMany({ where, orderBy, skip, take, select: PLAY_LIST_SELECT }),
        prisma.play.count({ where })
      ]);
    }

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
// Opções reais para a gaveta de filtros: só aparecem anos e planos que têm novelinhas.
router.get("/facets", safe(async (req, res) => {
  const [years, plans] = await Promise.all([
    prisma.play.groupBy({ by: ["releaseYear"], _count: { _all: true }, orderBy: { releaseYear: "desc" } }),
    prisma.play.groupBy({ by: ["requiresPlan"], _count: { _all: true } })
  ]);
  res.json({
    years: years.map((y) => ({ year: y.releaseYear, count: y._count._all })),
    plans: plans.map((p) => ({ id: p.requiresPlan, count: p._count._all }))
  });
}));

// Sorteio ("Sortear novelinha"): escolhe ao acaso entre TODAS as novelinhas cadastradas, sem limite de data.
// Antes o site sorteava só entre as 100 mais recentes da listagem. Aqui lemos apenas os ids (leve) e sorteamos entre todos.
// ?count=N (1 a 12) e ?exclude=ID (para não repetir a anterior).
router.get("/random", attachUserIfPresent, safe(async (req, res) => {
  const count = Math.min(Math.max(parseInt(req.query.count, 10) || 1, 1), 12);
  const exclude = req.query.exclude ? String(req.query.exclude) : "";
  const rows = await prisma.play.findMany({ select: { id: true } });          // sem take, sem orderBy, sem filtro de data
  const picked = sampleIds(rows.map((r) => r.id), count, exclude);
  const found = picked.length ? await prisma.play.findMany({ where: { id: { in: picked } }, select: PLAY_LIST_SELECT }) : [];
  const byId = new Map(found.map((p) => [p.id, p]));
  const plays = await Promise.all(picked.map((id) => byId.get(id)).filter(Boolean).map((p) => withAccess(req.user, p)));
  res.json({ plays, total: rows.length });
}));

// "Em alta": as novelinhas com mais movimento nos últimos 30 dias. Não existe contador de visualizações no banco, então o
// ranking usa o que as pessoas fizeram: quem começou a assistir (peso 2) e quem salvou na lista (peso 1). Se houver pouca
// atividade, completa com os destaques e depois com as mais novas, para a seção nunca ficar vazia (campo "ranked" diz
// quantas vieram de atividade real).
router.get("/trending", attachUserIfPresent, safe(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 24);
  const since = new Date(Date.now() - 30 * 86400000);
  const [watching, saved] = await Promise.all([
    prisma.watchProgress.groupBy({ by: ["playId"], where: { updatedAt: { gte: since } }, _count: { _all: true } }),
    prisma.myListItem.groupBy({ by: ["playId"], where: { createdAt: { gte: since } }, _count: { _all: true } })
  ]);
  const score = new Map();
  watching.forEach((r) => score.set(r.playId, (score.get(r.playId) || 0) + r._count._all * 2));
  saved.forEach((r) => score.set(r.playId, (score.get(r.playId) || 0) + r._count._all));
  const rankedIds = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  const found = rankedIds.length ? await prisma.play.findMany({ where: { id: { in: rankedIds } }, select: PLAY_LIST_SELECT }) : [];
  const byId = new Map(found.map((p) => [p.id, p]));
  let plays = rankedIds.map((id) => byId.get(id)).filter(Boolean);     // novelinha apagada some do ranking sozinha
  const ranked = plays.length;
  if (plays.length < limit) {
    const filler = await prisma.play.findMany({
      where: { id: { notIn: plays.map((p) => p.id) } },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: limit - plays.length,
      select: PLAY_LIST_SELECT
    });
    plays = plays.concat(filler);
  }
  res.json({ plays: await Promise.all(plays.map((p) => withAccess(req.user, p))), ranked });
}));

router.get("/feed/home", attachUserIfPresent, async (req, res) => {
  try {
    const [featured, novos, pairs, total] = await Promise.all([
      prisma.play.findMany({ where: { featured: true }, orderBy: { createdAt: "desc" }, take: 10, select: PLAY_LIST_SELECT }),
      prisma.play.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: PLAY_LIST_SELECT }),
      prisma.playGenre.findMany({ select: { genre: true, playId: true } }),
      prisma.play.count()
    ]);
    // Cada gênero é embaralhado SÓ entre as suas próprias novelinhas (ordem do dia: muda à 00:00 e não mistura gêneros).
    // O sorteio vale para o gênero inteiro e só depois se pegam as 20 da fileira, senão só as mais novas girariam.
    const byGenre = new Map();
    pairs.forEach((x) => { if (!byGenre.has(x.genre)) byGenre.set(x.genre, []); byGenre.get(x.genre).push({ id: x.playId }); });
    const rowsMeta = GENRES.filter((g) => (byGenre.get(g.id) || []).length > 0).map((g) => {
      const all = byGenre.get(g.id);
      return { id: g.id, total: all.length, ids: dailyShuffle(all, "genre:" + g.id).slice(0, 20).map((p) => p.id) };
    });
    const wanted = [...new Set(rowsMeta.flatMap((r) => r.ids))];
    const found = wanted.length ? await prisma.play.findMany({ where: { id: { in: wanted } }, select: PLAY_LIST_SELECT }) : [];
    const byId = new Map(found.map((p) => [p.id, p]));
    const rows = await Promise.all(rowsMeta.map(async (r) => ({
      id: r.id,
      label: labelOf(r.id),
      total: r.total,
      plays: await Promise.all(r.ids.map((id) => byId.get(id)).filter(Boolean).map((p) => withAccess(req.user, p)))
    })));
    res.json({
      featured: await Promise.all(featured.map((p) => withAccess(req.user, p))),
      novos: await Promise.all(novos.map((p) => withAccess(req.user, p))),   // "Novos" continua por data de postagem (é o que o nome promete)
      genres: rows,
      catalog: currentGenres(),
      total,
      shuffleDay: dayKey(),
      shuffleTz: TZ
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

// Imagem da novelinha (poster ou backdrop) enviada por arquivo. Cache longo no navegador:
// o "?v=" muda sempre que a novelinha é editada, então nunca fica desatualizada.
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

// Admin: quantas novelinhas existem em cada plano (para o aviso antes de mover em massa).
router.get("/admin/plan-counts", requireAuth, requireAdmin, safe(async (req, res) => {
  const rows = await prisma.play.groupBy({ by: ["requiresPlan"], _count: { _all: true } });
  const counts = {};
  rows.forEach((r) => { counts[r.requiresPlan] = r._count._all; });
  res.json({ counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
}));

// Admin: move TODAS as novelinhas de um plano para outro (ex.: de Plateia para Balcão).
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
    res.status(500).json({ error: "Não foi possível mover as novelinhas." });
  }
});

// Admin: EXCLUI todas as novelinhas de um plano (ex.: tudo de Camarote). Não tem volta.
// Duas travas: (1) é preciso digitar o nome do plano; (2) a quantidade vista na tela precisa ser a de agora
// (se outra pessoa mexeu enquanto o modal estava aberto, recusa e pede para conferir de novo).
// Gêneros, progresso de quem assistia e "Minha lista" dessas novelinhas saem junto (onDelete: Cascade).
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
    if (n === 0) return res.status(400).json({ error: `Nenhuma novelinha está no plano ${p.name}.` });
    if (!Number.isInteger(expectedCount) || expectedCount !== n) {
      return res.status(409).json({ error: `A quantidade mudou (agora são ${n} novelinha${n === 1 ? "" : "s"} em ${p.name}). Feche e abra de novo para conferir.` });
    }
    const r = await prisma.play.deleteMany({ where: { requiresPlan: p.id } });
    console.log(`[bulk-delete] ${r.count} novelinha(s) do plano ${p.id} excluída(s) por ${req.user && req.user.id}`);
    res.json({ ok: true, deleted: r.count, plan: p.name });
  } catch (e) {
    console.error("[bulk-delete]", e.message);
    res.status(500).json({ error: "Não foi possível excluir as novelinhas." });
  }
});

// Detalhe de uma novelinha. Só devolve a URL real do vídeo se o visitante tiver direito.
router.get("/:id", attachUserIfPresent, safe(async (req, res) => {
  if (req.params.id && (req.params.id.startsWith("vorta:") || req.params.id.startsWith("vorta_"))) {
    try {
      const vortaApi = require("../services/vortaApi");
      const parts = req.params.id.includes(":") ? req.params.id.split(":") : req.params.id.split("_");
      const category = parts[1] || "freereels";
      const vortaId = parts.slice(2).join(":");
      const reqChapterId = req.query.chapterId;
      let detail, vid = null;
      if (reqChapterId) {
        [detail, vid] = await Promise.all([
          vortaApi.getDetail(category, vortaId, "pt"),
          vortaApi.getVideo(category, vortaId, reqChapterId, "pt").catch(() => null)
        ]);
      } else {
        detail = await vortaApi.getDetail(category, vortaId, "pt");
      }
      const formatted = vortaApi.formatVortaPlay(detail.data, category);
      const chapters = (detail.data && detail.data.chapters) || [];
      const chapterId = reqChapterId || (chapters[0] && chapters[0].id) || 1;
      let videoUrl = "";
      let subtitles = [];
      if (!vid) {
        try {
          vid = await vortaApi.getVideo(category, vortaId, chapterId, "pt");
        } catch (err) {}
      }
      if (vid && vid.data) {
        const streams = vid.data.streams || [];
        const h264 = streams.find((s) => s.url && s.url.includes("h264"));
        videoUrl = (h264 && h264.url) || (streams[0] && streams[0].url) || "";
        subtitles = vid.data.subtitles || [];
        const ptSub = subtitles.find((s) => s.languageCode === "pt" || (s.language && s.language.toLowerCase().includes("portugu")));
        formatted.subtitleUrl = ptSub ? `/api/vorta/subtitles?url=${encodeURIComponent(ptSub.url)}` : "";
        formatted.hasSubtitles = Boolean(ptSub || subtitles.length > 0);
      }
      if (!videoUrl) videoUrl = vortaApi.getDefaultStream();
      const proxiedUrl = videoUrl && videoUrl.startsWith("http") ? `/api/vorta/stream?url=${encodeURIComponent(videoUrl)}` : videoUrl;
      formatted.videoUrl = proxiedUrl;
      formatted.directVideoUrl = videoUrl;
      formatted.subtitles = subtitles;
      formatted.chaptersList = chapters;
      formatted.chapterId = chapterId;
      formatted.episodesCount = chapters.length || 1;
      const currentCh = chapters.find(c => String(c.id) === String(chapterId)) || chapters[0];
      formatted.currentEpisodeIndex = currentCh ? currentCh.index : 1;
      formatted.canWatch = true;
      formatted.hasVideo = true;
      return res.json({ play: formatted, canWatch: true, resume: null });
    } catch (e) {
      return res.status(404).json({ error: "Novelinha não encontrada." });
    }
  }

  const play = await prisma.play.findUnique({ where: { id: req.params.id }, select: PLAY_LIST_SELECT });
  if (!play) return res.status(404).json({ error: "Novelinha não encontrada." });
  const canWatch = await userCanWatch(req.user, play);
  const payload = publicPlay(play);
  if (!canWatch) {
    payload.videoUrl = "";
  } else {
    try {
      const vortaApi = require("../services/vortaApi");
      const allCurated = await vortaApi.getAllCuratedPlays("pt");
      if (allCurated.length > 0) {
        // 1. Tenta correspondência por título aproximado
        const cleanTitle = (play.title || "").toLowerCase().replace(/\s*\(dublado\)/i, "").trim();
        let assigned = allCurated.find((p) => {
          const t = (p.title || "").toLowerCase().replace(/\s*\(dublado\)/i, "").trim();
          return t === cleanTitle || (cleanTitle.length > 5 && (t.includes(cleanTitle) || cleanTitle.includes(t)));
        });
        // 2. Tenta por chave da capa se houver
        if (!assigned && play.posterUrl) {
          const coverKey = vortaApi.cleanCoverKey(play.posterUrl);
          if (coverKey) assigned = allCurated.find((p) => p.posterUrl && p.posterUrl.includes(coverKey));
        }
        // 3. Fallback determinístico por hash do ID
        if (!assigned) {
          let hashVal = 0;
          for (let i = 0; i < play.id.length; i++) hashVal = (hashVal * 31 + play.id.charCodeAt(i)) >>> 0;
          assigned = allCurated[hashVal % allCurated.length];
        }

        if (assigned) {
          const parts = assigned.id.split(":");
          const category = parts[1] || "freereels";
          const vortaId = parts[2];
          const detail = await vortaApi.getDetail(category, vortaId, "pt");
          const chapters = (detail.data && detail.data.chapters) || [];
          if (chapters.length > 0) {
            const chapterId = req.query.chapterId || (chapters[0] && chapters[0].id) || 1;
            let videoUrl = "";
            let subtitles = [];
            try {
              const vid = await vortaApi.getVideo(category, vortaId, chapterId, "pt");
              const streams = (vid.data && vid.data.streams) || [];
              const h264 = streams.find((s) => s.url && s.url.includes("h264"));
              videoUrl = (h264 && h264.url) || (streams[0] && streams[0].url) || "";
              subtitles = (vid.data && vid.data.subtitles) || [];
              const ptSub = subtitles.find((s) => s.languageCode === "pt" || (s.language && s.language.toLowerCase().includes("portugu")));
              payload.subtitleUrl = ptSub ? `/api/vorta/subtitles?url=${encodeURIComponent(ptSub.url)}` : "";
              payload.hasSubtitles = Boolean(ptSub || subtitles.length > 0);
            } catch (err) {}

            if (!videoUrl) videoUrl = vortaApi.getDefaultStream();
            payload.videoUrl = `/api/vorta/stream?url=${encodeURIComponent(videoUrl)}`;
            payload.chaptersList = chapters;
            payload.chapterId = chapterId;
            payload.episodesCount = chapters.length;
            const currentCh = chapters.find((c) => String(c.id) === String(chapterId)) || chapters[0];
            payload.currentEpisodeIndex = currentCh ? currentCh.index : 1;
            payload.subtitles = subtitles;
          }
        }
      }
    } catch (err) {}

    if (!payload.videoUrl) {
      const vortaApi = require("../services/vortaApi");
      payload.videoUrl = `/api/vorta/stream?url=${encodeURIComponent(vortaApi.getDefaultStream())}`;
    } else if (payload.videoUrl && payload.videoUrl.startsWith("http") && !payload.videoUrl.includes("/api/vorta/stream")) {
      payload.videoUrl = `/api/vorta/stream?url=${encodeURIComponent(payload.videoUrl)}`;
    }
    payload.hasVideo = true;
  }
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

// O link do vídeo (HLS, mp4, YouTube...) precisa ser http(s). Vazio é permitido (novelinha sem vídeo ainda).
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
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: "Informe o título da novelinha." });
    if (!duration || duration < 60) return res.status(400).json({ error: "A novelinha precisa ter no mínimo 60 minutos de duração." });
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
    res.status(500).json({ error: "Não foi possível salvar a novelinha." });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const duration = parseInt(b.durationMinutes, 10);
    if (duration && duration < 60) return res.status(400).json({ error: "A novelinha precisa ter no mínimo 60 minutos de duração." });
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
    res.status(404).json({ error: "Novelinha não encontrada." });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.play.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: "Novelinha não encontrada." });
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
