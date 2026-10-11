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
O seed só **cria** (admin, planos e peças de exemplo se o catálogo estiver vazio). Ele nunca
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

## 3. Usando o painel admin (cadastrar peças, sinopses, vídeo, planos)

Depois de logado com a conta admin, acesse **Painel admin** no menu.

### Importar vídeos que já estão no Google Drive (ou qualquer link)
Além de escolher um arquivo do computador, dá pra colar um link (Google Drive,
por exemplo) e o **Bunny.net busca o vídeo sozinho**, servidor a servidor — muito
mais rápido que subir pela internet de casa.
- Peça única: no formulário "Nova peça", use o campo "Ou importe direto de um link".
- Várias de uma vez: em Peças → "Cadastrar várias peças", cole uma lista no
  formato `Título | link do Drive`, uma por linha.
- Para o Google Drive, o link precisa estar compartilhado como **"qualquer
  pessoa com o link"**. Arquivos grandes às vezes mostram uma tela de aviso do
  Google em vez do vídeo direto — o sistema tenta contornar isso automaticamente,
  mas não é 100% garantido; se um vídeo específico não importar, baixe ele do
  Drive e suba como arquivo mesmo (a outra opção do mesmo formulário).

### Capas em massa por planilha (CSV)
Ideal para quando um designer entrega as capas já hospedadas (ex.: Supabase Storage). Em
**Peças → Cadastrar várias peças**, use o campo **Planilha de capas**:

```
nome;url_capa
A Farsa do Silêncio;https://SEU-PROJETO.supabase.co/storage/v1/object/public/capas/farsa.png
Ventos de Dona Flor;https://SEU-PROJETO.supabase.co/storage/v1/object/public/capas/dona-flor.jpg
```
- Duas colunas: **nome** e **url_capa** (vírgula ou ponto e vírgula; com ou sem cabeçalho; aceita CSV do Excel).
- O site compara o `nome` com o **título do vídeo** (ou o nome do arquivo) ignorando maiúsculas,
  acentos, `_` e `-`. Se achar, preenche a capa sozinho; a tela mostra uma **miniatura** de cada capa
  encontrada e avisa das que não casaram e das que sobraram na planilha.
- Nesse lote, a **sinopse** entra como `.` e o **banner** fica vazio (a página inicial usa a capa como reserva).
- A URL precisa ser **pública** (no Supabase, o bucket deve ser público) e começar com `https://`.
  Se a miniatura não aparecer na tela do lote, o link está errado ou o bucket é privado.
- Nome repetido na planilha: vale a primeira linha. URLs inválidas são ignoradas e listadas.

### Cadastro em lote (várias peças de uma vez)
Em Peças → "Cadastrar várias peças": escolha vários arquivos de vídeo do
computador, ou cole vários links (formato acima), ou combine os dois. Cada
vídeo vira uma peça com **título (do nome do arquivo), duração (detectada
automaticamente) e gênero (sugerido por palavras-chave no título)** —
mas ainda **sem sinopse, elenco nem pôster definitivos**: depois do lote,
edite cada peça criada para completar esses detalhes.

### Sugestão automática de gênero
Ao digitar o título (ou escolher o arquivo de vídeo), o campo Gênero é
preenchido sozinho com base em palavras-chave (ex: "amor" → Romance, "riso"
→ Comédia). É uma regra simples, não uma IA lendo a peça de verdade — então
erra às vezes, principalmente em títulos que não dão pistas óbvias. Sempre dá
pra corrigir manualmente antes de salvar.

### Paginação
O catálogo público e a lista de peças do painel admin agora carregam por
páginas (não tudo de uma vez), então o site continua rápido mesmo com um
catálogo grande.

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
| Resumo de novidades | No máximo 1x/dia, **só se** entraram peças novas desde o último e-mail (conta quantas) |
| Aviso de vencimento | 3, 2 e 1 dia antes (só planos pagos) + um aviso quando vence |
| Sentimos sua falta | Quando a pessoa fica 7 dias sem entrar (repete a cada 7 dias) |
| Nova obra em destaque | Quando uma obra entra no banner da home |
| Pagamento confirmado | Assim que o PIX é confirmado |

Regras: e-mails de divulgação têm link de **descadastro** (e a pessoa também pode desligar em Minha conta);
avisos de vencimento e comprovantes continuam sempre. Ninguém recebe o mesmo e-mail duas vezes, o limite
diário (`EMAIL_DAILY_LIMIT`) é respeitado e quem recebeu uma divulgação nas últimas 20h não recebe o resumo no mesmo dia.

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
