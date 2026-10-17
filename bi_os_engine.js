/**
 * bi_os_engine.js
 * Módulo Dedicado de BI Executivo — Ordens de Serviço (OS)
 * Plataforma de Apoio GSI (Gemini-Cli)
 *
 * Responsabilidades:
 * 1. Extração Protheus (SE1150) de títulos quitados com "OS" no número ou prefixo (janela móvel de 24 meses).
 * 2. Extração Supabase Assistência (ordens_servico) via PostgREST em ranges paralelos (janela móvel de 20 meses).
 * 3. Deduplicação canônica (exclusão de OS fantasmas 1485..1501 e resolução por updated_at/created_at).
 * 4. Classificação canônica entre 'Garantia' e 'OS Padrão'.
 * 5. Cache em memória (TTL 10 min) e persistência local segura em data/bi_os_cache.json.
 * 6. Paginação padronizada (Pilar 1) para drilldown analítico de títulos SE1150.
 */

'use strict';

const path = require('path');
const { executeRailwayQuery } = require('./protheus_db');
const { safeReadJson, safeWriteJson } = require('./safe_json_storage');

const readJsonSafe = safeReadJson;
const writeJsonSafe = safeWriteJson;

const CACHE_FILE = path.join(__dirname, 'data', 'bi_os_cache.json');
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

const ASSISTENCIA_SUPABASE_URL =
  process.env.ASSISTENCIA_SUPABASE_URL || 'https://huhwzrvxkzffzxfqtzob.supabase.co';
const ASSISTENCIA_SUPABASE_KEY =
  process.env.ASSISTENCIA_SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1aHd6cnZ4a3pmZnp4ZnF0em9iIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE1NDg0OSwiZXhwIjoyMTAyNzMwODQ5fQ.NsfkNdD_v_QxUFtpH-Cuzd9eg8aUV7Fx_da1gRoyH8I';

const MESES_ABREV = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

let memoryCache = null;
let memoryCacheTimestamp = 0;

function round2(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Converte data Protheus YYYYMMDD em objeto com mesAno (YYYY-MM) e dataIso (YYYY-MM-DD)
 */
function parseProtheusYmd(ymd) {
  const clean = String(ymd || '').replace(/\D/g, '');
  if (clean.length !== 8) {
    return { mesAno: '', dataIso: '' };
  }
  const yyyy = clean.slice(0, 4);
  const mm = clean.slice(4, 6);
  const dd = clean.slice(6, 8);
  return {
    mesAno: `${yyyy}-${mm}`,
    dataIso: `${yyyy}-${mm}-${dd}`
  };
}

/**
 * Extrai YYYY-MM de uma string de data ISO ou YYYY-MM-DD
 */
function extractMesAnoFromIso(dateVal) {
  if (!dateVal) return '';
  const str = String(dateVal).trim();
  const matchIso = str.match(/^(\d{4})-(\d{2})/);
  if (matchIso) {
    return `${matchIso[1]}-${matchIso[2]}`;
  }
  const matchBr = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (matchBr) {
    return `${matchBr[3]}-${matchBr[2]}`;
  }
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  }
  return '';
}

/**
 * Gera janela contínua de N meses encerrando no mês de refDate em ordem cronológica
 * Ex: [{ mesAno: '2024-11', label: 'Nov/24' }, ...]
 */
function buildMonthWindow(monthsCount, refDate = new Date()) {
  const count = Math.max(parseInt(monthsCount, 10) || 1, 1);
  const baseDate = refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : new Date();
  const endYear = baseDate.getFullYear();
  const endMonth = baseDate.getMonth(); // 0..11

  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(endYear, endMonth - i, 1);
    const yyyy = d.getFullYear();
    const mmIndex = d.getMonth();
    const mm = String(mmIndex + 1).padStart(2, '0');
    const yy = String(yyyy).slice(-2);
    buckets.push({
      mesAno: `${yyyy}-${mm}`,
      label: `${MESES_ABREV[mmIndex]}/${yy}`
    });
  }
  return buckets;
}

/**
 * Normaliza um registro bruto vindo da SE1150
 */
