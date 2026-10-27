const express = require("express");
const https = require("https");
const http = require("http");
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

// Proxy universal de streams HLS (.m3u8 e segmentos .ts/.mp4) com suporte a CORS para navegadores
router.options("/stream", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range");
  res.sendStatus(200);
});

router.get("/stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("URL de stream não fornecida.");

  try {
    const u = new URL(targetUrl);
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*"
      }
    };
    if (req.headers.range) options.headers["Range"] = req.headers.range;

    const client = u.protocol === "https:" ? https : http;
    client.get(targetUrl, options, (remoteRes) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range");

      const isM3u8 = targetUrl.includes(".m3u8") || (remoteRes.headers["content-type"] || "").includes("mpegurl");

      if (isM3u8) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-cache");
        let body = "";
        remoteRes.on("data", (chunk) => { body += chunk; });
        remoteRes.on("end", () => {
          const lines = body.split("\n");
          const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
          const rewritten = lines.map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (line.includes('URI="')) {
              return line.replace(/URI="([^"]+)"/g, (m, uri) => {
                const absUri = uri.startsWith("http") ? uri : (new URL(uri, baseUrl)).href;
                return `URI="/api/vorta/stream?url=${encodeURIComponent(absUri)}"`;
              });
            }
            if (!trimmed.startsWith("#")) {
              const absUrl = trimmed.startsWith("http") ? trimmed : (new URL(trimmed, baseUrl)).href;
              return `/api/vorta/stream?url=${encodeURIComponent(absUrl)}`;
            }
            return line;
          }).join("\n");
          res.send(rewritten);
        });
      } else {
        res.status(remoteRes.statusCode);
        if (remoteRes.headers["content-type"]) res.setHeader("Content-Type", remoteRes.headers["content-type"]);
        if (remoteRes.headers["content-length"]) res.setHeader("Content-Length", remoteRes.headers["content-length"]);
        if (remoteRes.headers["content-range"]) res.setHeader("Content-Range", remoteRes.headers["content-range"]);
        res.setHeader("Cache-Control", "public, max-age=86400");
        remoteRes.pipe(res);
      }
    }).on("error", (err) => {
      res.status(502).send("Erro no proxy de stream: " + err.message);
    });
  } catch (e) {
    res.status(400).send("URL de stream inválida.");
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
  const categories = await vortaApi.getCategories().catch(() => ({ data: [] }));
  const platList = (categories.data && categories.data.length > 0)
    ? categories.data.filter((c) => c.is_active !== false).map((c) => c.name)
    : ["freereels", "shortmax", "meloshort"];

  const [homeResults, banners] = await Promise.all([
    Promise.all(platList.map((p) => vortaApi.getHome(p, lang).catch(() => ({ data: [] })))),
    vortaApi.getCuratedBanners(lang).catch(() => [])
  ]);

  const channels = {};
  const allItems = [...banners];
  platList.forEach((plat, idx) => {
    const list = (homeResults[idx] && homeResults[idx].data || []).map((i) => vortaApi.formatVortaPlay(i, plat));
    channels[plat] = list.slice(0, 30);
    allItems.push(...list);
  });

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

  const counts = {
    dubladas: dubladas.length,
    legendadas: legendadas.length
  };
  platList.forEach((plat) => {
    counts[plat] = deduped.filter((p) => p.platform === plat).length;
  });

  res.json({
    success: true,
    platforms: categories.data || [],
    banners,
    total: deduped.length,
    counts,
    dubladasCount: dubladas.length,
    legendadasCount: legendadas.length,
    dubladas: dubladas.slice(0, 30),
    legendadas: legendadas.slice(0, 30),
    channels
  });
}));

// Catálogo unificado com novelinhas, suporte a Dubladas, Legendadas, Plataformas e Filtros
router.get("/catalog", safe(async (req, res) => {
  const lang = req.query.lang || "pt";
  const platform = (req.query.platform || req.query.category || "all").toLowerCase();
  const genre = req.query.genre || "";
  const search = (req.query.search || req.query.q || "").trim().toLowerCase();
  const sort = req.query.sort || "recent";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 24));

  const allPlays = await vortaApi.getAllCuratedPlays(lang);

  const dubladasTotal = allPlays.filter((p) => p.isDublado).length;
  const legendadasTotal = allPlays.filter((p) => !p.isDublado).length;
  const frTotal = allPlays.filter((p) => p.platform === "freereels").length;
  const smTotal = allPlays.filter((p) => p.platform === "shortmax").length;
  const msTotal = allPlays.filter((p) => p.platform === "meloshort").length;

  let filtered = allPlays.slice();

  if (platform === "dubladas") {
    filtered = filtered.filter((p) => p.isDublado);
  } else if (platform === "legendadas") {
    filtered = filtered.filter((p) => !p.isDublado);
  } else if (platform === "local") {
    const dbRows = await prisma.play.findMany({ select: PLAY_LIST_SELECT });
    filtered = dbRows.map((p) => publicPlay(p));
  } else if (platform !== "all") {
    filtered = filtered.filter((p) => p.platform === platform);
  }

  if (genre && !["novos", "todos", "Todos"].includes(genre)) {
    filtered = filtered.filter((p) => {
      const gList = (p.genreLabels || []).concat((p.genres || []).map((g) => g.genre || g.label || g));
      return gList.some((g) => String(g).toLowerCase().includes(genre.toLowerCase()) || genre.toLowerCase().includes(String(g).toLowerCase()));
    });
  }

  if (search) {
    filtered = filtered.filter((p) => {
      const t = (p.title || "").toLowerCase();
      const s = (p.synopsis || "").toLowerCase();
      const c = (p.cast || "").toLowerCase();
      return t.includes(search) || s.includes(search) || c.includes(search);
    });
  }

  if (sort === "title") {
    filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else if (sort === "longest") {
    filtered.sort((a, b) => (b.durationMinutes || b.chapters || 0) - (a.durationMinutes || a.chapters || 0));
  } else if (sort === "shortest") {
    filtered.sort((a, b) => (a.durationMinutes || a.chapters || 0) - (b.durationMinutes || b.chapters || 0));
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const skip = (page - 1) * pageSize;
  const paged = filtered.slice(skip, skip + pageSize);

  const counts = {
    all: allPlays.length,
    dubladas: dubladasTotal,
    legendadas: legendadasTotal,
    freereels: frTotal,
    shortmax: smTotal,
    meloshort: msTotal
  };
  allPlays.forEach((p) => {
    if (p.platform) counts[p.platform] = (counts[p.platform] || 0) + 1;
  });

  res.json({
    success: true,
    platform,
    genre,
    total,
    page,
    pageSize,
    totalPages,
    counts,
    plays: paged
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
  const streamUrl = (primaryStream && primaryStream.url) || vortaApi.getDefaultStream();

  const rawSubs = data.subtitles || [];
  const ptSub = rawSubs.find((s) => s.languageCode === "pt" || (s.language && s.language.toLowerCase().includes("portugu")));
  const subtitleUrl = ptSub ? `/api/vorta/subtitles?url=${encodeURIComponent(ptSub.url)}` : "";
  const proxiedStreamUrl = streamUrl && streamUrl.startsWith("http") ? `/api/vorta/stream?url=${encodeURIComponent(streamUrl)}` : streamUrl;

  res.json({
    success: true,
    platform: raw.platform || category,
    chapterId,
    videoUrl: proxiedStreamUrl,
    directVideoUrl: streamUrl,
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
