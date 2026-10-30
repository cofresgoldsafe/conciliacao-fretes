# Agente Mobile Multi-Projeto 24/7 (Telegram + Render + GitHub API)

> **Módulo:** [routes/telegram_agent.js](file:///C:/Users/Alexandre/Documents/Gemini-Cli/routes/telegram_agent.js)  
> **Prompt Desacoplado:** [prompts/telegram_devops_agent.v1.md](file:///C:/Users/Alexandre/Documents/Gemini-Cli/prompts/telegram_devops_agent.v1.md)  
> **Suíte de Testes:** [test_telegram_agent.js](file:///C:/Users/Alexandre/Documents/Gemini-Cli/test_telegram_agent.js)

---

## 1. Visão Geral

O **Agente Mobile Multi-Projeto 24/7** permite consultar o estado do servidor, inspecionar arquivos de código-fonte e realizar alterações controladas pelo celular (mesmo com o PC local desligado), aproveitando a instância **Render Starter 24/7 (`conciliacao-fretes`)** sem custo adicional de infraestrutura.

### Repositórios Gerenciados (`PROJECTS`)
Sempre que uma conversa inicia sem projeto ativo (ou ao enviar `/projeto`), o Bot exige a escolha de um dos 5 projetos:
1. **🏢 Portal GSI** (`cofresgoldsafe/conciliacao-fretes`)
2. **🔧 Assistência Técnica** (`cofresgoldsafe/gsi-assistencia-portal`)
3. **🏠 Leilão de Imóveis** (`cofresgoldsafe/gemini-leilao-imoveis`)
4. **💬 WhatsApp Multi360** (`cofresgoldsafe/gemini-whatsapp-multi360`)
5. **🛒 Loja x Pipedrive** (`cofresgoldsafe/integracao-loja-pipedrive`)

---

## 2. Variáveis de Ambiente no Render (`conciliacao-fretes`)

| Variável | Obrigatória | Descrição |
| :--- | :---: | :--- |
| `TELEGRAM_BOT_TOKEN` | Sim | Token gerado no `@BotFather` do Telegram. |
| `TELEGRAM_ALLOWED_CHAT_ID` | Sim | Seu ID numérico pessoal do Telegram (obtido via `@userinfobot`). Qualquer outro ID recebe `HTTP 403`. |
| `GEMINI_API_KEY` | Sim | Chave da API do Google Gemini (AI Studio). |
| `GITHUB_PAT` | Sim | *Fine-Grained Personal Access Token* do GitHub com permissão `Contents: Read and Write` nos repositórios da organização `cofresgoldsafe`. |
| `TELEGRAM_WEBHOOK_SECRET` | Opcional | Segredo alfanumérico validado via `crypto.timingSafeEqual` no header `X-Telegram-Bot-Api-Secret-Token`. |

---

## 3. Ativação do Webhook em 1 Comando

Após configurar as variáveis no painel do Render, basta chamar a rota `POST /api/telegram/setup-webhook` (ou abrir no navegador/terminal):

```bash
curl -X POST https://conciliacao-fretes.onrender.com/api/telegram/setup-webhook \
  -H "Content-Type: application/json" \
  -d '{"publicBaseUrl": "https://conciliacao-fretes.onrender.com"}'
```
