// Templates de e-mail do Mini Drama. Tom: caloroso, curioso e direto — sempre com UM botão principal.
const { siteUrl, unsubscribeUrl } = require("./mailer");

const GOLD = "#C9A24B";
const CURTAIN = "#7A1F2E";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function firstName(user) { return esc((user.name || "").trim().split(/\s+/)[0] || "amigo(a)"); }
function fmtDate(d) { return new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); }
function money(v) { return "R$ " + Number(v).toFixed(2).replace(".", ","); }
function abs(url) { return !url ? "" : /^https?:\/\//i.test(url) ? url : siteUrl() + url; }

function button(label, href) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 8px;"><tr><td bgcolor="${GOLD}" style="border-radius:4px;">
    <a href="${href}" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#241708;text-decoration:none;">${label}</a>
  </td></tr></table>`;
}

// Moldura comum a todos os e-mails.
function layout({ preheader, title, body, user, marketing }) {
  const footer = marketing && user
    ? `Você recebe este e-mail porque tem conta no Mini Drama. <a href="${unsubscribeUrl(user.id)}" style="color:#8A7A72;">Não quero mais receber divulgações</a>.`
    : `Este é um aviso sobre a sua conta no Mini Drama.`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#120D0F;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#120D0F;">${esc(preheader || "")}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#120D0F"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
    <tr><td align="center" style="padding:6px 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:bold;color:#F4ECE3;">Mini Drama <span style="color:${GOLD};">&#9679;</span></td></tr>
    <tr><td bgcolor="#1B1417" style="border-top:4px solid ${CURTAIN};border-radius:6px;padding:34px 30px;font-family:Arial,Helvetica,sans-serif;color:#F4ECE3;font-size:16px;line-height:1.65;">
      ${body}
    </td></tr>
    <tr><td align="center" style="padding:20px 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8A7A72;">${footer}<br>Mini Drama &middot; teatro onde você estiver</td></tr>
  </table>
</td></tr></table></body></html>`;
}

const h1 = (t) => `<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.25;color:#F4ECE3;">${t}</h1>`;
const p = (t) => `<p style="margin:0 0 14px;color:#D9CDC2;">${t}</p>`;

function playCard(play) {
  const img = abs(play.posterUrl);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:10px 0;"><tr>
    ${img ? `<td width="84" valign="top"><img src="${esc(img)}" width="72" alt="" style="border-radius:3px;display:block;"></td>` : ""}
    <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
      <a href="${siteUrl()}/#/peca/${esc(play.id)}" style="color:#F4ECE3;font-weight:bold;font-size:16px;text-decoration:none;">${esc(play.title)}</a>
      <div style="color:#B9A9A0;font-size:13px;margin-top:3px;">${esc(play.genre)} &middot; ${Math.floor(play.durationMinutes / 60)}h${String(play.durationMinutes % 60).padStart(2, "0")}</div>
    </td></tr></table>`;
}

// ---------------------------------------------------------------------------
function welcome(user, cheapest) {
  const body = h1(`Cortinas abertas, ${firstName(user)}! 🎭`) +
    p(`Que alegria ter você na plateia do <b>Mini Drama</b>. Aqui você assiste a peças de teatro completas, de grupos de verdade, onde e quando quiser — no celular, no computador ou na TV.`) +
    p(`Sua conta <b>Plateia</b> já está liberada, de graça. Dê uma olhada no catálogo e escolha a sua primeira peça de hoje.`) +
    button("Começar a assistir", `${siteUrl()}/#/catalogo`) +
    (cheapest ? p(`<span style="color:#B9A9A0;font-size:14px;">Quer o catálogo completo? Os planos pagos começam em <b style="color:${GOLD};">${money(cheapest.price)}</b> por mês, e você assina quando quiser.</span>`) : "") +
    p(`<span style="color:#B9A9A0;font-size:14px;">Dica: instale o Mini Drama na tela inicial do celular — é só abrir o site e tocar em “Instalar app”.</span>`);
  return { subject: `Bem-vindo(a) ao Mini Drama, ${(user.name || "").split(" ")[0] || ""}! 🎭`.replace(", !", "!"), html: layout({ preheader: "Sua conta Plateia já está liberada.", title: "Bem-vindo(a)", body, user, marketing: false }), text: `Bem-vindo(a) ao Mini Drama! Sua conta Plateia já está liberada. Comece a assistir: ${siteUrl()}/#/catalogo` };
}

