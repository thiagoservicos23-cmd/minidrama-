/**
 * Tradutor e Adaptador PT-BR para Títulos, Sinopses e Gêneros de Novelinhas (API Vorta / FreeReels / ShortMax / MeloShort)
 */

// Dicionário de títulos exatos conhecidos
const EXACT_TITLES = {
  "Sang Dewi Terbangun: Balas Dendam Putriku": "O Despertar da Deusa: A Vingança da Minha Filha",
  "Kembalinya Sang Tanpa Serigala(Sulih Suara)": "O Retorno do Sem Lobo (Dublado)",
  "Si Berandal dan Gadis Teladan(Sulih Suara)": "O Rebelde e a Garota Perfeita (Dublado)",
  "Janji yang Hancur 2: Kembali Bersama Si Kembar": "Promessas Quebradas 2: O Retorno com os Gêmeos",
  "Jatuh Cinta pada Rival Dingin(Sulih Suara)": "Apaixonada pelo Rival de Gelo (Dublado)",
  "Master Judi Jadi Suami Rumah Tangga(Sulih Suara)": "Mestre do Cassino: O Marido Perfeito (Dublado)",
  "Quarterback Rival, Mesra di Malam Hari(Sulih Suara)": "Rival no Campo, Amor à Noite (Dublado)",
  "Putri Bulan yang Hilang": "A Princesa da Lua Perdida",
  "Menjinakkan Wolf King(Sulih Suara)": "Domando o Rei Lobo (Dublado)",
  "Permainan Maut Para Miliarder: Arena Kapal Pesiar": "Jogos Fatais dos Bilionários: Cruzeiro Mortal",
  "Buku Sihir Mengacaukan Rencana Cerainya": "O Livro Mágico e o Divórcio Cancelado",
  "Pelukis Sang Serigala": "A Pintora e o Lobo",
  "Aku Menikahi Buronan Nomor Satu Wall Street": "Casei com o Fugitivo nº 1 de Wall Street",
  "Bayangan dan Fajar": "Sombras e o Amanhecer",
  "Keluarga Palsu: Kebenaran Tersembunyi": "Família Falsa: A Verdade Oculta",
  "Pewaris Serigala Tersembunyi": "O Herdeiro Lobo Oculto",
  "Terlahir Kembali, Aku Memilih Sang Naga": "Renascida: Escolhi o Dragão",
  "Terlahir Kembali, Aku Memilih Sang Naga(Sulih Suara)": "Renascida: Escolhi o Dragão (Dublado)",
  "Nenek Bisa Bahasa Naga": "Vovó Fala a Língua dos Dragões",
  "Kekasih Bos Mafia": "A Amante do Chefe da Máfia",
  "Sangkar Harta: Kebohongan Maut": "Gaiola de Ouro: Mentiras Mortais",
  "Raja yang Menyamar(Sulih Suara)": "O Rei Disfarçado (Dublado)",
  "Pewaris Dikhianati: Balas Dendam Kelam": "Herdeiro Traído: Vingança Sombria",
  "Dia Merebut Milikku, Aku Mendapatkan Dewa": "Ela Roubou Meu Amor, Eu Conquistei um Deus",
  "Gairah Kota: Cinta Sejati": "Paixão Urbana: Amor Verdadeiro",
  "Perlindungan Seumur Hidup": "Proteção para a Vida Toda",
  "Perang Tanpa Tanda": "Guerra Silenciosa",
  "Aku Menyesal Mencintaimu": "Me Arrependo de Te Amar",
  "Pangeran Duyung": "O Príncipe Tritão",
  "Pembalasan Terlahir Kembali": "Vingança: Renascida das Cinzas",
  "Putri yang Kembali": "O Retorno da Princesa",
  "Tiada Kembali": "Sem Volta",
  "Kembali Lagi, Bukan Untukmu": "Estou de Volta, Mas Não Por Você",
  "Cinta yang Terkhianati": "Amor Traído",
  "Kebangkitan Ibu Tiri yang Berkuasa": "A Ascensão da Madrasta Poderosa",
  "Ikatan Cinta Kontrak": "Contrato de Amor",
  "Mata Emas: Harta Karun Raja Lelang": "Olhos Dourados: O Tesouro do Leiloeiro",
  "Masa Lalu Takkan Kembali": "O Passado Não Volta",
  "Rumah yang Menampikku": "A Mansão que Me Rejeitou",
  "Cinta Terkalkulasi": "Amor Calculado",
  "Cinta Sempurna: Istri Hamil yang Dimanjakan": "Amor Perfeito: A Esposa Mimada e Grávida",
  "Harga Sebuah Keadilan": "O Preço da Justiça",
  "Ditolak Pasanganku, Aku Menikahi Putri Alpha": "Rejeitado Pelo Meu Par, Casei com a Princesa Alfa",
  "Dewa Tempa yang Hilang": "O Mestre Forjador Perdido",
  "Ibu Tiriku Gendut dan Kejam": "Minha Madrasta Cruel",
  "Cinta Tak Lekang Oleh Waktu": "Amor Eterno Através do Tempo",
  "Kembalinya Sang Penembak": "O Retorno do Atirador Lendário",
  "Dunia Lebih Indah Dari Surga": "Um Mundo Mais Lindo que o Paraíso",
  "Malam Yang Panjang": "Uma Longa Noite",
  "Plat Nomor Itu Terlalu Familiar": "A Placa Familiar",
  "Gala Mewah": "Gala de Luxo",
  "Ibu Tiri Penyembuh: Rahasia Keluarga Baru": "Madrasta Curandeira: Segredos de Família",
  "Suamiku Sang Dewa Tak Terkalahkan": "Meu Marido, o Deus Invencível"
};

