# Pedidos Liberados no Estoque

> **Macro-Área:** Logística  
> **Identificador DOM:** `#tab-pedidos-lib-estoque` | **Botão:** `#btnTabPedidosLibEstoque`  
> **Permissão RBAC:** admin, user (Logística)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Acompanhamento sequencial da fila de separação física e expedição de pedidos liberados por ordem cronológica (FIFO - MATA455 / MATA456).
- **Personas Atendidas:** admin, user (Logística)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC9, SC5, SC6, SB1010, SB2010)

---

## 4. Regras de Negócio & Cálculos Chave
- Fila sequencial FIFO baseada em C9_DATALIB e C9_HORALIB. Alertas visuais de tempo de espera em separação e divergências de peso/cubagem.

---

## 5. Endpoints REST da API
- `GET /api/logistica/pedidos-lib-estoque`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_pedidos_lib_estoque.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
