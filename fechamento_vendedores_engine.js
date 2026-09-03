/**
 * fechamento_vendedores_engine.js
 * 
 * Motor de Fechamento Comercial e Financeiro Mensal dos Vendedores (Plataforma de Apoio GSI)
 * Empresas: Metal Pleno (140), GSI (150), OACO (160)
 * 
 * Regras de Negócio e Fórmulas:
 * 1. Ciclo Mensal Padrão: Dia 26 do mês anterior a dia 25 do mês atual.
 * 2. Venda Base Bruta: Soma de E3_BASE das comissões faturadas no período (SE3).
 * 3. Fretes Embutidos: Soma de SC5.C5_VLR_FRT dos pedidos faturados do vendedor no período (deduzido com deduplicação OUTER APPLY).
 * 4. Venda Base Líquida: Venda Base Bruta - Fretes Embutidos.
 * 5. Inadimplentes: Soma de títulos SE1 em aberto (E1_SALDO > 0.01) vencidos até a data de fechamento.
 * 6. R$ Comissões (1,3%): max(0, (Venda Base Líquida * 0.013) - Inadimplentes).
 * 7. Prêmio Metas Vendas (Base R$ 120k):
 *    - >= 100% (R$ 120.000): R$ 400,00
 *    - >= 150% (R$ 180.000): R$ 600,00
 *    - >= 200% (R$ 240.000): R$ 1.000,00
 * 8. Prêmio Gordura de Frete:
 *    - >= R$ 700: R$ 200,00
 *    - >= R$ 1.100: R$ 300,00
 *    - >= R$ 1.500: R$ 400,00
 *    - >= R$ 2.100: R$ 500,00
 *    - >= R$ 3.000: R$ 600,00
 * 9. Total Geral a Receber: Comissão Líquida + Total de Prêmios.
 * 10. Faturamento por Empresa e Benchmarking da Equipe.
 * 11. Snapshot Imutável de Metas no ato da gravação no banco de dados.
 */

const { executeRailwayQuery, getNomeVendedor, VENDEDORES_MAP } = require('./protheus_db');
const { consultarGorduraFrete } = require('./gordura_frete_engine');
const {
  getConfigMetasVendasDB,
  saveConfigMetasVendasDB,
  salvarFechamentoVendedorDB,
  obterFechamentoPorCicloEVendedorDB,
  obterFechamentosPorCicloDB,
  obterUltimosFechamentosDB,
  DEFAULT_METAS_VENDAS
} = require('./postgres_db');

const EMPRESAS_FECHAMENTO = [
  { cod: '14', sigla: 'MP', nome: 'METAL PLENO', se3: 'SE3140', sf2: 'SF2140', sd2: 'SD2140', sc5: 'SC5140', se1: 'SE1140' },
  { cod: '15', sigla: 'GSI', nome: 'GSI', se3: 'SE3150', sf2: 'SF2150', sd2: 'SD2150', sc5: 'SC5150', se1: 'SE1150' },
  { cod: '16', sigla: 'OACO', nome: 'OACO', se3: 'SE3160', sf2: 'SF2160', sd2: 'SD2160', sc5: 'SC5160', se1: 'SE1160' }
];

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
 * Determina o ciclo de fechamento oficial disponível para exibição na tela
 * Regra Temporal:
 * - Até o dia 25 do mês corrente (23:59:59), o fechamento disponível é o ciclo que terminou no dia 25 do mês anterior.
 * - No dia 26 a partir das 00:30, o fechamento disponível passa a ser o ciclo que terminou no dia 25 do mês corrente.
 * 
 * @param {Date|string} [refDate] Data de referência (default: agora em fuso de Brasília)
 */
