# Consulta Pedidos de Venda

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-pedidos` | **Botão:** `#btnTabVendPedidos`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Consulta analítica de pedidos de venda emitidos (`SC5`/`SC6`), condições comerciais, status de faturamento e itens.
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC5, SC6, SE1, SA1010)

---

## 4. Regras de Negócio & Cálculos Chave
- Restrição por código de vendedor Protheus quando usuário perfil vendedor. Cálculo do frete total embutido vs destacado na nota.

---

## 5. Endpoints REST da API
- `GET /api/vendedores/pedidos`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_totais_pedido.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
