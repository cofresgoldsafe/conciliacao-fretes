# Gráficos & Tendências Executivas

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-metabase` | **Botão:** `#btnTabBiMetabase`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 16/09/2026 (v8.223 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Dashboards analíticos nativos de alta velocidade com gráficos Chart.js cobrindo séries temporais de índices de liquidez (LC, LS, LI), faturamento histórico e um segundo gráfico dedicado ao **Monitor de Ativo Circulante Seco (Caixa/Bancos + Contas a Receber)** com detector inteligente de baixa acentuada.
- **Personas Atendidas:** admin, diretoria (BI)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:**
  - `public/js/bi.js` (Módulo IIFE com gerenciamento de `executiveChartInstance` e `secoChartInstance`).
  - `public/js/chart.umd.min.js` (Vendor Chart.js nativo sem iframe).
  - `public/index.html` (Containers `#biChartCard` e `#biSecoCard`, canvas `#biExecutiveChart` e `#biSecoChart`, banner de alerta `#biSecoAlertBanner`).
  - `public/style.css` (Classes responsivas e animação pulsante `.bi-seco-alert-danger`).
- **Backend / Rotas:** `services/bi_service.js, bi_indices_engine.js, server.js, protheus_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:**
  - PostgreSQL Supabase (`indices_liquidez_historico`, `indices_sync_logs`, `bi_faturamento_mensal`, `bi_grupos_produtos`).
  - Cache local resiliente: `data/bi_indices_cache.json`.
  - Dados Protheus: `SE8` (bancos/caixa), `SE1` (contas a receber), `SE2` (contas a pagar), `SB2` (estoque).

---

## 4. Regras de Negócio & Cálculos Chave
- **Ativo Circulante Seco:** $\text{Ativo Seco} = \text{Disponibilidades (Caixa/Bancos)} + \text{Receber Válido (Adimplente)}$.
- **Detector de Baixa Acentuada:**
  - Variação percentual entre início e fim do período selecionado: $\Delta \% = \frac{\text{AtivoSeco}_{\text{fim}} - \text{AtivoSeco}_{\text{inicio}}}{\text{AtivoSeco}_{\text{inicio}}} \times 100$.
  - $\Delta \% \le -10\%$: 🚨 **Baixa Acentuada**. Aciona banner vermelho pulsante (`.bi-seco-alert-danger`) com recomendações comerciais táticas (campanhas de incentivo a pagamentos à vista/Pix, liquidação de peças acabadas de alto estoque e antecipação de pedidos faturáveis).
  - $-10\% < \Delta \% \le -3\%$: 🟡 **Atenção**. Banner amarelo de alerta preventivo.
  - $\Delta \% > -3\%$: 🟢 **Estável / Em Alta**. Banner oculto.
- **Botão de Ação Comercial:** Atalho `#btnBiSecoGoEstoque` / `#btnBiSecoAcaoPromo` que direciona à sub-aba de Saldos em Estoque mantendo o filtro de filial correspondente.

---

## 5. Endpoints REST da API
- `GET /api/bi/indices/historico?empresa=...&dias=...`: Retorna série cronológica de snapshots com `disponibilidades`, `receber_valido`, `ativo_seco` e índices de liquidez.
- `POST /api/bi/indices/sync`: Dispara extração e consolidação multi-empresa do Protheus com gravação de novo snapshot diário.
- `GET /api/bi/faturamento-historico, GET /api/bi/vendas-grupos`: Séries analíticas de vendas.

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão e auditoria:
```bash
node test_bi_seco_chart.js
node test_bi_embed.js
node test_bi_indices.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.223 (16/09/2026):** Remoção do botão de acesso externo "↗️ Abrir Metabase" (`#btnBiOpenExternal`) e do seletor legado de Dashboard ID (`#btnBiChangeDashboardId`), simplificando a interface executiva e consolidando a barra de telemetria em dados 100% nativos.
- **v8.221 (15/09/2026):** Implementação do 2º gráfico executivo de tendência de Ativo Circulante Seco (Caixa + Receber) em layout empilhado, com cards analíticos de KPI, detector inteligente de baixa acentuada e orientações práticas de promoções comerciais.
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.