function calcularCicloFechamentoDisponivel(refDate) {
  let d;
  if (refDate) {
    d = new Date(refDate);
  } else {
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    d = new Date(nowStr);
  }

  const ano = d.getFullYear();
  const mes = d.getMonth(); // 0 = Jan, ..., 7 = Ago, 8 = Set
  const dia = d.getDate();
  const hora = d.getHours();
  const minuto = d.getMinutes();

  let startYear, startMonth, endYear, endMonth;

  // Se dia for < 26 OU (dia == 26 e hora == 0 e minuto < 30) -> Ciclo disponível é o anterior ao mês passado
  const isAposFechamentoDia26 = (dia > 26) || (dia === 26 && (hora > 0 || minuto >= 30));

  if (!isAposFechamentoDia26) {
    // Ex: Em 10/09 (ou 26/08 antes das 00:30), o último fechamento concluído foi 26/07 a 25/08 (mes - 1)
    const prevEnd = new Date(ano, mes - 1, 25);
    const prevStart = new Date(ano, mes - 2, 26);
    startYear = prevStart.getFullYear();
    startMonth = prevStart.getMonth();
    endYear = prevEnd.getFullYear();
    endMonth = prevEnd.getMonth();
  } else {
    // Ex: Em 26/08 às 00:30 até 25/09, o fechamento gerado é 26/07 a 25/08
    const prevEnd = new Date(ano, mes, 25);
    const prevStart = new Date(ano, mes - 1, 26);
    startYear = prevStart.getFullYear();
    startMonth = prevStart.getMonth();
    endYear = prevEnd.getFullYear();
    endMonth = prevEnd.getMonth();
  }

  const pad = (n) => String(n).padStart(2, '0');

  const dtIni = `${startYear}${pad(startMonth + 1)}26`;
  const dtFim = `${endYear}${pad(endMonth + 1)}25`;
  const dataIniIso = `${startYear}-${pad(startMonth + 1)}-26`;
  const dataFimIso = `${endYear}-${pad(endMonth + 1)}-25`;
  const dataIniBR = `26/${pad(startMonth + 1)}/${startYear}`;
  const dataFimBR = `25/${pad(endMonth + 1)}/${endYear}`;
  const cicloId = `${dataIniIso}_${dataFimIso}`;
  const label = `${dataIniBR} a ${dataFimBR}`;

  return {
    cicloId,
    dtIni,
    dtFim,
    dataIniIso,
    dataFimIso,
    dataIniBR,
    dataFimBR,
    label,
    mesCompetencia: `${pad(endMonth + 1)}/${endYear}`
  };
}

/**
 * Converte datas livres em objeto de período estruturado
 */
function normalizarPeriodo(dataIni, dataFim) {
  let cleanIni = String(dataIni || '').replace(/\D/g, '');
  let cleanFim = String(dataFim || '').replace(/\D/g, '');

  if (!cleanIni || !cleanFim) {
    return calcularCicloFechamentoDisponivel();
  }

  const dataIniIso = `${cleanIni.slice(0, 4)}-${cleanIni.slice(4, 6)}-${cleanIni.slice(6, 8)}`;
  const dataFimIso = `${cleanFim.slice(0, 4)}-${cleanFim.slice(4, 6)}-${cleanFim.slice(6, 8)}`;
  const dataIniBR = `${cleanIni.slice(6, 8)}/${cleanIni.slice(4, 6)}/${cleanIni.slice(0, 4)}`;
  const dataFimBR = `${cleanFim.slice(6, 8)}/${cleanFim.slice(4, 6)}/${cleanFim.slice(0, 4)}`;

  return {
    cicloId: `${dataIniIso}_${dataFimIso}`,
    dtIni: cleanIni,
    dtFim: cleanFim,
    dataIniIso,
    dataFimIso,
    dataIniBR,
    dataFimBR,
    label: `${dataIniBR} a ${dataFimBR}`
  };
}

/**
 * Consulta Vendas e Base de Comissões no Protheus (SE3)
 */
