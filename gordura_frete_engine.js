/**
 * gordura_frete_engine.js
 * 
 * Motor de Fechamento e Análise de Gordura de Frete para Vendedores (Plataforma de Apoio GSI)
 * Empresas: Metal Pleno (140), GSI (150), OACO (160)
 * 
 * Regra de Negócio:
 * - Ciclo Mensal Padrão: Dia 26 do mês anterior a dia 25 do mês atual.
 * - Frete Cobrado do Cliente: COBCLI = C5_FRETE (Adicional) + C5_VLR_FRT (Embutido).
 * - Custo do Frete da Transportadora: SF1.F1_VALMERC (ou F1_VALBRUT).
 * - Gordura de Frete: COBCLI - Custo da Transportadora.
 * - Superávit: Gordura > 0 (Verde).
 * - Déficit: Gordura < 0 (Vermelho).
 */

const { executeRailwayQuery, getNomeVendedor, VENDEDORES_MAP } = require('./protheus_db');

const EMPRESAS_CONFIG = {
  '14': { sufixo: '140', nome: 'METAL PLENO', sigla: 'MP', filial: '01' },
  '140': { sufixo: '140', nome: 'METAL PLENO', sigla: 'MP', filial: '01' },
  '15': { sufixo: '150', nome: 'GSI', sigla: 'GSI', filial: '01' },
  '150': { sufixo: '150', nome: 'GSI', sigla: 'GSI', filial: '01' },
  '16': { sufixo: '160', nome: 'OACO', sigla: 'OACO', filial: '01' },
  '160': { sufixo: '160', nome: 'OACO', sigla: 'OACO', filial: '01' }
};

/**
 * Sanitiza parâmetros contra injeção SQL
 */
