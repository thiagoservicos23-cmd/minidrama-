# Memória de Contexto do Projeto

> Leia este arquivo ANTES de qualquer coisa ao retomar o trabalho. Atualize-o ao final de cada tarefa.
> Última atualização: 2026-10-23

## 📌 Status Atual e Objetivo Geral
- **Mini Drama**: plataforma de streaming de **novelinhas** (slogan: “novelinhas sem limite”). Começou como projeto acadêmico de teatro e foi **reposicionada para novelinhas em 2026-10-23**. É um site/PWA com planos de assinatura (Plateia grátis, Balcão, Camarote), pagamento por PIX e vídeos hospedados fora (Bunny Stream/HLS, mp4 direto ou YouTube).
- **Estado em 2026-10-23**: tudo abaixo está implementado e testado em simulador (jsdom), **mas nada foi visto num navegador/celular de verdade**.
  - StoryReel (player vertical), pesquisa, "Continue assistindo", "Minha lista", filtros do catálogo, "Em alta", tela Surpresa, barra de navegação flutuante, login novo.
  - **Novo nicho:** textos, e-mails e metadados em "novelinhas"; rodapé e `meta description` = exatamente “novelinhas sem limite”.
  - **Vitrine do dia:** ordem das novelinhas embaralhada todo dia à 00:00, só dentro de cada gênero.
  - **Pop-up de assinatura** (principal + mini) para quem não tem plano pago ativo, 30 s após abrir o site.
  - **Sorteio** entre TODAS as novelinhas cadastradas (sem limite de data).
- A versão publicada aparece no **rodapé** do site (`v2026.10.23-novelinhas`): use para conferir se o deploy novo está no ar.

## 🛠️ Arquitetura e Decisões Técnicas
- **Back-end:** Node ≥18, Express 4, Prisma 5 + **PostgreSQL** em produção, JWT + `bcryptjs`, `helmet`, `compression`, `cors`. Pagamento **SyncPay (PIX)**, e-mails **Brevo**, upload de vídeo via **Bunny Stream**. Variáveis em `.env.example` (inclui `SHUFFLE_TZ`).
- **Front-end:** UM arquivo, `public/index.html` (~3,6 mil linhas): SPA em JS puro com roteamento por hash (`#/home`, `#/catalogo`, `#/novelinha/ID`, `#/reel/ID`, `#/buscar/termo`, `#/surpresa`, `#/minha-lista`, `#/conta`, `#/planos`, `#/login`, `#/cadastro`, `#/admin/novelinhas`…). **Sem React, Tailwind, TypeScript nem build.** PWA: `manifest.webmanifest` + `sw.js`.
- **Vocabulário:** na interface, e-mails e docs use **novelinha(s)**. Identificadores de código, o modelo Prisma `Play` e as rotas `/api/plays` **continuam em inglês** de propósito (renomear = migração de banco + risco, sem ganho para o usuário). Os nomes dos planos (Plateia/Balcão/Camarote) são dados do banco e a lógica depende dos ids; renomeá-los é decisão de negócio.
- **Testes:** `npm test` (`node --test`) para servidor/lógica; `tests/smoke/*.smoke.js` rodam o `index.html` real num DOM simulado (`npm install --no-save jsdom`). **Testes não podem depender da data de hoje** (a vitrine muda por dia): congele `require("src/utils/dailyOrder").clock.now`.
- **Decisões críticas (e por quê):**
  - **Vídeo nunca vai na listagem.** `GET /api/plays` não traz `videoUrl`; só `GET /api/plays/:id` e só para quem tem direito ao plano.
  - **Vitrine do dia SEM cron:** `src/utils/dailyOrder.js` embaralha com semente = `data (fuso SHUFFLE_TZ, padrão America/Sao_Paulo) + "genre:<id>"`. Vira sozinha à 00:00, é igual em qualquer instância e não exige coluna nova nem agendador (o cron do projeto é externo e o servidor pode estar dormindo). Ordena por id antes de sortear, então não depende da ordem do banco. Cada gênero tem a sua semente: **gêneros nunca se misturam**. A home sorteia o gênero INTEIRO e só depois pega as 20 da fileira.
  - **O que NÃO é embaralhado:** "Novos Na Plataforma" (por data, é o que o nome promete), catálogo sem gênero e qualquer `?sort=` escolhido. Gênero escolhido sem `sort` = ordem do dia (a mesma da fileira da home; filtros de ano/plano mantêm a ordem relativa).
  - **Cache do navegador:** a resposta da home traz `shuffleDay`/`shuffleTz`; o site descarta o cache de outro dia e atualiza ao voltar à aba após a virada.
  - **Sorteio no servidor:** `GET /api/plays/random?count=N&exclude=ID` lê só os ids de TODAS as novelinhas (`src/utils/randomPick.js`) e sorteia; antes o site sorteava entre as 100 mais recentes da listagem. A Surpresa pode sortear novelinha de plano que a pessoa não tem (mostra o plano e "Ver planos").
  - **Pop-up de assinatura:** regra em `convDecision()` (pura). 30 s contados do carregamento do site (um único `setTimeout`), eligível = visitante OU `!hasPaidPlan(user)` (inclui admin sem plano, pela regra literal). Não aparece no player, em `#/planos`, login/cadastro/recuperação nem no admin: espera uma tela livre. Nada é gravado no navegador (volta a cada acesso). O baralho reusa `deckHtml()` da Surpresa. Sem urgência falsa. O balão de instalar o app espera enquanto o principal está aberto.
  - **Em alta** (`GET /api/plays/trending`): atividade de 30 dias (assistindo ×2 + lista ×1), sem mudar o schema; completa com destaques e mais novas.
  - **StoryReel:** Plyr 3.7.8 + hls.js (jsDelivr), `scroll-snap`; só a tela ativa monta o player; tela cheia nativa → `<video>` nativo (iPhone) → CSS; título some de cima do vídeo quando toca. Progresso salvo a cada ~15 s.
  - **Cache do app:** a cada mudança no front suba `VERSION` em `public/sw.js` (hoje `md-v9`) e `APP_VERSION` em `public/index.html`.
  - **Rotas antigas** `#/peca/…` e `#/admin/pecas` redirecionam para as novas (links de e-mails já enviados).
  - **Login/barra flutuante:** componentes React dos prompts foram PORTADOS para CSS/JS puro (o projeto não usa React/Tailwind/shadcn). Sem botão de Google (não há OAuth) e sem avatares inventados.

