const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../prismaClient");
const { signToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const { limit, hit } = require("../utils/rateLimit");
const mailer = require("../services/mailer");
const T = require("../services/emailTemplates");

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const RESET_MINUTES = 60;

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

router.post("/signup", limit("signup", 8, 60 * 60000), async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Informe seu nome." });
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "E-mail inválido." });
    if (!password || password.length < 6) return res.status(400).json({ error: "A senha precisa ter ao menos 6 caracteres." });

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) return res.status(409).json({ error: "Já existe uma conta com este e-mail." });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hash,
        role: "user",
        plan: "plateia",
        planExpiry: new Date(),
        status: "ativo"
      }
    });
    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
    // E-mail de boas-vindas em segundo plano (não atrasa nem derruba o cadastro se falhar).
    try { require("../services/emailJobs").sendWelcome(user).catch((e) => console.error("[email] boas-vindas:", e.message)); } catch (e) { /* e-mail não configurado */ }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível criar a conta. Tente novamente." });
  }
});

router.post("/login", limit("login", 15, 10 * 60000), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Informe e-mail e senha." });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.status(401).json({ error: "E-mail ou senha incorretos." });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "E-mail ou senha incorretos." });
    if (user.status === "bloqueado") return res.status(403).json({ error: "Esta conta está bloqueada. Fale com a administração." });

    await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível entrar. Tente novamente." });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  // Registra a "última visita" (usada pelo e-mail de saudade), no máximo 1x por hora.
  if (!req.user.lastSeenAt || Date.now() - new Date(req.user.lastSeenAt).getTime() > 3600000) {
    prisma.user.update({ where: { id: req.user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  res.json({ user: publicUser(req.user) });
});

// Trocar a própria senha (exige a senha atual).
router.post("/change-password", requireAuth, limit("chgpw", 10, 60 * 60000), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "A nova senha precisa ter pelo menos 8 caracteres." });
    const ok = await bcrypt.compare(String(currentPassword || ""), req.user.password);
    if (!ok) return res.status(400).json({ error: "A senha atual está incorreta." });
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { password: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date() } });
    notifyPasswordChanged(user);
    // Os outros logins deixam de valer; este aparelho recebe um novo para continuar conectado.
    res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível alterar a senha." });
  }
});

// Preferência de receber (ou não) e-mails de divulgação.
router.patch("/preferences", requireAuth, async (req, res) => {
  const optOut = !!(req.body && req.body.emailOptOut);
  const user = await prisma.user.update({ where: { id: req.user.id }, data: { emailOptOut: optOut } });
  res.json({ user: publicUser(user) });
});

function notifyPasswordChanged(user) {
  if (!mailer.configured()) return;
  const tpl = T.passwordChanged(user);
  mailer.sendMail({ to: user.email, toName: user.name, subject: tpl.subject, html: tpl.html, text: tpl.text }).catch(() => {});
}

// "Esqueci minha senha": manda um link por e-mail. A resposta é SEMPRE a mesma, exista a conta ou não
// (e é enviada antes de qualquer trabalho), para ninguém descobrir quem tem cadastro no site.
router.post("/forgot-password", limit("forgot", 8, 60 * 60000), async (req, res) => {
  const generic = { ok: true, message: "Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 60 minutos. Confira também o spam." };
  if (!mailer.configured()) return res.status(503).json({ error: "A recuperação de senha por e-mail ainda não está ativa neste site. Fale com a administração." });
  const email = String((req.body && req.body.email) || "").toLowerCase().trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Informe um e-mail válido." });
  res.json(generic);
  try {
    if (!hit("forgot-email:" + email, 3, 60 * 60000)) return;   // no máximo 3 e-mails por hora para o mesmo endereço (evita encher a caixa de alguém)
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status === "bloqueado") return;
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } });   // só o link mais recente vale
    await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60000) } });
    const tpl = T.resetPassword(user, `${mailer.siteUrl()}/#/redefinir-senha?token=${token}`);
    await mailer.sendMail({ to: user.email, toName: user.name, subject: tpl.subject, html: tpl.html, text: tpl.text });
  } catch (e) {
    console.error("[recuperação de senha]", e.message);
  }
});

// Define a nova senha com o token do e-mail. O token é de uso único e expira.
router.post("/reset-password", limit("reset", 10, 60 * 60000), async (req, res) => {
  const { token, newPassword } = req.body || {};
  const invalid = { error: "Este link é inválido ou já expirou. Peça um novo em “Esqueci minha senha”." };
  if (typeof token !== "string" || token.length < 20) return res.status(400).json(invalid);
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: "A nova senha precisa ter pelo menos 8 caracteres." });
  try {
    const rec = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!rec || rec.usedAt || new Date(rec.expiresAt) < new Date()) return res.status(400).json(invalid);

    const hash = await bcrypt.hash(String(newPassword), 10);
    let user = null;
    const claimed = await prisma.$transaction(async (tx) => {
      // "Reivindica" o link de forma atômica: se duas pessoas usarem ao mesmo tempo, só uma passa.
      const c = await tx.passwordReset.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
      if (c.count === 0) return false;
      user = await tx.user.update({ where: { id: rec.userId }, data: { password: hash, passwordChangedAt: new Date() } });
      await tx.passwordReset.deleteMany({ where: { userId: rec.userId, usedAt: null } });
      return true;
    });
    if (!claimed) return res.status(400).json(invalid);
    notifyPasswordChanged(user);
    res.json({ ok: true });
  } catch (e) {
    console.error("[reset-password]", e.message);
    res.status(500).json({ error: "Não foi possível alterar a senha. Tente de novo." });
  }
});

module.exports = router;
