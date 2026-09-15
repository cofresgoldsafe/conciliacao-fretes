# Pedidos pra Faturar

> **Macro-Área:** Logística  
> **Identificador DOM:** `#tab-pedidos-faturar` | **Botão:** `#btnTabPedidosFaturar`  
> **Permissão RBAC:** admin, user (Logística)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Monitoramento de pedidos liberados e prontos para geração de nota fiscal e faturamento no ERP TOTVS Protheus (MATA460A).
- **Personas Atendidas:** admin, user (Logística)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC5, SC6, SC9, SA1010, SF2)

---

## 4. Regras de Negócio & Cálculos Chave
- Identificação de pedidos com liberação de crédito e estoque concluídas (SC9 com C9_BLEST = "00" e C9_BLCRED = "00"). Exibição de valores, cliente, transportadora e previsão de expedição.

---

## 5. Endpoints REST da API
- `GET /api/logistica/pedidos-faturar`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_pedidos_faturar.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
