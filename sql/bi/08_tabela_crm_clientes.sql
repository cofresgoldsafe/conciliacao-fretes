-- ============================================================================
-- 08_tabela_crm_clientes.sql
-- Módulo de CRM Comercial Nativo: Cadastro de Clientes (Base Unificada CRM)
-- Plataforma de Apoio GSI -> Supabase PostgreSQL
-- ============================================================================
-- Tabela:
--   crm_clientes: Armazena o cadastro comercial unificado de clientes do CRM
--                 permitindo registro rápido de leads/contatos, sincronização
--                 com Protheus (SA1010) e busca integrada em tempo real.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_clientes (
    id VARCHAR(64) PRIMARY KEY,
    tipo_pessoa VARCHAR(2) DEFAULT 'PJ',
    nome_razao VARCHAR(255) NOT NULL,
    nome_fantasia VARCHAR(255),
    cnpj_cpf VARCHAR(20),
    ie VARCHAR(20),
    contato_nome VARCHAR(150),
    telefone VARCHAR(50),
    celular_whatsapp VARCHAR(50),
    email VARCHAR(150),
    cep VARCHAR(10),
    logradouro VARCHAR(255),
    numero VARCHAR(50),
    complemento VARCHAR(100),
    bairro VARCHAR(100),
    cidade VARCHAR(100),
    uf VARCHAR(2),
    origem VARCHAR(50) DEFAULT 'OUTRO',
    vendedor_responsavel VARCHAR(100),
    protheus_cod VARCHAR(20),
    protheus_loja VARCHAR(10),
    observacoes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

-- ============================================================================
-- Harmonização de Chaves Estrangeiras Lógicas com a Tabela crm_deals
-- ============================================================================
-- Permite que crm_deals armazene tanto códigos Protheus (6 dígitos) quanto IDs de clientes do CRM (CLI-...)
ALTER TABLE IF EXISTS crm_deals ALTER COLUMN cliente_cod TYPE VARCHAR(64);

-- ============================================================================
-- Índices B-Tree para buscas ultra-rápidas, autocomplete e filtros no CRM
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_crm_clientes_cnpj_cpf ON crm_clientes(cnpj_cpf);
CREATE INDEX IF NOT EXISTS idx_crm_clientes_nome ON crm_clientes(nome_razao);
CREATE INDEX IF NOT EXISTS idx_crm_clientes_vendedor ON crm_clientes(vendedor_responsavel);
CREATE INDEX IF NOT EXISTS idx_crm_clientes_deleted_at ON crm_clientes(deleted_at);

-- ============================================================================
-- Hardening de Segurança: Row-Level Security (RLS) Estrito e Compulsório
-- ============================================================================
ALTER TABLE crm_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_clientes FORCE ROW LEVEL SECURITY;

-- Concede privilégios de acesso apenas ao backend autenticado (service_role e postgres)
-- e revoga categoricamente todo acesso anônimo ou de usuários comuns (anon / authenticated)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON TABLE crm_clientes TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT ALL ON TABLE crm_clientes TO postgres;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE crm_clientes FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE crm_clientes FROM authenticated;
    END IF;
END $$;

-- Política de RLS exclusiva para service_role e postgres
DO $$
BEGIN
    DROP POLICY IF EXISTS "Acesso exclusivo backend crm_clientes" ON crm_clientes;
    CREATE POLICY "Acesso exclusivo backend crm_clientes" ON crm_clientes TO service_role, postgres USING (true) WITH CHECK (true);
END $$;