function normalizeTituloSe1(row) {
  const filial = String(row.filial ?? row.E1_FILIAL ?? '').trim();
  const prefixo = String(row.prefixo ?? row.E1_PREFIXO ?? '').trim();
  const numero = String(row.numero ?? row.E1_NUM ?? '').trim();
  const parcela = String(row.parcela ?? row.E1_PARCELA ?? '').trim();
  const tipo = String(row.tipo ?? row.E1_TIPO ?? '').trim();
  const cliente_cod = String(row.cliente_cod ?? row.E1_CLIENTE ?? '').trim();
  const cliente_nome = String(row.cliente_nome ?? row.E1_NOMCLI ?? '').trim();
  const emissao = String(row.emissao ?? row.E1_EMISSAO ?? '').trim();
  const baixa = String(row.baixa ?? row.E1_BAIXA ?? '').trim();
  const historico = String(row.historico ?? row.E1_HIST ?? '').trim();

  const valorOriginalRaw = Number(row.valor_original ?? row.E1_VALOR ?? 0) || 0;
  const valorPagoRaw =
    row.valor_pago !== undefined && row.valor_pago !== null
      ? Number(row.valor_pago) || 0
      : Number(row.E1_VALLIQ) > 0
        ? Number(row.E1_VALLIQ)
        : valorOriginalRaw;

  const parsedEmissao = parseProtheusYmd(emissao);
  const parsedBaixa = parseProtheusYmd(baixa);

  return {
    filial,
    prefixo,
    numero,
    parcela,
    tipo,
    cliente_cod,
    cliente_nome,
    emissao,
    baixa,
    mesAnoEmissao: row.mesAnoEmissao || parsedEmissao.mesAno,
    dataEmissaoIso: row.dataEmissaoIso || parsedEmissao.dataIso,
    mesAnoBaixa: row.mesAnoBaixa || parsedBaixa.mesAno,
    dataBaixaIso: row.dataBaixaIso || parsedBaixa.dataIso,
    valor_original: round2(valorOriginalRaw),
    valor_pago: round2(valorPagoRaw > 0 ? valorPagoRaw : valorOriginalRaw),
    historico
  };
}

/**
 * Agrega os títulos da SE1150 na janela contínua de 24 meses segundo o regime ('baixa' ou 'emissao')
 */
function aggregateProtheus24m(rawTitulos = [], regime = 'baixa', refDate = new Date()) {
  const reg = String(regime || 'baixa').trim().toLowerCase() === 'emissao' ? 'emissao' : 'baixa';
  const window24 = buildMonthWindow(24, refDate);
  const bucketMap = new Map();

  for (const w of window24) {
    bucketMap.set(w.mesAno, {
      mesAno: w.mesAno,
      label: w.label,
      valorTotal: 0,
      qtdTitulos: 0,
      ticketMedio: 0
    });
  }

  const titulosNormalizados = (Array.isArray(rawTitulos) ? rawTitulos : []).map(normalizeTituloSe1);

  for (const t of titulosNormalizados) {
    const targetMesAno = reg === 'emissao' ? t.mesAnoEmissao : t.mesAnoBaixa;
    if (!targetMesAno || !bucketMap.has(targetMesAno)) continue;
    const b = bucketMap.get(targetMesAno);
    b.valorTotal = round2(b.valorTotal + t.valor_pago);
    b.qtdTitulos += 1;
  }

  let receitaTotal24m = 0;
  let qtdTitulos24m = 0;
  let melhorMesReceita = {
    mesAno: window24[0]?.mesAno || '',
    label: window24[0]?.label || '',
    valor: 0
  };

  const faturamento24m = window24.map((w) => {
    const b = bucketMap.get(w.mesAno);
    b.valorTotal = round2(b.valorTotal);
    b.ticketMedio = b.qtdTitulos > 0 ? round2(b.valorTotal / b.qtdTitulos) : 0;

    receitaTotal24m = round2(receitaTotal24m + b.valorTotal);
    qtdTitulos24m += b.qtdTitulos;

    if (b.valorTotal >= melhorMesReceita.valor) {
      melhorMesReceita = {
        mesAno: b.mesAno,
        label: b.label,
        valor: b.valorTotal
      };
    }
    return b;
  });

  const mediaMensalReceita24m = round2(receitaTotal24m / 24);
  const ultimoMes = faturamento24m[faturamento24m.length - 1] || { valorTotal: 0 };
  const penultimoMes = faturamento24m[faturamento24m.length - 2] || { valorTotal: 0 };

  const receitaMesAtual = round2(ultimoMes.valorTotal);
  const receitaMesAnterior = round2(penultimoMes.valorTotal);
  const variacaoMesPct =
    receitaMesAnterior > 0
      ? round2(((receitaMesAtual - receitaMesAnterior) / receitaMesAnterior) * 100)
      : receitaMesAtual > 0
        ? 100
        : 0;

  return {
    regime: reg,
    faturamento24m,
    titulosNormalizados,
    kpisReceita: {
      receitaTotal24m,
      qtdTitulos24m,
      mediaMensalReceita24m,
      receitaMesAtual,
      receitaMesAnterior,
      variacaoMesPct,
      melhorMesReceita
    }
  };
}

