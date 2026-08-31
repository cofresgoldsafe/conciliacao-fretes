/**
 * bi_indices_engine.js
 * Módulo Dedicado de Índices Financeiros de Liquidez (BI Executivo)
 * Plataforma de Apoio GSI (Gemini-Cli)
 *
 * Responsabilidades:
 * 1. Extração unificada do ERP TOTVS Protheus (SE8, SE1, SE2, SB2/SB1).
 * 2. Persistência em lote no Supabase PostgreSQL com fallback JSON.
 * 3. Cálculo matemático dos 3 Índices de Liquidez (LC, LS, LI) multi-empresa.
 * 4. API de consulta agregada e drilldown detalhado para interface e Metabase.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { executeRailwayQuery } = require('./protheus_db');
const { getPool, isPostgresConnected } = require('./postgres_db');

const dataDir = path.join(__dirname, 'data');
const indicesCacheFile = path.join(dataDir, 'bi_indices_cache.json');

// Mapeamento das 3 empresas atendidas
const EMPRESAS_INDICES = [
  { cod: '14', sigla: 'MP', nome: 'Metal Pleno / S4BW', se8: 'SE8140', se1: 'SE1140', se2: 'SE2140', sb2: 'SB2140' },
  { cod: '15', sigla: 'GSI', nome: 'GSI Cofres', se8: 'SE8150', se1: 'SE1150', se2: 'SE2150', sb2: 'SB2150' },
  { cod: '16', sigla: 'OACO', nome: 'OAÇO Produtos de Aço', se8: 'SE8160', se1: 'SE1160', se2: 'SE2160', sb2: 'SB2160' }
];

// Helper: Arredondamento numérico seguro de 2 casas decimais
function roundVal(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

// Helper: Arredondamento numérico de 4 casas decimais para índices
function roundIndex(v) {
  return Math.round((Number(v) || 0) * 10000) / 10000;
}

// Helper: Formata data YYYYMMDD para YYYY-MM-DD
function parseDateYmd(ymd) {
  const s = String(ymd || '').replace(/\D/g, '');
  if (s.length === 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return null;
}

// Helper: Calcula diferença de dias entre duas datas (Hoje - Vencimento)
function calcularDiasVencido(dataVenctoYmd) {
  if (!dataVenctoYmd) return 0;
  const s = String(dataVenctoYmd).replace(/\D/g, '');
  if (s.length !== 8) return 0;
  
  const ano = parseInt(s.slice(0, 4), 10);
  const mes = parseInt(s.slice(4, 6), 10) - 1;
  const dia = parseInt(s.slice(6, 8), 10);
  const dataVencto = new Date(ano, mes, dia);
  
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  
  const diffMs = hoje.getTime() - dataVencto.getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDias);
}

// Helper: Gravação segura atômica de JSON
async function safeWriteJson(filePath, data) {
  const tmpFile = `${filePath}.${Date.now()}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  await fs.promises.rename(tmpFile, filePath);
}

/**
 * 1. EXTRAÇÃO DE DADOS DO PROTHEUS (TOTVS CLOUD)
 */
