const { publicPlay } = require("./images");
const { userCanWatch } = require("./planRules");

// Formato público de uma série para a pessoa que está vendo: sem o link do vídeo, com "pode assistir?".
async function withAccess(user, p) {
  const { videoUrl, ...rest } = publicPlay(p);
  const canWatch = await userCanWatch(user, p);
  const isVortaSource = Boolean(
    p.isVorta ||
    (p.posterUrl && (p.posterUrl.includes("mydramawave.com") || p.posterUrl.includes("shorttv.live") || p.posterUrl.includes("meloshort.com"))) ||
    ["FreeReels", "ShortMax", "MeloShort"].includes(p.director)
  );
  return {
    ...rest,
    hasVideo: Boolean(videoUrl || isVortaSource),
    canWatch,
    isVorta: isVortaSource
  };
}

module.exports = { withAccess };
