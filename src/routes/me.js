const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth } = require("../middleware/auth");
const { PLAY_LIST_SELECT } = require("../utils/images");
const { withAccess } = require("../utils/playAccess");
const { loadLabels } = require("../utils/genres");
const { limit } = require("../utils/rateLimit");

const router = express.Router();
router.use(requireAuth);
router.use(async (req, res, next) => { await loadLabels(); next(); });

const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error("[me]", req.method, req.path, e && e.message);
  if (!res.headersSent) res.status(500).json({ error: "Não foi possível concluir agora. Tente novamente." });
});
const MAX_LIST = 500;

async function playsInOrder(user, ids) {
  if (!ids.length) return [];
  const rows = await prisma.play.findMany({ where: { id: { in: ids } }, select: PLAY_LIST_SELECT });
  const byId = new Map(rows.map((p) => [p.id, p]));
  return Promise.all(ids.filter((id) => byId.has(id)).map((id) => withAccess(user, byId.get(id))));
}

// Dados da página inicial da pessoa: "Continue Assistindo" + quais séries estão na Minha Lista.
router.get("/home", safe(async (req, res) => {
  const rows = await prisma.watchProgress.findMany({ where: { userId: req.user.id }, orderBy: { updatedAt: "desc" }, take: 30 });
  const active = rows.filter((r) => r.duration > 0 && r.position >= 5 && r.position / r.duration < 0.95).slice(0, 20);
  const plays = await playsInOrder(req.user, active.map((r) => r.playId));
  const byId = new Map(plays.map((p) => [p.id, p]));
  const cont = active.filter((r) => byId.has(r.playId)).map((r) => ({
    ...byId.get(r.playId), progress: { position: r.position, duration: r.duration, updatedAt: r.updatedAt }
  }));
  const list = await prisma.myListItem.findMany({ where: { userId: req.user.id }, select: { playId: true } });
  res.json({ continue: cont, listIds: list.map((x) => x.playId) });
}));

// Salva onde a pessoa parou. Chamado de tempos em tempos pelo player.
router.put("/progress/:playId", limit("progress", 180, 60000), safe(async (req, res) => {
  const b = req.body || {};
  const position = Math.floor(Number(b.position)), duration = Math.floor(Number(b.duration));
  if (![position, duration].every(Number.isFinite) || duration < 60 || duration > 172800 || position < 0 || position > duration + 5) {
    return res.status(400).json({ error: "Dados de progresso inválidos." });
  }
  const where = { userId_playId: { userId: req.user.id, playId: req.params.playId } };
  if (position / duration >= 0.95) {                      // terminou: sai do "Continue Assistindo"
    await prisma.watchProgress.deleteMany({ where: { userId: req.user.id, playId: req.params.playId } });
    return res.json({ ok: true, finished: true });
  }
  if (position < 5) return res.json({ ok: true, ignored: true });
  const play = await prisma.play.findUnique({ where: { id: req.params.playId }, select: { id: true } });
  if (!play) return res.status(404).json({ error: "Série não encontrada." });
  await prisma.watchProgress.upsert({ where, update: { position, duration }, create: { userId: req.user.id, playId: req.params.playId, position, duration } });
  res.json({ ok: true });
}));

router.delete("/progress/:playId", safe(async (req, res) => {
  await prisma.watchProgress.deleteMany({ where: { userId: req.user.id, playId: req.params.playId } });
  res.json({ ok: true });
}));

// Minha Lista
router.get("/list", safe(async (req, res) => {
  const items = await prisma.myListItem.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: MAX_LIST });
  res.json({ plays: await playsInOrder(req.user, items.map((i) => i.playId)) });
}));

router.put("/list/:playId", limit("mylist", 120, 60000), safe(async (req, res) => {
  const play = await prisma.play.findUnique({ where: { id: req.params.playId }, select: { id: true } });
  if (!play) return res.status(404).json({ error: "Série não encontrada." });
  const where = { userId_playId: { userId: req.user.id, playId: play.id } };
  const exists = await prisma.myListItem.findUnique({ where });
  if (!exists) {
    if ((await prisma.myListItem.count({ where: { userId: req.user.id } })) >= MAX_LIST) return res.status(400).json({ error: "Sua lista chegou ao limite de " + MAX_LIST + " séries." });
    await prisma.myListItem.create({ data: { userId: req.user.id, playId: play.id } });
  }
  res.json({ ok: true });
}));

router.delete("/list/:playId", safe(async (req, res) => {
  await prisma.myListItem.deleteMany({ where: { userId: req.user.id, playId: req.params.playId } });
  res.json({ ok: true });
}));

module.exports = router;