async function extrairDadosIndicesProtheus() {
  console.log('⏳ [BI Índices] Extraindo dados multi-empresa do Protheus (SE8, SE1, SE2, SB2/SB1)...');

  const resultado = {
    saldosBancarios: [],
    contasReceber: [],
    contasPagar: [],
    estoque: []
  };

  // 1.1 Extração de Saldos Bancários (SE8) - Último saldo registrado de cada conta corrente
  for (const emp of EMPRESAS_INDICES) {
    try {
      const sqlSE8 = `
        WITH RankedSE8 AS (
          SELECT 
            E8_BANCO, 
            E8_AGENCIA, 
            E8_CONTA, 
            E8_DTSALAT, 
            E8_SALATUA,
            ROW_NUMBER() OVER (
              PARTITION BY E8_BANCO, E8_AGENCIA, E8_CONTA 
              ORDER BY E8_DTSALAT DESC, R_E_C_N_O_ DESC
            ) AS rn
          FROM ${emp.se8}
          WHERE D_E_L_E_T_ = ' '
        )
        SELECT 
          RTRIM(E8_BANCO) AS BANCO, 
          RTRIM(E8_AGENCIA) AS AGENCIA, 
          RTRIM(E8_CONTA) AS CONTA, 
          RTRIM(E8_DTSALAT) AS DATA_SALDO, 
          ISNULL(E8_SALATUA, 0) AS SALDO_ATUAL
        FROM RankedSE8 
        WHERE rn = 1
        ORDER BY E8_BANCO, E8_CONTA;
      `;
      const resSE8 = await executeRailwayQuery(sqlSE8);
      const rowsSE8 = resSE8.rows || resSE8 || [];

      for (const r of rowsSE8) {
        resultado.saldosBancarios.push({
          empresa_cod: emp.cod,
          empresa_sigla: emp.sigla,
          banco_cod: String(r.BANCO || '').trim(),
          agencia: String(r.AGENCIA || '').trim(),
          conta: String(r.CONTA || '').trim(),
          conta_nome: `${emp.sigla} - Bco ${String(r.BANCO || '').trim()} Ag ${String(r.AGENCIA || '').trim()} Cta ${String(r.CONTA || '').trim()}`,
          data_saldo: parseDateYmd(r.DATA_SALDO) || new Date().toISOString().slice(0, 10),
          saldo_atual: roundVal(parseFloat(r.SALDO_ATUAL || 0))
        });
      }
    } catch (errSE8) {
      console.warn(`⚠️ [BI Índices] Erro ao extrair SE8 da empresa ${emp.sigla}:`, errSE8.message);
    }
  }

  // 1.2 Extração de Contas a Receber (SE1) - Títulos em aberto (E1_SALDO > 0)
  for (const emp of EMPRESAS_INDICES) {
    try {
      const sqlSE1 = `
        SELECT 
          RTRIM(ISNULL(E1_FILIAL, '01')) AS FILIAL,
          RTRIM(ISNULL(E1_PREFIXO, '')) AS PREFIXO,
          RTRIM(E1_NUM) AS NUMERO_TITULO,
          RTRIM(ISNULL(E1_PARCELA, '')) AS PARCELA,
          RTRIM(ISNULL(E1_TIPO, 'NF')) AS TIPO,
          RTRIM(ISNULL(E1_CLIENTE, '')) AS CLIENTE_COD,
          RTRIM(ISNULL(E1_LOJA, '')) AS CLIENTE_LOJA,
          RTRIM(ISNULL(E1_NOMCLI, '')) AS CLIENTE_NOME,
          RTRIM(ISNULL(E1_NATUREZ, '')) AS NATUREZA_COD,
          RTRIM(ISNULL(E1_EMISSAO, '')) AS DATA_EMISSAO,
          RTRIM(ISNULL(E1_VENCTO, '')) AS DATA_VENCTO,
          RTRIM(ISNULL(E1_VENCREA, '')) AS DATA_VENCREA,
          ISNULL(E1_VALOR, 0) AS VALOR_ORIGINAL,
          ISNULL(E1_SALDO, 0) AS SALDO
        FROM ${emp.se1}
        WHERE D_E_L_E_T_ = ' '
          AND E1_SALDO > 0
        ORDER BY E1_VENCREA ASC, E1_NUM ASC;
      `;
      const resSE1 = await executeRailwayQuery(sqlSE1);
      const rowsSE1 = resSE1.rows || resSE1 || [];

      for (const r of rowsSE1) {
        const venctoEff = String(r.DATA_VENCREA || r.DATA_VENCTO || '').trim();
        const diasVencido = calcularDiasVencido(venctoEff);
        const validoIndice = diasVencido <= 5; // Regra: Não contar com vencidos a mais de 5 dias

        resultado.contasReceber.push({
          empresa_cod: emp.cod,
          empresa_sigla: emp.sigla,
          filial: r.FILIAL || '01',
          prefixo: r.PREFIXO || '',
          numero_titulo: String(r.NUMERO_TITULO || '').trim(),
          parcela: r.PARCELA || '',
          tipo: r.TIPO || 'NF',
          cliente_cod: r.CLIENTE_COD || '',
          cliente_loja: r.CLIENTE_LOJA || '',
          cliente_nome: r.CLIENTE_NOME || 'CLIENTE NÃO INFORMADO',
          natureza_cod: r.NATUREZA_COD || '',
          data_emissao: parseDateYmd(r.DATA_EMISSAO),
          data_vencimento: parseDateYmd(venctoEff) || parseDateYmd(r.DATA_VENCTO) || new Date().toISOString().slice(0, 10),
          data_vencimento_real: parseDateYmd(r.DATA_VENCREA),
          valor_original: roundVal(parseFloat(r.VALOR_ORIGINAL || 0)),
          saldo: roundVal(parseFloat(r.SALDO || 0)),
          dias_vencido: diasVencido,
          valido_indice: validoIndice,
          status: 'ABERTO'
        });
      }
    } catch (errSE1) {
      console.warn(`⚠️ [BI Índices] Erro ao extrair SE1 da empresa ${emp.sigla}:`, errSE1.message);
    }
  }

  // 1.3 Extração de Contas a Pagar (SE2) - Títulos em aberto (E2_SALDO > 0), incluindo provisórios (PR)
  for (const emp of EMPRESAS_INDICES) {
    try {
      const sqlSE2 = `
        SELECT 
          RTRIM(ISNULL(E2_FILIAL, '01')) AS FILIAL,
          RTRIM(ISNULL(E2_PREFIXO, '')) AS PREFIXO,
          RTRIM(E2_NUM) AS NUMERO_TITULO,
          RTRIM(ISNULL(E2_PARCELA, '')) AS PARCELA,
          RTRIM(ISNULL(E2_TIPO, 'NF')) AS TIPO,
          RTRIM(ISNULL(E2_FORNECE, '')) AS FORNECEDOR_COD,
          RTRIM(ISNULL(E2_LOJA, '')) AS FORNECEDOR_LOJA,
          RTRIM(ISNULL(E2_NOMFOR, '')) AS FORNECEDOR_NOME,
          RTRIM(ISNULL(E2_NATUREZ, '')) AS NATUREZA_COD,
          RTRIM(ISNULL(E2_EMISSAO, '')) AS DATA_EMISSAO,
          RTRIM(ISNULL(E2_VENCTO, '')) AS DATA_VENCTO,
          RTRIM(ISNULL(E2_VENCREA, '')) AS DATA_VENCREA,
          ISNULL(E2_VALOR, 0) AS VALOR_ORIGINAL,
          ISNULL(E2_SALDO, 0) AS SALDO
        FROM ${emp.se2}
        WHERE D_E_L_E_T_ = ' '
          AND E2_SALDO > 0
        ORDER BY E2_VENCREA ASC, E2_NUM ASC;
      `;
      const resSE2 = await executeRailwayQuery(sqlSE2);
      const rowsSE2 = resSE2.rows || resSE2 || [];

      for (const r of rowsSE2) {
        const tipoLimpo = String(r.TIPO || 'NF').trim();
        const isProvisorio = (tipoLimpo === 'PR');

        resultado.contasPagar.push({
          empresa_cod: emp.cod,
          empresa_sigla: emp.sigla,
          filial: r.FILIAL || '01',
          prefixo: r.PREFIXO || '',
          numero_titulo: String(r.NUMERO_TITULO || '').trim(),
          parcela: r.PARCELA || '',
          tipo: tipoLimpo,
          fornecedor_cod: r.FORNECEDOR_COD || '',
          fornecedor_loja: r.FORNECEDOR_LOJA || '',
          fornecedor_nome: r.FORNECEDOR_NOME || 'FORNECEDOR NÃO INFORMADO',
          natureza_cod: r.NATUREZA_COD || '',
          data_emissao: parseDateYmd(r.DATA_EMISSAO),
          data_vencimento: parseDateYmd(r.DATA_VENCREA) || parseDateYmd(r.DATA_VENCTO) || new Date().toISOString().slice(0, 10),
          data_vencimento_real: parseDateYmd(r.DATA_VENCREA),
          valor_original: roundVal(parseFloat(r.VALOR_ORIGINAL || 0)),
          saldo: roundVal(parseFloat(r.SALDO || 0)),
          is_provisorio: isProvisorio,
          status: 'ABERTO'
        });
      }
    } catch (errSE2) {
      console.warn(`⚠️ [BI Índices] Erro ao extrair SE2 da empresa ${emp.sigla}:`, errSE2.message);
    }
  }

  // 1.4 Extração de Estoque de Produtos PA com Saldo > 0 (SB2 + SB1)
  for (const emp of EMPRESAS_INDICES) {
    try {
      const sqlEstoque = `
        SELECT 
          RTRIM(B2.B2_COD) AS CODIGO,
          RTRIM(COALESCE(B19.B1_DESC, B16.B1_DESC, B10.B1_DESC, B11.B1_DESC, '')) AS DESCRICAO,
          RTRIM(COALESCE(B19.B1_TIPO, B16.B1_TIPO, B10.B1_TIPO, B11.B1_TIPO, 'PA')) AS TIPO,
          RTRIM(COALESCE(B19.B1_GRUPO, B16.B1_GRUPO, B10.B1_GRUPO, B11.B1_GRUPO, '')) AS GRUPO_COD,
          B2.B2_QATU AS QUANTIDADE,
          COALESCE(NULLIF(B19.B1_VLUNIT, 0), NULLIF(B16.B1_VLUNIT, 0), NULLIF(B10.B1_VLUNIT, 0), NULLIF(B11.B1_VLUNIT, 0), 0) AS CUSTO_UNITARIO,
          COALESCE(NULLIF(B19.B1_PRV1, 0), NULLIF(B16.B1_PRV1, 0), NULLIF(B10.B1_PRV1, 0), NULLIF(B11.B1_PRV1, 0), 0) AS PRECO_VENDA
        FROM ${emp.sb2} B2
        LEFT JOIN SB1090 B19 ON RTRIM(B19.B1_COD) = RTRIM(B2.B2_COD) AND B19.D_E_L_E_T_ = ' '
        LEFT JOIN SB1160 B16 ON RTRIM(B16.B1_COD) = RTRIM(B2.B2_COD) AND B16.D_E_L_E_T_ = ' '
        LEFT JOIN SB1100 B10 ON RTRIM(B10.B1_COD) = RTRIM(B2.B2_COD) AND B10.D_E_L_E_T_ = ' '
        LEFT JOIN SB1010 B11 ON RTRIM(B11.B1_COD) = RTRIM(B2.B2_COD) AND B11.D_E_L_E_T_ = ' '
        WHERE B2.D_E_L_E_T_ = ' '
          AND B2.B2_QATU > 0
          AND COALESCE(B19.B1_TIPO, B16.B1_TIPO, B10.B1_TIPO, B11.B1_TIPO, 'PA') = 'PA'
        ORDER BY B2.B2_COD ASC;
      `;
      const resEstoque = await executeRailwayQuery(sqlEstoque);
      const rowsEstoque = resEstoque.rows || resEstoque || [];

      for (const r of rowsEstoque) {
        const qtd = roundVal(parseFloat(r.QUANTIDADE || 0));
        const custoUnit = parseFloat(r.CUSTO_UNITARIO || 0);
        const precoVenda = parseFloat(r.PRECO_VENDA || 0);
        const custoTotal = roundVal(qtd * custoUnit);
        const vendaTotal = roundVal(qtd * precoVenda);

        resultado.estoque.push({
          empresa_cod: emp.cod,
          empresa_sigla: emp.sigla,
          codigo: String(r.CODIGO || '').trim(),
          descricao: String(r.DESCRICAO || `PRODUTO ${r.CODIGO}`).trim(),
          tipo: 'PA',
          grupo_cod: String(r.GRUPO_COD || '').trim(),
          quantidade: qtd,
          custo_unitario: roundVal(custoUnit),
          preco_venda: roundVal(precoVenda),
          custo_total: custoTotal,
          valor_total_venda: vendaTotal
        });
      }
    } catch (errEst) {
      console.warn(`⚠️ [BI Índices] Erro ao extrair estoque da empresa ${emp.sigla}:`, errEst.message);
    }
  }

  console.log(`✅ [BI Índices] Extração concluída com sucesso: ${resultado.saldosBancarios.length} contas bancárias, ${resultado.contasReceber.length} títulos a receber, ${resultado.contasPagar.length} títulos a pagar, ${resultado.estoque.length} produtos PA em estoque.`);
  return resultado;
}

