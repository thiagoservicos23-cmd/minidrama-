// Ordem "do dia" das novelinhas: embaralhada, mas ESTÁVEL durante o dia inteiro e diferente a cada dia.
//
// Em vez de um cron que reescreve a ordem à meia-noite (e que falharia se o servidor estivesse dormindo),
// a ordem é calculada a partir de uma semente = data (no fuso configurado) + escopo (o gênero).
// Resultado: vira sozinha às 00:00, é idêntica em qualquer instância do servidor e não precisa de coluna no banco.
// Cada gênero tem a sua própria semente, então os gêneros nunca se misturam.

const TZ = process.env.SHUFFLE_TZ || "America/Sao_Paulo";

// Relógio trocável (os testes controlam a "hora" por aqui).
const clock = { now: () => new Date() };

// "2026-10-21": o dia no fuso configurado. É isso que muda à meia-noite.
function dayKey(now = clock.now(), tz = TZ) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch (e) {
    // fuso inválido ou ICU ausente: usa UTC-3 fixo (horário de Brasília, que não tem horário de verão desde 2019)
    return new Date(now.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }
}

// FNV-1a: transforma texto em um número de 32 bits.
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// mulberry32: gerador pseudoaleatório pequeno e rápido; mesma semente => mesma sequência.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Embaralha `items` (objetos com `id`) para o dia de `now`, dentro do `scope` (ex.: "genre:dublados").
// Não depende da ordem de entrada: ordena por id antes, então o banco pode devolver as linhas como quiser.
function dailyShuffle(items, scope, now = clock.now(), tz = TZ) {
  const rnd = mulberry32(hash32(dayKey(now, tz) + "|" + scope));
  const arr = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { TZ, clock, dayKey, hash32, mulberry32, dailyShuffle };