// Expressões compostas (frases) comuns em títulos e sinopses indonésias
const PHRASES = [
  [/\(Sulih Suara\)/gi, ""],
  [/\[Sulih Suara\]/gi, ""],
  [/\[Dubbing\]/gi, ""],
  [/\(Dubbing\)/gi, ""],
  [/Sulih Suara/gi, ""],
  [/Dubbing/gi, ""],
  [/Balas Dendam/gi, "Vingança"],
  [/Jatuh Cinta/gi, "Apaixonada"],
  [/Terlahir Kembali/gi, "Renascida"],
  [/Rumah Tangga/gi, "Dono de Casa"],
  [/Ibu Tiri/gi, "Madrasta"],
  [/Istri Hamil/gi, "Esposa Grávida"],
  [/Bebas Pulang/gi, "Livre para Voltar"],
  [/Tanpa Serigala/gi, "Sem Lobo"],
  [/Mata Emas/gi, "Olhos Dourados"],
  [/Putri Alpha/gi, "Princesa Alfa"],
  [/Raja Lelang/gi, "Rei do Leilão"],
  [/Kapal Pesiar/gi, "Cruzeiro de Luxo"],
  [/Permainan Maut/gi, "Jogos Fatais"],
  [/Cinta Sejati/gi, "Amor Verdadeiro"],
  [/Cinta Kontrak/gi, "Casamento por Contrato"],
  [/Bos Mafia/gi, "Chefe da Máfia"],
  [/Keluarga Palsu/gi, "Família Falsa"],
  [/Kebenaran Tersembunyi/gi, "Verdade Oculta"],
  [/Harta Karun/gi, "Grande Tesouro"],
  [/Tak Terkalahkan/gi, "Invencível"],
  [/Terlalu Familiar/gi, "Muito Familiar"],
  [/Cinta yang Terkhianati/gi, "Amor Traído"],
  [/Kembali Lagi/gi, "De Volta"],
  [/Bukan Untukmu/gi, "Não Por Você"],
  [/Si Kembar/gi, "Os Gêmeos"],
  [/Janji yang Hancur/gi, "Promessas Quebradas"],
  [/Sang Tanpa/gi, "O Sem"],
  [/Sang Dewi/gi, "A Deusa"],
  [/Sang Raja/gi, "O Rei"],
  [/Sang Ratu/gi, "A Rainha"],
  [/Sang Naga/gi, "O Dragão"],
  [/Sang Serigala/gi, "O Lobo"],
  [/Sang Dewa/gi, "O Deus"],
  [/Sang Putri/gi, "A Princesa"],
  [/Sang Pangeran/gi, "O Príncipe"],
  [/Wolf King/gi, "Rei Lobo"],
  [/Alpha King/gi, "Rei Alfa"],
  [/Alpha Queen/gi, "Rainha Alfa"],
  [/Cinta Romantis/gi, "Romance Apaixonante"],
  [/Cinta yang romantis/gi, "Romance Apaixonante"]
];