async function buscarVendasComissoesPeriodo({ dataIni, dataFim, codVend } = {}) {
  const cleanDataIni = String(dataIni || '').replace(/\D/g, '');
  const cleanDataFim = String(dataFim || '').replace(/\D/g, '');
  const cleanVend = sanitizeSqlParam(codVend || '');
  const paddedVend6 = cleanVend ? cleanVend.padStart(6, '0') : '';

  const results = [];
  const porEmpresa = { GSI: 0, OACO: 0, METAL_PLENO: 0, TOTAL: 0 };

  for (const emp of EMPRESAS_FECHAMENTO) {
    try {
      let vendFilter = '';
      if (cleanVend) {
        vendFilter = `AND (RTRIM(E3.E3_VEND) = '${cleanVend}' OR RTRIM(E3.E3_VEND) = '${paddedVend6}')`;
      }

      const sql = `
        SELECT
          RTRIM(E3.E3_VEND) AS E3_VEND,
          RTRIM(E3.E3_EMISSAO) AS E3_EMISSAO,
          RTRIM(E3.E3_PEDIDO) AS E3_PEDIDO,
          RTRIM(E3.E3_NUM) AS E3_NUM,
          RTRIM(E3.E3_SERIE) AS E3_SERIE,
          RTRIM(E3.E3_CODCLI) AS E3_CODCLI,
          RTRIM(ISNULL(A1.A1_NOME, '')) AS NOME_CLIENTE,
          ISNULL(E3.E3_BASE, 0) AS E3_BASE,
          ISNULL(E3.E3_PORC, 0) AS E3_PORC,
          ISNULL(E3.E3_COMIS, 0) AS E3_COMIS
        FROM ${emp.se3} E3
        LEFT JOIN SA1010 A1
          ON (A1.A1_COD = E3.E3_CODCLI OR A1.A1_COD = RIGHT('000000' + RTRIM(E3.E3_CODCLI), 6))
         AND A1.D_E_L_E_T_ = ' '
        WHERE E3.E3_EMISSAO >= '${cleanDataIni}'
          AND E3.E3_EMISSAO <= '${cleanDataFim}'
          ${vendFilter}
          AND E3.D_E_L_E_T_ = ' '
        ORDER BY E3.E3_EMISSAO DESC;
      `;

      const dbRes = await executeRailwayQuery(sql);
      const rows = dbRes && dbRes.rows ? dbRes.rows : [];

      for (const r of rows) {
        const vBase = roundVal(r.E3_BASE || 0);
        const vComis = roundVal(r.E3_COMIS || 0);
        const vCode = (r.E3_VEND || '').trim();
        const nomeVend = getNomeVendedor(vCode) || vCode || '-';

        if (emp.sigla === 'GSI') porEmpresa.GSI = roundVal(porEmpresa.GSI + vBase);
        else if (emp.sigla === 'OACO') porEmpresa.OACO = roundVal(porEmpresa.OACO + vBase);
        else if (emp.sigla === 'MP') porEmpresa.METAL_PLENO = roundVal(porEmpresa.METAL_PLENO + vBase);

        results.push({
          empresa: emp.nome,
          empresaSigla: emp.sigla,
          codVend: vCode,
          nomeVendedor: nomeVend,
          emissao: r.E3_EMISSAO,
          pedido: (r.E3_PEDIDO || '').trim() || '-',
          notaFiscal: (r.E3_NUM || '').trim() || '-',
          serie: (r.E3_SERIE || '').trim(),
          cliente: (r.E3_CODCLI || '').trim(),
          nomeCliente: (r.NOME_CLIENTE || '').trim(),
          valorBase: vBase,
          percComis: roundVal(r.E3_PORC || 0),
          valorComis: vComis
        });
      }
    } catch (err) {
      console.warn(`⚠️ [Fechamento] Erro ao buscar vendas/comissões em ${emp.nome}:`, err.message);
    }
  }

  porEmpresa.TOTAL = roundVal(porEmpresa.GSI + porEmpresa.OACO + porEmpresa.METAL_PLENO);
  const totalBase = roundVal(results.reduce((acc, x) => acc + x.valorBase, 0));
  const totalComis = roundVal(results.reduce((acc, x) => acc + x.valorComis, 0));

  return {
    itens: results,
    totalBase,
    totalComis,
    porEmpresa
  };
}

/**
 * Consulta Fretes Embutidos (C5_VLR_FRT) nos pedidos de venda faturados do vendedor no período
 * Consulta a tabela SE3 (Comissões Faturadas que compõem a Venda Base Bruta) deduplicando por
 * pedido de venda (E3_PEDIDO) e cruzando com SC5 (C5_VLR_FRT) para assegurar perfeita paridade
 * com a Aba Comissões e evitar deduzir fretes de operações não comerciais (ex: conserto/troca).
 */
