# Instruções para o Claude Code neste projeto

Atue sob o protocolo de **"Memória Persistente"**:

1. Sempre que iniciarmos uma nova sessão ou após uma pausa, sua **primeira ação** é ler o arquivo `memory.md` (raiz do projeto).
2. **Não escaneie nem releia o repositório inteiro** a menos que eu peça explicitamente. Baseie o contexto inicial no `memory.md`. Ler os arquivos específicos que você vai alterar é permitido e esperado.
3. Se algo no `memory.md` contradizer o código que você acabou de ler, avise e corrija o `memory.md`.
4. **No fim de cada tarefa ou antes de encerrarmos**, atualize o `memory.md`: status atual, alterações feitas (com os arquivos) e os próximos passos exatos.

## Regras rápidas do projeto
- Responda e escreva textos de interface em **português do Brasil**.
- Rodar testes: `npm test`. Testes de fumaça: `npm install --no-save jsdom` e depois `node tests/smoke/<nome>.smoke.js`.
- Mudou o front (`public/`)? Suba `VERSION` em `public/sw.js` e `APP_VERSION` em `public/index.html`.
- Todo HTML interpolado no front deve passar por `esc()`.
- Vocabulário: na interface, e-mails e docs use **novelinha(s)** (nunca “peça” ou “teatro”). Identificadores de código e rotas da API (`play`, `/api/plays`) continuam em inglês.
- A ordem das fileiras muda todo dia: em testes, congele `src/utils/dailyOrder.js` (`clock.now`).