// Palavras individuais
const WORDS = [
  [/\bKembalinya\b/gi, "O Retorno de"],
  [/\bTerbangun\b/gi, "Despertar"],
  [/\bPutriku\b/gi, "Minha Filha"],
  [/\bPutri\b/gi, "Princesa"],
  [/\bPangeran\b/gi, "Príncipe"],
  [/\bRaja\b/gi, "Rei"],
  [/\bRatu\b/gi, "Rainha"],
  [/\bDewa\b/gi, "Deus"],
  [/\bDewi\b/gi, "Deusa"],
  [/\bSerigala\b/gi, "Lobo"],
  [/\bNaga\b/gi, "Dragão"],
  [/\bPewaris\b/gi, "Herdeiro"],
  [/\bMiliarder\b/gi, "Bilionário"],
  [/\bMiliuner\b/gi, "Bilionário"],
  [/\bSuamiku\b/gi, "Meu Marido"],
  [/\bSuami\b/gi, "Marido"],
  [/\bIstriku\b/gi, "Minha Esposa"],
  [/\bIstri\b/gi, "Esposa"],
  [/\bIbu\b/gi, "Mãe"],
  [/\bAyah\b/gi, "Pai"],
  [/\bAnak\b/gi, "Filho"],
  [/\bBayi\b/gi, "Bebê"],
  [/\bHamil\b/gi, "Grávida"],
  [/\bCinta\b/gi, "Amor"],
  [/\bSayang\b/gi, "Querido(a)"],
  [/\bPernikahan\b/gi, "Casamento"],
  [/\bMenikah\b/gi, "Casar"],
  [/\bMenikahi\b/gi, "Casou com"],
  [/\bMencintai\b/gi, "Amar"],
  [/\bHarta\b/gi, "Fortuna"],
  [/\bRahasia\b/gi, "Segredo"],
  [/\bMisterius\b/gi, "Misterioso"],
  [/\bTakdir\b/gi, "Destino"],
  [/\bKeluarga\b/gi, "Família"],
  [/\bGadis\b/gi, "Garota"],
  [/\bWanita\b/gi, "Mulher"],
  [/\bPria\b/gi, "Homem"],
  [/\bMalam\b/gi, "Noite"],
  [/\bBulan\b/gi, "Lua"],
  [/\bMatahari\b/gi, "Sol"],
  [/\bMaut\b/gi, "Morte"],
  [/\bMati\b/gi, "Morte"],
  [/\bDarah\b/gi, "Sangue"],
  [/\bJiwa\b/gi, "Alma"],
  [/\bHati\b/gi, "Coração"],
  [/\bMata\b/gi, "Olhos"],
  [/\bDingin\b/gi, "Frio"],
  [/\bPalsu\b/gi, "Falso"],
  [/\bTersembunyi\b/gi, "Oculto"],
  [/\bHilang\b/gi, "Perdido"],
  [/\bKelam\b/gi, "Sombrio"],
  [/\bGelap\b/gi, "Escuro"],
  [/\bManis\b/gi, "Doce"],
  [/\bAbadi\b/gi, "Eterno"],
  [/\bKuat\b/gi, "Poderoso"],
  [/\bSempurna\b/gi, "Perfeito"],
  [/\bMenyamar\b/gi, "Disfarçado"],
  [/\bDikhianati\b/gi, "Traído"],
  [/\bMerebut\b/gi, "Roubou"],
  [/\bMilikku\b/gi, "O Meu"],
  [/\bGairah\b/gi, "Paixão"],
  [/\bKota\b/gi, "Cidade"],
  [/\bPerlindungan\b/gi, "Proteção"],
  [/\bSeumur Hidup\b/gi, "Por Toda a Vida"],
  [/\bPerang\b/gi, "Guerra"],
  [/\bMenyesal\b/gi, "Arrependido"],
  [/\bKebangkitan\b/gi, "Despertar"],
  [/\bIkatan\b/gi, "Laço"],
  [/\bMasa Lalu\b/gi, "Passado"],
  [/\bHarga\b/gi, "Preço"],
  [/\bKeadilan\b/gi, "Justiça"],
  [/\bDitolak\b/gi, "Rejeitado"],
  [/\bPasanganku\b/gi, "Meu Par"],
  [/\bTempa\b/gi, "Forja"],
  [/\bGendut\b/gi, "Gorda"],
  [/\bKejam\b/gi, "Cruel"],
  [/\bPenembak\b/gi, "Atirador"],
  [/\bSurga\b/gi, "Paraíso"],
  [/\bPanjang\b/gi, "Longo"],
  [/\bMewah\b/gi, "Luxo"],
  [/\bPenyembuh\b/gi, "Curandeira"],
  [/\bdan\b/gi, "e"],
  [/\bpada\b/gi, "ao"],
  [/\bdari\b/gi, "de"],
  [/\buntuk\b/gi, "para"],
  [/\bdengan\b/gi, "com"],
  [/\bdi\b/gi, "em"],
  [/\bke\b/gi, "para"]
];

