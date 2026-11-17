/**
 * bi_ciclo_operacional_engine.js
 * Módulo Dedicado de Ciclo Operacional, Ciclo Financeiro e NCG (BI Executivo)
 * Plataforma de Apoio GSI (Gemini-Cli)
 *
 * Responsabilidades:
 * 1. Extração unificada do ERP TOTVS Protheus (SE1, SE2, SB2, SF1, SF2, SD2).
 * 2. Filtragem estrita por tipo de NF e CFOPs operacionais (exclusão de transferências, remessas e comodatos).
 * 3. Cálculo matemático dos índices:
 *    - PME (Prazo Médio de Estocagem)
 *    - PMRV (Prazo Médio de Recebimento de Vendas)
 *    - PMPC (Prazo Médio de Pagamento de Compras)
 *    - CO (Ciclo Operacional = PME + PMRV)
 *    - CF (Ciclo Financeiro = CO - PMPC)
 *    - NCG (Necessidade de Capital de Giro em R$ e dias)
 * 4. Cache persistente multi-empresa (Supabase PostgreSQL + JSON local).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { executeRailwayQuery } = require('./protheus_db');
const { getPool, isPostgresConnected } = require('./postgres_db');

const dataDir = path.join(__dirname, 'data');
const cicloCacheFile = path.join(dataDir, 'bi_ciclo_operacional_cache.json');

// Mapeamento das 3 empresas atendidas
const EMPRESAS_CICLO = [
  { cod: '14', sigla: 'MP', nome: 'Metal Pleno / S4BW', se1: 'SE1140', se2: 'SE2140', sb2: 'SB2140', sf1: 'SF1140', sf2: 'SF2140', sd1: 'SD1140', sd2: 'SD2140' },
  { cod: '15', sigla: 'GSI', nome: 'GSI Cofres', se1: 'SE1150', se2: 'SE2150', sb2: 'SB2150', sf1: 'SF1150', sf2: 'SF2150', sd1: 'SD1150', sd2: 'SD2150' },
  { cod: '16', sigla: 'OACO', nome: 'OAÇO Produtos de Aço', se1: 'SE1160', se2: 'SE2160', sb2: 'SB2160', sf1: 'SF1160', sf2: 'SF2160', sd1: 'SD1160', sd2: 'SD2160' }
];

// Helper: Arredondamento monetário de 2 casas
function roundVal(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

// Helper: Arredondamento de prazos (1 casa decimal para precisão analítica)
function roundDays(v) {
  return Math.round((Number(v) || 0) * 10) / 10;
}

// Helper: Formata data YYYYMMDD para YYYY-MM-DD
function parseDateYmd(ymd) {
  const s = String(ymd || '').replace(/\D/g, '');
  if (s.length === 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return null;
}

// Helper: Retorna data retroativa YYYYMMDD para consultas no Protheus
function getDataRetroativaYmd(diasAtras = 365) {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}${mes}${dia}`;
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
async function extrairDadosCicloOperacionalProtheus(diasAnalise = 365) {
  const dtInicioYmd = getDataRetroativaYmd(diasAnalise);
  console.log(`⏳ [BI Ciclo Operacional] Iniciando extração do Protheus (janela de ${diasAnalise} dias, desde ${dtInicioYmd})...`);

  const resultado = {
    dataInicioYmd: dtInicioYmd,
    diasPeriodo: diasAnalise,
    estoque: [],
    contasReceber: [],
    contasPagar: [],
    vendasPeriodo: [],
    comprasPeriodo: [],
    cmvPeriodo: []
  };

  for (const emp of EMPRESAS_CICLO) {
    // 1.1 Saldo Atual de Estoque PA (SB2 + SB1)
    try {
      const sqlEstoque = `
        SELECT 
          RTRIM(B2.B2_COD) AS CODIGO,
          RTRIM(COALESCE(MAX(B19.B1_DESC), MAX(B16.B1_DESC), MAX(B10.B1_DESC), MAX(B11.B1_DESC), '')) AS DESCRICAO,
          RTRIM(COALESCE(MAX(B19.B1_TIPO), MAX(B16.B1_TIPO), MAX(B10.B1_TIPO), MAX(B11.B1_TIPO), 'PA')) AS TIPO,
          SUM(B2.B2_QATU) AS QUANTIDADE,
          COALESCE(NULLIF(MAX(B19.B1_VLUNIT), 0), NULLIF(MAX(B16.B1_VLUNIT), 0), NULLIF(MAX(B10.B1_VLUNIT), 0), NULLIF(MAX(B11.B1_VLUNIT), 0), 0) AS CUSTO_UNITARIO
        FROM ${emp.sb2} B2
        LEFT JOIN SB1090 B19 ON RTRIM(B19.B1_COD) = RTRIM(B2.B2_COD) AND B19.D_E_L_E_T_ = ' '
        LEFT JOIN SB1160 B16 ON RTRIM(B16.B1_COD) = RTRIM(B2.B2_COD) AND B16.D_E_L_E_T_ = ' '
        LEFT JOIN SB1100 B10 ON RTRIM(B10.B1_COD) = RTRIM(B2.B2_COD) AND B10.D_E_L_E_T_ = ' '
        LEFT JOIN SB1010 B11 ON RTRIM(B11.B1_COD) = RTRIM(B2.B2_COD) AND B11.D_E_L_E_T_ = ' '
        WHERE B2.D_E_L_E_T_ = ' '
          AND B2.B2_QATU > 0
          AND COALESCE(B19.B1_TIPO, B16.B1_TIPO, B10.B1_TIPO, B11.B1_TIPO, 'PA') = 'PA'
        GROUP BY RTRIM(B2.B2_COD)
        HAVING SUM(B2.B2_QATU) > 0;
      `;
      const resEst = await executeRailwayQuery(sqlEstoque);
      const rowsEst = resEst.rows || resEst || [];
      for (const r of rowsEst) {
        const qtd = parseFloat(r.QUANTIDADE || 0);
        const custoUnit = parseFloat(r.CUSTO_UNITARIO || 0);
        resultado.estoque.push({
          empresa_cod: emp.cod,
          empresa_sigla: emp.sigla,
          codigo: String(r.CODIGO || '').trim(),
          descricao: String(r.DESCRICAO || '').trim(),
          quantidade: qtd,
          custo_unitario: roundVal(custoUnit),
          custo_total: roundVal(qtd * custoUnit)
        });
      }
    } catch (errEst) {
      console.warn(`⚠️ [BI Ciclo Operacional] Erro ao extrair estoque da empresa ${emp.sigla}:`, errEst.message);
    }

    // 1.2 Saldo Atual de Contas a Receber Operacionais (SE1)
    try {
      const sqlSE1 = `
        SELECT 
          R_E_C_N_O_ AS RECNO,
          RTRIM(ISNULL(E1_FILIAL, '01')) AS FILIAL,
          RTRIM(ISNULL(E1_PREFIXO, '')) AS PREFIXO,
          RTRIM(E1_NUM) AS NUMERO_TITULO,
          RTRIM(ISNULL(E1_PARCELA, '')) AS PARCELA,
          RTRIM(ISNULL(E1_TIPO, 'NF')) AS TIPO,
          RTRIM(ISNULL(E1_CLIENTE, '')) AS CLIENTE_COD,
          RTRIM(ISNULL(E1_NOMCLI, '')) AS CLIENTE_NOME,
          RTRIM(ISNULL(E1_EMISSAO, '')) AS DATA_EMISSAO,
          RTRIM(ISNULL(E1_VENCREA, E1_VENCTO)) AS DATA_VENCTO,
          ISNULL(E1_VALOR, 0) AS VALOR_ORIGINAL,
          ISNULL(E1_SALDO, 0) AS SALDO
        FROM ${emp.se1}
        WHERE D_E_L_E_T_ = ' '
          AND E1_SALDO > 0.01
          AND RTRIM(ISNULL(E1_TIPO, 'NF')) IN ('NF', 'DP', 'DU', 'FT')
        ORDER BY E1_VENCREA ASC;
      `;
      const resSE1 = await executeRailwayQuery(sqlSE1);
      const rowsSE1 = resSE1.rows || resSE1 || [];
      for (const r of rowsSE1) {
        resultado.contasReceber.push({
          empresa_cod: emp.cod,
          empresa_sigla: emp.sigla,
          recno: r.RECNO,
          numero_titulo: String(r.NUMERO_TITULO || '').trim(),
          parcela: r.PARCELA || '',
          cliente_nome: r.CLIENTE_NOME || 'NÃO INFORMADO',
          data_emissao: parseDateYmd(r.DATA_EMISSAO),
          data_vencimento: parseDateYmd(r.DATA_VENCTO),
          valor_original: roundVal(parseFloat(r.VALOR_ORIGINAL || 0)),
          saldo: roundVal(parseFloat(r.SALDO || 0))
        });
      }
    } catch (errSE1) {
      console.warn(`⚠️ [BI Ciclo Operacional] Erro ao extrair SE1 da empresa ${emp.sigla}:`, errSE1.message);
    }

    // 1.3 Saldo Atual de Contas a Pagar Fornecedores (SE2)
    try {
      const sqlSE2 = `
        SELECT 
          R_E_C_N_O_ AS RECNO,
          RTRIM(ISNULL(E2_FILIAL, '01')) AS FILIAL,
          RTRIM(ISNULL(E2_PREFIXO, '')) AS PREFIXO,
          RTRIM(E2_NUM) AS NUMERO_TITULO,
          RTRIM(ISNULL(E2_PARCELA, '')) AS PARCELA,
          RTRIM(ISNULL(E2_TIPO, 'NF')) AS TIPO,
          RTRIM(ISNULL(E2_FORNECE, '')) AS FORNECEDOR_COD,
          RTRIM(ISNULL(E2_NOMFOR, '')) AS FORNECEDOR_NOME,
          RTRIM(ISNULL(E2_EMISSAO, '')) AS DATA_EMISSAO,
          RTRIM(ISNULL(E2_VENCREA, E2_VENCTO)) AS DATA_VENCTO,
          ISNULL(E2_VALOR, 0) AS VALOR_ORIGINAL,
          ISNULL(E2_SALDO, 0) AS SALDO
        FROM ${emp.se2}
        WHERE D_E_L_E_T_ = ' '
          AND E2_SALDO > 0.01
          AND RTRIM(ISNULL(E2_TIPO, 'NF')) NOT IN ('PA', 'PR', 'TX')
        ORDER BY E2_VENCREA ASC;
      `;
      const resSE2 = await executeRailwayQuery(sqlSE2);
      const rowsSE2 = resSE2.rows || resSE2 || [];
      for (const r of rowsSE2) {
        resultado.contasPagar.push({
          empresa_cod: emp.cod,
          empresa_sigla: emp.sigla,
          recno: r.RECNO,
          numero_titulo: String(r.NUMERO_TITULO || '').trim(),
          parcela: r.PARCELA || '',
          fornecedor_nome: r.FORNECEDOR_NOME || 'FORNECEDOR NÃO INFORMADO',
          data_emissao: parseDateYmd(r.DATA_EMISSAO),
          data_vencimento: parseDateYmd(r.DATA_VENCTO),
          valor_original: roundVal(parseFloat(r.VALOR_ORIGINAL || 0)),
          saldo: roundVal(parseFloat(r.SALDO || 0))
        });
      }
    } catch (errSE2) {
      console.warn(`⚠️ [BI Ciclo Operacional] Erro ao extrair SE2 da empresa ${emp.sigla}:`, errSE2.message);
    }

    // 1.4 Faturamento de Vendas Operacionais no Período (SF2)
    try {
      const sqlSF2 = `
        SELECT 
          ISNULL(SUM(F2_VALBRUT - ISNULL(F2_DESCONT, 0)), 0) AS FATURAMENTO_TOTAL,
          COUNT(*) AS TOTAL_NOTAS
        FROM ${emp.sf2}
        WHERE D_E_L_E_T_ = ' '
          AND F2_TIPO = 'N'
          AND F2_EMISSAO >= '${dtInicioYmd}'
          AND (
            SUBSTRING(F2_CFOP, 1, 2) IN ('51', '61', '54', '64')
            OR F2_CFOP LIKE '51%' OR F2_CFOP LIKE '61%' OR F2_CFOP LIKE '54%' OR F2_CFOP LIKE '64%'
          );
      `;
      const resSF2 = await executeRailwayQuery(sqlSF2);
      const rowSF2 = (resSF2.rows || resSF2 || [])[0] || {};
      resultado.vendasPeriodo.push({
        empresa_cod: emp.cod,
        empresa_sigla: emp.sigla,
        faturamento_total: roundVal(parseFloat(rowSF2.FATURAMENTO_TOTAL || 0)),
        total_notas: parseInt(rowSF2.TOTAL_NOTAS || 0, 10)
      });
    } catch (errSF2) {
      console.warn(`⚠️ [BI Ciclo Operacional] Erro ao extrair SF2 da empresa ${emp.sigla}:`, errSF2.message);
    }

    // 1.5 CMV no Período (SD2 - Itens Faturados)
    try {
      const sqlSD2 = `
        SELECT 
          ISNULL(SUM(CASE WHEN D2_CUSTO1 > 0 THEN D2_CUSTO1 ELSE (D2_TOTAL * 0.65) END), 0) AS CMV_TOTAL
        FROM ${emp.sd2}
        WHERE D_E_L_E_T_ = ' '
          AND D2_TIPO = 'N'
          AND D2_EMISSAO >= '${dtInicioYmd}'
          AND (
            SUBSTRING(D2_CFOP, 1, 2) IN ('51', '61', '54', '64')
            OR D2_CFOP LIKE '51%' OR D2_CFOP LIKE '61%' OR D2_CFOP LIKE '54%' OR D2_CFOP LIKE '64%'
          );
      `;
      const resSD2 = await executeRailwayQuery(sqlSD2);
      const rowSD2 = (resSD2.rows || resSD2 || [])[0] || {};
      resultado.cmvPeriodo.push({
        empresa_cod: emp.cod,
        empresa_sigla: emp.sigla,
        cmv_total: roundVal(parseFloat(rowSD2.CMV_TOTAL || 0))
      });
    } catch (errSD2) {
      console.warn(`⚠️ [BI Ciclo Operacional] Erro ao extrair SD2 da empresa ${emp.sigla}:`, errSD2.message);
    }

    // 1.6 Compras de Fornecedores / Insumos no Período (SF1)
    try {
      const sqlSF1 = `
        SELECT 
          ISNULL(SUM(F1_VALBRUT), 0) AS COMPRAS_TOTAL,
          COUNT(*) AS TOTAL_NOTAS
        FROM ${emp.sf1}
        WHERE D_E_L_E_T_ = ' '
          AND F1_TIPO = 'N'
          AND F1_EMISSAO >= '${dtInicioYmd}'
          AND (
            SUBSTRING(F1_CFOP, 1, 2) IN ('11', '21', '14', '24')
            OR F1_CFOP LIKE '11%' OR F1_CFOP LIKE '21%' OR F1_CFOP LIKE '14%' OR F1_CFOP LIKE '24%'
          );
      `;
      const resSF1 = await executeRailwayQuery(sqlSF1);
      const rowSF1 = (resSF1.rows || resSF1 || [])[0] || {};
      resultado.comprasPeriodo.push({
        empresa_cod: emp.cod,
        empresa_sigla: emp.sigla,
        compras_total: roundVal(parseFloat(rowSF1.COMPRAS_TOTAL || 0)),
        total_notas: parseInt(rowSF1.TOTAL_NOTAS || 0, 10)
      });
    } catch (errSF1) {
      console.warn(`⚠️ [BI Ciclo Operacional] Erro ao extrair SF1 da empresa ${emp.sigla}:`, errSF1.message);
    }
  }

  console.log(`✅ [BI Ciclo Operacional] Extração concluída: ${resultado.estoque.length} itens estoque, ${resultado.contasReceber.length} contas receber, ${resultado.contasPagar.length} contas pagar.`);
  return resultado;
}

/**
 * 2. CÁLCULO MATEMÁTICO DOS ÍNDICES
 */
