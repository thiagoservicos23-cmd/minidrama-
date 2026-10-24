# Mini Drama — guia de colocar no ar

Plataforma de streaming de novelinhas sem limite.
Front-end + back-end (Node/Express) + banco de dados real (via Prisma).

Este guia tem 3 partes:
1. Rodar no seu computador (para testar antes de publicar)
2. Colocar o site no ar com link público e banco de dados real, de graça
3. Usar o painel admin para cadastrar novelinhas, sinopses, vídeo e planos

---

## 1. Rodar no seu computador

Pré-requisito: [Node.js](https://nodejs.org) versão 18 ou superior instalado.

```bash
# dentro da pasta do projeto
npm install
cp .env.example .env
npx prisma migrate dev --name init
npm run seed
npm run dev
```

Abra **http://localhost:4000**. Pronto — site rodando com banco de dados SQLite local
(um arquivo `dev.db` na pasta do projeto).

Contas já criadas pelo `npm run seed`:
- **Admin:** admin@minidrama.app / admin123
- **Usuário teste:** convidado@minidrama.app / 123456

> Troque a senha do admin depois, principalmente se o link for público.

---

## 2. Colocar no ar (link público + banco de dados real)

Vamos usar duas contas gratuitas: **Neon** (banco de dados PostgreSQL na nuvem)
e **Render** (hospedagem do site). Nenhuma das duas pede cartão de crédito no plano free.

### Passo A — Criar o banco de dados (Neon)
1. Crie uma conta em **https://neon.tech** (dá para entrar com GitHub/Google).
2. Crie um projeto novo (ex: "mini-drama").
3. Na página do projeto, copie a **Connection string** (algo como
   `postgresql://usuario:senha@ep-xxxx.neon.tech/neondb?sslmode=require`).
   Guarde esse link, você vai usar no Passo C.

*(Alternativas equivalentes: Supabase, Railway Postgres — o passo a passo muda pouco.)*

### Passo B — Subir o código para o GitHub
1. Crie um repositório novo no GitHub (pode ser privado).
2. Envie esta pasta do projeto para o repositório:
   ```bash
   git init
   git add .
   git commit -m "Mini Drama - versão inicial"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/mini-drama.git
   git push -u origin main
   ```

### Passo C — Publicar no Render
1. Crie uma conta em **https://render.com** e clique em **New +** → **Web Service**.
2. Conecte o repositório do GitHub que você acabou de criar.
3. Configure:
   - **Build Command:** `npm install && node node_modules/prisma/build/index.js db push --accept-data-loss`
     (cria/atualiza as tabelas sozinho; só ADICIONA — nunca apaga dados do nosso schema)
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Em **Environment Variables**, adicione:
   - `DATABASE_URL` → cole a connection string do Neon (Passo A)
   - `JWT_SECRET` → qualquer texto longo e aleatório (ex: gere em
     https://1password.com/password-generator/ e use como se fosse uma senha)
   - `NODE_ENV` → `production`
5. Antes de criar o serviço, troque o `provider` do arquivo `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"   // era "sqlite"
     url      = env("DATABASE_URL")
   }
   ```
   Suba essa alteração para o GitHub (`git add . && git commit -m "postgres" && git push`)
   antes do deploy, ou o Render vai tentar usar SQLite num ambiente que não persiste arquivos.
6. Clique em **Create Web Service**. O Render vai instalar tudo e aplicar as
   migrações do banco automaticamente (por causa do build command do passo 3).

### Passo D — Popular o banco em produção
O Shell do Render é pago, então rode o seed **do seu computador**, apontando para o banco do Neon
(coloque o `DATABASE_URL` do Neon no seu `.env` local, defina uma senha forte para o admin e rode):
```bash
# Windows (cmd):
set ADMIN_PASSWORD=UmaSenhaForte123! && npm run seed
```
O seed só **cria** (admin, planos e novelinhas de exemplo se o catálogo estiver vazio). Ele nunca
sobrescreve planos/preços já existentes, então é seguro rodar de novo.

### Passo E — Testar
Acesse a URL que o Render te deu (algo como `https://mini-drama.onrender.com`) —
esse é o link que vocês vão compartilhar na faculdade. Funciona em qualquer
navegador, computador ou celular, para qualquer pessoa, sem precisar instalar nada.

> **Nota sobre o plano gratuito do Render:** o serviço "dorme" depois de alguns
> minutos sem uso e demora ~30s para acordar no primeiro acesso do dia. Para uma
> feira/apresentação, acesse o link 2–3 minutos antes para "acordar" o servidor.
> Se isso for um problema, planos pagos a partir de ~US$7/mês eliminam essa espera
> — normalmente desnecessário para um projeto acadêmico.

---

## 3. Usando o painel admin (cadastrar novelinhas, sinopses, vídeo, planos)

Depois de logado com a conta admin, acesse **Painel admin** no menu.

### Importar vídeos que já estão no Google Drive (ou qualquer link)
Além de escolher um arquivo do computador, dá pra colar um link (Google Drive,
por exemplo) e o **Bunny.net busca o vídeo sozinho**, servidor a servidor — muito
mais rápido que subir pela internet de casa.
- Novelinha única: no formulário "Nova novelinha", use o campo "Ou importe direto de um link".
- Várias de uma vez: em Novelinhas → "Cadastrar várias novelinhas", cole uma lista no
  formato `Título | link do Drive`, uma por linha.
- Para o Google Drive, o link precisa estar compartilhado como **"qualquer
  pessoa com o link"**. Arquivos grandes às vezes mostram uma tela de aviso do
  Google em vez do vídeo direto — o sistema tenta contornar isso automaticamente,
  mas não é 100% garantido; se um vídeo específico não importar, baixe ele do
  Drive e suba como arquivo mesmo (a outra opção do mesmo formulário).

### Mover séries de plano em massa
Em **Novelinhas → Mover séries de plano** você escolhe o plano de origem e o de destino (cada um mostra quantas séries tem)
e **todas** as séries do plano de origem passam a exigir o de destino — por exemplo, de Plateia para Balcão.
O botão mostra a quantidade (“Mover 4 séries”), pede uma confirmação e avisa quando o plano gratuito ficaria sem nenhuma série.
Não há “desfazer” automático (depois de juntar, o site não sabe quais eram de cada plano).
### Novelinhas: novo nicho, vitrine do dia e pop-up de assinatura (2026-10-23)
- **Rebranding:** todo texto de interface, e-mails, metadados e documentação trocaram "teatro/peça" por **novelinha(s)**. O rodapé e a tag `meta description` dizem exatamente
  **“novelinhas sem limite”** (o manifesto do app também). A rota `#/peca/ID` virou `#/novelinha/ID` e `#/admin/pecas` virou `#/admin/novelinhas`; os links antigos
  (e-mails já enviados, favoritos, app instalado) continuam abrindo. **Não** foram renomeados: o modelo `Play` do banco, os caminhos `/api/plays` e os nomes de variáveis no código
  (renomear exigiria migração de banco e não muda nada para o usuário), nem os nomes dos planos (Plateia, Balcão, Camarote), que são dados do banco.
- **Vitrine do dia:** as fileiras da home e o catálogo de cada gênero são **embaralhados todo dia à 00:00** (fuso `SHUFFLE_TZ`, padrão `America/Sao_Paulo`) e **só dentro do próprio gênero**:
  os gêneros nunca se misturam. Não há cron nem coluna nova: a ordem é calculada a partir de `data + gênero` (`src/utils/dailyOrder.js`), então vira sozinha na meia-noite, é a mesma em
  qualquer instância do servidor e funciona mesmo com a hospedagem "dormindo". O sorteio vale para o gênero inteiro (não só as 20 mais novas), então a vitrine realmente parece nova.
  "Novos Na Plataforma" continua por data de postagem (é o que o nome promete), assim como o catálogo sem gênero e qualquer ordenação escolhida no filtro ("Padrão" = ordem do dia).
  O navegador não mostra a vitrine de ontem: a resposta traz `shuffleDay`/`shuffleTz` e o site atualiza ao abrir ou voltar à aba depois da virada do dia.
- **Pop-up de assinatura:** aparece **30 s** depois do site abrir, para **visitantes e contas sem plano pago ativo** (gratuito ou vencido), a cada acesso (nada é gravado no navegador).
  Mostra o baralho de capas (o **mesmo** da tela Surpresa, com capas sorteadas entre todas as novelinhas), o preço real do plano pago mais barato e o botão **Ver planos**.
  Ao fechar (×, "Agora não", Esc ou clique fora) ele **encolhe e vira um mini pop-up fixo no canto**, com miniaturas das capas e animação de "pulinho"
  (desligada para quem pede menos movimento); o × do mini dispensa a oferta até o próximo acesso. Não interrompe quem está assistindo (player), em Planos ou nas telas de
  login/cadastro: espera uma tela livre. Sem urgência falsa (nada de contagem regressiva, desconto ou "últimas vagas" inventados).
- Testes novos: `daily-order`, `random` (servidor) e `tests/smoke/conversion.smoke.js` (pop-up). Os testes não dependem mais do dia em que rodam.

### Correções de celular, "Em alta", novo login e barra flutuante (2026-10-21)
- **Clicou, assistiu:** os cards (home, catálogo, busca, lista) abrem **direto no player**. Novelinha bloqueada pelo plano ou sem vídeo continua abrindo a página da novelinha. A ficha da novelinha fica no botão ⓘ do player.
- **Player no celular:** o título e a sinopse **saem de cima do vídeo** quando ele toca (continuam no botão ⓘ). A **tela cheia** tenta, nesta ordem: tela cheia nativa do palco (e gira a tela se o vídeo for deitado), player nativo do vídeo (iPhone) e, por último, tela cheia por CSS. O manifesto passou a permitir rotação (`orientation: any`), senão o app instalado não podia ficar deitado.
- **Balão de instalar o app:** é reavaliado quando o navegador libera a instalação (antes só decidia uma vez, aos 6 s). Funciona no Android (botão), no iPhone com Safari **ou Chrome** (passo a passo do Compartilhar) e em celulares sem aviso nativo (passo a passo do menu). Some por 3 dias ao fechar, nunca aparece em app já instalado nem por cima do player, e o link "Instalar o app" do rodapé sempre funciona.
- **"Em alta"** no topo do catálogo (`GET /api/plays/trending`): ranking dos últimos 30 dias por atividade (quem começou a assistir vale 2, quem salvou na lista vale 1). Com pouca atividade completa com os destaques e as novelinhas mais novas. Some quando há gênero ou filtro escolhido.
- **Login, cadastro e recuperação de senha** no novo visual (cartão de vidro, campos arredondados, botões em pílula, capas reais das novelinhas embaixo) e com proteção contra clique duplo. O desenho veio de um componente React/Tailwind; como o site é HTML/JS puro, ele foi **portado** para o CSS do projeto.
- **Barra de navegação flutuante** embaixo, em todas as telas públicas, com indicador que desliza até a aba ativa. **Todos os botões que ficavam no topo moram nela**: Início, Catálogo,
  **Buscar** (a lupa), Surpresa, Lista (minha lista), **Assinar** (dourado, só para quem não tem plano pago ativo), **Conta** (mostra as iniciais da pessoa) e, para o administrador, Admin.
  Visitantes veem **Entrar** e **Criar conta** no lugar de Lista/Assinar/Conta. Com 7 ou mais itens a barra entra no modo "denso" (letras menores no celular, mais larga no computador).
  O topo ficou só com a marca; o menu, o hambúrguer, a gaveta, a lupa, o sino e o avatar foram removidos.
- **`memory.md`** guarda o contexto do projeto para retomar o trabalho e o **`CLAUDE.md`** manda o Claude Code lê-lo primeiro e atualizá-lo ao final.
- Testes de fumaça novos: `tests/smoke/mobile.smoke.js` (login e balão de instalar); ampliados `storyreel`, `app` e `phase2`.

### Filtros do catálogo e tela Surpresa
- **Filtros** (botão ao lado dos chips de gênero, em `#/catalogo`): abre uma gaveta com **Ordenar por** (mais recentes, título A–Z, ano, mais longas,
  mais curtas), **Gênero**, **Ano** e **Plano**. Os anos e planos listados são só os que têm novelinhas (com a contagem). O botão mostra quantos filtros
  estão ativos; **Limpar** zera tudo. Esc ou clique fora fecham sem aplicar. O servidor aceita `?sort=`, `?year=` e `?plan=` em `GET /api/plays`
  (valores inválidos são ignorados) e `GET /api/plays/facets` devolve as opções.
- **Surpresa** (`#/surpresa`): baralho de capas e o botão **Sortear novelinha**. O sorteio é feito no servidor (`GET /api/plays/random`) entre **todas** as
  novelinhas cadastradas, sem limite de data (antes só valiam as 100 mais recentes). Nunca repete a anterior e oferece **Assistir** (abre o StoryReel),
  **Ver planos** (quando a sorteada é de um plano que a pessoa não tem) ou **Minha lista**.
- A barra inferior do celular agora é Início, Catálogo, **Surpresa**, Minha lista e Conta; a lupa de pesquisa fica no topo de todas as telas.
- O **rodapé mostra a versão** (`vAAAA.MM.DD-fase2`): serve para conferir se a hospedagem já publicou a versão nova.

### Navegação estilo app: pesquisa, continuar assistindo, minha lista
- **Barra inferior (celular):** Início, Catálogo, Buscar, Minha lista e Conta. No computador o menu do topo continua, agora com “Minha lista”.
  Quem ainda não tem plano pago vê o botão **Assinar** ao lado da lupa.
- **Pesquisa** (`#/buscar`): resultados enquanto digita, buscas recentes e “Ver mais”. No servidor (`GET /api/plays?search=`) a busca
  **ignora acentos e maiúsculas** (o `contains` do Postgres diferenciava os dois) e procura em **título, direção e elenco**, mostrando antes
  o que bate no título.
- **Continue assistindo:** primeira fileira da home para quem está logado, com barra de progresso e “23min restantes”. Tocar retoma o vídeo
  no StoryReel de onde parou; o **X** tira a novelinha da fileira. Usa o progresso que o StoryReel já salva (`/api/me/progress`).
- **Minha lista** (`#/minha-lista`): o coração nos cards e na página da novelinha salva/remove (`/api/me/list`). Visitantes são levados ao login.
- **Setas nas fileiras** aparecem no computador ao passar o mouse.
- Testes: `npm test` (inclui a pesquisa do servidor). Os de fumaça (`tests/smoke/app.smoke.js` e `storyreel.smoke.js`) rodam o site num DOM
  simulado: `npm install --no-save jsdom && node tests/smoke/app.smoke.js`.

### Player StoryReel (vídeo em tela cheia, estilo Reels/TikTok)
Ao clicar em **Assistir** (na página da novelinha) ou em **Assistir agora** (banner da home), o vídeo abre em `#/reel/ID`:
uma novelinha por tela, e é só **deslizar para cima/baixo** para a próxima. Feito com **Plyr** (controles) + **hls.js** (`.m3u8`)
e **`scroll-snap` em CSS puro**, sem framework.
- **Quem entra no feed:** a novelinha escolhida primeiro, depois as outras que a pessoa **pode assistir** e que já têm vídeo.
  Se a novelinha escolhida estiver bloqueada pelo plano, ela aparece com o aviso e o botão **Ver planos**.
- **Só a tela ativa carrega o vídeo.** As demais mostram só a capa; ao trocar de tela o player anterior é destruído.
  O link do vídeo é pedido a `/api/plays/:id` na hora, então quem não tem direito nunca recebe o link.
- **Formatos de link:** `.m3u8` (HLS), `.mp4`/`.webm` direto e YouTube. Vídeo **horizontal (16:9)** fica numa caixa sobre a capa borrada;
  vídeo **vertical (9:16)** é detectado sozinho e ocupa a tela toda.
- **Continuar assistindo:** quem está logado tem a posição salva a cada ~15 s (`PUT /api/me/progress/:id`) e a novelinha retoma de onde parou.
  Ao terminar, o reel avança sozinho para a próxima. Visitantes não salvam progresso.
- **Som:** o navegador pode bloquear áudio automático (comum no iPhone); nesse caso o vídeo começa mudo e o botão de som ativa.
- **Teclado (computador):** `↑`/`↓` troca de novelinha, `Espaço` pausa, `←`/`→` volta/avança 10 s, `M` som, `F` tela cheia, `I` detalhes, `Esc` volta.
- **Dependência externa:** Plyr vem do jsDelivr (versão fixa 3.7.8), como o hls.js. Se o Plyr não carregar, vídeos `.m3u8`/`.mp4` ainda tocam
  com os controles do navegador e o YouTube volta ao iframe simples.
- Testes: `npm test` cobre a lógica; o teste de fumaça (`npm install --no-save jsdom && node tests/smoke/storyreel.smoke.js`)
  roda o site num DOM simulado.

### Excluir todas as séries de um plano
Em **Novelinhas → Excluir séries de um plano** você escolhe o plano (cada um mostra quantas séries tem) e **todas** as séries
que exigem esse plano são **excluídas definitivamente** — por exemplo, tudo de Camarote ou tudo de Plateia.
- O plano em si **não** é apagado, só as séries dele. As séries dos outros planos não são tocadas.
- Duas travas contra acidente: é preciso **digitar o nome do plano** para o botão liberar (“Excluir 3 séries”),
  e há uma confirmação final. O servidor também confere a quantidade mostrada: se ela mudou enquanto a janela
  estava aberta, recusa e pede para abrir de novo.
- **Não há desfazer.** Junto saem os gêneros, o progresso de quem estava assistindo e a presença na “Minha lista”.
  Os vídeos hospedados fora (Bunny, Supabase…) **não** são apagados de lá; só deixam de aparecer no site.
- Para só trocar o plano das séries sem apagar, use **Mover séries de plano**.

Em **Cadastrar várias novelinhas**, o campo **Plano exigido para assistir às séries deste lote** já vem em **Balcão**
(dá para trocar antes de enviar).

### Gêneros do catálogo (várias seções por série)
O catálogo usa estes gêneros (eles **substituem** os antigos Drama, Comédia, etc.):
**Dublados · 🇧🇷 Brasileiras · 🤖 IA · Animes · BL & GL · Identidade Escondida · Amor à Primeira Vista ·
Bebês e Gravidezes · Relacionamento Tabu · Homem-lobo🐺 e Vampiro🧛**.
- **Novos Na Plataforma** não é um gênero que você marca: é uma seção **automática** (a primeira da página
  inicial) com as séries mais recentes, na ordem em que foram adicionadas.
- Uma série pode ter **vários gêneros** e **aparece em todas as seções** correspondentes. Seções sem séries não aparecem.
- Em **Nova novelinha / editar**, marque quantas caixas quiser. No cadastro em lote, o site sugere gêneros pelo título
  (palavras-chave; é só uma sugestão — não é uma IA lendo a série — e dá para corrigir depois).
- Séries que já estavam no site ficam, por enquanto, **sem gênero** (aparecem só em “Novos Na Plataforma”) até você
  importar a planilha abaixo.

### Renomear gêneros (sem tirar as séries)
No painel, **Gêneros** (menu lateral) lista os 10 gêneros com o **nome que aparece no site**, quantas séries há em cada
um e o nome original. Edite o nome, clique em **Salvar nome** (ou Enter) e pronto. Dá para usar emoji (até 40 caracteres).
- **Só o nome muda.** As séries ficam ligadas ao gênero por um identificador interno que nunca muda, então nenhuma série
  sai da seção, do filtro ou da planilha por causa da troca de nome.
- O nome novo vale na hora para a página inicial, os filtros do catálogo, os formulários, o painel e os e-mails.
- **Voltar ao original** restaura o nome de fábrica. O site recusa nome vazio, nome igual ao de outro gênero e nomes reservados.
- Na planilha de gêneros, tanto o nome novo quanto o original continuam sendo reconhecidos.
- “Novos Na Plataforma” é uma seção automática e não é renomeável por aqui.

### Atualizar gêneros por planilha (CSV)
Em **Novelinhas → Atualizar gêneros (CSV)** você envia uma planilha com o **nome** da série e o(s) **gênero(s)**:
```
nome;genero
A Farsa do Silêncio;Dublados, Animes
A Farsa do Silêncio;🇧🇷 Brasileiras
Ventos de Dona Flor;BL & GL
```
- O nome é comparado com o título da série ignorando maiúsculas, acentos e `_`/`-`.
- Vários gêneros: na mesma célula (separados por vírgula, ponto e vírgula, `|` ou `/`), em **várias linhas** com o mesmo
  nome, ou em **várias colunas** (`genero_1`, `genero_2`…). Tudo se soma.
- Os gêneros podem vir com ou sem emoji, com “&” ou “e”, no singular ou plural (“Anime”, “BL e GL”, “Brasileira”…).
  “Novos Na Plataforma” na planilha é ignorado (é automático).
- Antes de aplicar, o site mostra uma **prévia** (quantas séries serão atualizadas, quantas em cada gênero, nomes que não
  foram encontrados, gêneros não reconhecidos) **sem alterar nada**.
- Modo **Substituir** (recomendado) troca os gêneros das séries da planilha; modo **Acrescentar** mantém os que já tinham.
  Série que aparece na planilha só com gêneros não reconhecidos **não é alterada**. A aplicação é “tudo ou nada”.
- Funciona com CSV do Excel (acentos) e aguenta planilhas grandes (até 50.000 linhas).

### Capas e vídeos em massa por planilha (CSV)
Ideal para quando o material **já está hospedado** (capas e vídeos que você já tem em algum servidor).
Em **Novelinhas → Cadastrar várias novelinhas**, use o campo **Planilha de capas e vídeos**:

```
nome;url_capa;url_video;duracao
A Farsa do Silêncio;https://SEU-PROJETO.supabase.co/storage/v1/object/public/capas/farsa.png;https://SEU-CDN.b-cdn.net/GUID-1/playlist.m3u8;82
Ventos de Dona Flor;https://SEU-PROJETO.supabase.co/storage/v1/object/public/capas/dona-flor.jpg;https://exemplo.com/videos/dona-flor.mp4;95
```
- Colunas: **nome**, **url_capa**, **url_video** (link direto do vídeo) e **duracao** em minutos (opcional).
  Vírgula ou ponto e vírgula; com ou sem cabeçalho (sem cabeçalho, a ordem é a acima); aceita CSV do Excel.
  `url_capa` e `url_video` são opcionais, mas cada linha precisa ter pelo menos uma das duas.
- **Linha com `url_video`** vira uma novelinha pronta na lista do lote, **sem enviar arquivo**: a capa e o
  link do vídeo são gravados direto. Basta clicar em **Iniciar cadastro em lote**.
- **Links de vídeo que tocam no player**: `.m3u8` (HLS, ex.: Bunny Stream), `.mp4`/`.webm` direto e YouTube.
  Páginas (Google Drive, Dropbox, Vimeo, embed do Bunny) **não tocam**: a tela avisa. Para o Drive, use o
  campo de links do Google Drive do mesmo modal (o Bunny busca o arquivo).
- **Linha só com `url_capa`**: continua como antes — quando o nome for igual ao título de um vídeo da lista
  (escolhido do computador ou colado como link do Drive), a capa é preenchida sozinha. O site compara
  ignorando maiúsculas, acentos, `_` e `-`; mostra uma **miniatura** de cada capa e avisa das que sobraram.
- Se o mesmo nome já estiver na lista com um vídeo (arquivo ou Drive), o `url_video` da planilha é ignorado
  e o aviso aparece. Sem `duracao`, entra 60 min (mínimo do site); ajuste na lista antes de cadastrar.
- Nesse lote, a **sinopse** entra como `.` e o **banner** fica vazio (a página inicial usa a capa como reserva).
- As URLs precisam ser **públicas** e começar com `http://` ou `https://` (o servidor também recusa
  `videoUrl` que não seja assim). Se a miniatura não aparecer, o link da capa está errado ou é privado.
- Nome repetido na planilha: vale a primeira linha. Links inválidos são ignorados e listados.

### Cadastro em lote (várias novelinhas de uma vez)
Em Novelinhas → "Cadastrar várias novelinhas": escolha vários arquivos de vídeo do
computador, ou cole vários links (formato acima), ou combine os dois. Cada
vídeo vira uma novelinha com **título (do nome do arquivo), duração (detectada
automaticamente) e gênero (sugerido por palavras-chave no título)** —
mas ainda **sem sinopse, elenco nem pôster definitivos**: depois do lote,
edite cada novelinha criada para completar esses detalhes.

### Sugestão automática de gênero
Ao digitar o título (ou escolher o arquivo de vídeo), o campo Gênero é
preenchido sozinho com base em palavras-chave (ex: "amor" → Romance, "riso"
→ Comédia). É uma regra simples, não uma IA lendo a novelinha de verdade — então
erra às vezes, principalmente em títulos que não dão pistas óbvias. Sempre dá
pra corrigir manualmente antes de salvar.

### Paginação
O catálogo público e a lista de novelinhas do painel admin agora carregam por
páginas (não tudo de uma vez), então o site continua rápido mesmo com um
catálogo grande.

### Configurar o upload automático de vídeo (Bunny.net Stream)
Com isso configurado, o admin pode enviar o arquivo de vídeo direto pela tela
"Nova novelinha", sem precisar entrar no site do Bunny nem copiar link nenhum.

1. Crie uma conta em **bunny.net** e, em **Stream**, crie uma "Video Library".
2. Dentro da biblioteca, vá em **API** e anote: o **Library ID** (um número) e a
   **API Key** da biblioteca.
3. Ainda no painel do Bunny, ache o hostname de entrega da biblioteca (geralmente
   em "Overview" ou na aba de Pull Zone, algo como `vz-xxxxxxxx.b-cdn.net`).
4. No Render (ou no seu `.env` local), adicione três variáveis de ambiente:
   ```
   BUNNY_LIBRARY_ID="123456"
   BUNNY_API_KEY="sua-chave-aqui"
   BUNNY_CDN_HOSTNAME="vz-xxxxxxxx.b-cdn.net"
   ```
5. Pronto — na tela "Nova novelinha", o campo "Ou envie o arquivo de vídeo direto para
   o Bunny.net" já funciona: escolha o arquivo, clique em "Enviar vídeo", acompanhe
   a barra de progresso, e a URL do vídeo é preenchida sozinha quando terminar.
   O vídeo ainda leva alguns minutos pra processar no Bunny antes de ficar
   disponível pra assistir — pode salvar a novelinha normalmente enquanto isso.

> O upload vai **direto do navegador para o Bunny** (não passa pelo servidor do
> Render), então funciona mesmo com vídeos grandes e não é afetado pelos limites
> do plano gratuito do Render.

### Cadastrar uma novelinha
1. Vá em **Novelinhas** → **+ Nova novelinha**.
2. Preencha: título, gênero, ano, **duração em minutos (mínimo 60 — obrigatório)**,
   sinopse/resumo, diretor(a) e elenco.
3. Cole o **link do pôster** (imagem vertical) e da **imagem de destaque** (horizontal,
   usada no banner). Pode usar links de imagens públicas (Unsplash, por exemplo).
4. O **vídeo**: use o upload automático (acima) — ou, se preferir, cole manualmente
   um link .m3u8, um .mp4 direto, ou um link do YouTube no campo de URL.
5. Escolha o **plano mínimo exigido** para assistir (Plateia, Balcão ou Camarote).
6. Marque "Destacar na página inicial" se quiser que ela apareça no banner rotativo.
7. Salvar. A novelinha já aparece no catálogo e (se marcada) no banner da home.

### Login e senha dos usuários
Já funciona de verdade: qualquer visitante cria conta pelo botão **Criar conta**
(nome, e-mail, senha) e faz login normalmente. As senhas são armazenadas com hash
(nunca em texto puro) no banco de dados.

### Planos
Em **Planos**, você edita nome, preço e benefícios de cada plano, ou cria um novo — **o valor
cobrado no PIX sempre é o preço cadastrado aqui** (o navegador nunca decide o valor).
Em **Usuários**, o admin ainda tem controle total: trocar o plano de alguém, estender a validade
em 30 dias ou bloquear a conta (útil para cortesias ou para corrigir algo manualmente).
Em **Pagamentos**, você vê todas as cobranças (pagas, aguardando, expiradas) e a receita dos últimos 30 dias.

## 4. Pagamentos (SyncPay), e-mails e app instalável

### 4.1 Variáveis de ambiente no Render
Além das que você já tem (`DATABASE_URL`, `JWT_SECRET`, `BUNNY_*`), adicione em **Environment**:

| Variável | O que é |
|---|---|
| `SITE_URL` | Endereço do site, sem barra no final (ex.: `https://mini-drama-71ei.onrender.com`) |
| `SYNCPAY_CLIENT_ID` / `SYNCPAY_CLIENT_SECRET` | Credenciais da SyncPay |
| `SYNCPAY_WEBHOOK_SECRET` | Texto longo e aleatório (você inventa). Vira parte do endereço do webhook |
| `BREVO_API_KEY` / `MAIL_FROM_EMAIL` / `MAIL_FROM_NAME` | Envio de e-mails (4.4) |
| `CRON_SECRET` | Senha do agendador diário (4.5) |

Depois do deploy, as tabelas novas (`Payment`, `EmailLog`) e as colunas novas são criadas sozinhas.

### 4.2 Pagamento por PIX (SyncPay)
Fluxo: usuário escolhe **Balcão** ou **Camarote** → informa CPF e celular → o site gera o PIX
(QR Code + copia e cola) → assim que o banco confirma, o plano é liberado por **30 dias**
automaticamente e o pagamento fica registrado (data, valor, validade). Se a pessoa não pagar ou
cancelar, **nada é liberado**.

**Como é protegido contra fraude** (tudo testado — `npm test`):
- O **valor vem do banco**, nunca do navegador. Mexer na página não muda o preço.
- O plano só é liberado depois que **o nosso servidor consulta a SyncPay** (autenticado) e ela
  confirma `completed` com valor igual ou maior. O corpo do webhook **não é confiado**: um
  webhook falso só faz o servidor perguntar à SyncPay, que responde a verdade.
- O endereço do webhook contém um segredo (`SYNCPAY_WEBHOOK_SECRET`); chamadas sem ele são ignoradas.
- A liberação é **atômica e única**: webhook duplicado ou simultâneo não dá 60 dias por engano.
- Limite de tentativas (checkout, login, cadastro) contra abuso; CPF validado; um usuário só vê os próprios pagamentos.
- Se o webhook não chegar (servidor dormindo), o navegador acompanha o status e a rotina diária
  confere pagamentos das últimas 48h.
- Renovar o **mesmo plano** antes de vencer **soma** 30 dias ao que sobrou; trocar de plano conta a partir do pagamento.

**Para ligar (checklist):**
1. Pegue `Client ID` e `Client Secret` no painel da SyncPay e coloque no Render.
2. **IP autorizado:** a documentação da SyncPay diz que **IP e chave de API precisam ser autorizados**.
   No Render, abra o serviço → **Connect → Outbound** para ver os IPs de saída e peça/cadastre a
   liberação na SyncPay. Se a cobrança falhar com erro de autorização, é quase certo que é isso.
3. **Primeiro teste real:** em **Admin → Planos**, deixe o Balcão temporariamente em **R$ 1,00**,
   assine pelo site, pague o PIX com o seu banco e confirme que o plano liberou sozinho. Depois volte o preço.
4. Estornos/chargebacks **não** removem o plano automaticamente: se acontecer, remova em **Admin → Usuários**.

> Limite honesto: o teste automático cobre a nossa lógica com a SyncPay simulada. A integração real
> (credenciais, IP, formato exato das respostas) só pode ser confirmada no primeiro pagamento de verdade.

### 4.3 E-mails automáticos (Brevo)
1. Crie conta grátis em **brevo.com** (300 e-mails/dia).
2. Em **Senders**, cadastre e **verifique** o e-mail remetente (clique no link que a Brevo envia).
3. Em **SMTP & API → API Keys**, crie uma chave e coloque em `BREVO_API_KEY`; o remetente em `MAIL_FROM_EMAIL`.
4. No painel admin → **Visão geral → Sistema → “Enviar e-mail de teste”**.

> Dica: remetentes `@gmail.com` costumam cair no spam. O ideal é um domínio próprio (a Brevo ensina a
> configurar SPF/DKIM). O Render gratuito bloqueia SMTP, por isso usamos a API da Brevo.

| E-mail | Quando é enviado |
|---|---|
| Boas-vindas | Ao criar a conta |
| Resumo de novidades | No máximo 1x/dia, **só se** entraram novelinhas novas desde o último e-mail (conta quantas) |
| Aviso de vencimento | 3, 2 e 1 dia antes (só planos pagos) + um aviso quando vence |
| Sentimos sua falta | Quando a pessoa fica 7 dias sem entrar (repete a cada 7 dias) |
| Nova obra em destaque | Quando uma obra entra no banner da home |
| Pagamento confirmado | Assim que o PIX é confirmado |

Regras: e-mails de divulgação têm link de **descadastro** (e a pessoa também pode desligar em Minha conta);
avisos de vencimento e comprovantes continuam sempre. Ninguém recebe o mesmo e-mail duas vezes, o limite
diário (`EMAIL_DAILY_LIMIT`) é respeitado e quem recebeu uma divulgação nas últimas 20h não recebe o resumo no mesmo dia.

### 4.3.1 "Esqueci minha senha" (recuperação por e-mail)
Na tela de login há o link **Esqueci minha senha**. A pessoa digita o e-mail, recebe um link, escolhe a nova senha.
- **Depende dos e-mails (4.3):** sem a Brevo configurada, o site avisa que a recuperação ainda não está ativa.
- O link vale **60 minutos** e só pode ser usado **uma vez**; pedir um novo link invalida o anterior.
- O site responde igual exista a conta ou não (ninguém descobre quem tem cadastro) e limita os pedidos
  (3 e-mails/hora por endereço, 8/hora por IP).
- No banco ficam só o **hash** do link, nunca o link em si.
- Depois de trocar a senha (por recuperação ou em **Minha conta**), **os logins antigos deixam de valer**
  e a pessoa recebe um e-mail avisando da alteração.
- **Atenção com o admin:** a conta criada pelo seed usa `admin@minidrama.app`, que não é uma caixa de entrada real,
  então ela **não consegue** receber o link. Para ter um admin recuperável, rode o seed com `ADMIN_EMAIL` (um e-mail seu
  de verdade) e `ADMIN_PASSWORD`, entre com essa conta e, na conta antiga, troque a senha por uma bem longa.

### 4.4 Agendador gratuito (obrigatório) — e site sempre rápido
O Render gratuito “dorme” quando ninguém acessa — por isso um agendador **externo** é necessário
(o servidor dormindo não consegue disparar nada sozinho). Crie conta grátis em **cron-job.org** e 2 tarefas:

1. **A cada 10 minutos:** `GET https://SEU-SITE/api/health` → mantém o servidor acordado (o site abre rápido).
   O plano gratuito do Render dá ~750 horas/mês, o que cobre 1 serviço ligado 24h.
2. **1x por dia (ex.: 10h):** `GET https://SEU-SITE/api/cron/daily?key=SEU_CRON_SECRET`
   → avisos de vencimento, destaques, saudade, resumo e conferência de pagamentos.

### 4.5 Velocidade e app instalável
- **Primeira pintura instantânea** (esqueleto), catálogo guardado no aparelho (2ª visita abre na hora),
  imagens com cache longo, site compactado (gzip) e imagens enviadas por arquivo **fora** da listagem.
- **App instalável (PWA):** no Android/Chrome aparece o convite “Instale o app Mini Drama”; no iPhone
  o site ensina “Compartilhar → Adicionar à Tela de Início”. Também há “Instalar o app” no rodapé.
  Exige HTTPS (o Render já fornece).

### 4.6 Checklist de segurança antes de divulgar o link
- [ ] Troque a senha do admin (**Minha conta → Alterar senha**) e use uma senha forte.
- [ ] Em **Admin → Usuários**, **bloqueie** a conta `convidado@minidrama.app` se ela existir (era uma conta de teste com senha conhecida).
- [ ] `JWT_SECRET`, `SYNCPAY_WEBHOOK_SECRET` e `CRON_SECRET` são textos longos e aleatórios.
- [ ] O arquivo `.env` **não** está no GitHub (o `.gitignore` já impede).
- [ ] `npm test` passa.
- [ ] Os links “Termos de uso” e “Privacidade” do rodapé ainda são **placeholders**. Como o site coleta
      nome, e-mail e CPF, publique uma política de privacidade antes de abrir ao público (exigência da LGPD).

---

## Estrutura do projeto

```
mini-drama/
├── prisma/
│   ├── schema.prisma      → modelos do banco (User, Play, Plan)
│   └── seed.js            → dados iniciais (admin, planos, novelinhas de exemplo)
├── public/
│   └── index.html         → todo o front-end (single-page app)
├── src/
│   ├── index.js            → servidor Express (liga tudo)
│   ├── prismaClient.js     → conexão com o banco
│   ├── middleware/auth.js  → login obrigatório / checagem de admin
│   ├── routes/
│   │   ├── auth.js         → cadastro, login, /me
│   │   ├── plays.js        → catálogo, detalhe, CRUD de novelinhas
│   │   ├── plans.js        → CRUD de planos
│   │   └── users.js        → gestão de usuários (admin)
│   └── utils/               → regras de nível de plano e JWT
├── .env.example
└── package.json
```

## Dúvidas comuns

**"Failed to fetch" ao abrir o site.** O servidor não está rodando ou o
`DATABASE_URL` está errado. Confira as variáveis de ambiente.

**Quero trocar o nome/cores do site.** No `public/index.html`, a constante
`SITE_NAME` no topo do `<script>` troca o nome em todo o site. As cores estão
nas variáveis CSS `:root` no topo do `<style>` (`--curtain`, `--gold`, etc.).

**Posso usar SQLite em produção para simplificar?** Pode, mas em hospedagens
como o Render o disco do plano free não é permanente — a cada novo deploy os
dados cadastrados (novelinhas, usuários) somem. Por isso o guia usa PostgreSQL (Neon)
para produção, que é persistente de verdade.
