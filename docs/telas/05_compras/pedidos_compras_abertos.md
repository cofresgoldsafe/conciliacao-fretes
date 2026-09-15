# Pedidos de Compras em Aberto

> **Macro-Área:** Compras  
> **Identificador DOM:** `#tab-compras-pedidos-abertos` | **Botão:** `#btnTabComprasPedidosAbertos`  
> **Permissão RBAC:** admin, user (Compras)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Gestão de ordens de compra emitidas (`SC7`) com saldo pendente de entrega nas filiais 14, 15 e 16 com alertas de prazo.
- **Personas Atendidas:** admin, user (Compras)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC7, SA2010, SB1010)

---

## 4. Regras de Negócio & Cálculos Chave
- Alertas de lead time vencido ou próximo ao vencimento. Acompanhamento de pedidos críticos para reposição de matéria-prima.

---

## 5. Endpoints REST da API
- `GET /api/compras/pedidos-abertos`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_pedidos_compras_abertos.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