/**
 * 2. CÁLCULO MATEMÁTICO DOS 3 ÍNDICES DE LIQUIDEZ
 */
function calcularIndicesLiquidez(dados) {
  const { saldosBancarios = [], contasReceber = [], contasPagar = [], estoque = [] } = dados;

  // Função auxiliar para agregar métricas de um conjunto filtrado
  function agregarMetricas(empCodFilter = null) {
    const fEmp = (item) => !empCodFilter || item.empresa_cod === empCodFilter;

    const sbFiltrado = saldosBancarios.filter(fEmp);
    const crFiltrado = contasReceber.filter(fEmp);
    const cpFiltrado = contasPagar.filter(fEmp);
    const estFiltrado = estoque.filter(fEmp);

    // Componente 1: Disponibilidades (Saldos Bancários SE8)
    const totalDisponibilidades = roundVal(sbFiltrado.reduce((acc, r) => acc + Number(r.saldo_atual || 0), 0));
    const totalContasBancarias = sbFiltrado.length;

    // Componente 2: Contas a Receber (Válido para Índice vs Total Aberto)
    const totalReceberAberto = roundVal(crFiltrado.reduce((acc, r) => acc + Number(r.saldo || 0), 0));
    const totalReceberValido = roundVal(crFiltrado.filter(r => r.valido_indice).reduce((acc, r) => acc + Number(r.saldo || 0), 0));
    const totalReceberInadimplente5d = roundVal(totalReceberAberto - totalReceberValido);
    const totalTitulosReceber = crFiltrado.length;

    // Componente 3: Estoques PA (Custo Total e Venda Total)
    const totalEstoqueCusto = roundVal(estFiltrado.reduce((acc, r) => acc + Number(r.custo_total || 0), 0));
    const totalEstoqueVenda = roundVal(estFiltrado.reduce((acc, r) => acc + Number(r.valor_total_venda || 0), 0));
    const totalItensEstoque = estFiltrado.length;

    // Componente 4: Passivo Circulante (Contas a Pagar SE2 incluindo PR)
    const totalPagarAberto = roundVal(cpFiltrado.reduce((acc, r) => acc + Number(r.saldo || 0), 0));
    const totalPagarProvisoriosPR = roundVal(cpFiltrado.filter(r => r.is_provisorio).reduce((acc, r) => acc + Number(r.saldo || 0), 0));
    const totalPagarDefinitivos = roundVal(totalPagarAberto - totalPagarProvisoriosPR);
    const totalTitulosPagar = cpFiltrado.length;

    // Ativo Circulante = Estoque Custo + Disponibilidades + Receber Válido
    const ativoCirculante = roundVal(totalEstoqueCusto + totalDisponibilidades + totalReceberValido);
    // Passivo Circulante = Total Contas a Pagar
    const passivoCirculante = totalPagarAberto;

    // 1. Liquidez Corrente (LC) = Ativo Circulante / Passivo Circulante
    const liquidezCorrente = passivoCirculante > 0 ? roundIndex(ativoCirculante / passivoCirculante) : 0;

    // 2. Liquidez Seca (LS) = (Ativo Circulante - Estoques) / Passivo Circulante = (Disponibilidades + Receber Válido) / Passivo Circulante
    const ativoSeco = roundVal(totalDisponibilidades + totalReceberValido);
    const liquidezSeca = passivoCirculante > 0 ? roundIndex(ativoSeco / passivoCirculante) : 0;

    // 3. Liquidez Imediata (LI) = Disponibilidades / Passivo Circulante
    const liquidezImediata = passivoCirculante > 0 ? roundIndex(totalDisponibilidades / passivoCirculante) : 0;

    return {
      ativoCirculante,
      passivoCirculante,
      ativoSeco,
      liquidezCorrente,
      liquidezSeca,
      liquidezImediata,
      componentes: {
        estoque: {
          custoTotal: totalEstoqueCusto,
          vendaTotal: totalEstoqueVenda,
          totalItens: totalItensEstoque
        },
        disponibilidades: {
          saldoTotal: totalDisponibilidades,
          totalContas: totalContasBancarias
        },
        contasReceber: {
          totalAberto: totalReceberAberto,
          validoIndice: totalReceberValido,
          inadimplente5d: totalReceberInadimplente5d,
          totalTitulos: totalTitulosReceber
        },
        contasPagar: {
          totalAberto: totalPagarAberto,
          provisoriosPR: totalPagarProvisoriosPR,
          definitivos: totalPagarDefinitivos,
          totalTitulos: totalTitulosPagar
        }
      }
    };
  }

  // Agregações:
  const consolidado = agregarMetricas(null);
  const porEmpresa = {
    "14": {
      empresa_cod: "14",
      empresa_sigla: "MP",
      empresa_nome: "Metal Pleno / S4BW",
      ...agregarMetricas("14")
    },
    "15": {
      empresa_cod: "15",
      empresa_sigla: "GSI",
      empresa_nome: "GSI Cofres",
      ...agregarMetricas("15")
    },
    "16": {
      empresa_cod: "16",
      empresa_sigla: "OACO",
      empresa_nome: "OAÇO Produtos de Aço",
      ...agregarMetricas("16")
    }
  };

  return {
    consolidado,
    porEmpresa,
    timestamp: new Date().toISOString()
  };
}

