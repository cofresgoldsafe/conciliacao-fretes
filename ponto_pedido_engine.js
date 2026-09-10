/**
 * ponto_pedido_engine.js
 * 
 * Módulo Analítico Desacoplado: Estudo e Cálculo do Ponto de Pedido Ideal
 * 
 * Implementa com fidelidade estrita as diretrizes operacionais de:
 * - ponto-de-pedido-instrucao-analise.md
 * - ponto-de-pedido-cofre-box-2-0-black.md
 * 
 * 1. Resolução inteligente de identificadores (Código puro, Prefixo 15-, Pipedrive ID B1_XCODPD, Descrição)
 * 2. As 6 consultas obrigatórias via Railway Protheus API (SB1090, SD2 14/15/16 com UNION ALL, SB2, SC6, SD3)
 * 3. Preenchimento mandatório de meses zerados na série temporal para não distorcer desvio-padrão e CV
 * 4. Cálculo dos 3 Cenários (Oficial, Média 12M + ES 90/95/98%, Run Rate Recente + ES 95%)
 * 5. Regra de decisão automatizada (tendência de crescimento, estabilidade ou retração)
 * 6. Detecção de Ruptura em Curso, Ação Imediata e Justificativa Financeira (Capital Imobilizado vs Margem)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuração do Gateway Railway Protheus
const RAILWAY_API_URL = 'https://protheus-api-production.up.railway.app/query';

/**
 * Obtém a chave de API Protheus de runtime (ambiente ou arquivos de configuração do Claude Desktop)
 * Nunca retorna chaves hardcoded no código de produção.
 */
