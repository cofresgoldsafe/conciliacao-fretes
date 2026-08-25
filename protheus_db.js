const http = require('http');
const https = require('https');

// Configuração da API do Protheus no Railway
const RAILWAY_API_URL = 'https://protheus-api-production.up.railway.app/query';
const RAILWAY_API_KEY = process.env.PROTHEUS_API_KEY || 'ProtheusClaude#2026';

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
        "(C7.C7_RESIDUO IS NULL OR RTRIM(C7.C7_RESIDUO) <> 'S')"
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

          results.push({
            empresa: emp.sigla,
            empresaNome: emp.nome,
            empresaKey: emp.key,
            pedCom: pedCom,
            numPed: pedNum,
            item: row.C7_ITEM || '',
            codProduto: row.C7_PRODUTO || '',
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
      const totalFrete = parseFloat(head.FRETE || 0) + parseFloat(head.FRETE_EMBUTIDO || 0);
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
          condPagto: head.CONDPAG || 'À Vista / Boleto',
          condPagInfo: condPagInfo,
          vendedor: getNomeVendedor(head.VEND1),
          codVendedor: head.VEND1,
          observacoes: head.OBS
        },
        totais: {
          totalProdutos: roundVal(totalProdutos),
          totalFrete: roundVal(totalFrete),
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
    { key: "OACO", sigla: "OACO", codigo: "16", nome: "Empresa 16 (OACO)", se3: "SE3160" },
    { key: "GSI", sigla: "GSI", codigo: "15", nome: "Empresa 15 (GSI)", se3: "SE3150" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14", nome: "Empresa 14 (METAL PLENO)", se3: "SE3140" }
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
          ISNULL(E3.E3_BASE, 0) AS E3_BASE,
          ISNULL(E3.E3_PORC, 0) AS E3_PORC,
          ISNULL(E3.E3_COMIS, 0) AS E3_COMIS
        FROM ${emp.se3} E3
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

          results.push({
            empresa: emp.nome,
            empresaKey: emp.key,
            empresaSigla: emp.sigla,
            codVend: row.E3_VEND,
            nomeVendedor: getNomeVendedor(row.E3_VEND),
            emissao: row.E3_EMISSAO,
            pedido: row.E3_PEDIDO || '-',
            cliente: row.E3_CODCLI || '-',
            valorBase: roundVal(valorBase),
            percComis: roundVal(percComis),
            valorComis: roundVal(valorComis)
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

  return {
    comissoes: results,
    totalGeralBase: roundVal(totalBase),
    totalGeralComissao: roundVal(totalComis),
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

module.exports = {
  consultarProtheusNF,
  buscarProtheusMultiEmpresa,
  buscarPedidosVendedores,
  buscarPedidosAbertosVendedores,
  buscarPedidosCompras,
  formatarDataProtheus,
  calcularStatusBloqueioEstoque,
  calcularStatusBloqueioCredito,
  obterDetalhesPedido,
  obterHistoricoFinanceiroCliente,
  buscarComissoesPeriodo,
  executeRailwayQuery,
  TABELAS_EMPRESA,
  VENDEDORES_MAP,
  getNomeVendedor,
  // Exportações do Módulo Financeiro
  EMPRESAS_FINANCEIRO,
  consultarSaldoSE8,
  consultarExtratoSE5,
  algoritmoMatchingConciliacao
};


