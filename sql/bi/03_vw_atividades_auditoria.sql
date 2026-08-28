-- ============================================================================
-- VIEW ANALÍTICA DE BI: AUDITORIA, ACESSOS E ENGAJAMENTO DOS OPERADORES
-- Plataforma de Apoio GSI (Gemini-Cli) -> Metabase BI
-- ============================================================================
-- Fonte: Tabela relacional 'user_activities' no Supabase
-- ============================================================================

CREATE OR REPLACE VIEW vw_bi_atividades_auditoria AS
SELECT
    ua.id AS atividade_id,
    ua.created_at::DATE AS data_atividade,
    TO_CHAR(ua.created_at, 'YYYY-MM') AS ano_mes,
    TO_CHAR(ua.created_at, 'HH24:MI:SS') AS hora_atividade,
    ua.username,
    ua.user_name AS nome_completo,
    ua.action_type AS tipo_acao,
    CASE
        WHEN ua.action_type = 'LOGIN_SUCCESS' THEN 'Login Realizado'
        WHEN ua.action_type = 'CONSULTA_CREDITO' THEN 'Consulta de Crédito'
        WHEN ua.action_type = 'GRAVACAO_CREDITO' THEN 'Gravação de Análise de Crédito'
        WHEN ua.action_type = 'CONSULTA_SALDOS_ESTOQUE' THEN 'Consulta de Estoque'
        WHEN ua.action_type = 'SYNC_SALDOS_ESTOQUE' THEN 'Sincronização Manual de Estoque'
        WHEN ua.action_type = 'CONSULTA_BI_EXECUTIVO' THEN 'Acesso ao Painel de BI'
        ELSE ua.action_type
    END AS categoria_acao,
    ua.description AS descricao_acao,
    ua.ip_address,
    ua.created_at AS timestamp_completo
FROM user_activities ua;
