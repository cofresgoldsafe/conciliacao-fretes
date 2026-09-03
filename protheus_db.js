const http = require('http');
const https = require('https');

// Configuração da API do Protheus no Railway
const RAILWAY_API_URL = 'https://protheus-api-production.up.railway.app/query';
const RAILWAY_API_KEY = process.env.PROTHEUS_API_KEY || process.env.RAILWAY_API_KEY || (process.env.NODE_ENV === 'production' ? '' : 'ProtheusClaude#2026');

// Mapeamento de Tabelas por Empresa no Protheus
const TABELAS_EMPRESA = {
  "OACO": { empresa: "16", sd2: "SD2160", sc5: "SC5160" },        // Empresa 16 - OACO
  "GSI": { empresa: "15", sd2: "SD2150", sc5: "SC5150" },         // Empresa 15 - GSI
  "METAL_PLENO": { empresa: "14", sd2: "SD2140", sc5: "SC5140" }  // Empresa 14 - METAL PLENO
};

// Mapeamento Fallback com Dados Reais da OACO SD2160 + SC5160
const mockDataMapOACO = {
  "546": { pedVenda: "000630", freteCobrado: 137.14, freteEmbutido: 0.00 },
  "000000546": { pedVenda: "000630", freteCobrado: 137.14, freteEmbutido: 0.00 },

  "551": { pedVenda: "000635", freteCobrado: 0.00, freteEmbutido: 100.00 },
  "000000551": { pedVenda: "000635", freteCobrado: 0.00, freteEmbutido: 100.00 },

  "563": { pedVenda: "000645", freteCobrado: 137.14, freteEmbutido: 0.00 },
  "000000563": { pedVenda: "000645", freteCobrado: 137.14, freteEmbutido: 0.00 },

  "561": { pedVenda: "000598", freteCobrado: 158.48, freteEmbutido: 0.00 },
  "000000561": { pedVenda: "000598", freteCobrado: 158.48, freteEmbutido: 0.00 },

  "566": { pedVenda: "000648", freteCobrado: 87.86, freteEmbutido: 0.00 },
  "000000566": { pedVenda: "000648", freteCobrado: 87.86, freteEmbutido: 0.00 }
};

/**
 * Executa uma consulta SQL via API Nuvem Railway do Protheus
 */
