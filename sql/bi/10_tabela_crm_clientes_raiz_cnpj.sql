-- ============================================================================
-- 10_tabela_crm_clientes_raiz_cnpj.sql
-- Módulo de Fidelidade e Inteligência Comercial por Raiz de CNPJ (Grupo GSI)
-- Plataforma de Apoio GSI -> Supabase PostgreSQL
-- ============================================================================
-- Consolida o histórico de compras de todas as 7 empresas:
--   Empresas Inativas: 01, 04, 05, 09
--   Empresas Ativas:   14, 15, 16
-- Permite lookup instantâneo O(1) de fidelidade no CRM Comercial (⭐ 1-5 / 💎 6+)
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_clientes_raiz_cnpj (
    raiz_cnpj VARCHAR(8) PRIMARY KEY,
    razao_social VARCHAR(255),
    total_compras INTEGER NOT NULL DEFAULT 0,
    valor_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    primeira_compra DATE,
    ultima_compra DATE,
    empresas JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Índices B-Tree para buscas e relatórios
CREATE INDEX IF NOT EXISTS idx_crm_clientes_raiz_cnpj_total ON crm_clientes_raiz_cnpj(total_compras DESC);
CREATE INDEX IF NOT EXISTS idx_crm_clientes_raiz_cnpj_valor ON crm_clientes_raiz_cnpj(valor_total DESC);
CREATE INDEX IF NOT EXISTS idx_crm_clientes_raiz_cnpj_ultima ON crm_clientes_raiz_cnpj(ultima_compra DESC);

-- Comentários descritivos
COMMENT ON TABLE crm_clientes_raiz_cnpj IS 'Armazena a inteligência e contagem histórica de faturamento consolidado por Raiz do CNPJ (8 dígitos) no Grupo GSI.';
COMMENT ON COLUMN crm_clientes_raiz_cnpj.raiz_cnpj IS '8 primeiros dígitos do CNPJ da matriz e filiais do grupo econômico.';
COMMENT ON COLUMN crm_clientes_raiz_cnpj.total_compras IS 'Total de notas fiscais de saída faturadas nas 7 empresas do grupo.';
COMMENT ON COLUMN crm_clientes_raiz_cnpj.empresas IS 'Array JSON com as siglas/códigos das empresas onde a raiz já comprou (ex: ["01", "05", "15"]).';
