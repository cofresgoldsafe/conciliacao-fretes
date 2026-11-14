/**
 * crm_vendedores.js
 *
 * Cadastro Oficial de Vendedores, Resolução de Escopo RBAC e Meta Mensal do CRM Comercial
 * Plataforma de Apoio GSI (Gemini-Cli — CRM-19 / v8.321)
 *
 * Regras de Negócio:
 * - Fonte de verdade no PostgreSQL: tabela `crm_vendedores`.
 * - Fallback resiliente se o Postgres cair: derivado de `VENDEDORES_MAP` (protheus_db.js) + '000001' (Alexandre).
 * - Meta mensal (`meta_mensal` NUMERIC NULL):
 *     * NULL -> herda `metaBaseVendas` (R$ 120.000,00 padrão) de `getConfigMetasVendasDB()` (postgres_db.js).
 *     * 0    -> sem meta mensal e fora da soma da equipe (Alexandre '000001').
 *     * > 0  -> meta customizada individual.
 * - Sem fallback 250000; percentual é `null` quando a meta é 0; cálculo de realizado usa estritamente `data_fechamento_real`.
 */

const path = require('path');
const { safeQuery, isPostgresConnected, getConfigMetasVendasDB } = require('./postgres_db');
const { VENDEDORES_MAP } = require('./protheus_db');
const { safeReadJson } = require('./safe_json_storage');

const crmCacheFile = path.join(__dirname, 'data', 'crm_deals_cache.json');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// Base estática de fallback derivada de VENDEDORES_MAP (protheus_db.js:507) + Alexandre ('000001')
const FALLBACK_VENDEDORES_DEFAULT = [
  {
    cod_vendedor: '000001',
    codigo: '000001',
    username_portal: 'alexandre',
    nome: 'Alexandre',
    email: null,
    telefone_whatsapp: null,
    assinatura: null,
    meta_mensal: 0,
    herda_historico_de: [],
    ativo: true
  },
  {
    cod_vendedor: '000064',
    codigo: '000064',
    username_portal: 'andrea',
    nome: (VENDEDORES_MAP && VENDEDORES_MAP['000064']) || 'Andrea',
    email: null,
    telefone_whatsapp: null,
    assinatura: null,
    meta_mensal: null,
    herda_historico_de: [],
    ativo: true
  },
  {
    cod_vendedor: '000004',
    codigo: '000004',
    username_portal: 'figueiredo',
    nome: (VENDEDORES_MAP && VENDEDORES_MAP['000004']) || 'Figueiredo',
    email: null,
    telefone_whatsapp: null,
    assinatura: null,
    meta_mensal: null,
    herda_historico_de: [],
    ativo: true
  },
  {
    cod_vendedor: '000074',
    codigo: '000074',
    username_portal: 'juliana',
    nome: (VENDEDORES_MAP && VENDEDORES_MAP['000074']) || 'Juliana',
    email: null,
    telefone_whatsapp: null,
    assinatura: null,
    meta_mensal: null,
    herda_historico_de: [],
    ativo: true
  }
];

let fallbackStore = FALLBACK_VENDEDORES_DEFAULT.map(v => ({ ...v }));
let vendedoresCache = null;
let vendedoresCacheTimestamp = 0;

function mapVendedorRow(row) {
  if (!row) return null;
  const cod = String(row.cod_vendedor || row.codigo || '').trim().padStart(6, '0');
  const rawMeta = row.meta_mensal;
  const metaMensal = (rawMeta === null || rawMeta === undefined || rawMeta === '')
    ? null
    : Number(rawMeta);

  return {
    cod_vendedor: cod,
    codigo: cod,
    username_portal: row.username_portal ? String(row.username_portal).trim().toLowerCase() : null,
    nome: String(row.nome || '').trim(),
    email: row.email || null,
    telefone_whatsapp: row.telefone_whatsapp || null,
    assinatura: row.assinatura || null,
    meta_mensal: Number.isNaN(metaMensal) ? null : metaMensal,
    herda_historico_de: Array.isArray(row.herda_historico_de) ? row.herda_historico_de : [],
    ativo: row.ativo !== false
  };
}

function invalidarCacheVendedores() {
  vendedoresCache = null;
  vendedoresCacheTimestamp = 0;
}

/**
 * Permite alterar temporariamente o estado em memória (para suítes de teste sem Postgres)
 */
