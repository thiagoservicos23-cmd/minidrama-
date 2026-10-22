# Memória de Contexto do Projeto

> Leia este arquivo ANTES de qualquer coisa ao retomar o trabalho. Atualize-o ao final de cada tarefa.
> Última atualização: 2026-10-21

## 📌 Status Atual e Objetivo Geral
- **Mini Drama**: plataforma de streaming de **peças de teatro** (projeto acadêmico: turma de Teatro produz o conteúdo, turma de Tecnologia faz o site). É um site/PWA com planos de assinatura (Plateia grátis, Balcão, Camarote), pagamento por PIX e vídeos hospedados fora (Bunny Stream/HLS, mp4 direto ou YouTube).
- **Estado em 2026-10-21**: tudo abaixo está implementado e testado em simulador (jsdom), **mas nada foi visto num navegador/celular de verdade**.
  - StoryReel (player vertical estilo Reels), pesquisa, "Continue assistindo", "Minha lista", filtros do catálogo, tela Surpresa, "Em alta" no topo do catálogo.
  - Correções de celular: título não fica mais na frente do vídeo, tela cheia de verdade, balão de instalar o app, card abre direto no player.
  - Visual novo: tela de login (e cadastro/recuperação) e **barra de navegação flutuante embaixo** (em todas as telas públicas).
- A versão publicada aparece no **rodapé** do site (`v2026.10.21-mobile`): use para conferir se o deploy novo está no ar.

## 🛠️ Arquitetura e Decisões Técnicas
- **Back-end:** Node ≥18, Express 4, Prisma 5 + **PostgreSQL** em produção (ex.: Neon), JWT (`jsonwebtoken`) + `bcryptjs`, `helmet`, `compression`, `cors`. Pagamento **SyncPay (PIX)**, e-mails **Brevo**, upload de vídeo via **Bunny Stream**. Variáveis em `.env.example`.
- **Front-end:** UM arquivo, `public/index.html` (~3,4 mil linhas): SPA em JS puro com roteamento por hash (`#/home`, `#/catalogo`, `#/peca/ID`, `#/reel/ID`, `#/buscar/termo`, `#/surpresa`, `#/minha-lista`, `#/conta`, `#/planos`, `#/login`, `#/cadastro`, `#/admin…`). **Sem React, Tailwind, TypeScript nem build.** PWA: `manifest.webmanifest` + `sw.js`.
- **Testes:** `npm test` (`node --test`) para o servidor/lógica; testes de fumaça em `tests/smoke/*.smoke.js` rodam o `index.html` real num DOM simulado (precisa `npm install --no-save jsdom`).
- **Decisões críticas (e por quê):**
  - **Vídeo nunca vai na listagem.** `GET /api/plays` não traz `videoUrl`; só `GET /api/plays/:id` e só para quem tem direito ao plano. Quem não tem direito nunca recebe o link.
  - **Componentes React dos prompts foram PORTADOS, não copiados** (login "modern sign-in" e "floating-nav"): o projeto não usa React/Tailwind/shadcn e migrar tudo por causa de duas telas seria arriscado. O desenho foi reescrito em CSS/JS puro. Sem botão de Google (não há OAuth no servidor) e sem "avatares" inventados (a prova social usa capas reais e a contagem real de peças).
  - **StoryReel:** Plyr 3.7.8 + hls.js 1.5.13 (jsDelivr), `scroll-snap` em CSS puro; **só a tela ativa monta o player** (memória/banda). Tela cheia em 3 níveis: nativa no palco → `<video>` nativo (iPhone) → CSS (`.is-fs`). Título/sinopse somem de cima do vídeo quando ele toca (`.reel-stage.is-live ~ .reel-info`).
  - **Progresso:** o reel salva a posição a cada ~15 s (`PUT /api/me/progress/:id`); ≥95% conta como terminado. "Continue assistindo" lê `GET /api/me/home`.
  - **Pesquisa** normaliza acento/caixa **em memória** no servidor (o `contains` do Postgres diferencia os dois). Serve para catálogos de até alguns milhares de peças.
  - **"Em alta"** (`GET /api/plays/trending`) = atividade dos últimos 30 dias (quem começou a assistir ×2 + quem salvou ×1), sem mudar o schema; se houver pouca atividade completa com destaques e as mais novas (`ranked` diz quantas foram reais).
  - **Cache do app:** a cada mudança no front, subir `VERSION` em `public/sw.js` (hoje `md-v8`) e `APP_VERSION` em `public/index.html`.
  - **Manifesto com `orientation: "any"`**: `"portrait"` impedia a tela cheia deitada no app instalado.
  - **Balão de instalar:** `installBannerMode()` é função pura; reavalia quando o navegador libera `beforeinstallprompt` (antes só decidia uma vez, aos 6 s); cobre iPhone (Safari e Chrome) e Android sem aviso nativo; some por 3 dias ao fechar; nunca aparece sobre o reel.
  - **Navegação por cards:** card de peça liberada abre direto em `#/reel/ID`; bloqueada/sem vídeo abre `#/peca/ID`. A página da peça segue existindo (ficha pelo botão ⓘ do reel).