function digest(user, count, plays) {
  const title = count === 1 ? "Chegou 1 peça nova no Mini Drama 🎬" : `Chegaram ${count} peças novas no Mini Drama 🎬`;
  const body = h1(count === 1 ? "Tem peça nova no palco!" : `${count} peças novas acabaram de estrear`) +
    p(`Oi, ${firstName(user)}! Desde o nosso último recado, o catálogo cresceu. Olha só o que chegou:`) +
    plays.slice(0, 4).map(playCard).join("") +
    (count > 4 ? p(`<span style="color:#B9A9A0;">…e mais ${count - 4} esperando por você.</span>`) : "") +
    button("Ver as novidades", `${siteUrl()}/#/catalogo`);
  return { subject: title, html: layout({ preheader: "Novidades fresquinhas no catálogo.", title, body, user, marketing: true }), text: `${title}. Veja: ${siteUrl()}/#/catalogo` };
}

function expiry(user, daysLeft, planName, expiresAt) {
  const when = fmtDate(expiresAt);
  const subjects = {
    3: `Faltam 3 dias para o seu plano ${planName} vencer ⏳`,
    2: `Só mais 2 dias de ${planName} — renove e não perca o fio da peça`,
    1: `Último aviso: seu plano ${planName} vence amanhã!`
  };
  const lead = {
    3: `Passando para avisar com carinho: seu plano <b>${esc(planName)}</b> vence em <b>${when}</b>, daqui a 3 dias.`,
    2: `O tempo passa rápido no teatro! Seu plano <b>${esc(planName)}</b> vence em <b>${when}</b> — faltam só 2 dias.`,
    1: `A última chamada soou: seu plano <b>${esc(planName)}</b> vence <b>amanhã (${when})</b>.`
  };
  const body = h1(daysLeft === 1 ? "Não deixe a cortina fechar 🎭" : "Seu plano está chegando ao fim") +
    p(`${firstName(user)}, ${lead[daysLeft]}`) +
    p(`Renovando agora, você mantém o acesso a todas as peças <b>sem interrupção</b> — e os 30 dias novos são <b>somados</b> aos dias que ainda sobrarem. Nada se perde.`) +
    button("Renovar meu plano", `${siteUrl()}/#/planos`) +
    p(`<span style="color:#B9A9A0;font-size:14px;">O pagamento é por PIX e leva menos de um minuto.</span>`);
  return { subject: subjects[daysLeft], html: layout({ preheader: `Vence em ${when}. Renove em 1 minuto por PIX.`, title: subjects[daysLeft], body, user, marketing: false }), text: `Seu plano ${planName} vence em ${when}. Renove: ${siteUrl()}/#/planos` };
}

function expired(user, planName) {
  const subject = `Seu plano ${planName} venceu — a plateia sente sua falta 💛`;
  const body = h1("As luzes se apagaram… por enquanto") +
    p(`${firstName(user)}, seu plano <b>${esc(planName)}</b> chegou ao fim. Você continua com a conta <b>Plateia</b> gratuita, mas as peças exclusivas ficaram trancadas.`) +
    p(`Quer voltar para o seu lugar? Leva menos de um minuto, por PIX.`) +
    button("Reativar meu plano", `${siteUrl()}/#/planos`);
  return { subject, html: layout({ preheader: "Volte para o seu lugar na plateia.", title: subject, body, user, marketing: false }), text: `Seu plano ${planName} venceu. Reative: ${siteUrl()}/#/planos` };
}

function missYou(user, plays) {
  const subject = `${(user.name || "").split(" ")[0] || "Oi"}, sentimos a sua falta 💔🎭`;
  const body = h1("Sua poltrona está esperando") +
    p(`Faz um tempinho que você não aparece por aqui, ${firstName(user)}. Enquanto isso, o palco não parou — olha o que está em cartaz:`) +
    plays.slice(0, 3).map(playCard).join("") +
    button("Voltar para o Mini Drama", `${siteUrl()}/#/home`);
  return { subject, html: layout({ preheader: "Tem peça boa esperando por você.", title: subject, body, user, marketing: true }), text: `Sentimos sua falta! Volte: ${siteUrl()}/#/home` };
}