function atualizarVendedorEmMemoria(codOuUsername, patch = {}) {
  const chave = String(codOuUsername || '').trim().toLowerCase();
  const chavePad = /^\d+$/.test(chave) ? chave.padStart(6, '0') : null;
  for (let i = 0; i < fallbackStore.length; i++) {
    const item = fallbackStore[i];
    if (
      item.cod_vendedor.toLowerCase() === chave ||
      (chavePad && item.cod_vendedor === chavePad) ||
      (item.username_portal && item.username_portal.toLowerCase() === chave)
    ) {
      fallbackStore[i] = mapVendedorRow({ ...item, ...patch });
      invalidarCacheVendedores();
      return fallbackStore[i];
    }
  }
  return null;
}

function restaurarFallbackPadrao() {
  fallbackStore = FALLBACK_VENDEDORES_DEFAULT.map(v => ({ ...v }));
  invalidarCacheVendedores();
}

/**
 * Garante a criação da tabela crm_vendedores, seed inicial, remoção dos DEFAULT 'alexandre' e RLS
 */
async function ensureCrmVendedoresTable() {
  if (!isPostgresConnected()) return;
  try {
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS crm_vendedores (
        cod_vendedor        VARCHAR(20) PRIMARY KEY,
        username_portal     VARCHAR(100) UNIQUE,
        nome                VARCHAR(100) NOT NULL,
        email               VARCHAR(200),
        telefone_whatsapp   VARCHAR(20),
        assinatura          TEXT,
        meta_mensal         NUMERIC(15, 2) NULL,
        herda_historico_de  VARCHAR(20)[] NOT NULL DEFAULT '{}',
        ativo               BOOLEAN NOT NULL DEFAULT TRUE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by          VARCHAR(100)
      );

      ALTER TABLE IF EXISTS crm_vendedores ALTER COLUMN meta_mensal DROP NOT NULL;
      ALTER TABLE IF EXISTS crm_vendedores ALTER COLUMN meta_mensal DROP DEFAULT;

      INSERT INTO crm_vendedores (cod_vendedor, username_portal, nome, meta_mensal) VALUES
        ('000004', 'figueiredo', 'Figueiredo', NULL),
        ('000064', 'andrea',     'Andrea',     NULL),
        ('000074', 'juliana',    'Juliana',    NULL),
        ('000001', 'alexandre',  'Alexandre',  0)
      ON CONFLICT (cod_vendedor) DO NOTHING;

      ALTER TABLE IF EXISTS crm_deals      ALTER COLUMN created_by DROP DEFAULT;
      ALTER TABLE IF EXISTS crm_deals      ALTER COLUMN updated_by DROP DEFAULT;
      ALTER TABLE IF EXISTS crm_atividades ALTER COLUMN created_by DROP DEFAULT;

      CREATE INDEX IF NOT EXISTS idx_crm_deals_cod_vendedor_ativo
        ON crm_deals (cod_vendedor)
        WHERE ativo = TRUE;

      ALTER TABLE crm_vendedores ENABLE ROW LEVEL SECURITY;
      ALTER TABLE crm_vendedores FORCE ROW LEVEL SECURITY;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          GRANT ALL ON TABLE crm_vendedores TO service_role;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
          GRANT ALL ON TABLE crm_vendedores TO postgres;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON TABLE crm_vendedores FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON TABLE crm_vendedores FROM authenticated;
        END IF;
      END $$;

      DO $$
      BEGIN
        DROP POLICY IF EXISTS "Acesso exclusivo backend crm_vendedores" ON crm_vendedores;
        CREATE POLICY "Acesso exclusivo backend crm_vendedores"
          ON crm_vendedores
          TO service_role, postgres
          USING (true)
          WITH CHECK (true);
      END $$;
    `);
    invalidarCacheVendedores();
  } catch (err) {
    console.warn('⚠️ [CRM Vendedores] Aviso ao inicializar tabela crm_vendedores:', err.message);
  }
}

/**
 * Carrega todos os vendedores (ativos e inativos) com cache de 5 minutos
 */
async function carregarTodosVendedores() {
  const agora = Date.now();
  if (vendedoresCache && (agora - vendedoresCacheTimestamp) < CACHE_TTL_MS) {
    return vendedoresCache;
  }

  if (isPostgresConnected()) {
    try {
      const res = await safeQuery(`
        SELECT cod_vendedor, username_portal, nome, email, telefone_whatsapp,
               assinatura, meta_mensal, herda_historico_de, ativo
          FROM crm_vendedores
         ORDER BY nome ASC;
      `);
      if (res && Array.isArray(res.rows) && res.rows.length > 0) {
        vendedoresCache = res.rows.map(mapVendedorRow).filter(Boolean);
        vendedoresCacheTimestamp = agora;
        return vendedoresCache;
      }
    } catch (err) {
      console.warn('⚠️ [CRM Vendedores] Erro ao ler crm_vendedores no Postgres, usando fallback:', err.message);
    }
  }

  const fallback = fallbackStore
    .map(mapVendedorRow)
    .filter(Boolean)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  vendedoresCache = fallback;
  vendedoresCacheTimestamp = agora;
  return fallback;
}

/**
 * Lista vendedores ordenados por nome
 */
async function listarVendedores({ incluirInativos = false } = {}) {
  const todos = await carregarTodosVendedores();
  const filtrados = incluirInativos ? todos : todos.filter(v => v.ativo !== false);
  return filtrados.map(v => ({ ...v }));
}

/**
 * Busca vendedor pelo username_portal (case-insensitive)
 */
async function obterVendedorPorUsername(username) {
  if (!username) return null;
  const cleanUser = String(username).trim().toLowerCase();
  if (!cleanUser) return null;

  const todos = await carregarTodosVendedores();
  const encontrado = todos.find(v => v.username_portal && v.username_portal.toLowerCase() === cleanUser);
  return encontrado ? { ...encontrado } : null;
}

/**
 * Busca vendedor pelo código Protheus (aceita '74' ou '000074')
 */
async function obterVendedorPorCodigo(cod) {
  if (cod === null || cod === undefined) return null;
  const raw = String(cod).trim();
  if (!raw) return null;
  const cleanCod = /^\d+$/.test(raw) ? raw.padStart(6, '0') : raw;

  const todos = await carregarTodosVendedores();
  const encontrado = todos.find(v => v.cod_vendedor === cleanCod);
  return encontrado ? { ...encontrado } : null;
}

/**
 * Resolve código de 6 dígitos a partir de código ('000074', '74') OU nome ('Juliana')
 * Retorna '000074' (somente se existir e estiver ativo) ou null.
 */
async function resolverCodigoVendedor(valor) {
  if (valor === null || valor === undefined) return null;
  const raw = String(valor).trim();
  if (!raw) return null;

  const ativos = await listarVendedores({ incluirInativos: false });

  // 1. Tentativa por código numérico
  if (/^\d+$/.test(raw)) {
    const padded = raw.padStart(6, '0');
    const porCod = ativos.find(v => v.cod_vendedor === padded);
    if (porCod) return porCod.cod_vendedor;
  }

  // 2. Tentativa por nome ou username_portal (case-insensitive)
  const lower = raw.toLowerCase();
  const porNome = ativos.find(
    v => v.nome.toLowerCase() === lower || (v.username_portal && v.username_portal.toLowerCase() === lower)
  );
  if (porNome) return porNome.cod_vendedor;

  return null;
}

/**
 * Retorna o intervalo [inicioIso, fimIso, mesRef] do mês solicitado no fuso America/Sao_Paulo (-03:00)
 */
function resolverIntervaloMes(mesParam) {
  let ano;
  let mesNum;
  const match = String(mesParam || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (match) {
    ano = parseInt(match[1], 10);
    mesNum = parseInt(match[2], 10);
  } else {
    const agoraBr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit'
    }).format(new Date());
    const parts = agoraBr.split('-');
    ano = parseInt(parts[0], 10);
    mesNum = parseInt(parts[1], 10);
  }

  if (!ano || !mesNum || mesNum < 1 || mesNum > 12) {
    const now = new Date();
    ano = now.getFullYear();
    mesNum = now.getMonth() + 1;
  }

  const mesStr = String(mesNum).padStart(2, '0');
  const proxAno = mesNum === 12 ? ano + 1 : ano;
  const proxMesStr = String(mesNum === 12 ? 1 : mesNum + 1).padStart(2, '0');

  return {
    mes: `${ano}-${mesStr}`,
    inicioIso: `${ano}-${mesStr}-01T00:00:00.000-03:00`,
    fimIso: `${proxAno}-${proxMesStr}-01T00:00:00.000-03:00`
  };
}

/**
 * Calcula a meta mensal e o realizado no mês usando metaBaseVendas de getConfigMetasVendasDB()
 * e filtrando negócios ganhos estritamente por data_fechamento_real.
 */
async function obterMetaMensal({ mes, scope = { all: true } } = {}) {
  const { mes: mesRef, inicioIso, fimIso } = resolverIntervaloMes(mes);
  const dtInicio = new Date(inicioIso).getTime();
  const dtFim = new Date(fimIso).getTime();

  let metaBaseVendas = 120000;
  try {
    const cfg = await getConfigMetasVendasDB();
    if (cfg && Number(cfg.metaBaseVendas) > 0) {
      metaBaseVendas = Number(cfg.metaBaseVendas);
    }
  } catch (_) {}

  const filtroCodigos = (scope && !scope.all)
    ? [scope.codVendedor].filter(Boolean)
    : null;

  let rows = null;

  if (isPostgresConnected()) {
    try {
      const res = await safeQuery(`
        SELECT v.cod_vendedor, v.nome, v.meta_mensal,
               COALESCE(SUM(d.valor_total), 0) AS realizado,
               COUNT(d.id) AS qtd_ganhos
          FROM crm_vendedores v
          LEFT JOIN crm_deals d
            ON d.cod_vendedor = v.cod_vendedor
           AND d.ativo = TRUE
           AND d.estagio = 'ganho'
           AND d.data_fechamento_real >= $1
           AND d.data_fechamento_real <  $2
         WHERE v.ativo = TRUE
           AND ($3::varchar[] IS NULL OR v.cod_vendedor = ANY($3))
         GROUP BY 1, 2, 3
         ORDER BY v.nome ASC;
      `, [inicioIso, fimIso, filtroCodigos]);

      if (res && Array.isArray(res.rows)) {
        rows = res.rows;
      }
    } catch (err) {
      console.warn('⚠️ [CRM Meta] Erro ao consultar meta no Postgres, usando fallback local:', err.message);
    }
  }

  // Fallback em memória / JSON local quando Postgres está desligado
  if (!rows) {
    const ativos = await listarVendedores({ incluirInativos: false });
    const vendedoresAlvo = filtroCodigos
      ? ativos.filter(v => filtroCodigos.includes(v.cod_vendedor))
      : ativos;

    let dealsLocais = [];
    try {
      const cache = await safeReadJson(crmCacheFile, null);
      if (cache && Array.isArray(cache.deals)) {
        dealsLocais = cache.deals;
      }
    } catch (_) {}

    rows = vendedoresAlvo.map(v => {
      const ganhosMes = dealsLocais.filter(d => {
        if (!d || d.ativo === false) return false;
        if (String(d.cod_vendedor || '').trim() !== v.cod_vendedor) return false;
        if (String(d.estagio || '').trim().toLowerCase() !== 'ganho') return false;
        if (!d.data_fechamento_real) return false; // Estritamente data_fechamento_real (sem fallback updated_at)
        const ts = new Date(d.data_fechamento_real).getTime();
        return !Number.isNaN(ts) && ts >= dtInicio && ts < dtFim;
      });

      const realizado = ganhosMes.reduce((acc, d) => acc + (parseFloat(d.valor_total) || 0), 0);
      return {
        cod_vendedor: v.cod_vendedor,
        nome: v.nome,
        meta_mensal: v.meta_mensal,
        realizado,
        qtd_ganhos: ganhosMes.length
      };
    });
  }

  const todosMapeados = rows.map(r => {
    const rawMeta = r.meta_mensal;
    const metaEfetiva = (rawMeta === null || rawMeta === undefined || rawMeta === '')
      ? metaBaseVendas
      : Number(rawMeta);
    const metaFinal = Number.isNaN(metaEfetiva) ? metaBaseVendas : metaEfetiva;
    const realizado = parseFloat(r.realizado) || 0;
    const qtdGanhos = parseInt(r.qtd_ganhos, 10) || 0;
    const percentual = metaFinal > 0 ? Number(((realizado / metaFinal) * 100).toFixed(2)) : null;

    return {
      cod_vendedor: String(r.cod_vendedor).trim(),
      codigo: String(r.cod_vendedor).trim(),
      nome: r.nome,
      meta_mensal: metaFinal,
      realizado,
      qtd_ganhos: qtdGanhos,
      percentual
    };
  });

  // Na visão global (admin), vendedor com meta zero (Alexandre) fica fora da lista por vendedor e fora da soma
  const vendedoresFinal = (scope && !scope.all)
    ? todosMapeados
    : todosMapeados.filter(v => v.meta_mensal > 0);

  const metaTotal = vendedoresFinal.reduce((acc, v) => acc + (v.meta_mensal || 0), 0);
  const realizadoTotal = vendedoresFinal.reduce((acc, v) => acc + (v.realizado || 0), 0);
  const qtdGanhosTotal = vendedoresFinal.reduce((acc, v) => acc + (v.qtd_ganhos || 0), 0);
  const percentualTotal = metaTotal > 0 ? Number(((realizadoTotal / metaTotal) * 100).toFixed(2)) : null;

  return {
    mes: mesRef,
    meta_base_vendas: metaBaseVendas,
    meta_mensal: metaTotal,
    realizado: realizadoTotal,
    qtd_ganhos: qtdGanhosTotal,
    percentual: percentualTotal,
    vendedores: vendedoresFinal
  };
}

module.exports = {
  ensureCrmVendedoresTable,
  listarVendedores,
  obterVendedorPorUsername,
  obterVendedorPorCodigo,
  resolverCodigoVendedor,
  obterMetaMensal,
  invalidarCacheVendedores,
  atualizarVendedorEmMemoria,
  restaurarFallbackPadrao
};
