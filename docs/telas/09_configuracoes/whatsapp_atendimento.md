# 💬 WhatsApp Atendimento (Meta Cloud API & Live Chat)

> **Macro-Área:** Configurações  
> **Identificador DOM:** `#tab-config-whatsapp` | **Botão:** `button[data-tab="tab-config-whatsapp"]`  
> **Permissão RBAC:** `admin`, `vendedor`, `user` (Acesso direto para equipe comercial: Figueiredo, Andrea, Juliana e Alexandre)  
> **Status:** Integrado / Aguardando Aprovação de Nome de Exibição pela Meta  
> **Última Atualização:** 15/10/2026 (v8.306 - Fase 5 Curadoria / Encerramento Inteligente)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Painel de live-chat multiatendente conectado à API Oficial WhatsApp Business Cloud (Meta) e ao banco Supabase PostgreSQL. Substitui o intermediário terceirizado Multi360 (~R$ 600,00/mês).
- **Personas Atendidas:**
  - **Vendedores / Atendentes:** Figueiredo, Andrea e Juliana (atendimento direto ao cliente, envio de orçamentos e esclarecimento de dúvidas).
  - **Gestor Comercial / Administrador:** Alexandre (monitoramento de conversas, transbordo do bot Gemini IA e assunção manual de atendimentos).

---

## 2. Arquitetura de Código & Componentes (Isolamento Estrito)
- **Frontend Modular (Gemini-Cli):**
  - `public/css/whatsapp_atendimento.css`: Estilização modular em 2 colunas, 100% isolada e compatível com os temas Claro e Escuro.
  - `public/js/whatsapp_atendimento.js`: Controlador isolado desacoplado do `app.js`. Gerencia conexão com Supabase Realtime via CDN, alternância de conversas, envio de mensagens e assunção de chamados.
  - `public/index.html`: Container `#tab-config-whatsapp` inserido na área de abas de Configurações, com botão de sub-aba no `#subGroupConfiguracoes`.
- **Backend do Microserviço (Gemini-Whatsapp-Multi360):**
  - Hospedado no Render: `https://gemini-whatsapp-multi360.onrender.com` (Plano *Free* compartilhado com `gsi-assistencia-portal` e `gemini-leilao-imoveis`, já que o `conciliacao-fretes` foi migrado para o plano *Starter $7/mês* em 21/10/2026).
  - **Planejamento de Consolidação:** Caso o volume de webhooks 24/7 após a aprovação da Meta exija *zero cold start*, as rotas de webhook e chat poderão ser embutidas diretamente no backend do `conciliacao-fretes` para manter apenas 1 plano Starter ($7/mês).
  - Código-fonte em TypeScript: `src/server.ts`, `src/meta.ts`, `src/bot.ts`, `src/config/env.ts`, `src/config/supabase.ts`.

---

## 3. Banco de Dados & Modelagem (Supabase PostgreSQL)
- **Instância:** `https://huhwzrvxkzffzxfqtzob.supabase.co`
- **Tabelas Operacionais:**
  - `operators`: Cadastros dos 4 atendentes (`Alexandre`, `Figueiredo`, `Andrea`, `Juliana`).
  - `contacts`: Telefone do cliente (`phone_key`), nome e vínculo com operador.
  - `conversations`: Estado da conversa (`BOT_AI`, `WAITING_HUMAN`, `IN_PROGRESS`, `CLOSED`) e operador designado.
  - `messages`: Mensagens enviadas e recebidas com tipos (`CLIENT`, `BOT`, `OPERATOR`), timestamp e tracking de status.
- **Realtime:** Publicação nativa `supabase_realtime` habilitada na tabela `messages` e `conversations` para atualização instantânea sem polling.

---

## 4. Regras de Negócio & Fluxo Operacional
1. **Reconhecimento Automático de Operador:** Ao carregar a tela, o módulo detecta o vendedor logado via `auth_user` (`localStorage`) e associa suas ações de chat automaticamente.
2. **Triagem por Inteligência Artificial (Google Gemini):**
   - Mensagens recebidas entram inicialmente no status `BOT_AI`.
   - O Gemini responde dúvidas de produtos (cofres, armários de aço).
   - Ao detectar intenção de compra ou pedido de vendedor, transborda automaticamente para `WAITING_HUMAN`.
3. **Assunção por Vendedor:**
   - O atendente clica em *"Assumir Conversa"*, o status passa para `IN_PROGRESS` e o robô Gemini é silenciado para aquela conversa.
4. **Navalha de Texto em UI:** Interface limpa, sem textos tutoriais prolixos, focada exclusivamente nas conversas ativas e no painel de digitação.

---

## 5. Endpoints do Microserviço (Render)
- `GET /health` e `GET /api/status`: Diagnóstico do serviço.
- `GET /api/webhook/meta` e `POST /api/webhook/meta`: Handshake e recebimento de webhooks Meta HMAC-SHA256.
- `GET /api/chat/conversations`: Listagem de conversas ativas.
- `GET /api/chat/messages/:conversationId`: Histórico de mensagens da conversa.
- `POST /api/chat/send`: Despacho de mensagens de texto via Meta Graph API v21.0.
- `POST /api/chat/assign`: Atribuição e alteração de status de atendimento.

---

## 6. Pendências de Homologação Externa
- ⏳ **Aprovação do Nome de Exibição pela Meta (`name_status: PENDING_REVIEW`)**: O número comercial `+55 11 5031-0195` (Phone ID: `1076299835569737`) está vinculado ao portfólio já verificado da **OACO Produtos de Aço Ltda**. A Meta está concluindo a verificação cadastral do nome de exibição.
- ⏳ **Teste Ponta a Ponta com Cliente Real**: Envio de mensagem pelo WhatsApp para validar webhook ao vivo e resposta pelo painel.
- ⏳ **Descomissionamento da Multi360**: Cancelamento da fatura mensal após primeiro atendimento concluído.

---

## 7. Histórico & Evolução da Tela
- **v8.312 (21/10/2026):** Documentação da governança de planos no Render: `conciliacao-fretes` migrado para plano pago *Starter ($7/mês)*, liberando a franquia de 750h/mês gratuitas para o `gemini-whatsapp-multi360`, e registro do plano de consolidação futura das rotas de webhook no backend principal caso necessário *zero cold start* 24/7.
- **v8.306 (15/10/2026):** Criação e homologação do painel de atendimento WhatsApp na sub-aba de Configurações (`#tab-config-whatsapp`). Arquitetura modular 100% isolada (`whatsapp_atendimento.js`, `whatsapp_atendimento.css`), Supabase Realtime ativo e conexão com microserviço Fastify no Render.
