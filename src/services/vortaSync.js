const prisma = require("../prismaClient");
const vortaApi = require("./vortaApi");
const { translateTitle, translateSynopsis, detectGenres } = require("../utils/translator");

async function syncAllToPtBr() {
  console.log("=== INICIANDO SINCRONIZAÇÃO TOTAL COM LOCALIZAÇÃO PT-BR ===");

  // 1. Atualizar todas as novelinhas já gravadas no banco para PT-BR
  const currentPlays = await prisma.play.findMany({
    include: { genres: true }
  });
  console.log(`Encontradas ${currentPlays.length} novelinhas no banco local. Atualizando títulos e gêneros para PT-BR...`);

  for (const play of currentPlays) {
    const ptTitle = translateTitle(play.title);
    const ptSynopsis = translateSynopsis(play.synopsis, ptTitle);
    const genreIds = detectGenres(ptTitle, ptSynopsis, play.genres.map(g => g.genre));

    await prisma.play.update({
      where: { id: play.id },
      data: {
        title: ptTitle,
        synopsis: ptSynopsis,
        featured: false // reseta os antigos destaques para destacar as novas oficiais
      }
    });

    // Atualizar tabela playGenre
    await prisma.playGenre.deleteMany({ where: { playId: play.id } });
    if (genreIds.length > 0) {
      await prisma.playGenre.createMany({
        data: genreIds.map(g => ({ playId: play.id, genre: g }))
      });
    }
  }
  console.log("Novelinhas locais atualizadas com sucesso!");

  // 2. Buscar Banners Oficiais em Português das 3 plataformas da Vorta
  const platforms = ["freereels", "shortmax", "meloshort"];
  let featuredCount = 0;
  let importedCount = 0;

  for (const platform of platforms) {
    console.log(`Buscando banners e destaques em PT-BR da plataforma ${platform}...`);
    try {
      const bannerRes = await vortaApi.getBanner(platform, "pt");
      const items = bannerRes.data || [];
      console.log(`Recebidas ${items.length} novelinhas em destaque de ${platform}`);

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.title) continue;

        const cleanTitle = translateTitle(item.title);
        const chaptersCount = parseInt(item.chapters || item.total_episodes || 45, 10);
        const duration = chaptersCount > 0 ? chaptersCount * 2 : 75;

        // Tenta obter detalhe completo em PT-BR para pegar sinopse rica
        let synopsis = item.synopsis || "";
        let tags = item.tags || item.genres || [];
        try {
          const detailRes = await vortaApi.getDetail(platform, item.id, "pt");
          if (detailRes && detailRes.data) {
            synopsis = detailRes.data.synopsis || synopsis;
            tags = detailRes.data.genres || detailRes.data.tags || tags;
          }
        } catch (e) {}

        const ptSynopsis = translateSynopsis(synopsis, cleanTitle);
        const genreIds = detectGenres(cleanTitle, ptSynopsis, tags);

        // Define se é destaque no carrossel Hero (os primeiros de cada plataforma)
        const isFeatured = featuredCount < 8;

        const existing = await prisma.play.findFirst({
          where: {
            OR: [
              { title: cleanTitle },
              { title: item.title }
            ]
          }
        });

        if (existing) {
          await prisma.play.update({
            where: { id: existing.id },
            data: {
              title: cleanTitle,
              synopsis: ptSynopsis,
              posterUrl: item.cover || existing.posterUrl,
              backdropUrl: item.cover || existing.backdropUrl,
              featured: isFeatured,
              durationMinutes: Math.max(duration, 45)
            }
          });
          await prisma.playGenre.deleteMany({ where: { playId: existing.id } });
          if (genreIds.length > 0) {
            await prisma.playGenre.createMany({
              data: genreIds.map(g => ({ playId: existing.id, genre: g }))
            });
          }
          if (isFeatured) featuredCount++;
          console.log(`[Atualizada] ${cleanTitle} (Destaque: ${isFeatured})`);
        } else {
          const created = await prisma.play.create({
            data: {
              title: cleanTitle,
              synopsis: ptSynopsis,
              director: item.author || (platform.toUpperCase() + " Studios"),
              cast: genreIds.slice(0, 3).join(", ") || "Elenco Principal",
              durationMinutes: Math.max(duration, 45),
              releaseYear: new Date().getFullYear(),
              posterUrl: item.cover || "",
              backdropUrl: item.cover || "",
              videoUrl: "", // Vídeo resolvido sob demanda pela API Vorta
              requiresPlan: "plateia",
              featured: isFeatured,
              genres: {
                create: genreIds.map(g => ({ genre: g }))
              }
            }
          });
          importedCount++;
          if (isFeatured) featuredCount++;
          console.log(`[Nova Importada] ${created.title} (Destaque: ${isFeatured})`);
        }
      }
    } catch (err) {
      console.error(`Erro ao sincronizar plataforma ${platform}:`, err.message);
    }
  }

  // Estatísticas finais
  const [totalPlays, totalFeatured, genreCounts] = await Promise.all([
    prisma.play.count(),
    prisma.play.count({ where: { featured: true } }),
    prisma.playGenre.groupBy({ by: ["genre"], _count: { _all: true } })
  ]);

  console.log("\n=== SINCRONIZAÇÃO CONCLUÍDA COM SUCESSO! ===");
  console.log(`Total de Novelinhas no Banco: ${totalPlays}`);
  console.log(`Novelinhas em Destaque no Hero: ${totalFeatured}`);
  console.log("Distribuição por Gênero:");
  genreCounts.forEach(g => console.log(`  - ${g.genre}: ${g._count._all} novelinhas`));
}

syncAllToPtBr()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
