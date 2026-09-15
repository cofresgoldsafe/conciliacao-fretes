# Gráficos & Tendências Executivas

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-metabase` | **Botão:** `#btnTabBiMetabase`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Dashboards analíticos nativos com gráficos Chart.js cobrindo faturamento mês a mês, margem média e faturamento por grupo de produto.
- **Personas Atendidas:** admin, diretoria (BI)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/bi.js, public/js/chart.umd.min.js, public/index.html`
- **Backend / Rotas:** `services/bi_service.js, server.js, protheus_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (bi_faturamento_mensal, bi_grupos_produtos), Protheus (SF2)

---

## 4. Regras de Negócio & Cálculos Chave
- Renderização nativa de alta velocidade sem iframe ou dependência externa do Metabase. Sincronização periódica automatizada com Protheus.

---

## 5. Endpoints REST da API
- `GET /api/bi/faturamento-historico, GET /api/bi/vendas-grupos`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_bi_faturamento.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
