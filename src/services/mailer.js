// Envio de e-mail pela API HTTP da Brevo (https://developers.brevo.com).
// Usamos API (e não SMTP) porque a hospedagem gratuita do Render bloqueia portas SMTP.
const crypto = require("crypto");

function configured() {
  return !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM_EMAIL);
}

function siteUrl() {
  return (process.env.SITE_URL || "http://localhost:4000").replace(/\/+$/, "");
}

// Link de descadastro assinado: ninguém consegue descadastrar outra pessoa sem o token.
function unsubToken(userId) {
  const secret = process.env.JWT_SECRET || "dev-secret-troque-em-producao";
  return crypto.createHmac("sha256", secret).update("unsub:" + userId).digest("hex").slice(0, 32);
}
function unsubscribeUrl(userId) {
  return `${siteUrl()}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubToken(userId)}`;
}
function validUnsubToken(userId, token) {
  const a = Buffer.from(unsubToken(userId));
  const b = Buffer.from(String(token || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendMail({ to, toName, subject, html, text, unsubscribeLink }) {
  if (!configured()) return { ok: false, skipped: true };
  try {
    const body = {
      sender: { name: process.env.MAIL_FROM_NAME || "Mini Drama", email: process.env.MAIL_FROM_EMAIL },
      to: [{ email: to, name: toName || undefined }],
      subject, htmlContent: html, textContent: text
    };
    if (unsubscribeLink) body.headers = { "List-Unsubscribe": `<${unsubscribeLink}>` };
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[email] Brevo recusou:", res.status, t.slice(0, 300));
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.error("[email] erro de envio:", e.message);
    return { ok: false };
  }
}

module.exports = { configured, sendMail, siteUrl, unsubscribeUrl, validUnsubToken };
