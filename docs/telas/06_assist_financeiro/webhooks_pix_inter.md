# Webhooks Pix Banco Inter

> **Macro-Área:** Assist. Financ.  
> **Identificador DOM:** `#tab-inter-webhooks` | **Botão:** `#btnTabInterWebhooks`  
> **Permissão RBAC:** admin, user (Financeiro)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Recepção de notificações instantâneas de Pix recebidos via Webhooks com validação rigorosa de schemas Zod e chave de idempotência.
- **Personas Atendidas:** admin, user (Financeiro)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `server.js, webhook_validator.js, circuit_breaker.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (inter_webhooks_logs), Fallback data/inter_webhooks.json

---

## 4. Regras de Negócio & Cálculos Chave
- Deduplicação de eventos por endToEndId. Validação de schema Zod estrito. Circuit breaker para absorção de picos e retries com backoff exponencial.

---

## 5. Endpoints REST da API
- `POST /api/webhooks/pix-inter`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_webhook_schemas.js, node test_webhooks.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
