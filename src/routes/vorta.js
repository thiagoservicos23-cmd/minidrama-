const express = require("express");
const https = require("https");
const vortaApi = require("../services/vortaApi");
const prisma = require("../prismaClient");
const { attachUserIfPresent, requireAuth, requireAdmin } = require("../middleware/auth");
const { PLAY_LIST_SELECT, publicPlay } = require("../utils/images");
const { translateTitle, translateSynopsis, detectGenres } = require("../utils/translator");

const router = express.Router();

const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error("[vorta]", req.method, req.path, e && e.message);
  if (!res.headersSent) {
    res.status(e.statusCode || 500).json({
      error: e.message || "Não foi possível carregar os dados da API Vorta."
    });
  }
});

// Proxy e conversão de legendas SRT para WebVTT (compatível com Plyr e todos os navegadores)
router.get("/subtitles", (req, res) => {
  const subUrl = req.query.url;
  if (!subUrl) return res.status(400).send("URL de legenda não fornecida.");
  try {
    https.get(subUrl, (remoteRes) => {
      let data = "";
      remoteRes.on("data", (chunk) => { data += chunk; });
      remoteRes.on("end", () => {
        const vtt = "WEBVTT\n\n" + data.trim()
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
        res.setHeader("Content-Type", "text/vtt; charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(vtt);
      });
    }).on("error", (err) => {
      res.status(502).send("Erro ao buscar legenda: " + err.message);
    });
  } catch (e) {
    res.status(500).send("Erro ao processar legenda.");
  }
});

// Status & Plan info
router.get("/status", safe(async (req, res) => {
  const [status, plan, categories] = await Promise.all([
    vortaApi.getKeyStatus(),
    vortaApi.getKeyPlan(),
    vortaApi.getCategories().catch(() => ({ data: [] }))
  ]);
  res.json({
    status: status.status || "active",
    plan: plan.plan || "trial",
    limit: plan.limit || "600/day",
    platforms: categories.data || []
  });
}));

// Categorias / Plataformas
router.get("/categories", safe(async (req, res) => {
  const data = await vortaApi.getCategories();
  res.json(data);
}));

// Idiomas
router.get("/languages", safe(async (req, res) => {
  const category = req.query.category || req.query.category_p || "freereels";
  const data = await vortaApi.getLanguages(category);
  res.json(data);
}));

// Banner
router.get("/banner", safe(async (req, res) => {
  const category = req.query.category || req.query.category_p || "freereels";
  const lang = req.query.lang || "pt";
  const data = await vortaApi.getBanner(category, lang);
  const formatted = (data.data || []).map((item) => vortaApi.formatVortaPlay(item, category));
  res.json({
    success: true,
    platform: data.platform || category,
    total: formatted.length,
    raw: data.data || [],
    plays: formatted
  });
}));

// Multi-channel Feed completo com Plataformas, Dubladas e Legendadas
router.get("/feed", safe(async (req, res) => {
  const lang = req.query.lang || "pt";
  const [categories, freereelsHome, shortmaxHome, meloshortHome, banners] = await Promise.all([
    vortaApi.getCategories().catch(() => ({ data: [] })),
    vortaApi.getHome("freereels", lang).catch(() => ({ data: [] })),
    vortaApi.getHome("shortmax", lang).catch(() => ({ data: [] })),
    vortaApi.getHome("meloshort", lang).catch(() => ({ data: [] })),
    vortaApi.getCuratedBanners(lang).catch(() => [])
  ]);

  const frList = (freereelsHome.data || []).map((i) => vortaApi.formatVortaPlay(i, "freereels"));
  const smList = (shortmaxHome.data || []).map((i) => vortaApi.formatVortaPlay(i, "shortmax"));
  const msList = (meloshortHome.data || []).map((i) => vortaApi.formatVortaPlay(i, "meloshort"));

  const allItems = [...banners, ...frList, ...smList, ...msList];
  const seen = new Set();
  const deduped = [];
  allItems.forEach((p) => {
    if (p && p.id && !seen.has(p.id)) {
      seen.add(p.id);
      deduped.push(p);
    }
  });

  const dubladas = deduped.filter((p) => p.isDublado);
  const legendadas = deduped.filter((p) => !p.isDublado);

  res.json({
    success: true,
    platforms: categories.data || [],
    banners,
    total: deduped.length,
    dubladasCount: dubladas.length,
    legendadasCount: legendadas.length,
    dubladas: dubladas.slice(0, 30),
    legendadas: legendadas.slice(0, 30),
    channels: {
      freereels: frList.slice(0, 30),
      shortmax: smList.slice(0, 30),
      meloshort: msList.slice(0, 30)
    }
  });
}));

// Home feed
router.get("/home", safe(async (req, res) => {
  const category = req.query.category || req.query.category_p || "freereels";
  const lang = req.query.lang || "pt";
  const data = await vortaApi.getHome(category, lang);
  const formatted = (data.data || []).map((item) => vortaApi.formatVortaPlay(item, category));
  res.json({
    success: true,
    platform: data.platform || category,
    total: data.total || formatted.length,
    raw: data.data || [],
    plays: formatted
  });
}));

// Discover paginado
router.get("/discover", safe(async (req, res) => {
  const category = req.query.category || req.query.category_p || "freereels";
  const lang = req.query.lang || "pt";
  const page = parseInt(req.query.page, 10) || 1;
  const data = await vortaApi.getDiscover(category, lang, page);
  const formatted = (data.data || []).map((item) => vortaApi.formatVortaPlay(item, category));
  res.json({
    success: true,
    platform: data.platform || category,
    page,
    total: data.total || formatted.length,
    cached: data.cached || false,
    plays: formatted
  });
}));

// Detalhe de uma novelinha com lista de capítulos
router.get("/detail", safe(async (req, res) => {
  let { category, id, lang } = req.query;
  category = category || req.query.category_p;

  if (id && id.startsWith("vorta:")) {
    const parts = id.split(":");
    category = parts[1] || category;
    id = parts[2] || id;
  }
  category = category || "freereels";
  lang = lang || "pt";

  if (!id) return res.status(400).json({ error: "Informe o ID da novelinha." });

  const raw = await vortaApi.getDetail(category, id, lang);
  const item = raw.data || {};
  const formatted = vortaApi.formatVortaPlay(item, category);

  res.json({
    success: true,
    platform: raw.platform || category,
    play: formatted,
    chapters: item.chapters || [],
    total_episodes: item.total_episodes || (item.chapters ? item.chapters.length : 0),
    data: item
  });
}));

// Vídeo de um capítulo específico com detecção e link de legendas em português
router.get("/video", safe(async (req, res) => {
  let { category, id, chapterId, lang } = req.query;
  category = category || req.query.category_p;

  if (id && id.startsWith("vorta:")) {
    const parts = id.split(":");
    category = parts[1] || category;
    id = parts[2] || id;
  }
  category = category || "freereels";
  lang = lang || "pt";

  if (!id) return res.status(400).json({ error: "Informe o ID da novelinha." });
  if (chapterId === undefined || chapterId === null || chapterId === "") {
    try {
      const detail = await vortaApi.getDetail(category, id, lang);
      if (detail.data && detail.data.chapters && detail.data.chapters.length > 0) {
        chapterId = detail.data.chapters[0].id;
      } else {
        chapterId = 1;
      }
    } catch (e) {
      chapterId = 1;
    }
  }

  const raw = await vortaApi.getVideo(category, id, chapterId, lang);
  const data = raw.data || {};

  const streams = data.streams || [];
  const h264Stream = streams.find((s) => s.url && s.url.includes("h264"));
  const primaryStream = h264Stream || streams[0] || null;
  const streamUrl = primaryStream ? primaryStream.url : "";

  const rawSubs = data.subtitles || [];
  const ptSub = rawSubs.find((s) => s.languageCode === "pt" || (s.language && s.language.toLowerCase().includes("portugu")));
  const subtitleUrl = ptSub ? `/api/vorta/subtitles?url=${encodeURIComponent(ptSub.url)}` : "";

  res.json({
    success: true,
    platform: raw.platform || category,
    chapterId,
    videoUrl: streamUrl,
    subtitleUrl,
    subtitles: rawSubs,
    hasSubtitles: Boolean(ptSub || rawSubs.length > 0),
    episode_index: data.episode_index || 1,
    total_episodes: data.total_episodes || 0,
    next_video_id: data.next_video_id,
    prev_video_id: data.prev_video_id,
    title: data.title || `Capítulo ${data.episode_index || 1}`,
    duration: data.duration || 0,
    is_free: data.is_free !== false,
    raw: data
  });
}));

// Pesquisa
router.get("/search", safe(async (req, res) => {
  const category = req.query.category || req.query.category_p || "freereels";
  const q = req.query.q || req.query.search || "";
  const lang = req.query.lang || "pt";
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const data = await vortaApi.search(category, q, lang, page, limit);
  const formatted = (data.data || []).map((item) => vortaApi.formatVortaPlay(item, category));

  res.json({
    success: true,
    platform: data.platform || category,
    total: data.total || formatted.length,
    plays: formatted,
    page,
    raw: data.data || []
  });
}));

// Analytics Track
router.post("/track", safe(async (req, res) => {
  const body = req.body || {};
  const headers = {
    deviceId: req.headers.deviceid || body.deviceId,
    deviceModel: req.headers.devicemodel || body.deviceModel,
    osVersion: req.headers.osversion || body.osVersion,
    appVersion: req.headers.appversion || body.appVersion
  };
  const result = await vortaApi.track(body, headers);
  res.json(result);
}));

// Importar / Sincronizar dramas da Vorta para o banco de dados PostgreSQL do Mini Drama
router.post("/sync", requireAuth, requireAdmin, safe(async (req, res) => {
  const category = req.body.category || "all";
  const lang = req.body.lang || "pt";
  const limit = Math.min(parseInt(req.body.limit, 10) || 20, 100);

  const platforms = category === "all" ? ["freereels", "shortmax", "meloshort"] : [category];
  let imported = 0;

  for (const plat of platforms) {
    const banner = await vortaApi.getBanner(plat, lang);
    const items = (banner.data || []).slice(0, limit);

    for (const item of items) {
      if (!item.title) continue;
      const cleanTitle = translateTitle(item.title);
      const chaptersNum = parseInt(item.chapters || item.total_episodes || 0, 10);
      const duration = chaptersNum > 0 ? chaptersNum * 2 : 60;
      const ptSynopsis = translateSynopsis(item.synopsis || "", cleanTitle);
      const genreIds = detectGenres(cleanTitle, ptSynopsis, item.tags || item.genres || []);

      const existing = await prisma.play.findFirst({
        where: {
          OR: [{ title: cleanTitle }, { title: item.title }]
        }
      });

      if (!existing) {
        await prisma.play.create({
          data: {
            title: cleanTitle,
            synopsis: ptSynopsis,
            director: item.author || (plat.toUpperCase() + " Studios"),
            cast: genreIds.slice(0, 3).join(", ") || "Elenco Principal",
            durationMinutes: Math.max(duration, 45),
            releaseYear: new Date().getFullYear(),
            posterUrl: item.cover || "",
            backdropUrl: item.cover || "",
            videoUrl: "",
            requiresPlan: "plateia",
            featured: false,
            genres: {
              create: genreIds.map((g) => ({ genre: g }))
            }
          }
        });
        imported++;
      }
    }
  }

  res.json({
    success: true,
    category,
    imported,
    message: `${imported} novelinhas em PT-BR importadas com sucesso.`
  });
}));

module.exports = router;