/**
 * Traduz título para Português do Brasil de forma inteligente.
 * Se o título já for em português (ou se não for indonésio), mantém intacto.
 */
function translateTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== "string") return "Novelinha Sem Título";
  const trimmed = rawTitle.trim();

  // 1. Título exato conhecido
  if (EXACT_TITLES[trimmed]) return EXACT_TITLES[trimmed];

  // 2. Se já tem marcas de português bem evidentes, mantém
  const isAlreadyPt = /\b(da|do|de|com|para|uma|um|não|minha|meu|adeus|segredos|esposa|marido|revanche|noiva|perfeito|perfeita|dublado|dublada)\b/i.test(trimmed);
  if (isAlreadyPt && !/\b(sulih suara|dubbing|dendam|serigala|miliarder|kembalinya|terbangun|putriku|istri|suami|harta)\b/i.test(trimmed)) {
    return trimmed;
  }

  let text = trimmed;

  // Frases compostas primeiro
  for (const [pattern, replacement] of PHRASES) {
    text = text.replace(pattern, replacement);
  }

  // Palavras individuais
  for (const [pattern, replacement] of WORDS) {
    text = text.replace(pattern, replacement);
  }

  // Limpeza de pontuação e espaços duplos
  text = text.replace(/\s{2,}/g, " ").trim();
  text = text.replace(/\(Dublado\)/g, " (Dublado)").replace(/\[Dublado\]/g, " [Dublado]");
  text = text.replace(/\s{2,}\(Dublado\)/g, " (Dublado)");

  return text;
}

/**
 * Traduz e resume sinopse para Português do Brasil.
 */
function translateSynopsis(rawSynopsis, title = "") {
  if (!rawSynopsis || typeof rawSynopsis !== "string" || rawSynopsis.trim() === "") {
    return "Assista aos episódios completos desta envolvente minissérie dramática com reviravoltas intensas, romance e mistério.";
  }
  const trimmed = rawSynopsis.trim();

  // Se já for em português fluente
  const hasPtMarkers = /\b(você|está|estão|quando|porque|então|depois|casamento|vingança|amor|irmã|marido|esposa)\b/i.test(trimmed);
  if (hasPtMarkers && !/\b(adalah|yang|dan|dengan|untuk|mereka|saat|setelah|ketika)\b/i.test(trimmed)) {
    return trimmed;
  }

  let text = trimmed;

  for (const [pattern, replacement] of PHRASES) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of WORDS) {
    text = text.replace(pattern, replacement);
  }

  // Dicionário estendido para texto longo de sinopse
  const synopsisWords = [
    [/\bsetelah\b/gi, "após"],
    [/\bketika\b/gi, "quando"],
    [/\bsaat\b/gi, "no momento em que"],
    [/\badalah\b/gi, "é"],
    [/\byang\b/gi, "que"],
    [/\bmereka\b/gi, "eles"],
    [/\bdia\b/gi, "ele(a)"],
    [/\bnamun\b/gi, "porém"],
    [/\btetapi\b/gi, "mas"],
    [/\bhanya\b/gi, "apenas"],
    [/\bsangat\b/gi, "muito"],
    [/\bmenjadi\b/gi, "se tornou"],
    [/\bmembuat\b/gi, "fazendo"],
    [/\bmengetahui\b/gi, "descobrindo"],
    [/\bterungkap\b/gi, "revelado"],
    [/\bkebenaran\b/gi, "a verdade"],
    [/\bhidup\b/gi, "vida"],
    [/\bcerita\b/gi, "história"]
  ];

  for (const [pattern, replacement] of synopsisWords) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\s{2,}/g, " ").trim();
  if (text.length > 300) {
    text = text.slice(0, 297).replace(/\s+\S*$/, "") + "...";
  }

  return text;
}

