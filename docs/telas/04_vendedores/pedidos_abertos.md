# Carteira de Pedidos de Venda em Aberto

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-pedidos-abertos` | **Botão:** `#btnTabVendPedidosAbertos`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Gestão da carteira de pedidos em carteira não faturados, monitoramento de prazos acordados e bloqueios comerciais/crédito.
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC5, SC6 onde C6_QTDENT < C6_QTDVEN, SC9)

---

## 4. Regras de Negócio & Cálculos Chave
- Filtragem por filial (14, 15, 16). Alertas de aging de pedidos em carteira e integração com oportunidades ganhas no Pipedrive.

---

## 5. Endpoints REST da API
- `GET /api/vendedores/pedidos-abertos`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_pedidos_abertos.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
