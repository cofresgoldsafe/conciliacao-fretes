-- ==============================================================================
-- DDL: Tabela de Notas Fiscais de Serviço (NFS-e) Emitidas (Prefeitura de SP - Nota Paulistana)
-- Projeto: Gemini-Cli (Módulo ANALISTA FIN - Fechamento Fiscal GSI Empresa 15)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS nfse_emitidas (
  id SERIAL,
  chave_acesso VARCHAR(60) PRIMARY KEY, -- '14061778000115_' + numero_nota
  empresa_cnpj VARCHAR(14) NOT NULL DEFAULT '14061778000115',
  empresa_nome VARCHAR(100) NOT NULL DEFAULT 'GSI BW Equipamentos de Aço Cofres e Armários',
  empresa_cod_protheus VARCHAR(2) NOT NULL DEFAULT '15',
  numero_nota VARCHAR(20) NOT NULL,
  serie VARCHAR(10) DEFAULT 'NFS',
  codigo_verificacao VARCHAR(20),
  data_emissao TIMESTAMPTZ NOT NULL,
  competencia VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  tomador_cnpj_cpf VARCHAR(18),
  tomador_razao VARCHAR(255),
  valor_servicos NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  valor_deducoes NUMERIC(14,2) DEFAULT 0.00,
  valor_pis NUMERIC(14,2) DEFAULT 0.00,
  valor_cofins NUMERIC(14,2) DEFAULT 0.00,
  valor_inss NUMERIC(14,2) DEFAULT 0.00,
  valor_ir NUMERIC(14,2) DEFAULT 0.00,
  valor_csll NUMERIC(14,2) DEFAULT 0.00,
  valor_iss NUMERIC(14,2) DEFAULT 0.00,
  aliquota_iss NUMERIC(5,2) DEFAULT 0.00,
  iss_retido BOOLEAN DEFAULT FALSE,
  valor_liquido NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  discriminacao_servico TEXT,
  status VARCHAR(20) DEFAULT 'NORMAL', -- 'NORMAL', 'CANCELADA'
  origem VARCHAR(50) DEFAULT 'PREFEITURA_SP',
  xml_conteudo TEXT, -- Armazena o XML integral da nota fiscal emitida para exportação
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para buscas rápidas e filtros do Fechamento Fiscal
CREATE INDEX IF NOT EXISTS idx_nfse_emitidas_empresa_emissao ON nfse_emitidas (empresa_cod_protheus, data_emissao);
CREATE INDEX IF NOT EXISTS idx_nfse_emitidas_competencia ON nfse_emitidas (competencia);
CREATE INDEX IF NOT EXISTS idx_nfse_emitidas_status ON nfse_emitidas (status);
CREATE INDEX IF NOT EXISTS idx_nfse_emitidas_num ON nfse_emitidas (numero_nota);

-- Ativação de Row Level Security (RLS) seguindo as diretrizes de segurança do projeto
ALTER TABLE nfse_emitidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE nfse_emitidas FORCE ROW LEVEL SECURITY;

-- Revogação de privilégios das roles públicas
REVOKE ALL ON TABLE nfse_emitidas FROM anon, authenticated;

-- Políticas de acesso exclusivas para a aplicação / service_role
DROP POLICY IF EXISTS p_service_role_all_nfse_emitidas ON nfse_emitidas;
CREATE POLICY p_service_role_all_nfse_emitidas ON nfse_emitidas
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS p_postgres_all_nfse_emitidas ON nfse_emitidas;
CREATE POLICY p_postgres_all_nfse_emitidas ON nfse_emitidas
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);
