const express = require("express");
const prisma = require("../prismaClient");
const mailer = require("../services/mailer");
const { validUnsubToken } = mailer;
const { requireAuth, requireAdmin } = require("../middleware/auth");
const T = require("../services/emailTemplates");
const { limit } = require("../utils/rateLimit");

const router = express.Router();

// Link de descadastro (vai em todo e-mail de divulgação). Funciona sem login, mas exige o token assinado.
router.get("/unsubscribe", async (req, res) => {
  const { u, t } = req.query;
  res.set("Content-Type", "text/html; charset=utf-8");
  if (!u || !validUnsubToken(String(u), t)) return res.status(400).send(page("Link inválido", "Este link de descadastro não é válido ou expirou."));
  await prisma.user.update({ where: { id: String(u) }, data: { emailOptOut: true } }).catch(() => {});
  res.send(page("Pronto, você saiu da lista", "Não vamos mais enviar e-mails de divulgação. Avisos importantes sobre a sua conta (como vencimento de plano e pagamentos) continuam chegando. <br><br><a href='/' style='color:#C9A24B'>Voltar ao Mini Drama</a>"));
});

// Admin: manda um e-mail de teste (modelo de boas-vindas) para o endereço informado, para validar a configuração.
router.post("/test", requireAuth, requireAdmin, limit("emailtest", 5, 60 * 60000), async (req, res) => {
  if (!mailer.configured()) return res.status(400).json({ error: "E-mail não configurado. Defina BREVO_API_KEY e MAIL_FROM_EMAIL nas variáveis de ambiente do servidor." });
  const to = String((req.body && req.body.to) || req.user.email).trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) return res.status(400).json({ error: "Digite um e-mail válido para receber o teste." });
  const tpl = T.welcome(req.user, null);
  const r = await mailer.sendMail({ to, toName: req.user.name, subject: "[TESTE] " + tpl.subject, html: tpl.html, text: tpl.text });
  if (!r.ok) return res.status(502).json({ error: "A Brevo recusou o envio (status " + (r.status || "?") + "). Confira se a chave de API está certa e se o remetente (MAIL_FROM_EMAIL) foi verificado na Brevo. Os Logs do Render têm a resposta detalhada ([email] Brevo recusou)." });
  res.json({ ok: true, message: "Enviado para " + to + ". Pode levar alguns minutos; confira também a caixa de spam." });
});

function page(title, msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;background:#120D0F;color:#F4ECE3;font-family:Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px">
<div style="max-width:420px;text-align:center"><h2 style="font-family:Georgia,serif">${title}</h2><p style="color:#B9A9A0;line-height:1.6">${msg}</p></div>`;
}

module.exports = router;