function calcularCicloOperacionalIndices(dados) {
  const {
    diasPeriodo = 365,
    estoque = [],
    contasReceber = [],
    contasPagar = [],
    vendasPeriodo = [],
    comprasPeriodo = [],
    cmvPeriodo = []
  } = dados;

  const dias = Math.max(1, Number(diasPeriodo) || 365);

  function agregarEmpresa(empCodFilter = null) {
    const fEmp = (item) => !empCodFilter || item.empresa_cod === empCodFilter;

    // Saldos de Balanço (Posição Atual)
    const estFiltrado = estoque.filter(fEmp);
    const crFiltrado = contasReceber.filter(fEmp);
    const cpFiltrado = contasPagar.filter(fEmp);

    const saldoEstoqueTotal = roundVal(estFiltrado.reduce((acc, r) => acc + Number(r.custo_total || 0), 0));
    const saldoReceberTotal = roundVal(crFiltrado.reduce((acc, r) => acc + Number(r.saldo || 0), 0));
    const saldoPagarTotal = roundVal(cpFiltrado.reduce((acc, r) => acc + Number(r.saldo || 0), 0));

    // Fluxos do Período
    const vendasFiltradas = vendasPeriodo.filter(fEmp);
    const comprasFiltradas = comprasPeriodo.filter(fEmp);
    const cmvFiltrado = cmvPeriodo.filter(fEmp);

    const faturamentoTotal = roundVal(vendasFiltradas.reduce((acc, r) => acc + Number(r.faturamento_total || 0), 0));
    const comprasTotal = roundVal(comprasFiltradas.reduce((acc, r) => acc + Number(r.compras_total || 0), 0));
    const cmvTotal = roundVal(cmvFiltrado.reduce((acc, r) => acc + Number(r.cmv_total || 0), 0));

    // Médias Diárias
    const cmvDiario = cmvTotal > 0 ? (cmvTotal / dias) : 1;
    const vendasDiarias = faturamentoTotal > 0 ? (faturamentoTotal / dias) : 1;
    const comprasDiarias = comprasTotal > 0 ? (comprasTotal / dias) : 1;

    // 1. PME (Prazo Médio de Estocagem) = (Estoque / CMV) * Dias
    const pme = cmvTotal > 0 ? roundDays((saldoEstoqueTotal / cmvDiario)) : 0;

    // 2. PMRV (Prazo Médio de Recebimento de Vendas) = (Duplicatas / Vendas) * Dias
    const pmrv = faturamentoTotal > 0 ? roundDays((saldoReceberTotal / vendasDiarias)) : 0;

    // 3. PMPC (Prazo Médio de Pagamento de Compras) = (Fornecedores / Compras) * Dias
    const pmpc = comprasTotal > 0 ? roundDays((saldoPagarTotal / comprasDiarias)) : 0;

    // 4. CO (Ciclo Operacional) = PME + PMRV
    const co = roundDays(pme + pmrv);

    // 5. CF (Ciclo Financeiro) = CO - PMPC
    const cf = roundDays(co - pmpc);

    // 6. NCG (Necessidade de Capital de Giro)
    // Visão Patrimonial: (Estoque + Receber) - Fornecedores
    const ncgPatrimonial = roundVal((saldoEstoqueTotal + saldoReceberTotal) - saldoPagarTotal);

    // Visão Financeira de Caixa: CF * Desembolso Diário
    // Se CF <= 0, a operação é autofinanciada por fornecedores (NCG de caixa zerada ou superavitária)
    const desembolsoDiario = roundVal(cmvDiario);
    const ncgFinanceira = cf > 0 ? roundVal(cf * desembolsoDiario) : 0;

    // Status Qualitativos
    let cfStatus = 'excelente';
    let cfTexto = 'Operação autofinanciada por fornecedores (eficiência máxima de caixa)';
    if (cf > 60) {
      cfStatus = 'critico';
      cfTexto = 'Ciclo de caixa estendido (alto consumo de capital de giro)';
    } else if (cf > 0) {
      cfStatus = 'moderado';
      cfTexto = 'Ciclo de caixa normal (financiado parcialmente com giro)';
    }

    return {
      empresa_cod: empCodFilter || 'CONSOLIDADO',
      diasPeriodo: dias,
      saldos: {
        estoque: saldoEstoqueTotal,
        contasReceber: saldoReceberTotal,
        contasPagar: saldoPagarTotal,
        ativoCirculanteOperacional: roundVal(saldoEstoqueTotal + saldoReceberTotal),
        passivoCirculanteOperacional: saldoPagarTotal
      },
      fluxos: {
        faturamentoTotal,
        comprasTotal,
        cmvTotal,
        faturamentoDiario: roundVal(vendasDiarias),
        comprasDiarias: roundVal(comprasDiarias),
        cmvDiario: roundVal(cmvDiario)
      },
      indices: {
        pme: { dias: pme, rotulo: 'Prazo Médio de Estocagem', formula: 'Estoque Médio / CMV Diário' },
        pmrv: { dias: pmrv, rotulo: 'Prazo Médio de Recebimento', formula: 'Duplicatas a Receber / Venda Diária' },
        pmpc: { dias: pmpc, rotulo: 'Prazo Médio de Pagamento', formula: 'Fornecedores a Pagar / Compra Diária' },
        co: { dias: co, rotulo: 'Ciclo Operacional', formula: 'PME + PMRV' },
        cf: {
          dias: cf,
          rotulo: 'Ciclo Financeiro (Caixa)',
          formula: 'CO - PMPC',
          status: cfStatus,
          descricao: cfTexto,
          isAutofinanciado: cf <= 0
        },
        ncg: {
          valorPatrimonial: ncgPatrimonial,
          valorFinanceiro: ncgFinanceira,
          rotulo: 'Necessidade de Capital de Giro',
          formula: '(Estoque + Receber) - Fornecedores',
          diasFinanciados: Math.max(0, cf)
        }
      }
    };
  }

  const consolidado = agregarEmpresa(null);
  const porEmpresa = {};
  for (const emp of EMPRESAS_CICLO) {
    porEmpresa[emp.cod] = {
      ...agregarEmpresa(emp.cod),
      sigla: emp.sigla,
      nome: emp.nome
    };
  }

  return {
    atualizado_em: new Date().toISOString(),
    diasPeriodo: dias,
    consolidado,
    porEmpresa
  };
}

