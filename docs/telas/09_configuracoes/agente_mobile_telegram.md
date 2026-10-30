# Agente Mobile Multi-Projeto 24/7 (Telegram + Render + GitHub API)

> **Módulo:** [routes/telegram_agent.js](file:///C:/Users/Alexandre/Documents/Gemini-Cli/routes/telegram_agent.js)  
> **Prompt Desacoplado:** [prompts/telegram_devops_agent.v1.md](file:///C:/Users/Alexandre/Documents/Gemini-Cli/prompts/telegram_devops_agent.v1.md)  
> **Suíte de Testes:** [test_telegram_agent.js](file:///C:/Users/Alexandre/Documents/Gemini-Cli/test_telegram_agent.js)  
> **Bot Homologado:** `@agente_alexandre_bot` (`Agente Alexandre`) — Webhook ativo em `https://conciliacao-fretes.onrender.com/api/telegram/webhook`

---

## 1. Visão Geral e Arquitetura

O **Agente Mobile Multi-Projeto 24/7** permite consultar o estado do servidor, inspecionar arquivos de código-fonte e realizar alterações controladas pelo celular (mesmo com o PC local desligado), aproveitando a instância **Render Starter 24/7 (`conciliacao-fretes`)** sem custo adicional de infraestrutura.

### Catálogo de Repositórios Gerenciados (`PROJECTS`)
Sempre que uma conversa inicia sem projeto ativo (ou ao enviar `/projeto` / `/start`), o Bot exige a escolha de um dos 5 projetos via `inline_keyboard`:
1. **🏢 Portal GSI** (`cofresgoldsafe/conciliacao-fretes`)
2. **🔧 Assistência Técnica** (`cofresgoldsafe/gsi-assistencia-portal`)
3. **🏠 Leilão de Imóveis** (`cofresgoldsafe/gemini-leilao-imoveis`)
4. **💬 WhatsApp Multi360** (`cofresgoldsafe/gemini-whatsapp-multi360`)
5. **🛒 Loja x Pipedrive** (`cofresgoldsafe/integracao-loja-pipedrive`)

---

## 2. Regras de Negócio, Segurança Zero-Trust e Roteamento de IA

- **Whitelist Exclusiva (`TELEGRAM_ALLOWED_CHAT_ID`):** Apenas mensagens e cliques originados do `chat_id` autorizado (`1140538386`) são processados; qualquer outro ID recebe `HTTP 403 Forbidden`.
- **Proteção de Arquivos Sensíveis (`isSensitiveFilePath`):** Leitura e escrita bloqueadas para `.env`, `.key`, `.pem`, `.crt`, `.pfx`, `credentials`, `secrets` e traversal `..`.
- **Esteira de Modelos Gemini (`callGeminiModel`):**
  - Motor primário: `gemini-3.5-flash` (~1,7s de latência).
  - Fallbacks automáticos: `gemini-3.5-flash-lite` (~1,2s) ➔ `gemini-3.6-flash` (~1,9s) ➔ `gemini-3.8-flash`.
- **Human-in-the-Loop Obrigatório (`propose_file_edit`):** Nenhuma alteração é comitada diretamente pela IA. O bot gera o preview `diff` e aguarda o clique humano em `[✅ Comitar e Publicar]` (`confirm_patch`) para executar o `PUT /repos/{owner}/{repo}/contents/{path}` na GitHub REST API.
- **Atalho Executivo de Autorização de Desconto & Margem (`handleDealAuthorizationMessage` / `confirmDealDecision`):**
  - Sempre que o gestor encaminha uma mensagem de vendedor contendo link do Pipedrive (`/deal/{id}`) ou comando (`autorizar deal {id}`), o bot seleciona automaticamente o projeto `portal-gsi` (sem exigir escolha prévia no teclado de 5 projetos), cruza os itens do Deal com o custo Protheus `SB1090` e status de revenda `SA1010` via `analisarDealCompleto` (`bi_autorizacoes_engine.js`), extrai valores propostos no texto (`extrairDadosMensagemVendedor`) e exibe o card completo de margem com botões de decisão em 1 toque (`decide_deal:AUTORIZADO`, `decide_deal:NAO_AUTORIZADO`, `decide_deal:USE_TEXT_VALUES` e `decide_deal:CANCEL`).
  - Ao confirmar, fixa a nota oficial no Deal do Pipedrive (`gravarNotaPipedrive`) e grava no Supabase/JSON (`saveAutorizacaoDescontoDB`).

---

## 3. Contratos de API e Variáveis de Ambiente

| Endpoint | Método | Descrição |
| :--- | :---: | :--- |
| `/api/telegram/status` | `GET` | Diagnóstico seguro (retorna apenas booleans para variáveis sensíveis e lista de projetos). |
| `/api/telegram/setup-webhook` | `POST` | Registra o webhook do bot na API oficial do Telegram. |
| `/api/telegram/webhook` | `POST` | Receptor 24/7 de mensagens e `callback_query` do Telegram. |

### Variáveis de Ambiente (`conciliacao-fretes` no Render)
- `TELEGRAM_BOT_TOKEN`: Token HTTP API do `@agente_alexandre_bot`.
- `TELEGRAM_ALLOWED_CHAT_ID`: ID numérico autorizado (`1140538386`).
- `GEMINI_API_KEY`: Chave Google AI Studio (`projects/616142986494`).
- `GITHUB_PAT`: Fine-Grained Personal Access Token com `Contents: Read and write` nos repositórios `cofresgoldsafe`.

---

## 4. Histórico de Evolução
- **v8.316 (30/10/2026):** Integração do fluxo de Autorização de Desconto & Margem (Pipedrive + Protheus `SB1090`) direto pelo `@agente_alexandre_bot`: detecção automática de link de Deal sem exigir seleção prévia de projeto, extração de valores do texto do vendedor (`extrairDadosMensagemVendedor`), recálculo de divergência (`decide_deal:USE_TEXT_VALUES`), sanitização `escapeTelegramMarkdown` com fallback resiliente e gravação oficial no Pipedrive + Supabase (`11/11` testes aprovados em `test_telegram_agent.js`).
- **v8.315 (29/10/2026):** Definição do `gemini-3.5-flash` (1,7s) e `gemini-3.5-flash-lite` (1,2s) como motores primários na esteira `callGeminiModel` e remoção dos modelos `2.x` descontinuados.
- **v8.313–v8.314 (29/10/2026):** Implementação inicial do módulo `routes/telegram_agent.js`, prompt `prompts/telegram_devops_agent.v1.md`, ativação do webhook no Render e homologação de 7 testes automatizados em `test_telegram_agent.js`.
