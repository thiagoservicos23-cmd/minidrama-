const prisma = require("../prismaClient");
const mailer = require("./mailer");
const T = require("./emailTemplates");
const { userCanWatch } = require("../utils/planRules");
const { PLAY_LIST_SELECT, publicPlay } = require("../utils/images");

const DAY = 24 * 60 * 60 * 1000;
const dailyLimit = () => parseInt(process.env.EMAIL_DAILY_LIMIT, 10) || 250; // plano grátis da Brevo: 300/dia

let running = false;

// ---------------------------------------------------------------------------
// Envio com "reserva" anti-duplicidade: grava o registro ANTES de enviar (chave única
// por usuário+tipo+chave). Se o envio falhar, apaga o registro para tentar de novo depois.
async function sendOnce(user, type, key, tpl, budget) {
  if (!mailer.configured()) return false;
  if (budget && budget.left <= 0) return false;
  let log;
  try {
    log = await prisma.emailLog.create({ data: { userId: user.id, type, key } });
  } catch (e) {
    return false; // já enviado antes (violação da chave única)
  }
  const marketing = ["digest", "missyou", "featured"].includes(type);
  const result = await mailer.sendMail({
    to: user.email, toName: user.name, subject: tpl.subject, html: tpl.html, text: tpl.text,
    unsubscribeLink: marketing ? mailer.unsubscribeUrl(user.id) : undefined
  });
  if (!result.ok) {
    await prisma.emailLog.delete({ where: { id: log.id } }).catch(() => {});
    return false;
  }
  if (budget) budget.left--;
  return true;
}

async function newBudget() {
  const since = new Date(Date.now() - DAY);
  const used = await prisma.emailLog.count({ where: { sentAt: { gt: since }, type: { not: "baseline" } } });
  return { left: Math.max(dailyLimit() - used, 0) };
}

async function plansInfo() {
  const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
  const byId = Object.fromEntries(plans.map((p) => [p.id, p]));
  const freeIds = new Set(plans.filter((p) => p.price === 0).map((p) => p.id));
  const cheapestPaid = plans.filter((p) => p.price > 0).sort((a, b) => a.price - b.price)[0];
  return { plans, byId, freeIds, cheapestPaid };
}

// ---------------------------------------------------------------------------
// Chamados por eventos
async function sendWelcome(user) {
  const { cheapestPaid } = await plansInfo();
  return sendOnce(user, "welcome", "once", T.welcome(user, cheapestPaid));
}

async function sendPaymentConfirmed(user, payment, planName) {
  return sendOnce(user, "payment", payment.id, T.payment(user, planName, payment.amount, payment.validUntil));
}

// ---------------------------------------------------------------------------
// Na primeira execução, marca as obras que JÁ estavam em destaque como "anunciadas",
// para não mandar e-mail em massa sobre coisas antigas. Só roda uma vez na vida.
async function ensureBaseline() {
  const done = await prisma.emailLog.findFirst({ where: { type: "baseline" } });
  if (done) return;
  await prisma.play.updateMany({ where: { featured: true, announcedAt: null }, data: { announcedAt: new Date() } });
  await prisma.emailLog.create({ data: { userId: "system", type: "baseline", key: "featured-v1" } }).catch(() => {});
}

// Avisa todos os usuários sobre obras que acabaram de entrar no banner da home.
async function sendFeaturedAnnouncements(sharedBudget) {
  if (!mailer.configured()) return 0;
  await ensureBaseline();
  const plays = await prisma.play.findMany({
    where: { featured: true, announcedAt: null }, orderBy: { createdAt: "desc" }, take: 3, select: PLAY_LIST_SELECT
  });
  if (!plays.length) return 0;

  const budget = sharedBudget || await newBudget();
  const { byId } = await plansInfo();
  const users = await prisma.user.findMany({ where: { role: "user", status: "ativo", emailOptOut: false } });
  let sent = 0;

  for (const raw of plays) {
    const play = publicPlay(raw);
    let pending = 0;
    for (const user of users) {
      if (budget.left <= 0) { pending++; continue; }
      const canWatch = await userCanWatch(user, raw);
      const ok = await sendOnce(user, "featured", raw.id, T.featured(user, play, canWatch, (byId[raw.requiresPlan] || {}).name || "Premium"), budget);
      if (ok) sent++;
    }
    // Só marca como "anunciada" quando todos já foram atendidos; senão continua amanhã.
    if (pending === 0) await prisma.play.update({ where: { id: raw.id }, data: { announcedAt: new Date() } });
  }
  return sent;
}

