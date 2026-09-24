# Mini Drama — guia de colocar no ar

Plataforma de streaming de peças de teatro (projeto Teatro + Tecnologia).
Front-end + back-end (Node/Express) + banco de dados real (via Prisma).

Este guia tem 3 partes:
1. Rodar no seu computador (para testar antes de publicar)
2. Colocar o site no ar com link público e banco de dados real, de graça
3. Usar o painel admin para cadastrar peças, sinopses, vídeo e planos

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
   - **Build Command:** `npm install && npx prisma migrate deploy`
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
1. No painel do Render, abra a aba **Shell** do seu serviço.
2. Rode:
   ```bash
   npm run seed
   ```
3. Pronto: o admin e os planos já existem no banco real.

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

## 3. Usando o painel admin (cadastrar peças, sinopses, vídeo, planos)

Depois de logado com a conta admin, acesse **Painel admin** no menu.

### Configurar o upload automático de vídeo (Bunny.net Stream)
Com isso configurado, o admin pode enviar o arquivo de vídeo direto pela tela
"Nova peça", sem precisar entrar no site do Bunny nem copiar link nenhum.

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
5. Pronto — na tela "Nova peça", o campo "Ou envie o arquivo de vídeo direto para
   o Bunny.net" já funciona: escolha o arquivo, clique em "Enviar vídeo", acompanhe
   a barra de progresso, e a URL do vídeo é preenchida sozinha quando terminar.
   O vídeo ainda leva alguns minutos pra processar no Bunny antes de ficar
   disponível pra assistir — pode salvar a peça normalmente enquanto isso.

> O upload vai **direto do navegador para o Bunny** (não passa pelo servidor do
> Render), então funciona mesmo com vídeos grandes e não é afetado pelos limites
> do plano gratuito do Render.

### Cadastrar uma peça
1. Vá em **Peças** → **+ Nova peça**.
2. Preencha: título, gênero, ano, **duração em minutos (mínimo 60 — obrigatório)**,
   sinopse/resumo, diretor(a) e elenco.
3. Cole o **link do pôster** (imagem vertical) e da **imagem de destaque** (horizontal,
   usada no banner). Pode usar links de imagens públicas (Unsplash, por exemplo).
4. O **vídeo**: use o upload automático (acima) — ou, se preferir, cole manualmente
   um link .m3u8, um .mp4 direto, ou um link do YouTube no campo de URL.
5. Escolha o **plano mínimo exigido** para assistir (Plateia, Balcão ou Camarote).
6. Marque "Destacar na página inicial" se quiser que ela apareça no banner rotativo.
7. Salvar. A peça já aparece no catálogo e (se marcada) no banner da home.

### Login e senha dos usuários
Já funciona de verdade: qualquer visitante cria conta pelo botão **Criar conta**
(nome, e-mail, senha) e faz login normalmente. As senhas são armazenadas com hash
(nunca em texto puro) no banco de dados.

### Planos
Em **Planos**, você edita nome, preço e benefícios de cada plano, ou cria um novo.
Em **Usuários**, você controla manualmente o plano de cada pessoa (útil para
liberar acesso a alguém sem precisar de um sistema de pagamento real), estende a
validade em 30 dias, ou bloqueia uma conta.

> Este projeto não inclui cobrança automática (cartão de crédito, Pix etc.) —
> a "assinatura" é controlada manualmente pelo admin, o que é adequado para um
> projeto acadêmico. Se no futuro quiserem cobrança de verdade, o próximo passo
> seria integrar um provedor como Stripe ou Mercado Pago.

---

## Estrutura do projeto

```
mini-drama/
├── prisma/
│   ├── schema.prisma      → modelos do banco (User, Play, Plan)
│   └── seed.js            → dados iniciais (admin, planos, peças de exemplo)
├── public/
│   └── index.html         → todo o front-end (single-page app)
├── src/
│   ├── index.js            → servidor Express (liga tudo)
│   ├── prismaClient.js     → conexão com o banco
│   ├── middleware/auth.js  → login obrigatório / checagem de admin
│   ├── routes/
│   │   ├── auth.js         → cadastro, login, /me
│   │   ├── plays.js        → catálogo, detalhe, CRUD de peças
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
dados cadastrados (peças, usuários) somem. Por isso o guia usa PostgreSQL (Neon)
para produção, que é persistente de verdade.
