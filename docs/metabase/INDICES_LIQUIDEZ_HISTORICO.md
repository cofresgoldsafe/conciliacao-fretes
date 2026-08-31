# Manual Técnico: Módulo de Índices Financeiros de Liquidez & Snapshots Históricos

> **Módulo:** BI Executivo — Índices Financeiros de Liquidez & Solvência  
> **Versão Homologada:** v8.94  
> **Data:** 31/08/2026  
> **Público:** Diretoria Executiva, Controladoria Financeira e Engenharia de Software  

---

## 1. Visão Geral e Propósito

O módulo de **Índices Financeiros de Liquidez** foi desenvolvido para monitorar em tempo real e de forma histórica a capacidade das empresas do grupo (**Metal Pleno 14**, **GSI Cofres 15** e **OAÇO 16**) de honrar suas obrigações financeiras de curto prazo.

O módulo atua como a **1ª sub-aba padrão** da aba principal **`📊 BI EXECUTIVO`** no Portal GSI.

---

## 2. Fórmulas Matemáticas & Critérios Contábeis Oficiais

### 2.1. Liquidez Corrente ($LC$)
Mede quantos Reais a empresa possui em bens e direitos circulantes para cada R$ 1,00 de dívida de curto prazo.

$$LC = \frac{\text{Ativo Circulante}}{\text{Passivo Circulante}}$$

* **Numerador (Ativo Circulante):**
  $$\text{Ativo Circulante} = \text{Estoques PA (Custo Total)} + \text{Disponibilidades Bancárias (SE8)} + \text{Contas a Receber Válido (SE1 }\le 5\text{d)}$$
  1. **Estoques PA:** $\sum (\text{Quantidade com saldo } > 0 \times \text{B1\_VLUNIT / Custo Unitário})$ para produtos acabados (`B1_TIPO = 'PA'`).
  2. **Disponibilidades Bancárias:** $\sum \text{Último saldo registrado de todas as 22 contas correntes em SE8}$ (via CTE particionada por banco/agência/conta).
  3. **Contas a Receber Válido:** $\sum \text{Títulos em aberto em SE1 com saldo } > \text{R\$\ 0,01 não vencidos ou vencidos há no máximo 5 dias}$ ($\text{vencimento} \ge \text{Hoje} - 5\text{ dias}$).
* **Denominador (Passivo Circulante):**
  $$\text{Passivo Circulante} = \sum \text{Títulos em aberto em SE2 com saldo pendente } > \text{R\$\ 0,01 (incluindo provisórios PR e resíduos de baixa parcial; e excluindo adiantamentos PA)}$$
  * **Regra de Baixa Parcial:** Títulos pagos parcialmente utilizam exclusivamente o saldo residual pendente (`E2_SALDO > 0.01`).
  * **Exclusão de Adiantamentos (`PA`):** Títulos do tipo `PA` (Pagamentos Antecipados a fornecedores) são desconsiderados pois o recurso financeiro já saiu do caixa e aguarda apenas a NF para baixa contábil, não constituindo passivo futuro.
* **Parâmetro de Saúde:**
  * $\ge 1,50$: **Excelente** (Verde)
  * $\ge 1,00$: **Saudável** (Azul)
  * $< 1,00$: **Atenção** (Vermelho)

---

### 2.2. Liquidez Seca ($LS$)
Mede a solvência imediata da empresa sem depender da venda ou liquidação física de estoques.

$$LS = \frac{\text{Ativo Circulante} - \text{Estoques}}{\text{Passivo Circulante}} = \frac{\text{Disponibilidades Bancárias (SE8)} + \text{Contas a Receber Válido (SE1 }\le 5\text{d)}}{\text{Passivo Circulante (SE2 com PR)}}$$

* **Parâmetro de Saúde:**
  * $\ge 1,00$: **Excelente** (Verde)
  * $\ge 0,80$: **Saudável** (Azul)
  * $< 0,80$: **Atenção** (Vermelho)

---

### 2.3. Liquidez Imediata ($LI$)
Mede a capacidade instantânea da empresa de quitar compromissos utilizando unicamente o dinheiro já disponível em contas correntes bancárias.

$$LI = \frac{\text{Disponibilidades Bancárias}}{\text{Passivo Circulante}} = \frac{\sum \text{Saldos Bancários (SE8)}}{\text{Passivo Circulante (SE2 com PR)}}$$

* **Parâmetro de Saúde:**
  * $\ge 0,50$: **Excelente** (Verde)
  * $\ge 0,20$: **Saudável** (Amarelo/Azul)
  * $< 0,20$: **Atenção** (Vermelho)

---

## 3. Modelo de Dados no Supabase PostgreSQL

