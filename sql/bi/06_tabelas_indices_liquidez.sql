-- ==============================================================================
-- 06_tabelas_indices_liquidez.sql
-- Módulo de BI Executivo: Índices Financeiros de Liquidez (LC, LS, LI)
-- Tabelas: estoque, contas_a_receber, contas_a_pagar, saldos_bancarios, indices_sync_logs
-- Plataforma de Apoio GSI (Gemini-Cli)
-- ==============================================================================

-- 1. TABELA DE ESTOQUE (PRODUTOS PA COM QUANTIDADE, CUSTO UNITÁRIO, VENDA E CUSTO TOTAL)
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

CREATE INDEX IF NOT EXISTS idx_estoque_empresa ON estoque(empresa_cod);
CREATE INDEX IF NOT EXISTS idx_estoque_tipo ON estoque(tipo);
CREATE INDEX IF NOT EXISTS idx_estoque_codigo ON estoque(codigo);
CREATE INDEX IF NOT EXISTS idx_estoque_qtd ON estoque(quantidade);
CREATE INDEX IF NOT EXISTS idx_estoque_grupo ON estoque(grupo_cod);

-- 2. TABELA DE CONTAS A RECEBER (SE1 MULTI-EMPRESA COM VENCIMENTOS E NATUREZAS)
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

