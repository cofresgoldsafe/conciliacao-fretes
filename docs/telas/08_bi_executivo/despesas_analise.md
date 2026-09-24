# Análise de Despesas & Movimento Bancário (SE5)

> **Macro-Área:** 8. BI Executivo  
> **Identificador DOM:** `#tab-bi-despesas` | **Botão:** `#btnTabBiDespesas`  
> **Permissão RBAC:** `admin`, `diretoria` (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 23/09/2026 (v8.250 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Hub de inteligência financeira e controle de gastos que espelha movimentações bancárias da tabela `SE5` do TOTVS Protheus para as 3 empresas (Metal Pleno 14, GSI 15 e OAÇO 16) desde Janeiro/2025. Classifica despesas por Natureza Analítica (Filho) e Natureza Macro (Pai) com deduções automáticas de estornos e comparativo anual mês a mês.
- **Personas Atendidas:** CEO, CFO, Controladoria, Administrador do Sistema.

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/bi_despesas.js`, `public/index.html` (`#tab-bi-despesas`, `#btnTabBiDespesas`), `public/style.css`
- **Controlador do Portal:** `public/app.js` (`initBiDespesasView`)
- **Backend / Motor:** `bi_despesas_engine.js`
- **Rotas REST:** `server.js` (`/api/bi/despesas/*`)
- **DDL & Views:** `sql/bi/09_tabela_e_views_despesas.sql`

---

## 3. Banco de Dados & Modelagem
- **ERP Protheus (MSSQL):** `SE5140`, `SE5150`, `SE5160` (Movimentos Bancários), `SED010` (Naturezas Financeiras e Pais), `SA2010` (Fornecedores).
- **Data Warehouse Supabase (PostgreSQL):** Tabela `bi_despesas_movimentos` com chave única `(empresa_cod, recno_se5)` e tabela de telemetria `bi_despesas_sync_log`.
- **Armazenamento Resiliente Local:** `data/bi_despesas_cache.json` com gravação atômica via `safe_json_storage.js`.

---

## 4. Regras de Negócio & Cálculos Chave
1. **Dedução Rigorosa de Estornos:** Lançamentos com `E5_TIPODOC = 'ES'`, `E5_RECPAG = 'R'` em naturezas de despesa (`2.%`) ou histórico com cancelamento entram com sinal negativo (`valor_liquido = -valorBruto`), abatendo as despesas do mês e grupo.
2. **Segregação de Transferências e CDBs:** Lançamentos do grupo `2.10` e tipos `TR` / `TE` são sinalizados como transferências internas e ocultados por padrão do cálculo operacional, com toggle opcional para auditoria.
3. **Mapeamento Hierárquico Pai x Filho:** Resolução automática da Natureza Pai a partir de `SED010` (`ED_PAI`) e fallback heurístico de máscara por pontos (`2.01.001` -> `2.01 - DESPESAS ADMINISTRACAO`).
4. **Sincronização Manual com Janela Retroativa:** Disparo manual com recuo de 10 dias em relação ao último lançamento gravado para capturar lançamentos retroativos sem reprocessar toda a base, além de opção de Carga Completa (Full Sync desde 01/2025).
5. **Comparativo Lado a Lado (2025 vs 2026):** Gráfico de barras duplas agrupadas por mês com variação percentual calculada.

---

## 5. Endpoints REST da API
- `GET /api/bi/despesas/kpis`: Totais líquidos, brutos, estornos abatidos, variação percentual e maior grupo.
- `GET /api/bi/despesas/grafico-pai`: Distribuição por Natureza Pai para gráfico horizontal.
- `GET /api/bi/despesas/comparativo-anual`: Matriz de 12 meses comparando 2025 x 2026.
- `GET /api/bi/despesas/lancamentos`: Listagem paginada (Pilar 1 - Envelope REST com teto de 100 itens).
- `GET /api/bi/despesas/naturezas-pais`: Lista de naturezas pai para filtro dinâmico.
- `GET /api/bi/despesas/sync-status`: Data/hora e volume de registros da última sincronização.
- `POST /api/bi/despesas/sync`: Disparo de sincronização incremental ou full com cooldown de 60s.

---

## 6. Testes Automatizados Vinculados
Execução da suíte completa de 15 testes:
```bash
node test_bi_despesas.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.250 (23/09/2026):** Homologação da sub-aba `💸 Despesas Análise` com espelhamento Protheus das 3 empresas, tratamento contábil de estornos com sinal negativo, segregação de transferências 2.10, comparativo 2025 x 2026, exportação CSV blindada contra formula injection e suíte automatizada.
