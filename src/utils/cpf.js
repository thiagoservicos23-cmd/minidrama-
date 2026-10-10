// Validação de CPF (dígitos verificadores) e telefone brasileiro.
function onlyDigits(v) { return String(v || "").replace(/\D/g, ""); }

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(cpf[i], 10) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(cpf[9], 10) && calc(10) === parseInt(cpf[10], 10);
}

function normalizePhone(value) {
  let d = onlyDigits(value);
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

module.exports = { onlyDigits, isValidCpf, normalizePhone };