/**
 * 3. PERSISTÊNCIA EM LOTE NO SUPABASE (POSTGRESQL) COM FALLBACK JSON
 */
async function persistirDadosIndicesDB(dados, { triggeredBy = 'JOB', duracaoMs = 0 } = {}) {
  const { saldosBancarios = [], contasReceber = [], contasPagar = [], estoque = [] } = dados;
  const metrics = calcularIndicesLiquidez(dados);

  // 1. Sempre grava o cache local JSON para redundância e resiliência offline
  try {
    await safeWriteJson(indicesCacheFile, {
      ...dados,
      metricasCalculadas: metrics,
      syncedAt: new Date().toISOString(),
      triggeredBy
    });
    console.log('📁 [BI Índices] Cache JSON atualizado com sucesso em data/bi_indices_cache.json');
  } catch (errCache) {
    console.warn('⚠️ [BI Índices] Falha ao gravar cache local JSON:', errCache.message);
  }

  if (!isPostgresConnected()) {
    console.log('ℹ️ [BI Índices] Supabase PostgreSQL inativo. Dados persistidos exclusivamente no cache JSON.');
    return metrics;
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 2.1 Salva Tabela estoque (Upsert em lotes de 100)
    for (let i = 0; i < estoque.length; i += 100) {
      const chunk = estoque.slice(i, i + 100);
      const values = [];
      const placeholders = chunk.map((item, idx) => {
        const offset = idx * 11;
        values.push(
          item.empresa_cod, item.empresa_sigla, item.codigo, item.descricao,
          item.tipo || 'PA', item.grupo_cod || '', item.quantidade,
          item.custo_unitario, item.preco_venda, item.custo_total, item.valor_total_venda
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, NOW())`;
      }).join(', ');

      const sqlEst = `
        INSERT INTO estoque (
          empresa_cod, empresa_sigla, codigo, descricao, tipo, grupo_cod,
          quantidade, custo_unitario, preco_venda, custo_total, valor_total_venda, synced_at
        ) VALUES ${placeholders}
        ON CONFLICT (empresa_cod, codigo) DO UPDATE SET
          descricao = EXCLUDED.descricao,
          tipo = EXCLUDED.tipo,
          grupo_cod = EXCLUDED.grupo_cod,
          quantidade = EXCLUDED.quantidade,
          custo_unitario = EXCLUDED.custo_unitario,
          preco_venda = EXCLUDED.preco_venda,
          custo_total = EXCLUDED.custo_total,
          valor_total_venda = EXCLUDED.valor_total_venda,
          synced_at = NOW();
      `;
      await client.query(sqlEst, values);
    }

    // 2.2 Salva Tabela contas_a_receber
    for (let i = 0; i < contasReceber.length; i += 100) {
      const chunk = contasReceber.slice(i, i + 100);
      const values = [];
      const placeholders = chunk.map((item, idx) => {
        const offset = idx * 18;
        values.push(
          item.empresa_cod, item.empresa_sigla, item.filial, item.prefixo,
          item.numero_titulo, item.parcela, item.tipo, item.cliente_cod,
          item.cliente_loja, item.cliente_nome, item.natureza_cod, item.data_emissao,
          item.data_vencimento, item.data_vencimento_real, item.valor_original,
          item.saldo, item.dias_vencido, item.valido_indice
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, 'ABERTO', NOW())`;
      }).join(', ');

      const sqlCR = `
        INSERT INTO contas_a_receber (
          empresa_cod, empresa_sigla, filial, prefixo, numero_titulo, parcela, tipo,
          cliente_cod, cliente_loja, cliente_nome, natureza_cod, data_emissao,
          data_vencimento, data_vencimento_real, valor_original, saldo, dias_vencido,
          valido_indice, status, synced_at
        ) VALUES ${placeholders}
        ON CONFLICT (empresa_cod, prefixo, numero_titulo, parcela, tipo) DO UPDATE SET
          cliente_nome = EXCLUDED.cliente_nome,
          natureza_cod = EXCLUDED.natureza_cod,
          data_vencimento = EXCLUDED.data_vencimento,
          data_vencimento_real = EXCLUDED.data_vencimento_real,
          valor_original = EXCLUDED.valor_original,
          saldo = EXCLUDED.saldo,
          dias_vencido = EXCLUDED.dias_vencido,
          valido_indice = EXCLUDED.valido_indice,
          status = EXCLUDED.status,
          synced_at = NOW();
      `;
      await client.query(sqlCR, values);
    }

    // 2.3 Salva Tabela contas_a_pagar
    for (let i = 0; i < contasPagar.length; i += 100) {
      const chunk = contasPagar.slice(i, i + 100);
      const values = [];
      const placeholders = chunk.map((item, idx) => {
        const offset = idx * 17;
        values.push(
          item.empresa_cod, item.empresa_sigla, item.filial, item.prefixo,
          item.numero_titulo, item.parcela, item.tipo, item.fornecedor_cod,
          item.fornecedor_loja, item.fornecedor_nome, item.natureza_cod, item.data_emissao,
          item.data_vencimento, item.data_vencimento_real, item.valor_original,
          item.saldo, item.is_provisorio
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, 'ABERTO', NOW())`;
      }).join(', ');

      const sqlCP = `
        INSERT INTO contas_a_pagar (
          empresa_cod, empresa_sigla, filial, prefixo, numero_titulo, parcela, tipo,
          fornecedor_cod, fornecedor_loja, fornecedor_nome, natureza_cod, data_emissao,
          data_vencimento, data_vencimento_real, valor_original, saldo, is_provisorio,
          status, synced_at
        ) VALUES ${placeholders}
        ON CONFLICT (empresa_cod, prefixo, numero_titulo, parcela, tipo) DO UPDATE SET
          fornecedor_nome = EXCLUDED.fornecedor_nome,
          natureza_cod = EXCLUDED.natureza_cod,
          data_vencimento = EXCLUDED.data_vencimento,
          data_vencimento_real = EXCLUDED.data_vencimento_real,
          valor_original = EXCLUDED.valor_original,
          saldo = EXCLUDED.saldo,
          is_provisorio = EXCLUDED.is_provisorio,
          status = EXCLUDED.status,
          synced_at = NOW();
      `;
      await client.query(sqlCP, values);
    }

    // 2.4 Salva Tabela saldos_bancarios
    for (let i = 0; i < saldosBancarios.length; i += 100) {
      const chunk = saldosBancarios.slice(i, i + 100);
      const values = [];
      const placeholders = chunk.map((item, idx) => {
        const offset = idx * 7;
        values.push(
          item.empresa_cod, item.empresa_sigla, item.banco_cod,
          item.agencia || '', item.conta, item.conta_nome || '',
          item.data_saldo, item.saldo_atual
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, NOW())`;
      }).join(', ');

      const sqlSB = `
        INSERT INTO saldos_bancarios (
          empresa_cod, empresa_sigla, banco_cod, agencia, conta, conta_nome,
          data_saldo, saldo_atual, synced_at
        ) VALUES ${placeholders}
        ON CONFLICT (empresa_cod, banco_cod, agencia, conta) DO UPDATE SET
          conta_nome = EXCLUDED.conta_nome,
          data_saldo = EXCLUDED.data_saldo,
          saldo_atual = EXCLUDED.saldo_atual,
          synced_at = NOW();
      `;
      await client.query(sqlSB, values);
    }

    // 2.5 Grava Log de Auditoria
    await client.query(`
      INSERT INTO indices_sync_logs (
        status, total_estoque, total_receber, total_pagar, total_bancos,
        valor_ativo_circulante, valor_passivo_circulante, liquidez_corrente_consolidada,
        duracao_ms, triggered_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW());
    `, [
      'SUCCESS',
      estoque.length,
      contasReceber.length,
      contasPagar.length,
      saldosBancarios.length,
      metrics.consolidado.ativoCirculante,
      metrics.consolidado.passivoCirculante,
      metrics.consolidado.liquidezCorrente,
      duracaoMs,
      triggeredBy
    ]);

    await client.query('COMMIT');
    console.log('✅ [BI Índices] Todos os registros foram persistidos no Supabase PostgreSQL com sucesso!');
  } catch (errDB) {
    await client.query('ROLLBACK');
    console.error('❌ [BI Índices] Erro ao persistir dados no Supabase PostgreSQL:', errDB.message);
    throw errDB;
  } finally {
    client.release();
  }

  return metrics;
}