/**
 * 3. PERSISTÊNCIA EM CACHE (JSON LOCAL + SUPABASE POSTGRESQL)
 */
async function sincronizarCicloOperacionalCompleto(diasAnalise = 365) {
  const dadosExtraidos = await extrairDadosCicloOperacionalProtheus(diasAnalise);
  const calculados = calcularCicloOperacionalIndices(dadosExtraidos);

  const pacoteCache = {
    atualizado_em: new Date().toISOString(),
    diasPeriodo: diasAnalise,
    calculados,
    detalhes: {
      estoqueTop: dadosExtraidos.estoque.sort((a, b) => b.custo_total - a.custo_total).slice(0, 100),
      receberTop: dadosExtraidos.contasReceber.sort((a, b) => b.saldo - a.saldo).slice(0, 100),
      pagarTop: dadosExtraidos.contasPagar.sort((a, b) => b.saldo - a.saldo).slice(0, 100)
    }
  };

  // 1. Gravação local atômica
  try {
    await safeWriteJson(cicloCacheFile, pacoteCache);
    console.log('💾 [BI Ciclo Operacional] Cache local JSON atualizado com sucesso.');
  } catch (errJson) {
    console.error('❌ [BI Ciclo Operacional] Falha ao gravar cache local JSON:', errJson.message);
  }

  // 2. Persistência no Supabase PostgreSQL (se conectado)
  if (isPostgresConnected()) {
    try {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bi_ciclo_operacional_cache (
          id SERIAL PRIMARY KEY,
          chave VARCHAR(50) UNIQUE NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      await pool.query(`
        INSERT INTO bi_ciclo_operacional_cache (chave, payload, updated_at)
        VALUES ('padrao', $1, NOW())
        ON CONFLICT (chave) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = NOW();
      `, [JSON.stringify(pacoteCache)]);

      console.log('🐘 [BI Ciclo Operacional] Cache no Supabase atualizado com sucesso.');
    } catch (errPg) {
      console.warn('⚠️ [BI Ciclo Operacional] Aviso ao salvar no PostgreSQL (fallback JSON mantido):', errPg.message);
    }
  }

  return pacoteCache;
}

/**
 * 4. LEITURA RÁPIDA DE CACHE (< 100ms)
 */
async function obterDadosCicloOperacional() {
  // Tenta ler do PostgreSQL primeiro
  if (isPostgresConnected()) {
    try {
      const pool = getPool();
      const res = await pool.query(`SELECT payload FROM bi_ciclo_operacional_cache WHERE chave = 'padrao' LIMIT 1;`);
      if (res.rows.length > 0 && res.rows[0].payload) {
        return res.rows[0].payload;
      }
    } catch (errPg) {
      console.warn('⚠️ [BI Ciclo Operacional] PostgreSQL indisponível para leitura rápida, lendo JSON:', errPg.message);
    }
  }

  // Fallback JSON
  if (fs.existsSync(cicloCacheFile)) {
    try {
      const content = await fs.promises.readFile(cicloCacheFile, 'utf-8');
      return JSON.parse(content);
    } catch (errJson) {
      console.error('❌ [BI Ciclo Operacional] Erro ao ler JSON de cache:', errJson.message);
    }
  }

  // Se nenhum cache existir, retorna estrutura padrão com zeros
  return {
    atualizado_em: null,
    diasPeriodo: 365,
    calculados: calcularCicloOperacionalIndices({ diasPeriodo: 365 }),
    detalhes: { estoqueTop: [], receberTop: [], pagarTop: [] }
  };
}

module.exports = {
  EMPRESAS_CICLO,
  roundVal,
  roundDays,
  calcularCicloOperacionalIndices,
  extrairDadosCicloOperacionalProtheus,
  sincronizarCicloOperacionalCompleto,
  obterDadosCicloOperacional
};