// ---------------------------------------------------------------------------
async function sendExpiryNotices(budget) {
  const { byId, freeIds } = await plansInfo();
  const now = Date.now();
  const users = await prisma.user.findMany({
    where: { role: "user", status: "ativo", planExpiry: { gt: new Date(now - 3 * DAY), lt: new Date(now + 3 * DAY + 3600000) } }
  });
  let sent = 0;
  for (const u of users) {
    if (freeIds.has(u.plan)) continue;
    const plan = byId[u.plan];
    if (!plan) continue;
    const expiry = new Date(u.planExpiry);
    const key = expiry.toISOString().slice(0, 10);
    if (expiry.getTime() > now) {
      const daysLeft = Math.ceil((expiry.getTime() - now) / DAY);
      if (daysLeft >= 1 && daysLeft <= 3 && await sendOnce(u, `expiry-${daysLeft}`, key, T.expiry(u, daysLeft, plan.name, expiry), budget)) sent++;
    } else if (await sendOnce(u, "expired", key, T.expired(u, plan.name), budget)) sent++;
  }
  return sent;
}

async function sendMissYou(budget) {
  const cutoff = new Date(Date.now() - 7 * DAY);
  const users = await prisma.user.findMany({
    where: { role: "user", status: "ativo", emailOptOut: false, lastSeenAt: { lt: cutoff }, OR: [{ lastMissYouAt: null }, { lastMissYouAt: { lt: cutoff } }] }
  });
  if (!users.length) return 0;
  const plays = (await prisma.play.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: PLAY_LIST_SELECT })).map(publicPlay);
  if (!plays.length) return 0;
  let sent = 0;
  const day = new Date().toISOString().slice(0, 10);
  for (const u of users) {
    if (await sendOnce(u, "missyou", day, T.missYou(u, plays), budget)) {
      await prisma.user.update({ where: { id: u.id }, data: { lastMissYouAt: new Date() } });
      sent++;
    }
  }
  return sent;
}

async function sendDigests(budget) {
  const now = Date.now();
  const users = await prisma.user.findMany({
    where: { role: "user", status: "ativo", emailOptOut: false, OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: new Date(now - 20 * 3600000) } }] }
  });
  if (!users.length) return 0;
  // Quem já recebeu outra divulgação nas últimas 20h não recebe o resumo hoje (evita e-mail demais).
  const recent = await prisma.emailLog.findMany({
    where: { sentAt: { gt: new Date(now - 20 * 3600000) }, type: { in: ["featured", "missyou"] } }, select: { userId: true }
  });
  const skip = new Set(recent.map((r) => r.userId));
  const day = new Date().toISOString().slice(0, 10);
  let sent = 0;
  for (const u of users) {
    if (skip.has(u.id)) continue;
    const since = u.lastDigestAt || u.createdAt;
    const where = { createdAt: { gt: since } };
    const count = await prisma.play.count({ where });
    if (count === 0) continue; // sem novidade: não manda e-mail vazio (e o contador segue acumulando)
    const latest = (await prisma.play.findMany({ where, orderBy: { createdAt: "desc" }, take: 4, select: PLAY_LIST_SELECT })).map(publicPlay);
    if (await sendOnce(u, "digest", day, T.digest(u, count, latest), budget)) {
      await prisma.user.update({ where: { id: u.id }, data: { lastDigestAt: new Date() } });
      sent++;
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Rotina diária (chamada por /api/cron/daily). Prioridade quando o limite diário aperta:
// avisos de vencimento > novas obras em destaque > saudade > resumo.
async function runDaily() {
  if (running) return { skipped: "já em execução" };
  if (!mailer.configured()) return { skipped: "e-mail não configurado (BREVO_API_KEY / MAIL_FROM_EMAIL)" };
  running = true;
  try {
    const budget = await newBudget();
    const summary = {};
    summary.vencimentos = await sendExpiryNotices(budget);
    summary.destaques = await sendFeaturedAnnouncements(budget);
    summary.saudade = await sendMissYou(budget);
    summary.resumos = await sendDigests(budget);
    summary.limiteRestante = budget.left;
    return summary;
  } finally {
    running = false;
  }
}

module.exports = { sendWelcome, sendPaymentConfirmed, sendFeaturedAnnouncements, runDaily, ensureBaseline };
