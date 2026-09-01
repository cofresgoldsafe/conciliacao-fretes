-- ============================================================================
-- VIEW ANALÍTICA DE BI: ANÁLISE DE CRÉDITO, SCORES E RISCO COMERCIAL
-- Plataforma de Apoio GSI (Gemini-Cli) -> Metabase BI
-- ============================================================================
-- Fonte: Tabela relacional 'analise_credito_history' no Supabase
-- ============================================================================

CREATE OR REPLACE VIEW vw_bi_analise_credito AS
SELECT
    ach.id AS analise_id,
    ach.created_at::DATE AS data_analise,
    TO_CHAR(ach.created_at, 'YYYY-MM') AS ano_mes_analise,
    EXTRACT(YEAR FROM ach.created_at)::INTEGER AS ano,
    EXTRACT(MONTH FROM ach.created_at)::INTEGER AS mes,
    
    -- Empresa
    ach.empresa AS codigo_empresa,
    CASE 
        WHEN ach.empresa = '14' THEN 'Metal Pleno'
        WHEN ach.empresa = '15' THEN 'GSI'
        WHEN ach.empresa = '16' THEN 'OACO'
        ELSE 'Empresa ' || COALESCE(ach.empresa, 'N/D')
    END AS nome_empresa,

    -- Pedido e Cliente
    ach.pedido_venda,
    ach.cod_web,
    ach.cliente_codigo,
    ach.cliente_nome,
    ach.total_pedido AS valor_total_pedido,
    ach.desconto_ped AS desconto_aplicado,
    
    -- Avaliação de Risco e Score
    ach.total_score,
    CASE 
        WHEN ach.total_score >= 70 THEN '1. Score Alto (Excelente)'
        WHEN ach.total_score >= 40 THEN '2. Score Médio (Regular)'
        ELSE '3. Score Baixo (Crítico)'
    END AS faixa_score,
    ach.risco,
    ach.decisao_final,
    COALESCE(ach.usuario, 'Sistema') AS analista_responsavel,

    -- Informações Enriquecidas extraídas do JSONB (suporta formato plano e aninhado)
    COALESCE(ach.dados_completos->>'cliente_cnpj', ach.dados_completos->>'cnpj', ach.dados_completos->'protheus'->>'cnpj', '') AS cnpj_cliente,
    COALESCE(
        CASE 
            WHEN (ach.dados_completos->>'score_serasa') ~ '^[0-9]+$' THEN (ach.dados_completos->>'score_serasa')::INTEGER
            WHEN (ach.dados_completos->'serasa'->>'score') ~ '^[0-9]+$' THEN (ach.dados_completos->'serasa'->>'score')::INTEGER
            ELSE 0 
        END, 
        0
    ) AS score_serasa,
    COALESCE(
        CASE 
            WHEN (ach.dados_completos->>'idade_empresa_anos') ~ '^[0-9.]+$' THEN (ach.dados_completos->>'idade_empresa_anos')::NUMERIC
            WHEN (ach.dados_completos->'receita'->>'idadeAnos') ~ '^[0-9.]+$' THEN (ach.dados_completos->'receita'->>'idadeAnos')::NUMERIC
            ELSE 0
        END,
        0
    ) AS idade_empresa_anos,
    COALESCE(ach.dados_completos->>'uf_cliente', ach.dados_completos->'receita'->>'uf', '') AS uf_cliente,
    COALESCE(ach.dados_completos->>'fgts_situacao_regular', ach.dados_completos->>'fgts_situacao', ach.dados_completos->'fgts'->>'situacao', 'N/D') AS situacao_fgts,
    
    ach.created_at AS data_hora_registro
FROM analise_credito_history ach;
