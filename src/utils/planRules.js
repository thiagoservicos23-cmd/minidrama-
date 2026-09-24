const prisma = require("../prismaClient");

// Retorna a lista de planos ordenada por "sortOrder" (define hierarquia: Plateia < Balcão < Camarote...)
async function getOrderedPlans() {
  return prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
}

async function getPlanLevel(planId) {
  const plans = await getOrderedPlans();
  const idx = plans.findIndex((p) => p.id === planId);
  return idx < 0 ? 0 : idx;
}

function isPlanActive(user) {
  if (!user) return false;
  if (user.plan === "plateia") return true;
  return new Date(user.planExpiry) > new Date();
}

// Decide se um usuário (ou visitante anônimo) pode assistir a uma peça.
async function userCanWatch(user, play) {
  if (!user) {
    const level = await getPlanLevel(play.requiresPlan);
    return level === 0; // apenas conteúdo do plano gratuito é público
  }
  if (user.role === "admin") return true;
  if (user.status === "bloqueado") return false;
  const requiredLevel = await getPlanLevel(play.requiresPlan);
  if (!isPlanActive(user)) return requiredLevel === 0;
  const userLevel = await getPlanLevel(user.plan);
  return userLevel >= requiredLevel;
}

module.exports = { getOrderedPlans, getPlanLevel, isPlanActive, userCanWatch };
