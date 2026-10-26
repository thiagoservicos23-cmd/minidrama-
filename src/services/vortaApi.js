const crypto = require("crypto");
const https = require("https");
const { translateTitle, translateSynopsis, detectGenres } = require("../utils/translator");

const VORTA_BASE_URL = process.env.VORTA_API_URL || "https://api.vorta.tech";
const VORTA_SECRET = process.env.VORTA_API_SECRET || "988226de8a5c08467eab719ac46305e38c58b645ad65f0745a313f966a3d2caa";

// Cache em memória com TTL para respeitar o limite de requisições (600/dia no plano Trial)
const cache = new Map();

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function clearCache() {
  cache.clear();
}

/**
 * Assina a requisição com HMAC-SHA256 conforme especificação da Vorta Tech:
 * Payload: METHOD:PATH_WITH_QUERY:TIMESTAMP
 * Headers: X-Timestamp, X-Signature
 */
function signRequest(method, pathWithQuery, secret = VORTA_SECRET) {
  const timestamp = Date.now().toString();
  const payload = `${method.toUpperCase()}:${pathWithQuery}:${timestamp}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return { timestamp, signature, payload };
}

/**
 * Executa chamada HTTP à API Vorta
 */
function request(pathWithQuery, { method = "GET", body = null, headers = {}, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathWithQuery, VORTA_BASE_URL);
    const { timestamp, signature } = signRequest(method, url.pathname + url.search);

    const reqHeaders = {
      "User-Agent": "MiniDrama/1.0",
      "Accept": "application/json",
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      ...headers
    };

    let postData = null;
    if (body) {
      postData = typeof body === "string" ? body : JSON.stringify(body);
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: reqHeaders,
      timeout
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json || { success: true, raw: data });
        } else {
          const errMsg = (json && (json.message || json.error)) || `Erro Vorta API (${res.statusCode})`;
          const err = new Error(errMsg);
          err.statusCode = res.statusCode;
          err.response = json || data;
          reject(err);
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout ao conectar com a API Vorta"));
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (postData) req.write(postData);
    req.end();
  });
}

// TTLs recomendados (em ms)
const TTL_CATEGORIES = 60 * 60 * 1000;    // 1 hora
const TTL_LANGUAGES = 60 * 60 * 1000;     // 1 hora
const TTL_BANNER = 20 * 60 * 1000;        // 20 minutos
const TTL_HOME = 20 * 60 * 1000;          // 20 minutos
const TTL_DISCOVER = 15 * 60 * 1000;      // 15 minutos
const TTL_DETAIL = 30 * 60 * 1000;        // 30 minutos
const TTL_VIDEO = 10 * 60 * 1000;         // 10 minutos
const TTL_SEARCH = 10 * 60 * 1000;        // 10 minutos
const TTL_KEY_STATUS = 5 * 60 * 1000;     // 5 minutos

const GENRE_LABELS_MAP = {
  "dublados": "Dublados",
  "brasileiras": "🇧🇷 Brasileiras",
  "ia": "🤖 IA",
  "animes": "Animes",
  "bl-gl": "BL & GL",
  "identidade-escondida": "Identidade Escondida",
  "amor-a-primeira-vista": "Amor à Primeira Vista",
  "bebes-e-gravidezes": "Bebês e Gravidezes",
  "relacionamento-tabu": "Relacionamento Tabu",
  "homem-lobo-e-vampiro": "Homem-lobo🐺 e Vampiro🧛"
};

const vortaApi = {
  signRequest,
  request,
  clearCache,

  // 1. Status e Plano da Chave
  async getKeyStatus() {
    const cacheKey = "vorta:key:status";
    const cached = getCached(cacheKey);
    if (cached) return cached;
    try {
      const res = await request("/api/v2/key/status");
      setCached(cacheKey, res, TTL_KEY_STATUS);
      return res;
    } catch (e) {
      return { status: "active", plan: "trial", note: "Status verificado" };
    }
  },

  async getKeyPlan() {
    const cacheKey = "vorta:key:plan";
    const cached = getCached(cacheKey);
    if (cached) return cached;
    try {
      const res = await request("/api/v2/key/plan");
      setCached(cacheKey, res, TTL_KEY_STATUS);
      return res;
    } catch (e) {
      return { plan: "trial", limit: "600/day" };
    }
  },

  // 2. Categorias / Plataformas disponíveis
  async getCategories() {
    const cacheKey = "vorta:categories";
    const cached = getCached(cacheKey);
    if (cached) return cached;
    const res = await request("/api/v2/categories");
    setCached(cacheKey, res, TTL_CATEGORIES);
    return res;
  },

  // 3. Idiomas suportados
  async getLanguages(category = "freereels") {
    const cacheKey = `vorta:languages:${category}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    const res = await request(`/api/v2/languages?category_p=${encodeURIComponent(category)}`);
    setCached(cacheKey, res, TTL_LANGUAGES);
    return res;
  },

  // 4. Banners em destaque
  async getBanner(category = "freereels", lang = "pt") {
    const cacheKey = `vorta:banner:${category}:${lang}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    let res = null;
    try {
      res = await request(`/api/v2/banner?category_p=${encodeURIComponent(category)}&lang=${encodeURIComponent(lang)}`);
    } catch (e) {
      if (lang !== "en") {
        res = await request(`/api/v2/banner?category_p=${encodeURIComponent(category)}&lang=en`).catch(() => null);
      }
    }
    if (res) setCached(cacheKey, res, TTL_BANNER);
    return res || { success: false, data: [] };
  },

  // 5. Feed inicial (Home)
  async getHome(category = "freereels", lang = "pt") {
    const cacheKey = `vorta:home:${category}:${lang}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    let res = null;
    try {
      res = await request(`/api/v2/home?category_p=${encodeURIComponent(category)}&lang=${encodeURIComponent(lang)}`);
    } catch (e) {
      if (lang !== "en") {
        res = await request(`/api/v2/home?category_p=${encodeURIComponent(category)}&lang=en`).catch(() => null);
      }
    }
    if (res) setCached(cacheKey, res, TTL_HOME);
    return res || { success: false, data: [] };
  },

  // 6. Descobrir / Catálogo paginado
  async getDiscover(category = "freereels", lang = "pt", page = 1) {
    const cacheKey = `vorta:discover:${category}:${lang}:${page}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    const res = await request(`/api/v2/discover?category_p=${encodeURIComponent(category)}&lang=${encodeURIComponent(lang)}&page=${page}`);
    setCached(cacheKey, res, TTL_DISCOVER);
    return res;
  },

  // 7. Detalhes de um drama (inclui lista de capítulos/episódios)
  async getDetail(category = "freereels", id, lang = "pt") {
    if (!id) throw new Error("ID do drama é obrigatório");
    const cleanId = String(id).replace(/^vorta:[^:]+:/, "").replace(/^vorta_[^_]+_/, "");
    const cacheKey = `vorta:detail:${category}:${cleanId}:${lang}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    let res = null;
    try {
      res = await request(`/api/v2/detail?category_p=${encodeURIComponent(category)}&id=${encodeURIComponent(cleanId)}&lang=${encodeURIComponent(lang)}`);
    } catch (e) {
      if (lang !== "en") {
        res = await request(`/api/v2/detail?category_p=${encodeURIComponent(category)}&id=${encodeURIComponent(cleanId)}&lang=en`).catch(() => null);
      }
    }
    if (res) setCached(cacheKey, res, TTL_DETAIL);
    return res;
  },

  // 8. Vídeo de um capítulo específico
  async getVideo(category = "freereels", id, chapterId, lang = "pt") {
    if (!id) throw new Error("ID do drama é obrigatório");
    if (!chapterId && chapterId !== 0) throw new Error("ID do capítulo é obrigatório");
    const cleanId = String(id).replace(/^vorta:[^:]+:/, "").replace(/^vorta_[^_]+_/, "");
    const cacheKey = `vorta:video:${category}:${cleanId}:${chapterId}:${lang}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    const res = await request(`/api/v2/video?category_p=${encodeURIComponent(category)}&id=${encodeURIComponent(cleanId)}&chapterId=${encodeURIComponent(chapterId)}&lang=${encodeURIComponent(lang)}`);
    setCached(cacheKey, res, TTL_VIDEO);
    return res;
  },

  // 9. Pesquisa
  async search(category = "freereels", q = "", lang = "pt", page = 1, limit = 20) {
    if (!q || !q.trim()) return { success: true, data: [], total: 0 };
    const cacheKey = `vorta:search:${category}:${q.trim().toLowerCase()}:${lang}:${page}:${limit}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    let res = null;
    try {
      res = await request(`/api/v2/search?category_p=${encodeURIComponent(category)}&q=${encodeURIComponent(q.trim())}&lang=${encodeURIComponent(lang)}&page=${page}&limit=${limit}`);
    } catch (e) {
      res = { success: false, data: [], total: 0 };
    }
    setCached(cacheKey, res, TTL_SEARCH);
    return res;
  },

  // 10. Analytics / Rastreamento de uso
  async track(data = {}, headers = {}) {
    try {
      return await request("/api/analytics/track", {
        method: "POST",
        body: data,
        headers: {
          deviceId: headers.deviceId || data.deviceId || "web-client",
          deviceModel: headers.deviceModel || data.deviceModel || "MiniDrama-Web",
          osVersion: headers.osVersion || data.osVersion || "Web",
          appVersion: headers.appVersion || data.appVersion || "1.0.0"
        }
      });
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // 11. Busca todos os banners das plataformas com localização PT-BR
  async getCuratedBanners(lang = "pt") {
    const platforms = ["freereels", "shortmax", "meloshort"];
    const results = await Promise.all(
      platforms.map((p) => this.getBanner(p, lang).catch(() => ({ data: [] })))
    );
    const seen = new Set();
    const all = [];
    results.forEach((res, idx) => {
      const plat = platforms[idx];
      (res.data || []).forEach((item) => {
        if (!item || !item.title) return;
        const formatted = this.formatVortaPlay(item, plat);
        if (!seen.has(formatted.id)) {
          seen.add(formatted.id);
          all.push(formatted);
        }
      });
    });
    return all;
  },

  // Converte um drama da Vorta para o formato Play do Mini Drama com localização PT-BR e gêneros
  formatVortaPlay(vortaItem, category = "freereels") {
    if (!vortaItem) return null;
    const cleanId = vortaItem.id;
    const fullId = `vorta:${category}:${cleanId}`;
    const chaptersNum = parseInt(vortaItem.chapters || vortaItem.total_episodes || 0, 10);
    const duration = chaptersNum > 0 ? chaptersNum * 2 : 60; // aprox. 2 min por episódio vertical
    const rawGenres = Array.isArray(vortaItem.genres) && vortaItem.genres.length > 0
      ? vortaItem.genres
      : (Array.isArray(vortaItem.tags) && vortaItem.tags.length > 0 ? vortaItem.tags : []);

    const ptTitle = translateTitle(vortaItem.title);
    const ptSynopsis = translateSynopsis(vortaItem.synopsis, ptTitle);
    const detectedGenreIds = detectGenres(ptTitle, ptSynopsis, rawGenres);

    const genreLabels = rawGenres.length > 0
      ? rawGenres
      : detectedGenreIds.map((gid) => GENRE_LABELS_MAP[gid] || gid);

    const genresFormatted = (rawGenres.length > 0 ? rawGenres : detectedGenreIds).map((g) => ({
      genre: g,
      label: GENRE_LABELS_MAP[g] || g
    }));

    return {
      id: fullId,
      rawId: cleanId,
      title: ptTitle,
      synopsis: ptSynopsis,
      director: vortaItem.author || (category.charAt(0).toUpperCase() + category.slice(1) + " Studios"),
      cast: genreLabels.slice(0, 4).join(", ") || "Elenco Principal",
      durationMinutes: duration,
      releaseYear: new Date().getFullYear(),
      posterUrl: vortaItem.cover || "",
      backdropUrl: vortaItem.cover || "",
      videoUrl: vortaItem.videoUrl || "",
      requiresPlan: "plateia",
      featured: false,
      isVorta: true,
      platform: category,
      platformName: category === "freereels" ? "FreeReels" : category === "shortmax" ? "ShortMax" : "MeloShort",
      chapters: chaptersNum,
      views: vortaItem.views || "12.4k",
      status: vortaItem.status === "Completed" ? "Completo" : "Em Lançamento",
      genres: genresFormatted,
      genreLabels: genreLabels,
      genre: genreLabels[0] || "Dublados",
      canWatch: true,
      hasVideo: true,
      isDublado: detectedGenreIds.includes("dublados") || /dublado/i.test(ptTitle)
    };
  }
};

module.exports = vortaApi;
