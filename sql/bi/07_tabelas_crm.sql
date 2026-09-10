-- ============================================================================
-- 07_tabelas_crm.sql
-- Módulo de CRM Comercial Nativo (Pipelines, Negócios e Atividades)
-- Plataforma de Apoio GSI -> Supabase PostgreSQL
-- ============================================================================
-- Tabelas:
--   1. crm_deals: Oportunidades / Negócios no funil de vendas (Kanban comercial)
--   2. crm_atividades: Tarefas, reuniões, ligações, e-mails e follow-ups por negócio
-- ============================================================================

-- 1. TABELA DE DEALS / NEGÓCIOS (FUNIL COMERCIAL)
CREATE TABLE IF NOT EXISTS crm_deals (
    id VARCHAR(64) PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    cliente_cod VARCHAR(20),
    cliente_loja VARCHAR(10) DEFAULT '01',
    cliente_nome VARCHAR(255) NOT NULL,
    cliente_cnpj VARCHAR(20),
    cliente_email VARCHAR(200),
    cliente_telefone VARCHAR(50),
    cliente_cidade VARCHAR(100),
    cliente_uf VARCHAR(10),
    valor_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    estagio VARCHAR(50) NOT NULL DEFAULT 'lead' CONSTRAINT crm_deals_estagio_check CHECK (estagio IN ('lead', 'contato', 'proposta', 'negociacao', 'ganho', 'perdido')),
    probabilidade NUMERIC(5, 2) NOT NULL DEFAULT 20.00,
    data_fechamento_esperada DATE,
    data_fechamento_real TIMESTAMP WITH TIME ZONE,
    cod_vendedor VARCHAR(20) NOT NULL,
    nome_vendedor VARCHAR(100) NOT NULL,
    origem VARCHAR(50) NOT NULL DEFAULT 'manual',
    status VARCHAR(20) NOT NULL DEFAULT 'aberto',
    motivo_perda TEXT,
    cond_pgto VARCHAR(100),
    tipo_frete VARCHAR(10) DEFAULT 'CIF',
    frete_cobrado NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    frete_embutido NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    transportadora VARCHAR(100),
    prazo_entrega VARCHAR(100),
    num_pedido_compra VARCHAR(100),
    obs_nfe TEXT,
    itens_cotados JSONB NOT NULL DEFAULT '[]'::jsonb,
    contatos JSONB NOT NULL DEFAULT '[]'::jsonb,
    historico_estagios JSONB NOT NULL DEFAULT '[]'::jsonb,
    custom JSONB NOT NULL DEFAULT '{}'::jsonb,
    observacoes TEXT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(100) NOT NULL DEFAULT 'alexandre',
    updated_by VARCHAR(100) NOT NULL DEFAULT 'alexandre',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Índices B-Tree para buscas ultra-rápidas e filtros no funil
CREATE INDEX IF NOT EXISTS idx_crm_deals_estagio ON crm_deals(estagio);
CREATE INDEX IF NOT EXISTS idx_crm_deals_cod_vendedor ON crm_deals(cod_vendedor);
CREATE INDEX IF NOT EXISTS idx_crm_deals_cliente_cod ON crm_deals(cliente_cod);
CREATE INDEX IF NOT EXISTS idx_crm_deals_cliente_nome ON crm_deals(cliente_nome);
CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON crm_deals(status);
CREATE INDEX IF NOT EXISTS idx_crm_deals_ativo ON crm_deals(ativo);
CREATE INDEX IF NOT EXISTS idx_crm_deals_created_at ON crm_deals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_updated_at ON crm_deals(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_dt_fechamento ON crm_deals(data_fechamento_esperada);

-- Índices GIN para consultas e filtros dentro de estruturas JSONB
CREATE INDEX IF NOT EXISTS idx_crm_deals_itens_cotados ON crm_deals USING gin(itens_cotados);
CREATE INDEX IF NOT EXISTS idx_crm_deals_contatos ON crm_deals USING gin(contatos);
CREATE INDEX IF NOT EXISTS idx_crm_deals_historico_estagios ON crm_deals USING gin(historico_estagios);
CREATE INDEX IF NOT EXISTS idx_crm_deals_custom ON crm_deals USING gin(custom);

-- 2. TABELA DE ATIVIDADES DO CRM (LIGAÇÕES, REUNIÕES, E-MAILS, TAREFAS)
CREATE TABLE IF NOT EXISTS crm_atividades (
    id VARCHAR(64) PRIMARY KEY,
    deal_id VARCHAR(64) NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
    tipo VARCHAR(50) NOT NULL,
    assunto VARCHAR(255) NOT NULL,
    descricao TEXT,
    data_agendada TIMESTAMP WITH TIME ZONE,
    data_concluida TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente',
    prioridade VARCHAR(20) NOT NULL DEFAULT 'media',
    responsavel_usuario VARCHAR(100) NOT NULL,
    responsavel_nome VARCHAR(100),
    custom JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by VARCHAR(100) NOT NULL DEFAULT 'alexandre',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Índices B-Tree para crm_atividades
CREATE INDEX IF NOT EXISTS idx_crm_atividades_deal_id ON crm_atividades(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_atividades_tipo ON crm_atividades(tipo);
CREATE INDEX IF NOT EXISTS idx_crm_atividades_status ON crm_atividades(status);
CREATE INDEX IF NOT EXISTS idx_crm_atividades_data_agendada ON crm_atividades(data_agendada);
CREATE INDEX IF NOT EXISTS idx_crm_atividades_responsavel ON crm_atividades(responsavel_usuario);
CREATE INDEX IF NOT EXISTS idx_crm_atividades_created_at ON crm_atividades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_atividades_custom ON crm_atividades USING gin(custom);

-- ============================================================================
-- Hardening de Segurança: Row-Level Security (RLS) Estrito e Compulsório
-- ============================================================================
ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals FORCE ROW LEVEL SECURITY;

ALTER TABLE crm_atividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_atividades FORCE ROW LEVEL SECURITY;

-- Concede privilégios de acesso apenas ao backend autenticado (service_role e postgres)
-- e revoga categoricamente todo acesso anônimo ou de usuários comuns (anon / authenticated)
DO $$
BEGIN
    -- Permissões para crm_deals
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON TABLE crm_deals TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT ALL ON TABLE crm_deals TO postgres;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE crm_deals FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE crm_deals FROM authenticated;
    END IF;

    -- Permissões para crm_atividades
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON TABLE crm_atividades TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT ALL ON TABLE crm_atividades TO postgres;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE crm_atividades FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE crm_atividades FROM authenticated;
    END IF;
END $$;

-- Políticas de RLS exclusivas para service_role E postgres
DO $$
BEGIN
    DROP POLICY IF EXISTS "Acesso exclusivo backend crm_deals" ON crm_deals;
    CREATE POLICY "Acesso exclusivo backend crm_deals" ON crm_deals TO service_role, postgres USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Acesso exclusivo backend crm_atividades" ON crm_atividades;
    CREATE POLICY "Acesso exclusivo backend crm_atividades" ON crm_atividades TO service_role, postgres USING (true) WITH CHECK (true);
END $$;
