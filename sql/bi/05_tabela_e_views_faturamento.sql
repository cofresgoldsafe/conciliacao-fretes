-- ============================================================================
-- TABELA E VIEWS ANALÍTICAS DE FATURAMENTO MÊS A MÊS E VENDAS POR GRUPO (BI)
-- Plataforma de Apoio GSI (Gemini-Cli) -> Supabase -> Metabase BI
-- ============================================================================

-- 1. Tabela de Fato: Histórico Detalhado de Itens Faturados
CREATE TABLE IF NOT EXISTS faturamento_itens_historico (
    id BIGSERIAL PRIMARY KEY,
    empresa_cod VARCHAR(10) NOT NULL,          -- '14', '15', '16'
    empresa_sigla VARCHAR(10) NOT NULL,        -- 'MP', 'GSI', 'OACO'
    nota_doc VARCHAR(20) NOT NULL,             -- D2_DOC / F2_DOC
    nota_serie VARCHAR(10) NOT NULL,           -- D2_SERIE / F2_SERIE
    item_num VARCHAR(10) NOT NULL,             -- D2_ITEM
    pedido_venda VARCHAR(20),                  -- D2_PEDIDO
    cliente_cod VARCHAR(20),                   -- D2_CLIENTE
    cliente_nome VARCHAR(200),                 -- A1_NOME / C5_NOMECLI
    vendedor_cod VARCHAR(20),                  -- F2_VEND1
    vendedor_nome VARCHAR(100),                -- Nome amigável do vendedor
    produto_cod VARCHAR(50) NOT NULL,          -- D2_COD
    produto_descricao VARCHAR(255),            -- B1_DESC / D2_DESCRI
    grupo_cod VARCHAR(10),                     -- D2_GRUPO / B1_GRUPO
    grupo_descricao VARCHAR(100),              -- '001 - Cofres', '002 - Fragmentadoras', etc.
    quantidade NUMERIC(15, 4) NOT NULL DEFAULT 0,
    preco_unitario NUMERIC(15, 2) NOT NULL DEFAULT 0,
    valor_total_item NUMERIC(15, 2) NOT NULL DEFAULT 0,
    valor_total_nota NUMERIC(15, 2) DEFAULT 0,
    cfop VARCHAR(10),
    tipo_nota VARCHAR(5) DEFAULT 'N',
    data_emissao DATE NOT NULL,
    mes_ano VARCHAR(7) NOT NULL,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_faturamento_item UNIQUE (empresa_cod, nota_doc, nota_serie, item_num)
);

-- Índices para alta performance de agregação e filtros no Metabase
CREATE INDEX IF NOT EXISTS idx_fat_data_emissao ON faturamento_itens_historico(data_emissao);
CREATE INDEX IF NOT EXISTS idx_fat_mes_ano ON faturamento_itens_historico(mes_ano);
CREATE INDEX IF NOT EXISTS idx_fat_grupo ON faturamento_itens_historico(grupo_descricao);
CREATE INDEX IF NOT EXISTS idx_fat_empresa ON faturamento_itens_historico(empresa_sigla);
CREATE INDEX IF NOT EXISTS idx_fat_vendedor ON faturamento_itens_historico(vendedor_nome);

-- Habilitar Row Level Security (RLS)
ALTER TABLE faturamento_itens_historico ENABLE ROW LEVEL SECURITY;


-- 2. View Analítica 1: Faturamento Geral Mês a Mês (Consolidado e por Empresa)
CREATE OR REPLACE VIEW vw_bi_faturamento_mensal AS
SELECT
    DATE_TRUNC('month', data_emissao)::DATE AS data_mes,
    mes_ano,
    EXTRACT(YEAR FROM data_emissao)::INTEGER AS ano,
    EXTRACT(MONTH FROM data_emissao)::INTEGER AS mes,
    empresa_sigla,
    SUM(valor_total_item) AS valor_faturamento_mercadorias,
    COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)) AS total_notas_emitidas,
    COUNT(DISTINCT cliente_cod) AS total_clientes_atendidos,
    COUNT(DISTINCT produto_cod) AS total_produtos_distintos_faturados,
    SUM(quantidade) AS total_unidades_faturadas,
    ROUND(SUM(valor_total_item) / NULLIF(COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)), 0), 2) AS ticket_medio_por_nota
FROM faturamento_itens_historico
GROUP BY 
    DATE_TRUNC('month', data_emissao)::DATE,
    mes_ano,
    EXTRACT(YEAR FROM data_emissao),
    EXTRACT(MONTH FROM data_emissao),
    empresa_sigla;


-- 3. View Analítica 2: Vendas e Faturamento Mês a Mês por Grupo de Produto
CREATE OR REPLACE VIEW vw_bi_faturamento_grupo_mes AS
SELECT
    DATE_TRUNC('month', data_emissao)::DATE AS data_mes,
    mes_ano,
    EXTRACT(YEAR FROM data_emissao)::INTEGER AS ano,
    EXTRACT(MONTH FROM data_emissao)::INTEGER AS mes,
    empresa_sigla,
    grupo_cod,
    grupo_descricao,
    SUM(valor_total_item) AS valor_total_faturado,
    SUM(quantidade) AS total_unidades_faturadas,
    COUNT(DISTINCT produto_cod) AS total_produtos_distintos,
    COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)) AS total_pedidos_notas
FROM faturamento_itens_historico
GROUP BY
    DATE_TRUNC('month', data_emissao)::DATE,
    mes_ano,
    EXTRACT(YEAR FROM data_emissao),
    EXTRACT(MONTH FROM data_emissao),
    empresa_sigla,
    grupo_cod,
    grupo_descricao;


-- 4. View Analítica 3: Faturamento Mês a Mês por Vendedor
CREATE OR REPLACE VIEW vw_bi_faturamento_vendedor_mes AS
SELECT
    DATE_TRUNC('month', data_emissao)::DATE AS data_mes,
    mes_ano,
    EXTRACT(YEAR FROM data_emissao)::INTEGER AS ano,
    EXTRACT(MONTH FROM data_emissao)::INTEGER AS mes,
    empresa_sigla,
    vendedor_cod,
    vendedor_nome,
    SUM(valor_total_item) AS valor_total_faturado,
    SUM(quantidade) AS total_unidades_faturadas,
    COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)) AS total_notas_emitidas,
    COUNT(DISTINCT cliente_cod) AS total_clientes_atendidos,
    ROUND(SUM(valor_total_item) / NULLIF(COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)), 0), 2) AS ticket_medio_vendedor
FROM faturamento_itens_historico
GROUP BY
    DATE_TRUNC('month', data_emissao)::DATE,
    mes_ano,
    EXTRACT(YEAR FROM data_emissao),
    EXTRACT(MONTH FROM data_emissao),
    empresa_sigla,
    vendedor_cod,
    vendedor_nome;
