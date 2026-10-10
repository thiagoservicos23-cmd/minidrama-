// Limitador simples em memória (suficiente para 1 servidor). Evita abuso de rotas sensíveis.
const buckets = new Map();

function hit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// Middleware: limita por IP (ou por usuário, se já autenticado).
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const who = (req.user && req.user.id) || req.ip;
    if (!hit(`${name}:${who}`, max, windowMs)) {
      return res.status(429).json({ error: "Muitas tentativas. Aguarde um pouco e tente de novo." });
    }
    next();
  };
}

setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600000)) buckets.delete(k); }, 600000).unref();

function _resetForTests() { buckets.clear(); }

module.exports = { limit, hit, _resetForTests };
