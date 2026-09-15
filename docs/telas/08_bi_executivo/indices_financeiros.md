# Índices Financeiros de Liquidez

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-indices` | **Botão:** `#btnTabBiIndices`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Painel executivo de indicadores de solvência e liquidez patrimonial: Liquidez Corrente, Liquidez Seca, Liquidez Geral e Liquidez Imediata.
- **Personas Atendidas:** admin, diretoria (BI)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/bi_indices.js, public/index.html`
- **Backend / Rotas:** `routes/bi.js, server.js, protheus_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (CT2 contabilidade, SE1, SE2)

---

## 4. Regras de Negócio & Cálculos Chave
- Cálculo com base no plano de contas patrimonial oficial. Comparativo mês a mês e metas de segurança de capital de giro.

---

## 5. Endpoints REST da API
- `GET /api/bi/indices-liquidez`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_bi_indices.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
