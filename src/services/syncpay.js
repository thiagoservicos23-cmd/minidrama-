// Cliente da API pública da SyncPay (https://syncpay.apidog.io).
// As credenciais ficam SÓ no servidor (variáveis de ambiente) — nunca no navegador.
const BASE = "https://api.syncpayments.com.br/api/partner";

let cachedToken = { value: null, expiresAt: 0 };

function configured() {
  return !!(process.env.SYNCPAY_CLIENT_ID && process.env.SYNCPAY_CLIENT_SECRET);
}

async function http(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { res, data };
}

// O token vale 1 hora: reaproveita em vez de pedir um novo a cada chamada (recomendação da doc).
async function getToken(force = false) {
  if (!force && cachedToken.value && Date.now() < cachedToken.expiresAt - 60000) return cachedToken.value;
  const { res, data } = await http(`${BASE}/v1/auth-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: process.env.SYNCPAY_CLIENT_ID, client_secret: process.env.SYNCPAY_CLIENT_SECRET })
  });
  if (!res.ok || !data || !data.access_token) {
    console.error("[syncpay] falha ao autenticar:", res.status, data && (data.error || data.message));
    throw new Error("Não foi possível autenticar na SyncPay. Confira as credenciais.");
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function authed(path, options = {}, retry = true) {
  const token = await getToken();
  const { res, data } = await http(`${BASE}${path}`, {
    ...options,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (res.status === 401 && retry) { await getToken(true); return authed(path, options, false); }
  return { res, data };
}

// Cria uma cobrança PIX. Retorna { pixCode, identifier }.
async function createPixCharge({ amount, description, webhookUrl, client }) {
  const { res, data } = await authed("/v1/cash-in", {
    method: "POST",
    body: JSON.stringify({ amount: Number(amount.toFixed(2)), description, webhook_url: webhookUrl, client })
  });
  if (!res.ok || !data || !data.identifier || !data.pix_code) {
    console.error("[syncpay] cash-in recusado:", res.status, JSON.stringify(data).slice(0, 400));
    const msg = res.status === 422 && data && data.message ? data.message : "O provedor de pagamento recusou a cobrança. Tente novamente em instantes.";
    const err = new Error(msg); err.status = 502; throw err;
  }
  return { pixCode: data.pix_code, identifier: data.identifier };
}

// Consulta a transação direto na SyncPay (fonte da verdade). Retorna o objeto "transaction" ou null.
async function getTransaction(identifier) {
  const { res, data } = await authed(`/v2/transactions/${encodeURIComponent(identifier)}`, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok || !data || !data.data) throw new Error(`SyncPay respondeu ${res.status} ao consultar a transação.`);
  return data.data.transaction || null;
}

module.exports = { configured, createPixCharge, getTransaction };
