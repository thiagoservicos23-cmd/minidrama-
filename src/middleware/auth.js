const prisma = require("../prismaClient");
const { verifyToken } = require("../utils/jwt");

function getTokenFromHeader(req) {
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");
  return token || null;
}

// Preenche req.user quando existe um token válido, mas NÃO bloqueia a
// requisição se não houver token — usado em rotas públicas que mudam
// de comportamento conforme o visitante estar logado ou não.
async function attachUserIfPresent(req, res, next) {
  try {
    const token = getTokenFromHeader(req);
    if (!token) { req.user = null; return next(); }
    const payload = verifyToken(token);
    if (!payload) { req.user = null; return next(); }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    req.user = user || null;
    next();
  } catch (e) {
    req.user = null;
    next();
  }
}

// Exige um usuário autenticado válido.
async function requireAuth(req, res, next) {
  await attachUserIfPresent(req, res, () => {});
  if (!req.user) return res.status(401).json({ error: "Não autenticado. Faça login novamente." });
  if (req.user.status === "bloqueado") return res.status(403).json({ error: "Sua conta está bloqueada." });
  next();
}

// Exige que o usuário autenticado seja administrador.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Acesso restrito à administração." });
  }
  next();
}

module.exports = { attachUserIfPresent, requireAuth, requireAdmin };