async function buscarFretesEmbutidosPeriodo({ dataIni, dataFim, codVend } = {}) {
  const cleanDataIni = String(dataIni || '').replace(/\D/g, '');
  const cleanDataFim = String(dataFim || '').replace(/\D/g, '');
  const cleanVend = sanitizeSqlParam(codVend || '');
  const paddedVend6 = cleanVend ? cleanVend.padStart(6, '0') : '';

  let totalFreteEmbutido = 0;
  const pedidosComFrete = [];

  for (const emp of EMPRESAS_FECHAMENTO) {
    try {
      let vendFilter = '';
      if (cleanVend) {
        vendFilter = `AND (RTRIM(E3.E3_VEND) = '${cleanVend}' OR RTRIM(E3.E3_VEND) = '${paddedVend6}')`;
      }

      const sql = `
        SELECT 
          RTRIM(PED.E3_PEDIDO) AS PEDIDO,
          RTRIM(PED.EMISSAO) AS EMISSAO,
          RTRIM(PED.E3_VEND) AS VENDEDOR,
          RTRIM(PED.E3_NUM) AS NOTA,
          RTRIM(PED.E3_SERIE) AS SERIE,
          ISNULL(SC5.C5_VLR_FRT, 0.00) AS FRETE_EMBUTIDO,
          ISNULL(SC5.C5_FRETE, 0.00) AS FRETE_COBRADO
        FROM (
          SELECT 
            E3_PEDIDO,
            E3_VEND,
            MAX(E3_NUM) AS E3_NUM,
            MAX(E3_SERIE) AS E3_SERIE,
            MAX(E3_EMISSAO) AS EMISSAO
          FROM ${emp.se3} E3
          WHERE E3.E3_EMISSAO >= '${cleanDataIni}'
            AND E3.E3_EMISSAO <= '${cleanDataFim}'
            ${vendFilter}
            AND E3.D_E_L_E_T_ = ' '
            AND RTRIM(E3.E3_PEDIDO) <> ''
          GROUP BY E3_PEDIDO, E3_VEND
        ) PED
        INNER JOIN ${emp.sc5} SC5
          ON (SC5.C5_NUM = PED.E3_PEDIDO OR SC5.C5_NUM = RIGHT('000000' + RTRIM(PED.E3_PEDIDO), 6))
         AND SC5.D_E_L_E_T_ = ' '
        WHERE ISNULL(SC5.C5_VLR_FRT, 0) > 0;
      `;

      const dbRes = await executeRailwayQuery(sql);
      const rows = dbRes && dbRes.rows ? dbRes.rows : [];

      for (const r of rows) {
        const frtEmb = roundVal(r.FRETE_EMBUTIDO || 0);
        totalFreteEmbutido = roundVal(totalFreteEmbutido + frtEmb);
        pedidosComFrete.push({
          empresa: emp.nome,
          empresaSigla: emp.sigla,
          nota: r.NOTA,
          serie: r.SERIE,
          emissao: r.EMISSAO,
          vendedor: r.VENDEDOR,
          pedidos: r.PEDIDO,
          freteEmbutido: frtEmb
        });
      }
    } catch (err) {
      console.warn(`⚠️ [Fechamento] Erro ao buscar fretes embutidos em ${emp.nome}:`, err.message);
    }
  }

  return {
    totalFreteEmbutido: roundVal(totalFreteEmbutido),
    pedidosComFrete
  };
}

/**
 * Consulta Títulos Inadimplentes Vencidos do Vendedor no Período (SE1)
 * Regra: Títulos com E1_SALDO > 0.01, E1_BAIXA vazio e vencimento dentro do período do fechamento (dataIni a dataFim)
 */