/**
 * 4. SINCRONIZAÇÃO COMPLETA (PROTHEUS -> DB + CACHE)
 */
async function sincronizarIndicesCompleto({ triggeredBy = 'MANUAL' } = {}) {
  const inicioTime = Date.now();
  console.log(`\n⏳ [BI Índices Sync] Iniciando ciclo de sincronização (Disparado por: ${triggeredBy})...`);

  try {
    const dadosProtheus = await extrairDadosIndicesProtheus();
    const duracaoMs = Date.now() - inicioTime;
    const metricas = await persistirDadosIndicesDB(dadosProtheus, { triggeredBy, duracaoMs });

    return {
      success: true,
      duracaoMs,
      timestamp: new Date().toISOString(),
      totais: {
        estoque: dadosProtheus.estoque.length,
        contasReceber: dadosProtheus.contasReceber.length,
        contasPagar: dadosProtheus.contasPagar.length,
        saldosBancarios: dadosProtheus.saldosBancarios.length
      },
      metricas
    };
  } catch (err) {
    console.error('❌ [BI Índices Sync] Falha crítica na sincronização de índices:', err.message);
    return {
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 5. CARGA DE DADOS PARA A INTERFACE (LEITURA DO SUPABASE OU CACHE JSON)
 */
async function obterDadosIndicesCalculados() {
  // Tenta ler do Supabase caso esteja habilitado
  if (isPostgresConnected()) {
    try {
      const pool = getPool();
      
      const [qEst, qCR, qCP, qSB] = await Promise.all([
        pool.query('SELECT * FROM estoque WHERE quantidade > 0 AND tipo = $1', ['PA']),
        pool.query('SELECT * FROM contas_a_receber WHERE saldo > 0'),
        pool.query('SELECT * FROM contas_a_pagar WHERE saldo > 0'),
        pool.query('SELECT * FROM saldos_bancarios')
      ]);

      const dados = {
        estoque: qEst.rows || [],
        contasReceber: qCR.rows || [],
        contasPagar: qCP.rows || [],
        saldosBancarios: qSB.rows || []
      };

      if (dados.saldosBancarios.length > 0 || dados.contasReceber.length > 0) {
        const metricas = calcularIndicesLiquidez(dados);
        return {
          source: 'POSTGRES',
          metricas,
          dadosResumo: {
            saldosBancarios: dados.saldosBancarios,
            estoqueResumo: dados.estoque.slice(0, 10),
            contasReceberResumo: dados.contasReceber.slice(0, 10),
            contasPagarResumo: dados.contasPagar.slice(0, 10)
          }
        };
      }
    } catch (errPostgres) {
      console.warn('⚠️ [BI Índices] Erro ao consultar dados no Postgres, recorrendo ao cache JSON:', errPostgres.message);
    }
  }

  // Fallback para cache local JSON
  try {
    if (fs.existsSync(indicesCacheFile)) {
      const raw = await fs.promises.readFile(indicesCacheFile, 'utf-8');
      const cache = JSON.parse(raw);
      const metricas = cache.metricasCalculadas || calcularIndicesLiquidez(cache);
      return {
        source: 'CACHE_JSON',
        metricas,
        dadosResumo: {
          saldosBancarios: cache.saldosBancarios || [],
          estoqueResumo: (cache.estoque || []).slice(0, 10),
          contasReceberResumo: (cache.contasReceber || []).slice(0, 10),
          contasPagarResumo: (cache.contasPagar || []).slice(0, 10)
        }
      };
    }
  } catch (errJson) {
    console.warn('⚠️ [BI Índices] Falha ao ler cache local JSON:', errJson.message);
  }

  // Se não houver dados em nenhum dos dois, dispara extração inicial transparente
  console.log('⚡ [BI Índices] Nenhum dado prévio localizado. Disparando sincronização inicial sob demanda...');
  const syncRes = await sincronizarIndicesCompleto({ triggeredBy: 'STARTUP_AUTO' });
  return {
    source: 'LIVE_PROTHEUS',
    metricas: syncRes.metricas || calcularIndicesLiquidez({}),
    dadosResumo: { saldosBancarios: [], estoqueResumo: [], contasReceberResumo: [], contasPagarResumo: [] }
  };
}

/**
 * 6. CONSULTA PAGINADA E FILTRADA PARA O MODAL DE DRILLDOWN
 */
async function obterDetalhesIndicesDrilldown({ tipo = 'bancos', empresa = 'ALL', search = '', limit = 50, offset = 0 } = {}) {
  const dadosGerais = await (async () => {
    if (fs.existsSync(indicesCacheFile)) {
      try {
        const raw = await fs.promises.readFile(indicesCacheFile, 'utf-8');
        return JSON.parse(raw);
      } catch {}
    }
    return extrairDadosIndicesProtheus();
  })();

  let lista = [];
  const sTerm = String(search || '').toLowerCase().trim();

  if (tipo === 'bancos') {
    lista = dadosGerais.saldosBancarios || [];
    if (empresa && empresa !== 'ALL') {
      lista = lista.filter(r => r.empresa_cod === empresa || r.empresa_sigla === empresa);
    }
    if (sTerm) {
      lista = lista.filter(r => 
        (r.banco_cod && r.banco_cod.toLowerCase().includes(sTerm)) ||
        (r.conta && r.conta.toLowerCase().includes(sTerm)) ||
        (r.conta_nome && r.conta_nome.toLowerCase().includes(sTerm))
      );
    }
  } else if (tipo === 'receber') {
    lista = dadosGerais.contasReceber || [];
    if (empresa && empresa !== 'ALL') {
      lista = lista.filter(r => r.empresa_cod === empresa || r.empresa_sigla === empresa);
    }
    if (sTerm) {
      lista = lista.filter(r => 
        (r.numero_titulo && r.numero_titulo.toLowerCase().includes(sTerm)) ||
        (r.cliente_nome && r.cliente_nome.toLowerCase().includes(sTerm)) ||
        (r.natureza_cod && r.natureza_cod.toLowerCase().includes(sTerm))
      );
    }
  } else if (tipo === 'pagar') {
    lista = dadosGerais.contasPagar || [];
    if (empresa && empresa !== 'ALL') {
      lista = lista.filter(r => r.empresa_cod === empresa || r.empresa_sigla === empresa);
    }
    if (sTerm) {
      lista = lista.filter(r => 
        (r.numero_titulo && r.numero_titulo.toLowerCase().includes(sTerm)) ||
        (r.fornecedor_nome && r.fornecedor_nome.toLowerCase().includes(sTerm)) ||
        (r.natureza_cod && r.natureza_cod.toLowerCase().includes(sTerm)) ||
        (r.tipo && r.tipo.toLowerCase().includes(sTerm))
      );
    }
  } else if (tipo === 'estoque') {
    lista = dadosGerais.estoque || [];
    if (empresa && empresa !== 'ALL') {
      lista = lista.filter(r => r.empresa_cod === empresa || r.empresa_sigla === empresa);
    }
    if (sTerm) {
      lista = lista.filter(r => 
        (r.codigo && r.codigo.toLowerCase().includes(sTerm)) ||
        (r.descricao && r.descricao.toLowerCase().includes(sTerm)) ||
        (r.grupo_cod && r.grupo_cod.toLowerCase().includes(sTerm))
      );
    }
  }

  const total = lista.length;
  const paginado = lista.slice(offset, offset + limit);

  return {
    tipo,
    empresa,
    total,
    limit,
    offset,
    itens: paginado
  };
}

module.exports = {
  extrairDadosIndicesProtheus,
  calcularIndicesLiquidez,
  persistirDadosIndicesDB,
  sincronizarIndicesCompleto,
  obterDadosIndicesCalculados,
  obterDetalhesIndicesDrilldown,
  roundVal,
  roundIndex,
  calcularDiasVencido
};
