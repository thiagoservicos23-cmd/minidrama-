const prisma = require("../prismaClient");
const syncpay = require("./syncpay");

const DAY = 24 * 60 * 60 * 1000;
const PLAN_DAYS = 30;

// ---------------------------------------------------------------------------
// REGRA DE OURO: o plano só é liberado aqui, e só depois que a SyncPay confirma
// (consulta feita pelo NOSSO servidor, autenticada) que a transação está "completed"
// e que o valor pago corresponde ao valor que NÓS gravamos. Nada que venha do
// navegador ou do corpo de um webhook é aceito como prova de pagamento.
// ---------------------------------------------------------------------------
async function verifyPayment(paymentId, { force = false } = {}) {
  const pay = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!pay) return null;
  if (pay.status === "paid") return pay;

  // Evita martelar a SyncPay: no máximo 1 consulta a cada 4s por pagamento.
  if (!force && pay.lastCheckAt && Date.now() - new Date(pay.lastCheckAt).getTime() < 4000) return pay;
  await prisma.payment.update({ where: { id: pay.id }, data: { lastCheckAt: new Date() } });

  let tx;
  try {
    tx = await syncpay.getTransaction(pay.providerId);
  } catch (e) {
    console.error("[pagamento] consulta falhou:", e.message);
    return pay; // na dúvida, NÃO libera
  }
  if (!tx) return pay;

  const status = String(tx.status || "").toLowerCase();
  const paidEnough = Number(tx.amount) + 0.009 >= pay.amount;
  const currencyOk = !tx.currency || String(tx.currency).toUpperCase() === "BRL";
  if (status === "completed" && paidEnough && currencyOk) {
    return activate(pay, tx.paid_at);
  }
  return pay;
}

async function activate(pay, providerPaidAt) {
  // Usa a data informada pela SyncPay se for plausível (últimas 48h); senão, agora.
  let paidAt = new Date();
  const pa = providerPaidAt ? new Date(providerPaidAt) : null;
  if (pa && !isNaN(pa) && pa.getTime() <= Date.now() + 60000 && Date.now() - pa.getTime() < 2 * DAY) paidAt = pa;

  const validUntil = await prisma.$transaction(async (tx) => {
    // "Reivindica" o pagamento de forma atômica: se duas requisições chegarem juntas
    // (webhook + consulta do navegador), só uma passa — a outra vê count = 0.
    const claimed = await tx.payment.updateMany({ where: { id: pay.id, status: { not: "paid" } }, data: { status: "paid", paidAt } });
    if (claimed.count === 0) return null;

    const user = await tx.user.findUnique({ where: { id: pay.userId } });
    // Renovação antecipada do MESMO plano soma aos dias que sobraram; outro plano conta a partir de hoje.
    let base = paidAt;
    if (user.plan === pay.planId && new Date(user.planExpiry) > paidAt) base = new Date(user.planExpiry);
    const until = new Date(base.getTime() + PLAN_DAYS * DAY);

    await tx.user.update({ where: { id: user.id }, data: { plan: pay.planId, planExpiry: until } });
    await tx.payment.update({ where: { id: pay.id }, data: { validUntil: until } });
    return until;
  });

  const fresh = await prisma.payment.findUnique({ where: { id: pay.id } });
  if (validUntil) notifyPaid(fresh).catch((e) => console.error("[email] pagamento:", e.message));
  return fresh;
}

async function notifyPaid(payment) {
  const { sendPaymentConfirmed } = require("./emailJobs");
  const user = await prisma.user.findUnique({ where: { id: payment.userId } });
  const plan = await prisma.plan.findUnique({ where: { id: payment.planId } });
  if (user && plan) await sendPaymentConfirmed(user, payment, plan.name);
}

// Rotina diária: confere pagamentos recentes que ainda não foram confirmados (ex.: o webhook
// não chegou porque o servidor estava dormindo) e marca como expirados os pendentes antigos.
async function reconcile() {
  const since = new Date(Date.now() - 2 * DAY);
  const open = await prisma.payment.findMany({
    where: { status: { in: ["pending", "expired", "canceled"] }, createdAt: { gt: since } },
    orderBy: { createdAt: "desc" }, take: 60
  });
  let confirmed = 0;
  for (const p of open) {
    const r = await verifyPayment(p.id, { force: true });
    if (r && r.status === "paid") confirmed++;
  }
  const expired = await prisma.payment.updateMany({
    where: { status: "pending", createdAt: { lt: new Date(Date.now() - 60 * 60000) } }, data: { status: "expired" }
  });
  return { verificados: open.length, confirmados: confirmed, expirados: expired.count };
}

module.exports = { verifyPayment, reconcile, PLAN_DAYS };
