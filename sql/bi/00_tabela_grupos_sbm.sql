-- ============================================================================
-- TABELA DE CADASTRO DE GRUPOS DE PRODUTOS (SBM010 PROTHEUS)
-- Plataforma de Apoio GSI -> Supabase PostgreSQL / Metabase BI
-- ============================================================================
-- Esta tabela armazena o cadastro oficial de todos os 33 grupos de produtos
-- ativos e legados extraídos da tabela SBM010 da Empresa 01 no Protheus.
-- ============================================================================

CREATE TABLE IF NOT EXISTS grupos_produtos_sbm (
    codigo VARCHAR(10) PRIMARY KEY,
    descricao VARCHAR(100) NOT NULL,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Popula ou atualiza todos os 33 grupos oficiais do Protheus SBM010
INSERT INTO grupos_produtos_sbm (codigo, descricao, ativo) VALUES
    ('001', 'COFRES', TRUE),
    ('002', 'FRAGMENTADORAS', TRUE),
    ('003', 'CONTADORAS', TRUE),
    ('004', 'DESUMIDIFICADORES', TRUE),
    ('005', 'DETECTORES DE METAL', TRUE),
    ('006', 'ENCADERNACAO', TRUE),
    ('007', 'GUILHOTINAS', TRUE),
    ('008', 'GUARDA VOLUMES', TRUE),
    ('009', 'LIXEIRAS', TRUE),
    ('010', 'PLASTIFICACAO', TRUE),
    ('011', 'PORTA CHAVES', TRUE),
    ('012', 'REFILADORAS', TRUE),
    ('013', 'SELADORAS', TRUE),
    ('014', 'ERGONOMICOS', TRUE),
    ('015', 'SUPORTES P/ PASTA SUSPENSA', TRUE),
    ('016', 'VENTILADORES E CLIMATIZADORES', TRUE),
    ('017', 'RACKS', TRUE),
    ('018', 'MOBILIARIO / ARMARIOS', TRUE),
    ('019', 'ARMAZENAMENTO STORAGE', TRUE),
    ('020', 'CARRINHOS DE CARGA', TRUE),
    ('021', 'PORTAS BLINDADAS', TRUE),
    ('022', 'FILME PLASTICO P/ EMBALAGEM', TRUE),
    ('023', 'ORGANIZACAO E TRANSPORTE DE VALORES', TRUE),
    ('024', 'CACA E CAMPING', TRUE),
    ('025', 'ACESSORIOS PARA VEICULOS', TRUE),
    ('026', 'ESPORTE E LAZER', TRUE),
    ('027', 'MATERIAL DE ESCRITORIO', TRUE),
    ('028', 'BEBEDOUROS', TRUE),
    ('029', 'LIMPEZA MAQ E SUPRIMENTOS', TRUE),
    ('030', 'INDUSTRIA ALIMENTICIA', TRUE),
    ('044', 'INFORMATICA', TRUE),
    ('090', 'INSUMOS EM GERAL', TRUE),
    ('091', 'INSUMOS PRODUCAO COFRES', TRUE)
ON CONFLICT (codigo) DO UPDATE SET
    descricao = EXCLUDED.descricao,
    ativo = EXCLUDED.ativo;

-- ============================================================================
-- Habilitação de Row-Level Security (RLS) e Política de Acesso Backend
-- ============================================================================
ALTER TABLE grupos_produtos_sbm ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupos_produtos_sbm FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'grupos_produtos_sbm' AND policyname = 'Acesso exclusivo backend'
    ) THEN
        CREATE POLICY "Acesso exclusivo backend" ON public.grupos_produtos_sbm TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