function getProtheusApiKey() {
  let key = process.env.PROTHEUS_API_KEY || process.env.RAILWAY_API_KEY;
  if (!key) {
    const configPaths = [];
    if (process.env.APPDATA) {
      configPaths.push(path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json'));
    }
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
      configPaths.push(path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json'));
      configPaths.push(path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'));
    }
    for (const cfg of configPaths) {
      try {
        if (fs.existsSync(cfg)) {
          const parsed = JSON.parse(fs.readFileSync(cfg, 'utf8'));
          key = parsed?.mcpServers?.['protheus-cloud']?.env?.PROTHEUS_API_KEY;
          if (key) break;
        }
      } catch (_) {}
    }
  }
  return key ? String(key).trim() : '';
}

/**
 * Executa uma consulta SQL via API Nuvem Railway do Protheus
 * Regras Fixas da Instrução:
 * - O corpo usa o campo 'query', NUNCA 'sql' (evita HTTP 422)
 * - Timeout resiliente de 12 segundos
 */
function queryProtheusRailway(sql) {
  return new Promise((resolve, reject) => {
    const key = getProtheusApiKey();
    if (!key) {
      return reject(new Error('Chave de API Protheus Railway não configurada. Defina PROTHEUS_API_KEY nas variáveis de ambiente.'));
    }

    const postData = JSON.stringify({ query: sql });

    const options = {
      hostname: 'protheus-api-production.up.railway.app',
      port: 443,
      path: '/query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key,
        'User-Agent': 'GeminiCli-PontoPedido/1.0',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 12000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Resposta inválida do Railway API: ' + data));
          }
        } else {
          reject(new Error(`Railway API retornou status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na conexão com o Railway Protheus'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Sanitiza valores contra injeção SQL e wildcards perigosos
 */
function sanitizeSql(str) {
  if (!str) return '';
  return String(str).replace(/['";\\%_]/g, '').trim();
}

/**
 * Formata moeda BRL (R$ 0.000,00)
 */
function formatarMoeda(num) {
  const n = Number(num) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Arredonda número para 2 casas decimais
 */
function round2(num) {
  const n = Number(num) || 0;
  return Math.round(n * 100) / 100;
}

/**
 * Desvio-padrão amostral (dividido por n - 1)
 */
function calcularDesvioPadraoAmostral(valores, media) {
  if (!valores || valores.length < 2) return 0;
  const n = valores.length;
  const somaDiferencasQuadradas = valores.reduce((acc, v) => acc + Math.pow(v - media, 2), 0);
  return Math.sqrt(somaDiferencasQuadradas / (n - 1));
}

/**
 * 1. Resolver o código do produto (Passo 1 da Instrução)
 * Trata:
 * - Código já formatado: '00101010102B009'
 * - Prefixo de empresa: '15-01801080802B001' -> '01801080802B001'
 * - ID de produto Pipedrive: '11569' ou URL -> busca por B1_XCODPD
 * - Descrição aproximada
 */
async function resolverProdutoProtheus(entrada) {
  let termo = String(entrada || '').trim();
  if (!termo) return [];

  // Extrai ID do Pipedrive se o usuário colar URL (ex: benetroncomercial.pipedrive.com/product/11569)
  const pipedriveMatch = termo.match(/product\/(\d+)/i);
  if (pipedriveMatch) {
    termo = pipedriveMatch[1];
  }

  // Remove prefixo de empresa se houver (ex: '15-018...' -> '018...')
  if (/^\d{1,2}-.+/.test(termo)) {
    termo = termo.split('-')[1].trim();
  }

  const cleanTermo = sanitizeSql(termo);
  if (!cleanTermo || cleanTermo.length < 2) {
    return [];
  }

  // Busca na SB1090 (catálogo oficial da empresa 09, filial 01) com limite de segurança
  const sql = `
    SELECT TOP 20
      RTRIM(B1_COD) AS B1_COD,
      RTRIM(B1_DESC) AS B1_DESC,
      RTRIM(ISNULL(B1_TIPO, '')) AS B1_TIPO,
      RTRIM(ISNULL(B1_UM, 'UN')) AS B1_UM,
      ISNULL(B1_EMIN, 0) AS B1_EMIN,
      ISNULL(B1_VLUNIT, 0) AS B1_VLUNIT,
      ISNULL(B1_PRV1, 0) AS B1_PRV1,
      ISNULL(B1_PE, 0) AS B1_PE,
      ISNULL(B1_LE, 0) AS B1_LE,
      ISNULL(B1_EMAX, 0) AS B1_EMAX,
      ISNULL(B1_ESTSEG, 0) AS B1_ESTSEG,
      RTRIM(ISNULL(B1_GRUPO, '')) AS B1_GRUPO,
      RTRIM(ISNULL(B1_XCODPD, '')) AS B1_XCODPD,
      RTRIM(ISNULL(B1_MSBLQL, '2')) AS B1_MSBLQL
    FROM SB1090
    WHERE D_E_L_E_T_ = ' ' AND B1_FILIAL = '01'
      AND (
        B1_COD = '${cleanTermo}' 
        OR RTRIM(B1_XCODPD) = '${cleanTermo}'
        OR B1_DESC LIKE '%${cleanTermo}%'
      )
    ORDER BY 
      CASE 
        WHEN B1_COD = '${cleanTermo}' THEN 1
        WHEN RTRIM(B1_XCODPD) = '${cleanTermo}' THEN 2
        WHEN B1_DESC = '${cleanTermo}' THEN 3
        ELSE 4 
      END,
      B1_DESC ASC;
  `;

  try {
    const res = await queryProtheusRailway(sql);
    if (res && res.rows && res.rows.length > 0) {
      return res.rows;
    }
  } catch (err) {
    console.warn('⚠️ [PontoPedidoEngine] Aviso ao consultar SB1090 no Railway:', err.message);
  }

  return [];
}

/**
 * Executa o estudo completo de Ponto de Pedido a partir dos dados vivos do Protheus
 */
async function executarEstudoPontoPedido(entradaProduto, { leadTimeCustom } = {}) {
  const produtosEncontrados = await resolverProdutoProtheus(entradaProduto);
  if (!produtosEncontrados || produtosEncontrados.length === 0) {
    throw new Error(`Produto não localizado no catálogo Protheus (SB1090) para o identificador "${entradaProduto}".`);
  }

  // Se houver mais de um produto e a entrada não for um código exato, avisa
  const produtoPrincipal = produtosEncontrados[0];
  const codProduto = produtoPrincipal.B1_COD;
  const descProduto = produtoPrincipal.B1_DESC;

  // Checa bloqueio
  const isBloqueado = produtoPrincipal.B1_MSBLQL === '1' || produtoPrincipal.B1_MSBLQL === 'S';

  // Datas de referência
  const hoje = new Date();
  const formatarAAAAMM = (d) => {
    const a = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${a}${m}`;
  };
  const formatarAAAAMMDD = (d) => {
    const a = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${a}${m}${dia}`;
  };

  // 24 meses atrás (primeiro dia do mês)
  const d24mAtras = new Date(hoje.getFullYear(), hoje.getMonth() - 24, 1);
  const data24mStr = formatarAAAAMMDD(d24mAtras);

  // 12 meses atrás (primeiro dia do mês correspondente)
  const d12mAtras = new Date(hoje.getFullYear(), hoje.getMonth() - 12, 1);
  const data12mStr = formatarAAAAMMDD(d12mAtras);

  // --------------------------------------------------------------------------
  // 3.2 Vendas mês a mês, 24 meses, 3 empresas (SD2140, SD2150, SD2160 com UNION ALL)
  // --------------------------------------------------------------------------
  const sqlVendas24M = `
    SELECT EMPRESA, LEFT(DT, 6) AS MES, SUM(QTD) AS QTD, COUNT(*) AS LINHAS, SUM(TOT) AS VALOR
    FROM (
      SELECT '14' AS EMPRESA, D2_EMISSAO AS DT, D2_QUANT AS QTD, D2_TOTAL AS TOT
        FROM SD2140 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}' AND D2_EMISSAO >= '${data24mStr}'
      UNION ALL
      SELECT '15', D2_EMISSAO, D2_QUANT, D2_TOTAL
        FROM SD2150 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}' AND D2_EMISSAO >= '${data24mStr}'
      UNION ALL
      SELECT '16', D2_EMISSAO, D2_QUANT, D2_TOTAL
        FROM SD2160 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}' AND D2_EMISSAO >= '${data24mStr}'
    ) X
    GROUP BY EMPRESA, LEFT(DT, 6)
    ORDER BY MES ASC, EMPRESA ASC;
  `;

  // --------------------------------------------------------------------------
  // 3.4 Sanidade e Clientes Distintos nos últimos 12 meses (Unificado)
  // --------------------------------------------------------------------------
  const sqlQualidade12M = `
    SELECT 
      COUNT(DISTINCT (D2_CLIENTE + D2_LOJA)) AS CLIENTES_DISTINTOS,
      SUM(CASE WHEN D2_CF LIKE '1%' OR D2_CF LIKE '2%' OR D2_TIPO = 'D' THEN 1 ELSE 0 END) AS QTD_DEVOLUCOES
    FROM (
      SELECT D2_CLIENTE, D2_LOJA, D2_CF, D2_TIPO
        FROM SD2140 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}' AND D2_EMISSAO >= '${data12mStr}'
      UNION ALL
      SELECT D2_CLIENTE, D2_LOJA, D2_CF, D2_TIPO
        FROM SD2150 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}' AND D2_EMISSAO >= '${data12mStr}'
      UNION ALL
      SELECT D2_CLIENTE, D2_LOJA, D2_CF, D2_TIPO
        FROM SD2160 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}' AND D2_EMISSAO >= '${data12mStr}'
    ) X;
  `;

  // --------------------------------------------------------------------------
  // Primeira Venda no Histórico Geral
  // --------------------------------------------------------------------------
  const sqlPrimeiraVenda = `
    SELECT MIN(DT) AS PRIMEIRA_VENDA, SUM(QTD) AS TOTAL_HISTORICO
    FROM (
      SELECT MIN(D2_EMISSAO) AS DT, SUM(D2_QUANT) AS QTD FROM SD2140 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}'
      UNION ALL
      SELECT MIN(D2_EMISSAO) AS DT, SUM(D2_QUANT) AS QTD FROM SD2150 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}'
      UNION ALL
      SELECT MIN(D2_EMISSAO) AS DT, SUM(D2_QUANT) AS QTD FROM SD2160 WHERE D_E_L_E_T_ = ' ' AND D2_COD = '${codProduto}'
    ) X;
  `;

  // --------------------------------------------------------------------------
  // 3.5 Estoque Atual (SB2) nas empresas 14, 15, 16 e 09
  // --------------------------------------------------------------------------
  const sqlEstoqueSB2 = `
    SELECT '14' AS EMPRESA, ISNULL(SUM(B2_QATU), 0) AS SALDO FROM SB2140 WHERE D_E_L_E_T_ = ' ' AND B2_COD = '${codProduto}'
    UNION ALL
    SELECT '15' AS EMPRESA, ISNULL(SUM(B2_QATU), 0) AS SALDO FROM SB2150 WHERE D_E_L_E_T_ = ' ' AND B2_COD = '${codProduto}'
    UNION ALL
    SELECT '16' AS EMPRESA, ISNULL(SUM(B2_QATU), 0) AS SALDO FROM SB2160 WHERE D_E_L_E_T_ = ' ' AND B2_COD = '${codProduto}'
    UNION ALL
    SELECT '09' AS EMPRESA, ISNULL(SUM(B2_QATU), 0) AS SALDO FROM SB2090 WHERE D_E_L_E_T_ = ' ' AND B2_COD = '${codProduto}';
  `;

  // --------------------------------------------------------------------------
  // 3.6 Carteira de Pedidos de Venda em Aberto (SC6)
  // --------------------------------------------------------------------------
  const sqlPedidosAbertosSC6 = `
    SELECT '14' AS EMPRESA, RTRIM(C6_NUM) AS NUM, RTRIM(C6_ENTREG) AS PREV_ENTREGA, (C6_QTDVEN - C6_QTDENT) AS SALDO_VENDA
      FROM SC6140 WHERE D_E_L_E_T_ = ' ' AND C6_PRODUTO = '${codProduto}' AND C6_QTDVEN > C6_QTDENT AND (C6_BLQ IS NULL OR RTRIM(C6_BLQ) <> 'R')
    UNION ALL
    SELECT '15', RTRIM(C6_NUM), RTRIM(C6_ENTREG), (C6_QTDVEN - C6_QTDENT)
      FROM SC6150 WHERE D_E_L_E_T_ = ' ' AND C6_PRODUTO = '${codProduto}' AND C6_QTDVEN > C6_QTDENT AND (C6_BLQ IS NULL OR RTRIM(C6_BLQ) <> 'R')
    UNION ALL
    SELECT '16', RTRIM(C6_NUM), RTRIM(C6_ENTREG), (C6_QTDVEN - C6_QTDENT)
      FROM SC6160 WHERE D_E_L_E_T_ = ' ' AND C6_PRODUTO = '${codProduto}' AND C6_QTDVEN > C6_QTDENT AND (C6_BLQ IS NULL OR RTRIM(C6_BLQ) <> 'R')
    ORDER BY PREV_ENTREGA ASC;
  `;

  // --------------------------------------------------------------------------
  // 3.6 Entradas Reais (SD3, TM < 500)
  // --------------------------------------------------------------------------
  const sqlEntradasSD3 = `
    SELECT EMP, DT, TM, SUM(QTD) AS QTD
    FROM (
      SELECT '14' AS EMP, D3_EMISSAO AS DT, RTRIM(D3_TM) AS TM, D3_QUANT AS QTD
        FROM SD3140 WHERE D_E_L_E_T_ = ' ' AND D3_COD = '${codProduto}' AND D3_TM < '500' AND D3_EMISSAO >= '${data24mStr}'
      UNION ALL
      SELECT '15', D3_EMISSAO, RTRIM(D3_TM), D3_QUANT
        FROM SD3150 WHERE D_E_L_E_T_ = ' ' AND D3_COD = '${codProduto}' AND D3_TM < '500' AND D3_EMISSAO >= '${data24mStr}'
      UNION ALL
      SELECT '16', D3_EMISSAO, RTRIM(D3_TM), D3_QUANT
        FROM SD3160 WHERE D_E_L_E_T_ = ' ' AND D3_COD = '${codProduto}' AND D3_TM < '500' AND D3_EMISSAO >= '${data24mStr}'
    ) X
    GROUP BY EMP, DT, TM ORDER BY DT DESC;
  `;

  // Execução das queries: falhas em dados vitais (vendas, estoque, pedidos) não são mascaradas
  let resVendas24M, resEstoqueSB2, resPedidosAbertosSC6;
  try {
    [resVendas24M, resEstoqueSB2, resPedidosAbertosSC6] = await Promise.all([
      queryProtheusRailway(sqlVendas24M),
      queryProtheusRailway(sqlEstoqueSB2),
      queryProtheusRailway(sqlPedidosAbertosSC6)
    ]);
  } catch (err) {
    throw new Error(`Falha ao consultar tabelas vitais no Protheus (SD2/SB2/SC6): ${err.message}`);
  }

  // Consultas complementares com degradação graciosa
  const [
    resQualidade12M,
    resPrimeiraVenda,
    resEntradasSD3
  ] = await Promise.all([
    queryProtheusRailway(sqlQualidade12M).catch(() => ({ rows: [] })),
    queryProtheusRailway(sqlPrimeiraVenda).catch(() => ({ rows: [] })),
    queryProtheusRailway(sqlEntradasSD3).catch(() => ({ rows: [] }))
  ]);

  const vendasRows = resVendas24M?.rows || [];
  const qualidadeRow = resQualidade12M?.rows?.[0] || {};
  const primeiraVendaRow = resPrimeiraVenda?.rows?.[0] || {};
  const estoqueRows = resEstoqueSB2?.rows || [];
  const pedidosAbertosRows = resPedidosAbertosSC6?.rows || [];
  const entradasRows = resEntradasSD3?.rows || [];

  // --------------------------------------------------------------------------
  // 4. Montar a série mensal preenchendo meses zerados (Passo 4 da Instrução)
  // --------------------------------------------------------------------------
  const listaMeses12 = [];
  for (let i = 12; i >= 1; i--) {
    const dtMes = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const a = dtMes.getFullYear();
    const m = String(dtMes.getMonth() + 1).padStart(2, '0');
    listaMeses12.push(`${a}${m}`);
  }

  // Mapear vendas agregadas por mês (somando as 3 empresas)
  const vendasPorMesMap = new Map();
  const vendasPorEmpresaMap = { '14': { qtd: 0, linhas: 0, valor: 0 }, '15': { qtd: 0, linhas: 0, valor: 0 }, '16': { qtd: 0, linhas: 0, valor: 0 } };
  let vendas12MAnterior = 0;

  const meses12AnterioresSet = new Set();
  for (let i = 24; i >= 13; i--) {
    const dtMes = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    meses12AnterioresSet.add(formatarAAAAMM(dtMes));
  }

  const meses12AtuaisSet = new Set(listaMeses12);

  vendasRows.forEach(r => {
    const mes = String(r.MES || '').trim();
    const emp = String(r.EMPRESA || '').trim();
    const qtd = Number(r.QTD) || 0;
    const linhas = Number(r.LINHAS) || 0;
    const valor = Number(r.VALOR) || 0;

    if (meses12AtuaisSet.has(mes)) {
      vendasPorMesMap.set(mes, (vendasPorMesMap.get(mes) || 0) + qtd);
      if (vendasPorEmpresaMap[emp]) {
        vendasPorEmpresaMap[emp].qtd += qtd;
        vendasPorEmpresaMap[emp].linhas += linhas;
        vendasPorEmpresaMap[emp].valor += valor;
      }
    } else if (meses12AnterioresSet.has(mes)) {
      vendas12MAnterior += qtd;
    }
  });

  // Série mensal com ZEROS obrigatórios (array de 12 valores numéricos)
  const serieMensal12 = listaMeses12.map(mesStr => {
    const ano = mesStr.slice(0, 4);
    const mes = mesStr.slice(4, 6);
    const qtd = vendasPorMesMap.get(mesStr) || 0;
    return {
      mesAno: `${mes}/${ano}`,
      chaveMes: mesStr,
      quantidade: qtd
    };
  });

  const valoresMensais = serieMensal12.map(s => s.quantidade);
  const vendas12M = valoresMensais.reduce((a, b) => a + b, 0);
  const mediaMensal = vendas12M / 12;
  const mediaDiaria = vendas12M / 365;
  const desvioPadrao = calcularDesvioPadraoAmostral(valoresMensais, mediaMensal);
  const cv = mediaMensal > 0 ? (desvioPadrao / mediaMensal) : 0;

  // Tendência (primeiros 6 meses vs últimos 6 meses)
  const somaSemestre1 = valoresMensais.slice(0, 6).reduce((a, b) => a + b, 0);
  const somaSemestre2 = valoresMensais.slice(6, 12).reduce((a, b) => a + b, 0);
  const mediaSemestre1 = somaSemestre1 / 6;
  const mediaSemestre2 = somaSemestre2 / 6;
  const variacaoTendencia = mediaSemestre1 > 0 ? ((mediaSemestre2 - mediaSemestre1) / mediaSemestre1) * 100 : (mediaSemestre2 > 0 ? 100 : 0);

  // Run Rate Recente (últimos 3 a 4 meses)
  const ultimos4MesesValores = valoresMensais.slice(8, 12);
  const runRateRecente = ultimos4MesesValores.reduce((a, b) => a + b, 0) / ultimos4MesesValores.length;

  // Crescimento Anual (12M atual vs 12M anterior)
  const crescimentoAnual = vendas12MAnterior > 0 ? ((vendas12M - vendas12MAnterior) / vendas12MAnterior) * 100 : (vendas12M > 0 ? 100 : 0);

  // Qualidade e Clientes Distintos (Unificado)
  const totalClientesDistintos = Number(qualidadeRow.CLIENTES_DISTINTOS) || 0;
  const possuiDevolucoes = Number(qualidadeRow.QTD_DEVOLUCOES || 0) > 0;

  // --------------------------------------------------------------------------
  // Estoque Atual e Carteira SC6
  // --------------------------------------------------------------------------
  const estoquePorEmpresa = { '14': 0, '15': 0, '16': 0, '09': 0 };
  let saldoFisicoTotal = 0;
  estoqueRows.forEach(e => {
    const emp = String(e.EMPRESA || '').trim();
    const s = Number(e.SALDO) || 0;
    if (estoquePorEmpresa[emp] !== undefined) estoquePorEmpresa[emp] = s;
    saldoFisicoTotal += s;
  });

  let pedidosAbertosQtd = 0;
  const pedidosAbertosLista = pedidosAbertosRows.map(p => {
    const q = Number(p.SALDO_VENDA) || 0;
    pedidosAbertosQtd += q;
    const rawDt = String(p.PREV_ENTREGA || '').trim();
    const dataFmt = rawDt.length === 8 ? `${rawDt.slice(6, 8)}/${rawDt.slice(4, 6)}/${rawDt.slice(0, 4)}` : rawDt;
    return {
      empresa: p.EMPRESA,
      pedido: p.NUM,
      entrega: dataFmt,
      quantidade: q
    };
  });

  // Entradas recentes da SD3
  const ultimasEntradasSD3 = entradasRows.slice(0, 5).map(e => ({
    empresa: String(e.EMP || '').trim(),
    data: String(e.DT || '').trim(),
    tm: String(e.TM || '').trim(),
    quantidade: Number(e.QTD) || 0
  }));

  // --------------------------------------------------------------------------
  // 5. Calcular o Ponto de Pedido — Três Cenários (Passo 5 da Instrução)
  // --------------------------------------------------------------------------
  const leadCadastrado = Number(produtoPrincipal.B1_PE) || 0;
  let leadTimeDias = (leadCadastrado > 0 ? leadCadastrado : 30);
  let leadTimeNaoCadastrado = (leadCadastrado === 0);

  if (leadTimeCustom !== undefined && leadTimeCustom !== null && leadTimeCustom !== '') {
    const parsedLt = Number(leadTimeCustom);
    if (!isNaN(parsedLt) && parsedLt >= 1 && parsedLt <= 365) {
      leadTimeDias = Math.round(parsedLt);
      leadTimeNaoCadastrado = false;
    }
  }

  // Cenário 1: Fórmula Oficial do Doc
  const cenario1_PP = Math.ceil(mediaDiaria * leadTimeDias);

  // Cenário 2: Média 12M + Estoque de Segurança
  const fatorLT = leadTimeDias / 30;
  const demandaLT = mediaMensal * fatorLT;
  const desvioLT = desvioPadrao * Math.sqrt(fatorLT);

  const cenario2_90 = Math.ceil(demandaLT + (1.28 * desvioLT));
  const cenario2_95 = Math.ceil(demandaLT + (1.65 * desvioLT));
  const cenario2_98 = Math.ceil(demandaLT + (2.05 * desvioLT));

  // Cenário 3: Run Rate Recente + Estoque de Segurança
  const demandaRecenteLT = runRateRecente * fatorLT;
  const cenario3_95 = Math.ceil(demandaRecenteLT + (1.65 * desvioLT));

  // Regra de Decisão da Instrução Oficial:
  let ppRecomendado = cenario2_95;
  let justificativaCenario = '';

  if (vendas12M === 0) {
    // Produto sem demanda recente
    ppRecomendado = pedidosAbertosQtd > 0 ? pedidosAbertosQtd : 0;
    justificativaCenario = 'Sem vendas registradas nos últimos 12 meses. PP recomendado zerado para não imobilizar capital desnecessário (ou atender apenas carteira em aberto).';
  } else if (variacaoTendencia > 15) {
    // Tendência de alta consistente (> 15% entre semestres) -> Cenário 3 a 95%
    ppRecomendado = Math.max(1, cenario3_95);
    justificativaCenario = `Tendência de alta consistente (+${round2(variacaoTendencia)}% no 2º semestre) e run rate recente de ${round2(runRateRecente)} un/mês. Adotado Cenário 3 com 95% de nível de serviço.`;
  } else if (variacaoTendencia < -15) {
    // Tendência de queda consistente -> Cenário 2 a 90%
    ppRecomendado = Math.max(1, cenario2_90);
    justificativaCenario = `Tendência de queda (-${round2(Math.abs(variacaoTendencia))}%). Adotado Cenário 2 conservador a 90% de nível de serviço (revisão recomendada em 3 meses).`;
  } else {
    // Demanda estável ou com volatilidade
    ppRecomendado = Math.max(1, cenario2_95);
    if (cv > 0.60) {
      justificativaCenario = `Demanda com alta dispersão (CV de ${round2(cv * 100)}%). Adotado Cenário 2 clássico com 95% de nível de serviço (recomendado acompanhamento frequente).`;
    } else {
      justificativaCenario = `Demanda estável (CV de ${round2(cv * 100)}%). Adotado Cenário 2 clássico com 95% de nível de serviço.`;
    }
  }

  // Lote de reposição sugerido (≈ 2 meses de demanda)
  const loteSugerido = Math.max(1, Math.round(mediaMensal * 2));

  // --------------------------------------------------------------------------
  // Diagnóstico de Ruptura e Ação Imediata
  // --------------------------------------------------------------------------
  const rupturaEmCurso = saldoFisicoTotal === 0 && pedidosAbertosQtd > 0;
  const deficitCarteira = Math.max(0, pedidosAbertosQtd - saldoFisicoTotal);
  const saldoAposCarteira = Math.max(0, saldoFisicoTotal - pedidosAbertosQtd);
  const deficitPP = Math.max(0, ppRecomendado - saldoAposCarteira);
  const consumoLeadTimeEstimado = Math.ceil(mediaDiaria * leadTimeDias);
  const estoqueCritico = (saldoFisicoTotal < ppRecomendado) || (deficitCarteira > 0);

  // Sugestão de quantidade urgente:
  // Se ruptura: déficit da carteira + PP de reposição + consumo durante o lead time
  // Se estoque crítico ou carteira desatendida: déficit da carteira + déficit para repor PP
  let compraUrgenteQtd = 0;
  if (rupturaEmCurso) {
    compraUrgenteQtd = deficitCarteira + ppRecomendado + consumoLeadTimeEstimado;
  } else if (deficitCarteira > 0 || estoqueCritico) {
    compraUrgenteQtd = deficitCarteira + deficitPP;
  }

  // --------------------------------------------------------------------------
  // Justificativa Financeira
  // --------------------------------------------------------------------------
  const custoUnitario = Number(produtoPrincipal.B1_VLUNIT) || 0;
  const precoTabela = Number(produtoPrincipal.B1_PRV1) || 0;
  const totalFaturado12M = vendasPorEmpresaMap['14'].valor + vendasPorEmpresaMap['15'].valor + vendasPorEmpresaMap['16'].valor;
  const precoMedioRealizado = vendas12M > 0 ? (totalFaturado12M / vendas12M) : precoTabela;
  const lucroBrutoUnitario = precoMedioRealizado - custoUnitario;
  const margemLucroBruto = precoMedioRealizado > 0 ? (lucroBrutoUnitario / precoMedioRealizado) * 100 : 0;
  const capitalImobilizadoPP = ppRecomendado * custoUnitario;

  // Ponto de pedido atual gravado no Protheus
  const ppCadastradoHoje = Number(produtoPrincipal.B1_EMIN) || 0;

  // Histórico de primeira venda
  const rawPrimeiraVenda = String(primeiraVendaRow.PRIMEIRA_VENDA || '').trim();
  const primeiraVendaFmt = rawPrimeiraVenda.length === 8 
    ? `${rawPrimeiraVenda.slice(6, 8)}/${rawPrimeiraVenda.slice(4, 6)}/${rawPrimeiraVenda.slice(0, 4)}` 
    : '-';
  const totalHistoricoUnidades = Number(primeiraVendaRow.TOTAL_HISTORICO) || vendas12M;

  // --------------------------------------------------------------------------
  // Formatação do Estudo em Markdown Oficial (Padrão Instrução de Análise)
  // --------------------------------------------------------------------------
  const markdownRelatorio = `
