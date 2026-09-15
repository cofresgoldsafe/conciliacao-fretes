# Configuração do Motor de Score de Crédito

> **Macro-Área:** Configurações  
> **Identificador DOM:** `#tab-config-score` | **Botão:** `#btnTabConfigScore`  
> **Permissão RBAC:** admin exclusivo  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Calibração dos pesos paramétricos e regras de decisão do motor analítico de Score de Crédito Comercial em 6 blocos de risco.
- **Personas Atendidas:** admin exclusivo

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `routes/score_config.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (analise_credito_score_params)

---

## 4. Regras de Negócio & Cálculos Chave
- Definição de pesos para Receita Federal, Idade de Domínio RDAP, Wayback Machine, Certidões Negativas, Serasa Experian e Histórico Protheus.

---

## 5. Endpoints REST da API
- `GET /api/score/parametros, PUT /api/score/parametros`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_score_config.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
