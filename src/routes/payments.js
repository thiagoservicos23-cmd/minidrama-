const express = require("express");
const crypto = require("crypto");
const QRCode = require("qrcode");
const prisma = require("../prismaClient");
const syncpay = require("../services/syncpay");
const { verifyPayment, PLAN_DAYS } = require("../services/payments");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { isValidCpf, normalizePhone, onlyDigits } = require("../utils/cpf");
const { limit } = require("../utils/rateLimit");

const router = express.Router();
const PENDING_TTL_MS = 25 * 60000; // reaproveita um PIX recente em vez de gerar outro

function publicPayment(p) {
  return { id: p.id, planId: p.planId, amount: p.amount, status: p.status, createdAt: p.createdAt, paidAt: p.paidAt, validUntil: p.validUntil };
}
function baseUrl(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Cria a cobrança PIX. O navegador envia só "planId", CPF e telefone — o VALOR vem do banco.
router.post("/checkout", requireAuth, limit("checkout", 6, 10 * 60000), async (req, res) => {
  try {
    if (!syncpay.configured()) return res.status(503).json({ error: "Pagamentos ainda não estão ativos neste site." });
    const { planId, cpf, phone } = req.body || {};

    const plan = await prisma.plan.findUnique({ where: { id: String(planId || "") } });
    if (!plan) return res.status(400).json({ error: "Plano inválido." });
    if (!(plan.price >= 1)) return res.status(400).json({ error: "Este plano não precisa de pagamento." });
    if (!isValidCpf(cpf)) return res.status(400).json({ error: "CPF inválido. Confira os números." });
    const ph = normalizePhone(phone);
    if (!ph) return res.status(400).json({ error: "Informe um celular com DDD (ex.: 63 99999-9999)." });

    // Já existe um PIX recente e ainda pendente para este plano? Reaproveita (evita cobranças duplicadas).
    const existing = await prisma.payment.findFirst({
      where: { userId: req.user.id, planId: plan.id, status: "pending", createdAt: { gt: new Date(Date.now() - PENDING_TTL_MS) }, amount: plan.price },
      orderBy: { createdAt: "desc" }
    });
    if (existing && existing.pixCode) {
      const qr = await QRCode.toDataURL(existing.pixCode, { margin: 1, width: 300 });
      return res.json({ payment: publicPayment(existing), pixCode: existing.pixCode, qr, reused: true });
    }

    const secret = process.env.SYNCPAY_WEBHOOK_SECRET || "";
    const webhookUrl = `${baseUrl(req)}/api/payments/webhook/${secret}`;
    const charge = await syncpay.createPixCharge({
      amount: plan.price,
      description: `Mini Drama - Plano ${plan.name} (${PLAN_DAYS} dias)`,
      webhookUrl,
      client: { name: req.user.name, cpf: onlyDigits(cpf), email: req.user.email, phone: ph }
    });

    const payment = await prisma.payment.create({
      data: {
        userId: req.user.id, planId: plan.id, amount: plan.price, status: "pending",
        providerId: charge.identifier, pixCode: charge.pixCode, cpfMasked: "***.***.***-" + onlyDigits(cpf).slice(-2)
      }
    });
    const qr = await QRCode.toDataURL(charge.pixCode, { margin: 1, width: 300 });
    res.status(201).json({ payment: publicPayment(payment), pixCode: charge.pixCode, qr });
  } catch (e) {
    console.error("[checkout]", e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : "Não foi possível iniciar o pagamento. Tente novamente." });
  }
});

// Histórico do próprio usuário.
router.get("/mine", requireAuth, async (req, res) => {
  const list = await prisma.payment.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const plans = await prisma.plan.findMany();
  const names = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  res.json({ payments: list.map((p) => ({ ...publicPayment(p), planName: names[p.planId] || p.planId })) });
});

// Painel admin: todos os pagamentos (paginado).
router.get("/admin/list", requireAuth, requireAdmin, async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = 25;
  const where = req.query.status ? { status: String(req.query.status) } : {};
  const [rows, total, paidAgg] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { name: true, email: true } } } }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { status: "paid", paidAt: { gt: new Date(Date.now() - 30 * 86400000) } }, _sum: { amount: true }, _count: true })
  ]);
  const plans = await prisma.plan.findMany();
  const names = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  res.json({
    payments: rows.map((p) => ({ ...publicPayment(p), planName: names[p.planId] || p.planId, userName: p.user.name, userEmail: p.user.email })),
    total, page, totalPages: Math.max(Math.ceil(total / pageSize), 1),
    last30: { revenue: paidAgg._sum.amount || 0, count: paidAgg._count }
  });
});

// Webhook da SyncPay. NÃO confiamos no conteúdo: usamos só o identificador para pedir
// à SyncPay a confirmação oficial. Um webhook forjado, no máximo, dispara uma consulta inútil.
router.post("/webhook/:secret", async (req, res) => {
  const expected = process.env.SYNCPAY_WEBHOOK_SECRET || "";
  if (!expected || !safeEqual(req.params.secret, expected)) return res.status(404).end();
  try {
    const b = req.body || {};
    const id = b.id || b.identifier || b.reference_id || (b.data && (b.data.id || b.data.identifier));
    if (id) {
      const pay = await prisma.payment.findUnique({ where: { providerId: String(id) } });
      if (pay) await verifyPayment(pay.id, { force: true });
    }
  } catch (e) {
    console.error("[webhook]", e.message);
  }
  res.status(200).json({ ok: true }); // sempre 200 para a SyncPay não ficar reenviando
});

// Consulta de status feita pelo navegador (polling). Só o dono do pagamento vê.
router.get("/:id", requireAuth, async (req, res) => {
  const pay = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!pay || pay.userId !== req.user.id) return res.status(404).json({ error: "Pagamento não encontrado." });
  const updated = pay.status === "paid" ? pay : (await verifyPayment(pay.id)) || pay;
  res.json({ payment: publicPayment(updated) });
});

// O usuário desistiu. Se, mesmo assim, o PIX for pago, a confirmação da SyncPay ainda vale
// (dinheiro recebido = plano liberado), pois a conferência diária considera pagamentos cancelados.
router.post("/:id/cancel", requireAuth, async (req, res) => {
  const pay = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!pay || pay.userId !== req.user.id) return res.status(404).json({ error: "Pagamento não encontrado." });
  if (pay.status === "pending") await prisma.payment.update({ where: { id: pay.id }, data: { status: "canceled" } });
  res.json({ ok: true });
});

module.exports = router;