function featured(user, play, canWatch, planName) {
  const subject = `🎭 Em cartaz agora: ${play.title}`;
  const img = abs(play.backdropUrl || play.posterUrl);
  const body = (img ? `<img src="${esc(img)}" width="540" alt="" style="width:100%;max-width:540px;border-radius:4px;display:block;margin:0 0 20px;">` : "") +
    h1(esc(play.title)) +
    `<div style="color:#B9A9A0;font-size:14px;margin:-6px 0 14px;">${esc(play.genre)} &middot; ${Math.floor(play.durationMinutes / 60)}h${String(play.durationMinutes % 60).padStart(2, "0")}</div>` +
    p(`${firstName(user)}, uma nova obra acabou de subir para o destaque do Mini Drama:`) +
    p(esc((play.synopsis || "").slice(0, 220)) + ((play.synopsis || "").length > 220 ? "…" : "")) +
    (canWatch
      ? button("Assistir agora", `${siteUrl()}/#/peca/${esc(play.id)}`)
      : button(`Desbloquear com o plano ${esc(planName)}`, `${siteUrl()}/#/planos`) + p(`<span style="color:#B9A9A0;font-size:14px;">Esta peça faz parte do plano ${esc(planName)}. Assine por PIX em menos de um minuto.</span>`));
  return { subject, html: layout({ preheader: "Nova obra no banner principal — vem ver.", title: subject, body, user, marketing: true }), text: `${play.title} está em cartaz. Veja: ${siteUrl()}/#/peca/${play.id}` };
}

function payment(user, planName, amount, validUntil) {
  const subject = `Pagamento confirmado ✅ — seu plano ${planName} está ativo`;
  const body = h1("Tudo certo, o espetáculo é seu! 🎉") +
    p(`${firstName(user)}, recebemos o seu pagamento de <b>${money(amount)}</b>. O plano <b>${esc(planName)}</b> já está liberado e vale até <b>${fmtDate(validUntil)}</b>.`) +
    button("Assistir agora", `${siteUrl()}/#/catalogo`) +
    p(`<span style="color:#B9A9A0;font-size:14px;">Guarde este e-mail como comprovante. Qualquer dúvida, é só responder.</span>`);
  return { subject, html: layout({ preheader: `Plano ${planName} ativo até ${fmtDate(validUntil)}.`, title: subject, body, user, marketing: false }), text: `Pagamento confirmado. Plano ${planName} ativo até ${fmtDate(validUntil)}.` };
}

function resetPassword(user, link) {
  const subject = "Crie uma nova senha no Mini Drama 🔑";
  const body = h1("Vamos recuperar o seu acesso") +
    p(`Oi, ${firstName(user)}! Recebemos um pedido para criar uma nova senha na sua conta do Mini Drama.`) +
    p(`Clique no botão abaixo para escolher a nova senha. O link vale por <b>60 minutos</b> e só pode ser usado <b>uma vez</b>.`) +
    button("Criar nova senha", link) +
    p(`<span style="color:#B9A9A0;font-size:14px;">Se o botão não abrir, copie e cole este endereço no navegador:<br><span style="word-break:break-all;color:#8A7A72;">${esc(link)}</span></span>`) +
    p(`<span style="color:#B9A9A0;font-size:14px;">Não foi você? Pode ignorar este e-mail com tranquilidade: sua senha continua a mesma.</span>`);
  return { subject, html: layout({ preheader: "O link vale por 60 minutos.", title: subject, body, user, marketing: false }), text: `Para criar uma nova senha, abra: ${link} (vale por 60 minutos e só pode ser usado uma vez). Se não foi você, ignore este e-mail.` };
}

function passwordChanged(user) {
  const subject = "Sua senha do Mini Drama foi alterada ✅";
  const body = h1("Senha alterada com sucesso") +
    p(`${firstName(user)}, a senha da sua conta acabou de ser alterada e você foi desconectado dos outros aparelhos.`) +
    p(`Foi você? Então está tudo certo, nada a fazer. <b>Se não foi você</b>, crie uma nova senha agora para proteger a sua conta.`) +
    button("Recuperar minha conta", `${siteUrl()}/#/esqueci-senha`);
  return { subject, html: layout({ preheader: "Se não foi você, recupere sua conta agora.", title: subject, body, user, marketing: false }), text: `A senha da sua conta foi alterada. Se não foi você, recupere o acesso: ${siteUrl()}/#/esqueci-senha` };
}

module.exports = { welcome, digest, expiry, expired, missYou, featured, payment, resetPassword, passwordChanged };