### 3.1. Tabela `estoque`
Armazena os saldos físicos, custo unitário e preço de venda de todos os produtos acabados (`PA`):
```sql
CREATE TABLE IF NOT EXISTS estoque (
  id BIGSERIAL PRIMARY KEY,
  empresa_cod VARCHAR(10) NOT NULL,
  empresa_sigla VARCHAR(10) NOT NULL,
  codigo VARCHAR(50) NOT NULL,
  descricao VARCHAR(255) NOT NULL,
  tipo VARCHAR(10) DEFAULT 'PA',
  grupo_cod VARCHAR(10) DEFAULT '',
  quantidade NUMERIC(15, 4) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(15, 4) NOT NULL DEFAULT 0,
  preco_venda NUMERIC(15, 2) NOT NULL DEFAULT 0,
  custo_total NUMERIC(15, 2) NOT NULL DEFAULT 0,
  valor_total_venda NUMERIC(15, 2) NOT NULL DEFAULT 0,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_estoque_empresa_codigo UNIQUE (empresa_cod, codigo)
);
```

### 3.2. Tabela `contas_a_receber`
Armazena a carteira de recebíveis abertos com identificação de atraso e natureza financeira:
```sql
CREATE TABLE IF NOT EXISTS contas_a_receber (
  id BIGSERIAL PRIMARY KEY,
  empresa_cod VARCHAR(10) NOT NULL,
  empresa_sigla VARCHAR(10) NOT NULL,
  filial VARCHAR(10) DEFAULT '01',
  prefixo VARCHAR(10) DEFAULT '',
  numero_titulo VARCHAR(20) NOT NULL,
  parcela VARCHAR(10) DEFAULT '',
  tipo VARCHAR(10) DEFAULT 'NF',
  cliente_cod VARCHAR(20),
  cliente_loja VARCHAR(10),
  cliente_nome VARCHAR(200),
  natureza_cod VARCHAR(20),
  data_emissao DATE,
  data_vencimento DATE NOT NULL,
  data_vencimento_real DATE,
  valor_original NUMERIC(15, 2) NOT NULL DEFAULT 0,
  saldo NUMERIC(15, 2) NOT NULL DEFAULT 0,
  dias_vencido INTEGER DEFAULT 0,
  valido_indice BOOLEAN DEFAULT TRUE,
  status VARCHAR(20) DEFAULT 'ABERTO',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_contas_a_receber UNIQUE (empresa_cod, prefixo, numero_titulo, parcela, tipo)
);
```

### 3.3. Tabela `contas_a_pagar`
Armazena os compromissos financeiros a pagar com marcação de provisórios `PR`:
```sql
CREATE TABLE IF NOT EXISTS contas_a_pagar (
  id BIGSERIAL PRIMARY KEY,
  empresa_cod VARCHAR(10) NOT NULL,
  empresa_sigla VARCHAR(10) NOT NULL,
  filial VARCHAR(10) DEFAULT '01',
  prefixo VARCHAR(10) DEFAULT '',
  numero_titulo VARCHAR(20) NOT NULL,
  parcela VARCHAR(10) DEFAULT '',
  tipo VARCHAR(10) DEFAULT 'NF',
  fornecedor_cod VARCHAR(20),
  fornecedor_loja VARCHAR(10),
  fornecedor_nome VARCHAR(200),
  natureza_cod VARCHAR(20),
  data_emissao DATE,
  data_vencimento DATE NOT NULL,
  data_vencimento_real DATE,
  valor_original NUMERIC(15, 2) NOT NULL DEFAULT 0,
  saldo NUMERIC(15, 2) NOT NULL DEFAULT 0,
  is_provisorio BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'ABERTO',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_contas_a_pagar UNIQUE (empresa_cod, prefixo, numero_titulo, parcela, tipo)
);
```

### 3.4. Tabela `saldos_bancarios`
Armazena o último fechamento de saldo de cada conta corrente ativa:
```sql
CREATE TABLE IF NOT EXISTS saldos_bancarios (
  id BIGSERIAL PRIMARY KEY,
  empresa_cod VARCHAR(10) NOT NULL,
  empresa_sigla VARCHAR(10) NOT NULL,
  banco_cod VARCHAR(10) NOT NULL,
  agencia VARCHAR(10) DEFAULT '',
  conta VARCHAR(20) NOT NULL,
  conta_nome VARCHAR(100) DEFAULT '',
  data_saldo DATE NOT NULL,
  saldo_atual NUMERIC(15, 2) NOT NULL DEFAULT 0,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_saldos_bancarios UNIQUE (empresa_cod, banco_cod, agencia, conta)
);
```

