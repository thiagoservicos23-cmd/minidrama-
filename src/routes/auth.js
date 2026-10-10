const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../prismaClient");
const { signToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const { limit } = require("../utils/rateLimit");

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
    await prisma.user.update({ where: { id: req.user.id }, data: { password: await bcrypt.hash(newPassword, 10) } });
    res.json({ ok: true });
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

module.exports = router;
