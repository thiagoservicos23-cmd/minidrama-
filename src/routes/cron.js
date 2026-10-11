const express = require("express");
const crypto = require("crypto");
const { runDaily } = require("../services/emailJobs");
const { reconcile } = require("../services/payments");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const prisma = require("../prismaClient");

const router = express.Router();

async function cleanup() {
  try { await prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400000) } } }); } catch (e) { /* não é crítico */ }
}

function authorized(req) {
  const expected = process.env.CRON_SECRET || "";
  const given = req.get("x-cron-key") || req.query.key || "";
  if (!expected || !given) return false;
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Chamado 1x por dia por um agendador externo gratuito (cron-job.org). Também acorda o servidor.
router.all("/daily", async (req, res) => {
  if (!authorized(req)) return res.status(404).end();
  try {
    await cleanup();
    const pagamentos = await reconcile();
    const emails = await runDaily();
    res.json({ ok: true, pagamentos, emails });
  } catch (e) {
    console.error("[cron]", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin: roda a mesma rotina manualmente (útil para testar sem esperar o agendador).
router.post("/run-now", requireAuth, requireAdmin, async (req, res) => {
  try {
    const pagamentos = await reconcile();
    const emails = await runDaily();
    res.json({ ok: true, pagamentos, emails });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
