-- ============================================================================
-- VIEW ANALÍTICA DE BI: PRODUTOS, SALDOS DE ESTOQUE E CARTEIRA (MULTI-EMPRESA)
-- Plataforma de Apoio GSI (Gemini-Cli) -> Metabase BI
-- ============================================================================
-- Fonte: 'produtos_saldo_estoque' com suporte a todos os 33 Grupos do Protheus SBM010
-- ============================================================================

CREATE OR REPLACE VIEW vw_bi_produtos_estoque AS
SELECT
    pse.codigo AS produto_codigo,
    pse.descricao AS produto_descricao,
    pse.grupo AS grupo_codigo,
    CASE
        -- Grupos Oficiais SBM010 (Empresa 01)
        WHEN pse.grupo IN ('001', '0001', '1') THEN '001 - Cofres'
        WHEN pse.grupo IN ('002', '0002', '2') THEN '002 - Fragmentadoras'
        WHEN pse.grupo IN ('003', '0003', '3') THEN '003 - Contadorass'
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
        ELSE 'Grupo ' || COALESCE(pse.grupo, 'N/D')
    END AS grupo_comercial,
    pse.preco AS preco_unitario,
    pse.saldo AS saldo_fisico_total,
    pse.saldo_total AS valor_total_estoque,
    pse.qtd_vendas AS vendas_em_carteira_sc6,
    (pse.qtd_vendas * pse.preco) AS valor_vendas_carteira,
    pse.qtd_compras AS compras_em_aberto_sc7,
    (pse.qtd_compras * pse.preco) AS valor_compras_aberto,
    pse.ponto_ped AS ponto_de_pedido,
    
    -- Saldos discriminados por Empresa extraídos do JSONB
    COALESCE((pse.detalhes_empresas->'14'->>'saldo')::NUMERIC, 0) AS saldo_metal_pleno_14,
    COALESCE((pse.detalhes_empresas->'15'->>'saldo')::NUMERIC, 0) AS saldo_gsi_15,
    COALESCE((pse.detalhes_empresas->'16'->>'saldo')::NUMERIC, 0) AS saldo_oaco_16,

    -- Indicadores de Gestão Executiva
    CASE 
        WHEN pse.saldo > 0 THEN 'Com Saldo em Estoque'
        ELSE 'Sem Estoque (Zerado)'
    END AS status_disponibilidade,

    CASE 
        WHEN pse.saldo <= 0 AND pse.qtd_vendas > 0 THEN 'Ruptura com Pedido Pendente'
        WHEN pse.ponto_ped > 0 AND pse.saldo < pse.ponto_ped THEN 'Abaixo do Ponto de Pedido'
        WHEN pse.saldo > 0 THEN 'Estoque Normal'
        ELSE 'Sem Demanda Imediata'
    END AS status_abastecimento,

    pse.synced_at AS data_ultima_sincronizacao
FROM produtos_saldo_estoque pse;