/**
 * Aplica deduplicação e classificação canônica das OS da Assistência:
 * - Exclui OS fantasmas (1485 <= numero_os <= 1501)
 * - Deduplica por Number(os.numero_os) mantendo o registro com updated_at || created_at mais recente
 * - Classifica 'Garantia' vs 'OS Padrão'
 */
function classifyAndDeduplicateOs(rawOsList = []) {
  const dedupMap = new Map();

  for (const item of Array.isArray(rawOsList) ? rawOsList : []) {
    if (!item) continue;
    const num = Number(item.numero_os);
    if (!Number.isFinite(num) || num <= 0) continue;

    // Exclusão canônica de OS fantasmas
    if (num >= 1485 && num <= 1501) continue;

    const candidateTsStr = item.updated_at || item.created_at || '';
    const candidateTime = candidateTsStr ? new Date(candidateTsStr).getTime() || 0 : 0;

    if (!dedupMap.has(num)) {
      dedupMap.set(num, { item, time: candidateTime });
    } else {
      const existing = dedupMap.get(num);
      if (candidateTime >= existing.time) {
        dedupMap.set(num, { item, time: candidateTime });
      }
    }
  }

  const result = [];
  for (const [num, entry] of dedupMap.entries()) {
    const os = entry.item;
    const isGarantia =
      String(os.tipo_os || '').trim().toLowerCase() === 'garantia' ||
      String(os.status_pagamento || '').trim().toLowerCase() === 'isento';
    const tipoCanonico = isGarantia ? 'Garantia' : 'OS Padrão';
    const dataBase = os.data_entrada || os.created_at || '';
    const mesAno = extractMesAnoFromIso(dataBase);

    result.push({
      id: os.id,
      numero_os: num,
      tipo_os: os.tipo_os || null,
      status: os.status || null,
      status_pagamento: os.status_pagamento || null,
      valor_total: Number(os.valor_total) || 0,
      data_entrada: os.data_entrada || null,
      created_at: os.created_at || null,
      updated_at: os.updated_at || null,
      isGarantia,
      tipoCanonico,
      mesAno
    });
  }

  result.sort((a, b) => b.numero_os - a.numero_os);
  return result;
}

/**
 * Agrega as OS da Assistência na janela contínua de 20 meses
 */
function aggregateSupabase20m(rawOsList = [], refDate = new Date()) {
  const deduplicated = classifyAndDeduplicateOs(rawOsList);
  const window20 = buildMonthWindow(20, refDate);
  const bucketMap = new Map();

  for (const w of window20) {
    bucketMap.set(w.mesAno, {
      mesAno: w.mesAno,
      label: w.label,
      padrao: 0,
      garantia: 0,
      total: 0
    });
  }

  for (const os of deduplicated) {
    if (!os.mesAno || !bucketMap.has(os.mesAno)) continue;
    const b = bucketMap.get(os.mesAno);
    if (os.isGarantia) {
      b.garantia += 1;
    } else {
      b.padrao += 1;
    }
    b.total += 1;
  }

  let totalOs20m = 0;
  let totalPadrao20m = 0;
  let totalGarantia20m = 0;

  const osCriadas20m = window20.map((w) => {
    const b = bucketMap.get(w.mesAno);
    totalOs20m += b.total;
    totalPadrao20m += b.padrao;
    totalGarantia20m += b.garantia;
    return b;
  });

  const taxaGarantiaPct = totalOs20m > 0 ? round2((totalGarantia20m / totalOs20m) * 100) : 0;
  const mediaMensalOs20m = round2(totalOs20m / 20);

  return {
    osCriadas20m,
    deduplicatedOs: deduplicated,
    kpisOs: {
      totalOs20m,
      totalPadrao20m,
      totalGarantia20m,
      taxaGarantiaPct,
      mediaMensalOs20m
    }
  };
}

/**
 * Consulta ao vivo o Protheus SE1150 para títulos baixados com "OS" no número ou prefixo
 */
