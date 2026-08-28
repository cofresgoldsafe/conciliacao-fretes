-- ============================================================================
-- VIEW ANALÍTICA DE BI: DEMANDA E CONCENTRAÇÃO POR GRUPO COMERCIAL (SBM010)
-- Plataforma de Apoio GSI (Gemini-Cli) -> Metabase BI
-- ============================================================================
-- Consolida Saldo em Estoque (R$), Vendas em Carteira (R$) e Compras por Grupo
-- Mapeia 100% dos 33 Grupos de Produtos do Protheus SBM010
-- ============================================================================

CREATE OR REPLACE VIEW vw_bi_demandas_grupos_comerciais AS
SELECT
    CASE
        WHEN pse.grupo IN ('001', '0001', '1') THEN '001 - Cofres'
        WHEN pse.grupo IN ('002', '0002', '2') THEN '002 - Fragmentadoras'
        WHEN pse.grupo IN ('003', '0003', '3') THEN '003 - Contadoras'
        WHEN pse.grupo IN ('004', '0004', '4') THEN '004 - Desumidificadores'
        WHEN pse.grupo IN ('005', '0005', '5') THEN '005 - Detectores de Metal'
        WHEN pse.grupo IN ('006', '0006', '6') THEN '006 - Encadernação'
        WHEN pse.grupo IN ('007', '0007', '7') THEN '007 - Guilhotinas'
        WHEN pse.grupo IN ('008', '0008', '8') THEN '008 - Guarda Volumes'
        WHEN pse.grupo IN ('009', '0009', '9') THEN '009 - Lixeiras'
        WHEN pse.grupo IN ('010', '0010', '10') THEN '010 - Plastificação'
        WHEN pse.grupo IN ('011', '0011', '11') THEN '011 - Porta Chaves'
        WHEN pse.grupo IN ('012', '0012', '12') THEN '012 - Refiladoras'
        WHEN pse.grupo IN ('013', '0013', '13') THEN '013 - Seladoras'
        WHEN pse.grupo IN ('014', '0014', '14') THEN '014 - Ergonômicos'
        WHEN pse.grupo IN ('015', '0015', '15') THEN '015 - Suportes p/ Pasta Suspensa'
        WHEN pse.grupo IN ('016', '0016', '16') THEN '016 - Ventiladores e Climatizadores'
        WHEN pse.grupo IN ('017', '0017', '17') THEN '017 - Racks'
        WHEN pse.grupo IN ('018', '0018', '18') THEN '018 - Mobiliário / Armários'
        WHEN pse.grupo IN ('019', '0019', '19') THEN '019 - Armazenamento Storage'
        WHEN pse.grupo IN ('020', '0020', '20') THEN '020 - Carrinhos de Carga'
        WHEN pse.grupo IN ('021', '0021', '21') THEN '021 - Portas Blindadas'
        WHEN pse.grupo IN ('022', '0022', '22') THEN '022 - Filme Plástico p/ Embalagem'
        WHEN pse.grupo IN ('023', '0023', '23') THEN '023 - Organização e Transp. Valores'
        WHEN pse.grupo IN ('024', '0024', '24') THEN '024 - Caça e Camping'
        WHEN pse.grupo IN ('025', '0025', '25') THEN '025 - Acessórios para Veículos'
        WHEN pse.grupo IN ('026', '0026', '26') THEN '026 - Esporte e Lazer'
        WHEN pse.grupo IN ('027', '0027', '27') THEN '027 - Material de Escritório'
        WHEN pse.grupo IN ('028', '0028', '28') THEN '028 - Bebedouros'
        WHEN pse.grupo IN ('029', '0029', '29') THEN '029 - Limpeza Máq. e Suprimentos'
        WHEN pse.grupo IN ('030', '0030', '30') THEN '030 - Indústria Alimentícia'
        WHEN pse.grupo IN ('044', '0044', '44') THEN '044 - Informática'
        WHEN pse.grupo IN ('090', '0090', '90') THEN '090 - Insumos em Geral'
        WHEN pse.grupo IN ('091', '0091', '91') THEN '091 - Insumos Produção Cofres'
        ELSE 'Grupo ' || COALESCE(pse.grupo, 'Outros')
    END AS grupo_comercial,
    COUNT(pse.codigo) AS total_produtos_cadastrados,
    COUNT(CASE WHEN pse.saldo > 0 THEN 1 END) AS total_produtos_com_estoque,
    COUNT(CASE WHEN pse.saldo <= 0 THEN 1 END) AS total_produtos_zerados,
    SUM(pse.saldo) AS saldo_fisico_total_unidades,
    SUM(pse.saldo_total) AS valor_total_estoque_reais,
    SUM(pse.qtd_vendas) AS qtd_vendas_carteira_sc6,
    SUM(pse.qtd_vendas * pse.preco) AS valor_total_vendas_carteira,
    SUM(pse.qtd_compras) AS qtd_compras_aberto_sc7,
    SUM(pse.qtd_compras * pse.preco) AS valor_total_compras_aberto