/**
 * Detecta e classifica gêneros do drama com base no título, sinopse e tags da API Vorta.
 * Devolve lista de IDs compatíveis com o sistema Mini Drama:
 * - dublados
 * - homem-lobo-e-vampiro
 * - amor-a-primeira-vista
 * - relacionamento-tabu
 * - bebes-e-gravidezes
 * - identidade-escondida
 * - brasileiras
 * - animes
 * - ia
 * - bl-gl
 */
function detectGenres(title = "", synopsis = "", apiTags = []) {
  const combined = `${title} ${synopsis} ${(apiTags || []).join(" ")}`.toLowerCase();
  const genres = new Set();

  // 1. Dublados (somente se tiver indicação explícita em português)
  if (/dublado em portugu|dublagem brasileira|áudio em portugu|audio em portugu/i.test(combined)) {
    genres.add("dublados");
  }

  // 2. Lobos, Alfas e Vampiros
  if (/lobo|lobos|serigala|vampir|vampiro|vampiros|alfa\b|alpha\b|luna\b|werewolf|lua\b|princesa da lua/i.test(combined)) {
    genres.add("homem-lobo-e-vampiro");
  }

  // 3. Bilionários & Casamentos por Contrato
  if (/bilion[aá]rio|miliarder|miliuner|ceo\b|chefe\b|patr[aã]o|herdeir[oa]|riqueza|fortuna|contrato|casamento de contrato|esposa do bilion/i.test(combined)) {
    genres.add("amor-a-primeira-vista");
  }

  // 4. Vingança & Reviravoltas
  if (/vingan[çc]a|dendam|reviravolta|revanche|retribui[çc][aã]o|trai[çc][aã]o|ex-marido|inimig[oa]s|odio|roubou tudo/i.test(combined)) {
    genres.add("relacionamento-tabu");
  }

  // 5. Bebês & Gravidez Secreta
  if (/beb[eê]|gravid[ae]z|gr[aá]vida|hamil|bayi|filhote|g[eê]meos|kembar|crian[çc]a|m[aã]e|pai|fam[ií]lia/i.test(combined)) {
    genres.add("bebes-e-gravidezes");
  }

  // 6. Identidade Oculta & Realeza
  if (/identidade|secreta|oculta|disfar[çc]|tersembunyi|princesa|pr[ií]ncipe|rei\b|rainha|deus\b|deusa\b|coroa|imp[eé]rio/i.test(combined)) {
    genres.add("identidade-escondida");
  }

  // 7. Animes
  if (/anime|webtoon|mang[aá]|anima[çc][aã]o|desenho/i.test(combined)) {
    genres.add("animes");
  }

  // 8. Ficção & IA
  if (/ia\b|intelig[eê]ncia artificial|rob[oô]|m[aá]quina|alquimista|mec[aâ]nico|viagem no tempo|renascid[ao]/i.test(combined)) {
    genres.add("ia");
  }

  // Se nenhum foi detectado, dá um gênero padrão atraente
  if (genres.size === 0) {
    genres.add("amor-a-primeira-vista");
  }

  return Array.from(genres);
}

module.exports = {
  translateTitle,
  translateSynopsis,
  detectGenres,
  EXACT_TITLES
};
