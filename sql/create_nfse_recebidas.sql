-- ==============================================================================
-- DDL: Tabela de Notas Fiscais de Serviço (NFS-e) Recebidas e Conciliação Protheus
-- Projeto: Gemini-Cli (Módulo ANALISTA FIN)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS nfse_recebidas (
  id SERIAL,
  chave_acesso VARCHAR(60) PRIMARY KEY,
  empresa_cnpj VARCHAR(14) NOT NULL,
  empresa_nome VARCHAR(100) NOT NULL,
  empresa_cod_protheus VARCHAR(2) NOT NULL,
  nsu BIGINT,
  numero_nota VARCHAR(20) NOT NULL,
  data_emissao TIMESTAMPTZ NOT NULL,
  prestador_cnpj VARCHAR(14) NOT NULL,
  prestador_nome VARCHAR(255) NOT NULL,
  valor_liquido NUMERIC(14,2) NOT NULL,
  municipio VARCHAR(100),
  descricao TEXT,
  status_entrada VARCHAR(20) DEFAULT 'PENDENTE', -- 'PENDENTE', 'LANCADA', 'IGNORADA'
  protheus_doc VARCHAR(20),
  protheus_emissao VARCHAR(8),
  protheus_valbrut NUMERIC(14,2),
  protheus_fornece VARCHAR(10),
  protheus_loja VARCHAR(5),
  fornecedor_sem_cadastro BOOLEAN DEFAULT FALSE,
  data_ultima_conferencia TIMESTAMPTZ,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para buscas rápidas e filtros da interface
CREATE INDEX IF NOT EXISTS idx_nfse_status_emissao ON nfse_recebidas (status_entrada, data_emissao);
CREATE INDEX IF NOT EXISTS idx_nfse_empresa_emissao ON nfse_recebidas (empresa_cod_protheus, data_emissao);
CREATE INDEX IF NOT EXISTS idx_nfse_prestador_num ON nfse_recebidas (prestador_cnpj, numero_nota);

-- Ativação de Row Level Security (RLS) seguindo as diretrizes de segurança do projeto
ALTER TABLE nfse_recebidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE nfse_recebidas FORCE ROW LEVEL SECURITY;

-- Revogação de privilégios das roles públicas
REVOKE ALL ON TABLE nfse_recebidas FROM anon, authenticated;

-- Políticas de acesso exclusivas para a aplicação / service_role
DROP POLICY IF EXISTS p_service_role_all_nfse ON nfse_recebidas;
CREATE POLICY p_service_role_all_nfse ON nfse_recebidas
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS p_postgres_all_nfse ON nfse_recebidas;
CREATE POLICY p_postgres_all_nfse ON nfse_recebidas
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);
