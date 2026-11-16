# Pedidos pra Faturar

> **Macro-Área:** Logística  
> **Identificador DOM:** `#tab-pedidos-faturar` | **Botão:** `#btnTabPedidosFaturar`  
> **Permissão RBAC:** admin, user (Logística)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 16/11/2026 (v8.325 - Expurgado resíduo eliminado C6_BLQ=R/S e SC9 órfão)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Monitoramento de pedidos liberados e prontos para geração de nota fiscal e faturamento no ERP TOTVS Protheus (MATA460A - Legenda Verde).
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
- Identificação de pedidos com liberação de crédito e estoque concluídas (SC9 com C9_BLEST = "00"/"10"/vazio e C9_BLCRED = "00"/"10"/vazio).
- **Regras de Expurgo de Sujeira / Cancelamento:**
  - `C9_NFISCAL` obrigatório vazio (registros com número de nota fiscal gravado já foram faturados ou são órfãos de notas canceladas).
  - `C6_BLQ NOT IN ('R', 'S')` (itens com resíduo eliminado no MATA500/MATA410 ou bloqueados não entram como prontos para faturar).
  - `C6_NOTA` vazio e `C5_MSBLQL <> '1'`.
- Exibição de valores, cliente, transportadora e previsão de expedição.

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
- **v8.325 (16/11/2026):** Correção do filtro T-SQL em `buscarPedidosProntosFaturar` expurgando pedidos cancelados com resíduo eliminado (`C6_BLQ = 'R'`) e liberacões SC9 órfãs de NF cancelada (ex.: pedido 000221 da OACO).
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
