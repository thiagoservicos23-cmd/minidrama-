// Popula o banco com dados iniciais: usuário admin, planos e peças de exemplo.
// Rode com: npm run seed
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function main() {
  console.log("Semeando banco de dados...");

  // ---------- Planos ----------
  const plans = [
    {
      id: "plateia",
      name: "Plateia",
      price: 0,
      periodicity: "grátis",
      featured: false,
      sortOrder: 0,
      benefits: JSON.stringify([
        "Sinopse e ficha técnica completas de todas as peças",
        "1 peça liberada por mês, escolhida pela produção",
        "Qualidade padrão"
      ])
    },
    {
      id: "balcao",
      name: "Balcão",
      price: 14.9,
      periodicity: "por mês",
      featured: true,
      sortOrder: 1,
      benefits: JSON.stringify([
        "Catálogo completo liberado, sem espera",
        "1 tela por vez",
        "Continuar de onde parou em qualquer peça"
      ])
    },
    {
      id: "camarote",
      name: "Camarote",
      price: 24.9,
      periodicity: "por mês",
      featured: false,
      sortOrder: 2,
      benefits: JSON.stringify([
        "Tudo do plano Balcão",
        "Até 2 telas simultâneas",
        "Acesso antecipado a estreias",
        "Conteúdo de bastidores e making of"
      ])
    }
  ];
  for (const p of plans) {
    await prisma.plan.upsert({ where: { id: p.id }, update: p, create: p });
  }

  // ---------- Usuários ----------
  const adminPass = await bcrypt.hash("admin123", 10);
  const demoPass = await bcrypt.hash("123456", 10);

  await prisma.user.upsert({
    where: { email: "admin@minidrama.app" },
    update: {},
    create: {
      name: "Direção Geral",
      email: "admin@minidrama.app",
      password: adminPass,
      role: "admin",
      plan: "camarote",
      planExpiry: daysFromNow(365),
      status: "ativo"
    }
  });

  await prisma.user.upsert({
    where: { email: "convidado@minidrama.app" },
    update: {},
    create: {
      name: "Espectador Convidado",
      email: "convidado@minidrama.app",
      password: demoPass,
      role: "user",
      plan: "balcao",
      planExpiry: daysFromNow(20),
      status: "ativo"
    }
  });

  // ---------- Peças ----------
  const plays = [
    {
      id: "p1", title: "A Farsa do Silêncio", genre: "Drama", durationMinutes: 95, releaseYear: 2024,
      synopsis: "Numa cidade tomada pelo medo, um grupo de vizinhos descobre que o silêncio pode ser a maior das mentiras. Um drama sobre memória, culpa e o preço de calar.",
      director: "Marina Kessler", cast: "Bia Torres, Renato Alves, Duda Ferraz",
      posterUrl: "https://images.unsplash.com/photo-1503095396549-807759245b35?q=80&w=800&auto=format&fit=crop",
      backdropUrl: "https://images.unsplash.com/photo-1503095396549-807759245b35?q=80&w=1600&auto=format&fit=crop",
      videoUrl: "", requiresPlan: "balcao", featured: true
    },
    {
      id: "p2", title: "Ventos de Dona Flor", genre: "Comédia", durationMinutes: 110, releaseYear: 2023,
      synopsis: "Uma comédia de costumes sobre uma senhora que decide reabrir o bar do falecido marido — e vira a cabeça de toda a rua no processo.",
      director: "João Petrucci", cast: "Célia Nunes, Otávio Reis, Marli Cassoni",
      posterUrl: "https://images.unsplash.com/photo-1509824227185-9c5a01ceba0d?q=80&w=800&auto=format&fit=crop",
      backdropUrl: "https://images.unsplash.com/photo-1509824227185-9c5a01ceba0d?q=80&w=1600&auto=format&fit=crop",
      videoUrl: "", requiresPlan: "plateia", featured: true
    },
    {
      id: "p3", title: "O Relógio de Antígona", genre: "Clássico", durationMinutes: 130, releaseYear: 2022,
      synopsis: "Releitura contemporânea da tragédia grega, ambientada numa fábrica têxtil em greve. A lei do Estado contra a lei do coração.",
      director: "Helena Brito", cast: "Sofia Damacena, Igor Pontes",
      posterUrl: "https://images.unsplash.com/photo-1519669417670-68775a50919c?q=80&w=800&auto=format&fit=crop",
      backdropUrl: "https://images.unsplash.com/photo-1519669417670-68775a50919c?q=80&w=1600&auto=format&fit=crop",
      videoUrl: "", requiresPlan: "camarote", featured: true
    },
    {
      id: "p4", title: "Cordel de Vidro", genre: "Musical", durationMinutes: 100, releaseYear: 2024,
      synopsis: "Um casamento arranjado no sertão vira musical de viola e sanfona quando a noiva decide fugir na véspera — para dentro do próprio circo da cidade.",
      director: "Zeca Montenegro", cast: "Luzia Prado, Bento Aguiar, Cacá Ribas",
      posterUrl: "https://images.unsplash.com/photo-1516307365426-bea591f05011?q=80&w=800&auto=format&fit=crop",
      backdropUrl: "https://images.unsplash.com/photo-1516307365426-bea591f05011?q=80&w=1600&auto=format&fit=crop",
      videoUrl: "", requiresPlan: "balcao", featured: false
    },
    {
      id: "p5", title: "Sala de Espera", genre: "Suspense", durationMinutes: 88, releaseYear: 2023,
      synopsis: "Seis desconhecidos presos numa sala de espera de hospital durante um apagão. Um deles não deveria estar ali — e todos sabem disso.",
      director: "Marina Kessler", cast: "Renato Alves, Paula Vidigal, Tomás Neri",
      posterUrl: "https://images.unsplash.com/photo-1478720568477-152d9b164e26?q=80&w=800&auto=format&fit=crop",
      backdropUrl: "https://images.unsplash.com/photo-1478720568477-152d9b164e26?q=80&w=1600&auto=format&fit=crop",
      videoUrl: "", requiresPlan: "camarote", featured: false
    },
    {
      id: "p6", title: "O Baú da Vovó Chica", genre: "Infantil", durationMinutes: 65, releaseYear: 2024,
      synopsis: "Duas crianças encontram um baú mágico no sótão e caem em histórias esquecidas da avó — com direito a dragão de papel e réveillon ao contrário.",
      director: "Bento Aguiar", cast: "Cacá Ribas, Duda Ferraz, Companhia Mirim",
      posterUrl: "https://images.unsplash.com/photo-1503516459261-40c66117780a?q=80&w=800&auto=format&fit=crop",
      backdropUrl: "https://images.unsplash.com/photo-1503516459261-40c66117780a?q=80&w=1600&auto=format&fit=crop",
      videoUrl: "", requiresPlan: "plateia", featured: false
    }
  ];
  for (const p of plays) {
    await prisma.play.upsert({ where: { id: p.id }, update: p, create: p });
  }

  console.log("Banco semeado com sucesso.");
  console.log("Login admin: admin@minidrama.app / admin123");
  console.log("Login usuário demo: convidado@minidrama.app / 123456");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