CREATE INDEX IF NOT EXISTS idx_cr_empresa ON contas_a_receber(empresa_cod);
CREATE INDEX IF NOT EXISTS idx_cr_vencto ON contas_a_receber(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cr_natureza ON contas_a_receber(natureza_cod);
CREATE INDEX IF NOT EXISTS idx_cr_saldo ON contas_a_receber(saldo);
CREATE INDEX IF NOT EXISTS idx_cr_valido_indice ON contas_a_receber(valido_indice);
CREATE INDEX IF NOT EXISTS idx_cr_cliente ON contas_a_receber(cliente_nome);

-- 3. TABELA DE CONTAS A PAGAR (SE2 MULTI-EMPRESA INCLUINDO PROVISÓRIOS PR E NATUREZAS)
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

CREATE INDEX IF NOT EXISTS idx_cp_empresa ON contas_a_pagar(empresa_cod);
CREATE INDEX IF NOT EXISTS idx_cp_vencto ON contas_a_pagar(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cp_natureza ON contas_a_pagar(natureza_cod);
CREATE INDEX IF NOT EXISTS idx_cp_tipo ON contas_a_pagar(tipo);
CREATE INDEX IF NOT EXISTS idx_cp_saldo ON contas_a_pagar(saldo);
CREATE INDEX IF NOT EXISTS idx_cp_is_provisorio ON contas_a_pagar(is_provisorio);
CREATE INDEX IF NOT EXISTS idx_cp_fornecedor ON contas_a_pagar(fornecedor_nome);

-- 4. TABELA DE SALDOS BANCÁRIOS (SE8 MULTI-EMPRESA - ÚLTIMO SALDO DISPONÍVEL POR CONTA)
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

CREATE INDEX IF NOT EXISTS idx_sb_empresa ON saldos_bancarios(empresa_cod);
CREATE INDEX IF NOT EXISTS idx_sb_banco ON saldos_bancarios(banco_cod);

-- 5. TABELA DE LOGS DE SINCRONIZAÇÃO DOS ÍNDICES
CREATE TABLE IF NOT EXISTS indices_sync_logs (
  id BIGSERIAL PRIMARY KEY,
  status VARCHAR(50) NOT NULL,
  total_estoque INTEGER DEFAULT 0,
  total_receber INTEGER DEFAULT 0,
  total_pagar INTEGER DEFAULT 0,
  total_bancos INTEGER DEFAULT 0,
  valor_ativo_circulante NUMERIC(15, 2) DEFAULT 0,
  valor_passivo_circulante NUMERIC(15, 2) DEFAULT 0,
  liquidez_corrente_consolidada NUMERIC(10, 4) DEFAULT 0,
  duracao_ms INTEGER DEFAULT 0,
  triggered_by VARCHAR(100) DEFAULT 'JOB',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indices_sync_logs_created ON indices_sync_logs(created_at DESC);

-- 6. TABELA HISTÓRICA DE SÉRIE TEMPORAL DOS ÍNDICES (EVOLUÇÃO E GRÁFICOS)
CREATE TABLE IF NOT EXISTS indices_liquidez_historico (
  id BIGSERIAL PRIMARY KEY,
  data_registro DATE NOT NULL DEFAULT CURRENT_DATE,
  timestamp_registro TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  empresa_cod VARCHAR(20) NOT NULL,
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

-- 7. VIEW ANALÍTICA DE ÍNDICES FINANCEIROS PARA O METABASE & DASHBOARD
CREATE OR REPLACE VIEW vw_bi_indices_liquidez AS
WITH comp_estoque AS (
  SELECT 
    empresa_cod,
    empresa_sigla,
    COALESCE(SUM(custo_total), 0) AS total_estoque_custo,
    COALESCE(SUM(valor_total_venda), 0) AS total_estoque_venda,
    COUNT(*) AS total_itens_estoque
  FROM estoque
  WHERE quantidade > 0 AND tipo = 'PA'
  GROUP BY empresa_cod, empresa_sigla
),
comp_bancos AS (
  SELECT 
    empresa_cod,
    empresa_sigla,
    COALESCE(SUM(saldo_atual), 0) AS total_saldos_bancarios,
    COUNT(*) AS total_contas_bancarias
  FROM saldos_bancarios
  GROUP BY empresa_cod, empresa_sigla
),
comp_receber AS (
  SELECT 
    empresa_cod,
    empresa_sigla,
    COALESCE(SUM(saldo), 0) AS total_receber_aberto,
    COALESCE(SUM(CASE WHEN valido_indice THEN saldo ELSE 0 END), 0) AS total_receber_valido_indice,
    COALESCE(SUM(CASE WHEN NOT valido_indice THEN saldo ELSE 0 END), 0) AS total_receber_inadimplente_mais_5d,
    COUNT(*) AS total_titulos_receber
  FROM contas_a_receber
  WHERE saldo > 0
  GROUP BY empresa_cod, empresa_sigla
),
comp_pagar AS (
  SELECT 
    empresa_cod,
    empresa_sigla,
    COALESCE(SUM(saldo), 0) AS total_pagar_aberto,
    COALESCE(SUM(CASE WHEN is_provisorio THEN saldo ELSE 0 END), 0) AS total_pagar_provisorios_pr,
    COALESCE(SUM(CASE WHEN NOT is_provisorio THEN saldo ELSE 0 END), 0) AS total_pagar_definitivos,
    COUNT(*) AS total_titulos_pagar
  FROM contas_a_pagar
  WHERE saldo > 0
  GROUP BY empresa_cod, empresa_sigla
),
empresas_base AS (
  SELECT '14' AS empresa_cod, 'MP' AS empresa_sigla, 'Metal Pleno' AS empresa_nome
  UNION ALL
  SELECT '15' AS empresa_cod, 'GSI' AS empresa_sigla, 'GSI Cofres' AS empresa_nome
  UNION ALL
  SELECT '16' AS empresa_cod, 'OACO' AS empresa_sigla, 'OAÇO' AS empresa_nome
)
SELECT 
  eb.empresa_cod,
  eb.empresa_sigla,
  eb.empresa_nome,
  COALESCE(e.total_estoque_custo, 0) AS estoque_custo,
  COALESCE(e.total_estoque_venda, 0) AS estoque_venda,
  COALESCE(e.total_itens_estoque, 0) AS total_itens_estoque,
  COALESCE(b.total_saldos_bancarios, 0) AS disponibilidades_bancarias,
  COALESCE(b.total_contas_bancarias, 0) AS total_contas_bancarias,
  COALESCE(r.total_receber_aberto, 0) AS contas_receber_total,
  COALESCE(r.total_receber_valido_indice, 0) AS contas_receber_valido,
  COALESCE(r.total_receber_inadimplente_mais_5d, 0) AS contas_receber_inadimplente_5d,
  COALESCE(p.total_pagar_aberto, 0) AS contas_pagar_total,
  COALESCE(p.total_pagar_provisorios_pr, 0) AS contas_pagar_provisorios_pr,
  COALESCE(p.total_pagar_definitivos, 0) AS contas_pagar_definitivos,
  -- Ativo Circulante = Estoque Custo + Disponibilidades + Receber Válido
  ROUND(COALESCE(e.total_estoque_custo, 0) + COALESCE(b.total_saldos_bancarios, 0) + COALESCE(r.total_receber_valido_indice, 0), 2) AS ativo_circulante,
  -- Passivo Circulante = Total Contas a Pagar (incluindo PR)
  ROUND(COALESCE(p.total_pagar_aberto, 0), 2) AS passivo_circulante,
  -- Liquidez Corrente = Ativo Circulante / Passivo Circulante
  ROUND(
    (COALESCE(e.total_estoque_custo, 0) + COALESCE(b.total_saldos_bancarios, 0) + COALESCE(r.total_receber_valido_indice, 0)) / 
    NULLIF(COALESCE(p.total_pagar_aberto, 0), 0), 4
  ) AS liquidez_corrente,
  -- Liquidez Seca = (Ativo Circulante - Estoque) / Passivo Circulante
  ROUND(
    (COALESCE(b.total_saldos_bancarios, 0) + COALESCE(r.total_receber_valido_indice, 0)) / 
    NULLIF(COALESCE(p.total_pagar_aberto, 0), 0), 4
  ) AS liquidez_seca,
  -- Liquidez Imediata = Disponibilidades / Passivo Circulante
  ROUND(
    COALESCE(b.total_saldos_bancarios, 0) / 
    NULLIF(COALESCE(p.total_pagar_aberto, 0), 0), 4
  ) AS liquidez_imediata
FROM empresas_base eb
LEFT JOIN comp_estoque e ON e.empresa_cod = eb.empresa_cod
LEFT JOIN comp_bancos b ON b.empresa_cod = eb.empresa_cod
LEFT JOIN comp_receber r ON r.empresa_cod = eb.empresa_cod
LEFT JOIN comp_pagar p ON p.empresa_cod = eb.empresa_cod;

-- 8. ATIVAÇÃO DE ROW-LEVEL SECURITY (RLS)
ALTER TABLE estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_a_receber ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_a_pagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_bancarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE indices_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE indices_liquidez_historico ENABLE ROW LEVEL SECURITY;

