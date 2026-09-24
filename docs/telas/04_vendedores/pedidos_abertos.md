# Carteira de Pedidos de Venda em Aberto

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-pedidos-abertos` | **Botão:** `#btnTabVendPedidosAbertos`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 24/09/2026 (v8.252 - Homologado)  

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
- **Badges de Bloqueio SC9:**
  - *Bloqueio de Crédito:* Se bloqueado (`BLOQ NO CREDITO` / código `01`), exibe badge vermelha (`diverg-badge status-danger`) com ícone `🔒`. Se liberado (`SEM BLOQ CREDITO` / código `10`), exibe badge com fundo verde claro (`#dcfce7`), letra verde escuro (`#14532d`) e ícone `✓`.
  - *Bloqueio de Estoque:* Se bloqueado (`BLOQ POR ESTOQUE` / código `02`), exibe badge amarela (`diverg-badge status-warning`) com ícone `⚠️`. Se liberado (`SEM BLOQ ESTOQ` / código `10`), exibe badge com fundo verde claro (`#dcfce7`), letra verde escuro (`#14532d`) e ícone `✓`.

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
- **v8.252 (24/09/2026):** Correção da lógica de detecção de bloqueios SC9 em `formatBadgeBloqCredito` e `formatBadgeBloqEstoque` e estilização de badges liberados ("SEM BLOQ") com fundo verde claro (`#dcfce7`) e letra verde escuro (`#14532d`), mantendo vermelho para bloqueio de crédito e amarelo para bloqueio de estoque.
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