async function buscarInadimplentesPeriodo({ dataIni, dataFim, codVend } = {}) {
  const cleanDataIni = String(dataIni || '').replace(/\D/g, '');
  const cleanDataFim = String(dataFim || '').replace(/\D/g, '');
  const cleanVend = sanitizeSqlParam(codVend || '');
  const paddedVend6 = cleanVend ? cleanVend.padStart(6, '0') : '';

  let totalInadimplente = 0;
  const titulosInadimplentes = [];

  for (const emp of EMPRESAS_FECHAMENTO) {
    try {
      let vendFilter = '';
      if (cleanVend) {
        vendFilter = `AND (RTRIM(E1.E1_VEND1) = '${cleanVend}' OR RTRIM(E1.E1_VEND1) = '${paddedVend6}')`;
      }

      let dateFilter = '';
      if (cleanDataIni && cleanDataFim) {
        dateFilter = `AND ((E1.E1_VENCREA >= '${cleanDataIni}' AND E1.E1_VENCREA <= '${cleanDataFim}') OR (E1.E1_VENCREA = '' AND E1.E1_VENCTO >= '${cleanDataIni}' AND E1.E1_VENCTO <= '${cleanDataFim}'))`;
      } else if (cleanDataFim) {
        dateFilter = `AND (E1.E1_VENCREA <= '${cleanDataFim}' OR E1.E1_VENCTO <= '${cleanDataFim}')`;
      }

      const sql = `
        SELECT 
          RTRIM(E1.E1_PREFIXO) AS PREFIXO,
          RTRIM(E1.E1_NUM) AS NUM,
          RTRIM(E1.E1_PARCELA) AS PARCELA,
          RTRIM(E1.E1_TIPO) AS TIPO,
          ISNULL(E1.E1_VALOR, 0) AS VALOR,
          ISNULL(E1.E1_SALDO, 0) AS SALDO,
          RTRIM(E1.E1_CLIENTE) AS COD_CLIENTE,
          RTRIM(ISNULL(E1.E1_NOMCLI, '')) AS NOME_CLIENTE,
          RTRIM(E1.E1_EMISSAO) AS EMISSAO,
          RTRIM(E1.E1_VENCTO) AS VENCTO,
          RTRIM(E1.E1_VENCREA) AS VENCREA
        FROM ${emp.se1} E1
        WHERE (E1.E1_BAIXA = '' OR E1.E1_BAIXA IS NULL)
          AND E1.E1_SALDO > 0.01
          ${dateFilter}
          ${vendFilter}
          AND E1.D_E_L_E_T_ = ' '
        ORDER BY E1.E1_VENCREA ASC;
      `;

      const dbRes = await executeRailwayQuery(sql);
      const rows = dbRes && dbRes.rows ? dbRes.rows : [];

      for (const r of rows) {
        const saldo = roundVal(r.SALDO || 0);
        totalInadimplente = roundVal(totalInadimplente + saldo);
        titulosInadimplentes.push({
          empresa: emp.nome,
          empresaSigla: emp.sigla,
          prefixo: r.PREFIXO,
          num: r.NUM,
          parcela: r.PARCELA,
          tipo: r.TIPO,
          valor: roundVal(r.VALOR || 0),
          saldo: saldo,
          codCliente: r.COD_CLIENTE,
          nomeCliente: r.NOME_CLIENTE,
          emissao: r.EMISSAO,
          vencto: r.VENCTO,
          vencrea: r.VENCREA
        });
      }
    } catch (err) {
      console.warn(`⚠️ [Fechamento] Erro ao buscar inadimplentes em ${emp.nome}:`, err.message);
    }
  }

  return {
    totalInadimplente: roundVal(totalInadimplente),
    titulosInadimplentes
  };
}

/**
 * Calcula Metas e Premiações (Vendas e Gordura de Frete) com base nas configurações vigentes
 */
