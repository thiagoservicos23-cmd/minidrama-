# Memória de Contexto do Projeto

> Leia este arquivo ANTES de qualquer coisa ao retomar o trabalho. Atualize-o ao final de cada tarefa.
> Última atualização: 2026-10-26

## 📌 Status Atual e Objetivo Geral
- **Mini Drama**: plataforma de streaming de **novelinhas** (slogan: “novelinhas sem limite”). Começou como projeto acadêmico de teatro e foi **reposicionada para novelinhas em 2026-10-23**. É um site/PWA com planos de assinatura (Plateia grátis, Balcão, Camarote), pagamento por PIX, vídeos hospedados fora (Bunny Stream/HLS, mp4 direto ou YouTube) e **integração completa com a API Drama V2 (Vorta Tech)**.
- **Estado em 2026-10-26**:
  - **Integração API Drama V2 (https://api.vorta.tech):** autenticação HMAC-SHA256 (`METHOD:PATH:TIMESTAMP` + `API_SECRET`), suporte a múltiplas plataformas (FreeReels, MeloShort, ShortMax), streaming HLS adaptativo (.m3u8), navegação e reprodução de episódios/capítulos, busca unificada, seleção de plataformas no catálogo, rastreamento de analytics (`/api/analytics/track`), e sincronização para PostgreSQL pelo painel admin.
  - StoryReel (player vertical), pesquisa unificada, "Continue assistindo", "Minha lista", filtros do catálogo com plataformas, "Em alta", tela Surpresa, barra de navegação flutuante, login novo.
  - Vitrine do dia (ordem rotacionada diariamente por gênero à 00:00).
  - Pop-up de assinatura (principal + mini) para quem não tem plano pago ativo, 30 s após abrir o site.
- A versão publicada aparece no **rodapé** do site (`v2026.10.26-vorta`): use para conferir se o deploy novo está no ar.

## 🛠️ Arquitetura e Decisões Técnicas
- **Back-end:** Node ≥18, Express 4, Prisma 5 + **PostgreSQL** em produção, JWT + `bcryptjs`, `helmet`, `compression`, `cors`. Pagamento **SyncPay (PIX)**, e-mails **Brevo**, upload de vídeo via **Bunny Stream** e **API Vorta Tech (Drama V2)**.
- **API Vorta Tech (`src/services/vortaApi.js` e `src/routes/vorta.js`):**
  - **Autenticação:** HMAC-SHA256 gerado a cada requisição em `X-Signature` e `X-Timestamp` a partir de `${method}:${pathWithQuery}:${timestamp}` usando `VORTA_API_SECRET`.
  - **Controle de Cota (Trial 600/dia):** Cache em memória com TTL inteligente (Categorias: 1h, Banners/Home: 20min, Descoberta: 15min, Detalhes: 30min, Vídeos: 10min, Busca: 10min).
  - **Compatibilidade de Vídeo:** Seleção automática preferindo streams codificadas em H.264 sobre H.265 para compatibilidade universal em navegadores desktop e mobile sem tela preta.
  - **IDs Unificados:** Dramas da Vorta usam o identificador com prefixo `vorta:<plataforma>:<id>` (ex: `vorta:freereels:CSD9qYnFw6`), resolvidos transparentemente em `/api/plays/:id`.
  - **Sincronização Admin:** Rota `POST /api/vorta/sync` permite ao administrador importar lotes de novelinhas para o PostgreSQL local.
- **Front-end:** UM arquivo, `public/index.html`: SPA em JS puro com roteamento por hash (`#/home`, `#/catalogo`, `#/novelinha/ID`, `#/reel/ID`, `#/buscar/termo`, `#/surpresa`, `#/minha-lista`, `#/conta`, `#/planos`, `#/login`, `#/cadastro`, `#/admin/novelinhas`, `#/admin/vorta`). Sem React, Tailwind, TypeScript nem build. PWA: `manifest.webmanifest` + `sw.js` (`md-v11`).
- **Vocabulário:** na interface, e-mails e docs use **novelinha(s)**.
- **Testes:** 150 testes passando (`npm test` com `node --test`).

## 📜 Histórico de Modificações (Últimas Sessões)
- **2026-10-20:** CSV com `url_video`; excluir novelinhas de um plano; StoryReel; pesquisa sem acento; Continue assistindo; Minha lista; filtros do catálogo; tela Surpresa.
- **2026-10-21:** correções de celular, "Em alta", novo login, barra flutuante.
- **2026-10-23:** reposicionamento para novelinhas + vitrine do dia + pop-up de assinatura + sorteio entre todas.
- **2026-10-26: Integração Completa da API Drama V2 (Vorta Tech):**
  - Criado `src/services/vortaApi.js` com cliente HTTP nativo, assinatura HMAC-SHA256, cache com TTL e normalizador para formato de novelinha.
  - Criado `src/routes/vorta.js` com rotas para `/categories`, `/languages`, `/banner`, `/home`, `/discover`, `/detail`, `/video`, `/search`, `/status`, `/track` e `/sync`.
  - Atualizado `src/index.js` montando `/api/vorta`.
  - Atualizado `src/routes/plays.js` para resolver IDs `vorta:` diretamente em `GET /:id` com suporte a capítulos e streams HLS H.264.
  - Atualizado `.env` e `.env.example` com as variáveis `VORTA_API_URL`, `VORTA_API_SECRET`, `VORTA_DEFAULT_CATEGORY` e `VORTA_DEFAULT_LANG`.
  - Atualizado `public/index.html`:
    - Seletor de plataformas no Catálogo (`FreeReels`, `ShortMax`, `MeloShort`, `Catálogo Local`).
    - Fileira de novidades FreeReels na Página Inicial.
    - Grade de episódios interativa na tela de Detalhes da Novelinha (`#/novelinha/:id`).
    - Player StoryReel com suporte a capítulos, reprodução de streams HLS, próximo episódio e tracking de visualização.
    - Pesquisa unificada combinando resultados do banco local e da API Vorta.
    - Nova aba no painel Admin (`#/admin/vorta`) para monitoramento de chave/plano e sincronização com 1 clique.
    - Versão do app elevada para `v2026.10.26-vorta`.
  - Atualizado `public/sw.js` com versão de cache `md-v11`.
  - Criado `tests/vorta.test.js` com testes unitários para assinatura HMAC, formatação e todas as rotas (7 novos testes, 150 no total).

## 🚀 Próximos Passos (Onde Paramos)
1. [ ] **Testar em aparelho real** (Android Chrome, iPhone Safari, app instalado): navegação de capítulos e reprodução de streams HLS da Vorta no StoryReel.
2. [ ] Conferir no site publicado que o rodapé mostra `v2026.10.26-vorta`.
3. [ ] Monitorar a cota de 600 requisições/dia no painel Admin (`#/admin/vorta`).
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
