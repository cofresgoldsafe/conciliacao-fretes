-- ============================================================================
-- 09_tabela_crm_produtos.sql
-- Módulo de CRM Comercial Nativo: Espelho de Catálogo de Produtos Protheus (SB1090/SB1160)
-- Plataforma de Apoio GSI -> Supabase PostgreSQL
-- ============================================================================
-- Tabela:
--   crm_produtos: Armazena o espelho do catálogo de produtos do TOTVS Protheus ERP,
--                 permitindo autocomplete ultra-rápido (<50ms), precificação oficial,
--                 especificação técnica (NCM, pesos, IPI) e operação offline resiliente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_produtos (
    codigo VARCHAR(50) PRIMARY KEY,
    descricao VARCHAR(255) NOT NULL,
    ncm VARCHAR(20),
    unidade VARCHAR(10) DEFAULT 'UN',
    tipo VARCHAR(10) DEFAULT 'PA',
    grupo VARCHAR(50),
    preco_tabela NUMERIC(14,2) DEFAULT 0.00,
    peso_liquido NUMERIC(12,4) DEFAULT 0.0000,
    peso_bruto NUMERIC(12,4) DEFAULT 0.0000,
    aliquota_ipi NUMERIC(6,2) DEFAULT 0.00,
    bloqueado BOOLEAN DEFAULT FALSE,
    custom JSONB DEFAULT '{}'::jsonb,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrações idempotentes para atualizações de schema incrementais
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS ncm VARCHAR(20);
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS unidade VARCHAR(10) DEFAULT 'UN';
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) DEFAULT 'PA';
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS grupo VARCHAR(50);
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS preco_tabela NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS peso_liquido NUMERIC(12,4) DEFAULT 0.0000;
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS peso_bruto NUMERIC(12,4) DEFAULT 0.0000;
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS aliquota_ipi NUMERIC(6,2) DEFAULT 0.00;
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS custom JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================================
-- Índices B-Tree para consultas de autocomplete, relatórios e filtros
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_crm_produtos_descricao ON crm_produtos(descricao);
CREATE INDEX IF NOT EXISTS idx_crm_produtos_grupo ON crm_produtos(grupo);
CREATE INDEX IF NOT EXISTS idx_crm_produtos_bloqueado ON crm_produtos(bloqueado);
CREATE INDEX IF NOT EXISTS idx_crm_produtos_tipo ON crm_produtos(tipo);
CREATE INDEX IF NOT EXISTS idx_crm_produtos_synced_at ON crm_produtos(synced_at DESC);

-- ============================================================================
-- Hardening de Segurança: Row-Level Security (RLS) Estrito e Compulsório
-- ============================================================================
ALTER TABLE crm_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_produtos FORCE ROW LEVEL SECURITY;

-- Concede privilégios de acesso apenas ao backend autenticado (service_role e postgres)
-- e revoga categoricamente todo acesso anônimo ou de usuários comuns (anon / authenticated)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON TABLE crm_produtos TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT ALL ON TABLE crm_produtos TO postgres;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE crm_produtos FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE crm_produtos FROM authenticated;
    END IF;
END $$;

-- Política de RLS exclusiva para service_role e postgres
DO $$
BEGIN
    DROP POLICY IF EXISTS "Acesso exclusivo backend crm_produtos" ON crm_produtos;
    CREATE POLICY "Acesso exclusivo backend crm_produtos" ON crm_produtos TO service_role, postgres USING (true) WITH CHECK (true);
END $$;