function calcularMetasEPremios(params = {}) {
  const cfg = params.configMetas || params.metasConfig || DEFAULT_METAS_VENDAS;
  const metaBase = parseFloat(cfg.metaBaseVendas) || 120000;

  // 1. Meta de Vendas
  const vLiquida = roundVal(params.vendaBaseLiquida ?? params.vendasBaseLiquida ?? 0);
  const pctMetaVendas = metaBase > 0 ? roundVal((vLiquida / metaBase) * 100) : 0;

  let premioMetaVendas = 0;
  let faixaMetaVendas = 'Não Atingida (< 100%)';
  let metaVendasStatus = 'NAO_ATINGIDA';

  if (vLiquida >= metaBase * 2.0) {
    premioMetaVendas = parseFloat(cfg.premioMeta200) || 1000;
    faixaMetaVendas = '>= 200% da Meta';
    metaVendasStatus = 'BATEU_200';
  } else if (vLiquida >= metaBase * 1.5) {
    premioMetaVendas = parseFloat(cfg.premioMeta150) || 600;
    faixaMetaVendas = '>= 150% da Meta';
    metaVendasStatus = 'BATEU_150';
  } else if (vLiquida >= metaBase * 1.0) {
    premioMetaVendas = parseFloat(cfg.premioMeta100) || 400;
    faixaMetaVendas = '>= 100% da Meta';
    metaVendasStatus = 'BATEU_100';
  }

  // 2. Meta de Gordura de Frete
  const gFrete = roundVal(params.gorduraFreteTotal ?? 0);
  let premioGorduraFrete = 0;
  let faixaGorduraFrete = 'Sem Premiação (< R$ 700)';
  let gorduraStatus = 'SEM_PREMIO';

  if (gFrete >= 3000) {
    premioGorduraFrete = parseFloat(cfg.premioGordura3000) || 600;
    faixaGorduraFrete = '>= R$ 3.000,00';
    gorduraStatus = 'NIVEL_5';
  } else if (gFrete >= 2100) {
    premioGorduraFrete = parseFloat(cfg.premioGordura2100) || 500;
    faixaGorduraFrete = '>= R$ 2.100,00';
    gorduraStatus = 'NIVEL_4';
  } else if (gFrete >= 1500) {
    premioGorduraFrete = parseFloat(cfg.premioGordura1500) || 400;
    faixaGorduraFrete = '>= R$ 1.500,00';
    gorduraStatus = 'NIVEL_3';
  } else if (gFrete >= 1100) {
    premioGorduraFrete = parseFloat(cfg.premioGordura1100) || 300;
    faixaGorduraFrete = '>= R$ 1.100,00';
    gorduraStatus = 'NIVEL_2';
  } else if (gFrete >= 700) {
    premioGorduraFrete = parseFloat(cfg.premioGordura700) || 200;
    faixaGorduraFrete = '>= R$ 700,00';
    gorduraStatus = 'NIVEL_1';
  }

  const totalPremios = roundVal(premioMetaVendas + premioGorduraFrete);

  return {
    metaVendasValor: metaBase,
    pctMetaVendas,
    premioMetaVendas: roundVal(premioMetaVendas),
    faixaMetaVendas,
    metaVendasStatus,
    premioGorduraFrete: roundVal(premioGorduraFrete),
    faixaGorduraFrete,
    gorduraStatus,
    totalPremios
  };
}

/**
 * Função de conveniência para cálculo de comissões, deduções e prêmios de um vendedor
 */
function calcularComissoesEPremiosVendedor({
  vendasBaseBruta = 0,
  fretesEmbutidos = 0,
  inadimplentesTotal = 0,
  gorduraFreteTotal = 0,
  metasConfig = null
} = {}) {
  const vBruta = roundVal(vendasBaseBruta);
  const freteEmb = roundVal(fretesEmbutidos);
  const vLiquida = roundVal(Math.max(0, vBruta - freteEmb));

  const comBruta = roundVal(vLiquida * 0.013);
  const inadimpl = roundVal(inadimplentesTotal);
  const comLiquida = roundVal(Math.max(0, comBruta - inadimpl));

  const metasCalc = calcularMetasEPremios({
    vendaBaseLiquida: vLiquida,
    gorduraFreteTotal,
    configMetas: metasConfig
  });

  const totalGeralReceber = roundVal(comLiquida + metasCalc.totalPremios);

  return {
    vendasBaseBruta: vBruta,
    fretesEmbutidos: freteEmb,
    vendasBaseLiquida: vLiquida,
    comissaoBruta: comBruta,
    inadimplentesTotal: inadimpl,
    comissaoLiquida: comLiquida,
    gorduraFreteTotal: roundVal(gorduraFreteTotal),
    ...metasCalc,
    totalGeralReceber
  };
}

/**
 * Consolida o fechamento de um período para todos os vendedores e calcula rateios globais e benchmarking
 */
