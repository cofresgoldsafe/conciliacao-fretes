-- ============================================================================
-- TABELA: fechamentos_vendedores
-- Finalidade: Armazenamento persistente e imutável dos fechamentos comerciais
-- mensais dos vendedores (ciclo 26 do mês anterior a 25 do mês atual), incluindo
-- vendas brutas, fretes embutidos deduzidos, inadimplência, comissões líquidas,
-- premiações de vendas e frete, rateio por empresa e benchmarking da equipe.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fechamentos_vendedores (
  id SERIAL PRIMARY KEY,
  ciclo_id VARCHAR(50) NOT NULL,            -- ex: '2026-07-26_2026-08-25'
  periodo_label VARCHAR(100) NOT NULL,       -- ex: '26/07/2026 a 25/08/2026'
  data_ini DATE NOT NULL,
  data_fim DATE NOT NULL,
  cod_vendedor VARCHAR(20) NOT NULL,
  nome_vendedor VARCHAR(100) NOT NULL,
  vendas_base_bruta NUMERIC(15, 2) DEFAULT 0,
  fretes_embutidos NUMERIC(15, 2) DEFAULT 0,
  vendas_base_liquida NUMERIC(15, 2) DEFAULT 0,
  meta_vendas_valor NUMERIC(15, 2) DEFAULT 120000,
  pct_meta_vendas NUMERIC(7, 2) DEFAULT 0,
  premio_meta_vendas NUMERIC(15, 2) DEFAULT 0,
  faixa_meta_vendas VARCHAR(50) DEFAULT '',
  gordura_frete_total NUMERIC(15, 2) DEFAULT 0,
  premio_gordura_frete NUMERIC(15, 2) DEFAULT 0,
  faixa_gordura_frete VARCHAR(50) DEFAULT '',
  comissao_taxa NUMERIC(5, 4) DEFAULT 0.0130, -- 1.30%
  comissao_bruta NUMERIC(15, 2) DEFAULT 0,
  inadimplentes_total NUMERIC(15, 2) DEFAULT 0,
  comissao_liquida NUMERIC(15, 2) DEFAULT 0,
  total_premios NUMERIC(15, 2) DEFAULT 0,
  total_geral_receber NUMERIC(15, 2) DEFAULT 0,
  faturamento_empresas_json JSONB,          -- { GSI: ..., OACO: ..., METAL_PLENO: ..., TOTAL: ... }
  benchmarking_json JSONB,                  -- { mediaVendasEquipe: ..., pctDiffVendas: ..., mediaGorduraEquipe: ..., pctDiffGordura: ... }
  metas_snapshot_json JSONB,                -- Snapshot imutável das regras de meta vigentes no momento do fechamento
  detalhes_json JSONB,                      -- Detalhamento adicional de títulos, pedidos e notas
  gerado_em TIMESTAMPTZ DEFAULT NOW(),
  tipo_geracao VARCHAR(30) DEFAULT 'JOB_AUTO', -- 'JOB_AUTO' ou 'MANUAL'
  CONSTRAINT uq_fechamento_ciclo_vend UNIQUE (ciclo_id, cod_vendedor)
);

-- Índices para buscas rápidas
CREATE INDEX IF NOT EXISTS idx_fechamentos_ciclo ON fechamentos_vendedores(ciclo_id);
CREATE INDEX IF NOT EXISTS idx_fechamentos_vendedor ON fechamentos_vendedores(cod_vendedor);
CREATE INDEX IF NOT EXISTS idx_fechamentos_datas ON fechamentos_vendedores(data_ini, data_fim);

-- Hardening de Segurança: Row-Level Security (RLS) compulsório
ALTER TABLE fechamentos_vendedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE fechamentos_vendedores FORCE ROW LEVEL SECURITY;

-- Concede privilégios de acesso apenas ao backend autenticado (service_role / postgres)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE fechamentos_vendedores TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE fechamentos_vendedores FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE fechamentos_vendedores FROM authenticated;
  END IF;
END $$;
