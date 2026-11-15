-- ============================================================================
-- MIGRATION 14: VÍNCULO DE CONVERSAS DO WHATSAPP AO CRM (CRM-21a)
-- ============================================================================
-- Data: 14/11/2026
-- Objetivo: Criar tabela crm_deal_conversas, coluna origem_ref em crm_deals
-- e aplicar Row-Level Security (RLS) estrito.
-- ============================================================================

ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS origem_ref VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_deals_origem_ref ON crm_deals (origem_ref) WHERE origem_ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS crm_deal_conversas (id BIGSERIAL PRIMARY KEY, deal_id VARCHAR(64) NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE, conversa_id VARCHAR(64) NOT NULL, telefone_e164 VARCHAR(15) NOT NULL, linha_whatsapp VARCHAR(64), principal BOOLEAN NOT NULL DEFAULT FALSE, ativo BOOLEAN NOT NULL DEFAULT TRUE, vinculado_por VARCHAR(100) NOT NULL, vinculado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (deal_id, conversa_id));
CREATE INDEX IF NOT EXISTS idx_crm_deal_conversas_tel ON crm_deal_conversas (telefone_e164) WHERE ativo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_deal_conversas_principal ON crm_deal_conversas (deal_id) WHERE principal AND ativo;

-- ============================================================================
-- Hardening de Segurança: Row-Level Security (RLS) e Grants Explícitos
-- ============================================================================
ALTER TABLE crm_deal_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_conversas FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE crm_deal_conversas TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE crm_deal_conversas_id_seq TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT ALL ON TABLE crm_deal_conversas TO postgres;
    GRANT USAGE, SELECT ON SEQUENCE crm_deal_conversas_id_seq TO postgres;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE crm_deal_conversas FROM anon;
    REVOKE ALL ON SEQUENCE crm_deal_conversas_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE crm_deal_conversas FROM authenticated;
    REVOKE ALL ON SEQUENCE crm_deal_conversas_id_seq FROM authenticated;
  END IF;
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Acesso exclusivo backend crm_deal_conversas" ON crm_deal_conversas;
  CREATE POLICY "Acesso exclusivo backend crm_deal_conversas"
    ON crm_deal_conversas
    TO service_role, postgres
    USING (true)
    WITH CHECK (true);
END $$;