## 📜 Histórico de Modificações (Últimas Sessões)
- **2026-10-20:** importação por CSV com `url_video`; excluir todas as peças de um plano (com confirmação); StoryReel; pesquisa sem acento; Continue assistindo; Minha lista; filtros do catálogo (`sort/year/plan`, `/plays/facets`); tela Surpresa. Arquivos: `public/index.html`, `src/routes/plays.js`, `public/sw.js`, testes novos.
- **2026-10-21:** correções de celular + redesign.
  - `public/index.html`: player (título oculto ao tocar, tela cheia nativa/iPhone/CSS, botão ⛶ no celular), balão de instalar reescrito, cards diretos no player, "Em alta" no catálogo, login/cadastro/recuperação no novo visual (+ proteção contra clique duplo), barra flutuante embaixo (removidos menu do topo, hambúrguer, gaveta e a barra antiga), `form.elements.X` nos formulários de recuperação.
  - `public/manifest.webmanifest` (orientação livre), `public/sw.js` (`md-v8`).
  - `src/routes/plays.js`: `GET /trending`; `?sort=` agora só aceita chaves próprias (antes `?sort=constructor` quebrava a consulta).
  - Corrigido bug da fase 1: avisos (`#toast-host`) e balão ficavam por baixo da barra inferior (regra base vinha depois da regra do `@media`).
  - Testes novos: `trending`, `install-banner`, `smoke/mobile`, ampliados `storyreel`/`app`/`phase2` smoke.

## 🚀 Próximos Passos (Onde Paramos)
1. [ ] **Testar em aparelho real** (Android Chrome, iPhone Safari, app instalado): tela cheia, rotação, balão de instalar, reel, barra flutuante, login. Os testes atuais não cobrem layout, autoplay nem o Plyr real.
2. [ ] Conferir no site publicado que o rodapé mostra `v2026.10.21-mobile` (se mostrar versão antiga: deploy não rodou ou cache do navegador/service worker).
3. [ ] Se "Em alta" ficar fraco com poucos usuários, considerar contador de visualizações (exige migração Prisma e rota de registro).
4. [ ] Login com Google só se for criado OAuth no servidor (hoje não existe).
5. [ ] Avaliar leitor de tela na barra flutuante e no reel (rótulos já existem, falta validar de verdade).

## ⚠️ Débito Técnico e Notas Importantes
- `public/index.html` é monolítico; se continuar crescendo, separar em módulos.
- `tests/payments.test.js` precisa do módulo `qrcode` (está no `package.json`; rode `npm install` completo).
- Harness jsdom (tests/smoke): `navigator.userAgent` precisa de `Object.defineProperty`; `form.email` não existe no jsdom (use `form.elements.email`); o boot do site precisa terminar (esperar `#site-header`) antes de testar; stubs de `/plays/feed/home`, `/plans`, `/me/home`, `/plays?…`, `/plays/trending`, `/plays/facets`.
- Posições da barra flutuante usam `offsetLeft/offsetWidth` (jsdom não calcula layout; os testes simulam).
- Não tocar em `src/routes/payments.js`/webhook da SyncPay sem rodar os testes de pagamento.
- O `.git` não vai nos zips que o Claude entrega; avisos "LF will be replaced by CRLF" no Windows são inofensivos.
- Todo HTML interpolado no front passa por `esc()`; manter assim.
