# Produtos Acabados x Pedidos de Compras

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-pedidos-compras` | **Botão:** `#btnTabVendPedidosCompras`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Consulta de ordens de compra em aberto (`SC7`) com fornecedores para produtos acabados (PA), informando previsão de ressuprimento aos vendedores.
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC7, SB1, SA2010)

---

## 4. Regras de Negócio & Cálculos Chave
- Mapeamento de C7_PRODUTO tipo "PA", quantidade pedida vs entregue (C7_QUANT - C7_QUJE) e data de entrega prevista (C7_DATPRF).

---

## 5. Endpoints REST da API
- `GET /api/vendedores/pedidos-compras`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_pedidos_compras.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