async function fetchProtheusSe1150Os() {
  const sql = `
    SELECT
      LTRIM(RTRIM(ISNULL(E1_FILIAL, ''))) AS filial,
      LTRIM(RTRIM(ISNULL(E1_PREFIXO, ''))) AS prefixo,
      LTRIM(RTRIM(ISNULL(E1_NUM, ''))) AS numero,
      LTRIM(RTRIM(ISNULL(E1_PARCELA, ''))) AS parcela,
      LTRIM(RTRIM(ISNULL(E1_TIPO, ''))) AS tipo,
      LTRIM(RTRIM(ISNULL(E1_CLIENTE, ''))) AS cliente_cod,
      LTRIM(RTRIM(ISNULL(E1_NOMCLI, ''))) AS cliente_nome,
      LTRIM(RTRIM(ISNULL(E1_EMISSAO, ''))) AS emissao,
      LTRIM(RTRIM(ISNULL(E1_BAIXA, ''))) AS baixa,
      CAST(ISNULL(E1_VALOR, 0) AS FLOAT) AS valor_original,
      CAST(CASE WHEN ISNULL(E1_VALLIQ, 0) > 0 THEN E1_VALLIQ ELSE ISNULL(E1_VALOR, 0) END AS FLOAT) AS valor_pago,
      LTRIM(RTRIM(ISNULL(E1_HIST, ''))) AS historico
    FROM SE1150 WITH (NOLOCK)
    WHERE D_E_L_E_T_ = ' '
      AND E1_SALDO = 0
      AND LTRIM(RTRIM(ISNULL(E1_BAIXA, ''))) <> ''
      AND LTRIM(RTRIM(ISNULL(E1_BAIXA, ''))) <> '0'
      AND (UPPER(E1_NUM) LIKE '%OS%' OR UPPER(E1_PREFIXO) LIKE '%OS%')
    ORDER BY E1_BAIXA DESC, E1_NUM DESC
  `;

  const response = await executeRailwayQuery(sql);
  const rows = response?.rows || response?.recordset || response?.data || (Array.isArray(response) ? response : []);
  return rows.map(normalizeTituloSe1);
}

/**
 * Consulta ao vivo o Supabase Assistência (ordens_servico) em ranges paralelos com timeout de 12s
 */
