-- ============================================================================
-- TABELA E VIEWS ANALÍTICAS DE DESPESAS BANCÁRIAS E CLASSIFICAÇÃO POR NATUREZA (BI)
-- Plataforma de Apoio GSI (Gemini-Cli) -> Supabase PostgreSQL -> BI Executivo
-- ============================================================================

-- 1. Tabela Principal: Espelho Analítico de Movimentações Bancárias de Despesas
CREATE TABLE IF NOT EXISTS bi_despesas_movimentos (
    id BIGSERIAL PRIMARY KEY,
    empresa_cod VARCHAR(10) NOT NULL,          -- '14', '15', '16'
    empresa_sigla VARCHAR(10) NOT NULL,        -- 'MP', 'GSI', 'OACO'
    empresa_nome VARCHAR(50),                  -- 'Metal Pleno', 'GSI Cofres', 'OAÇO'
    recno_se5 BIGINT NOT NULL,                 -- R_E_C_N_O_ da SE5 original no Protheus
    data_movimento DATE NOT NULL,              -- Data do movimento bancário (E5_DATA formatada)
    ano INTEGER NOT NULL,                      -- 2025, 2026
    mes INTEGER NOT NULL,                      -- 1 a 12
    mes_ano VARCHAR(7) NOT NULL,               -- '2025-01', '2026-09'
    natureza_cod VARCHAR(20) NOT NULL,         -- E5_NATUREZ (ex: '2.01.001')
    natureza_desc VARCHAR(150),                -- ED_DESCRIC da SED010
    natureza_pai_cod VARCHAR(20) NOT NULL,     -- Código Pai (ex: '2.01')
    natureza_pai_desc VARCHAR(150),            -- Descrição Pai da SED010 (ex: 'DESPESAS ADMINISTRACAO')
    fornecedor_cod VARCHAR(20),                -- E5_CLIFOR
    fornecedor_loja VARCHAR(10),               -- E5_LOJA
    fornecedor_nome VARCHAR(200),              -- Razão social do fornecedor (SA2010 ou E5_BENEF)
    valor_bruto NUMERIC(15, 2) NOT NULL,       -- Valor nominal original (E5_VALOR)
    valor_liquido NUMERIC(15, 2) NOT NULL,     -- Positivo para pagamentos, NEGATIVO para estornos
    recpag VARCHAR(5) NOT NULL,                -- 'P' (Pagamento) ou 'R' (Estorno/Recebimento)
    tipo_doc VARCHAR(10),                      -- 'VL', 'BA', 'ES', 'TR', 'TE', etc.
    motivo_baixa VARCHAR(10),                  -- 'DEB', 'NOR', 'CMP', etc.
    is_estorno BOOLEAN NOT NULL DEFAULT FALSE, -- Flag indicador de estorno/cancelamento
    is_transferencia BOOLEAN NOT NULL DEFAULT FALSE, -- Flag para TR/TE/2.10 (ajustes e transferências bancárias)
    numero_documento VARCHAR(40),              -- E5_DOCUMEN
    numero_titulo VARCHAR(30),                 -- E5_NUMERO
    historico TEXT,                            -- E5_HISTOR
    banco VARCHAR(10),                         -- E5_BANCO (ex: '077')
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_bi_despesas_empresa_recno UNIQUE (empresa_cod, recno_se5)
);

-- Índices estratégicos para agregações instantâneas no BI
CREATE INDEX IF NOT EXISTS idx_bi_desp_data ON bi_despesas_movimentos(data_movimento);
CREATE INDEX IF NOT EXISTS idx_bi_desp_mes_ano ON bi_despesas_movimentos(mes_ano);
CREATE INDEX IF NOT EXISTS idx_bi_desp_ano_mes ON bi_despesas_movimentos(ano, mes);
CREATE INDEX IF NOT EXISTS idx_bi_desp_pai ON bi_despesas_movimentos(natureza_pai_cod);
CREATE INDEX IF NOT EXISTS idx_bi_desp_empresa ON bi_despesas_movimentos(empresa_cod);
CREATE INDEX IF NOT EXISTS idx_bi_desp_nat ON bi_despesas_movimentos(natureza_cod);
CREATE INDEX IF NOT EXISTS idx_bi_desp_operacional ON bi_despesas_movimentos(is_transferencia, is_estorno);

-- Habilitar Row Level Security (RLS)
ALTER TABLE bi_despesas_movimentos ENABLE ROW LEVEL SECURITY;

-- 2. Tabela de Controle de Sincronização e Metadados
CREATE TABLE IF NOT EXISTS bi_despesas_sync_log (
    id BIGSERIAL PRIMARY KEY,
    last_sync_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    data_corte_inicio DATE NOT NULL,
    data_corte_fim DATE NOT NULL,
    modo VARCHAR(20) NOT NULL,                 -- 'incremental' ou 'full'
    total_registros INTEGER NOT NULL DEFAULT 0,
    novos_ou_atualizados INTEGER NOT NULL DEFAULT 0,
    duracao_ms INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS' ou 'ERROR'
    triggered_by VARCHAR(100) DEFAULT 'admin',
    erro_detalhes TEXT
);

-- 3. View Analítica 1: Despesas Mensais por Natureza Pai
CREATE OR REPLACE VIEW vw_bi_despesas_natureza_pai_mes AS
SELECT
    mes_ano,
    ano,
    mes,
    empresa_cod,
    empresa_sigla,
    natureza_pai_cod,
    natureza_pai_desc,
    SUM(valor_liquido) AS total_liquido,
    SUM(CASE WHEN is_estorno THEN valor_bruto ELSE 0 END) AS total_estornado,
    COUNT(*) AS total_lancamentos
FROM bi_despesas_movimentos
WHERE is_transferencia = FALSE
GROUP BY
    mes_ano,
    ano,
    mes,
    empresa_cod,
    empresa_sigla,
    natureza_pai_cod,
    natureza_pai_desc;

-- 4. View Analítica 2: Comparativo Mês a Mês Consolidado (2025 vs 2026)
CREATE OR REPLACE VIEW vw_bi_despesas_comparativo_anual AS
SELECT
    mes,
    empresa_sigla,
    natureza_pai_cod,
    natureza_pai_desc,
    SUM(CASE WHEN ano = 2025 THEN valor_liquido ELSE 0 END) AS valor_2025,
    SUM(CASE WHEN ano = 2026 THEN valor_liquido ELSE 0 END) AS valor_2026,
    (SUM(CASE WHEN ano = 2026 THEN valor_liquido ELSE 0 END) - SUM(CASE WHEN ano = 2025 THEN valor_liquido ELSE 0 END)) AS diferenca_absoluta,
    ROUND(
        CASE 
            WHEN SUM(CASE WHEN ano = 2025 THEN valor_liquido ELSE 0 END) > 0 
            THEN ((SUM(CASE WHEN ano = 2026 THEN valor_liquido ELSE 0 END) - SUM(CASE WHEN ano = 2025 THEN valor_liquido ELSE 0 END)) / SUM(CASE WHEN ano = 2025 THEN valor_liquido ELSE 0 END)) * 100 
            ELSE 0 
        END, 2
    ) AS variacao_percentual
FROM bi_despesas_movimentos
WHERE is_transferencia = FALSE
GROUP BY
    mes,
    empresa_sigla,
    natureza_pai_cod,
    natureza_pai_desc;
