const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../prismaClient");
const { signToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

router.post("/signup", async (req, res) => {
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível criar a conta. Tente novamente." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Informe e-mail e senha." });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.status(401).json({ error: "E-mail ou senha incorretos." });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "E-mail ou senha incorretos." });
    if (user.status === "bloqueado") return res.status(403).json({ error: "Esta conta está bloqueada. Fale com a administração." });

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível entrar. Tente novamente." });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