async function fetchSupabaseAssistenciaOs() {
  const endpoint = `${ASSISTENCIA_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/ordens_servico?select=id,numero_os,tipo_os,status,status_pagamento,valor_total,data_entrada,created_at,updated_at&order=numero_os.desc`;
  const ranges = ['0-999', '1000-2499', '2500-3999'];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const requests = ranges.map(async (rangeStr) => {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          apikey: ASSISTENCIA_SUPABASE_KEY,
          Authorization: `Bearer ${ASSISTENCIA_SUPABASE_KEY}`,
          'Range-Unit': 'items',
          Range: rangeStr,
          Accept: 'application/json'
        },
        signal: controller.signal
      });

      if (res.status === 416) {
        // Range Not Satisfiable (sem mais registros nessa faixa)
        return [];
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Supabase Assistência HTTP ${res.status}: ${errBody.slice(0, 180)}`);
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    });

    const pages = await Promise.all(requests);
    return pages.flat();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Carrega ou sincroniza os dados brutos (com fallback para cache em disco se alguma fonte falhar)
 */
async function ensureDatasetLoaded({ forceSync = false } = {}) {
  const now = Date.now();

  if (!forceSync && memoryCache && (now - memoryCacheTimestamp < CACHE_TTL_MS)) {
    return {
      dataset: memoryCache,
      fromCache: true,
      protheusWarning: null,
      supabaseWarning: null
    };
  }

  const diskCache = await readJsonSafe(CACHE_FILE, null);

  if (!forceSync && diskCache && diskCache.lastSyncAt) {
    const diskAge = now - new Date(diskCache.lastSyncAt).getTime();
    if (Number.isFinite(diskAge) && diskAge >= 0 && diskAge < CACHE_TTL_MS) {
      memoryCache = diskCache;
      memoryCacheTimestamp = now;
      return {
        dataset: diskCache,
        fromCache: true,
        protheusWarning: null,
        supabaseWarning: null
      };
    }
  }

  let protheusWarning = null;
  let supabaseWarning = null;
  let titulosSe1 = [];
  let ordensServico = [];

  const [protheusResult, supabaseResult] = await Promise.allSettled([
    fetchProtheusSe1150Os(),
    fetchSupabaseAssistenciaOs()
  ]);

  if (protheusResult.status === 'fulfilled') {
    titulosSe1 = protheusResult.value;
  } else {
    protheusWarning = `Falha ao consultar SE1150 no Protheus (${protheusResult.reason?.message || 'Erro de rede'}). Exibindo último snapshot em cache.`;
    titulosSe1 = Array.isArray(diskCache?.titulosSe1) ? diskCache.titulosSe1 : [];
  }

  if (supabaseResult.status === 'fulfilled') {
    ordensServico = classifyAndDeduplicateOs(supabaseResult.value);
  } else {
    supabaseWarning = `Falha ao consultar ordens_servico no Supabase Assistência (${supabaseResult.reason?.message || 'Erro de rede'}). Exibindo último snapshot em cache.`;
    ordensServico = Array.isArray(diskCache?.ordensServico)
      ? classifyAndDeduplicateOs(diskCache.ordensServico)
      : [];
  }

  const freshDataset = {
    lastSyncAt: new Date().toISOString(),
    titulosSe1,
    ordensServico
  };

  memoryCache = freshDataset;
  memoryCacheTimestamp = Date.now();

  try {
    await writeJsonSafe(CACHE_FILE, freshDataset);
  } catch (err) {
    console.warn('[BI OS] Aviso ao gravar cache em disco:', err.message);
  }

  return {
    dataset: freshDataset,
    fromCache: false,
    protheusWarning,
    supabaseWarning
  };
}

/**
 * Retorna o payload consolidado do Dashboard de BI OS (KPIs + série 24m + série 20m)
 */
async function getDashboardData({ regime = 'baixa', forceSync = false, refDate = new Date() } = {}) {
  const reg = String(regime || 'baixa').trim().toLowerCase() === 'emissao' ? 'emissao' : 'baixa';
  const { dataset, fromCache, protheusWarning, supabaseWarning } = await ensureDatasetLoaded({ forceSync });

  const protheusAgg = aggregateProtheus24m(dataset.titulosSe1 || [], reg, refDate);
  const supabaseAgg = aggregateSupabase20m(dataset.ordensServico || [], refDate);

  return {
    success: true,
    lastSyncAt: dataset.lastSyncAt || new Date().toISOString(),
    fromCache,
    protheusWarning,
    supabaseWarning,
    regime: reg,
    kpis: {
      ...protheusAgg.kpisReceita,
      ...supabaseAgg.kpisOs
    },
    faturamento24m: protheusAgg.faturamento24m,
    osCriadas20m: supabaseAgg.osCriadas20m
  };
}

/**
 * Retorna a listagem paginada de títulos quitados SE1150 (Pilar 1 - Envelope REST)
 */
async function getTitulosPaginados({
  regime = 'baixa',
  mesAno = '',
  search = '',
  page = 1,
  limit = 50,
  refDate = new Date()
} = {}) {
  const reg = String(regime || 'baixa').trim().toLowerCase() === 'emissao' ? 'emissao' : 'baixa';
  const { dataset } = await ensureDatasetLoaded({ forceSync: false });
  const allTitulos = (dataset.titulosSe1 || []).map(normalizeTituloSe1);

  const window24 = buildMonthWindow(24, refDate);
  const validMonths = new Set(window24.map((w) => w.mesAno));

  const cleanMesAno = String(mesAno || '').trim();
  const filterSpecificMonth = cleanMesAno && cleanMesAno.toUpperCase() !== 'TODOS';
  const cleanSearch = String(search || '').trim().toLowerCase();

  const filtered = allTitulos.filter((t) => {
    const targetMonth = reg === 'emissao' ? t.mesAnoEmissao : t.mesAnoBaixa;
    if (filterSpecificMonth) {
      if (targetMonth !== cleanMesAno) return false;
    } else if (!validMonths.has(targetMonth)) {
      return false;
    }

    if (cleanSearch) {
      const haystack = [
        t.numero,
        t.prefixo,
        t.cliente_nome,
        t.cliente_cod,
        t.historico
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(cleanSearch)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    const dateA = reg === 'emissao' ? a.emissao : a.baixa;
    const dateB = reg === 'emissao' ? b.emissao : b.baixa;
    if (dateA !== dateB) {
      return String(dateB).localeCompare(String(dateA));
    }
    return String(b.numero).localeCompare(String(a.numero));
  });

  let totalValor = 0;
  for (const item of filtered) {
    totalValor = round2(totalValor + item.valor_pago);
  }

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const total = filtered.length;
  const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
  const hasNext = safePage < totalPages;

  const startIdx = (safePage - 1) * safeLimit;
  const items = filtered.slice(startIdx, startIdx + safeLimit);

  return {
    success: true,
    regime: reg,
    items,
    resumo: {
      totalValor,
      totalTitulos: total
    },
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      hasNext
    }
  };
}

module.exports = {
  getDashboardData,
  getTitulosPaginados,
  buildMonthWindow,
  classifyAndDeduplicateOs,
  aggregateProtheus24m,
  aggregateSupabase20m
};