async function consolidarFechamentoMensal({ dataIni, dataFim, codVend, triggeredBy = 'JOB_AUTO', persist = true } = {}) {
  const periodo = normalizarPeriodo(dataIni, dataFim);
  const configMetas = await getConfigMetasVendasDB();

  // 1. Busca Faturamento Global por Empresa no período
  const globalComissoesRes = await buscarVendasComissoesPeriodo({ dataIni: periodo.dtIni, dataFim: periodo.dtFim });
  const faturamentoGlobalPorEmpresa = globalComissoesRes.porEmpresa;

  // 2. Vendedores Homologados a processar
  const vendedoresLista = [
    { cod: '000004', nome: 'Figueiredo' },
    { cod: '000064', nome: 'Andrea' },
    { cod: '000074', nome: 'Juliana' }
  ];

  // Se filtrado por vendedor específico, ainda assim calcula os dados de todos para o benchmarking da equipe
  const fechamentosPorVendedor = [];

  for (const v of vendedoresLista) {
    // 2.1 Vendas e Comissões
    const vendasRes = await buscarVendasComissoesPeriodo({ dataIni: periodo.dtIni, dataFim: periodo.dtFim, codVend: v.cod });
    const vendasBaseBruta = vendasRes.totalBase;

    // 2.2 Frete Embutido Deduzido
    const fretesEmbRes = await buscarFretesEmbutidosPeriodo({ dataIni: periodo.dtIni, dataFim: periodo.dtFim, codVend: v.cod });
    const fretesEmbutidos = fretesEmbRes.totalFreteEmbutido;
    const vendasBaseLiquida = roundVal(Math.max(0, vendasBaseBruta - fretesEmbutidos));

    // 2.3 Gordura de Frete
    let gorduraFreteTotal = 0;
    try {
      const gfRes = await consultarGorduraFrete({ dataIni: periodo.dtIni, dataFim: periodo.dtFim, codVend: v.cod });
      gorduraFreteTotal = roundVal(gfRes.kpis ? gfRes.kpis.totalGordura : 0);
    } catch (errGf) {
      console.warn(`⚠️ [Fechamento] Erro ao consultar gordura de frete para ${v.nome}:`, errGf.message);
    }

    // 2.4 Inadimplentes do Período
    const inadRes = await buscarInadimplentesPeriodo({ dataIni: periodo.dtIni, dataFim: periodo.dtFim, codVend: v.cod });
    const inadimplentesTotal = inadRes.totalInadimplente;

    // 2.5 R$ Comissões (1,3%)
    const comissaoTaxa = 0.0130;
    const comissaoBruta = roundVal(vendasBaseLiquida * comissaoTaxa);
    const comissaoLiquida = roundVal(Math.max(0, comissaoBruta - inadimplentesTotal));

    // 2.6 Metas e Premiações
    const metasCalc = calcularMetasEPremios({
      vendaBaseLiquida: vendasBaseLiquida,
      gorduraFreteTotal,
      configMetas
    });

    // 2.7 Total Geral a Receber
    const totalGeralReceber = roundVal(comissaoLiquida + metasCalc.totalPremios);

    fechamentosPorVendedor.push({
      cicloId: periodo.cicloId,
      periodoLabel: periodo.label,
      dataIni: periodo.dataIniIso,
      dataFim: periodo.dataFimIso,
      periodo,
      codVendedor: v.cod,
      nomeVendedor: v.nome,
      vendasBaseBruta,
      fretesEmbutidos,
      vendasBaseLiquida,
      metaVendasValor: metasCalc.metaVendasValor,
      pctMetaVendas: metasCalc.pctMetaVendas,
      premioMetaVendas: metasCalc.premioMetaVendas,
      faixaMetaVendas: metasCalc.faixaMetaVendas,
      metaVendasStatus: metasCalc.metaVendasStatus,
      gorduraFreteTotal,
      premioGorduraFrete: metasCalc.premioGorduraFrete,
      faixaGorduraFrete: metasCalc.faixaGorduraFrete,
      gorduraStatus: metasCalc.gorduraStatus,
      comissaoTaxa,
      comissaoBruta,
      inadimplentesTotal,
      comissaoLiquida,
      totalPremios: metasCalc.totalPremios,
      totalGeralReceber,
      faturamentoEmpresas: faturamentoGlobalPorEmpresa,
      metasSnapshot: configMetas,
      detalhes: {
        totalLancamentosComissao: vendasRes.itens.length,
        totalPedidosComFreteEmbutido: fretesEmbRes.pedidosComFrete.length,
        totalTitulosInadimplentes: inadRes.titulosInadimplentes.length
      },
      tipoGeracao: triggeredBy
    });
  }

  // 3. Calcula Médias da Equipe e Benchmarking
  const totalVendedores = fechamentosPorVendedor.length || 1;
  const mediaVendasEquipe = roundVal(fechamentosPorVendedor.reduce((acc, x) => acc + x.vendasBaseLiquida, 0) / totalVendedores);
  const mediaGorduraEquipe = roundVal(fechamentosPorVendedor.reduce((acc, x) => acc + x.gorduraFreteTotal, 0) / totalVendedores);

  for (const f of fechamentosPorVendedor) {
    const diffVendas = mediaVendasEquipe > 0 ? roundVal(((f.vendasBaseLiquida - mediaVendasEquipe) / mediaVendasEquipe) * 100) : 0;
    const diffGordura = mediaGorduraEquipe !== 0 ? roundVal(((f.gorduraFreteTotal - mediaGorduraEquipe) / Math.abs(mediaGorduraEquipe)) * 100) : 0;

    f.benchmarking = {
      mediaVendasEquipe,
      diffVendasPct: diffVendas,
      statusVendasBench: diffVendas >= 0 ? 'ACIMA_MEDIA' : 'ABAIXO_MEDIA',
      mediaGorduraEquipe,
      diffGorduraPct: diffGordura,
      statusGorduraBench: diffGordura >= 0 ? 'ACIMA_MEDIA' : 'ABAIXO_MEDIA'
    };

    // 4. Persiste no PostgreSQL / Supabase e Cache JSON se habilitado
    if (persist) {
      await salvarFechamentoVendedorDB(f);
    }
  }

  // Se o usuário solicitou um vendedor específico, retorna apenas o dele acompanhado do contexto
  if (codVend) {
    const cleanReqVend = String(codVend).trim();
    const item = fechamentosPorVendedor.find(x => x.codVendedor === cleanReqVend || x.codVendedor === cleanReqVend.padStart(6, '0'));
    if (item) {
      return {
        fechamento: item,
        todosVendedores: fechamentosPorVendedor,
        periodo,
        faturamentoGlobalPorEmpresa,
        benchmarkingGlobal: { mediaVendasEquipe, mediaGorduraEquipe }
      };
    }
  }

  return {
    fechamento: fechamentosPorVendedor[0] || null,
    todosVendedores: fechamentosPorVendedor,
    fechamentos: fechamentosPorVendedor,
    periodo,
    faturamentoGlobalPorEmpresa,
    benchmarkingGlobal: { mediaVendasEquipe, mediaGorduraEquipe }
  };
}

