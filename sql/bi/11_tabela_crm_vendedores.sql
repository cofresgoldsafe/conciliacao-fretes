-- ============================================================================
-- 11_tabela_crm_vendedores.sql
-- Módulo de CRM Comercial Nativo — Cadastro de Vendedores, Escopo RBAC e Metas
-- Plataforma de Apoio GSI -> Supabase PostgreSQL (CRM-19 / v8.321)
-- ============================================================================
-- Regras de Meta Mensal (meta_mensal NUMERIC NULL):
--   - NULL: utiliza metaBaseVendas (R$ 120.000,00 padrão) de system_configs ('config_metas_vendas')
--   - 0: vendedor/diretor sem meta mensal e excluído da soma da equipe (Alexandre = '000001')
--   - Valor > 0: meta individual customizada sobrepondo a meta base
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_vendedores (
    cod_vendedor        VARCHAR(20) PRIMARY KEY,
    username_portal     VARCHAR(100) UNIQUE,
    nome                VARCHAR(100) NOT NULL,
    email               VARCHAR(200),
    telefone_whatsapp   VARCHAR(20),
    assinatura          TEXT,
    meta_mensal         NUMERIC(15, 2) NULL,
    herda_historico_de  VARCHAR(20)[] NOT NULL DEFAULT '{}',
    ativo               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          VARCHAR(100)
);

-- Seed idempotente dos vendedores oficiais e diretoria
INSERT INTO crm_vendedores (cod_vendedor, username_portal, nome, meta_mensal) VALUES
    ('000004', 'figueiredo', 'Figueiredo', NULL),
    ('000064', 'andrea',     'Andrea',     NULL),
    ('000074', 'juliana',    'Juliana',    NULL),
    ('000001', 'alexandre',  'Alexandre',  0)
ON CONFLICT (cod_vendedor) DO NOTHING;

-- Autoria nunca mais assume 'alexandre' por default no banco
ALTER TABLE IF EXISTS crm_deals      ALTER COLUMN created_by DROP DEFAULT;
ALTER TABLE IF EXISTS crm_deals      ALTER COLUMN updated_by DROP DEFAULT;
ALTER TABLE IF EXISTS crm_atividades ALTER COLUMN created_by DROP DEFAULT;

-- Índice parcial para listagem rápida por proprietário em negócios ativos
CREATE INDEX IF NOT EXISTS idx_crm_deals_cod_vendedor_ativo
    ON crm_deals (cod_vendedor)
    WHERE ativo = TRUE;

CREATE INDEX IF NOT EXISTS idx_crm_vendedores_username
    ON crm_vendedores (LOWER(username_portal));

-- ============================================================================
-- Hardening de Segurança: Row-Level Security (RLS) Estrito e Compulsório
-- ============================================================================
ALTER TABLE crm_vendedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_vendedores FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON TABLE crm_vendedores TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT ALL ON TABLE crm_vendedores TO postgres;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE crm_vendedores FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE crm_vendedores FROM authenticated;
    END IF;
END $$;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Acesso exclusivo backend crm_vendedores" ON crm_vendedores;
    CREATE POLICY "Acesso exclusivo backend crm_vendedores"
        ON crm_vendedores
        TO service_role, postgres
        USING (true)
        WITH CHECK (true);
END $$;