function sanitizeSqlParam(param) {
  if (param === null || param === undefined) return '';
  return String(param).replace(/['";\\]/g, '').trim();
}

/**
 * Arredonda valor para 2 casas decimais
 */
function roundVal(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Formata data no padrão YYYYMMDD para DD/MM/YYYY
 */
function formatarDataBR(dtStr) {
  if (!dtStr) return '-';
  const s = String(dtStr).replace(/\D/g, '');
  if (s.length === 8) {
    return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  }
  return dtStr;
}

/**
 * Calcula o ciclo de fechamento padrão (26 do mês anterior a 25 do mês atual)
 * @param {Date|string} [refDate] Data de referência (opcional, default = hoje)
 * @returns {{ dtIni: string, dtFim: string, dataIniBR: string, dataFimBR: string, label: string }}
 */
function calcularCicloPadrao(refDate) {
  const d = refDate ? new Date(refDate) : new Date();
  
  // Data atual em timezone de Brasília / local
  const ano = d.getFullYear();
  const mes = d.getMonth(); // 0-indexed (0 = Jan, 8 = Set)
  const dia = d.getDate();

  let startYear, startMonth, endYear, endMonth;

  if (dia <= 25) {
    // Ciclo atual: 26 do mês anterior até 25 do mês atual
    const prevDate = new Date(ano, mes - 1, 26);
    startYear = prevDate.getFullYear();
    startMonth = prevDate.getMonth();
    endYear = ano;
    endMonth = mes;
  } else {
    // Ciclo atual: 26 do mês atual até 25 do mês seguinte
    startYear = ano;
    startMonth = mes;
    const nextDate = new Date(ano, mes + 1, 25);
    endYear = nextDate.getFullYear();
    endMonth = nextDate.getMonth();
  }

  const pad = (n) => String(n).padStart(2, '0');

  const dtIni = `${startYear}${pad(startMonth + 1)}26`;
  const dtFim = `${endYear}${pad(endMonth + 1)}25`;

  const dataIniBR = `26/${pad(startMonth + 1)}/${startYear}`;
  const dataFimBR = `25/${pad(endMonth + 1)}/${endYear}`;

  return {
    dtIni,
    dtFim,
    dataIniIso: `${startYear}-${pad(startMonth + 1)}-26`,
    dataFimIso: `${endYear}-${pad(endMonth + 1)}-25`,
    dataIniBR,
    dataFimBR,
    label: `${dataIniBR} a ${dataFimBR}`
  };
}

/**
 * Retorna os 3 últimos ciclos de fechamento pré-calculados
 */
function obterCiclosPredefinidos(refDate) {
  const d = refDate ? new Date(refDate) : new Date();
  const ciclos = [];

  // Ciclo 0 (Atual)
  const c0 = calcularCicloPadrao(d);
  ciclos.push({
    id: 'atual',
    nome: `Ciclo Atual (${c0.label})`,
    ...c0
  });

  // Ciclo -1 (Anterior)
  const basePrev1 = new Date(c0.dataIniIso);
  basePrev1.setDate(basePrev1.getDate() - 5); // cai dentro do ciclo anterior
  const c1 = calcularCicloPadrao(basePrev1);
  ciclos.push({
    id: 'anterior',
    nome: `Ciclo Anterior (${c1.label})`,
    ...c1
  });

  // Ciclo -2 (2 Ciclos Atrás)
  const basePrev2 = new Date(c1.dataIniIso);
  basePrev2.setDate(basePrev2.getDate() - 5);
  const c2 = calcularCicloPadrao(basePrev2);
  ciclos.push({
    id: 'dois_anteriores',
    nome: `2 Ciclos Atrás (${c2.label})`,
    ...c2
  });

  return ciclos;
}

/**
 * Monta a query T-SQL para consulta de Gordura de Frete no Protheus
 * Aplica OUTER APPLY com DISTINCT D2_PEDIDO para garantir que notas com múltiplos itens
 * não dupliquem os valores de C5_FRETE e C5_VLR_FRT.
 */
function buildGorduraFreteSql(sufixo, nomeEmpresa, dtIni, dtFim, codVend) {
  const cleanVend = sanitizeSqlParam(codVend || '');
  const paddedVend6 = cleanVend ? cleanVend.padStart(6, '0') : '';

  let vendFilter = '';
  if (cleanVend) {
    vendFilter = `AND (RTRIM(SF2.F2_VEND1) = '${cleanVend}' OR RTRIM(SF2.F2_VEND1) = '${paddedVend6}')`;
  }

  return `
SELECT 
    'SAIDA' AS [Tipo da nota],
    RTRIM(SF1.F1_DOC) AS [Conhecimento],
    RTRIM(SF1.F1_SERIE) AS [Serie Conhe.],
    RTRIM(SF1.F1_EMISSAO) AS [Data],
    ISNULL(RTRIM(SA1.A1_NREDUZ), '') AS [Cli/For],
    ISNULL(RTRIM(SA3.A3_NREDUZ), '') AS [Vendedor],
    RTRIM(ISNULL(SF2.F2_VEND1, '')) AS [CodVendedor],
    ISNULL(PED.PEDIDOS, '') AS [PV/PC],
    ISNULL(PED.FRETE, 0.00) AS [Frete],
    ISNULL(PED.FRETE2, 0.00) AS [Frete2],
    (ISNULL(PED.FRETE, 0.00) + ISNULL(PED.FRETE2, 0.00)) AS [COBCLI],
    ISNULL(SF1.F1_VALMERC, ISNULL(SF1.F1_VALBRUT, 0.00)) AS [Valor],
    RTRIM(SF2.F2_DOC) AS [Nota fiscal],
    RTRIM(SF2.F2_SERIE) AS [Serie],
    ISNULL(RTRIM(SA2.A2_NREDUZ), '') AS [Transportadora],
    '${nomeEmpresa}' AS [Empresa]
FROM SF1${sufixo} SF1
INNER JOIN SF2${sufixo} SF2 ON RTRIM(SF2.F2_COFRETE) = RTRIM(SF1.F1_DOC) AND SF2.D_E_L_E_T_ = ' '
LEFT JOIN SA2010 SA2 ON SA2.A2_COD = SF1.F1_FORNECE AND SA2.A2_LOJA = SF1.F1_LOJA AND SA2.D_E_L_E_T_ = ' '
LEFT JOIN SA1010 SA1 ON SA1.A1_COD = SF2.F2_CLIENTE AND SA1.A1_LOJA = SF2.F2_LOJA AND SA1.D_E_L_E_T_ = ' '
LEFT JOIN SA3010 SA3 ON SA3.A3_COD = SF2.F2_VEND1 AND SA3.D_E_L_E_T_ = ' '
OUTER APPLY (
    SELECT 
        SUM(SC5.C5_FRETE) AS FRETE,
        SUM(SC5.C5_VLR_FRT) AS FRETE2,
        STRING_AGG(RTRIM(PED_DIST.D2_PEDIDO), ', ') AS PEDIDOS
    FROM (
        SELECT DISTINCT D2_PEDIDO, D2_FILIAL 
        FROM SD2${sufixo} 
        WHERE D2_DOC = SF2.F2_DOC 
          AND D2_SERIE = SF2.F2_SERIE 
          AND D2_CLIENTE = SF2.F2_CLIENTE
          AND D_E_L_E_T_ = ' '
    ) PED_DIST
    INNER JOIN SC5${sufixo} SC5 ON RTRIM(SC5.C5_NUM) = RTRIM(PED_DIST.D2_PEDIDO) AND SC5.C5_FILIAL = PED_DIST.D2_FILIAL AND SC5.D_E_L_E_T_ = ' '
) PED
WHERE SF1.D_E_L_E_T_ = ' '
  AND SF1.F1_ESPECIE = 'CTR'
  AND SF1.F1_PREFIXO = 'FRE'
  AND SF1.F1_EMISSAO BETWEEN '${dtIni}' AND '${dtFim}'
  ${vendFilter}
ORDER BY SF1.F1_EMISSAO DESC, SF1.F1_DOC ASC
`;
}

/**
 * Consulta o relatório de Gordura de Frete para Vendedores
 * @param {Object} params
 * @param {string} params.dataIni Data inicial no formato YYYY-MM-DD ou YYYYMMDD
 * @param {string} params.dataFim Data final no formato YYYY-MM-DD ou YYYYMMDD
 * @param {string} [params.empresa] '14', '15', '16', 'MP', 'GSI', 'OACO', ou 'TODAS'
 * @param {string} [params.codVend] Código do vendedor Protheus (ex: '000074')
 */
async function consultarGorduraFrete({ dataIni, dataFim, empresa, codVend } = {}) {
  let cleanDataIni = String(dataIni || '').replace(/\D/g, '');
  let cleanDataFim = String(dataFim || '').replace(/\D/g, '');

  // Fallback para o ciclo padrão caso datas não sejam informadas
  if (!cleanDataIni || !cleanDataFim) {
    const cicloDefault = calcularCicloPadrao();
    cleanDataIni = cicloDefault.dtIni;
    cleanDataFim = cicloDefault.dtFim;
  }

  // Trava de segurança contra sobrecarga: máx 95 dias (~3 períodos)
  const d1 = new Date(
    parseInt(cleanDataIni.slice(0, 4)),
    parseInt(cleanDataIni.slice(4, 6)) - 1,
    parseInt(cleanDataIni.slice(6, 8))
  );
  const d2 = new Date(
    parseInt(cleanDataFim.slice(0, 4)),
    parseInt(cleanDataFim.slice(4, 6)) - 1,
    parseInt(cleanDataFim.slice(6, 8))
  );

  const diffMs = Math.abs(d2 - d1);
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 95) {
    throw new Error('O intervalo entre as datas não pode ser superior a 95 dias (máximo de 3 períodos) para proteger a performance do banco Protheus.');
  }

  const cleanEmpresa = sanitizeSqlParam(empresa || '').toUpperCase();
  const cleanCodVend = sanitizeSqlParam(codVend || '');

  // Empresas a consultar
  let empresasParaConsultar = ['14', '15', '16'];
  if (cleanEmpresa && cleanEmpresa !== 'TODAS' && cleanEmpresa !== 'TODOS') {
    if (cleanEmpresa === 'MP' || cleanEmpresa === '14' || cleanEmpresa === '140' || cleanEmpresa === 'METAL_PLENO') {
      empresasParaConsultar = ['14'];
    } else if (cleanEmpresa === 'GSI' || cleanEmpresa === '15' || cleanEmpresa === '150') {
      empresasParaConsultar = ['15'];
    } else if (cleanEmpresa === 'OACO' || cleanEmpresa === '16' || cleanEmpresa === '160') {
      empresasParaConsultar = ['16'];
    }
  }

  const allRows = [];

  for (const empCode of empresasParaConsultar) {
    const cfg = EMPRESAS_CONFIG[empCode];
    if (!cfg) continue;

    const sql = buildGorduraFreteSql(cfg.sufixo, cfg.nome, cleanDataIni, cleanDataFim, cleanCodVend);

    try {
      const dbRes = await executeRailwayQuery(sql);
      const rows = (dbRes && dbRes.rows) ? dbRes.rows : [];

      for (const r of rows) {
        const freteCob = roundVal(r['COBCLI'] !== undefined ? r['COBCLI'] : (parseFloat(r['Frete'] || 0) + parseFloat(r['Frete2'] || 0)));
        const freteAdic = roundVal(r['Frete'] || 0);
        const freteEmbut = roundVal(r['Frete2'] || 0);
        const custoReal = roundVal(r['Valor'] || 0);
        const gordura = roundVal(freteCob - custoReal);
        const pctGordura = freteCob > 0 ? roundVal((gordura / freteCob) * 100) : (custoReal > 0 ? -100 : 0);

        const vCode = r['CodVendedor'] || '';
        const nomeVend = r['Vendedor'] || getNomeVendedor(vCode) || vCode || '-';

        allRows.push({
          empresa: cfg.nome,
          empresaSigla: cfg.sigla,
          tipoNota: r['Tipo da nota'] || 'SAIDA',
          conhecimento: r['Conhecimento'] || '-',
          serieConhe: r['Serie Conhe.'] || '',
          dataEmissao: r['Data'] || '',
          dataEmissaoFormatada: formatarDataBR(r['Data']),
          cliente: r['Cli/For'] || '-',
          vendedor: nomeVend,
          codVendedor: vCode,
          pedidoVenda: r['PV/PC'] || '-',
          notaFiscal: r['Nota fiscal'] || '-',
          serieNF: r['Serie'] || '',
          transportadora: r['Transportadora'] || '-',
          freteAdicional: freteAdic,
          freteEmbutido: freteEmbut,
          freteCobradoCliente: freteCob,
          custoFreteReal: custoReal,
          gorduraFrete: gordura,
          percentualGordura: pctGordura,
          statusGordura: gordura > 0 ? 'SUPERAVIT' : (gordura < 0 ? 'DEFICIT' : 'NEUTRO')
        });
      }
    } catch (err) {
      console.warn(`⚠️ [GorduraFrete] Erro ao consultar empresa ${cfg.nome}:`, err.message);
    }
  }

  // Ordenação: data mais recente primeiro, depois número da nota
  allRows.sort((a, b) => (b.dataEmissao || '').localeCompare(a.dataEmissao || '') || (b.conhecimento || '').localeCompare(a.conhecimento || ''));

  // Cálculo de KPIs Consolidados do Período
  const totalFreteCobrado = roundVal(allRows.reduce((acc, row) => acc + row.freteCobradoCliente, 0));
  const totalCustoFrete = roundVal(allRows.reduce((acc, row) => acc + row.custoFreteReal, 0));
  const totalGordura = roundVal(totalFreteCobrado - totalCustoFrete);
  const percentualMargemGeral = totalFreteCobrado > 0 ? roundVal((totalGordura / totalFreteCobrado) * 100) : 0;

  const totalSuperavit = allRows.filter(r => r.gorduraFrete > 0).length;
  const totalDeficit = allRows.filter(r => r.gorduraFrete < 0).length;
  const totalNeutro = allRows.filter(r => r.gorduraFrete === 0).length;

  return {
    kpis: {
      totalFreteCobrado,
      totalCustoFrete,
      totalGordura,
      percentualMargemGeral,
      totalConhecimentos: allRows.length,
      totalSuperavit,
      totalDeficit,
      totalNeutro
    },
    periodo: {
      dataIni: cleanDataIni,
      dataFim: cleanDataFim,
      dataIniBR: formatarDataBR(cleanDataIni),
      dataFimBR: formatarDataBR(cleanDataFim)
    },
    dados: allRows,
    totalRegistros: allRows.length
  };
}

module.exports = {
  consultarGorduraFrete,
  calcularCicloPadrao,
  obterCiclosPredefinidos,
  buildGorduraFreteSql,
  EMPRESAS_CONFIG
};