FROM produtos_saldo_estoque pse
GROUP BY 
    CASE
        WHEN pse.grupo IN ('001', '0001', '1') THEN '001 - Cofres'
        WHEN pse.grupo IN ('002', '0002', '2') THEN '002 - Fragmentadoras'
        WHEN pse.grupo IN ('003', '0003', '3') THEN '003 - Contadoras'
        WHEN pse.grupo IN ('004', '0004', '4') THEN '004 - Desumidificadores'
        WHEN pse.grupo IN ('005', '0005', '5') THEN '005 - Detectores de Metal'
        WHEN pse.grupo IN ('006', '0006', '6') THEN '006 - Encadernação'
        WHEN pse.grupo IN ('007', '0007', '7') THEN '007 - Guilhotinas'
        WHEN pse.grupo IN ('008', '0008', '8') THEN '008 - Guarda Volumes'
        WHEN pse.grupo IN ('009', '0009', '9') THEN '009 - Lixeiras'
        WHEN pse.grupo IN ('010', '0010', '10') THEN '010 - Plastificação'
        WHEN pse.grupo IN ('011', '0011', '11') THEN '011 - Porta Chaves'
        WHEN pse.grupo IN ('012', '0012', '12') THEN '012 - Refiladoras'
        WHEN pse.grupo IN ('013', '0013', '13') THEN '013 - Seladoras'
        WHEN pse.grupo IN ('014', '0014', '14') THEN '014 - Ergonômicos'
        WHEN pse.grupo IN ('015', '0015', '15') THEN '015 - Suportes p/ Pasta Suspensa'
        WHEN pse.grupo IN ('016', '0016', '16') THEN '016 - Ventiladores e Climatizadores'
        WHEN pse.grupo IN ('017', '0017', '17') THEN '017 - Racks'
        WHEN pse.grupo IN ('018', '0018', '18') THEN '018 - Mobiliário / Armários'
        WHEN pse.grupo IN ('019', '0019', '19') THEN '019 - Armazenamento Storage'
        WHEN pse.grupo IN ('020', '0020', '20') THEN '020 - Carrinhos de Carga'
        WHEN pse.grupo IN ('021', '0021', '21') THEN '021 - Portas Blindadas'
        WHEN pse.grupo IN ('022', '0022', '22') THEN '022 - Filme Plástico p/ Embalagem'
        WHEN pse.grupo IN ('023', '0023', '23') THEN '023 - Organização e Transp. Valores'
        WHEN pse.grupo IN ('024', '0024', '24') THEN '024 - Caça e Camping'
        WHEN pse.grupo IN ('025', '0025', '25') THEN '025 - Acessórios para Veículos'
        WHEN pse.grupo IN ('026', '0026', '26') THEN '026 - Esporte e Lazer'
        WHEN pse.grupo IN ('027', '0027', '27') THEN '027 - Material de Escritório'
        WHEN pse.grupo IN ('028', '0028', '28') THEN '028 - Bebedouros'
        WHEN pse.grupo IN ('029', '0029', '29') THEN '029 - Limpeza Máq. e Suprimentos'
        WHEN pse.grupo IN ('030', '0030', '30') THEN '030 - Indústria Alimentícia'
        WHEN pse.grupo IN ('044', '0044', '44') THEN '044 - Informática'
        WHEN pse.grupo IN ('090', '0090', '90') THEN '090 - Insumos em Geral'
        WHEN pse.grupo IN ('091', '0091', '91') THEN '091 - Insumos Produção Cofres'
        ELSE 'Grupo ' || COALESCE(pse.grupo, 'Outros')
    END;
