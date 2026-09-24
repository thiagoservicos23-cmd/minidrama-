const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { getOrderedPlans } = require("../utils/planRules");

const router = express.Router();

function serialize(plan) {
  let benefits = [];
  try { benefits = JSON.parse(plan.benefits); } catch (e) { benefits = []; }
  return { ...plan, benefits };
}

router.get("/", async (req, res) => {
  const plans = await getOrderedPlans();
  res.json({ plans: plans.map(serialize) });
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.name.trim()) return res.status(400).json({ error: "Informe o nome do plano." });
    const count = await prisma.plan.count();
    const id = b.id || b.name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
    const plan = await prisma.plan.create({
      data: {
        id,
        name: b.name.trim(),
        price: parseFloat(b.price) || 0,
        periodicity: parseFloat(b.price) > 0 ? "por mês" : "grátis",
        benefits: JSON.stringify(Array.isArray(b.benefits) ? b.benefits : []),
        featured: !!b.featured,
        sortOrder: count
      }
    });
    res.status(201).json({ plan: serialize(plan) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Não foi possível criar o plano (talvez já exista um com esse nome)." });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const plan = await prisma.plan.update({
      where: { id: req.params.id },
      data: {
        name: b.name,
        price: b.price !== undefined ? parseFloat(b.price) : undefined,
        periodicity: b.price !== undefined ? (parseFloat(b.price) > 0 ? "por mês" : "grátis") : undefined,
        benefits: Array.isArray(b.benefits) ? JSON.stringify(b.benefits) : undefined,
        featured: typeof b.featured === "boolean" ? b.featured : undefined
      }
    });
    res.json({ plan: serialize(plan) });
  } catch (e) {
    res.status(404).json({ error: "Plano não encontrado." });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const usersOnPlan = await prisma.user.count({ where: { plan: req.params.id } });
    if (usersOnPlan > 0) return res.status(400).json({ error: "Existem usuários neste plano. Migre-os antes de excluir." });
    await prisma.plan.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: "Plano não encontrado." });
  }
});

module.exports = router;
