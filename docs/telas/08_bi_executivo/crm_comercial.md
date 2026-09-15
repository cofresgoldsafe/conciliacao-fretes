# CRM Comercial B2B

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-crm` | **Botão:** `#btnTabBiCrm`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Pipeline comercial nativo, Kanban de 5 fases de oportunidades (Lead, Contato, Proposta, Negociação, Ganho), gestão de clientes B2B e atividades de follow-up.
- **Personas Atendidas:** admin, diretoria (BI)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/crm.js, public/index.html`
- **Backend / Rotas:** `routes/crm.js, server.js, postgres_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (crm_deals, crm_atividades, crm_clientes)

---

## 4. Regras de Negócio & Cálculos Chave
- Kanban drag-and-drop com persistência atômica. Histórico cronológico de atividades. Permissões via RLS Supabase.

---

## 5. Endpoints REST da API
- `GET /api/crm/deals, POST /api/crm/deals, PUT /api/crm/deals/:id/stage, GET /api/crm/clientes`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_crm_module.js, node test_crm_clientes.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
