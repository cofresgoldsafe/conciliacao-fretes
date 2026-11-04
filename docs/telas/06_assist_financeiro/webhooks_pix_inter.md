# Webhooks Pix Banco Inter

> **Macro-Área:** Assist. Financ.  
> **Identificador DOM:** `#tab-inter-webhooks` | **Botão:** `#btnTabInterWebhooks`  
> **Permissão RBAC:** admin, user (Financeiro)  
> **Status:** Backend Ativo / UI Oculta (Removida da Navegação)  
> **Última Atualização:** 03/11/2026 (v8.317 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Monitoramento e visualização das notificações instantâneas de Pix e Cobranças recebidas via Webhooks do Banco Inter (contas 14 - Metal Pleno, 15 - GSI, 16 - OAÇO).
- **Situação Atual:** O backend receptor de webhooks (`POST /api/webhooks/inter`), validação Zod e armazenamento idempotente estão plenamente operacionais. A sub-aba visual foi removida da navegação (`public/index.html`) para manter a interface limpa e sem botões desabilitados ("Em breve"). O backend receptor e a rota REST permanecem 100% ativos em segundo plano.
- **Personas Atendidas:** admin, user (Financeiro)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** Sub-aba e botão removidos do DOM de navegação para simplificação da interface. Estrutura pronta para reinserção quando o dashboard visual for construído.
- **Backend / Rotas:** `server.js` (`POST /api/webhooks/inter`, `GET /api/financeiro/webhooks`), `webhook_validator.js`, `postgres_db.js`.

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (`inter_webhook_events`), Fallback local serializado `data/inter_webhooks.json`.

---

## 4. Regras de Negócio & Cálculos Chave
- Validação de segredo via `timingSafeEqual`.
- Validação rigorosa de payload com schemas Zod (`PixEventSchema`, `PixBatchSchema`, `BoletoEventSchema`, `BankingEventSchema`).
- Deduplicação de eventos por chave `(empresa_codigo, event_id)` para garantir idempotência.

---

## 5. Endpoints REST da API
- `POST /api/webhooks/inter` e `POST /api/webhooks/inter/:empresa` (Ingestão de eventos pelo Banco Inter)
- `GET /api/financeiro/webhooks` (Consulta de eventos recebidos protegida por RBAC)

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_webhook_schemas.js && node test_webhooks.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
- **v8.303 (07/10/2026):** Inabilitação temporária da UI da aba na navegação (`disabled`, badge "Em breve" e container protetor informativo) mantendo a ingestão de backend ativa.
- **v8.317 (03/11/2026):** Remoção da sub-aba visual `#tab-inter-webhooks` e botão `#btnTabInterWebhooks` da barra de navegação de Assist. Financ. para eliminar opções desabilitadas, mantendo a ingestão e testes de backend ativos.
