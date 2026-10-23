// Sorteio justo entre TODAS as novelinhas (sem olhar data de postagem).
// Recebe só os ids (leve, mesmo com milhares), sorteia `count` sem repetir e sem incluir `exclude` (a anterior).
function sampleIds(allIds, count, exclude, rnd = Math.random) {
  let pool = allIds.filter((id) => id !== exclude);
  if (!pool.length) pool = [...allIds];                 // só existe a excluída: devolve ela mesma em vez de nada
  const n = Math.min(Math.max(count | 0, 1), pool.length);
  // Fisher–Yates parcial: troca só as n primeiras posições
  for (let i = 0; i < n; i++) {
    const j = i + Math.min(pool.length - i - 1, Math.floor(rnd() * (pool.length - i)));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
module.exports = { sampleIds };
