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

module.exports = router;