## 📜 Histórico de Modificações (Últimas Sessões)
- **2026-10-20:** CSV com `url_video`; excluir novelinhas de um plano; StoryReel; pesquisa sem acento; Continue assistindo; Minha lista; filtros do catálogo; tela Surpresa.
- **2026-10-21:** correções de celular (título sobre o vídeo, tela cheia, balão de instalar, card abre direto no player), "Em alta", novo login, barra flutuante, `memory.md`/`CLAUDE.md`.
- **2026-10-23:** reposicionamento para novelinhas + vitrine do dia + pop-up de assinatura + sorteio entre todas.
  - `public/index.html`: textos, rotas `#/novelinha/` e `#/admin/novelinhas` (+ alias), pop-up principal/mini, Surpresa via `/plays/random`, "Padrão" = ordem do dia no filtro, descarte do cache de outro dia.
  - `src/routes/plays.js`: `/feed/home` (ordem do dia por gênero, 1 consulta de pares em vez de 1 por gênero), lista por gênero em ordem do dia, `GET /random`, `GET /trending`.
  - Novos: `src/utils/dailyOrder.js`, `src/utils/randomPick.js`, `tests/daily-order.test.js`, `tests/random.test.js`, `tests/smoke/conversion.smoke.js`.
  - Textos: `src/services/emailTemplates.js` (inclusive metáforas de teatro e emoji 🎭 → 📺), `README.md`, `package.json`, `manifest.webmanifest`, `.env.example` (`SHUFFLE_TZ`).
  - Corrigidos testes que dependiam do dia (`home-feed`, `genre-rename`).

## 🚀 Próximos Passos (Onde Paramos)
1. [ ] **Testar em aparelho real** (Android Chrome, iPhone Safari, app instalado): pop-up e mini (30 s, animação, não atrapalhar o player), tela cheia, balão de instalar, barra flutuante, login. Os testes atuais não cobrem layout real, autoplay nem o Plyr real.
2. [ ] Conferir no site publicado que o rodapé mostra `v2026.10.23-novelinhas` e a `meta description` é “novelinhas sem limite” (se vier versão antiga: deploy não rodou ou cache/service worker).
3. [ ] **Decidir sobre os nomes dos planos** (Plateia/Balcão/Camarote são metáforas de teatro): se quiser trocar, editar o `name` em Admin → Planos (os ids não mudam) e revisar os textos que citam “plano Plateia”.
4. [ ] Dados de exemplo do `prisma/seed.js` ainda têm títulos de estilo teatral ("O Relógio de Antígona"…); só afetam um banco novo, mas vale trocar por novelinhas.
5. [ ] Se "Em alta" ficar fraco com poucos usuários, considerar contador de visualizações (exige migração Prisma).
6. [ ] Avaliar se o pop-up deve aparecer também para administradores (hoje aparece, pela regra literal “sem plano ativo”).

## ⚠️ Débito Técnico e Notas Importantes
- `public/index.html` é monolítico; se continuar crescendo, separar em módulos.
- `tests/payments.test.js` precisa do módulo `qrcode` (está no `package.json`; rode `npm install` completo).
- A ordem das fileiras depende da DATA: nunca escreva teste que espere uma novelinha específica dentro das 20 da fileira sem congelar o relógio ou percorrer todas as páginas.
- O embaralhamento lê todos os ids do gênero a cada requisição (até 5000 por consulta). Está bem para milhares de novelinhas; acima disso, cachear por dia.
- Harness jsdom: `navigator.userAgent` via `Object.defineProperty`; `form.email` não existe no jsdom (use `form.elements.email`); esperar `#site-header`; o jsdom não tem `IntersectionObserver`; para o temporizador de 30 s capture `setTimeout` com `ms === 30000`.
- Não tocar em `src/routes/payments.js`/webhook da SyncPay sem rodar os testes de pagamento.
- O `.git` não vai nos zips; avisos "LF will be replaced by CRLF" no Windows são inofensivos.
- Todo HTML interpolado no front passa por `esc()`; manter assim.
