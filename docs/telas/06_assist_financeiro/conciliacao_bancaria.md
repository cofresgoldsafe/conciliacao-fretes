# Conciliação Bancária

> **Macro-Área:** Assist. Financ.  
> **Identificador DOM:** `#tab-conciliacao-bancaria` | **Botão:** `#btnTabConciliacaoBancaria`  
> **Permissão RBAC:** admin, user (Financeiro)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Conciliação automática N:1 e 1:1 entre extratos bancários digitais (Banco Inter / Mercado Pago) e títulos Protheus (`SE5`/`SE8`).
- **Personas Atendidas:** admin, user (Financeiro)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js, services/conciliacao_service.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus (SE5, SE8, SE1), PostgreSQL Supabase (conciliacoes_bancarias)

---

## 4. Regras de Negócio & Cálculos Chave
- Matching determinístico por chave Pix, número do título, valor com tolerância de centavos e data de liquidação. Detecção de estornos e duplicidades.

---

## 5. Endpoints REST da API
- `POST /api/conciliacao/executar, GET /api/conciliacao/extrato-pendente`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_conciliacao_bancaria.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
