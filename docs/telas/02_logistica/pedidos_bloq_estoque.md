# Pedidos Bloqueados por Estoque

> **Macro-Área:** Logística  
> **Identificador DOM:** `#tab-pedidos-bloq-estoque` | **Botão:** `#btnTabPedidosBloqEstoque`  
> **Permissão RBAC:** admin, user (Logística)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Identificação e gestão de pedidos com pendência de estoque físico ou bloqueio de lote/armazém no Protheus.
- **Personas Atendidas:** admin, user (Logística)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC9 onde C9_BLEST <> "00", SC6, SB2)

---

## 4. Regras de Negócio & Cálculos Chave
- Classificação do motivo de bloqueio (falta de saldo, empenho concorrente, produto bloqueado B1_MSBLQL). Integração com ordens de compra SC7 para previsão de chegada.

---

## 5. Endpoints REST da API
- `GET /api/logistica/pedidos-bloq-estoque`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_pedidos_faturar.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
