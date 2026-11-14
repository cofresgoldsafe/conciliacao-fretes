-- ============================================================================
-- MIGRATION 12: TABELAS DE EMPRESAS EMITENTES E PROPOSTAS EM PDF NO CRM (CRM-20)
-- ============================================================================
-- Data: 13/11/2026
-- Objetivo: Cadastrar identidade visual e fiscal das empresas emissoras (14, 15, 16)
-- a partir de DADOS_EMITENTES (danfe_protheus.js) e armazenar revisões imutáveis
-- de propostas comerciais em PDF com link público.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_empresas_emitentes'
      AND column_name = 'inscricao_estadual'
  ) THEN
    DROP TABLE IF EXISTS public.crm_propostas CASCADE;
    DROP TABLE IF EXISTS public.crm_empresas_emitentes CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_empresas_emitentes (
  codigo                VARCHAR(2) PRIMARY KEY,          -- '14', '15', '16'
  razao_social          VARCHAR(200) NOT NULL,
  nome_fantasia         VARCHAR(150) NOT NULL,
  cnpj                  VARCHAR(14) NOT NULL,
  ie                    VARCHAR(20),
  endereco              VARCHAR(300),                    -- linha única já formatada
  telefone              VARCHAR(30),
  email_contato         VARCHAR(200),
  site                  VARCHAR(150),
  logo_path             VARCHAR(200),                    -- relativo a public/, ex. 'logos/logo-gsi.png'; NULL = cabeçalho em texto
  cor_primaria          VARCHAR(7) NOT NULL DEFAULT '#0b3d91',
  cor_secundaria        VARCHAR(7) NOT NULL DEFAULT '#f59e0b',
  texto_rodape          TEXT,                            -- condições gerais, garantia
  texto_email           TEXT,                            -- corpo padrão do e-mail
  dados_bancarios_pix   TEXT,
  validade_padrao_dias  SMALLINT NOT NULL DEFAULT 7 CHECK (validade_padrao_dias BETWEEN 1 AND 60),
  blocos_opcionais      JSONB NOT NULL DEFAULT '{"mostrar_ncm": false, "mostrar_peso": false}'::jsonb,
  ativo                 BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            VARCHAR(100)
);

INSERT INTO crm_empresas_emitentes (codigo, razao_social, nome_fantasia, cnpj, ie, endereco, telefone, logo_path) VALUES
  ('14', 'METAL PLENO COMERCIO DE FECHADURAS E FERRAGENS LTDA', 'Metal Pleno', '48758821000118', '145707309111',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', NULL),
  ('15', 'GSI BRASIL PRESTACAO DE SERVICOS LTDA', 'GSI Brasil', '14061778000115', 'ISENTO',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', 'logos/logo-gsi.png'),
  ('16', 'OACO INDUSTRIA E COMERCIO DE COFRES LTDA', 'OAÇO / Cofres Gold Safe', '61237790000118', '535132321110',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', 'logos/logo-oaco.png')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm_propostas (
  id               BIGSERIAL PRIMARY KEY,
  deal_id          VARCHAR(64) NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  revisao          SMALLINT NOT NULL,
  numero           VARCHAR(80) NOT NULL UNIQUE,         -- '29001-R2'
  empresa_codigo   VARCHAR(2) NOT NULL REFERENCES crm_empresas_emitentes(codigo),
  cod_vendedor     VARCHAR(20) NOT NULL,
  snapshot         JSONB NOT NULL,                       -- tudo o que foi impresso (seção 4.2)
  valor_total      NUMERIC(15,2) NOT NULL,
  validade_ate     DATE NOT NULL,
  pdf              BYTEA NOT NULL,
  pdf_sha256       CHAR(64) NOT NULL,
  token_publico    VARCHAR(64) NOT NULL UNIQUE,          -- 32 bytes aleatórios em base64url
  gerada_por       VARCHAR(100) NOT NULL,
  gerada_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviada_via      VARCHAR(20)[] NOT NULL DEFAULT '{}',  -- 'email', 'download', 'link' (CRM-22 acrescenta 'whatsapp')
  enviada_em       TIMESTAMPTZ,                          -- primeiro envio
  visualizada_em   TIMESTAMPTZ,                          -- primeira abertura válida do link
  aberturas        INTEGER NOT NULL DEFAULT 0,
  ultima_abertura_em TIMESTAMPTZ,
  UNIQUE (deal_id, revisao)
);

CREATE INDEX IF NOT EXISTS idx_crm_propostas_deal ON crm_propostas (deal_id, revisao DESC);
CREATE INDEX IF NOT EXISTS idx_crm_propostas_validade ON crm_propostas (validade_ate);

-- ============================================================================
-- Hardening de Segurança: Row-Level Security (RLS) e Grants Explícitos
-- ============================================================================
ALTER TABLE crm_empresas_emitentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_empresas_emitentes FORCE ROW LEVEL SECURITY;

ALTER TABLE crm_propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_propostas FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE crm_empresas_emitentes TO service_role;
    GRANT ALL ON TABLE crm_propostas TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE crm_propostas_id_seq TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT ALL ON TABLE crm_empresas_emitentes TO postgres;
    GRANT ALL ON TABLE crm_propostas TO postgres;
    GRANT USAGE, SELECT ON SEQUENCE crm_propostas_id_seq TO postgres;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE crm_empresas_emitentes FROM anon;
    REVOKE ALL ON TABLE crm_propostas FROM anon;
    REVOKE ALL ON SEQUENCE crm_propostas_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE crm_empresas_emitentes FROM authenticated;
    REVOKE ALL ON TABLE crm_propostas FROM authenticated;
    REVOKE ALL ON SEQUENCE crm_propostas_id_seq FROM authenticated;
  END IF;
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Acesso exclusivo backend crm_empresas_emitentes" ON crm_empresas_emitentes;
  CREATE POLICY "Acesso exclusivo backend crm_empresas_emitentes"
    ON crm_empresas_emitentes
    TO service_role, postgres
    USING (true)
    WITH CHECK (true);

  DROP POLICY IF EXISTS "Acesso exclusivo backend crm_propostas" ON crm_propostas;
  CREATE POLICY "Acesso exclusivo backend crm_propostas"
    ON crm_propostas
    TO service_role, postgres
    USING (true)
    WITH CHECK (true);
END $$;