/**
 * Job Automático executado mensalmente no Dia 26 às 00:30
 */
async function executarJobFechamentoMensal({ force = false } = {}) {
  const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
  const nowBrasilia = new Date(nowStr);
  const dia = nowBrasilia.getDate();
  const hora = nowBrasilia.getHours();
  const minuto = nowBrasilia.getMinutes();

  if (!force) {
    // Executa apenas se for dia 26 às 00h30m (ou janela entre 00h30m e 01h30m)
    if (dia !== 26 || hora !== 0 || minuto < 30) {
      return { executado: false, motivo: 'Fora do horário agendado (Dia 26 às 00:30)' };
    }
  }

  console.log('🏆 [Job Fechamento] Iniciando consolidação mensal oficial dos vendedores (Dia 26 às 00:30)...');
  const cicloDisponivel = calcularCicloFechamentoDisponivel(nowBrasilia);
  const resultado = await consolidarFechamentoMensal({
    dataIni: cicloDisponivel.dtIni,
    dataFim: cicloDisponivel.dtFim,
    triggeredBy: force ? 'MANUAL_FORCE' : 'JOB_AUTO',
    persist: true
  });

  console.log(`✅ [Job Fechamento] Fechamento do ciclo ${cicloDisponivel.label} concluído e persistido com sucesso!`);
  return { executado: true, ciclo: cicloDisponivel, resultado };
}

module.exports = {
  calcularCicloFechamentoDisponivel,
  normalizarPeriodo,
  buscarVendasComissoesPeriodo,
  buscarFretesEmbutidosPeriodo,
  buscarInadimplentesPeriodo,
  calcularMetasEPremios,
  calcularComissoesEPremiosVendedor,
  consolidarFechamentoMensal,
  executarJobFechamentoMensal,
  getConfigMetas: getConfigMetasVendasDB,
  saveConfigMetas: saveConfigMetasVendasDB,
  DEFAULT_METAS_VENDAS,
  EMPRESAS_FECHAMENTO
};