### 3.5. Tabela Histórica `indices_liquidez_historico` (Série Temporal)
Persiste snapshots cronológicos para análise de evolução e gráficos de tendência:
```sql
CREATE TABLE IF NOT EXISTS indices_liquidez_historico (
  id BIGSERIAL PRIMARY KEY,
  data_registro DATE NOT NULL DEFAULT CURRENT_DATE,
  timestamp_registro TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  empresa_cod VARCHAR(20) NOT NULL, -- 'CONSOLIDADO', '14', '15', '16'
  empresa_sigla VARCHAR(10),
  empresa_nome VARCHAR(100),
  liquidez_corrente NUMERIC(10, 4) NOT NULL DEFAULT 0,
  liquidez_seca NUMERIC(10, 4) NOT NULL DEFAULT 0,
  liquidez_imediata NUMERIC(10, 4) NOT NULL DEFAULT 0,
  ativo_circulante NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ativo_seco NUMERIC(15, 2) NOT NULL DEFAULT 0,
  passivo_circulante NUMERIC(15, 2) NOT NULL DEFAULT 0,
  estoque_custo NUMERIC(15, 2) DEFAULT 0,
  estoque_venda NUMERIC(15, 2) DEFAULT 0,
  total_itens_estoque INTEGER DEFAULT 0,
  disponibilidades NUMERIC(15, 2) DEFAULT 0,
  total_contas_bancarias INTEGER DEFAULT 0,
  receber_valido NUMERIC(15, 2) DEFAULT 0,
  receber_inadimplente NUMERIC(15, 2) DEFAULT 0,
  receber_total NUMERIC(15, 2) DEFAULT 0,
  total_titulos_receber INTEGER DEFAULT 0,
  pagar_total NUMERIC(15, 2) DEFAULT 0,
  pagar_provisorios_pr NUMERIC(15, 2) DEFAULT 0,
  pagar_definitivos NUMERIC(15, 2) DEFAULT 0,
  total_titulos_pagar INTEGER DEFAULT 0,
  triggered_by VARCHAR(50) DEFAULT 'JOB',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indices_hist_data ON indices_liquidez_historico(data_registro DESC);
CREATE INDEX IF NOT EXISTS idx_indices_hist_empresa ON indices_liquidez_historico(empresa_cod, data_registro DESC);
CREATE INDEX IF NOT EXISTS idx_indices_hist_ts ON indices_liquidez_historico(timestamp_registro DESC);
```

### 3.7. View Analítica Diária (`vw_indices_liquidez_diario`)
Garante exatamente **1 ponto por dia para cada empresa** no Metabase, selecionando automaticamente o fechamento mais recente de cada data:
```sql
CREATE OR REPLACE VIEW vw_indices_liquidez_diario AS
SELECT *
FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY data_registro, empresa_cod ORDER BY timestamp_registro DESC) as rn
  FROM indices_liquidez_historico
) sub
WHERE rn = 1;
```

---

## 4. Endpoints da API REST (Backend Node.js)

| Método | Endpoint | Parâmetros | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/bi/indices` | - | Retorna métricas consolidadas e por empresa, componentes e resumo de dados. |
| `POST` | `/api/bi/indices/sync` | - | Força extração Protheus em tempo real, atualiza DB e grava snapshots. (Cooldown: 60s). |
| `GET` | `/api/bi/indices/drilldown` | `tipo`, `empresa`, `search`, `limit`, `offset` | Retorna lista detalhada para a modal de conferência (`tipo=bancos\|receber\|pagar\|estoque`). |
| `GET` | `/api/bi/indices/historico` | `empresa`, `dias`, `limit` | Retorna a série temporal cronológica para plotagem de gráficos de evolução. |

---

## 5. Rotinas de Sincronização e Jobs em Background

1. **Sincronização Agendada (`JOB_AUTO`):**
   * Frequência: **A cada 180 minutos (3 horas)**.
   * Janela: **Segunda a Sexta-feira, das 07h00 às 19h00** (Horário Oficial de Brasília).
2. **Carga Inicial (`JOB_STARTUP`):**
   * Disparada 5 segundos após a inicialização do servidor Node.js.
3. **Disparo Manual (`MANUAL`):**
   * Acionado via botão `🔄 Sincronizar Protheus` no portal.
4. **Mecanismo de Upsert Diário:**
   * Múltiplas sincronizações no mesmo dia atualizam o registro daquela data, mantendo a série temporal limpa e sem dentes de serra.

---

## 6. Consultas SQL Úteis para o Metabase

### Gráfico de Linha: Evolução da Liquidez Corrente nos Últimos 90 Dias
```sql
SELECT 
  data_registro AS "Data",
  empresa_nome AS "Empresa",
  liquidez_corrente AS "Liquidez Corrente",
  liquidez_seca AS "Liquidez Seca",
  liquidez_imediata AS "Liquidez Imediata"
FROM vw_indices_liquidez_diario
WHERE data_registro >= CURRENT_DATE - INTERVAL '90 days'
  AND empresa_cod = 'CONSOLIDADO'
ORDER BY data_registro ASC;
```

### Gráfico de Comparação: Ativo Circulante vs. Passivo Circulante
```sql
SELECT 
  data_registro AS "Data",
  ativo_circulante AS "Ativo Circulante (R$)",
  passivo_circulante AS "Passivo Circulante (R$)",
  disponibilidades AS "Bancos (R$)",
  estoque_custo AS "Estoque Custo (R$)"
FROM vw_indices_liquidez_diario
WHERE data_registro >= CURRENT_DATE - INTERVAL '30 days'
  AND empresa_cod = 'CONSOLIDADO'
ORDER BY data_registro ASC;
```