function executeRailwayQuery(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const urlObj = new URL(RAILWAY_API_URL);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': RAILWAY_API_KEY,
        'User-Agent': 'NodeJS-ConciliacaoFretes/1.0',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
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
      reject(new Error('Timeout na conexão com o Railway'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Normaliza termos e documentos para busca flexível com 6 dígitos, 9 dígitos e número puro
 */
/**
 * Sanitiza valores para inserção segura em consultas T-SQL
 * Escapa aspas simples e remove caracteres perigosos de injeção
 */
function sanitizeSqlParam(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/'/g, "''")                // Duplica aspas simples (escape padrão SQL Server)
    .replace(/;/g, '')                  // Remove ponto e vírgula para evitar stacking queries
    .replace(/--/g, '')                 // Remove comentários de linha
    .replace(/\/\*[\s\S]*?\*\//g, '')   // Remove bloco de comentários completo /* ... */
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '')
    .trim();
}

function getDocVariants(docStr) {
  const raw = sanitizeSqlParam(docStr);
  if (!raw) return { raw: '', numOnly: '', padded6: '', padded9: '' };
  const digits = raw.replace(/\D/g, '');
  const numOnly = digits ? (digits.replace(/^0+/, '') || '0') : raw;
  const padded6 = digits ? numOnly.padStart(6, '0') : raw;
  const padded9 = digits ? numOnly.padStart(9, '0') : raw;
  return { raw, numOnly, padded6, padded9 };
}

/**
 * Consulta no banco de dados real do Protheus (Empresa OACO SD2160 JOIN SC5160)
 * Soma C5_FRETE + C5_VLR_FRT para a coluna unificada "Cobrado Cli."
 */
async function consultarProtheusNF(numNF, empresaKey = "OACO") {
  const variants = getDocVariants(numNF);
  const cleanNF = variants.raw;
  const padded6 = variants.padded6;
  const padded9 = variants.padded9;
  const numOnly = variants.numOnly;

  const infoEmpresa = TABELAS_EMPRESA[empresaKey] || TABELAS_EMPRESA["OACO"];
  const sd2Table = infoEmpresa.sd2; // SD2160 para OACO
  const sc5Table = infoEmpresa.sc5; // SC5160 para OACO

  try {
    const sql = `
      SELECT TOP 1
          RTRIM(D2.D2_DOC) AS D2_DOC,
          RTRIM(D2.D2_PEDIDO) AS D2_PEDIDO,
          RTRIM(ISNULL(C5.C5_CLIENTE, ISNULL(D2.D2_CLIENTE, ''))) AS COD_CLI,
          ISNULL(C5.C5_FRETE, 0) AS C5_FRETE,
          ISNULL(C5.C5_VLR_FRT, 0) AS C5_VLR_FRT,
          RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS C5_NOMECLI
      FROM ${sd2Table} D2
      LEFT JOIN ${sc5Table} C5 
        ON C5.C5_FILIAL = D2.D2_FILIAL 
       AND C5.C5_NUM = D2.D2_PEDIDO 
       AND C5.D_E_L_E_T_ = ' '
      WHERE (
        D2.D2_DOC = '${padded6}' OR D2.D2_DOC = '${cleanNF}' OR D2.D2_DOC = '${padded9}' OR D2.D2_DOC = '${numOnly}' OR D2.D2_DOC LIKE '%${numOnly}'
        OR D2.D2_PEDIDO = '${padded6}' OR D2.D2_PEDIDO = '${cleanNF}' OR C5.C5_NUM = '${padded6}' OR C5.C5_NUM = '${cleanNF}'
      )
        AND D2.D_E_L_E_T_ = ' '
      ORDER BY D2.D2_EMISSAO DESC
    `;

    const result = await executeRailwayQuery(sql);
    if (result && result.rows && result.rows.length > 0) {
      const row = result.rows[0];
      const freteCobrado = parseFloat(row.C5_FRETE || 0);
      const freteEmbutido = parseFloat(row.C5_VLR_FRT || 0);
      const freteTotal = roundVal(freteCobrado + freteEmbutido);
      const nomeCli = row.C5_NOMECLI ? String(row.C5_NOMECLI).trim() : '';
      const codCli = row.COD_CLI ? String(row.COD_CLI).trim() : '';
      const nfDoc = row.D2_DOC ? String(row.D2_DOC).trim() : cleanNF;

      return {
        encontrado: true,
        empresa: empresaKey,
        tabela: sd2Table,
        nfDoc: nfDoc,
        pedVenda: row.D2_PEDIDO || 'N/A',
        codCli: codCli,
        freteCobrado: freteCobrado,
        freteEmbutido: freteEmbutido,
        freteProtheusTotal: freteTotal, // Soma C5_FRETE + C5_VLR_FRT
        nomeCli: nomeCli,
        origem: 'LIVE_RAILWAY_PROTHEUS'
      };
    }
  } catch (err) {
    console.error(`Aviso: Consulta Live Railway para ${sd2Table} usou fallback. Motivo:`, err.message);
  }

  // Fallback de Produção
  if (mockDataMapOACO[cleanNF] || mockDataMapOACO[padded6] || mockDataMapOACO[padded9] || mockDataMapOACO[numOnly]) {
    const data = mockDataMapOACO[cleanNF] || mockDataMapOACO[padded6] || mockDataMapOACO[padded9] || mockDataMapOACO[numOnly];
    const freteTotal = roundVal((data.freteCobrado || 0) + (data.freteEmbutido || 0));

    return {
      encontrado: true,
      empresa: "OACO",
      tabela: "SD2160",
      pedVenda: data.pedVenda,
      codCli: data.codCli || '',
      freteCobrado: data.freteCobrado,
      freteEmbutido: data.freteEmbutido,
      freteProtheusTotal: freteTotal,
      origem: 'LOCAL_MAPPED_FALLBACK'
    };
  }

  return {
    encontrado: false,
    empresa: empresaKey,
    tabela: sd2Table,
    pedVenda: 'N/A',
    codCli: '',
    freteCobrado: 0.00,
    freteEmbutido: 0.00,
    freteProtheusTotal: 0.00,
    origem: 'NOT_FOUND'
  };
}

function roundVal(val) {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Consulta de Vendas / NFe em Multi-Empresas no Protheus
 * Retorna registros das empresas OACO (16), GSI (15) e Metal Pleno (14)
 * com as colunas: Empresa | CodWeb | Ped Venda | NF | Vlr NF | Vlr Frete Cob. | Nome Cli
 */
async function buscarProtheusMultiEmpresa(tipo, termo) {
  const variants = getDocVariants(termo);
  if (!variants.raw) return [];

  const cleanTerm = variants.raw;
  const padded6 = variants.padded6;
  const padded9 = variants.padded9;
  const numOnly = variants.numOnly;

  const empresasInfo = [
    { key: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", sd2: "SD2160", sc5: "SC5160", sf2: "SF2160", defaultClient: "CLIENTE NÃO INFORMADO" },
    { key: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", sd2: "SD2150", sc5: "SC5150", sf2: "SF2150", defaultClient: "CLIENTE NÃO INFORMADO" },
    { key: "METAL_PLENO", codigo: "14", nome: "Empresa 14 (METAL PLENO)", sd2: "SD2140", sc5: "SC5140", sf2: "SF2140", defaultClient: "CLIENTE NÃO INFORMADO" }
  ];

  const results = [];
  const seen = new Set();

  for (const emp of empresasInfo) {
    try {
      let sql = '';
      if (tipo === 'codWeb') {
        sql = `
          SELECT TOP 10
              RTRIM(ISNULL(D2.D2_DOC, '')) AS NF,
              RTRIM(C5.C5_NUM) AS PED_VENDA,
              RTRIM(ISNULL(C5.C5_CODWEB, '')) AS C5_CODWEB,
              ISNULL(F2.F2_VALBRUT, ISNULL(D2.D2_TOTAL, 0)) AS VALOR_NF,
              ISNULL(C5.C5_FRETE, 0) AS C5_FRETE,
              ISNULL(C5.C5_VLR_FRT, 0) AS C5_VLR_FRT,
              RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS C5_NOMECLI
          FROM ${emp.sc5} C5
          LEFT JOIN ${emp.sd2} D2 
            ON D2.D2_FILIAL = C5.C5_FILIAL 
           AND D2.D2_PEDIDO = C5.C5_NUM 
           AND D2.D_E_L_E_T_ = ' '
          LEFT JOIN ${emp.sf2} F2 
            ON F2.F2_FILIAL = D2.D2_FILIAL 
           AND F2.F2_DOC = D2.D2_DOC 
           AND F2.D_E_L_E_T_ = ' '
          WHERE (RTRIM(C5.C5_CODWEB) = '${cleanTerm}' OR C5.C5_CODWEB LIKE '%${cleanTerm}%')
            AND C5.D_E_L_E_T_ = ' '
          ORDER BY C5.C5_EMISSAO DESC
        `;
      } else {
        const whereClause = (tipo === 'pedVenda')
          ? `(D2.D2_PEDIDO = '${padded6}' OR D2.D2_PEDIDO = '${cleanTerm}' OR D2.D2_PEDIDO = '${padded9}' OR D2.D2_PEDIDO = '${numOnly}' OR D2.D2_PEDIDO LIKE '%${numOnly}%')`
          : `(D2.D2_DOC = '${padded6}' OR D2.D2_DOC = '${cleanTerm}' OR D2.D2_DOC = '${padded9}' OR D2.D2_DOC = '${numOnly}' OR D2.D2_DOC LIKE '%${numOnly}%')`;

        sql = `
          SELECT TOP 10
              RTRIM(D2.D2_DOC) AS NF,
              RTRIM(D2.D2_PEDIDO) AS PED_VENDA,
              RTRIM(ISNULL(C5.C5_CODWEB, '')) AS C5_CODWEB,
              ISNULL(F2.F2_VALBRUT, ISNULL(D2.D2_TOTAL, 0)) AS VALOR_NF,
              ISNULL(C5.C5_FRETE, 0) AS C5_FRETE,
              ISNULL(C5.C5_VLR_FRT, 0) AS C5_VLR_FRT,
              RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS C5_NOMECLI
          FROM ${emp.sd2} D2
          LEFT JOIN ${emp.sc5} C5 
            ON C5.C5_FILIAL = D2.D2_FILIAL 
           AND C5.C5_NUM = D2.D2_PEDIDO 
           AND C5.D_E_L_E_T_ = ' '
          LEFT JOIN ${emp.sf2} F2 
            ON F2.F2_FILIAL = D2.D2_FILIAL 
           AND F2.F2_DOC = D2.D2_DOC 
           AND F2.D_E_L_E_T_ = ' '
          WHERE ${whereClause}
            AND D2.D_E_L_E_T_ = ' '
          ORDER BY D2.D2_EMISSAO DESC
        `;
      }

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        for (const row of dbRes.rows) {
          const pedVenda = row.PED_VENDA || '-';
          const nf = row.NF || '-';
          const seenKey = `${emp.key}_${pedVenda}_${nf}`;
          if (seen.has(seenKey)) continue;
          seen.add(seenKey);

          const freteCobrado = parseFloat(row.C5_FRETE || 0);
          const freteEmbutido = parseFloat(row.C5_VLR_FRT || 0);
          const valorNf = parseFloat(row.VALOR_NF || 0);
          const clientName = (row.C5_NOMECLI && String(row.C5_NOMECLI).trim()) 
            ? String(row.C5_NOMECLI).trim() 
            : emp.defaultClient;
          results.push({
            empresa: emp.nome,
            codWeb: row.C5_CODWEB || '-',
            pedVenda: pedVenda,
            nf: nf,
            valorNf: roundVal(valorNf),
            valorCobrado: roundVal(freteCobrado + freteEmbutido),
            nomeCli: clientName
          });
        }
      }
    } catch (err) {
      // Ignora e tenta a próxima empresa
    }
  }

  return results;
}

const VENDEDORES_MAP = {
  "000004": "Figueiredo",
  "000064": "Andrea",
  "000074": "Juliana",
  "4": "Figueiredo",
  "64": "Andrea",
  "74": "Juliana"
};

function getNomeVendedor(cod) {
  if (!cod) return '';
  const clean = String(cod).trim();
  const padded = clean.padStart(6, '0');
  return VENDEDORES_MAP[clean] || VENDEDORES_MAP[padded] || '';
}

/**
 * Consulta Pedidos de Venda para o módulo Vendedores
 * Permite buscar por CodWeb, Número do Pedido ou Nome do Cliente nas 3 empresas
 */
async function buscarPedidosVendedores({ codWeb, numPed, nomeCli, codVend } = {}) {
  const cleanCodWeb = sanitizeSqlParam(codWeb);
  const cleanNumPed = sanitizeSqlParam(numPed);
  const cleanNomeCli = sanitizeSqlParam(nomeCli);
  const cleanVend = sanitizeSqlParam(codVend);
  const paddedVend6 = cleanVend ? cleanVend.padStart(6, '0') : '';

  if (!cleanCodWeb && !cleanNumPed && !cleanNomeCli && !cleanVend) {
    return [];
  }

  const paddedPed6 = cleanNumPed ? cleanNumPed.padStart(6, '0') : '';
  const empresas = [
    { key: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", sc5: "SC5160" },
    { key: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", sc5: "SC5150" },
    { key: "METAL_PLENO", codigo: "14", nome: "Empresa 14 (METAL PLENO)", sc5: "SC5140" }
  ];

  const results = [];

  for (const emp of empresas) {
    try {
      const conditions = ["C5.D_E_L_E_T_ = ' '"];
      if (cleanCodWeb) {
        conditions.push(`(RTRIM(C5.C5_CODWEB) = '${cleanCodWeb}' OR C5.C5_CODWEB LIKE '%${cleanCodWeb}%')`);
      }
      if (cleanNumPed) {
        conditions.push(`(RTRIM(C5.C5_NUM) = '${paddedPed6}' OR RTRIM(C5.C5_NUM) = '${cleanNumPed}' OR C5.C5_NUM LIKE '%${cleanNumPed}%')`);
      }
      if (cleanNomeCli) {
        conditions.push(`(C5.C5_NOMECLI LIKE '%${cleanNomeCli}%')`);
      }
      if (cleanVend) {
        conditions.push(`(RTRIM(C5.C5_VEND1) = '${cleanVend}' OR RTRIM(C5.C5_VEND1) = '${paddedVend6}')`);
      }

      const sql = `
        SELECT TOP 30
            RTRIM(C5.C5_NUM) AS C5_NUM,
            RTRIM(ISNULL(C5.C5_CODWEB, '')) AS C5_CODWEB,
            RTRIM(ISNULL(C5.C5_NOTA, '')) AS C5_NOTA,
            RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS C5_NOMECLI,
            RTRIM(ISNULL(C5.C5_CLIENTE, '')) AS C5_CLIENTE,
            RTRIM(ISNULL(C5.C5_LOJACLI, '')) AS C5_LOJACLI,
            RTRIM(ISNULL(C5.C5_EMISSAO, '')) AS C5_EMISSAO,
            RTRIM(ISNULL(C5.C5_VEND1, '')) AS C5_VEND1,
            RTRIM(ISNULL(C5.C5_TRANSP, '')) AS C5_TRANSP,
            RTRIM(ISNULL(C5.C5_CONDPAG, '')) AS C5_CONDPAG
        FROM ${emp.sc5} C5
        WHERE ${conditions.join(' AND ')}
        ORDER BY C5.C5_EMISSAO DESC
      `;

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        for (const row of dbRes.rows) {
          results.push({
            empresa: emp.nome,
            empresaKey: emp.key,
            codWeb: row.C5_CODWEB || '-',
            numPed: row.C5_NUM || '-',
            notaFiscal: row.C5_NOTA ? String(row.C5_NOTA).trim() : '',
            nomeCli: row.C5_NOMECLI || 'CLIENTE NÃO INFORMADO',
            emissao: row.C5_EMISSAO || '',
            vendedor: getNomeVendedor(row.C5_VEND1),
            codVendedor: row.C5_VEND1 || ''
          });
        }
      }
    } catch (err) {
      console.warn(`Erro na consulta de pedidos da empresa ${emp.nome}:`, err.message);
    }
  }

  return results;
}

/**
 * Determina o status de Bloqueio de Estoque baseado no campo C9_BLEST (Regra Power BI)
 * Power BI: if [C9_BLEST] = "10" then "SEM BLOQ ESTOQ" else if [C9_BLEST] = "02" then "BLOQ POR ESTOQUE" else if not Text.Contains([C9_BLEST], "0") then "SEM BLOQ ESTOQ" else null
 */
function calcularStatusBloqueioEstoque(blest) {
  const s = String(blest || '').trim();
  if (!s) return 'SEM BLOQ ESTOQ';
  if (s === '10') return 'SEM BLOQ ESTOQ';
  if (s === '02') return 'BLOQ POR ESTOQUE';
  if (!s.includes('0')) return 'SEM BLOQ ESTOQ';
  return 'SEM BLOQ ESTOQ';
}

/**
 * Determina o status de Bloqueio de Crédito baseado no campo C9_BLCRED (Regra Power BI)
 * Power BI: if [C9_BLCRED] = "10" then "SEM BLOQ CREDITO" else if [C9_BLCRED] = "01" then "BLOQ NO CREDITO" else if not Text.Contains([C9_BLCRED], "1") then "SEM BLOQ CREDITO" else null
 */
function calcularStatusBloqueioCredito(blcred) {
  const s = String(blcred || '').trim();
  if (!s) return 'SEM BLOQ CREDITO';
  if (s === '10') return 'SEM BLOQ CREDITO';
  if (s === '01') return 'BLOQ NO CREDITO';
  if (!s.includes('1')) return 'SEM BLOQ CREDITO';
  return 'SEM BLOQ CREDITO';
}

/**
 * Consulta Pedidos de Venda Abertos (não faturados e não cancelados)
 * Junta SC5 e SC9 nas 3 empresas (OACO, GSI, METAL PLENO)
 */
async function buscarPedidosAbertosVendedores({ empresa, codVend } = {}) {
  const cleanEmpresa = sanitizeSqlParam(empresa || '').toUpperCase();
  const cleanVend = sanitizeSqlParam(codVend || '');
  const paddedVend6 = cleanVend ? cleanVend.padStart(6, '0') : '';

  const empresasConfig = [
    { key: "OACO", sigla: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", sc5: "SC5160", sc9: "SC9160" },
    { key: "GSI", sigla: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", sc5: "SC5150", sc9: "SC9150" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14", nome: "Empresa 14 (METAL PLENO)", sc5: "SC5140", sc9: "SC9140" }
  ];

  let empresasFiltradas = empresasConfig;
  if (cleanEmpresa && cleanEmpresa !== 'TODAS' && cleanEmpresa !== 'TODOS') {
    empresasFiltradas = empresasConfig.filter(e => 
      e.key === cleanEmpresa || 
      e.sigla === cleanEmpresa || 
      e.codigo === cleanEmpresa || 
      (cleanEmpresa === 'MP' && e.key === 'METAL_PLENO')
    );
    if (empresasFiltradas.length === 0) {
      empresasFiltradas = empresasConfig;
    }
  }

  const results = [];

  for (const emp of empresasFiltradas) {
    try {
      const conditions = [
        "C5.D_E_L_E_T_ = ' '",
        "(C5.C5_NOTA IS NULL OR RTRIM(C5.C5_NOTA) = '' OR RTRIM(C5.C5_NOTA) = '0')",
        "RTRIM(ISNULL(C5.C5_NOTA, '')) NOT LIKE 'X%'"
      ];

      if (cleanVend) {
        conditions.push(`(RTRIM(C5.C5_VEND1) = '${cleanVend}' OR RTRIM(C5.C5_VEND1) = '${paddedVend6}')`);
      } else {
        // Restringe estritamente aos 3 vendedores comerciais oficiais (Figueiredo, Andrea, Juliana), ignorando códigos internos (ex: 000029)
        conditions.push(`RTRIM(C5.C5_VEND1) IN ('000004', '000064', '000074', '4', '64', '74', '04')`);
      }

      const sql = `
        SELECT TOP 300
            RTRIM(C5.C5_FILIAL) AS C5_FILIAL,
            RTRIM(C5.C5_NUM) AS C5_NUM,
            RTRIM(ISNULL(C5.C5_CODWEB, '')) AS C5_CODWEB,
            RTRIM(ISNULL(C5.C5_NOTA, '')) AS C5_NOTA,
            RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS C5_NOMECLI,
            RTRIM(ISNULL(C5.C5_CLIENTE, '')) AS C5_CLIENTE,
            RTRIM(ISNULL(C5.C5_LOJACLI, '')) AS C5_LOJACLI,
            RTRIM(ISNULL(C5.C5_EMISSAO, '')) AS C5_EMISSAO,
            RTRIM(ISNULL(C5.C5_VEND1, '')) AS C5_VEND1,
            RTRIM(ISNULL(C9.MAX_BLEST, '')) AS C9_BLEST,
            RTRIM(ISNULL(C9.MAX_BLCRED, '')) AS C9_BLCRED
        FROM ${emp.sc5} C5
        LEFT JOIN (
            SELECT 
                C9_FILIAL,
                C9_PEDIDO,
                CASE 
                    WHEN SUM(CASE WHEN RTRIM(C9_BLEST) = '02' THEN 1 ELSE 0 END) > 0 THEN '02'
                    WHEN SUM(CASE WHEN RTRIM(C9_BLEST) = '10' THEN 1 ELSE 0 END) > 0 THEN '10'
                    ELSE MAX(RTRIM(C9_BLEST))
                END AS MAX_BLEST,
                CASE 
                    WHEN SUM(CASE WHEN RTRIM(C9_BLCRED) = '01' THEN 1 ELSE 0 END) > 0 THEN '01'
                    WHEN SUM(CASE WHEN RTRIM(C9_BLCRED) = '10' THEN 1 ELSE 0 END) > 0 THEN '10'
                    ELSE MAX(RTRIM(C9_BLCRED))
                END AS MAX_BLCRED
            FROM ${emp.sc9}
            WHERE D_E_L_E_T_ = ' '
            GROUP BY C9_FILIAL, C9_PEDIDO
        ) C9 ON C9.C9_FILIAL = C5.C5_FILIAL AND C9.C9_PEDIDO = C5.C5_NUM
        WHERE ${conditions.join(' AND ')}
        ORDER BY C5.C5_EMISSAO DESC, C5.C5_NUM DESC
      `;

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        for (const row of dbRes.rows) {
          results.push({
            empresa: emp.sigla,
            empresaNome: emp.nome,
            empresaKey: emp.key,
            codWeb: row.C5_CODWEB || '-',
            numPed: row.C5_NUM || '-',
            bloqCredito: calcularStatusBloqueioCredito(row.C9_BLCRED),
            bloqEstoque: calcularStatusBloqueioEstoque(row.C9_BLEST),
            codBlCred: row.C9_BLCRED || '',
            codBlEst: row.C9_BLEST || '',
            vendedor: getNomeVendedor(row.C5_VEND1) || row.C5_VEND1 || 'NÃO INFORMADO',
            codVendedor: row.C5_VEND1 || '',
            nomeCli: row.C5_NOMECLI || 'CLIENTE NÃO INFORMADO',
            emissao: row.C5_EMISSAO || ''
          });
        }
      }
    } catch (err) {
      console.warn(`Erro na consulta de pedidos abertos da empresa ${emp.nome}:`, err.message);
    }
  }

  // Ordenação global por data de emissão decrescente
  results.sort((a, b) => (b.emissao || '').localeCompare(a.emissao || '') || (b.numPed || '').localeCompare(a.numPed || ''));

  return results;
}

function formatarDataProtheus(dt) {
  const s = String(dt || '').trim();
  if (s.length === 8) {
    return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  }
  return s || '-';
}

/**
 * Consulta Pedidos de Compras em Aberto (SC7) nas 3 empresas (OACO, GSI, METAL PLENO)
 * Retorna produtos com saldo pendente a receber (C7_QUANT - C7_QUJE > 0) e previsão de entrega (C7_DATPRF)
 */
async function buscarPedidosCompras({ empresa, search } = {}) {
  const cleanEmpresa = sanitizeSqlParam(empresa || '').toUpperCase();
  const cleanSearch = sanitizeSqlParam(search || '');

  const empresasConfig = [
    { key: "OACO", sigla: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", sc7: "SC7160" },
    { key: "GSI", sigla: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", sc7: "SC7150" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14", nome: "Empresa 14 (METAL PLENO)", sc7: "SC7140" }
  ];

  let empresasFiltradas = empresasConfig;
  if (cleanEmpresa && cleanEmpresa !== 'TODAS' && cleanEmpresa !== 'TODOS') {
    empresasFiltradas = empresasConfig.filter(e => 
      e.key === cleanEmpresa || 
      e.sigla === cleanEmpresa || 
      e.codigo === cleanEmpresa || 
      (cleanEmpresa === 'MP' && e.key === 'METAL_PLENO')
    );
    if (empresasFiltradas.length === 0) {
      empresasFiltradas = empresasConfig;
    }
  }

  const results = [];

  for (const emp of empresasFiltradas) {
    try {
      const conditions = [
        "C7.D_E_L_E_T_ = ' '",
        "(ISNULL(C7.C7_QUANT, 0) - ISNULL(C7.C7_QUJE, 0)) > 0",
        "(C7.C7_RESIDUO IS NULL OR RTRIM(C7.C7_RESIDUO) <> 'S')",
        "RTRIM(C7.C7_PRODUTO) >= '001000000000000'",
        "RTRIM(C7.C7_PRODUTO) <= '019999999999999'"
      ];

      if (cleanSearch) {
        conditions.push(`(
          C7.C7_DESCRI LIKE '%${cleanSearch}%' OR 
          C7.C7_PRODUTO LIKE '%${cleanSearch}%' OR 
          C7.C7_NUM LIKE '%${cleanSearch}%' OR 
          C7.C7_FORNECE LIKE '%${cleanSearch}%'
        )`);
      }

      const sql = `
        SELECT TOP 500
            RTRIM(C7.C7_FILIAL) AS C7_FILIAL,
            RTRIM(C7.C7_NUM) AS C7_NUM,
            RTRIM(ISNULL(C7.C7_ITEM, '')) AS C7_ITEM,
            RTRIM(ISNULL(C7.C7_PRODUTO, '')) AS C7_PRODUTO,
            RTRIM(ISNULL(C7.C7_DESCRI, '')) AS C7_DESCRI,
            ISNULL(C7.C7_QUANT, 0) AS C7_QUANT,
            ISNULL(C7.C7_QUJE, 0) AS C7_QUJE,
            (ISNULL(C7.C7_QUANT, 0) - ISNULL(C7.C7_QUJE, 0)) AS SALDO_QUANT,
            RTRIM(ISNULL(C7.C7_DATPRF, '')) AS C7_DATPRF,
            RTRIM(ISNULL(C7.C7_EMISSAO, '')) AS C7_EMISSAO,
            RTRIM(ISNULL(C7.C7_FORNECE, '')) AS C7_FORNECE,
            ISNULL((SELECT TOP 1 RTRIM(A2_NOME) FROM SA2010 WHERE A2_COD = C7.C7_FORNECE AND D_E_L_E_T_ = ' '), ISNULL(C7.C7_FORNECE, '')) AS FORNECEDOR
        FROM ${emp.sc7} C7
        WHERE ${conditions.join(' AND ')}
        ORDER BY C7.C7_DATPRF ASC, C7.C7_DESCRI ASC
      `;

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        for (const row of dbRes.rows) {
          const pedNum = String(row.C7_NUM || '').trim();
          const pedCom = `${emp.sigla}${pedNum}`;
          const saldo = Math.max(0, Number(row.SALDO_QUANT) || (Number(row.C7_QUANT || 0) - Number(row.C7_QUJE || 0)));
          const codProd = String(row.C7_PRODUTO || '').trim();

          // Validação defensiva da Faixa de Códigos PA (001000000000000 a 019999999999999)
          if (codProd && (codProd < '001000000000000' || codProd > '019999999999999')) continue;

          results.push({
            empresa: emp.sigla,
            empresaNome: emp.nome,
            empresaKey: emp.key,
            pedCom: pedCom,
            numPed: pedNum,
            item: row.C7_ITEM || '',
            codProduto: codProd,
            tipo: 'PA',
            descricao: row.C7_DESCRI || 'PRODUTO SEM DESCRIÇÃO',
            qtdOriginal: Number(row.C7_QUANT) || 0,
            qtdEntregue: Number(row.C7_QUJE) || 0,
            saldoCompras: saldo,
            previsao: formatarDataProtheus(row.C7_DATPRF),
            previsaoRaw: row.C7_DATPRF || '',
            emissao: formatarDataProtheus(row.C7_EMISSAO),
            emissaoRaw: row.C7_EMISSAO || '',
            codFornecedor: row.C7_FORNECE || '',
            fornecedor: row.FORNECEDOR || row.C7_FORNECE || '-'
          });
        }
      }
    } catch (err) {
      console.warn(`Erro na consulta de pedidos de compras da empresa ${emp.nome}:`, err.message);
    }
  }

  // Ordenação global inicial por data de previsão ascendente (mais próximas primeiro)
  results.sort((a, b) => {
    if (a.previsaoRaw && b.previsaoRaw) {
      return a.previsaoRaw.localeCompare(b.previsaoRaw);
    }
    return (a.descricao || '').localeCompare(b.descricao || '');
  });

  return results;
}

/**
 * Consulta consolidada multi-empresa de Pedidos de Compras em Aberto (SC7)
 * Agrupa linhas por pedido de compra, identifica entregas atrasadas (< hoje) e calcula saldos e totais.
 */
async function buscarPedidosComprasAbertosConsolidado({ empresa, search, statusPrazo } = {}) {
  const cleanEmpresa = sanitizeSqlParam(empresa || '').toUpperCase();
  const cleanSearch = sanitizeSqlParam(search || '');
  const cleanStatusPrazo = String(statusPrazo || '').trim().toUpperCase();

  const empresasConfig = [
    { key: "OACO", sigla: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", sc7: "SC7160" },
    { key: "GSI", sigla: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", sc7: "SC7150" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14", nome: "Empresa 14 (METAL PLENO)", sc7: "SC7140" }
  ];

  let empresasFiltradas = empresasConfig;
  if (cleanEmpresa && cleanEmpresa !== 'TODAS' && cleanEmpresa !== 'TODOS') {
    empresasFiltradas = empresasConfig.filter(e => 
      e.key === cleanEmpresa || 
      e.sigla === cleanEmpresa || 
      e.codigo === cleanEmpresa || 
      (cleanEmpresa === 'MP' && e.key === 'METAL_PLENO')
    );
    if (empresasFiltradas.length === 0) {
      empresasFiltradas = empresasConfig;
    }
  }

  // Obter data atual de hoje em formato Protheus YYYYMMDD (Fuso horário de Brasília)
  const agora = new Date();
  const spTime = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const yyyy = spTime.getFullYear();
  const mm = String(spTime.getMonth() + 1).padStart(2, '0');
  const dd = String(spTime.getDate()).padStart(2, '0');
  const hojeRaw = `${yyyy}${mm}${dd}`;
  const hojeDate = new Date(yyyy, spTime.getMonth(), spTime.getDate());

  const results = [];

  for (const emp of empresasFiltradas) {
    try {
      const conditions = [
        "C7.D_E_L_E_T_ = ' '",
        "(ISNULL(C7.C7_QUANT, 0) - ISNULL(C7.C7_QUJE, 0)) > 0",
        "(C7.C7_RESIDUO IS NULL OR RTRIM(C7.C7_RESIDUO) <> 'S')",
        "(C7.C7_ENCER IS NULL OR RTRIM(C7.C7_ENCER) <> 'E')"
      ];

      if (cleanSearch) {
        conditions.push(`(
          C7.C7_NUM LIKE '%${cleanSearch}%' OR 
          C7.C7_FORNECE LIKE '%${cleanSearch}%' OR 
          C7.C7_NOMFOR LIKE '%${cleanSearch}%' OR 
          C7.C7_PRODUTO LIKE '%${cleanSearch}%' OR 
          C7.C7_DESCRI LIKE '%${cleanSearch}%'
        )`);
      }

      const sql = `
        SELECT 
          RTRIM(C7.C7_NUM) AS NUM_PED,
          RTRIM(C7.C7_FORNECE) AS COD_FORNEC,
          ISNULL((SELECT TOP 1 RTRIM(A2_NOME) FROM SA2010 WHERE A2_COD = C7.C7_FORNECE AND D_E_L_E_T_ = ' '), RTRIM(ISNULL(C7.C7_NOMFOR, ''))) AS NOME_FORNEC,
          MIN(RTRIM(C7.C7_EMISSAO)) AS EMISSAO,
          MIN(RTRIM(C7.C7_DATPRF)) AS DATA_ENTREGA,
          COUNT(*) AS TOTAL_ITENS,
          SUM(ISNULL(C7.C7_QUANT, 0)) AS QTD_TOTAL,
          SUM(ISNULL(C7.C7_QUJE, 0)) AS QTD_ENTREGUE,
          SUM(ISNULL(C7.C7_QUANT, 0) - ISNULL(C7.C7_QUJE, 0)) AS SALDO_TOTAL,
          SUM(ISNULL(C7.C7_TOTAL, 0)) AS VALOR_TOTAL
        FROM ${emp.sc7} C7
        WHERE ${conditions.join(' AND ')}
        GROUP BY C7.C7_NUM, C7.C7_FORNECE, C7.C7_NOMFOR
        ORDER BY MIN(C7.C7_DATPRF) ASC, C7.C7_NUM ASC
      `;

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        for (const row of dbRes.rows) {
          const pedNum = String(row.NUM_PED || '').trim();
          const dataEntregaRaw = String(row.DATA_ENTREGA || '').trim();
          let diasAtraso = 0;
          let statusPrazoItem = 'NO_PRAZO';

          if (dataEntregaRaw && dataEntregaRaw.length === 8) {
            const pAno = parseInt(dataEntregaRaw.substring(0, 4), 10);
            const pMes = parseInt(dataEntregaRaw.substring(4, 6), 10) - 1;
            const pDia = parseInt(dataEntregaRaw.substring(6, 8), 10);
            const entregaDate = new Date(pAno, pMes, pDia);

            if (dataEntregaRaw < hojeRaw) {
              statusPrazoItem = 'ATRASADO';
              const diffMs = hojeDate.getTime() - entregaDate.getTime();
              diasAtraso = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
            } else if (dataEntregaRaw === hojeRaw) {
              statusPrazoItem = 'HOJE';
              diasAtraso = 0;
            } else {
              statusPrazoItem = 'NO_PRAZO';
              diasAtraso = 0;
            }
          }

          if (cleanStatusPrazo && cleanStatusPrazo !== 'TODOS' && cleanStatusPrazo !== 'TODAS') {
            if (cleanStatusPrazo === 'ATRASADOS' || cleanStatusPrazo === 'ATRASADO') {
              if (statusPrazoItem !== 'ATRASADO') continue;
            } else if (cleanStatusPrazo === 'HOJE') {
              if (statusPrazoItem !== 'HOJE') continue;
            } else if (cleanStatusPrazo === 'NO_PRAZO') {
              if (statusPrazoItem !== 'NO_PRAZO') continue;
            }
          }

          results.push({
            empresa: emp.sigla,
            empresaNome: emp.nome,
            empresaKey: emp.key,
            numPed: pedNum,
            pedCom: `${emp.sigla}${pedNum}`,
            codFornecedor: row.COD_FORNEC || '',
            fornecedor: row.NOME_FORNEC || row.COD_FORNEC || 'FORNECEDOR NÃO INFORMADO',
            emissao: formatarDataProtheus(row.EMISSAO),
            emissaoRaw: row.EMISSAO || '',
            dataEntrega: formatarDataProtheus(row.DATA_ENTREGA),
            dataEntregaRaw: dataEntregaRaw,
            diasAtraso: diasAtraso,
            statusPrazo: statusPrazoItem,
            totalItens: Number(row.TOTAL_ITENS) || 0,
            qtdTotal: Number(row.QTD_TOTAL) || 0,
            qtdEntregue: Number(row.QTD_ENTREGUE) || 0,
            saldoTotal: Math.max(0, Number(row.SALDO_TOTAL) || 0),
            valorTotal: Number(row.VALOR_TOTAL) || 0
          });
        }
      }
    } catch (err) {
      console.warn(`Erro na consulta de pedidos de compras em aberto da empresa ${emp.nome}:`, err.message);
    }
  }

  // Ordenação global inicial: mais atrasados e com menor data de entrega primeiro
  results.sort((a, b) => {
    if (a.dataEntregaRaw && b.dataEntregaRaw) {
      return a.dataEntregaRaw.localeCompare(b.dataEntregaRaw);
    }
    return (a.numPed || '').localeCompare(b.numPed || '');
  });

  return results;
}

/**
 * Consulta Detalhes Completos de um Pedido de Compra (SC7 + SA2 + SE4)
 */
async function obterDetalhesPedidoCompra({ empresaKey, numPedido } = {}) {
  const cleanEmp = sanitizeSqlParam(empresaKey || 'OACO').toUpperCase();
  const cleanNumPed = sanitizeSqlParam(numPedido || '');

  if (!cleanNumPed) {
    throw new Error('Número do pedido de compra não informado.');
  }

  const empresasConfig = {
    'OACO': { sigla: 'OACO', nome: 'Empresa 16 (OACO)', sc7: 'SC7160' },
    '16': { sigla: 'OACO', nome: 'Empresa 16 (OACO)', sc7: 'SC7160' },
    'GSI': { sigla: 'GSI', nome: 'Empresa 15 (GSI)', sc7: 'SC7150' },
    '15': { sigla: 'GSI', nome: 'Empresa 15 (GSI)', sc7: 'SC7150' },
    'METAL_PLENO': { sigla: 'MP', nome: 'Empresa 14 (METAL PLENO)', sc7: 'SC7140' },
    'MP': { sigla: 'MP', nome: 'Empresa 14 (METAL PLENO)', sc7: 'SC7140' },
    '14': { sigla: 'MP', nome: 'Empresa 14 (METAL PLENO)', sc7: 'SC7140' }
  };

  const emp = empresasConfig[cleanEmp] || empresasConfig['OACO'];

  // Data atual de hoje para cálculo de atrasos
  const agora = new Date();
  const spTime = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const yyyy = spTime.getFullYear();
  const mm = String(spTime.getMonth() + 1).padStart(2, '0');
  const dd = String(spTime.getDate()).padStart(2, '0');
  const hojeRaw = `${yyyy}${mm}${dd}`;
  const hojeDate = new Date(yyyy, spTime.getMonth(), spTime.getDate());

  const sql = `
    SELECT 
      RTRIM(C7.C7_FILIAL) AS C7_FILIAL,
      RTRIM(C7.C7_NUM) AS C7_NUM,
      RTRIM(C7.C7_ITEM) AS C7_ITEM,
      RTRIM(C7.C7_PRODUTO) AS C7_PRODUTO,
      RTRIM(C7.C7_DESCRI) AS C7_DESCRI,
      RTRIM(ISNULL(C7.C7_UM, 'UN')) AS C7_UM,
      ISNULL(C7.C7_QUANT, 0) AS C7_QUANT,
      ISNULL(C7.C7_QUJE, 0) AS C7_QUJE,
      (ISNULL(C7.C7_QUANT, 0) - ISNULL(C7.C7_QUJE, 0)) AS SALDO,
      ISNULL(C7.C7_PRECO, 0) AS C7_PRECO,
      ISNULL(C7.C7_TOTAL, 0) AS C7_TOTAL,
      ISNULL(C7.C7_VALIPI, 0) AS C7_VALIPI,
      ISNULL(C7.C7_VALICM, 0) AS C7_VALICM,
      RTRIM(ISNULL(C7.C7_TES, '')) AS C7_TES,
      RTRIM(ISNULL(C7.C7_DATPRF, '')) AS C7_DATPRF,
      RTRIM(ISNULL(C7.C7_EMISSAO, '')) AS C7_EMISSAO,
      RTRIM(ISNULL(C7.C7_FORNECE, '')) AS C7_FORNECE,
      RTRIM(ISNULL(C7.C7_LOJA, '')) AS C7_LOJA,
      RTRIM(ISNULL(C7.C7_NOMFOR, '')) AS C7_NOMFOR,
      RTRIM(ISNULL(C7.C7_CONTATO, '')) AS C7_CONTATO,
      RTRIM(ISNULL(C7.C7_COND, '')) AS C7_COND,
      RTRIM(ISNULL(C7.C7_OBS, '')) AS C7_OBS,
      RTRIM(ISNULL(C7.C7_SOLICIT, '')) AS C7_SOLICIT,
      RTRIM(ISNULL(C7.C7_USER, '')) AS C7_USER,
      ISNULL((SELECT TOP 1 RTRIM(A2_NOME) FROM SA2010 WHERE A2_COD = C7.C7_FORNECE AND D_E_L_E_T_ = ' '), RTRIM(ISNULL(C7.C7_NOMFOR, ''))) AS NOME_FORNEC_SA2,
      ISNULL((SELECT TOP 1 RTRIM(A2_CGC) FROM SA2010 WHERE A2_COD = C7.C7_FORNECE AND D_E_L_E_T_ = ' '), '') AS CNPJ_FORNEC,
      ISNULL((SELECT TOP 1 RTRIM(A2_TEL) FROM SA2010 WHERE A2_COD = C7.C7_FORNECE AND D_E_L_E_T_ = ' '), '') AS TEL_FORNEC,
      ISNULL((SELECT TOP 1 RTRIM(A2_EMAIL) FROM SA2010 WHERE A2_COD = C7.C7_FORNECE AND D_E_L_E_T_ = ' '), '') AS EMAIL_FORNEC,
      ISNULL((SELECT TOP 1 RTRIM(E4_DESCRI) FROM SE4010 WHERE E4_CODIGO = C7.C7_COND AND D_E_L_E_T_ = ' '), RTRIM(ISNULL(C7.C7_COND, ''))) AS COND_PAGTO_DESC
    FROM ${emp.sc7} C7
    WHERE C7.D_E_L_E_T_ = ' ' AND C7.C7_NUM = '${cleanNumPed}'
    ORDER BY C7.C7_ITEM ASC
  `;

  const dbRes = await executeRailwayQuery(sql);
  if (!dbRes || !dbRes.rows || dbRes.rows.length === 0) {
    return null;
  }

  const firstRow = dbRes.rows[0];
  const itens = [];
  let somaQtd = 0;
  let somaQuje = 0;
  let somaSaldo = 0;
  let somaTotal = 0;
  let menorPrevisaoRaw = '';

  for (const r of dbRes.rows) {
    const qtd = Number(r.C7_QUANT) || 0;
    const quje = Number(r.C7_QUJE) || 0;
    const saldo = Math.max(0, (Number(r.SALDO) || (qtd - quje)));
    const preco = Number(r.C7_PRECO) || 0;
    const total = Number(r.C7_TOTAL) || (qtd * preco);
    const prevRaw = String(r.C7_DATPRF || '').trim();

    somaQtd += qtd;
    somaQuje += quje;
    somaSaldo += saldo;
    somaTotal += total;

    if (prevRaw && (!menorPrevisaoRaw || prevRaw < menorPrevisaoRaw)) {
      menorPrevisaoRaw = prevRaw;
    }

    let diasAtrasoItem = 0;
    let statusPrazoItem = 'NO_PRAZO';

    if (prevRaw && prevRaw.length === 8) {
      const pAno = parseInt(prevRaw.substring(0, 4), 10);
      const pMes = parseInt(prevRaw.substring(4, 6), 10) - 1;
      const pDia = parseInt(prevRaw.substring(6, 8), 10);
      const entregaDate = new Date(pAno, pMes, pDia);

      if (prevRaw < hojeRaw) {
        statusPrazoItem = 'ATRASADO';
        const diffMs = hojeDate.getTime() - entregaDate.getTime();
        diasAtrasoItem = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      } else if (prevRaw === hojeRaw) {
        statusPrazoItem = 'HOJE';
        diasAtrasoItem = 0;
      }
    }

    itens.push({
      item: r.C7_ITEM || '0001',
      produto: r.C7_PRODUTO || '',
      descricao: r.C7_DESCRI || 'PRODUTO SEM DESCRIÇÃO',
      um: r.C7_UM || 'UN',
      qtd: qtd,
      quje: quje,
      saldo: saldo,
      precoUnit: preco,
      total: total,
      valIpi: Number(r.C7_VALIPI) || 0,
      valIcm: Number(r.C7_VALICM) || 0,
      tes: r.C7_TES || '',
      previsao: formatarDataProtheus(prevRaw),
      previsaoRaw: prevRaw,
      diasAtraso: diasAtrasoItem,
      statusPrazo: statusPrazoItem,
      obs: r.C7_OBS || ''
    });
  }

  let statusGeral = 'NO_PRAZO';
  let diasAtrasoGeral = 0;
  if (menorPrevisaoRaw && menorPrevisaoRaw < hojeRaw) {
    statusGeral = 'ATRASADO';
    const pAno = parseInt(menorPrevisaoRaw.substring(0, 4), 10);
    const pMes = parseInt(menorPrevisaoRaw.substring(4, 6), 10) - 1;
    const pDia = parseInt(menorPrevisaoRaw.substring(6, 8), 10);
    const entregaDate = new Date(pAno, pMes, pDia);
    const diffMs = hojeDate.getTime() - entregaDate.getTime();
    diasAtrasoGeral = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  } else if (menorPrevisaoRaw === hojeRaw) {
    statusGeral = 'HOJE';
  }

  return {
    cabecalho: {
      empresa: emp.sigla,
      empresaNome: emp.nome,
      empresaKey: cleanEmp,
      numPed: cleanNumPed,
      pedCom: `${emp.sigla}${cleanNumPed}`,
      emissao: formatarDataProtheus(firstRow.C7_EMISSAO),
      emissaoRaw: firstRow.C7_EMISSAO || '',
      codFornecedor: firstRow.C7_FORNECE || '',
      lojaFornecedor: firstRow.C7_LOJA || '',
      nomeFornecedor: firstRow.NOME_FORNEC_SA2 || firstRow.C7_NOMFOR || firstRow.C7_FORNECE || 'NÃO INFORMADO',
      cnpjFornecedor: firstRow.CNPJ_FORNEC || '',
      telFornecedor: firstRow.TEL_FORNEC || '',
      emailFornecedor: firstRow.EMAIL_FORNEC || '',
      contatoFornecedor: firstRow.C7_CONTATO || '',
      condPagtoCod: firstRow.C7_COND || '',
      condPagtoDesc: firstRow.COND_PAGTO_DESC || firstRow.C7_COND || '',
      solicitante: firstRow.C7_SOLICIT || '',
      usuario: firstRow.C7_USER || '',
      previsaoGeral: formatarDataProtheus(menorPrevisaoRaw),
      previsaoGeralRaw: menorPrevisaoRaw,
      statusPrazo: statusGeral,
      diasAtraso: diasAtrasoGeral
    },
    totais: {
      totalItens: itens.length,
      qtdTotal: somaQtd,
      qtdEntregue: somaQuje,
      saldoTotal: somaSaldo,
      valorTotal: somaTotal
    },
    itens: itens
  };
}

/**
 * Detecta se o pedido possui endereço de entrega diferente do cadastro
 * Regra Dupla:
 * 1. C5_TRANSP = '000009' (ou '9', transportadora especial / retira / redespacho)
 * 2. C5_MENNOTA contém marcadores de endereço de entrega alternativo
 * 
 * @param {string} mennota - Texto do campo C5_MENNOTA
 * @param {string} codTransp - Código da transportadora C5_TRANSP
 * @returns {{
 *   temEnderecoDiferente: boolean,
 *   motivo: string,
 *   enderecoExtraido: string,
 *   origem: 'TRANSP_000009' | 'MENNOTA' | 'AMBOS' | 'NENHUM'
 * }}
 */
function detectarEnderecoEntregaDiferente(mennota, codTransp) {
  const cleanTransp = String(codTransp || '').trim();
  const digitsTransp = cleanTransp.replace(/\D/g, '');
  const isTransp09 = cleanTransp.padStart(6, '0') === '000009' || digitsTransp === '9' || cleanTransp === '000009';

  let hasMennotaAddress = false;
  let enderecoExtraido = '';

  const rawMennota = String(mennota || '').trim();
  if (rawMennota) {
    // Regex robusta para capturar padrões de endereço de entrega em C5_MENNOTA
    const regex = /(?:END(?:ERE[CÇ]O)?(?:\s+DE)?\s+ENTREGA|LOCAL(?:\s+DE)?\s+ENTREGA|ENTREGAR?\s+(?:EM|NA|NO|PARA)|END\.\s*ENTREGA)[:\s]+([\s\S]+?)(?=(?:PED\s+LOJA|FRETE|COT|AC\s|TEL\s|PAGAMENTO|BANCO|HOR[AÁ]RIO|Ped\s+Venda|Cod\s+Web|$))/i;
    const match = rawMennota.match(regex);
    if (match && match[1]) {
      const candidate = match[1].replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
      const isApenasHorario = /^(?:[0-2]?[0-9]H|SEG|TER|QUA|QUI|SEX|DAS\s+\d)/i.test(candidate);
      if (candidate.length > 5 && !isApenasHorario) {
        hasMennotaAddress = true;
        enderecoExtraido = candidate;
      }
    }
  }

  if (isTransp09 && hasMennotaAddress) {
    return {
      temEnderecoDiferente: true,
      motivo: `Transportadora 000009 + Endereço em C5_MENNOTA: ${enderecoExtraido}`,
      enderecoExtraido: enderecoExtraido,
      origem: 'AMBOS'
    };
  }

  if (isTransp09) {
    return {
      temEnderecoDiferente: true,
      motivo: 'Transportadora 000009 (Cliente Retira / Redespacho Próprio)',
      enderecoExtraido: '',
      origem: 'TRANSP_000009'
    };
  }

  if (hasMennotaAddress) {
    return {
      temEnderecoDiferente: true,
      motivo: `Endereço alternativo em C5_MENNOTA: ${enderecoExtraido}`,
      enderecoExtraido: enderecoExtraido,
      origem: 'MENNOTA'
    };
  }

  return {
    temEnderecoDiferente: false,
    motivo: 'Conforme endereço de cadastro Protheus (SA1)',
    enderecoExtraido: '',
    origem: 'NENHUM'
  };
}

/**
 * Consulta os Detalhes Completos do Pedido de Venda
 * Retorna dados cadastrais, endereço, transporte, condição de pagamento e itens (SC6)
 */
async function obterDetalhesPedido(empresaKey = "OACO", numPedido) {
  const cleanPed = sanitizeSqlParam(numPedido);
  const paddedPed6 = cleanPed.padStart(6, '0');
  const empMap = {
    "OACO": { codigo: "16", nome: "Empresa 16 (OACO)", sc5: "SC5160", sc6: "SC6160", se1: "SE1160" },
    "GSI": { codigo: "15", nome: "Empresa 15 (GSI)", sc5: "SC5150", sc6: "SC6150", se1: "SE1150" },
    "METAL_PLENO": { codigo: "14", nome: "Empresa 14 (METAL PLENO)", sc5: "SC5140", sc6: "SC6140", se1: "SE1140" }
  };
  const emp = empMap[empresaKey] || empMap["OACO"];

  try {
    const sqlC5 = `
      SELECT TOP 1
        RTRIM(C5.C5_NUM) AS NUM_PEDIDO,
        RTRIM(ISNULL(C5.C5_CODWEB, '')) AS COD_WEB,
        RTRIM(ISNULL(C5.C5_NOTA, '')) AS NOTA_FISCAL,
        RTRIM(ISNULL(C5.C5_EMISSAO, '')) AS EMISSAO,
        RTRIM(ISNULL(C5.C5_CLIENTE, '')) AS COD_CLI,
        RTRIM(ISNULL(C5.C5_LOJACLI, '')) AS LOJA_CLI,
        RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS NOME_CLI,
        RTRIM(ISNULL(C5.C5_TRANSP, '')) AS TRANSP,
        RTRIM(ISNULL(C5.C5_CONDPAG, '')) AS CONDPAG,
        RTRIM(ISNULL(C5.C5_VEND1, '')) AS VEND1,
        ISNULL(C5.C5_FRETE, 0) AS FRETE,
        ISNULL(C5.C5_VLR_FRT, 0) AS FRETE_EMBUTIDO,
        ISNULL(C5.C5_DESCONT, 0) AS DESCONTO,
        RTRIM(ISNULL(C5.C5_MENNOTA, '')) AS OBS
      FROM ${emp.sc5} C5
      WHERE (C5.C5_NUM = '${paddedPed6}' OR C5.C5_NUM = '${cleanPed}')
        AND C5.D_E_L_E_T_ = ' '
    `;

    const resC5 = await executeRailwayQuery(sqlC5);
    const head = (resC5 && resC5.rows && resC5.rows.length > 0) ? resC5.rows[0] : null;

    let cliInfo = {
      codigo: head ? head.COD_CLI : '',
      loja: head ? head.LOJA_CLI : '',
      nome: head ? head.NOME_CLI : '',
      cnpj: '',
      endereco: '',
      bairro: '',
      cidade: '',
      uf: '',
      cep: '',
      telefone: '',
      email: '',
      contato: ''
    };

    if (head && head.COD_CLI) {
      try {
        const cleanCodCli = sanitizeSqlParam(head.COD_CLI);
        const paddedCodCli = cleanCodCli.padStart(6, '0');
        const sqlSA1 = `
          SELECT TOP 1
            RTRIM(ISNULL(A1_NOME, '')) AS A1_NOME,
            RTRIM(ISNULL(A1_CGC, '')) AS A1_CGC,
            RTRIM(ISNULL(A1_END, '')) AS A1_END,
            RTRIM(ISNULL(A1_COMPLEM, '')) AS A1_COMPLEM,
            RTRIM(ISNULL(A1_BAIRRO, '')) AS A1_BAIRRO,
            RTRIM(ISNULL(A1_MUN, '')) AS A1_MUN,
            RTRIM(ISNULL(A1_EST, '')) AS A1_EST,
            RTRIM(ISNULL(A1_CEP, '')) AS A1_CEP,
            RTRIM(ISNULL(A1_TEL, '')) AS A1_TEL,
            RTRIM(ISNULL(A1_EMAIL, '')) AS A1_EMAIL,
            RTRIM(ISNULL(A1_HPAGE, '')) AS A1_HPAGE,
            RTRIM(ISNULL(A1_CONTATO, '')) AS A1_CONTATO
          FROM SA1010
          WHERE (A1_COD = '${cleanCodCli}' OR A1_COD = '${paddedCodCli}') 
            AND D_E_L_E_T_ = ' '
        `;
        const resSA1 = await executeRailwayQuery(sqlSA1);
        if (resSA1 && resSA1.rows && resSA1.rows.length > 0) {
          const a1 = resSA1.rows[0];
          
          // Formata CNPJ (14 dígitos) ou CPF (11 dígitos)
          let cgcFormatado = a1.A1_CGC || '';
          const cgcDigits = cgcFormatado.replace(/\D/g, '');
          if (cgcDigits.length === 11) {
            cgcFormatado = cgcDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
          } else if (cgcDigits.length === 14) {
            cgcFormatado = cgcDigits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
          }

          // Formata CEP (8 dígitos)
          let cepFormatado = a1.A1_CEP || '';
          const cepDigits = cepFormatado.replace(/\D/g, '');
          if (cepDigits.length === 8) {
            cepFormatado = cepDigits.replace(/(\d{5})(\d{3})/, '$1-$2');
          }

          // Formata Telefone
          let telFormatado = a1.A1_TEL || '';
          const telDigits = telFormatado.replace(/\D/g, '');
          if (telDigits.length === 10) {
            telFormatado = telDigits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
          } else if (telDigits.length === 11) {
            telFormatado = telDigits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
          }

          // Monta Endereço + Complemento
          let enderecoCompleto = a1.A1_END || '';
          if (a1.A1_COMPLEM && a1.A1_COMPLEM.trim()) {
            enderecoCompleto += (enderecoCompleto ? ', ' : '') + a1.A1_COMPLEM.trim();
          }

          cliInfo.nome = a1.A1_NOME ? a1.A1_NOME.trim() : cliInfo.nome;
          cliInfo.cnpj = cgcFormatado;
          cliInfo.endereco = enderecoCompleto;
          cliInfo.bairro = a1.A1_BAIRRO ? a1.A1_BAIRRO.trim() : '';
          cliInfo.cidade = a1.A1_MUN ? a1.A1_MUN.trim() : '';
          cliInfo.uf = a1.A1_EST ? a1.A1_EST.trim() : '';
          cliInfo.cep = cepFormatado;
          cliInfo.telefone = telFormatado || (a1.A1_TEL ? a1.A1_TEL.trim() : '');
          cliInfo.email = a1.A1_EMAIL ? a1.A1_EMAIL.trim() : '';
          cliInfo.site = a1.A1_HPAGE ? a1.A1_HPAGE.trim() : '';
          cliInfo.contato = a1.A1_CONTATO ? a1.A1_CONTATO.trim() : '';
        }
      } catch (errSA1) {
        console.warn('Erro ao consultar SA1010:', errSA1.message);
      }
    }

    // Consulta Condição de Pagamento (SE4) para obter E4_COND e E4_CTRADT
    let condPagInfo = {
      codigo: head ? (head.CONDPAG || '').trim() : '',
      descricao: '',
      e4_cond: '',
      e4_ctradt: '',
      possuiEntrada: 'N',
      faturado: 'N'
    };

    if (head && head.CONDPAG) {
      try {
        const cleanCond = sanitizeSqlParam(head.CONDPAG);
        const paddedCond = cleanCond.padStart(3, '0');
        const sqlSE4 = `
          SELECT TOP 1
            RTRIM(ISNULL(E4_CODIGO, '')) AS E4_CODIGO,
            RTRIM(ISNULL(E4_COND, '')) AS E4_COND,
            RTRIM(ISNULL(E4_CTRADT, '')) AS E4_CTRADT,
            RTRIM(ISNULL(E4_DESCRI, '')) AS E4_DESCRI
          FROM SE4010
          WHERE (E4_CODIGO = '${cleanCond}' OR E4_CODIGO = '${paddedCond}')
            AND D_E_L_E_T_ = ' '
        `;
        let resSE4 = await executeRailwayQuery(sqlSE4);

        if (resSE4 && resSE4.rows && resSE4.rows.length > 0) {
          const rowE4 = resSE4.rows[0];
          const e4Cond = (rowE4.E4_COND || '').trim();
          const e4Ctradt = String(rowE4.E4_CTRADT || '').trim();

          // Regra 1: E4_CTRADT = '1' OU se E4_COND contiver '00,' no início (ex: '00,15') -> possui entrada
          const hasEntrada = (e4Ctradt === '1' || e4Cond.startsWith('00,') || e4Cond.startsWith('0,'));
          
          // Regra 2: E4_COND diferente de '00' e diferente de '0' -> Faturado a Prazo (faturado = 'S')
          // Se E4_COND for '00' ou '0' -> À Vista / Antecipado (faturado = 'N')
          const isFaturado = (e4Cond !== '00' && e4Cond !== '0' && e4Cond !== '');

          condPagInfo = {
            codigo: rowE4.E4_CODIGO || cleanCond,
            descricao: rowE4.E4_DESCRI || '',
            e4_cond: e4Cond,
            e4_ctradt: e4Ctradt,
            possuiEntrada: hasEntrada ? 'S' : 'N',
            faturado: isFaturado ? 'S' : 'N'
          };
        }
      } catch (errSE4) {
        console.warn('Erro ao consultar SE4010:', errSE4.message);
      }
    }

    const sqlC6 = `
      SELECT
        RTRIM(C6.C6_ITEM) AS ITEM,
        RTRIM(C6.C6_PRODUTO) AS PRODUTO,
        RTRIM(C6.C6_DESCRI) AS DESCRICAO,
        ISNULL(C6.C6_QTDVEN, 0) AS QTD,
        ISNULL(C6.C6_PRCVEN, 0) AS PRCVEN,
        ISNULL(C6.C6_VALOR, 0) AS VALOR,
        RTRIM(ISNULL(C6.C6_TES, '')) AS TES,
        RTRIM(ISNULL(C6.C6_ENTREG, '')) AS PREV_ENTREGA,
        RTRIM(ISNULL(COALESCE(F4_01.F4_DUPLIC, F4_16.F4_DUPLIC, F4_09.F4_DUPLIC, ''), '')) AS F4_DUPLIC,
        RTRIM(ISNULL(COALESCE(F4_01.F4_ESTOQUE, F4_16.F4_ESTOQUE, F4_09.F4_ESTOQUE, ''), '')) AS F4_ESTOQUE,
        RTRIM(ISNULL(COALESCE(F4_01.F4_TEXTO, F4_16.F4_TEXTO, F4_09.F4_TEXTO, ''), '')) AS F4_TEXTO
      FROM ${emp.sc6} C6
      LEFT JOIN SF4010 F4_01
        ON RTRIM(F4_01.F4_CODIGO) = RTRIM(C6.C6_TES)
       AND F4_01.D_E_L_E_T_ = ' '
      LEFT JOIN SF4160 F4_16
        ON RTRIM(F4_16.F4_CODIGO) = RTRIM(C6.C6_TES)
       AND F4_16.D_E_L_E_T_ = ' '
      LEFT JOIN SF4090 F4_09
        ON RTRIM(F4_09.F4_CODIGO) = RTRIM(C6.C6_TES)
       AND F4_09.D_E_L_E_T_ = ' '
      WHERE (C6.C6_NUM = '${paddedPed6}' OR C6.C6_NUM = '${cleanPed}')
        AND C6.D_E_L_E_T_ = ' '
      ORDER BY C6.C6_ITEM ASC
    `;

    const resC6 = await executeRailwayQuery(sqlC6);
    const itens = (resC6 && resC6.rows) ? resC6.rows : [];

    if (head) {
      const totalProdutos = itens.reduce((acc, it) => acc + parseFloat(it.VALOR || 0), 0);
      const freteCobrado = parseFloat(head.FRETE || 0); // C5_FRETE (Frete normal cobrado que compõe o total do pedido)
      const freteEmbutido = parseFloat(head.FRETE_EMBUTIDO || 0); // C5_VLR_FRT (Frete embutido/CIF nos produtos, NÃO soma ao total)
      const totalFrete = freteCobrado; // Apenas C5_FRETE compõe o total financeiro do pedido
      const totalDesconto = parseFloat(head.DESCONTO || 0);
      const totalGeral = totalProdutos + totalFrete - totalDesconto;

      // Consolidação de dados fiscais da TES (SF4)
      const distinctTes = [...new Set(itens.map(i => (i.TES || '').trim()).filter(Boolean))];
      const hasDuplicSim = itens.some(i => (i.F4_DUPLIC || '').trim().toUpperCase() === 'S');
      const hasDuplicNao = itens.some(i => (i.F4_DUPLIC || '').trim().toUpperCase() === 'N');
      const geraFinanceiro = hasDuplicSim ? 'S' : (hasDuplicNao ? 'N' : '-');

      const hasEstoqueSim = itens.some(i => (i.F4_ESTOQUE || '').trim().toUpperCase() === 'S');
      const hasEstoqueNao = itens.some(i => (i.F4_ESTOQUE || '').trim().toUpperCase() === 'N');
      const atualizaEstoque = hasEstoqueSim ? 'S' : (hasEstoqueNao ? 'N' : '-');

      const fiscalInfo = {
        tes: distinctTes.join(', ') || '-',
        geraFinanceiro: geraFinanceiro, // 'S' ou 'N' ou '-'
        atualizaEstoque: atualizaEstoque // 'S' ou 'N' ou '-'
      };

      // Consulta Faturas / Títulos a Receber (SE1)
      let faturas = [];
      const rawNota = head && head.NOTA_FISCAL ? String(head.NOTA_FISCAL).trim() : '';
      if (rawNota && !/^X+$/i.test(rawNota)) {
        try {
          const cleanNota = sanitizeSqlParam(rawNota);
          const paddedNota9 = cleanNota.padStart(9, '0');
          const paddedNota6 = cleanNota.padStart(6, '0');
          const sqlSE1 = `
            SELECT
              RTRIM(ISNULL(E1_NUM, '')) AS NUM_TITULO,
              RTRIM(ISNULL(E1_PREFIXO, '')) AS PREFIXO,
              RTRIM(ISNULL(E1_PARCELA, '')) AS PARCELA,
              RTRIM(ISNULL(E1_TIPO, '')) AS TIPO,
              ISNULL(E1_VALOR, 0) AS VALOR,
              ISNULL(E1_SALDO, 0) AS SALDO,
              RTRIM(ISNULL(E1_EMISSAO, '')) AS EMISSAO,
              RTRIM(ISNULL(E1_VENCTO, '')) AS VENCTO,
              RTRIM(ISNULL(E1_VENCREA, '')) AS VENCREA,
              RTRIM(ISNULL(E1_BAIXA, '')) AS BAIXA
            FROM ${emp.se1}
            WHERE (E1_NUM = '${paddedNota9}' OR E1_NUM = '${paddedNota6}' OR E1_NUM = '${cleanNota}' OR E1_PEDIDO = '${paddedPed6}' OR E1_PEDIDO = '${cleanPed}')
              AND D_E_L_E_T_ = ' '
            ORDER BY E1_PARCELA ASC, E1_VENCTO ASC
          `;
          const resSE1 = await executeRailwayQuery(sqlSE1);
          if (resSE1 && resSE1.rows && resSE1.rows.length > 0) {
            faturas = resSE1.rows.map(f => {
              const dataBaixa = (f.BAIXA || '').trim();
              const estaPago = !!(dataBaixa && dataBaixa !== '' && dataBaixa !== '0' && dataBaixa.length === 8);
              const parcelaStr = (f.PARCELA || '').trim();
              return {
                numTitulo: f.NUM_TITULO,
                prefixo: f.PREFIXO,
                parcela: parcelaStr || 'Única',
                parcelaRaw: parcelaStr,
                tipo: f.TIPO,
                valor: parseFloat(f.VALOR || 0),
                saldo: parseFloat(f.SALDO || 0),
                emissao: f.EMISSAO,
                vencimento: f.VENCTO,
                vencimentoReal: f.VENCREA,
                dataBaixa: dataBaixa,
                estaPago: estaPago,
                status: estaPago ? 'PAGO' : 'PENDENTE'
              };
            });
          }
        } catch (errSE1) {
          console.warn(`Erro ao consultar títulos na tabela ${emp.se1}:`, errSE1.message);
        }
      }

      // Consulta Consolidada do Histórico Financeiro do Cliente em SE1090, SE1140, SE1150 e SE1160
      let historicoFinanceiro = {
        totalComprasPagas: 0,
        titulosAbertos: 0,
        temPgtosAbertos: 'N',
        comprou2x: 'N',
        comprou5x: 'N'
      };
      if (head && head.COD_CLI) {
        try {
          historicoFinanceiro = await obterHistoricoFinanceiroCliente(head.COD_CLI);
        } catch (errHist) {
          console.warn('Erro ao obter histórico financeiro consolidado SE1:', errHist.message);
        }
      }

      return {
        encontrado: true,
        empresa: emp.nome,
        empresaKey: empresaKey,
        numPedido: head.NUM_PEDIDO || paddedPed6,
        codWeb: head.COD_WEB || '-',
        notaFiscal: head.NOTA_FISCAL ? String(head.NOTA_FISCAL).trim() : '',
        emissao: head.EMISSAO,
        cliente: cliInfo,
        fiscal: fiscalInfo,
        faturas: faturas,
        historicoFinanceiro: historicoFinanceiro,
        comercial: {
          transportadora: head.TRANSP || 'Transportadora Padrão',
          codTransp: (head.TRANSP || '').trim(),
          condPagto: head.CONDPAG || 'À Vista / Boleto',
          condPagInfo: condPagInfo,
          vendedor: getNomeVendedor(head.VEND1),
          codVendedor: head.VEND1,
          observacoes: head.OBS,
          entregaDiferenteInfo: detectarEnderecoEntregaDiferente(head.OBS, head.TRANSP)
        },
        totais: {
          totalProdutos: roundVal(totalProdutos),
          totalFrete: roundVal(totalFrete),
          freteCobrado: roundVal(freteCobrado),
          freteEmbutido: roundVal(freteEmbutido),
          totalDesconto: roundVal(totalDesconto),
          totalGeral: roundVal(totalGeral)
        },
        itens: itens.map(i => ({
          item: i.ITEM,
          produto: i.PRODUTO,
          descricao: i.DESCRICAO,
          qtd: parseFloat(i.QTD || 0),
          prcUnit: parseFloat(i.PRCVEN || 0),
          total: parseFloat(i.VALOR || 0),
          tes: (i.TES || '').trim() || '-',
          geraFinanceiro: (i.F4_DUPLIC || '').trim().toUpperCase() === 'S' ? 'S' : ((i.F4_DUPLIC || '').trim().toUpperCase() === 'N' ? 'N' : '-'),
          atualizaEstoque: (i.F4_ESTOQUE || '').trim().toUpperCase() === 'S' ? 'S' : ((i.F4_ESTOQUE || '').trim().toUpperCase() === 'N' ? 'N' : '-'),
          tesDescricao: (i.F4_TEXTO || '').trim(),
          entrega: i.PREV_ENTREGA
        }))
      };
    }
  } catch (err) {
    console.warn('Erro ao consultar detalhes do pedido:', err.message);
  }

  return {
    encontrado: false,
    empresa: emp.nome,
    empresaKey: empresaKey,
    numPedido: paddedPed6,
    message: 'Pedido não encontrado no Protheus.'
  };
}

/**
 * Consulta Relatório de Comissões por Período
 * Tabelas SE3160 (OACO), SE3150 (GSI)
 */
async function buscarComissoesPeriodo({ dataIni, dataFim, codVend }) {
  const cleanDataIni = String(dataIni || '').replace(/\D/g, '');
  const cleanDataFim = String(dataFim || '').replace(/\D/g, '');
  const cleanCodVend = sanitizeSqlParam(codVend);

  const empresas = [
    { key: "OACO", sigla: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", se3: "SE3160", sc5: "SC5160" },
    { key: "GSI", sigla: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", se3: "SE3150", sc5: "SC5150" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14", nome: "Empresa 14 (METAL PLENO)", se3: "SE3140", sc5: "SC5140" }
  ];

  const results = [];

  for (const emp of empresas) {
    try {
      const vendFilter = cleanCodVend 
        ? `AND (E3.E3_VEND = '${cleanCodVend}' OR E3.E3_VEND = '${cleanCodVend.padStart(6, '0')}')` 
        : '';
      
      const sql = `
        SELECT
          RTRIM(E3.E3_VEND) AS E3_VEND,
          RTRIM(E3.E3_EMISSAO) AS E3_EMISSAO,
          RTRIM(E3.E3_PEDIDO) AS E3_PEDIDO,
          RTRIM(E3.E3_CODCLI) AS E3_CODCLI,
          RTRIM(ISNULL(A1.A1_NOME, '')) AS NOME_CLIENTE,
          ISNULL(E3.E3_BASE, 0) AS E3_BASE,
          ISNULL(E3.E3_PORC, 0) AS E3_PORC,
          ISNULL(E3.E3_COMIS, 0) AS E3_COMIS,
          ISNULL(C5.C5_VLR_FRT, 0) AS C5_VLR_FRT
        FROM ${emp.se3} E3
        LEFT JOIN SA1010 A1
          ON (A1.A1_COD = E3.E3_CODCLI OR A1.A1_COD = RIGHT('000000' + RTRIM(E3.E3_CODCLI), 6))
         AND A1.D_E_L_E_T_ = ' '
        LEFT JOIN ${emp.sc5} C5
          ON (C5.C5_NUM = E3.E3_PEDIDO OR C5.C5_NUM = RIGHT('000000' + RTRIM(E3.E3_PEDIDO), 6))
         AND C5.D_E_L_E_T_ = ' '
        WHERE E3.E3_EMISSAO >= '${cleanDataIni}' 
          AND E3.E3_EMISSAO <= '${cleanDataFim}'
          ${vendFilter}
          AND E3.D_E_L_E_T_ = ' '
        ORDER BY E3.E3_EMISSAO DESC
      `;

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        for (const row of dbRes.rows) {
          const valorBase = parseFloat(row.E3_BASE || 0);
          const percComis = parseFloat(row.E3_PORC || 0);
          const valorComis = parseFloat(row.E3_COMIS || 0);
          const freteEmbutido = parseFloat(row.C5_VLR_FRT || 0);
          const rawNome = (row.NOME_CLIENTE || '').trim();
          const nome20 = rawNome.length > 20 ? rawNome.substring(0, 20) : rawNome;

          results.push({
            empresa: emp.nome,
            empresaKey: emp.key,
            empresaSigla: emp.sigla,
            codVend: row.E3_VEND,
            nomeVendedor: getNomeVendedor(row.E3_VEND),
            emissao: row.E3_EMISSAO,
            pedido: row.E3_PEDIDO || '-',
            cliente: row.E3_CODCLI || '-',
            nomeCliente: nome20 || '-',
            nomeClienteCompleto: rawNome || '-',
            valorBase: roundVal(valorBase),
            percComis: roundVal(percComis),
            valorComis: roundVal(valorComis),
            freteEmbutido: roundVal(freteEmbutido),
            gorduraFreteEmbut: roundVal(freteEmbutido)
          });
        }
      }
    } catch (err) {
      console.warn(`Erro na consulta de comissões da empresa ${emp.nome}:`, err.message);
    }
  }

  // Ordena por data de emissão decrescente
  results.sort((a, b) => (b.emissao || '').localeCompare(a.emissao || ''));

  const totalBase = results.reduce((acc, c) => acc + c.valorBase, 0);
  const totalComis = results.reduce((acc, c) => acc + c.valorComis, 0);
  const totalGorduraFrete = results.reduce((acc, c) => acc + (c.gorduraFreteEmbut || c.freteEmbutido || 0), 0);

  return {
    comissoes: results,
    totalGeralBase: roundVal(totalBase),
    totalGeralComissao: roundVal(totalComis),
    totalGeralGorduraFrete: roundVal(totalGorduraFrete),
    totalRegistros: results.length
  };
}

function roundVal(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatCurrency(val) {
  return 'R$ ' + (Number(val) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * =========================================================================
 * MÓDULO ASSISTENTE FINANCEIRO — CONCILIAÇÃO BANCÁRIA (BANCO INTER 077)
 * =========================================================================
 */

const EMPRESAS_FINANCEIRO = {
  "14": {
    codigo: "14",
    nome: "METAL PLENO / S4BW",
    banco: "077",
    agencia: "0001",
    conta: "397407319",
    contaFormatada: "3974073-9",
    tabelaSE8: "SE8140",
    tabelaSE5: "SE5140"
  },
  "15": {
    codigo: "15",
    nome: "GSI COFRES",
    banco: "077",
    agencia: "0001",
    conta: "137760655",
    contaFormatada: "13776065-5",
    tabelaSE8: "SE8150",
    tabelaSE5: "SE5150"
  },
  "16": {
    codigo: "16",
    nome: "OAÇO PRODUTOS DE AÇO",
    banco: "077",
    agencia: "0001",
    conta: "48165605",
    contaFormatada: "4816560-5",
    tabelaSE8: "SE8160",
    tabelaSE5: "SE5160"
  }
};

/**
 * Consulta o Saldo Protheus (SE8) para uma empresa e data de referência
 */
async function consultarSaldoSE8(empresaCodigo, dataYmd) {
  const emp = EMPRESAS_FINANCEIRO[String(empresaCodigo)];
  if (!emp) throw new Error(`Empresa inválida: ${empresaCodigo}`);

  const cleanData = String(dataYmd || '').replace(/\D/g, '');
  if (!cleanData || cleanData.length !== 8) {
    throw new Error('Data inválida para consulta SE8 (esperado YYYYMMDD)');
  }

  const sql = `
    SELECT TOP 1 
      E8_FILIAL, 
      E8_BANCO, 
      E8_AGENCIA, 
      E8_CONTA, 
      E8_DTSALAT, 
      E8_SALATUA,
      E8_DTSALAN,
      E8_SALANT
    FROM ${emp.tabelaSE8}
    WHERE E8_BANCO = '077'
      AND E8_DTSALAT <= '${cleanData}'
      AND D_E_L_E_T_ = ' '
    ORDER BY E8_DTSALAT DESC
  `;

  try {
    const res = await executeRailwayQuery(sql);
    const rows = res.rows || res;
    if (rows && rows.length > 0) {
      const row = rows[0];
      return {
        empresaCodigo: emp.codigo,
        empresaNome: emp.nome,
        conta: emp.conta,
        contaFormatada: emp.contaFormatada,
        dataSaldoConsultada: cleanData,
        dataUltimoSaldoProtheus: row.E8_DTSALAT || cleanData,
        saldoProtheus: roundVal(parseFloat(row.E8_SALATUA || 0)),
        saldoAnteriorProtheus: roundVal(parseFloat(row.E8_SALANT || 0)),
        encontrado: true
      };
    }
    return {
      empresaCodigo: emp.codigo,
      empresaNome: emp.nome,
      conta: emp.conta,
      contaFormatada: emp.contaFormatada,
      dataSaldoConsultada: cleanData,
      dataUltimoSaldoProtheus: cleanData,
      saldoProtheus: 0,
      saldoAnteriorProtheus: 0,
      encontrado: false
    };
  } catch (err) {
    console.error(`Erro ao consultar SE8 da Empresa ${emp.codigo}:`, err.message);
    throw err;
  }
}

/**
 * Consulta Movimentações Bancárias Protheus (SE5) em um período
 */
async function consultarExtratoSE5(empresaCodigo, dataInicioYmd, dataFimYmd) {
  const emp = EMPRESAS_FINANCEIRO[String(empresaCodigo)];
  if (!emp) throw new Error(`Empresa inválida: ${empresaCodigo}`);

  const dIni = String(dataInicioYmd || '').replace(/\D/g, '');
  const dFim = String(dataFimYmd || '').replace(/\D/g, '');

  const sql = `
    SELECT 
      R_E_C_N_O_ AS ID,
      E5_DATA, 
      E5_VALOR, 
      E5_RECPAG, 
      E5_DOCUMEN, 
      E5_HISTOR, 
      E5_BENEF, 
      E5_TIPODOC,
      E5_NATUREZ
    FROM ${emp.tabelaSE5}
    WHERE E5_BANCO = '077'
      AND E5_DATA >= '${dIni}'
      AND E5_DATA <= '${dFim}'
      AND D_E_L_E_T_ = ' '
    ORDER BY E5_DATA DESC, E5_VALOR DESC
  `;

  try {
    const res = await executeRailwayQuery(sql);
    const rows = res.rows || res || [];
    return rows.map((r, index) => {
      const valor = roundVal(parseFloat(r.E5_VALOR || 0));
      const tipo = (r.E5_RECPAG || '').trim().toUpperCase() === 'R' ? 'C' : 'D'; // C = Crédito, D = Débito
      return {
        id: r.ID || `se5-${emp.codigo}-${index}`,
        data: r.E5_DATA || '',
        dataIso: r.E5_DATA ? `${r.E5_DATA.slice(0,4)}-${r.E5_DATA.slice(4,6)}-${r.E5_DATA.slice(6,8)}` : '',
        valor: valor,
        tipoOperacao: tipo,
        recPag: (r.E5_RECPAG || '').trim().toUpperCase(),
        documento: (r.E5_DOCUMEN || '').trim(),
        historico: (r.E5_HISTOR || '').trim(),
        beneficiario: (r.E5_BENEF || '').trim(),
        tipoDoc: (r.E5_TIPODOC || '').trim(),
        natureza: (r.E5_NATUREZ || '').trim()
      };
    });
  } catch (err) {
    console.error(`Erro ao consultar SE5 da Empresa ${emp.codigo}:`, err.message);
    throw err;
  }
}

/**
 * Algoritmo de Conciliação Inteligente de Lançamentos
 * Suporta correspondência 1:1 e aglutinação N:1 (múltiplos no Protheus = 1 no Banco)
 */
function algoritmoMatchingConciliacao(lancamentosProtheus, transacoesBanco) {
  const pList = lancamentosProtheus.map(p => ({ ...p, matched: false, matchGroup: null }));
  const bList = transacoesBanco.map(b => ({ ...b, matched: false, matchGroup: null }));

  const gruposConciliados = [];
  let groupId = 1;

  // ─── PASSO 1: Casamento 1:1 Direto (Mesmo valor, mesmo tipo D/C e mesma data aproximada) ───
  for (const b of bList) {
    if (b.matched) continue;
    
    // Procura correspondente 1:1 exato no Protheus
    const pIndex = pList.findIndex(p => 
      !p.matched && 
      p.tipoOperacao === b.tipoOperacao && 
      Math.abs(p.valor - b.valor) < 0.01 &&
      (Math.abs(new Date(p.dataIso || p.data) - new Date(b.dataIso || b.data)) <= 86400000 * 2) // até 2 dias de diferença
    );

    if (pIndex !== -1) {
      const p = pList[pIndex];
      p.matched = true;
      b.matched = true;
      const g = {
        id: `g-${groupId++}`,
        tipo: '1:1',
        tipoOperacao: b.tipoOperacao,
        valorTotal: b.valor,
        dataBanco: b.dataIso || b.data,
        bancoItems: [b],
        protheusItems: [p],
        status: 'CONCILIADO_1_1'
      };
      p.matchGroup = g.id;
      b.matchGroup = g.id;
      gruposConciliados.push(g);
    }
  }

  // ─── PASSO 2: Casamento de Vendas Cartão / Domicílio Líquido (1 Crédito Bruto - 1 Débito Taxa = 1 Crédito Líquido no Banco) ───
  // No Banco: Crédito Líquido (ex: 373,21 - Credito Domicilio T.o.p)
  // No Protheus: Crédito Bruto (ex: 380,00) + Débito Taxa (ex: 6,79 com INTERPAG / TAXA / MDR)
  for (const b of bList) {
    if (b.matched || b.tipoOperacao !== 'C') continue;

    // Créditos do Protheus maiores que o valor líquido do banco
    const creditosDisponiveis = pList.filter(p => 
      !p.matched && 
      p.tipoOperacao === 'C' && 
      p.valor > b.valor &&
      (Math.abs(new Date(p.dataIso || p.data) - new Date(b.dataIso || b.data)) <= 86400000 * 2)
    );

    // Débitos do Protheus (taxas) menores que o valor do banco
    const debitosDisponiveis = pList.filter(p => 
      !p.matched && 
      p.tipoOperacao === 'D' && 
      p.valor < b.valor &&
      (Math.abs(new Date(p.dataIso || p.data) - new Date(b.dataIso || b.data)) <= 86400000 * 2)
    );

    let matchFound = false;

    for (const pCred of creditosDisponiveis) {
      for (const pDeb of debitosDisponiveis) {
        const liquidoCalculado = Number((pCred.valor - pDeb.valor).toFixed(2));
        
        if (Math.abs(liquidoCalculado - b.valor) < 0.01) {
          pCred.matched = true;
          pDeb.matched = true;
          b.matched = true;

          const g = {
            id: `g-${groupId++}`,
            tipo: 'CARTAO_LIQUIDO',
            tipoOperacao: 'C',
            valorTotal: b.valor,
            valorBruto: pCred.valor,
            valorTaxa: pDeb.valor,
            dataBanco: b.dataIso || b.data,
            bancoItems: [b],
            protheusItems: [pCred, pDeb],
            status: 'CONCILIADO_CARTAO_LIQUIDO',
            detalhe: `Venda Bruta ${formatCurrency(pCred.valor)} - Taxa ${formatCurrency(pDeb.valor)} = ${formatCurrency(b.valor)} Líquido no Banco`
          };

          pCred.matchGroup = g.id;
          pDeb.matchGroup = g.id;
          b.matchGroup = g.id;
          gruposConciliados.push(g);
          matchFound = true;
          break;
        }
      }
      if (matchFound) break;
    }
  }

  // ─── PASSO 3: Casamento N:1 (Vários lançamentos no Protheus que somam 1 no Banco) ───
  // Comum em lotes de pagamentos, folha, fornecedores ou guias agrupadas
  for (const b of bList) {
    if (b.matched) continue;

    // Candidatos do Protheus com o mesmo tipo (D/C) e não casados
    const candidatos = pList.filter(p => 
      !p.matched && 
      p.tipoOperacao === b.tipoOperacao &&
      p.valor <= b.valor + 0.01
    );

    if (candidatos.length >= 2) {
      // Busca subconjunto que some exatamente o valor do banco
      const subconjunto = findSubsetSum(candidatos, b.valor, 0.01, 8);
      if (subconjunto && subconjunto.length >= 2) {
        b.matched = true;
        for (const p of subconjunto) {
          p.matched = true;
          p.matchGroup = `g-${groupId}`;
        }
        const g = {
          id: `g-${groupId++}`,
          tipo: 'N:1',
          tipoOperacao: b.tipoOperacao,
          valorTotal: b.valor,
          dataBanco: b.dataIso || b.data,
          bancoItems: [b],
          protheusItems: subconjunto,
          status: 'CONCILIADO_AGRUPADO_N_1'
        };
        b.matchGroup = g.id;
        gruposConciliados.push(g);
      }
    }
  }

  // ─── PASSO 4: Identificação de Itens Órfãos / Não Conciliados ───
  const orfaosBanco = bList.filter(b => !b.matched);
  const orfaosProtheus = pList.filter(p => !p.matched);

  return {
    gruposConciliados,
    orfaosBanco,
    orfaosProtheus,
    resumo: {
      totalBanco: bList.length,
      totalProtheus: pList.length,
      totalConciliados1_1: gruposConciliados.filter(g => g.tipo === '1:1').length,
      totalCartaoLiquido: gruposConciliados.filter(g => g.tipo === 'CARTAO_LIQUIDO').length,
      totalAgrupadosN_1: gruposConciliados.filter(g => g.tipo === 'N:1').length,
      totalOrfaosBanco: orfaosBanco.length,
      totalOrfaosProtheus: orfaosProtheus.length
    }
  };
}

/**
 * Heurística de Subset-Sum para agrupar até maxItems lançamentos do Protheus
 */
function findSubsetSum(items, targetSum, tolerance = 0.01, maxItems = 6) {
  // Ordena decrescente por valor para otimizar poda
  const sorted = [...items].sort((a, b) => b.valor - a.valor);

  function backtrack(index, currentSubset, currentSum) {
    if (Math.abs(currentSum - targetSum) <= tolerance && currentSubset.length >= 2) {
      return currentSubset;
    }
    if (currentSum > targetSum + tolerance || currentSubset.length >= maxItems || index >= sorted.length) {
      return null;
    }

    for (let i = index; i < sorted.length; i++) {
      const item = sorted[i];
      if (currentSum + item.valor > targetSum + tolerance) continue;

      const res = backtrack(i + 1, [...currentSubset, item], currentSum + item.valor);
      if (res) return res;
    }
    return null;
  }

  return backtrack(0, [], 0);
}

/**
 * Consulta e consolida o histórico financeiro do cliente em todas as 4 bases SE1 (09, 14, 15, 16).
 * Deduplica parcelas por documento (E1_NUM) e calcula:
 * - Total de compras pagas (E1_BAIXA preenchido)
 * - Se possui títulos em aberto (E1_BAIXA vazio e E1_SALDO > 0)
 * - Comprou e pagou 2x+ ('S' | 'N')
 * - Comprou e pagou 5x+ ('S' | 'N')
 */
async function obterHistoricoFinanceiroCliente(codCliente) {
  if (!codCliente) {
    return {
      totalComprasPagas: 0,
      titulosAbertos: 0,
      temPgtosAbertos: 'N',
      comprou2x: 'N',
      comprou5x: 'N',
      detalhesEmpresas: {}
    };
  }

  const cleanCod = sanitizeSqlParam(codCliente);
  const paddedCod = cleanCod.padStart(6, '0');
  const tabelas = [
    { codEmpresa: '09', tabela: 'SE1090', nome: 'Empresa 09' },
    { codEmpresa: '14', tabela: 'SE1140', nome: 'Empresa 14 (Metal Pleno)' },
    { codEmpresa: '15', tabela: 'SE1150', nome: 'Empresa 15 (GSI)' },
    { codEmpresa: '16', tabela: 'SE1160', nome: 'Empresa 16 (OACO)' }
  ];

  const titulosPagosDistintos = new Set();
  const titulosAbertosDistintos = new Set();
  const detalhesEmpresas = {};

  for (const emp of tabelas) {
    try {
      const sql = `
        SELECT
          RTRIM(E1_PREFIXO) AS PREFIXO,
          RTRIM(E1_NUM) AS NUM,
          RTRIM(E1_PARCELA) AS PARCELA,
          RTRIM(E1_TIPO) AS TIPO,
          ISNULL(E1_VALOR, 0) AS VALOR,
          ISNULL(E1_SALDO, 0) AS SALDO,
          RTRIM(ISNULL(E1_BAIXA, '')) AS BAIXA,
          RTRIM(ISNULL(E1_EMISSAO, '')) AS EMISSAO,
          RTRIM(ISNULL(E1_VENCTO, '')) AS VENCTO
        FROM ${emp.tabela}
        WHERE (E1_CLIENTE = '${cleanCod}' OR E1_CLIENTE = '${paddedCod}')
          AND D_E_L_E_T_ = ' '
      `;
      const res = await executeRailwayQuery(sql);
      const rows = res && res.rows ? res.rows : [];
      detalhesEmpresas[emp.codEmpresa] = { totalLinhas: rows.length };

      for (const r of rows) {
        const numDoc = (r.NUM || '').trim();
        if (!numDoc) continue;
        const docKey = `${emp.codEmpresa}_${numDoc}`;

        const isBaixado = r.BAIXA && r.BAIXA.trim() !== '' && Number(r.SALDO || 0) <= 0;
        const isAberto = (!r.BAIXA || r.BAIXA.trim() === '') && Number(r.SALDO || 0) > 0;

        if (isBaixado) {
          titulosPagosDistintos.add(docKey);
        }
        if (isAberto) {
          titulosAbertosDistintos.add(docKey);
        }
      }
    } catch (e) {
      console.warn(`Erro ao consultar histórico financeiro em ${emp.tabela}:`, e.message);
    }
  }

  const totalComprasPagas = titulosPagosDistintos.size;
  const totalAbertos = titulosAbertosDistintos.size;

  return {
    totalComprasPagas,
    titulosAbertos: totalAbertos,
    temPgtosAbertos: totalAbertos > 0 ? 'S' : 'N',
    comprou2x: totalComprasPagas >= 2 ? 'S' : 'N',
    comprou5x: totalComprasPagas >= 5 ? 'S' : 'N',
    detalhesEmpresas
  };
}

/**
 * Sincronização Completa de Saldos em Estoque Protheus -> Supabase / JSON Cache
 * Consolida SB1 (Produtos PA), SB2 (Saldos 14/15/16), SC6 (Vendas 14/15/16) e SC7 (Compras 14/15/16)
 */
async function sincronizarSaldosEstoqueProtheus({ triggeredBy = 'JOB' } = {}) {
  const inicioTime = Date.now();
  console.log(`\n⏳ [Saldos Estoque Sync] Iniciando sincronização do Protheus (Disparado por: ${triggeredBy})...`);

  const { saveSaldosEstoqueDB } = require('./postgres_db');
  const produtosMap = new Map();

  try {
    // 1. Extração do Catálogo de Produtos PA dos Grupos Comerciais (001, 002, 010, 018)
    // Usamos estritamente os catálogos oficiais das empresas ativas (SB1090 e SB1160)
    // Excluímos tabelas legadas (SB1010) para evitar produtos descontinuados/fantasmas
    const sb1Tables = ['SB1090', 'SB1160'];
    const GRUPOS_COMERCIAIS = ['001', '002', '010', '018', '0001', '0002', '0010', '0018', '1', '2', '10', '18'];
    const codigosBloqueados = new Set();

    for (const sb1Table of sb1Tables) {
      try {
        // Mapear códigos bloqueados para expurgo garantido
        const sqlBlocked = `
          SELECT RTRIM(B1_COD) AS B1_COD
          FROM ${sb1Table}
          WHERE D_E_L_E_T_ = ' '
            AND (RTRIM(B1_MSBLQL) = '1' OR RTRIM(B1_MSBLQL) = 'S' OR RTRIM(B1_MSBLQL) = 's');
        `;
        const resBlocked = await executeRailwayQuery(sqlBlocked);
        if (resBlocked && resBlocked.rows) {
          for (const rb of resBlocked.rows) {
            if (rb.B1_COD) codigosBloqueados.add(String(rb.B1_COD).trim());
          }
        }

        const sqlSB1 = `
          SELECT 
            RTRIM(B1_COD) AS B1_COD,
            RTRIM(B1_DESC) AS B1_DESC,
            RTRIM(ISNULL(B1_GRUPO, '')) AS B1_GRUPO,
            ISNULL(B1_PRV1, 0) AS B1_PRV1,
            ISNULL(B1_EMIN, 0) AS B1_EMIN,
            ISNULL(B1_LE, 0) AS B1_LE,
            ISNULL(B1_VLUNIT, 0) AS B1_VLUNIT,
            RTRIM(ISNULL(B1_TIPO, '')) AS B1_TIPO
          FROM ${sb1Table}
          WHERE D_E_L_E_T_ = ' '
            AND RTRIM(B1_TIPO) = 'PA'
            AND RTRIM(B1_GRUPO) IN ('001', '002', '010', '018', '0001', '0002', '0010', '0018')
            AND (B1_MSBLQL IS NULL OR (RTRIM(B1_MSBLQL) <> '1' AND RTRIM(B1_MSBLQL) <> 'S' AND RTRIM(B1_MSBLQL) <> 's'))
            AND B1_DESC NOT LIKE '%XXX%'
            AND B1_COD NOT LIKE '%X%'
            AND B1_COD LIKE '%0%'
          ORDER BY B1_DESC ASC;
        `;
        const resSB1 = await executeRailwayQuery(sqlSB1);
        if (resSB1 && resSB1.rows && resSB1.rows.length > 0) {
          for (const r of resSB1.rows) {
            const cod = String(r.B1_COD || '').trim();
            if (!cod || codigosBloqueados.has(cod)) continue;

            const desc = String(r.B1_DESC || '').trim();
            const grupo = String(r.B1_GRUPO || '').trim();
            const preco = Number(r.B1_PRV1) || 0;
            const pontoPed = Number(r.B1_EMIN) || Number(r.B1_LE) || 0;

            if (!produtosMap.has(cod)) {
              produtosMap.set(cod, {
                codigo: cod,
                descricao: desc || `PRODUTO ${cod}`,
                grupo: grupo,
                preco: preco,
                saldo: 0,
                saldo_total: 0,
                qtd_vendas: 0,
                qtd_compras: 0,
                ponto_ped: pontoPed,
                detalhes_empresas: {
                  "14": { sigla: "MP", nome: "Metal Pleno (14)", saldo: 0, vendas: 0, compras: 0, vendasLista: [], comprasLista: [] },
                  "15": { sigla: "GSI", nome: "GSI (15)", saldo: 0, vendas: 0, compras: 0, vendasLista: [], comprasLista: [] },
                  "16": { sigla: "OACO", nome: "OACO (16)", saldo: 0, vendas: 0, compras: 0, vendasLista: [], comprasLista: [] }
                }
              });
            } else {
              const existing = produtosMap.get(cod);
              if (!existing.descricao && desc) existing.descricao = desc;
              if (!existing.grupo && grupo) existing.grupo = grupo;
              if (existing.preco === 0 && preco > 0) existing.preco = preco;
              if (existing.ponto_ped === 0 && pontoPed > 0) existing.ponto_ped = pontoPed;
            }
          }
        }
      } catch (errSB1) {
        console.warn(`Aviso ao consultar produtos em ${sb1Table}:`, errSB1.message);
      }
    }

    // Expurgo preventivo de códigos bloqueados
    for (const bCod of codigosBloqueados) {
      if (produtosMap.has(bCod)) {
        produtosMap.delete(bCod);
      }
    }

    const empresas = [
      { cod: "14", sigla: "MP", nome: "Metal Pleno (14)", sb2: "SB2140", sc6: "SC6140", sc5: "SC5140", sc7: "SC7140" },
      { cod: "15", sigla: "GSI", nome: "GSI (15)", sb2: "SB2150", sc6: "SC6150", sc5: "SC5150", sc7: "SC7150" },
      { cod: "16", sigla: "OACO", nome: "OACO (16)", sb2: "SB2160", sc6: "SC6160", sc5: "SC5160", sc7: "SC7160" }
    ];

    // 2. Extração de Saldos Físicos em Estoque SB2 (14, 15, 16) - Estritamente para Produtos PA do Catálogo
    for (const emp of empresas) {
      try {
        const sqlSB2 = `
          SELECT 
            RTRIM(B2_COD) AS B2_COD,
            ISNULL(SUM(B2_QATU), 0) AS SALDO_QATU
          FROM ${emp.sb2}
          WHERE D_E_L_E_T_ = ' '
            AND B2_COD NOT LIKE '%X%'
            AND B2_COD LIKE '%0%'
          GROUP BY B2_COD;
        `;
        const resSB2 = await executeRailwayQuery(sqlSB2);
        if (resSB2 && resSB2.rows) {
          for (const r of resSB2.rows) {
            const cod = String(r.B2_COD || '').trim();
            if (!cod) continue;

            const prod = produtosMap.get(cod);
            if (!prod) continue; // Insumos, matérias-primas e componentes não entram no estoque comercial

            const saldoEmp = Number(r.SALDO_QATU) || 0;
            prod.detalhes_empresas[emp.cod].saldo += saldoEmp;
            prod.saldo += saldoEmp;
          }
        }
      } catch (errEmpSB2) {
        console.warn(`Aviso ao consultar saldos em ${emp.sb2}:`, errEmpSB2.message);
      }
    }

    // 3. Extração de Vendas Abertas SC6 (14, 15, 16)
    for (const emp of empresas) {
      try {
        const sqlSC6 = `
          SELECT 
            RTRIM(C6.C6_NUM) AS NUM_PED,
            RTRIM(ISNULL(C6.C6_CODWEB, '')) AS COD_WEB,
            RTRIM(C6.C6_ITEM) AS ITEM,
            RTRIM(C6.C6_PRODUTO) AS PRODUTO,
            RTRIM(ISNULL(C6.C6_DESCRI, '')) AS DESCRICAO,
            ISNULL(C6.C6_QTDVEN, 0) AS QTDVEN,
            ISNULL(C6.C6_PRCVEN, 0) AS PRCVEN,
            ISNULL(C6.C6_VALOR, 0) AS VALOR,
            RTRIM(ISNULL(C6.C6_ENTREG, '')) AS PREV_ENTREGA,
            RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS CLIENTE,
            RTRIM(ISNULL(C5.C5_VEND1, '')) AS VEND1
          FROM ${emp.sc6} C6
          LEFT JOIN ${emp.sc5} C5 
            ON C5.C5_FILIAL = C6.C6_FILIAL 
           AND C5.C5_NUM = C6.C6_NUM 
           AND C5.D_E_L_E_T_ = ' '
          WHERE C6.D_E_L_E_T_ = ' '
            AND (C6.C6_BLQ IS NULL OR RTRIM(C6.C6_BLQ) <> 'R')
            AND (C5.C5_NOTA IS NULL OR RTRIM(C5.C5_NOTA) = '' OR RTRIM(C5.C5_NOTA) = '0')
            AND (C6.C6_NOTA IS NULL OR RTRIM(C6.C6_NOTA) = '' OR RTRIM(C6.C6_NOTA) = '0')
          ORDER BY C6.C6_ENTREG ASC;
        `;
        const resSC6 = await executeRailwayQuery(sqlSC6);
        if (resSC6 && resSC6.rows) {
          for (const r of resSC6.rows) {
            const cod = String(r.PRODUTO || '').trim();
            if (!cod) continue;

            const prod = produtosMap.get(cod);
            if (!prod) continue; // Somente produtos acabados

            const qtdVenda = Number(r.QTDVEN) || 0;
            prod.qtd_vendas += qtdVenda;
            prod.detalhes_empresas[emp.cod].vendas += qtdVenda;
            prod.detalhes_empresas[emp.cod].vendasLista.push({
              pedido: r.NUM_PED,
              codWeb: r.COD_WEB || '-',
              item: r.ITEM,
              empresa: emp.sigla,
              cliente: r.CLIENTE || 'CLIENTE NÃO INFORMADO',
              vendedor: getNomeVendedor(r.VEND1) || r.VEND1 || 'NÃO INFORMADO',
              qtdPedida: qtdVenda,
              preco: Number(r.PRCVEN) || 0,
              total: Number(r.VALOR) || 0,
              previsao: formatarDataProtheus(r.PREV_ENTREGA)
            });
          }
        }
      } catch (errEmpSC6) {
        console.warn(`Aviso ao consultar vendas em ${emp.sc6}:`, errEmpSC6.message);
      }
    }

    // 4. Extração de Compras Abertas SC7 (14, 15, 16)
    for (const emp of empresas) {
      try {
        const sqlSC7 = `
          SELECT 
            RTRIM(C7_NUM) AS NUM_PED,
            RTRIM(C7_ITEM) AS ITEM,
            RTRIM(C7_PRODUTO) AS PRODUTO,
            RTRIM(ISNULL(C7_DESCRI, '')) AS DESCRICAO,
            ISNULL(C7_QUANT, 0) AS QUANT,
            ISNULL(C7_QUJE, 0) AS QUJE,
            ISNULL(C7_PRECO, 0) AS PRECO,
            ISNULL(C7_TOTAL, 0) AS TOTAL,
            RTRIM(ISNULL(C7_DATPRF, '')) AS PREV_ENTREGA,
            RTRIM(ISNULL(C7_FORNECE, '')) AS FORNECE,
            RTRIM(ISNULL(A2.A2_NOME, '')) AS NOME_FORNECEDOR
          FROM ${emp.sc7} C7
          LEFT JOIN SA2010 A2 
            ON A2.A2_COD = C7.C7_FORNECE 
           AND A2.A2_LOJA = C7.C7_LOJA 
           AND A2.D_E_L_E_T_ = ' '
          WHERE C7.D_E_L_E_T_ = ' '
            AND (C7.C7_RESIDUO IS NULL OR RTRIM(C7.C7_RESIDUO) <> 'S')
            AND (C7.C7_QUANT - C7.C7_QUJE) > 0
          ORDER BY C7.C7_DATPRF ASC;
        `;
        const resSC7 = await executeRailwayQuery(sqlSC7);
        if (resSC7 && resSC7.rows) {
          for (const r of resSC7.rows) {
            const cod = String(r.PRODUTO || '').trim();
            if (!cod) continue;

            const prod = produtosMap.get(cod);
            if (!prod) continue; // Somente produtos acabados

            const qtdComprada = Number(r.QUANT) || 0;
            const qtdEntregue = Number(r.QUJE) || 0;
            const saldoCompra = Math.max(0, qtdComprada - qtdEntregue);

            prod.qtd_compras += saldoCompra;
            prod.detalhes_empresas[emp.cod].compras += saldoCompra;
            prod.detalhes_empresas[emp.cod].comprasLista.push({
              pedido: `${emp.sigla}${r.NUM_PED}`,
              numPed: r.NUM_PED,
              item: r.ITEM,
              empresa: emp.sigla,
              fornecedor: r.NOME_FORNECEDOR || r.FORNECE || 'FORNECEDOR NÃO INFORMADO',
              qtdComprada: qtdComprada,
              qtdEntregue: qtdEntregue,
              saldoCompra: saldoCompra,
              preco: Number(r.PRECO) || 0,
              total: Number(r.TOTAL) || 0,
              previsao: formatarDataProtheus(r.PREV_ENTREGA)
            });
          }
        }
      } catch (errEmpSC7) {
        console.warn(`Aviso ao consultar compras em ${emp.sc7}:`, errEmpSC7.message);
      }
    }

    // 5. Calcula Saldo Total = Saldo * Preço e filtra itens válidos
    const produtosList = Array.from(produtosMap.values()).map(p => {
      p.saldo_total = roundVal(Number(p.saldo || 0) * Number(p.preco || 0));
      return p;
    });

    const duracaoMs = Date.now() - inicioTime;
    const metaSalvo = await saveSaldosEstoqueDB(produtosList, {
      status: 'SUCCESS',
      duracao_ms: duracaoMs,
      triggered_by: triggeredBy
    });

    console.log(`✅ [Saldos Estoque Sync] Concluído com sucesso em ${duracaoMs}ms! Total: ${produtosList.length} produtos.`);
    return {
      success: true,
      count: produtosList.length,
      ...metaSalvo
    };
  } catch (err) {
    const duracaoMs = Date.now() - inicioTime;
    console.error(`❌ [Saldos Estoque Sync Error]:`, err.message);

    await saveSaldosEstoqueDB([], {
      status: 'ERROR',
      duracao_ms: duracaoMs,
      triggered_by: triggeredBy,
      error_message: err.message
    });

    return {
      success: false,
      error: err.message,
      duracao_ms: duracaoMs
    };
  }
}

// Mapa Oficial dos 33 Grupos de Produtos do Protheus (SBM010)
const GRUPOS_PRODUTOS_MAP = {
  '001': '001 - Cofres',
  '002': '002 - Fragmentadoras',
  '003': '003 - Contadoras',
  '004': '004 - Desumidificadores',
  '005': '005 - Detectores de Metal',
  '006': '006 - Encadernação',
  '007': '007 - Guilhotinas',
  '008': '008 - Guarda Volumes',
  '009': '009 - Lixeiras',
  '010': '010 - Plastificação',
  '011': '011 - Porta Chaves',
  '012': '012 - Refiladoras',
  '013': '013 - Seladoras',
  '014': '014 - Ergonômicos',
  '015': '015 - Suportes p/ Pasta Suspensa',
  '016': '016 - Ventiladores e Climatizadores',
  '017': '017 - Racks',
  '018': '018 - Mobiliário / Armários',
  '019': '019 - Armazenamento Storage',
  '020': '020 - Carrinhos de Carga',
  '021': '021 - Portas Blindadas',
  '022': '022 - Filme Plástico p/ Embalagem',
  '023': '023 - Organização e Transp. Valores',
  '024': '024 - Caça e Camping',
  '025': '025 - Acessórios para Veículos',
  '026': '026 - Esporte e Lazer',
  '027': '027 - Material de Escritório',
  '028': '028 - Bebedouros',
  '029': '029 - Limpeza Máq. e Suprimentos',
  '030': '030 - Indústria Alimentícia',
  '044': '044 - Informática',
  '090': '090 - Insumos em Geral',
  '091': '091 - Insumos Produção Cofres'
};

/**
 * Retorna a descrição amigável oficial do grupo de produtos Protheus
 */
function getGrupoDescricao(cod) {
  if (!cod) return 'Outros / Sem Grupo';
  const clean = String(cod).trim().replace(/^0+/, '');
  const padded3 = clean.padStart(3, '0');
  if (GRUPOS_PRODUTOS_MAP[padded3]) {
    return GRUPOS_PRODUTOS_MAP[padded3];
  }
  return `Grupo ${String(cod).trim()}`;
}

/**
 * Consulta itens faturados (SD2 + SF2) no Protheus nas empresas MP (14), GSI (15) e OACO (16)
 */
async function consultarFaturamentoHistorico({ dataIni, dataFim, empresa } = {}) {
  const cleanDataIni = String(dataIni || '').replace(/\D/g, '');
  const cleanDataFim = String(dataFim || '').replace(/\D/g, '');

  const empresas = [
    { cod: "14", sigla: "MP", nome: "Metal Pleno (14)", sd2: "SD2140", sf2: "SF2140" },
    { cod: "15", sigla: "GSI", nome: "GSI (15)", sd2: "SD2150", sf2: "SF2150" },
    { cod: "16", sigla: "OACO", nome: "OACO (16)", sd2: "SD2160", sf2: "SF2160" }
  ];

  const empresasFiltradas = empresa 
    ? empresas.filter(e => e.cod === String(empresa) || e.sigla.toUpperCase() === String(empresa).toUpperCase())
    : empresas;

  const itensResultados = [];

  for (const emp of empresasFiltradas) {
    try {
      let filtroData = '';
      if (cleanDataIni && cleanDataFim) {
        filtroData = `AND D2.D2_EMISSAO >= '${cleanDataIni}' AND D2.D2_EMISSAO <= '${cleanDataFim}'`;
      } else if (cleanDataIni) {
        filtroData = `AND D2.D2_EMISSAO >= '${cleanDataIni}'`;
      } else if (cleanDataFim) {
        filtroData = `AND D2.D2_EMISSAO <= '${cleanDataFim}'`;
      }

      const sql = `
        SELECT
          '${emp.cod}' AS EMPRESA_COD,
          '${emp.sigla}' AS EMPRESA_SIGLA,
          RTRIM(D2.D2_DOC) AS NOTA_DOC,
          RTRIM(D2.D2_SERIE) AS NOTA_SERIE,
          RTRIM(D2.D2_ITEM) AS ITEM_NUM,
          RTRIM(ISNULL(D2.D2_PEDIDO, '')) AS PEDIDO_VENDA,
          RTRIM(ISNULL(D2.D2_CLIENTE, '')) AS CLIENTE_COD,
          RTRIM(ISNULL(A1.A1_NOME, '')) AS CLIENTE_NOME,
          RTRIM(ISNULL(F2.F2_VEND1, '')) AS VENDEDOR_COD,
          RTRIM(D2.D2_COD) AS PRODUTO_COD,
          RTRIM(COALESCE(B19.B1_DESC, B16.B1_DESC, '')) AS PRODUTO_DESC,
          RTRIM(ISNULL(D2.D2_GRUPO, COALESCE(B19.B1_GRUPO, B16.B1_GRUPO, ''))) AS GRUPO_COD,
          ISNULL(D2.D2_QUANT, 0) AS QUANTIDADE,
          ISNULL(D2.D2_PRCVEN, 0) AS PRECO_UNITARIO,
          ISNULL(D2.D2_TOTAL, 0) AS VALOR_TOTAL_ITEM,
          ISNULL(F2.F2_VALBRUT, 0) AS VALOR_TOTAL_NOTA,
          RTRIM(ISNULL(D2.D2_CF, '')) AS CFOP,
          RTRIM(ISNULL(D2.D2_TIPO, ISNULL(F2.F2_TIPO, 'N'))) AS TIPO_NOTA,
          RTRIM(D2.D2_EMISSAO) AS DATA_EMISSAO
        FROM ${emp.sd2} D2
        LEFT JOIN ${emp.sf2} F2
          ON F2.F2_FILIAL = D2.D2_FILIAL
         AND F2.F2_DOC = D2.D2_DOC
         AND F2.F2_SERIE = D2.D2_SERIE
         AND F2.D_E_L_E_T_ = ' '
        LEFT JOIN SB1090 B19
          ON B19.B1_COD = D2.D2_COD
         AND B19.D_E_L_E_T_ = ' '
        LEFT JOIN SB1160 B16
          ON B16.B1_COD = D2.D2_COD
         AND B16.D_E_L_E_T_ = ' '
        LEFT JOIN SA1010 A1
          ON A1.A1_COD = D2.D2_CLIENTE
         AND A1.A1_LOJA = D2.D2_LOJA
         AND A1.D_E_L_E_T_ = ' '
        WHERE D2.D_E_L_E_T_ = ' '
          AND (D2.D2_TIPO IS NULL OR D2.D2_TIPO IN ('N', 'C'))
          ${filtroData}
        ORDER BY D2.D2_EMISSAO DESC, D2.D2_DOC DESC, D2.D2_ITEM ASC;
      `;

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows) {
        for (const r of dbRes.rows) {
          const rawEmissao = String(r.DATA_EMISSAO || '').trim();
          let dataFormatada = '';
          let mesAno = '';
          if (rawEmissao.length === 8) {
            const ano = rawEmissao.substring(0, 4);
            const mes = rawEmissao.substring(4, 6);
            const dia = rawEmissao.substring(6, 8);
            dataFormatada = `${ano}-${mes}-${dia}`;
            mesAno = `${ano}-${mes}`;
          } else {
            dataFormatada = new Date().toISOString().split('T')[0];
            mesAno = dataFormatada.substring(0, 7);
          }

          const vendCod = String(r.VENDEDOR_COD || '').trim();
          const vendNome = getNomeVendedor(vendCod) || (vendCod ? `Vendedor ${vendCod}` : 'Vendedor Não Identificado');
          const grupoCod = String(r.GRUPO_COD || '').trim();
          const grupoDesc = getGrupoDescricao(grupoCod);

          itensResultados.push({
            empresa_cod: emp.cod,
            empresa_sigla: emp.sigla,
            nota_doc: String(r.NOTA_DOC || '').trim(),
            nota_serie: String(r.NOTA_SERIE || '').trim(),
            item_num: String(r.ITEM_NUM || '').trim(),
            pedido_venda: String(r.PEDIDO_VENDA || '').trim(),
            cliente_cod: String(r.CLIENTE_COD || '').trim(),
            cliente_nome: String(r.CLIENTE_NOME || '').trim() || 'CLIENTE NÃO INFORMADO',
            vendedor_cod: vendCod,
            vendedor_nome: vendNome,
            produto_cod: String(r.PRODUTO_COD || '').trim(),
            produto_descricao: String(r.PRODUTO_DESC || '').trim() || 'PRODUTO NÃO INFORMADO',
            grupo_cod: grupoCod,
            grupo_descricao: grupoDesc,
            quantidade: Number(r.QUANTIDADE || 0),
            preco_unitario: Number(r.PRECO_UNITARIO || 0),
            valor_total_item: Number(r.VALOR_TOTAL_ITEM || 0),
            valor_total_nota: Number(r.VALOR_TOTAL_NOTA || 0),
            cfop: String(r.CFOP || '').trim(),
            tipo_nota: String(r.TIPO_NOTA || 'N').trim(),
            data_emissao: dataFormatada,
            mes_ano: mesAno
          });
        }
      }
    } catch (errEmp) {
      console.warn(`Aviso ao consultar faturamento em ${emp.nome}:`, errEmp.message);
    }
  }

  return itensResultados;
}

/**
 * Executa a sincronização completa de faturamento do Protheus para o Supabase
 */
async function sincronizarFaturamentoConsolidado({ dataIni, dataFim, triggeredBy = 'MANUAL' } = {}) {
  const inicioTime = Date.now();
  console.log(`⏳ [Faturamento Sync] Iniciando sincronização (${triggeredBy})...`);

  try {
    const { saveFaturamentoHistoricoDB } = require('./postgres_db');
    const itens = await consultarFaturamentoHistorico({ dataIni, dataFim });
    const duracaoMs = Date.now() - inicioTime;

    const resultado = await saveFaturamentoHistoricoDB(itens, {
      status: 'SUCCESS',
      duracao_ms: duracaoMs,
      triggered_by: triggeredBy
    });

    console.log(`✅ [Faturamento Sync] Concluído com sucesso em ${duracaoMs}ms! Total: ${itens.length} itens.`);
    return {
      success: true,
      count: itens.length,
      duracao_ms: duracaoMs,
      ...resultado
    };
  } catch (err) {
    const duracaoMs = Date.now() - inicioTime;
    console.error(`❌ [Faturamento Sync Error]:`, err.message);
    return {
      success: false,
      error: err.message,
      duracao_ms: duracaoMs
    };
  }
}

/**
 * Consulta Pedidos Liberados e Prontos para Faturar (MATA460A - Legenda Verde)
 * Junta SC9, SC5, SC6, SA4 e SF2 nas 3 empresas (OACO, GSI, METAL PLENO)
 */
async function buscarPedidosProntosFaturar({ empresa, search, limit = 500 } = {}) {
  const cleanEmpresa = sanitizeSqlParam(empresa || '').toUpperCase();
  const cleanSearch = sanitizeSqlParam(search || '').toLowerCase();

  const empresasConfig = [
    { key: "OACO", sigla: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", sc5: "SC5160", sc6: "SC6160", sc9: "SC9160", sf2: "SF2160" },
    { key: "GSI", sigla: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", sc5: "SC5150", sc6: "SC6150", sc9: "SC9150", sf2: "SF2150" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14", nome: "Empresa 14 (METAL PLENO)", sc5: "SC5140", sc6: "SC6140", sc9: "SC9140", sf2: "SF2140" }
  ];

  let empresasFiltradas = empresasConfig;
  if (cleanEmpresa && cleanEmpresa !== 'TODAS' && cleanEmpresa !== 'TODOS') {
    empresasFiltradas = empresasConfig.filter(e => 
      e.key === cleanEmpresa || 
      e.sigla === cleanEmpresa || 
      e.codigo === cleanEmpresa || 
      (cleanEmpresa === 'MP' && e.key === 'METAL_PLENO')
    );
    if (empresasFiltradas.length === 0) empresasFiltradas = empresasConfig;
  }

  const results = [];

  for (const emp of empresasFiltradas) {
    try {
      const sql = `
        SELECT TOP ${parseInt(limit, 10) || 500}
          RTRIM(C9.C9_FILIAL) AS FILIAL,
          RTRIM(C9.C9_PEDIDO) AS PEDIDO,
          RTRIM(C9.C9_ITEM) AS ITEM,
          RTRIM(C9.C9_SEQUEN) AS SEQUEN,
          RTRIM(C9.C9_CLIENTE) AS CLIENTE,
          RTRIM(C9.C9_LOJA) AS LOJA,
          RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS NOMECLI,
          RTRIM(C9.C9_PRODUTO) AS PRODUTO,
          RTRIM(ISNULL(C6.C6_DESCRI, C9.C9_PRODUTO)) AS PROD_DESC,
          C9.C9_QTDLIB AS QTDLIB,
          C9.C9_PRCVEN AS PRCVEN,
          (C9.C9_QTDLIB * C9.C9_PRCVEN) AS VALOR_ITEM,
          RTRIM(C9.C9_BLCRED) AS BLCRED,
          RTRIM(C9.C9_BLEST) AS BLEST,
          RTRIM(C9.C9_BLOQUEI) AS BLOQUEI,
          RTRIM(C9.C9_NFISCAL) AS NFISCAL,
          RTRIM(C9.C9_SERIENF) AS SERIENF,
          RTRIM(C9.C9_DATALIB) AS DATALIB,
          RTRIM(C9.C9_DATENT) AS DATENT,
          RTRIM(ISNULL(C5.C5_CODWEB, '')) AS CODWEB,
          RTRIM(ISNULL(C5.C5_EMISSAO, '')) AS EMISSAO,
          RTRIM(ISNULL(C5.C5_TRANSP, '')) AS COD_TRANSP,
          RTRIM(ISNULL(A4.A4_NOME, '')) AS NOME_TRANSP,
          RTRIM(ISNULL(C5.C5_VEND1, '')) AS VEND1,
          ISNULL(C5.C5_FRETE, 0) AS C5_FRETE,
          ISNULL(C5.C5_VLR_FRT, 0) AS C5_VLR_FRT,
          RTRIM(ISNULL(C5.C5_TPFRETE, '')) AS TPFRETE
        FROM ${emp.sc9} C9
        INNER JOIN ${emp.sc5} C5
          ON C5.C5_FILIAL = C9.C9_FILIAL
         AND C5.C5_NUM = C9.C9_PEDIDO
         AND C5.D_E_L_E_T_ = ' '
        LEFT JOIN ${emp.sc6} C6
          ON C6.C6_FILIAL = C9.C9_FILIAL
         AND C6.C6_NUM = C9.C9_PEDIDO
         AND C6.C6_ITEM = C9.C9_ITEM
         AND C6.D_E_L_E_T_ = ' '
        LEFT JOIN SA4010 A4
          ON A4.A4_COD = C5.C5_TRANSP
         AND A4.D_E_L_E_T_ = ' '
        LEFT JOIN ${emp.sf2} F2
          ON F2.F2_FILIAL = C9.C9_FILIAL
         AND F2.F2_DOC = C9.C9_NFISCAL
         AND F2.F2_SERIE = C9.C9_SERIENF
         AND F2.D_E_L_E_T_ = ' '
        WHERE C9.D_E_L_E_T_ = ' '
          AND (C9.C9_BLEST IS NULL OR RTRIM(C9.C9_BLEST) = '' OR RTRIM(C9.C9_BLEST) = '10' OR RTRIM(C9.C9_BLEST) NOT IN ('02'))
          AND (C9.C9_BLCRED IS NULL OR RTRIM(C9.C9_BLCRED) = '' OR RTRIM(C9.C9_BLCRED) = '10' OR RTRIM(C9.C9_BLCRED) NOT IN ('01'))
          AND (C9.C9_BLOQUEI IS NULL OR RTRIM(C9.C9_BLOQUEI) = '')
          AND C9.C9_QTDLIB > 0
          AND (
            C9.C9_NFISCAL IS NULL 
            OR RTRIM(C9.C9_NFISCAL) = '' 
            OR F2.F2_DOC IS NULL
          )
          AND (
            C5.C5_NOTA IS NULL 
            OR RTRIM(C5.C5_NOTA) = '' 
            OR RTRIM(C5.C5_NOTA) = 'XXXXXXXXX' 
            OR RTRIM(C5.C5_NOTA) = '0'
          )
          AND (C5.C5_MSBLQL IS NULL OR RTRIM(C5.C5_MSBLQL) <> '1')
        ORDER BY C9.C9_DATALIB DESC, C9.C9_PEDIDO DESC
      `;

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        const pedidosMap = new Map();
        for (const r of dbRes.rows) {
          const key = `${emp.sigla}_${r.PEDIDO}`;
          if (!pedidosMap.has(key)) {
            pedidosMap.set(key, {
              empresa: emp.sigla,
              empresaKey: emp.key,
              empresaNome: emp.nome,
              numPed: r.PEDIDO,
              codWeb: r.CODWEB || '-',
              clienteCod: r.CLIENTE,
              clienteLoja: r.LOJA,
              clienteNome: r.NOMECLI || 'CLIENTE NÃO INFORMADO',
              dataEmissao: r.EMISSAO,
              dataEmissaoFmt: formatarDataProtheus(r.EMISSAO),
              dataLib: r.DATALIB,
              dataLibFmt: formatarDataProtheus(r.DATALIB),
              dataPrevisao: r.DATENT || r.DATALIB,
              dataPrevisaoFmt: formatarDataProtheus(r.DATENT || r.DATALIB),
              codTransp: r.COD_TRANSP,
              nomeTransp: r.NOME_TRANSP || (r.COD_TRANSP ? `Transp. ${r.COD_TRANSP}` : 'NÃO INFORMADA'),
              tpFrete: r.TPFRETE === 'C' ? 'CIF' : (r.TPFRETE === 'F' ? 'FOB' : (r.TPFRETE || '-')),
              freteCobrado: parseFloat(r.C5_FRETE || 0),
              freteEmbutido: parseFloat(r.C5_VLR_FRT || 0),
              vendedorCod: r.VEND1,
              vendedorNome: getNomeVendedor(r.VEND1) || r.VEND1 || 'NÃO INFORMADO',
              totalQtd: 0,
              totalValor: 0,
              totalGeral: 0,
              itens: []
            });
          }
          const p = pedidosMap.get(key);
          const qtd = parseFloat(r.QTDLIB || 0);
          const prc = parseFloat(r.PRCVEN || 0);
          const tot = parseFloat(r.VALOR_ITEM || (qtd * prc));
          p.totalQtd += qtd;
          p.totalValor += tot;
          p.itens.push({
            item: r.ITEM,
            sequen: r.SEQUEN,
            produto: r.PRODUTO,
            descricao: r.PROD_DESC || r.PRODUTO,
            qtdLib: qtd,
            prcVenda: prc,
            total: tot
          });
        }

        for (const p of pedidosMap.values()) {
          p.totalValor = Math.round((p.totalValor + Number.EPSILON) * 100) / 100;
          p.totalGeral = Math.round(((p.totalValor + p.freteCobrado) + Number.EPSILON) * 100) / 100;

          if (cleanSearch) {
            const matches = 
              (p.numPed && p.numPed.toLowerCase().includes(cleanSearch)) ||
              (p.codWeb && p.codWeb.toLowerCase().includes(cleanSearch)) ||
              (p.clienteNome && p.clienteNome.toLowerCase().includes(cleanSearch)) ||
              (p.nomeTransp && p.nomeTransp.toLowerCase().includes(cleanSearch)) ||
              (p.vendedorNome && p.vendedorNome.toLowerCase().includes(cleanSearch));
            if (!matches) continue;
          }

          results.push(p);
        }
      }
    } catch (err) {
      console.warn(`Aviso: Erro ao buscar pedidos prontos para faturar em ${emp.nome}:`, err.message);
    }
  }

  results.sort((a, b) => (b.dataLib || b.dataEmissao || '').localeCompare(a.dataLib || a.dataEmissao || '') || (b.numPed || '').localeCompare(a.numPed || ''));
  return results;
}

/**
 * Consulta Pedidos Bloqueados por Estoque (C9_BLEST = '02')
 * Junta SC9, SC5, SC6, SA4 e SF2 nas 3 empresas (OACO, GSI, METAL PLENO)
 */
async function buscarPedidosBloqueadosEstoque({ empresa, search, limit = 500 } = {}) {
  const cleanEmpresa = sanitizeSqlParam(empresa || '').toUpperCase();
  const cleanSearch = sanitizeSqlParam(search || '').toLowerCase();

  const empresasConfig = [
    { key: "OACO", sigla: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", sc5: "SC5160", sc6: "SC6160", sc9: "SC9160", sf2: "SF2160" },
    { key: "GSI", sigla: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", sc5: "SC5150", sc6: "SC6150", sc9: "SC9150", sf2: "SF2150" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14", nome: "Empresa 14 (METAL PLENO)", sc5: "SC5140", sc6: "SC6140", sc9: "SC9140", sf2: "SF2140" }
  ];

  let empresasFiltradas = empresasConfig;
  if (cleanEmpresa && cleanEmpresa !== 'TODAS' && cleanEmpresa !== 'TODOS') {
    empresasFiltradas = empresasConfig.filter(e => 
      e.key === cleanEmpresa || 
      e.sigla === cleanEmpresa || 
      e.codigo === cleanEmpresa || 
      (cleanEmpresa === 'MP' && e.key === 'METAL_PLENO')
    );
    if (empresasFiltradas.length === 0) empresasFiltradas = empresasConfig;
  }

  const results = [];

  for (const emp of empresasFiltradas) {
    try {
      const sql = `
        SELECT TOP ${parseInt(limit, 10) || 500}
          RTRIM(C9.C9_FILIAL) AS FILIAL,
          RTRIM(C9.C9_PEDIDO) AS PEDIDO,
          RTRIM(C9.C9_ITEM) AS ITEM,
          RTRIM(C9.C9_SEQUEN) AS SEQUEN,
          RTRIM(C9.C9_CLIENTE) AS CLIENTE,
          RTRIM(C9.C9_LOJA) AS LOJA,
          RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS NOMECLI,
          RTRIM(C9.C9_PRODUTO) AS PRODUTO,
          RTRIM(ISNULL(C6.C6_DESCRI, C9.C9_PRODUTO)) AS PROD_DESC,
          C9.C9_QTDLIB AS QTDLIB,
          C9.C9_PRCVEN AS PRCVEN,
          (C9.C9_QTDLIB * C9.C9_PRCVEN) AS VALOR_ITEM,
          RTRIM(C9.C9_BLCRED) AS BLCRED,
          RTRIM(C9.C9_BLEST) AS BLEST,
          RTRIM(C9.C9_BLOQUEI) AS BLOQUEI,
          RTRIM(C9.C9_NFISCAL) AS NFISCAL,
          RTRIM(C9.C9_SERIENF) AS SERIENF,
          RTRIM(C9.C9_DATALIB) AS DATALIB,
          RTRIM(C9.C9_DATENT) AS DATENT,
          RTRIM(ISNULL(C5.C5_CODWEB, '')) AS CODWEB,
          RTRIM(ISNULL(C5.C5_EMISSAO, '')) AS EMISSAO,
          RTRIM(ISNULL(C5.C5_TRANSP, '')) AS COD_TRANSP,
          RTRIM(ISNULL(A4.A4_NOME, '')) AS NOME_TRANSP,
          RTRIM(ISNULL(C5.C5_VEND1, '')) AS VEND1,
          ISNULL(C5.C5_FRETE, 0) AS C5_FRETE,
          ISNULL(C5.C5_VLR_FRT, 0) AS C5_VLR_FRT,
          RTRIM(ISNULL(C5.C5_TPFRETE, '')) AS TPFRETE
        FROM ${emp.sc9} C9
        INNER JOIN ${emp.sc5} C5
          ON C5.C5_FILIAL = C9.C9_FILIAL
         AND C5.C5_NUM = C9.C9_PEDIDO
         AND C5.D_E_L_E_T_ = ' '
        LEFT JOIN ${emp.sc6} C6
          ON C6.C6_FILIAL = C9.C9_FILIAL
         AND C6.C6_NUM = C9.C9_PEDIDO
         AND C6.C6_ITEM = C9.C9_ITEM
         AND C6.D_E_L_E_T_ = ' '
        LEFT JOIN SA4010 A4
          ON A4.A4_COD = C5.C5_TRANSP
         AND A4.D_E_L_E_T_ = ' '
        LEFT JOIN ${emp.sf2} F2
          ON F2.F2_FILIAL = C9.C9_FILIAL
         AND F2.F2_DOC = C9.C9_NFISCAL
         AND F2.F2_SERIE = C9.C9_SERIENF
         AND F2.D_E_L_E_T_ = ' '
        WHERE C9.D_E_L_E_T_ = ' '
          AND RTRIM(C9.C9_BLEST) = '02'
          AND C9.C9_QTDLIB > 0
          AND (
            C9.C9_NFISCAL IS NULL 
            OR RTRIM(C9.C9_NFISCAL) = '' 
            OR F2.F2_DOC IS NULL
          )
          AND (
            C5.C5_NOTA IS NULL 
            OR RTRIM(C5.C5_NOTA) = '' 
            OR RTRIM(C5.C5_NOTA) = 'XXXXXXXXX' 
            OR RTRIM(C5.C5_NOTA) = '0'
          )
          AND (C5.C5_MSBLQL IS NULL OR RTRIM(C5.C5_MSBLQL) <> '1')
        ORDER BY C9.C9_DATALIB DESC, C9.C9_PEDIDO DESC
      `;

      const dbRes = await executeRailwayQuery(sql);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        const pedidosMap = new Map();
        for (const r of dbRes.rows) {
          const key = `${emp.sigla}_${r.PEDIDO}`;
          if (!pedidosMap.has(key)) {
            pedidosMap.set(key, {
              empresa: emp.sigla,
              empresaKey: emp.key,
              empresaNome: emp.nome,
              numPed: r.PEDIDO,
              codWeb: r.CODWEB || '-',
              clienteCod: r.CLIENTE,
              clienteLoja: r.LOJA,
              clienteNome: r.NOMECLI || 'CLIENTE NÃO INFORMADO',
              dataEmissao: r.EMISSAO,
              dataEmissaoFmt: formatarDataProtheus(r.EMISSAO),
              dataLib: r.DATALIB,
              dataLibFmt: formatarDataProtheus(r.DATALIB),
              dataPrevisao: r.DATENT || r.DATALIB,
              dataPrevisaoFmt: formatarDataProtheus(r.DATENT || r.DATALIB),
              codTransp: r.COD_TRANSP,
              nomeTransp: r.NOME_TRANSP || (r.COD_TRANSP ? `Transp. ${r.COD_TRANSP}` : 'NÃO INFORMADA'),
              tpFrete: r.TPFRETE === 'C' ? 'CIF' : (r.TPFRETE === 'F' ? 'FOB' : (r.TPFRETE || '-')),
              freteCobrado: parseFloat(r.C5_FRETE || 0),
              freteEmbutido: parseFloat(r.C5_VLR_FRT || 0),
              vendedorCod: r.VEND1,
              vendedorNome: getNomeVendedor(r.VEND1) || r.VEND1 || 'NÃO INFORMADO',
              codBlEst: r.BLEST || '02',
              codBlCred: r.BLCRED || '',
              bloqMotivo: r.BLCRED === '01' ? 'Estoque + Crédito' : 'Falta de Estoque',
              totalQtd: 0,
              totalValor: 0,
              totalGeral: 0,
              itens: []
            });
          }
          const p = pedidosMap.get(key);
          const qtd = parseFloat(r.QTDLIB || 0);
          const prc = parseFloat(r.PRCVEN || 0);
          const tot = parseFloat(r.VALOR_ITEM || (qtd * prc));
          p.totalQtd += qtd;
          p.totalValor += tot;
          p.itens.push({
            item: r.ITEM,
            sequen: r.SEQUEN,
            produto: r.PRODUTO,
            descricao: r.PROD_DESC || r.PRODUTO,
            qtdLib: qtd,
            prcVenda: prc,
            total: tot,
            blEst: r.BLEST
          });
        }

        for (const p of pedidosMap.values()) {
          p.totalValor = Math.round((p.totalValor + Number.EPSILON) * 100) / 100;
          p.totalGeral = Math.round(((p.totalValor + p.freteCobrado) + Number.EPSILON) * 100) / 100;

          if (cleanSearch) {
            const matches = 
              (p.numPed && p.numPed.toLowerCase().includes(cleanSearch)) ||
              (p.codWeb && p.codWeb.toLowerCase().includes(cleanSearch)) ||
              (p.clienteNome && p.clienteNome.toLowerCase().includes(cleanSearch)) ||
              (p.nomeTransp && p.nomeTransp.toLowerCase().includes(cleanSearch)) ||
              (p.vendedorNome && p.vendedorNome.toLowerCase().includes(cleanSearch));
            if (!matches) continue;
          }

          results.push(p);
        }
      }
    } catch (err) {
      console.warn(`Aviso: Erro ao buscar pedidos bloqueados por estoque em ${emp.nome}:`, err.message);
    }
  }

  results.sort((a, b) => (b.dataLib || b.dataEmissao || '').localeCompare(a.dataLib || a.dataEmissao || '') || (b.numPed || '').localeCompare(a.numPed || ''));
  return results;
}

/**
 * Consulta e Analisa Pedidos com Bloqueio de Estoque (C9_BLEST = '02')
 * Aplica algoritmo de Fila Sequencial FIFO por Produto contra os saldos de estoque (SB2)
 * Classifica os pedidos em:
 *  - PRONTO: 'Ped. Pronto pra Ser Liberado' (100% dos itens atendidos pelo saldo)
 *  - PARCIAL: 'Lib Parcial' (parte dos itens atendida)
 *  - AGUARDANDO: 'Aguardando Estoque' (nenhum item possui saldo disponível)
 */
async function buscarPedidosAnaliseLibEstoque({ empresa, search, limit = 500 } = {}) {
  const cleanEmpresa = sanitizeSqlParam(empresa || '').toUpperCase();
  const cleanSearch = sanitizeSqlParam(search || '').toLowerCase();

  const empresasConfig = [
    { key: "OACO", sigla: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", sc5: "SC5160", sc6: "SC6160", sc9: "SC9160", sf2: "SF2160", sb2: "SB2160" },
    { key: "GSI", sigla: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", sc5: "SC5150", sc6: "SC6150", sc9: "SC9150", sf2: "SF2150", sb2: "SB2150" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14", nome: "Empresa 14 (METAL PLENO)", sc5: "SC5140", sc6: "SC6140", sc9: "SC9140", sf2: "SF2140", sb2: "SB2140" }
  ];

  let empresasFiltradas = empresasConfig;
  if (cleanEmpresa && cleanEmpresa !== 'TODAS' && cleanEmpresa !== 'TODOS') {
    empresasFiltradas = empresasConfig.filter(e => 
      e.key === cleanEmpresa || 
      e.sigla === cleanEmpresa || 
      e.codigo === cleanEmpresa || 
      (cleanEmpresa === 'MP' && e.key === 'METAL_PLENO')
    );
    if (empresasFiltradas.length === 0) empresasFiltradas = empresasConfig;
  }

  const results = [];

  for (const emp of empresasFiltradas) {
    try {
      // 1. Consulta Saldos SB2 da Empresa (Disponível = B2_QATU - B2_RESERVA - B2_QEMP)
      const saldoMap = new Map();
      try {
        const sqlSB2 = `
          SELECT 
            RTRIM(B2_COD) AS B2_COD,
            ISNULL(SUM(B2_QATU - B2_RESERVA - B2_QEMP), 0) AS SALDO_DISP
          FROM ${emp.sb2}
          WHERE D_E_L_E_T_ = ' '
          GROUP BY B2_COD;
        `;
        const resSB2 = await executeRailwayQuery(sqlSB2);
        if (resSB2 && resSB2.rows) {
          for (const r of resSB2.rows) {
            const cod = String(r.B2_COD || '').trim();
            const saldo = Math.max(0, parseFloat(r.SALDO_DISP || 0));
            saldoMap.set(cod, saldo);
          }
        }
      } catch (errSB2) {
        console.warn(`Aviso ao consultar SB2 de ${emp.sigla}:`, errSB2.message);
      }

      // 2. Consulta Itens em SC9 com Bloqueio de Estoque (C9_BLEST = '02')
      const sqlSC9 = `
        SELECT TOP ${parseInt(limit, 10) || 500}
          RTRIM(C9.C9_FILIAL) AS FILIAL,
          RTRIM(C9.C9_PEDIDO) AS PEDIDO,
          RTRIM(C9.C9_ITEM) AS ITEM,
          RTRIM(C9.C9_SEQUEN) AS SEQUEN,
          RTRIM(C9.C9_CLIENTE) AS CLIENTE,
          RTRIM(C9.C9_LOJA) AS LOJA,
          RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS NOMECLI,
          RTRIM(C9.C9_PRODUTO) AS PRODUTO,
          RTRIM(ISNULL(C6.C6_DESCRI, C9.C9_PRODUTO)) AS PROD_DESC,
          C9.C9_QTDLIB AS QTDLIB,
          C9.C9_PRCVEN AS PRCVEN,
          (C9.C9_QTDLIB * C9.C9_PRCVEN) AS VALOR_ITEM,
          RTRIM(C9.C9_BLCRED) AS BLCRED,
          RTRIM(C9.C9_BLEST) AS BLEST,
          RTRIM(C9.C9_BLOQUEI) AS BLOQUEI,
          RTRIM(C9.C9_NFISCAL) AS NFISCAL,
          RTRIM(C9.C9_SERIENF) AS SERIENF,
          RTRIM(C9.C9_DATALIB) AS DATALIB,
          RTRIM(C9.C9_DATENT) AS DATENT,
          RTRIM(ISNULL(C5.C5_CODWEB, '')) AS CODWEB,
          RTRIM(ISNULL(C5.C5_EMISSAO, '')) AS EMISSAO,
          RTRIM(ISNULL(C5.C5_TRANSP, '')) AS COD_TRANSP,
          RTRIM(ISNULL(A4.A4_NOME, '')) AS NOME_TRANSP,
          RTRIM(ISNULL(C5.C5_VEND1, '')) AS VEND1,
          ISNULL(C5.C5_FRETE, 0) AS C5_FRETE,
          ISNULL(C5.C5_VLR_FRT, 0) AS C5_VLR_FRT,
          RTRIM(ISNULL(C5.C5_TPFRETE, '')) AS TPFRETE
        FROM ${emp.sc9} C9
        INNER JOIN ${emp.sc5} C5
          ON C5.C5_FILIAL = C9.C9_FILIAL
         AND C5.C5_NUM = C9.C9_PEDIDO
         AND C5.D_E_L_E_T_ = ' '
        LEFT JOIN ${emp.sc6} C6
          ON C6.C6_FILIAL = C9.C9_FILIAL
         AND C6.C6_NUM = C9.C9_PEDIDO
         AND C6.C6_ITEM = C9.C9_ITEM
         AND C6.D_E_L_E_T_ = ' '
        LEFT JOIN SA4010 A4
          ON A4.A4_COD = C5.C5_TRANSP
         AND A4.D_E_L_E_T_ = ' '
        LEFT JOIN ${emp.sf2} F2
          ON F2.F2_FILIAL = C9.C9_FILIAL
         AND F2.F2_DOC = C9.C9_NFISCAL
         AND F2.F2_SERIE = C9.C9_SERIENF
         AND F2.D_E_L_E_T_ = ' '
        WHERE C9.D_E_L_E_T_ = ' '
          AND RTRIM(C9.C9_BLEST) = '02'
          AND C9.C9_QTDLIB > 0
          AND (
            C9.C9_NFISCAL IS NULL 
            OR RTRIM(C9.C9_NFISCAL) = '' 
            OR F2.F2_DOC IS NULL
          )
          AND (
            C5.C5_NOTA IS NULL 
            OR RTRIM(C5.C5_NOTA) = '' 
            OR RTRIM(C5.C5_NOTA) = 'XXXXXXXXX' 
            OR RTRIM(C5.C5_NOTA) = '0'
          )
          AND (C5.C5_MSBLQL IS NULL OR RTRIM(C5.C5_MSBLQL) <> '1')
        ORDER BY C9.C9_DATALIB ASC, C9.C9_PEDIDO ASC, C9.C9_ITEM ASC;
      `;

      const dbRes = await executeRailwayQuery(sqlSC9);
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        // Agrupar itens por PRODUTO para a Fila FIFO
        const itensPorProduto = new Map();
        const rawItems = [];

        for (const r of dbRes.rows) {
          const itemObj = {
            empresa: emp.sigla,
            empresaKey: emp.key,
            empresaNome: emp.nome,
            numPed: r.PEDIDO,
            codWeb: r.CODWEB || '-',
            item: r.ITEM,
            sequen: r.SEQUEN,
            produto: r.PRODUTO,
            descricao: r.PROD_DESC || r.PRODUTO,
            qtdLib: parseFloat(r.QTDLIB || 0),
            prcVenda: parseFloat(r.PRCVEN || 0),
            valorItem: parseFloat(r.VALOR_ITEM || (parseFloat(r.QTDLIB || 0) * parseFloat(r.PRCVEN || 0))),
            blEst: r.BLEST || '02',
            blCred: r.BLCRED || '',
            dataLib: r.DATALIB,
            dataEmissao: r.EMISSAO,
            dataPrevisao: r.DATENT || r.DATALIB,
            clienteCod: r.CLIENTE,
            clienteLoja: r.LOJA,
            clienteNome: r.NOMECLI || 'CLIENTE NÃO INFORMADO',
            codTransp: r.COD_TRANSP,
            nomeTransp: r.NOME_TRANSP || (r.COD_TRANSP ? `Transp. ${r.COD_TRANSP}` : 'NÃO INFORMADA'),
            tpFrete: r.TPFRETE === 'C' ? 'CIF' : (r.TPFRETE === 'F' ? 'FOB' : (r.TPFRETE || '-')),
            freteCobrado: parseFloat(r.C5_FRETE || 0),
            freteEmbutido: parseFloat(r.C5_VLR_FRT || 0),
            vendedorCod: r.VEND1,
            vendedorNome: getNomeVendedor(r.VEND1) || r.VEND1 || 'NÃO INFORMADO'
          };

          rawItems.push(itemObj);

          if (!itensPorProduto.has(itemObj.produto)) {
            itensPorProduto.set(itemObj.produto, []);
          }
          itensPorProduto.get(itemObj.produto).push(itemObj);
        }

        // Executar Fila FIFO por Produto
        for (const [prodCod, listaItens] of itensPorProduto.entries()) {
          // 1º critério: DataLib ASC (fallback Emissão); 2º critério: NumPed ASC; 3º critério: Item ASC
          listaItens.sort((a, b) => {
            const dtA = a.dataLib || a.dataEmissao || '99999999';
            const dtB = b.dataLib || b.dataEmissao || '99999999';
            if (dtA !== dtB) return dtA.localeCompare(dtB);

            const numA = parseInt(String(a.numPed).replace(/\D/g, ''), 10);
            const numB = parseInt(String(b.numPed).replace(/\D/g, ''), 10);
            if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;

            return String(a.item || '').localeCompare(String(b.item || ''));
          });

          let saldoDisponivel = saldoMap.get(prodCod) || 0;
          const saldoTotalFisico = saldoDisponivel;

          for (let i = 0; i < listaItens.length; i++) {
            const it = listaItens[i];
            it.posicaoFila = i + 1;
            it.saldoFisicoTotal = saldoTotalFisico;
            const necessita = it.qtdLib;

            if (saldoDisponivel >= necessita) {
              it.qtdAlocada = necessita;
              it.saldoFaltante = 0;
              it.statusItem = 'TOTAL';
              it.statusItemBadge = '🟢 Saldo Suficiente';
              saldoDisponivel -= necessita;
            } else if (saldoDisponivel > 0) {
              it.qtdAlocada = saldoDisponivel;
              it.saldoFaltante = necessita - saldoDisponivel;
              it.statusItem = 'PARCIAL';
              it.statusItemBadge = `🟡 Parcial (${saldoDisponivel}/${necessita})`;
              saldoDisponivel = 0;
            } else {
              it.qtdAlocada = 0;
              it.saldoFaltante = necessita;
              it.statusItem = 'SEM_SALDO';
              it.statusItemBadge = '🔴 Sem Saldo';
            }
          }
        }

        // Agrupar itens por Pedido
        const pedidosMap = new Map();
        for (const it of rawItems) {
          const key = `${emp.sigla}_${it.numPed}`;
          if (!pedidosMap.has(key)) {
            pedidosMap.set(key, {
              empresa: emp.sigla,
              empresaKey: emp.key,
              empresaNome: emp.nome,
              numPed: it.numPed,
              codWeb: it.codWeb,
              clienteCod: it.clienteCod,
              clienteLoja: it.clienteLoja,
              clienteNome: it.clienteNome,
              dataEmissao: it.dataEmissao,
              dataEmissaoFmt: formatarDataProtheus(it.dataEmissao),
              dataLib: it.dataLib,
              dataLibFmt: formatarDataProtheus(it.dataLib),
              dataPrevisao: it.dataPrevisao,
              dataPrevisaoFmt: formatarDataProtheus(it.dataPrevisao),
              codTransp: it.codTransp,
              nomeTransp: it.nomeTransp,
              tpFrete: it.tpFrete,
              freteCobrado: it.freteCobrado,
              freteEmbutido: it.freteEmbutido,
              vendedorCod: it.vendedorCod,
              vendedorNome: it.vendedorNome,
              codBlEst: it.blEst,
              codBlCred: it.blCred,
              totalQtd: 0,
              totalQtdAlocada: 0,
              totalValor: 0,
              totalGeral: 0,
              itens: []
            });
          }

          const ped = pedidosMap.get(key);
          ped.totalQtd += it.qtdLib;
          ped.totalQtdAlocada += it.qtdAlocada;
          ped.totalValor += it.valorItem;
          if (it.blCred === '01') ped.codBlCred = '01';

          ped.itens.push({
            item: it.item,
            sequen: it.sequen,
            produto: it.produto,
            descricao: it.descricao,
            qtdLib: it.qtdLib,
            qtdAlocada: it.qtdAlocada,
            saldoFaltante: it.saldoFaltante,
            saldoFisicoTotal: it.saldoFisicoTotal,
            posicaoFila: it.posicaoFila,
            statusItem: it.statusItem,
            statusItemBadge: it.statusItemBadge,
            prcVenda: it.prcVenda,
            valorItem: it.valorItem
          });
        }

        // Consolidar status final de cada pedido
        for (const p of pedidosMap.values()) {
          p.totalValor = Math.round((p.totalValor + Number.EPSILON) * 100) / 100;
          p.totalGeral = Math.round(((p.totalValor + p.freteCobrado) + Number.EPSILON) * 100) / 100;

          const totalItens = p.itens.length;
          const itensTotal = p.itens.filter(i => i.statusItem === 'TOTAL').length;
          const itensParcial = p.itens.filter(i => i.statusItem === 'PARCIAL').length;

          if (itensTotal === totalItens) {
            p.statusLib = 'PRONTO';
            p.statusBadge = 'Ped. Pronto pra Ser Liberado';
            p.statusBadgeClass = 'badge-lib-pronto';
            p.statusIcon = '🟢';
            p.statusDesc = 'Todos os itens possuem saldo em estoque disponível para liberação imediata';
          } else if (itensTotal > 0 || itensParcial > 0) {
            p.statusLib = 'PARCIAL';
            p.statusBadge = 'Lib Parcial';
            p.statusBadgeClass = 'badge-lib-parcial';
            p.statusIcon = '🟡';
            p.statusDesc = 'Parte dos itens possui saldo em estoque disponível para liberação parcial';
          } else {
            p.statusLib = 'AGUARDANDO';
            p.statusBadge = 'Aguardando Estoque';
            p.statusBadgeClass = 'badge-lib-aguardando';
            p.statusIcon = '🔴';
            p.statusDesc = 'Aguardando entrada de estoque/produção';
          }

          p.rotinaProtheus = p.codBlCred === '01' 
            ? 'MATA456 (Liberação Crédito e Estoque)' 
            : 'MATA455 (Liberação de Estoque)';

          if (cleanSearch) {
            const matches = 
              (p.numPed && p.numPed.toLowerCase().includes(cleanSearch)) ||
              (p.codWeb && p.codWeb.toLowerCase().includes(cleanSearch)) ||
              (p.clienteNome && p.clienteNome.toLowerCase().includes(cleanSearch)) ||
              (p.nomeTransp && p.nomeTransp.toLowerCase().includes(cleanSearch)) ||
              (p.vendedorNome && p.vendedorNome.toLowerCase().includes(cleanSearch)) ||
              p.itens.some(i => (i.produto && i.produto.toLowerCase().includes(cleanSearch)) || (i.descricao && i.descricao.toLowerCase().includes(cleanSearch)));
            if (!matches) continue;
          }

          results.push(p);
        }
      }
    } catch (err) {
      console.warn(`Aviso: Erro ao analisar liberação de estoque em ${emp.nome}:`, err.message);
    }
  }

  // Ordenação padrão: Prontos primeiro, depois Parciais, depois Aguardando; secundário Data Lib ASC
  const orderWeight = { 'PRONTO': 1, 'PARCIAL': 2, 'AGUARDANDO': 3 };
  results.sort((a, b) => {
    const wA = orderWeight[a.statusLib] || 99;
    const wB = orderWeight[b.statusLib] || 99;
    if (wA !== wB) return wA - wB;
    return (a.dataLib || a.dataEmissao || '').localeCompare(b.dataLib || b.dataEmissao || '') || (a.numPed || '').localeCompare(b.numPed || '');
  });

  return results;
}

module.exports = {
  consultarProtheusNF,
  buscarProtheusMultiEmpresa,
  buscarPedidosVendedores,
  buscarPedidosAbertosVendedores,
  buscarPedidosCompras,
  buscarPedidosComprasAbertosConsolidado,
  obterDetalhesPedidoCompra,
  buscarPedidosProntosFaturar,
  buscarPedidosBloqueadosEstoque,
  buscarPedidosAnaliseLibEstoque,
  sincronizarSaldosEstoqueProtheus,
  consultarFaturamentoHistorico,
  sincronizarFaturamentoConsolidado,
  getGrupoDescricao,
  GRUPOS_PRODUTOS_MAP,
  formatarDataProtheus,
  calcularStatusBloqueioEstoque,
  calcularStatusBloqueioCredito,
  detectarEnderecoEntregaDiferente,
  obterDetalhesPedido,
  obterHistoricoFinanceiroCliente,
  buscarComissoesPeriodo,
  executeRailwayQuery,
  sanitizeSqlParam,
  TABELAS_EMPRESA,
  VENDEDORES_MAP,
  getNomeVendedor,
  // Exportações do Módulo Financeiro
  EMPRESAS_FINANCEIRO,
  consultarSaldoSE8,
  consultarExtratoSE5,
  algoritmoMatchingConciliacao
};


