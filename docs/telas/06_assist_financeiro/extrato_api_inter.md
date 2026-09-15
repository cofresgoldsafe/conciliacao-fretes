# Extrato ao Vivo API Banco Inter

> **Macro-Área:** Assist. Financ.  
> **Identificador DOM:** `#tab-inter-extrato` | **Botão:** `#btnTabInterExtrato`  
> **Permissão RBAC:** admin, user (Financeiro)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Conexão direta mTLS de consulta de saldos, extratos enriquecidos em tempo real e batimento financeiro com Banco Inter.
- **Personas Atendidas:** admin, user (Financeiro)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `inter_api.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (inter_extrato_cache)

---

## 4. Regras de Negócio & Cálculos Chave
- Autenticação mTLS com certificados digitais PEM/PFX. Cache inteligente de extrato com TTL de 5 minutos para otimização de requisições à API bancária.

---

## 5. Endpoints REST da API
- `GET /api/inter/saldo, GET /api/inter/extrato`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_webhooks.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
