# Movimentações de Estoque (Kardex)

> **Macro-Área:** Compras  
> **Identificador DOM:** `#tab-compras-movimentacoes-estoque` | **Botão:** `#btnTabComprasMovimentacoesEstoque`  
> **Permissão RBAC:** admin, user (Compras)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Extrato histórico analítico de movimentações internas, entradas, saídas, requisições de OP e transferências de estoque Protheus (`SD3`).
- **Personas Atendidas:** admin, user (Compras)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/compras_movimentacoes_estoque.js, public/index.html`
- **Backend / Rotas:** `routes/compras.js, server.js, protheus_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SD3, SB1, SB2)

---

## 4. Regras de Negócio & Cálculos Chave
- Filtro por produto, tipo de movimento (TM), data e filial. Exibição de custos contábeis médios e saldos resultantes.

---

## 5. Endpoints REST da API
- `GET /api/compras/movimentacoes-estoque`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_compras_movimentacoes_estoque.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
