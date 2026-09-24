const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

function publicUser(u) {
  const { password, ...rest } = u;
  return rest;
}

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ users: users.map(publicUser) });
});

// Atualiza plano, validade ou status de um usuário. Usado pelo painel admin
// para: trocar o plano de alguém, estender a validade em 30 dias, ou
// bloquear/desbloquear o acesso.
router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "Usuário não encontrado." });
    if (target.role === "admin") return res.status(400).json({ error: "Contas administrativas são protegidas." });

    const b = req.body || {};
    const data = {};

    if (b.plan) {
      data.plan = b.plan;
      data.planExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    if (b.extendDays) {
      const base = new Date(target.planExpiry) > new Date() ? new Date(target.planExpiry) : new Date();
      base.setDate(base.getDate() + parseInt(b.extendDays, 10));
      data.planExpiry = base;
    }
    if (b.status && ["ativo", "bloqueado"].includes(b.status)) {
      data.status = b.status;
    }

    const user = await prisma.user.update({ where: { id: req.params.id }, data });
    res.json({ user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível atualizar o usuário." });
  }
});

module.exports = router;
