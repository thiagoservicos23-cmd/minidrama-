const { publicPlay } = require("./images");
const { userCanWatch } = require("./planRules");

// Formato público de uma série para a pessoa que está vendo: sem o link do vídeo, com "pode assistir?".
async function withAccess(user, p) {
  const { videoUrl, ...rest } = publicPlay(p);
  const canWatch = await userCanWatch(user, p);
  return { ...rest, hasVideo: !!videoUrl, canWatch };
}

module.exports = { withAccess };