# Ponto de Pedido — ${descProduto}

**Código Protheus:** \`${codProduto}\`
**Código Pipedrive:** \`${produtoPrincipal.B1_XCODPD || '-'}\`
**Data do cálculo:** ${hoje.toLocaleDateString('pt-BR')}
**Fonte:** SD2 (NF de saída) empresas 14/15/16 + SB1090 + SB2 + SC6 — via Railway API (dados ao vivo)

---

## Resposta

| Métrica | Valor |
|---|---|
| Vendas 12 meses | **${vendas12M} un** |
| Média mensal | ${round2(mediaMensal)} un/mês |
| Média diária | ${round2(mediaDiaria)} un/dia |
| Run rate recente | ${round2(runRateRecente)} un/mês |
| Lead time de reposição | ~${leadTimeDias} dias ${leadTimeNaoCadastrado ? '(não cadastrado — \`B1_PE = 0\`)' : '(B1_PE)'} |
| **PP pela fórmula oficial** | **${cenario1_PP} un** |
| **PP recomendado** | **${ppRecomendado} un** |
| PP cadastrado hoje (\`B1_EMIN\`) | **${ppCadastradoHoje} un** ${ppCadastradoHoje === 0 ? '— não existe ponto de pedido' : ''} |
| **Estoque atual (SB2)** | **${saldoFisicoTotal} un** ${rupturaEmCurso ? '— ⚠️ RUPTURA EM CURSO' : (saldoFisicoTotal === 0 ? '— Zerado' : '')} |
| Pedidos de venda em aberto (SC6) | **${pedidosAbertosQtd} un** |

---

## Dados de venda — SD2, últimos 12 meses

Por empresa:
- **Metal Pleno (14):** ${vendasPorEmpresaMap['14'].qtd} un | ${formatarMoeda(vendasPorEmpresaMap['14'].valor)}
- **GSI (15):** ${vendasPorEmpresaMap['15'].qtd} un | ${formatarMoeda(vendasPorEmpresaMap['15'].valor)}
- **OACO (16):** ${vendasPorEmpresaMap['16'].qtd} un | ${formatarMoeda(vendasPorEmpresaMap['16'].valor)}
- **TOTAL CONSOLIDADO:** **${vendas12M} un** | **${formatarMoeda(totalFaturado12M)}**

Mês a mês (com preenchimento de meses zerados):
${serieMensal12.map(s => `- ${s.mesAno}: **${s.quantidade} un**`).join('\n')}

**Estatística:** Média: ${round2(mediaMensal)} un/mês · Desvio-padrão: ${round2(desvioPadrao)} un · CV: ${round2(cv * 100)}%
**Tendência:** Semestre 1 = ${round2(mediaSemestre1)} un/mês → Semestre 2 = ${round2(mediaSemestre2)} un/mês (${variacaoTendencia >= 0 ? '+' : ''}${round2(variacaoTendencia)}%)
**Crescimento Anual:** 12M anterior = ${vendas12MAnterior} un → 12M atual = ${vendas12M} un (${crescimentoAnual >= 0 ? '+' : ''}${round2(crescimentoAnual)}%)

---

## Cálculo dos Três Cenários

1. **Fórmula Oficial da Empresa:** \`PP = CEILING( (${vendas12M} ÷ 365) × ${leadTimeDias} ) = ${cenario1_PP} un\`
2. **Média 12M + Estoque de Segurança:**
   - 90% (z=1,28): **${cenario2_90} un**
   - 95% (z=1,65): **${cenario2_95} un**
   - 98% (z=2,05): **${cenario2_98} un**
3. **Run Rate Recente + Estoque de Segurança (95%):** **${cenario3_95} un**

**Critério de Decisão:** ${justificativaCenario}

---

## Recomendação

**Cadastrar \`B1_EMIN\` = ${ppRecomendado} unidades** (cadastrado hoje: ${ppCadastradoHoje} un).
**Lote de reposição sugerido: ${loteSugerido} un** (≈ 2 meses de demanda).

${rupturaEmCurso ? `
### ⚠️ AÇÃO IMEDIATA — RUPTURA EM CURSO
O estoque é **0 un** e há **${pedidosAbertosQtd} pedidos de venda em aberto atrasados**.
Com lead time de ~${leadTimeDias} dias, a reposição precisa ser disparada hoje com quantidade mínima sugerida de **${compraUrgenteQtd} un** (${ppRecomendado} de PP + ${pedidosAbertosQtd} em carteira + ${consumoLeadTimeEstimado} de consumo no lead time).
` : (estoqueCritico ? `
### 🟡 ATENÇÃO — ESTOQUE ABAIXO DO PONTO DE PEDIDO
Saldo atual (${saldoFisicoTotal} un) está abaixo do ponto de pedido recomendado (${ppRecomendado} un).
Sugestão de emissão de compra de **${compraUrgenteQtd} unidades**.
` : `
### 🟢 SITUAÇÃO CONFORTÁVEL
Saldo atual (${saldoFisicoTotal} un) é suficiente para cobrir o ponto de pedido (${ppRecomendado} un).
`)}

**Impacto Financeiro:**
- Capital imobilizado no PP: **${formatarMoeda(capitalImobilizadoPP)}** (${ppRecomendado} un × ${formatarMoeda(custoUnitario)})
- Margem de contribuição por unidade: **${formatarMoeda(lucroBrutoUnitario)}** (Margem: ${round2(margemLucroBruto)}%)
`.trim();

  return {
    success: true,
    produto: {
      codigo: codProduto,
      descricao: descProduto,
      grupo: produtoPrincipal.B1_GRUPO,
      tipo: produtoPrincipal.B1_TIPO,
      unidadeMedida: produtoPrincipal.B1_UM,
      pipedriveId: produtoPrincipal.B1_XCODPD || '-',
      bloqueado: isBloqueado,
      custoUnitario: custoUnitario,
      precoTabela: precoTabela,
      precoMedioRealizado: round2(precoMedioRealizado),
      leadCadastrado: leadCadastrado,
      loteCadastrado: Number(produtoPrincipal.B1_LE) || 0,
      eminCadastrado: ppCadastradoHoje
    },
    resultado: {
      pontoPedidoRecomendado: ppRecomendado,
      unidadeMedida: 'unidades',
      mensagemSimples: `De acordo com o histórico consolidado, o ponto de pedido recomendado: ${ppRecomendado} unidades`,
      loteSugerido: loteSugerido,
      rupturaEmCurso: rupturaEmCurso,
      estoqueCritico: estoqueCritico,
      compraUrgenteQtd: compraUrgenteQtd,
      justificativaCenario: justificativaCenario
    },
    metricas12M: {
      vendas12M: vendas12M,
      mediaMensal: round2(mediaMensal),
      mediaDiaria: round2(mediaDiaria),
      desvioPadrao: round2(desvioPadrao),
      cvPercentual: round2(cv * 100),
      variacaoTendenciaPercentual: round2(variacaoTendencia),
      runRateRecente: round2(runRateRecente),
      vendas12MAnterior: vendas12MAnterior,
      crescimentoAnualPercentual: round2(crescimentoAnual),
      totalFaturado12M: round2(totalFaturado12M),
      clientesDistintos: totalClientesDistintos,
      possuiDevolucoes: possuiDevolucoes,
      primeiraVendaData: primeiraVendaFmt,
      totalHistoricoUnidades: totalHistoricoUnidades
    },
    serieMensal: serieMensal12,
    cenarios: {
      leadTimeDias: leadTimeDias,
      leadTimeNaoCadastrado: leadTimeNaoCadastrado,
      cenario1Oficial: cenario1_PP,
      cenario2_90: cenario2_90,
      cenario2_95: cenario2_95,
      cenario2_98: cenario2_98,
      cenario3_95: cenario3_95
    },
    estoque: {
      saldoFisicoTotal: saldoFisicoTotal,
      porEmpresa: estoquePorEmpresa,
      pedidosAbertosQtd: pedidosAbertosQtd,
      pedidosAbertosLista: pedidosAbertosLista,
      ultimasEntradasSD3: ultimasEntradasSD3
    },
    financeiro: {
      capitalImobilizadoPP: round2(capitalImobilizadoPP),
      lucroBrutoUnitario: round2(lucroBrutoUnitario),
      margemLucroBrutoPercentual: round2(margemLucroBruto)
    },
    markdownRelatorio: markdownRelatorio
  };
}

module.exports = {
  resolverProdutoProtheus,
  executarEstudoPontoPedido,
  getProtheusApiKey,
  queryProtheusRailway
};
