const express = require("express");
const crypto = require("crypto");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Prepara um upload direto do navegador do admin para o Bunny.net Stream.
// O arquivo de vídeo NÃO passa pelo nosso servidor (evita estourar tempo/
// tamanho de requisição no Render) — ele vai direto do navegador pro Bunny,
// usando o protocolo TUS (upload retomável).
router.post("/create-upload", requireAuth, requireAdmin, async (req, res) => {
  try {
    const libraryId = process.env.BUNNY_LIBRARY_ID;
    const apiKey = process.env.BUNNY_API_KEY;
    const cdnHostname = process.env.BUNNY_CDN_HOSTNAME;

    if (!libraryId || !apiKey || !cdnHostname) {
      return res.status(500).json({
        error: "Upload de vídeo ainda não configurado no servidor. Peça para configurar BUNNY_LIBRARY_ID, BUNNY_API_KEY e BUNNY_CDN_HOSTNAME nas variáveis de ambiente."
      });
    }

    const title = (req.body && req.body.title && req.body.title.trim()) || "Peça sem título";

    // 1. Cria o "objeto" de vídeo dentro da biblioteca do Bunny.
    const createRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
      method: "POST",
      headers: { AccessKey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    const createData = await createRes.json().catch(() => null);
    if (!createRes.ok || !createData || !createData.guid) {
      console.error("Bunny create video failed:", createRes.status, createData);
      return res.status(502).json({ error: "Não foi possível criar o vídeo no Bunny.net. Confira as chaves configuradas." });
    }
    const videoGuid = createData.guid;

    // 2. Gera a assinatura de autorização do upload TUS (válida por 1 hora).
    const expiration = Math.floor(Date.now() / 1000) + 3600;
    const signature = crypto
      .createHash("sha256")
      .update(`${libraryId}${apiKey}${expiration}${videoGuid}`)
      .digest("hex");

    res.json({
      videoGuid,
      libraryId,
      signature,
      expiration,
      // URL final que já pode ser salva na peça — só vai funcionar de
      // verdade depois que o Bunny terminar de processar o vídeo enviado.
      playbackUrl: `https://${cdnHostname}/${videoGuid}/playlist.m3u8`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao preparar o upload do vídeo." });
  }
});

// Tenta transformar um link do Google Drive num link de download direto.
// Funciona bem para arquivos pequenos; para arquivos grandes o Google às vezes
// mostra uma tela de aviso em vez do arquivo — esse formato tenta contornar isso,
// mas não é 100% garantido (depende do comportamento do Google no momento).
function toDirectDownloadUrl(url) {
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) {
    const fileId = m[1];
    return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  }
  return url; // não é link do Drive: usa como veio (link direto .mp4, etc.)
}

// Pede para o BUNNY (não para o nosso servidor) baixar o vídeo direto de uma URL.
// Muito mais rápido que upload manual, porque não depende da internet do usuário.
router.post("/fetch-from-url", requireAuth, requireAdmin, async (req, res) => {
  try {
    const libraryId = process.env.BUNNY_LIBRARY_ID;
    const apiKey = process.env.BUNNY_API_KEY;
    const cdnHostname = process.env.BUNNY_CDN_HOSTNAME;
    if (!libraryId || !apiKey || !cdnHostname) {
      return res.status(500).json({ error: "Upload de vídeo ainda não configurado no servidor (variáveis BUNNY_*)." });
    }
    const rawUrl = (req.body && req.body.url && req.body.url.trim()) || "";
    if (!rawUrl) return res.status(400).json({ error: "Cole um link de vídeo." });
    const title = (req.body && req.body.title && req.body.title.trim()) || "Peça sem título";

    const directUrl = toDirectDownloadUrl(rawUrl);
    const marker = crypto.randomBytes(4).toString("hex");
    const bunnyTitle = `${title} #${marker}`;

    const fetchRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/fetch`, {
      method: "POST",
      headers: { AccessKey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ url: directUrl, title: bunnyTitle })
    });
    const fetchData = await fetchRes.json().catch(() => null);
    if (!fetchRes.ok || (fetchData && fetchData.success === false)) {
      console.error("Bunny fetch failed:", fetchRes.status, fetchData);
      return res.status(422).json({ error: (fetchData && fetchData.message) || "O Bunny não conseguiu buscar esse link. Confira se ele é público e tente outro formato de link." });
    }

    res.json({ marker, bunnyTitle });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao pedir a importação do vídeo." });
  }
});

// Depois de pedir a importação, o navegador chama isso de tempos em tempos
// para descobrir se o vídeo já apareceu na biblioteca (e pegar sua URL final).
router.get("/resolve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const libraryId = process.env.BUNNY_LIBRARY_ID;
    const apiKey = process.env.BUNNY_API_KEY;
    const cdnHostname = process.env.BUNNY_CDN_HOSTNAME;
    const marker = (req.query.marker || "").trim();
    if (!marker) return res.status(400).json({ error: "Faltou o marcador de busca." });

    const listRes = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos?search=${encodeURIComponent(marker)}&itemsPerPage=5&orderBy=date`,
      { headers: { AccessKey: apiKey, Accept: "application/json" } }
    );
    const listData = await listRes.json().catch(() => null);
    const found = listData && Array.isArray(listData.items) && listData.items.find(v => (v.title || "").includes(marker));
    if (!found) return res.json({ found: false });

    res.json({
      found: true,
      videoGuid: found.guid,
      playbackUrl: `https://${cdnHostname}/${found.guid}/playlist.m3u8`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao consultar o status da importação." });
  }
});

module.exports = router;
