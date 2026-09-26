/**
 * crm_engine.js
 * 
 * Motor de Negócios e Persistência do CRM Comercial Nativo (Pipelines, Negócios e Atividades)
 * Plataforma de Apoio GSI (Gemini-Cli)
 * 
 * Funcionalidades:
 * - Operações ACID de Deals e Atividades com suporte nativo a Supabase Postgres.
 * - Suporte a SA1010 (Protheus ERP) com busca em tempo real e autocomplete resiliente.
 * - Fallback de contingência atômico via safe_json_storage.js em data/crm_deals_cache.json.
 * - Telemetria e auditoria perene através de logUserActivity em postgres_db.js.
 */

const path = require('path');
const { safeQuery, logUserActivity, isPostgresConnected } = require('./postgres_db');
const protheusDb = require('./protheus_db');
const { sanitizeSqlParam, getNomeVendedor } = protheusDb;
const { safeReadJson, safeReadJsonSync, safeWriteJson } = require('./safe_json_storage');
const { calcularScoreDeal } = require('./crm_scoring_engine');

const dataDir = path.join(__dirname, 'data');
const crmCacheFile = path.join(dataDir, 'crm_deals_cache.json');
const crmClientesCacheFile = path.join(dataDir, 'crm_clientes_cache.json');
const crmProdutosCacheFile = path.join(dataDir, 'crm_produtos_cache.json');
const crmTransportadorasCacheFile = path.join(dataDir, 'crm_transportadoras_cache.json');
const crmRaizesCacheFile = path.join(dataDir, 'crm_clientes_raiz_cnpj_cache.json');
const analiseCreditoHistoryFile = path.join(dataDir, 'analise_credito_history.json');

// Estágios Canônicos Oficiais
const CANONICAL_STAGES = ['lead', 'contato', 'proposta', 'negociacao', 'ganho', 'perdido'];

/**
 * Normaliza e formata CNPJ (14 dígitos) ou CPF (11 dígitos)
 */
function formatarCgc(cgc) {
  if (!cgc) return '';
  const digits = String(cgc).replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return String(cgc).trim();
}

/**
 * Normaliza e formata telefones brasileiros
 */
function formatarTelefone(tel) {
  if (!tel) return '';
  const digits = String(tel).replace(/\D/g, '');
  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }
  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  return String(tel).trim();
}

/**
 * Normaliza URL de site corporativo aceitando com ou sem www e removendo http:// ou https://
 */
function normalizarSiteUrl(url) {
  if (!url) return '';
  let str = String(url).trim();
  str = str.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return str;
}

/**
 * Lê cache local de contingência do CRM
 */
async function readCache() {
  try {
    const data = await safeReadJson(crmCacheFile, null);
    if (data && typeof data === 'object' && Array.isArray(data.deals)) {
      return {
        updated_at: data.updated_at || new Date().toISOString(),
        next_deal_seq: parseInt(data.next_deal_seq, 10) || null,
        deals: data.deals || [],
        atividades: Array.isArray(data.atividades) ? data.atividades : []
      };
    }
  } catch (err) {
    console.warn('⚠️ [CRM Cache] Aviso ao ler cache local:', err.message);
  }
  return {
    updated_at: new Date().toISOString(),
    next_deal_seq: null,
    deals: [],
    atividades: []
  };
}

/**
 * Grava cache local de contingência de forma atômica
 */
async function writeCache(data) {
  try {
    const payload = {
      updated_at: new Date().toISOString(),
      next_deal_seq: parseInt(data.next_deal_seq, 10) || undefined,
      deals: Array.isArray(data.deals) ? data.deals : [],
      atividades: Array.isArray(data.atividades) ? data.atividades : []
    };
    await safeWriteJson(crmCacheFile, payload);
  } catch (err) {
    console.error('❌ [CRM Cache] Erro ao gravar cache local:', err.message);
  }
}

// ============================================================================
// INTELIGÊNCIA COMERCIAL: FIDELIDADE POR RAIZ DE CNPJ (GRUPO GSI)
// ============================================================================
let _raizesCache = null;
let _raizesCacheLoadedAt = 0;

/**
 * Carrega e memoriza o cache de raízes de CNPJ das 7 empresas
 */
async function obterCacheRaizes() {
  const now = Date.now();
  if (_raizesCache && (now - _raizesCacheLoadedAt) < 60000) {
    return _raizesCache;
  }
  try {
    const raw = await safeReadJson(crmRaizesCacheFile, null);
    if (raw && raw.raizes) {
      _raizesCache = raw.raizes;
      _raizesCacheLoadedAt = now;
      return _raizesCache;
    }
  } catch (err) {
    console.warn('⚠️ [CRM Raizes] Falha ao carregar cache de raízes de CNPJ:', err.message);
  }
  return _raizesCache || {};
}

/**
 * Extrai os 8 primeiros dígitos da raiz do CNPJ (ou 9 do CPF)
 */
function extrairRaizCnpj(cgc) {
  if (!cgc) return null;
  const digits = String(cgc).replace(/\D/g, '');
  if (digits.length >= 8) {
    return digits.slice(0, 8);
  }
  return null;
}

/**
 * Formata o objeto unificado de fidelidade para consumo no frontend
 */
function formatarObjetoFidelidade(item) {
  if (!item) return null;
  const total = parseInt(item.total_compras, 10) || 0;
  if (total <= 0) return null;

  const isVip = total >= 6;
  const icone = isVip ? '💎' : '⭐';
  const tipo = isVip ? 'diamante' : 'estrela';
  const label = `${icone} ${total}`;
  const tooltip = isVip 
    ? `Cliente Diamante VIP: ${total} compras faturadas no Grupo GSI`
    : `Cliente Fidelidade: ${total} ${total === 1 ? 'compra faturada' : 'compras faturadas'} no Grupo GSI`;

  return {
    raiz_cnpj: item.raiz_cnpj,
    total_compras: total,
    valor_total: parseFloat(item.valor_total) || 0,
    primeira_compra: item.primeira_compra || null,
    ultima_compra: item.ultima_compra || null,
    empresas: Array.isArray(item.empresas) ? item.empresas : [],
    tipo,
    icone,
    label,
    tooltip
  };
}

/**
 * Consulta síncrona ultra-rápida O(1) na memória (ideal para loops de listagem)
 */
function obterFidelidadeRaizSync(cgc) {
  const raiz = extrairRaizCnpj(cgc);
  if (!raiz) return null;
  if (!_raizesCache) {
    try {
      const raw = safeReadJsonSync(crmRaizesCacheFile, null);
      if (raw && raw.raizes) {
        _raizesCache = raw.raizes;
        _raizesCacheLoadedAt = Date.now();
      }
    } catch (_) {}
  }
  if (!_raizesCache) return null;
  const item = _raizesCache[raiz];
  return item ? formatarObjetoFidelidade(item) : null;
}

/**
 * Consulta assíncrona resiliente de fidelidade por raiz de CNPJ (com fallback Postgres/Cache)
 */
async function obterFidelidadeRaiz(cgc) {
  const raiz = extrairRaizCnpj(cgc);
  if (!raiz) return null;

  // 1. Prioridade: Supabase PostgreSQL (se conectado)
  if (isPostgresConnected()) {
    try {
      const res = await safeQuery(
        'SELECT raiz_cnpj, razao_social, total_compras, valor_total, primeira_compra, ultima_compra, empresas FROM crm_clientes_raiz_cnpj WHERE raiz_cnpj = $1 LIMIT 1',
        [raiz]
      );
      if (res && res.rows && res.rows.length > 0) {
        return formatarObjetoFidelidade(res.rows[0]);
      }
    } catch (e) {
      // Fallback gracioso
    }
  }

  // 2. Fallback / Memória local
  const cacheMap = await obterCacheRaizes();
  const item = cacheMap[raiz];
  return item ? formatarObjetoFidelidade(item) : null;
}

let cacheMigrationExecuted = false;

/**
 * Migra oportunidades com IDs legados longos (ex: CRM-1790341501167-9273, CRM-1789051276950-2715)
 * para seus números de 4 dígitos finais limpos (ex: 9273, 2715) em todos os registros e relacionamentos.
 * Garante constraint ON UPDATE CASCADE em crm_atividades para propagação atômica.
 */
async function migrarDealsLegadosParaSequencial(force = false) {
  if (cacheMigrationExecuted && !force) return;
  cacheMigrationExecuted = true;

  // 1. Migração idempotente no Supabase PostgreSQL (se conectado)
  try {
    await safeQuery(`
      CREATE SEQUENCE IF NOT EXISTS crm_deals_seq START WITH 29000;

      DO $$
      DECLARE
        rec RECORD;
        novo_id VARCHAR(64);
        max_num BIGINT := 28999;
        sufixo VARCHAR(64);
      BEGIN
        -- 1. Garante constraint com ON UPDATE CASCADE para que a alteração de crm_deals.id propague automaticamente
        ALTER TABLE crm_atividades DROP CONSTRAINT IF EXISTS crm_atividades_deal_id_fkey;
        ALTER TABLE crm_atividades ADD CONSTRAINT crm_atividades_deal_id_fkey 
          FOREIGN KEY (deal_id) REFERENCES crm_deals(id) ON DELETE CASCADE ON UPDATE CASCADE;

        -- 2. Itera sobre todas as oportunidades que possuem formato legado antigo (com hífen ou não puramente numéricas)
        FOR rec IN (SELECT id FROM crm_deals WHERE id LIKE '%-%' OR NOT (id ~ '^[0-9]+$') ORDER BY created_at ASC) LOOP
          -- Extrai os 4 dígitos finais após o último hífen (ex: '9273' de 'CRM-1790341501167-9273', '2715' de 'CRM-1789051276950-2715')
          sufixo := SUBSTRING(rec.id FROM '-([0-9]+)$');

          IF sufixo IS NOT NULL AND sufixo <> '' THEN
            novo_id := sufixo;
          ELSE
            SELECT COALESCE(MAX(CASE WHEN id ~ '^[0-9]+$' THEN id::bigint ELSE 0 END), 28999) + 1 INTO max_num FROM crm_deals;
            novo_id := max_num::text;
          END IF;

          -- Se porventura houver colisão de ID com outro deal já existente, desempata incrementando
          WHILE EXISTS (SELECT 1 FROM crm_deals WHERE id = novo_id AND id <> rec.id) LOOP
            novo_id := (novo_id::bigint + 1)::text;
          END LOOP;

          -- Atualiza o ID do negócio (Postgres propaga automaticamente para crm_atividades via ON UPDATE CASCADE)
          UPDATE crm_deals SET id = novo_id WHERE id = rec.id;
          -- Garante update defensivo de atividades
          UPDATE crm_atividades SET deal_id = novo_id WHERE deal_id = rec.id;
        END LOOP;

        -- 3. Atualiza quaisquer atividades órfãs ainda com prefixo legado
        FOR rec IN (SELECT DISTINCT deal_id FROM crm_atividades WHERE deal_id LIKE '%-%') LOOP
          sufixo := SUBSTRING(rec.deal_id FROM '-([0-9]+)$');
          IF sufixo IS NOT NULL AND sufixo <> '' THEN
            UPDATE crm_atividades SET deal_id = sufixo WHERE deal_id = rec.deal_id;
          END IF;
        END LOOP;

        -- 4. Atualiza a sequence para o maior ID numérico existente ou piso mínimo de 29000
        SELECT COALESCE(MAX(CASE WHEN id ~ '^[0-9]+$' THEN id::bigint ELSE 0 END), 0) INTO max_num FROM crm_deals;
        IF max_num >= 29000 THEN
          PERFORM setval('crm_deals_seq', max_num, true);
        ELSE
          PERFORM setval('crm_deals_seq', 29000, false);
        END IF;
      END $$;
    `);
    console.log('🟢 [CRM Engine] Migração de IDs legados para os 4 dígitos finais executada com sucesso no PostgreSQL.');
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Aviso ao migrar IDs legados no Postgres:', err.message);
  }

  // 2. Migração idempotente no Cache Local de contingência (crm_deals_cache.json)
  try {
    const cache = await readCache();
    let deals = Array.isArray(cache.deals) ? cache.deals : [];
    let atividades = Array.isArray(cache.atividades) ? cache.atividades : [];

    let alterados = 0;
    const idMap = new Map();
    let maxNum = 1000;

    deals.forEach(d => {
      const rawId = String(d.id || '').trim();
      let novoId = rawId;

      const match = rawId.match(/-(\d+)$/);
      if (match && match[1]) {
        novoId = match[1];
      }

      if (novoId !== rawId) {
        idMap.set(rawId, novoId);
        d.id = novoId;
        alterados++;
      }

      const n = parseInt(d.id, 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    });

    atividades.forEach(a => {
      const oldDealId = String(a.deal_id || a.dealId || '').trim();
      if (idMap.has(oldDealId)) {
        const novoId = idMap.get(oldDealId);
        a.deal_id = novoId;
        if (a.dealId) a.dealId = novoId;
      } else {
        const match = oldDealId.match(/-(\d+)$/);
        if (match && match[1]) {
          a.deal_id = match[1];
          if (a.dealId) a.dealId = match[1];
        }
      }
    });

    if (alterados > 0 || force) {
      cache.deals = deals;
      cache.atividades = atividades;
      const cachedSeq = parseInt(cache.next_deal_seq, 10) || 0;
      const maxDealNum = maxNum >= 29000 ? maxNum + 1 : 29000;
      cache.next_deal_seq = Math.max(29000, maxDealNum, cachedSeq >= 29000 ? cachedSeq : 29000);
      await writeCache(cache);
      console.log(`🟢 [CRM Engine] ${alterados} oportunidades migradas para seus 4 dígitos finais no cache local. Próximo ID: ${cache.next_deal_seq}`);
    }
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Erro ao migrar deals legados no cache local:', err.message);
  }
}

/**
 * Obtém o próximo ID sequencial de oportunidade (iniciando em 29000)
 * Utiliza sequence nativa atômica no PostgreSQL com fallback resiliente em cache local
 */
async function obterProximoIdDeal() {
  if (!cacheMigrationExecuted) {
    await migrarDealsLegadosParaSequencial();
  }

  // 1. Tenta PostgreSQL se disponível
  try {
    const res = await safeQuery("SELECT nextval('crm_deals_seq') AS next_id;");
    if (res && res.rows && res.rows.length > 0 && res.rows[0].next_id) {
      let nextId = parseInt(res.rows[0].next_id, 10);
      // Garante piso mínimo de 29000 (para evitar colisão com CRM legado em 26700)
      if (nextId < 29000) {
        await safeQuery("SELECT setval('crm_deals_seq', 29000, false);");
        const adjustedRes = await safeQuery("SELECT nextval('crm_deals_seq') AS next_id;");
        if (adjustedRes && adjustedRes.rows && adjustedRes.rows[0].next_id) {
          nextId = parseInt(adjustedRes.rows[0].next_id, 10);
        } else {
          nextId = 29000;
        }
      }
      const nextIdStr = String(nextId);
      try {
        const cache = await readCache();
        if (!cache.next_deal_seq || nextId >= cache.next_deal_seq) {
          cache.next_deal_seq = nextId + 1;
          await writeCache(cache);
        }
      } catch (_) {}
      return nextIdStr;
    }
  } catch (err) {
    try {
      await safeQuery("CREATE SEQUENCE IF NOT EXISTS crm_deals_seq START WITH 29000;");
      await safeQuery("SELECT setval('crm_deals_seq', 29000, false);");
      const res = await safeQuery("SELECT nextval('crm_deals_seq') AS next_id;");
      if (res && res.rows && res.rows.length > 0 && res.rows[0].next_id) {
        return String(res.rows[0].next_id);
      }
    } catch (_) {}
  }

  // 2. Fallback de Contingência em Cache Local Atômico
  const cache = await readCache();
  if (!cache.deals) cache.deals = [];

  let maxId = 28999;
  for (const d of cache.deals) {
    const n = parseInt(d.id, 10);
    if (!isNaN(n) && String(n) === String(d.id).trim() && n > maxId) {
      maxId = n;
    }
  }

  const cachedSeq = parseInt(cache.next_deal_seq, 10) || 0;
  const currentSeq = Math.max(maxId + 1, cachedSeq >= 29000 ? cachedSeq : 29000);
  cache.next_deal_seq = currentSeq + 1;
  await writeCache(cache);
  return String(currentSeq);
}

/**
 * Lê cache local de contingência dos Clientes do CRM
 */
async function readClientesCache() {
  try {
    const data = await safeReadJson(crmClientesCacheFile, null);
    if (data && typeof data === 'object' && Array.isArray(data.clientes)) {
      return {
        updated_at: data.updated_at || new Date().toISOString(),
        clientes: data.clientes
      };
    }
  } catch (err) {
    console.warn('⚠️ [CRM Clientes Cache] Aviso ao ler cache local:', err.message);
  }
  return {
    updated_at: new Date().toISOString(),
    clientes: []
  };
}

/**
 * Grava cache local de contingência de Clientes de forma atômica
 */
async function writeClientesCache(data) {
  try {
    const payload = {
      updated_at: new Date().toISOString(),
      clientes: Array.isArray(data?.clientes) ? data.clientes : []
    };
    await safeWriteJson(crmClientesCacheFile, payload);
  } catch (err) {
    console.error('❌ [CRM Clientes Cache] Erro ao gravar cache local:', err.message);
  }
}

/**
 * Lê cache local de contingência de Produtos do CRM
 */
async function readProdutosCache() {
  try {
    const data = await safeReadJson(crmProdutosCacheFile, null);
    if (data && typeof data === 'object' && Array.isArray(data.produtos)) {
      return {
        updated_at: data.updated_at || new Date().toISOString(),
        produtos: data.produtos
      };
    }
  } catch (err) {
    console.warn('⚠️ [CRM Produtos Cache] Aviso ao ler cache local:', err.message);
  }
  return {
    updated_at: new Date().toISOString(),
    produtos: []
  };
}

/**
 * Grava cache local de contingência de Produtos de forma atômica
 */
async function writeProdutosCache(data) {
  try {
    const payload = {
      updated_at: new Date().toISOString(),
      produtos: Array.isArray(data?.produtos) ? data.produtos : []
    };
    await safeWriteJson(crmProdutosCacheFile, payload);
    return true;
  } catch (err) {
    console.error('❌ [CRM Produtos Cache] Erro ao gravar cache local:', err.message);
    return false;
  }
}

/**
 * Lê cache local de contingência de Transportadoras do CRM
 */
async function readTransportadorasCache() {
  try {
    const data = await safeReadJson(crmTransportadorasCacheFile, null);
    if (data && typeof data === 'object' && Array.isArray(data.transportadoras)) {
      return {
        updated_at: data.updated_at || new Date().toISOString(),
        transportadoras: data.transportadoras
      };
    }
  } catch (err) {
    console.warn('⚠️ [CRM Transportadoras Cache] Aviso ao ler cache local:', err.message);
  }
  return {
    updated_at: new Date().toISOString(),
    transportadoras: []
  };
}

/**
 * Grava cache local de contingência de Transportadoras de forma atômica
 */
async function writeTransportadorasCache(data) {
  try {
    const payload = {
      updated_at: new Date().toISOString(),
      transportadoras: Array.isArray(data?.transportadoras) ? data.transportadoras : []
    };
    await safeWriteJson(crmTransportadorasCacheFile, payload);
    return true;
  } catch (err) {
    console.error('❌ [CRM Transportadoras Cache] Erro ao gravar cache local:', err.message);
    return false;
  }
}

/**
 * Converte valor para JSON seguro se já não for objeto
 */
function parseJsonField(val, defaultVal = []) {
  if (val === null || val === undefined) return defaultVal;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return defaultVal;
  }
}

/**
 * Normaliza objeto de usuário vindo da requisição
 */
function normalizeUser(usuario) {
  if (!usuario) {
    return { username: 'sistema', name: 'Sistema', role: 'sistema', ip: '' };
  }
  if (typeof usuario === 'string') {
    return { username: usuario, name: usuario, role: usuario === 'alexandre' ? 'admin' : 'vendedor', ip: '' };
  }
  return {
    username: usuario.username || 'sistema',
    name: usuario.name || usuario.username || 'Sistema',
    role: usuario.role || 'user',
    ip: usuario.ip || ''
  };
}

/**
 * Registra telemetria de ação do CRM em logUserActivity
 */
async function recordTelemetry(usuario, actionType, description, metadata = {}) {
  try {
    const u = normalizeUser(usuario);
    await logUserActivity({
      username: u.username,
      userName: u.name,
      actionType,
      description,
      ip: u.ip,
      metadata
    });
  } catch (err) {
    console.warn(`⚠️ [CRM Telemetria] Falha ao registrar ${actionType}:`, err.message);
  }
}

/**
 * Inicialização e auto-migração das tabelas no PostgreSQL (se conectado)
 */
async function initCrmTables() {
  try {
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS crm_deals (
        id VARCHAR(64) PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        cliente_cod VARCHAR(20),
        cliente_loja VARCHAR(10) DEFAULT '01',
        cliente_nome VARCHAR(255) NOT NULL,
        cliente_cnpj VARCHAR(20),
        cliente_email VARCHAR(200),
        cliente_telefone VARCHAR(50),
        cliente_cidade VARCHAR(100),
        cliente_uf VARCHAR(10),
        valor_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        estagio VARCHAR(50) NOT NULL DEFAULT 'lead' CONSTRAINT crm_deals_estagio_check CHECK (estagio IN ('lead', 'contato', 'proposta', 'negociacao', 'ganho', 'perdido')),
        probabilidade NUMERIC(5, 2) NOT NULL DEFAULT 20.00,
        data_fechamento_esperada DATE,
        data_fechamento_real TIMESTAMP WITH TIME ZONE,
        cod_vendedor VARCHAR(20) NOT NULL,
        nome_vendedor VARCHAR(100) NOT NULL,
        origem VARCHAR(50) NOT NULL DEFAULT 'manual',
        status VARCHAR(20) NOT NULL DEFAULT 'aberto',
        motivo_perda TEXT,
        cond_pgto VARCHAR(100),
        tipo_frete VARCHAR(10) DEFAULT 'CIF',
        frete_cobrado NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        frete_embutido NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        transportadora VARCHAR(150),
        transportadora_cod VARCHAR(20),
        prazo_entrega VARCHAR(100),
        num_pedido_compra VARCHAR(100),
        obs_nfe TEXT,
        itens_cotados JSONB NOT NULL DEFAULT '[]'::jsonb,
        contatos JSONB NOT NULL DEFAULT '[]'::jsonb,
        historico_estagios JSONB NOT NULL DEFAULT '[]'::jsonb,
        custom JSONB NOT NULL DEFAULT '{}'::jsonb,
        observacoes TEXT,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        deleted_at TIMESTAMP WITH TIME ZONE,
        created_by VARCHAR(100) NOT NULL DEFAULT 'alexandre',
        updated_by VARCHAR(100) NOT NULL DEFAULT 'alexandre',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS crm_atividades (
        id VARCHAR(64) PRIMARY KEY,
        deal_id VARCHAR(64) NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
        tipo VARCHAR(50) NOT NULL,
        assunto VARCHAR(255) NOT NULL,
        descricao TEXT,
        data_agendada TIMESTAMP WITH TIME ZONE,
        data_concluida TIMESTAMP WITH TIME ZONE,
        status VARCHAR(20) NOT NULL DEFAULT 'pendente',
        prioridade VARCHAR(20) NOT NULL DEFAULT 'media',
        responsavel_usuario VARCHAR(100) NOT NULL,
        responsavel_nome VARCHAR(100),
        custom JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by VARCHAR(100) NOT NULL DEFAULT 'alexandre',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS crm_clientes (
        id VARCHAR(64) PRIMARY KEY,
        tipo_pessoa VARCHAR(2) DEFAULT 'PJ',
        tipo_cliente_protheus VARCHAR(2) DEFAULT 'F',
        nome_razao VARCHAR(255) NOT NULL,
        nome_fantasia VARCHAR(255),
        cnpj_cpf VARCHAR(20),
        ie VARCHAR(20),
        contato_nome VARCHAR(150),
        telefone VARCHAR(50),
        celular_whatsapp VARCHAR(50),
        email VARCHAR(150),
        site_url VARCHAR(255),
        email_nfe VARCHAR(150),
        email_boleto VARCHAR(150),
        contato_financeiro_nome VARCHAR(150),
        contato_financeiro_tel VARCHAR(50),
        contato_financeiro_email VARCHAR(150),
        cep VARCHAR(10),
        logradouro VARCHAR(255),
        numero VARCHAR(50),
        complemento VARCHAR(100),
        bairro VARCHAR(100),
        cidade VARCHAR(100),
        uf VARCHAR(2),
        origem VARCHAR(50) DEFAULT 'OUTRO',
        vendedor_responsavel VARCHAR(100),
        protheus_cod VARCHAR(20),
        protheus_loja VARCHAR(10),
        observacoes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        deleted_at TIMESTAMPTZ NULL
      );

      CREATE INDEX IF NOT EXISTS idx_crm_deals_estagio ON crm_deals(estagio);
      CREATE INDEX IF NOT EXISTS idx_crm_deals_cod_vendedor ON crm_deals(cod_vendedor);
      CREATE INDEX IF NOT EXISTS idx_crm_deals_cliente_cod ON crm_deals(cliente_cod);
      CREATE INDEX IF NOT EXISTS idx_crm_deals_cliente_nome ON crm_deals(cliente_nome);
      CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON crm_deals(status);
      CREATE INDEX IF NOT EXISTS idx_crm_deals_ativo ON crm_deals(ativo);
      CREATE INDEX IF NOT EXISTS idx_crm_deals_created_at ON crm_deals(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_crm_deals_updated_at ON crm_deals(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_crm_atividades_deal_id ON crm_atividades(deal_id);
      CREATE INDEX IF NOT EXISTS idx_crm_atividades_tipo ON crm_atividades(tipo);
      CREATE INDEX IF NOT EXISTS idx_crm_atividades_status ON crm_atividades(status);
      CREATE INDEX IF NOT EXISTS idx_crm_atividades_data_agendada ON crm_atividades(data_agendada);
      CREATE INDEX IF NOT EXISTS idx_crm_atividades_responsavel ON crm_atividades(responsavel_usuario);

      CREATE INDEX IF NOT EXISTS idx_crm_clientes_cnpj_cpf ON crm_clientes(cnpj_cpf);
      CREATE INDEX IF NOT EXISTS idx_crm_clientes_nome ON crm_clientes(nome_razao);
      CREATE INDEX IF NOT EXISTS idx_crm_clientes_vendedor ON crm_clientes(vendedor_responsavel);
      CREATE INDEX IF NOT EXISTS idx_crm_clientes_protheus_cod ON crm_clientes(protheus_cod);
      CREATE INDEX IF NOT EXISTS idx_crm_clientes_deleted_at ON crm_clientes(deleted_at);

      -- Tabela de Fidelidade de Clientes por Raiz de CNPJ
      CREATE TABLE IF NOT EXISTS crm_clientes_raiz_cnpj (
        raiz_cnpj VARCHAR(8) PRIMARY KEY,
        razao_social VARCHAR(255),
        total_compras INTEGER NOT NULL DEFAULT 0,
        valor_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        primeira_compra DATE,
        ultima_compra DATE,
        empresas JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_crm_clientes_raiz_cnpj_total ON crm_clientes_raiz_cnpj(total_compras DESC);

      -- Harmonização de colunas para IDs de clientes do CRM (VARCHAR(64))
      ALTER TABLE IF EXISTS crm_deals ALTER COLUMN cliente_cod TYPE VARCHAR(64);

      -- Migrações idempotentes de colunas em crm_clientes
      ALTER TABLE IF EXISTS crm_clientes ADD COLUMN IF NOT EXISTS tipo_cliente_protheus VARCHAR(2) DEFAULT 'F';
      ALTER TABLE IF EXISTS crm_clientes ADD COLUMN IF NOT EXISTS site_url VARCHAR(255);
      ALTER TABLE IF EXISTS crm_clientes ADD COLUMN IF NOT EXISTS email_nfe VARCHAR(150);
      ALTER TABLE IF EXISTS crm_clientes ADD COLUMN IF NOT EXISTS email_boleto VARCHAR(150);
      ALTER TABLE IF EXISTS crm_clientes ADD COLUMN IF NOT EXISTS contato_financeiro_nome VARCHAR(150);
      ALTER TABLE IF EXISTS crm_clientes ADD COLUMN IF NOT EXISTS contato_financeiro_tel VARCHAR(50);
      ALTER TABLE IF EXISTS crm_clientes ADD COLUMN IF NOT EXISTS contato_financeiro_email VARCHAR(150);

      -- RLS Estrito para crm_clientes
      ALTER TABLE crm_clientes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE crm_clientes FORCE ROW LEVEL SECURITY;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          GRANT ALL ON TABLE crm_clientes TO service_role;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
          GRANT ALL ON TABLE crm_clientes TO postgres;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON TABLE crm_clientes FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON TABLE crm_clientes FROM authenticated;
        END IF;
        DROP POLICY IF EXISTS "Acesso exclusivo backend crm_clientes" ON crm_clientes;
        CREATE POLICY "Acesso exclusivo backend crm_clientes" ON crm_clientes TO service_role, postgres USING (true) WITH CHECK (true);
      END $$;

      CREATE TABLE IF NOT EXISTS crm_produtos (
        codigo VARCHAR(50) PRIMARY KEY,
        descricao VARCHAR(255) NOT NULL,
        ncm VARCHAR(20),
        unidade VARCHAR(10) DEFAULT 'UN',
        tipo VARCHAR(10) DEFAULT 'PA',
        grupo VARCHAR(50),
        preco_tabela NUMERIC(14,2) DEFAULT 0.00,
        peso_liquido NUMERIC(12,4) DEFAULT 0.0000,
        peso_bruto NUMERIC(12,4) DEFAULT 0.0000,
        aliquota_ipi NUMERIC(6,2) DEFAULT 0.00,
        bloqueado BOOLEAN DEFAULT FALSE,
        custom JSONB DEFAULT '{}'::jsonb,
        synced_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_crm_produtos_descricao ON crm_produtos(descricao);
      CREATE INDEX IF NOT EXISTS idx_crm_produtos_grupo ON crm_produtos(grupo);
      CREATE INDEX IF NOT EXISTS idx_crm_produtos_bloqueado ON crm_produtos(bloqueado);
      CREATE INDEX IF NOT EXISTS idx_crm_produtos_tipo ON crm_produtos(tipo);
      CREATE INDEX IF NOT EXISTS idx_crm_produtos_synced_at ON crm_produtos(synced_at DESC);

      -- Migrações idempotentes de colunas em crm_produtos
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS ncm VARCHAR(20);
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS unidade VARCHAR(10) DEFAULT 'UN';
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) DEFAULT 'PA';
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS grupo VARCHAR(50);
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS preco_tabela NUMERIC(14,2) DEFAULT 0.00;
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS peso_liquido NUMERIC(12,4) DEFAULT 0.0000;
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS peso_bruto NUMERIC(12,4) DEFAULT 0.0000;
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS aliquota_ipi NUMERIC(6,2) DEFAULT 0.00;
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN DEFAULT FALSE;
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS custom JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE IF EXISTS crm_produtos ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT NOW();

      -- RLS Estrito para crm_produtos
      ALTER TABLE crm_produtos ENABLE ROW LEVEL SECURITY;
      ALTER TABLE crm_produtos FORCE ROW LEVEL SECURITY;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          GRANT ALL ON TABLE crm_produtos TO service_role;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
          GRANT ALL ON TABLE crm_produtos TO postgres;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON TABLE crm_produtos FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON TABLE crm_produtos FROM authenticated;
        END IF;
        DROP POLICY IF EXISTS "Acesso exclusivo backend crm_produtos" ON crm_produtos;
        CREATE POLICY "Acesso exclusivo backend crm_produtos" ON crm_produtos TO service_role, postgres USING (true) WITH CHECK (true);
      END $$;

      -- Migração idempotente para crm_deals
      ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS transportadora_cod VARCHAR(20);

      -- Tabela de Transportadoras espelhadas do Protheus ERP
      CREATE TABLE IF NOT EXISTS crm_transportadoras (
        codigo VARCHAR(20) PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        fantasia VARCHAR(100),
        cnpj VARCHAR(20),
        cidade VARCHAR(80),
        uf VARCHAR(10),
        telefone VARCHAR(50),
        bloqueado BOOLEAN DEFAULT FALSE,
        synced_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_crm_transp_nome ON crm_transportadoras(nome);
      CREATE INDEX IF NOT EXISTS idx_crm_transp_fantasia ON crm_transportadoras(fantasia);
      CREATE INDEX IF NOT EXISTS idx_crm_transp_cnpj ON crm_transportadoras(cnpj);
      CREATE INDEX IF NOT EXISTS idx_crm_transp_bloqueado ON crm_transportadoras(bloqueado);

      -- RLS Estrito para crm_transportadoras
      ALTER TABLE crm_transportadoras ENABLE ROW LEVEL SECURITY;
      ALTER TABLE crm_transportadoras FORCE ROW LEVEL SECURITY;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          GRANT ALL ON TABLE crm_transportadoras TO service_role;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
          GRANT ALL ON TABLE crm_transportadoras TO postgres;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON TABLE crm_transportadoras FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON TABLE crm_transportadoras FROM authenticated;
        END IF;
        DROP POLICY IF EXISTS "Acesso exclusivo backend crm_transportadoras" ON crm_transportadoras;
        CREATE POLICY "Acesso exclusivo backend crm_transportadoras" ON crm_transportadoras TO service_role, postgres USING (true) WITH CHECK (true);
      END $$;
    `);
    console.log('🟢 [CRM Engine] Schema do CRM verificado/inicializado com sucesso no Supabase PostgreSQL.');
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Aviso ao verificar schema do CRM no Postgres:', err.message);
  }

  // Executa migração idempotente de oportunidades legadas para sequência de 4 dígitos (1001+)
  await migrarDealsLegadosParaSequencial();
}

/**
 * Mapeia registro de deal do PostgreSQL para formato padronizado da API
 */
function mapDealRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    titulo: row.titulo,
    cliente_cod: row.cliente_cod || '',
    cliente_loja: row.cliente_loja || '01',
    cliente_nome: row.cliente_nome || '',
    cliente_cnpj: row.cliente_cnpj || '',
    cliente_cnpj_fmt: formatarCgc(row.cliente_cnpj),
    fidelidade_compras: obterFidelidadeRaizSync(row.cliente_cnpj),
    cliente_email: row.cliente_email || '',
    cliente_telefone: row.cliente_telefone || '',
    cliente_telefone_fmt: formatarTelefone(row.cliente_telefone),
    cliente_cidade: row.cliente_cidade || '',
    cliente_uf: row.cliente_uf || '',
    valor_total: parseFloat(row.valor_total) || 0,
    estagio: row.estagio || 'lead',
    probabilidade: parseFloat(row.probabilidade) || 20,
    data_fechamento_esperada: row.data_fechamento_esperada ? row.data_fechamento_esperada.toString().slice(0, 10) : null,
    data_fechamento_real: row.data_fechamento_real || null,
    cod_vendedor: row.cod_vendedor || '',
    nome_vendedor: row.nome_vendedor || '',
    origem: row.origem || 'manual',
    status: row.status || 'aberto',
    motivo_perda: row.motivo_perda || '',
    cond_pgto: row.cond_pgto || '',
    tipo_frete: row.tipo_frete || 'CIF',
    frete_cobrado: parseFloat(row.frete_cobrado) || 0,
    frete_embutido: parseFloat(row.frete_embutido) || 0,
    transportadora: row.transportadora || '',
    transportadora_cod: row.transportadora_cod || '',
    prazo_entrega: row.prazo_entrega || '',
    num_pedido_compra: row.num_pedido_compra || '',
    obs_nfe: row.obs_nfe || '',
    itens_cotados: parseJsonField(row.itens_cotados, []),
    contatos: parseJsonField(row.contatos, []),
    historico_estagios: parseJsonField(row.historico_estagios, []),
    custom: parseJsonField(row.custom, {}),
    observacoes: row.observacoes || '',
    ativo: row.ativo !== false,
    created_by: row.created_by || 'alexandre',
    updated_by: row.updated_by || 'alexandre',
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString()
  };
}

/**
 * Mapeia registro de atividade para formato da API
 */
function mapAtividadeRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    deal_id: String(row.deal_id),
    tipo: row.tipo,
    assunto: row.assunto,
    descricao: row.descricao || '',
    data_agendada: row.data_agendada || null,
    data_concluida: row.data_concluida || null,
    status: row.status || 'pendente',
    prioridade: row.prioridade || 'media',
    responsavel_usuario: row.responsavel_usuario || 'alexandre',
    responsavel_nome: row.responsavel_nome || 'Alexandre',
    custom: parseJsonField(row.custom, {}),
    created_by: row.created_by || 'alexandre',
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString()
  };
}

/**
 * Mapeia registro de cliente para formato padronizado da API
 */
function mapClienteRow(row) {
  if (!row) return null;
  const cnpjLimpo = row.cnpj_cpf ? String(row.cnpj_cpf).replace(/\D/g, '') : '';
  return {
    id: String(row.id),
    tipo_pessoa: row.tipo_pessoa || 'PJ',
    tipo_cliente_protheus: row.tipo_cliente_protheus || 'F',
    nome_razao: row.nome_razao || '',
    nome_fantasia: row.nome_fantasia || '',
    cnpj_cpf: cnpjLimpo,
    cnpj_cpf_fmt: formatarCgc(cnpjLimpo),
    fidelidade_compras: obterFidelidadeRaizSync(cnpjLimpo),
    ie: row.ie || '',
    contato_nome: row.contato_nome || '',
    telefone: row.telefone || '',
    telefone_fmt: formatarTelefone(row.telefone),
    celular_whatsapp: row.celular_whatsapp || '',
    celular_whatsapp_fmt: formatarTelefone(row.celular_whatsapp),
    email: row.email || '',
    site_url: normalizarSiteUrl(row.site_url),
    email_nfe: row.email_nfe || '',
    email_boleto: row.email_boleto || '',
    contato_financeiro_nome: row.contato_financeiro_nome || '',
    contato_financeiro_tel: row.contato_financeiro_tel || '',
    contato_financeiro_tel_fmt: formatarTelefone(row.contato_financeiro_tel),
    contato_financeiro_email: row.contato_financeiro_email || '',
    cep: row.cep || '',
    logradouro: row.logradouro || '',
    numero: row.numero || '',
    complemento: row.complemento || '',
    bairro: row.bairro || '',
    cidade: row.cidade || '',
    uf: (row.uf || '').toUpperCase(),
    origem: row.origem || 'OUTRO',
    vendedor_responsavel: row.vendedor_responsavel || '',
    protheus_cod: row.protheus_cod || '',
    protheus_loja: row.protheus_loja || '01',
    observacoes: row.observacoes || '',
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
    deleted_at: row.deleted_at || null
  };
}

/**
 * 1. LISTAR DEALS
 * Filtros: estagio, busca, codVendedor, status
 */
async function listarDeals(filtros = {}) {
  const { estagio, busca, codVendedor, status } = filtros;
  let deals = [];
  let fromDb = false;

  // Garante que qualquer deal legado seja migrado para seu ID de 4 dígitos antes da listagem
  if (!cacheMigrationExecuted) {
    await migrarDealsLegadosParaSequencial();
  }

  try {
    const params = [];
    let query = `
      SELECT * FROM crm_deals 
      WHERE ativo = TRUE
    `;

    if (estagio && estagio !== 'TODOS') {
      params.push(String(estagio).trim().toLowerCase());
      query += ` AND estagio = $${params.length}`;
    }

    if (codVendedor && codVendedor !== 'TODOS') {
      params.push(String(codVendedor).trim());
      query += ` AND cod_vendedor = $${params.length}`;
    }

    if (status && status !== 'TODOS') {
      params.push(String(status).trim().toLowerCase());
      query += ` AND status = $${params.length}`;
    }

    if (busca && String(busca).trim()) {
      params.push(`%${String(busca).trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(titulo) LIKE $${params.length} 
        OR LOWER(cliente_nome) LIKE $${params.length} 
        OR cliente_cnpj LIKE $${params.length}
        OR LOWER(cliente_cod) LIKE $${params.length}
        OR LOWER(nome_vendedor) LIKE $${params.length}
      )`;
    }

    query += ' ORDER BY updated_at DESC, id DESC;';

    const res = await safeQuery(query, params);
    if (res && Array.isArray(res.rows)) {
      deals = res.rows.map(mapDealRow);
      fromDb = true;
    }
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Erro ao consultar Deals no Postgres. Utilizando fallback local:', err.message);
  }

  // Fallback / Contingência em Cache Local
  if (!fromDb) {
    const cache = await readCache();
    deals = (cache.deals || []).filter(d => d.ativo !== false);

    if (estagio && estagio !== 'TODOS') {
      deals = deals.filter(d => d.estagio === String(estagio).trim().toLowerCase());
    }
    if (codVendedor && codVendedor !== 'TODOS') {
      deals = deals.filter(d => d.cod_vendedor === codVendedor);
    }
    if (status && status !== 'TODOS') {
      deals = deals.filter(d => d.status === status);
    }
    if (busca && String(busca).trim()) {
      const b = String(busca).trim().toLowerCase();
      deals = deals.filter(d => 
        (d.titulo && d.titulo.toLowerCase().includes(b)) ||
        (d.cliente_nome && d.cliente_nome.toLowerCase().includes(b)) ||
        (d.cliente_cnpj && d.cliente_cnpj.includes(b)) ||
        (d.cliente_cod && d.cliente_cod.toLowerCase().includes(b)) ||
        (d.nome_vendedor && d.nome_vendedor.toLowerCase().includes(b))
      );
    }

    deals.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  }

  // Pré-computa estatísticas de atividades (anotações e concluídas) para o motor preditivo
  const activityStats = {};
  if (fromDb && isPostgresConnected()) {
    try {
      const statsRes = await safeQuery(`
        SELECT deal_id,
               COUNT(*) FILTER (WHERE tipo = 'anotacao' OR tipo = 'NOTA') AS notes_count,
               COUNT(*) FILTER (WHERE status = 'concluida') AS done_activities_count
        FROM crm_atividades
        GROUP BY deal_id;
      `);
      if (statsRes && Array.isArray(statsRes.rows)) {
        for (const row of statsRes.rows) {
          activityStats[String(row.deal_id)] = {
            notes_count: parseInt(row.notes_count, 10) || 0,
            done_activities_count: parseInt(row.done_activities_count, 10) || 0
          };
        }
      }
    } catch (_) {}
  } else {
    try {
      const cache = await readCache();
      for (const a of (cache.atividades || [])) {
        const dId = String(a.deal_id);
        if (!activityStats[dId]) activityStats[dId] = { notes_count: 0, done_activities_count: 0 };
        if (a.tipo === 'anotacao' || a.tipo === 'NOTA') activityStats[dId].notes_count++;
        if (a.status === 'concluida') activityStats[dId].done_activities_count++;
      }
    } catch (_) {}
  }

  // Enriquece deals com a fidelidade da raiz de CNPJ e Score Preditivo
  await obterCacheRaizes();
  for (const d of deals) {
    if (!d.fidelidade_compras) {
      d.fidelidade_compras = obterFidelidadeRaizSync(d.cliente_cnpj || d.clienteCnpj || '');
    }
    const st = activityStats[String(d.id)] || { notes_count: 0, done_activities_count: 0 };
    d.notes_count = st.notes_count;
    d.done_activities_count = st.done_activities_count;
    d.score_preditivo = calcularScoreDeal(d);
  }

  return {
    source: fromDb ? 'supabase_postgres' : 'local_json_cache',
    total: deals.length,
    deals
  };
}

/**
 * 2. OBTER DEAL POR ID
 */
async function obterDealPorId(id) {
  if (!id) return null;
  const cleanId = String(id).trim();
  const sufixo = cleanId.match(/-(\d+)$/)?.[1];
  let deal = null;

  // 1. Tenta Postgres
  try {
    const res = await safeQuery('SELECT * FROM crm_deals WHERE id = $1 AND ativo = TRUE;', [cleanId]);
    if (res && res.rows && res.rows.length > 0) {
      deal = mapDealRow(res.rows[0]);
    } else if (sufixo && sufixo !== cleanId) {
      const resSuff = await safeQuery('SELECT * FROM crm_deals WHERE id = $1 AND ativo = TRUE;', [sufixo]);
      if (resSuff && resSuff.rows && resSuff.rows.length > 0) {
        deal = mapDealRow(resSuff.rows[0]);
      }
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao buscar Deal #${cleanId} no Postgres:`, err.message);
  }

  // 2. Fallback Cache Local
  if (!deal) {
    const cache = await readCache();
    deal = (cache.deals || []).find(d => 
      (String(d.id) === cleanId || (sufixo && String(d.id) === sufixo)) && d.ativo !== false
    );
  }

  if (deal) {
    if (!deal.fidelidade_compras) {
      deal.fidelidade_compras = obterFidelidadeRaizSync(deal.cliente_cnpj || deal.clienteCnpj || '');
    }
    // Enriquece com notas, atividades e Score Preditivo
    try {
      const atividades = await listarAtividades(deal.id);
      deal.notes_count = atividades.filter(a => a.tipo === 'anotacao' || a.tipo === 'NOTA').length;
      deal.done_activities_count = atividades.filter(a => a.status === 'concluida').length;
    } catch (_) {
      deal.notes_count = deal.notes_count || 0;
      deal.done_activities_count = deal.done_activities_count || 0;
    }
    deal.score_preditivo = calcularScoreDeal(deal);
  }

  return deal || null;
}

/**
 * 3. CRIAR DEAL
 */
async function criarDeal(dados, usuario) {
  const u = normalizeUser(usuario);
  const titulo = String(dados?.titulo || '').trim();
  const clienteNome = String(dados?.cliente_nome || '').trim();

  if (!titulo) {
    throw new Error("O campo 'titulo' é obrigatório.");
  }
  if (!clienteNome) {
    throw new Error("O campo 'cliente_nome' é obrigatório.");
  }

  const codVendedor = dados.cod_vendedor ? String(dados.cod_vendedor).trim() : (u.role === 'vendedor' ? '000074' : '000004');
  const nomeVendedor = dados.nome_vendedor || getNomeVendedor(codVendedor) || 'VENDEDOR';

  const itensCotados = Array.isArray(dados.itens_cotados) ? dados.itens_cotados : [];
  const freteCobrado = parseFloat(dados.frete_cobrado) || 0.00;
  const freteEmbutido = parseFloat(dados.frete_embutido) || 0.00;

  let valorTotal = parseFloat(dados.valor_total);
  if (isNaN(valorTotal) || valorTotal <= 0) {
    const sumItens = itensCotados.reduce((acc, item) => {
      const q = parseFloat(item.quantidade) || parseFloat(item.qtd) || 0;
      const p = parseFloat(item.preco_unitario) || parseFloat(item.preco_unit) || 0;
      return acc + (q * p);
    }, 0);
    // Frete embutido NÃO é somado ao total pois já está no preço dos produtos
    valorTotal = sumItens + freteCobrado;
  }

  const estagioInicial = (dados.estagio || 'lead').trim().toLowerCase();
  if (!CANONICAL_STAGES.includes(estagioInicial)) {
    throw new Error(`Estágio '${dados.estagio}' inválido. Estágios permitidos: ${CANONICAL_STAGES.join(', ')}.`);
  }

  const probabilidade = dados.probabilidade !== undefined ? parseFloat(dados.probabilidade) : (
    estagioInicial === 'ganho' ? 100.00 :
    estagioInicial === 'negociacao' ? 80.00 :
    estagioInicial === 'proposta' ? 50.00 :
    estagioInicial === 'contato' ? 30.00 :
    estagioInicial === 'perdido' ? 0.00 : 20.00
  );

  const historicoEstagios = [
    {
      estagio_anterior: null,
      estagio_novo: estagioInicial,
      alterado_por: u.username,
      alterado_em: new Date().toISOString(),
      justificativa: dados.justificativa || 'Criação do negócio no CRM'
    }
  ];

  const contatos = Array.isArray(dados.contatos) ? dados.contatos : [];
  const custom = typeof dados.custom === 'object' && dados.custom !== null ? { ...dados.custom } : {};
  if (dados.faturadoPor || dados.faturado_por) {
    custom.faturadoPor = dados.faturadoPor || dados.faturado_por;
  }
  const transpCod = dados.transportadora_cod || dados.transportadoraCod || (dados.custom && (dados.custom.transportadora_cod || dados.custom.transportadoraCod)) || '';
  if (transpCod) {
    custom.transportadora_cod = transpCod;
    custom.transportadoraCod = transpCod;
  }
  const dealId = await obterProximoIdDeal();

  let novoDeal = null;

  // 1. Tenta Supabase Postgres
  try {
    const res = await safeQuery(`
      INSERT INTO crm_deals (
        id, titulo, cliente_cod, cliente_loja, cliente_nome, cliente_cnpj,
        cliente_email, cliente_telefone, cliente_cidade, cliente_uf,
        valor_total, estagio, probabilidade, data_fechamento_esperada,
        cod_vendedor, nome_vendedor, origem, status, motivo_perda,
        cond_pgto, tipo_frete, frete_cobrado, frete_embutido, transportadora, transportadora_cod, prazo_entrega, num_pedido_compra, obs_nfe,
        itens_cotados, contatos, historico_estagios, custom, observacoes,
        ativo, created_by, updated_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31, $32, $33,
        TRUE, $34, $35, NOW(), NOW()
      ) RETURNING *;
    `, [
      dealId,
      titulo,
      dados.cliente_cod || '',
      dados.cliente_loja || '01',
      clienteNome,
      dados.cliente_cnpj ? String(dados.cliente_cnpj).replace(/\D/g, '') : '',
      dados.cliente_email || '',
      dados.cliente_telefone || '',
      dados.cliente_cidade || '',
      dados.cliente_uf || '',
      valorTotal,
      estagioInicial,
      probabilidade,
      dados.data_fechamento_esperada || null,
      codVendedor,
      nomeVendedor,
      dados.origem || 'manual',
      estagioInicial === 'ganho' ? 'ganho' : (estagioInicial === 'perdido' ? 'perdido' : 'aberto'),
      dados.motivo_perda || null,
      dados.cond_pgto || '',
      dados.tipo_frete || 'CIF',
      freteCobrado,
      freteEmbutido,
      dados.transportadora || '',
      transpCod,
      dados.prazo_entrega || '',
      dados.num_pedido_compra || '',
      dados.obs_nfe || '',
      JSON.stringify(itensCotados),
      JSON.stringify(contatos),
      JSON.stringify(historicoEstagios),
      JSON.stringify(custom),
      dados.observacoes || '',
      u.username,
      u.username
    ]);

    if (res && res.rows && res.rows.length > 0) {
      novoDeal = mapDealRow(res.rows[0]);
    }
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Erro ao inserir deal no Postgres. Usando fallback atômico:', err.message);
  }

  // 2. Fallback de Contingência em Cache Local
  if (!novoDeal) {
    const cache = await readCache();
    novoDeal = {
      id: dealId,
      titulo,
      cliente_cod: dados.cliente_cod || '',
      cliente_loja: dados.cliente_loja || '01',
      cliente_nome: clienteNome,
      cliente_cnpj: dados.cliente_cnpj ? String(dados.cliente_cnpj).replace(/\D/g, '') : '',
      cliente_cnpj_fmt: formatarCgc(dados.cliente_cnpj),
      cliente_email: dados.cliente_email || '',
      cliente_telefone: dados.cliente_telefone || '',
      cliente_telefone_fmt: formatarTelefone(dados.cliente_telefone),
      cliente_cidade: dados.cliente_cidade || '',
      cliente_uf: dados.cliente_uf || '',
      valor_total: valorTotal,
      estagio: estagioInicial,
      probabilidade,
      data_fechamento_esperada: dados.data_fechamento_esperada || null,
      data_fechamento_real: estagioInicial === 'ganho' ? new Date().toISOString() : null,
      cod_vendedor: codVendedor,
      nome_vendedor: nomeVendedor,
      origem: dados.origem || 'manual',
      status: estagioInicial === 'ganho' ? 'ganho' : (estagioInicial === 'perdido' ? 'perdido' : 'aberto'),
      motivo_perda: dados.motivo_perda || '',
      cond_pgto: dados.cond_pgto || '',
      tipo_frete: dados.tipo_frete || 'CIF',
      frete_cobrado: freteCobrado,
      frete_embutido: freteEmbutido,
      transportadora: dados.transportadora || '',
      transportadora_cod: transpCod,
      prazo_entrega: dados.prazo_entrega || '',
      num_pedido_compra: dados.num_pedido_compra || '',
      obs_nfe: dados.obs_nfe || '',
      itens_cotados: itensCotados,
      contatos,
      historico_estagios: historicoEstagios,
      custom,
      observacoes: dados.observacoes || '',
      ativo: true,
      created_by: u.username,
      updated_by: u.username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    cache.deals.unshift(novoDeal);
    await writeCache(cache);
  } else {
    // Também sincroniza com cache para garantir consistência
    const cache = await readCache();
    cache.deals.unshift(novoDeal);
    await writeCache(cache);
  }

  // 3. Telemetria
  await recordTelemetry(u, 'CRM_CRIAR_DEAL', `Criou a oportunidade #${novoDeal.id} ("${novoDeal.titulo}") para ${novoDeal.cliente_nome}`, {
    dealId: novoDeal.id,
    cliente: novoDeal.cliente_nome,
    valorTotal: novoDeal.valor_total,
    estagio: novoDeal.estagio,
    codVendedor: novoDeal.cod_vendedor
  });

  return novoDeal;
}

/**
 * 4. ATUALIZAR DEAL
 */
async function atualizarDeal(id, dados, usuario) {
  const u = normalizeUser(usuario);
  const cleanId = String(id).trim();

  const existente = await obterDealPorId(cleanId);
  if (!existente) {
    const err = new Error(`Negócio #${cleanId} não localizado.`);
    err.status = 404;
    err.code = 'DEAL_NOT_FOUND';
    throw err;
  }

  let estagioNovo = existente.estagio;
  if (dados.estagio !== undefined) {
    const stLimpo = String(dados.estagio).trim().toLowerCase();
    if (!CANONICAL_STAGES.includes(stLimpo)) {
      throw new Error(`Estágio '${dados.estagio}' inválido.`);
    }
    estagioNovo = stLimpo;
  }

  let historicoEstagios = Array.isArray(existente.historico_estagios) ? [...existente.historico_estagios] : [];
  if (estagioNovo !== existente.estagio) {
    historicoEstagios.push({
      estagio_anterior: existente.estagio,
      estagio_novo: estagioNovo,
      alterado_por: u.username,
      alterado_em: new Date().toISOString(),
      justificativa: dados.justificativa || 'Atualização de negócio via CRM'
    });
  }

  const itensCotados = dados.itens_cotados !== undefined ? (Array.isArray(dados.itens_cotados) ? dados.itens_cotados : []) : existente.itens_cotados;
  const freteCobrado = dados.frete_cobrado !== undefined ? parseFloat(dados.frete_cobrado) || 0 : (existente.frete_cobrado || 0);
  const freteEmbutido = dados.frete_embutido !== undefined ? parseFloat(dados.frete_embutido) || 0 : (existente.frete_embutido || 0);

  let valorTotal = dados.valor_total !== undefined ? parseFloat(dados.valor_total) : existente.valor_total;
  if (dados.itens_cotados !== undefined && (dados.valor_total === undefined || isNaN(valorTotal))) {
    const sumItens = itensCotados.reduce((acc, item) => {
      const q = parseFloat(item.quantidade) || parseFloat(item.qtd) || 0;
      const p = parseFloat(item.preco_unitario) || parseFloat(item.preco_unit) || 0;
      return acc + (q * p);
    }, 0);
    valorTotal = sumItens + freteCobrado;
  }

  const codVendedor = dados.cod_vendedor !== undefined ? String(dados.cod_vendedor).trim() : existente.cod_vendedor;
  const nomeVendedor = dados.nome_vendedor || (dados.cod_vendedor ? getNomeVendedor(codVendedor) : existente.nome_vendedor);

  const customAtual = typeof dados.custom === 'object' && dados.custom !== null
    ? { ...(existente.custom || {}), ...dados.custom }
    : { ...(existente.custom || {}) };
  if (dados.faturadoPor !== undefined || dados.faturado_por !== undefined) {
    customAtual.faturadoPor = dados.faturadoPor || dados.faturado_por;
  }

  let dealAtualizado = null;

  // 1. Tenta Postgres
  try {
    const res = await safeQuery(`
      UPDATE crm_deals SET
        titulo = COALESCE($1, titulo),
        cliente_cod = COALESCE($2, cliente_cod),
        cliente_loja = COALESCE($3, cliente_loja),
        cliente_nome = COALESCE($4, cliente_nome),
        cliente_cnpj = COALESCE($5, cliente_cnpj),
        cliente_email = COALESCE($6, cliente_email),
        cliente_telefone = COALESCE($7, cliente_telefone),
        cliente_cidade = COALESCE($8, cliente_cidade),
        cliente_uf = COALESCE($9, cliente_uf),
        valor_total = $10,
        estagio = $11,
        probabilidade = COALESCE($12, probabilidade),
        data_fechamento_esperada = $13,
        data_fechamento_real = $14,
        cod_vendedor = $15,
        nome_vendedor = $16,
        origem = COALESCE($17, origem),
        status = COALESCE($18, status),
        motivo_perda = $19,
        cond_pgto = COALESCE($20, cond_pgto),
        tipo_frete = COALESCE($21, tipo_frete),
        frete_cobrado = $22,
        frete_embutido = $23,
        transportadora = COALESCE($24, transportadora),
        transportadora_cod = COALESCE($25, transportadora_cod),
        prazo_entrega = COALESCE($26, prazo_entrega),
        num_pedido_compra = COALESCE($27, num_pedido_compra),
        obs_nfe = COALESCE($28, obs_nfe),
        itens_cotados = $29,
        contatos = $30,
        historico_estagios = $31,
        custom = $32,
        observacoes = $33,
        updated_by = $34,
        updated_at = NOW()
      WHERE id = $35 AND ativo = TRUE
      RETURNING *;
    `, [
      dados.titulo ? String(dados.titulo).trim() : null,
      dados.cliente_cod !== undefined ? dados.cliente_cod : null,
      dados.cliente_loja !== undefined ? dados.cliente_loja : null,
      dados.cliente_nome ? String(dados.cliente_nome).trim() : null,
      dados.cliente_cnpj !== undefined ? String(dados.cliente_cnpj).replace(/\D/g, '') : null,
      dados.cliente_email !== undefined ? dados.cliente_email : null,
      dados.cliente_telefone !== undefined ? dados.cliente_telefone : null,
      dados.cliente_cidade !== undefined ? dados.cliente_cidade : null,
      dados.cliente_uf !== undefined ? dados.cliente_uf : null,
      valorTotal,
      estagioNovo,
      dados.probabilidade !== undefined ? parseFloat(dados.probabilidade) : null,
      dados.data_fechamento_esperada !== undefined ? dados.data_fechamento_esperada : existente.data_fechamento_esperada,
      dados.data_fechamento_real !== undefined ? dados.data_fechamento_real : existente.data_fechamento_real,
      codVendedor,
      nomeVendedor,
      dados.origem || null,
      dados.status || null,
      dados.motivo_perda !== undefined ? dados.motivo_perda : existente.motivo_perda,
      dados.cond_pgto !== undefined ? dados.cond_pgto : null,
      dados.tipo_frete !== undefined ? dados.tipo_frete : null,
      freteCobrado,
      freteEmbutido,
      dados.transportadora !== undefined ? dados.transportadora : null,
      (dados.transportadora_cod !== undefined ? dados.transportadora_cod : (dados.transportadoraCod !== undefined ? dados.transportadoraCod : null)),
      dados.prazo_entrega !== undefined ? dados.prazo_entrega : null,
      dados.num_pedido_compra !== undefined ? dados.num_pedido_compra : null,
      dados.obs_nfe !== undefined ? dados.obs_nfe : null,
      JSON.stringify(itensCotados),
      JSON.stringify(dados.contatos !== undefined ? dados.contatos : existente.contatos),
      JSON.stringify(historicoEstagios),
      JSON.stringify(customAtual),
      dados.observacoes !== undefined ? dados.observacoes : existente.observacoes,
      u.username,
      cleanId
    ]);

    if (res && res.rows && res.rows.length > 0) {
      dealAtualizado = mapDealRow(res.rows[0]);
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao atualizar deal #${cleanId} no Postgres:`, err.message);
  }

  // 2. Atualiza no cache local
  const cache = await readCache();
  const idx = cache.deals.findIndex(d => String(d.id) === cleanId);
  if (idx !== -1) {
    const transpCodAtual = dados.transportadora_cod !== undefined ? dados.transportadora_cod : (
      dados.transportadoraCod !== undefined ? dados.transportadoraCod : cache.deals[idx].transportadora_cod || ''
    );
    if (!dealAtualizado) {
      dealAtualizado = {
        ...cache.deals[idx],
        ...dados,
        custom: customAtual,
        valor_total: valorTotal,
        estagio: estagioNovo,
        cod_vendedor: codVendedor,
        nome_vendedor: nomeVendedor,
        frete_cobrado: freteCobrado,
        frete_embutido: freteEmbutido,
        transportadora_cod: transpCodAtual,
        itens_cotados: itensCotados,
        historico_estagios: historicoEstagios,
        updated_by: u.username,
        updated_at: new Date().toISOString()
      };
      cache.deals[idx] = dealAtualizado;
    } else {
      dealAtualizado.transportadora_cod = transpCodAtual;
      cache.deals[idx] = dealAtualizado;
    }
    await writeCache(cache);
  }

  // 3. Telemetria
  await recordTelemetry(u, 'CRM_ATUALIZAR_DEAL', `Atualizou os dados do negócio #${cleanId} ("${dealAtualizado?.titulo}")`, {
    dealId: cleanId,
    estagio: dealAtualizado?.estagio,
    valorTotal: dealAtualizado?.valor_total
  });

  return dealAtualizado || existente;
}

/**
 * 5. ATUALIZAR ESTÁGIO DO DEAL (PIPELINE KANBAN)
 */
async function atualizarEstagioDeal(id, novoEstagio, usuario, justificativa = '', motivoPerda = '') {
  const u = normalizeUser(usuario);
  const cleanId = String(id).trim();
  const stageLimpo = String(novoEstagio || '').trim().toLowerCase();

  if (!stageLimpo) {
    throw new Error("O parâmetro 'novoEstagio' é obrigatório.");
  }

  if (!CANONICAL_STAGES.includes(stageLimpo)) {
    throw new Error(`Estágio '${novoEstagio}' inválido. Estágios permitidos: ${CANONICAL_STAGES.join(', ')}.`);
  }

  const existente = await obterDealPorId(cleanId);
  if (!existente) {
    const err = new Error(`Negócio #${cleanId} não localizado.`);
    err.status = 404;
    err.code = 'DEAL_NOT_FOUND';
    throw err;
  }

  let status = 'aberto';
  let probabilidade = existente.probabilidade;
  let dataFechamentoReal = null;

  if (stageLimpo === 'ganho') {
    status = 'ganho';
    probabilidade = 100.00;
    dataFechamentoReal = new Date().toISOString();
  } else if (stageLimpo === 'perdido') {
    status = 'perdido';
    probabilidade = 0.00;
    dataFechamentoReal = new Date().toISOString();
  } else if (stageLimpo === 'negociacao') {
    probabilidade = 80.00;
  } else if (stageLimpo === 'proposta') {
    probabilidade = 50.00;
  } else if (stageLimpo === 'contato') {
    probabilidade = 30.00;
  } else if (stageLimpo === 'lead') {
    probabilidade = 20.00;
  }

  const historicoEstagios = Array.isArray(existente.historico_estagios) ? [...existente.historico_estagios] : [];
  historicoEstagios.push({
    estagio_anterior: existente.estagio,
    estagio_novo: stageLimpo,
    alterado_por: u.username,
    alterado_em: new Date().toISOString(),
    justificativa: justificativa || `Transição de estágio para ${stageLimpo}`
  });

  let dealAtualizado = null;

  // 1. Tenta Postgres
  try {
    const res = await safeQuery(`
      UPDATE crm_deals SET
        estagio = $1,
        status = $2,
        probabilidade = $3,
        data_fechamento_real = $4,
        motivo_perda = COALESCE($5, motivo_perda),
        historico_estagios = $6,
        updated_by = $7,
        updated_at = NOW()
      WHERE id = $8 AND ativo = TRUE
      RETURNING *;
    `, [
      stageLimpo,
      status,
      probabilidade,
      dataFechamentoReal,
      motivoPerda || null,
      JSON.stringify(historicoEstagios),
      u.username,
      cleanId
    ]);

    if (res && res.rows && res.rows.length > 0) {
      dealAtualizado = mapDealRow(res.rows[0]);
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao mudar estágio do deal #${cleanId} no Postgres:`, err.message);
  }

  // 2. Atualiza no cache local
  const cache = await readCache();
  const idx = cache.deals.findIndex(d => String(d.id) === cleanId);
  if (idx !== -1) {
    if (!dealAtualizado) {
      dealAtualizado = {
        ...cache.deals[idx],
        estagio: stageLimpo,
        status,
        probabilidade,
        data_fechamento_real: dataFechamentoReal,
        motivo_perda: motivoPerda || cache.deals[idx].motivo_perda,
        historico_estagios: historicoEstagios,
        updated_by: u.username,
        updated_at: new Date().toISOString()
      };
      cache.deals[idx] = dealAtualizado;
    } else {
      cache.deals[idx] = dealAtualizado;
    }
    await writeCache(cache);
  }

  // 3. Telemetria
  await recordTelemetry(u, 'CRM_MUDAR_ESTAGIO', `Moveu o negócio #${cleanId} de "${existente.estagio}" para "${stageLimpo}"`, {
    dealId: cleanId,
    estagioAnterior: existente.estagio,
    estagioNovo: stageLimpo,
    justificativa,
    motivoPerda
  });

  return dealAtualizado || existente;
}

/**
 * 6. EXCLUIR DEAL (SOFT DELETE)
 */
async function excluirDeal(id, usuario) {
  const u = normalizeUser(usuario);
  const cleanId = String(id).trim();

  const existente = await obterDealPorId(cleanId);
  if (!existente) {
    const err = new Error(`Negócio #${cleanId} não localizado para exclusão.`);
    err.status = 404;
    err.code = 'DEAL_NOT_FOUND';
    throw err;
  }

  // 1. Tenta Postgres
  try {
    await safeQuery(`
      UPDATE crm_deals SET
        ativo = FALSE,
        deleted_at = NOW(),
        updated_by = $1,
        updated_at = NOW()
      WHERE id = $2;
    `, [u.username, cleanId]);
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro no soft delete do deal #${cleanId} no Postgres:`, err.message);
  }

  // 2. Atualiza Cache Local
  const cache = await readCache();
  const idx = cache.deals.findIndex(d => String(d.id) === cleanId);
  if (idx !== -1) {
    cache.deals[idx].ativo = false;
    cache.deals[idx].deleted_at = new Date().toISOString();
    cache.deals[idx].updated_by = u.username;
    cache.deals[idx].updated_at = new Date().toISOString();
    await writeCache(cache);
  }

  // 3. Telemetria
  await recordTelemetry(u, 'CRM_EXCLUIR_DEAL', `Excluiu (soft delete) a oportunidade #${cleanId} ("${existente.titulo}")`, {
    dealId: cleanId,
    titulo: existente.titulo
  });

  return { success: true, id: cleanId, message: 'Oportunidade removida com sucesso.' };
}

/**
 * 7. RESTAURAR DEAL
 */
async function restaurarDeal(id, usuario) {
  const u = normalizeUser(usuario);
  const cleanId = String(id).trim();

  let dealRestaurado = null;

  // 1. Tenta Postgres
  try {
    const res = await safeQuery(`
      UPDATE crm_deals SET
        ativo = TRUE,
        deleted_at = NULL,
        updated_by = $1,
        updated_at = NOW()
      WHERE id = $2 RETURNING *;
    `, [u.username, cleanId]);
    if (res && res.rows && res.rows.length > 0) {
      dealRestaurado = mapDealRow(res.rows[0]);
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao restaurar deal #${cleanId} no Postgres:`, err.message);
  }

  // 2. Atualiza Cache Local
  const cache = await readCache();
  const idx = cache.deals.findIndex(d => String(d.id) === cleanId);
  if (idx !== -1) {
    cache.deals[idx].ativo = true;
    cache.deals[idx].deleted_at = null;
    cache.deals[idx].updated_by = u.username;
    cache.deals[idx].updated_at = new Date().toISOString();
    dealRestaurado = cache.deals[idx];
    await writeCache(cache);
  }

  if (!dealRestaurado) {
    const err = new Error(`Negócio #${cleanId} não localizado para restauração.`);
    err.status = 404;
    err.code = 'DEAL_NOT_FOUND';
    throw err;
  }

  await recordTelemetry(u, 'CRM_RESTAURAR_DEAL', `Restaurou o negócio #${cleanId} ("${dealRestaurado.titulo}")`, {
    dealId: cleanId
  });

  return dealRestaurado;
}

/**
 * 8. LISTAR ATIVIDADES DO DEAL
 */
async function listarAtividadesDeal(dealId) {
  if (!dealId) return [];
  const cleanDealId = String(dealId).trim();
  let atividades = [];
  let fromDb = false;

  // 1. Tenta Postgres
  try {
    const res = await safeQuery(`
      SELECT * FROM crm_atividades 
      WHERE deal_id = $1 
      ORDER BY created_at DESC, id DESC;
    `, [cleanDealId]);

    if (res && Array.isArray(res.rows)) {
      atividades = res.rows.map(mapAtividadeRow);
      fromDb = true;
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao listar atividades do deal #${cleanDealId} no Postgres:`, err.message);
  }

  // 2. Fallback Cache Local
  if (!fromDb) {
    const cache = await readCache();
    atividades = (cache.atividades || [])
      .filter(a => String(a.deal_id) === cleanDealId)
      .sort((a, b) => {
        const diff = new Date(b.created_at || 0) - new Date(a.created_at || 0);
        if (diff !== 0) return diff;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }

  return atividades;
}

/**
 * 9. CRIAR ATIVIDADE DO DEAL
 */
async function criarAtividadeDeal(dealId, dados, usuario) {
  const u = normalizeUser(usuario);
  const cleanDealId = String(dealId).trim();

  const deal = await obterDealPorId(cleanDealId);
  if (!deal) {
    const err = new Error(`Negócio #${cleanDealId} não localizado.`);
    err.status = 404;
    err.code = 'DEAL_NOT_FOUND';
    throw err;
  }

  if (!dados || !dados.tipo || (!dados.assunto && !dados.titulo)) {
    throw new Error("Os campos 'tipo' e 'assunto' são obrigatórios.");
  }

  const tipo = String(dados.tipo).trim().toLowerCase();
  const assunto = String(dados.assunto || dados.titulo).trim();
  const descricao = dados.descricao ? String(dados.descricao).trim() : '';
  const dataAgendada = dados.data_agendada || null;
  const status = dados.status ? String(dados.status).trim().toLowerCase() : 'pendente';
  const prioridade = dados.prioridade ? String(dados.prioridade).trim().toLowerCase() : 'media';
  const respUser = dados.responsavel_usuario ? String(dados.responsavel_usuario).trim().toLowerCase() : u.username;
  const respNome = dados.responsavel_nome ? String(dados.responsavel_nome).trim() : u.name;
  const custom = typeof dados.custom === 'object' && dados.custom !== null ? dados.custom : {};
  const atividadeId = 'ACT-' + Date.now() + '-' + Math.floor(Math.random() * 8999 + 1000);

  let novaAtividade = null;

  // 1. Tenta Postgres
  try {
    const res = await safeQuery(`
      INSERT INTO crm_atividades (
        id, deal_id, tipo, assunto, descricao, data_agendada, status, prioridade,
        responsavel_usuario, responsavel_nome, custom, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, NOW(), NOW()
      ) RETURNING *;
    `, [
      atividadeId,
      cleanDealId,
      tipo,
      assunto,
      descricao,
      dataAgendada,
      status,
      prioridade,
      respUser,
      respNome,
      JSON.stringify(custom),
      u.username
    ]);

    if (res && res.rows && res.rows.length > 0) {
      novaAtividade = mapAtividadeRow(res.rows[0]);
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao gravar atividade no Postgres. Usando fallback atômico:`, err.message);
  }

  // 2. Fallback Cache Local
  if (!novaAtividade) {
    const cache = await readCache();
    novaAtividade = {
      id: atividadeId,
      deal_id: cleanDealId,
      tipo,
      assunto,
      descricao,
      data_agendada: dataAgendada,
      data_concluida: null,
      status,
      prioridade,
      responsavel_usuario: respUser,
      responsavel_nome: respNome,
      custom,
      created_by: u.username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    cache.atividades.unshift(novaAtividade);
    await writeCache(cache);
  }

  // 3. Atualiza Deal.updated_at para refletir atividade recente
  try {
    await safeQuery('UPDATE crm_deals SET updated_at = NOW(), updated_by = $1 WHERE id = $2;', [u.username, cleanDealId]);
  } catch {}

  // 4. Telemetria
  await recordTelemetry(u, 'CRM_REGISTRAR_ATIVIDADE', `Registrou atividade (${tipo.toUpperCase()}: "${assunto}") no negócio #${cleanDealId}`, {
    dealId: cleanDealId,
    tipo,
    assunto
  });

  return novaAtividade;
}

/**
 * 10. SALVAR CLIENTE (CRIAÇÃO OU EDIÇÃO)
 */
async function salvarCliente(dados, usuario) {
  const u = normalizeUser(usuario);
  const nomeRazao = String(dados?.nome_razao || '').trim();

  if (!nomeRazao) {
    const err = new Error("O campo 'nome_razao' é obrigatório.");
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const cleanId = dados.id ? String(dados.id).trim() : '';
  const isEspelhamento = Boolean(dados.is_espelhamento);
  const isEdicao = !!cleanId && !isEspelhamento;

  if (isEdicao) {
    const clienteExistente = await obterClientePorId(cleanId);
    if (!clienteExistente) {
      const err = new Error(`Cliente #${cleanId} não encontrado para edição.`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
  }

  const clienteId = cleanId || ('CLI-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 899 + 100).toString(36));

  const cnpjLimpo = dados.cnpj_cpf ? String(dados.cnpj_cpf).replace(/\D/g, '').slice(0, 20) : '';
  const tipoPessoa = (dados.tipo_pessoa || (cnpjLimpo.length === 11 ? 'PF' : 'PJ')).toUpperCase().slice(0, 2);
  const tipoClienteProtheus = dados.tipo_cliente_protheus ? String(dados.tipo_cliente_protheus).trim().toUpperCase().slice(0, 2) : 'F';
  const nomeFantasia = dados.nome_fantasia ? String(dados.nome_fantasia).trim() : '';
  const ie = dados.ie ? String(dados.ie).trim() : '';
  const contatoNome = dados.contato_nome ? String(dados.contato_nome).trim() : '';
  const telefone = dados.telefone ? String(dados.telefone).trim() : '';
  const celularWhatsapp = dados.celular_whatsapp ? String(dados.celular_whatsapp).trim() : '';
  const email = dados.email ? String(dados.email).trim().toLowerCase() : '';
  const siteUrl = normalizarSiteUrl(dados.site_url);
  const emailNfe = dados.email_nfe ? String(dados.email_nfe).trim().toLowerCase() : '';
  const emailBoleto = dados.email_boleto ? String(dados.email_boleto).trim().toLowerCase() : '';
  const contatoFinNome = dados.contato_financeiro_nome ? String(dados.contato_financeiro_nome).trim() : '';
  const contatoFinTel = dados.contato_financeiro_tel ? String(dados.contato_financeiro_tel).trim() : '';
  const contatoFinEmail = dados.contato_financeiro_email ? String(dados.contato_financeiro_email).trim().toLowerCase() : '';
  const cep = dados.cep ? String(dados.cep).trim().replace(/\D/g, '') : '';
  const logradouro = dados.logradouro ? String(dados.logradouro).trim() : '';
  const numero = dados.numero ? String(dados.numero).trim() : '';
  const complemento = dados.complemento ? String(dados.complemento).trim() : '';
  const bairro = dados.bairro ? String(dados.bairro).trim() : '';
  const cidade = dados.cidade ? String(dados.cidade).trim() : '';
  const uf = dados.uf ? String(dados.uf).trim().toUpperCase().slice(0, 2) : '';
  const origem = dados.origem ? String(dados.origem).trim().toUpperCase() : 'OUTRO';
  const vendedorResp = dados.vendedor_responsavel ? String(dados.vendedor_responsavel).trim() : '';
  const protheusCod = dados.protheus_cod ? String(dados.protheus_cod).trim() : '';
  const protheusLoja = dados.protheus_loja ? String(dados.protheus_loja).trim() : '01';
  const observacoes = dados.observacoes ? String(dados.observacoes).trim() : '';

  let clienteSalvo = null;

  // 1. Tenta Supabase Postgres
  try {
    if (isEdicao) {
      const res = await safeQuery(`
        UPDATE crm_clientes SET
          tipo_pessoa = $1,
          nome_razao = $2,
          nome_fantasia = $3,
          cnpj_cpf = $4,
          ie = $5,
          contato_nome = $6,
          telefone = $7,
          celular_whatsapp = $8,
          email = $9,
          cep = $10,
          logradouro = $11,
          numero = $12,
          complemento = $13,
          bairro = $14,
          cidade = $15,
          uf = $16,
          origem = $17,
          vendedor_responsavel = $18,
          protheus_cod = $19,
          protheus_loja = $20,
          observacoes = $21,
          tipo_cliente_protheus = $22,
          site_url = $23,
          email_nfe = $24,
          email_boleto = $25,
          contato_financeiro_nome = $26,
          contato_financeiro_tel = $27,
          contato_financeiro_email = $28,
          updated_at = NOW()
        WHERE id = $29 AND deleted_at IS NULL
        RETURNING *;
      `, [
        tipoPessoa, nomeRazao, nomeFantasia, cnpjLimpo, ie,
        contatoNome, telefone, celularWhatsapp, email, cep,
        logradouro, numero, complemento, bairro, cidade, uf,
        origem, vendedorResp, protheusCod, protheusLoja, observacoes,
        tipoClienteProtheus, siteUrl, emailNfe, emailBoleto,
        contatoFinNome, contatoFinTel, contatoFinEmail,
        clienteId
      ]);
      if (res && res.rows && res.rows.length > 0) {
        clienteSalvo = mapClienteRow(res.rows[0]);
      }
    } else {
      const res = await safeQuery(`
        INSERT INTO crm_clientes (
          id, tipo_pessoa, nome_razao, nome_fantasia, cnpj_cpf, ie,
          contato_nome, telefone, celular_whatsapp, email, cep,
          logradouro, numero, complemento, bairro, cidade, uf,
          origem, vendedor_responsavel, protheus_cod, protheus_loja,
          observacoes, tipo_cliente_protheus, site_url, email_nfe, email_boleto,
          contato_financeiro_nome, contato_financeiro_tel, contato_financeiro_email,
          created_at, updated_at, deleted_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29,
          NOW(), NOW(), NULL
        )
        ON CONFLICT (id) DO UPDATE SET
          tipo_pessoa = EXCLUDED.tipo_pessoa,
          nome_razao = EXCLUDED.nome_razao,
          nome_fantasia = EXCLUDED.nome_fantasia,
          cnpj_cpf = EXCLUDED.cnpj_cpf,
          updated_at = NOW()
        RETURNING *;
      `, [
        clienteId, tipoPessoa, nomeRazao, nomeFantasia, cnpjLimpo, ie,
        contatoNome, telefone, celularWhatsapp, email, cep,
        logradouro, numero, complemento, bairro, cidade, uf,
        origem, vendedorResp, protheusCod, protheusLoja, observacoes,
        tipoClienteProtheus, siteUrl, emailNfe, emailBoleto,
        contatoFinNome, contatoFinTel, contatoFinEmail
      ]);
      if (res && res.rows && res.rows.length > 0) {
        clienteSalvo = mapClienteRow(res.rows[0]);
      }
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao salvar cliente #${clienteId} no Postgres:`, err.message);
  }

  // 2. Cache Local / Fallback Atômico
  const cache = await readClientesCache();
  const idx = cache.clientes.findIndex(c => String(c.id) === clienteId);

  if (!clienteSalvo) {
    clienteSalvo = {
      id: clienteId,
      tipo_pessoa: tipoPessoa,
      tipo_cliente_protheus: tipoClienteProtheus,
      nome_razao: nomeRazao,
      nome_fantasia: nomeFantasia,
      cnpj_cpf: cnpjLimpo,
      cnpj_cpf_fmt: formatarCgc(cnpjLimpo),
      ie,
      contato_nome: contatoNome,
      telefone,
      telefone_fmt: formatarTelefone(telefone),
      celular_whatsapp: celularWhatsapp,
      celular_whatsapp_fmt: formatarTelefone(celularWhatsapp),
      email,
      site_url: siteUrl,
      email_nfe: emailNfe,
      email_boleto: emailBoleto,
      contato_financeiro_nome: contatoFinNome,
      contato_financeiro_tel: contatoFinTel,
      contato_financeiro_tel_fmt: formatarTelefone(contatoFinTel),
      contato_financeiro_email: contatoFinEmail,
      cep,
      logradouro,
      numero,
      complemento,
      bairro,
      cidade,
      uf,
      origem,
      vendedor_responsavel: vendedorResp,
      protheus_cod: protheusCod,
      protheus_loja: protheusLoja,
      observacoes,
      created_at: (idx !== -1 && cache.clientes[idx].created_at) ? cache.clientes[idx].created_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null
    };
  }

  if (idx !== -1) {
    cache.clientes[idx] = clienteSalvo;
  } else {
    cache.clientes.unshift(clienteSalvo);
  }
  await writeClientesCache(cache);

  // 3. Telemetria
  const actionType = isEdicao ? 'EDICAO_CRM_CLIENTE' : 'CADASTRO_CRM_CLIENTE';
  const desc = isEdicao
    ? `Atualizou o cadastro do cliente comercial #${clienteId} ("${clienteSalvo.nome_razao}")`
    : `Cadastrou o novo cliente comercial #${clienteId} ("${clienteSalvo.nome_razao}")`;

  await recordTelemetry(u, actionType, desc, {
    clienteId,
    nomeRazao: clienteSalvo.nome_razao,
    cnpjCpf: clienteSalvo.cnpj_cpf,
    vendedor: clienteSalvo.vendedor_responsavel
  });

  return clienteSalvo;
}

/**
 * 11. LISTAR CLIENTES (PAGINADO)
 */
async function listarClientes(filtros = {}) {
  const { busca, vendedor, order } = filtros;
  const limit = Math.min(Math.max(parseInt(filtros.limit, 10) || 50, 1), 200);
  let page = parseInt(filtros.page, 10);
  let offset = parseInt(filtros.offset, 10);

  if (!isNaN(page) && page >= 1) {
    offset = (page - 1) * limit;
  } else {
    offset = (!isNaN(offset) && offset >= 0) ? offset : 0;
    page = Math.floor(offset / limit) + 1;
  }

  let items = [];
  let total = 0;
  let fromDb = false;

  try {
    const params = [];
    let whereClause = 'WHERE deleted_at IS NULL';

    if (vendedor && vendedor !== 'TODOS') {
      params.push(String(vendedor).trim());
      whereClause += ` AND (vendedor_responsavel = $${params.length} OR protheus_cod = $${params.length})`;
    }

    if (busca && String(busca).trim()) {
      const b = `%${String(busca).trim().toLowerCase()}%`;
      const digitsOnly = String(busca).replace(/\D/g, '');
      params.push(b);
      const bIdx = params.length;
      let cnpjFilter = '';
      if (digitsOnly.length >= 3) {
        params.push(`%${digitsOnly}%`);
        cnpjFilter = ` OR cnpj_cpf LIKE $${params.length}`;
      }
      whereClause += ` AND (
        LOWER(nome_razao) LIKE $${bIdx}
        OR LOWER(COALESCE(nome_fantasia, '')) LIKE $${bIdx}
        OR LOWER(COALESCE(email, '')) LIKE $${bIdx}
        OR LOWER(COALESCE(cidade, '')) LIKE $${bIdx}
        OR LOWER(COALESCE(contato_nome, '')) LIKE $${bIdx}
        OR LOWER(COALESCE(protheus_cod, '')) LIKE $${bIdx}
        ${cnpjFilter}
      )`;
    }

    // Contagem total
    const countRes = await safeQuery(`SELECT COUNT(*) as total FROM crm_clientes ${whereClause};`, params);
    if (countRes && countRes.rows && countRes.rows.length > 0) {
      total = parseInt(countRes.rows[0].total, 10) || 0;
    }

    // Ordenação
    let orderBy = 'updated_at DESC, id DESC';
    if (order) {
      const ordClean = String(order).trim().toLowerCase();
      if (ordClean === 'nome_asc') orderBy = 'nome_razao ASC';
      else if (ordClean === 'nome_desc') orderBy = 'nome_razao DESC';
      else if (ordClean === 'created_desc') orderBy = 'created_at DESC';
      else if (ordClean === 'created_asc') orderBy = 'created_at ASC';
    }

    // Consulta paginada
    const listParams = [...params, limit, offset];
    const dataRes = await safeQuery(`
      SELECT * FROM crm_clientes
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length};
    `, listParams);

    if (dataRes && Array.isArray(dataRes.rows)) {
      items = dataRes.rows.map(mapClienteRow);
      fromDb = true;
    }
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Erro ao listar clientes no Postgres. Recorrendo ao cache local:', err.message);
  }

  // Fallback em Cache Local
  if (!fromDb) {
    const cache = await readClientesCache();
    let filtrados = (cache.clientes || []).filter(c => !c.deleted_at);

    if (vendedor && vendedor !== 'TODOS') {
      const v = String(vendedor).trim();
      filtrados = filtrados.filter(c => c.vendedor_responsavel === v || c.protheus_cod === v);
    }

    if (busca && String(busca).trim()) {
      const b = String(busca).trim().toLowerCase();
      const digitsOnly = b.replace(/\D/g, '');
      filtrados = filtrados.filter(c => 
        (c.nome_razao && c.nome_razao.toLowerCase().includes(b)) ||
        (c.nome_fantasia && c.nome_fantasia.toLowerCase().includes(b)) ||
        (c.email && c.email.toLowerCase().includes(b)) ||
        (c.cidade && c.cidade.toLowerCase().includes(b)) ||
        (c.contato_nome && c.contato_nome.toLowerCase().includes(b)) ||
        (c.protheus_cod && c.protheus_cod.toLowerCase().includes(b)) ||
        (digitsOnly.length >= 3 && c.cnpj_cpf && c.cnpj_cpf.includes(digitsOnly))
      );
    }

    total = filtrados.length;
    if (order === 'nome_asc') {
      filtrados.sort((a, b) => (a.nome_razao || '').localeCompare(b.nome_razao || ''));
    } else if (order === 'nome_desc') {
      filtrados.sort((a, b) => (b.nome_razao || '').localeCompare(a.nome_razao || ''));
    } else if (order === 'created_asc') {
      filtrados.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    } else {
      filtrados.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    }
    items = filtrados.slice(offset, offset + limit).map(mapClienteRow);
  }

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    items,
    pagination: {
      total,
      limit,
      offset,
      page,
      totalPages
    }
  };
}

/**
 * 13. RESTAURAR CLIENTE (REVERSIBILIDADE DE SOFT DELETE)
 */
async function restaurarCliente(id, usuario) {
  const u = normalizeUser(usuario);
  const cleanId = String(id).trim();

  let clienteRestaurado = null;

  // 1. Tenta Postgres
  try {
    const res = await safeQuery(`
      UPDATE crm_clientes
      SET deleted_at = NULL, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING *;
    `, [cleanId]);
    if (res && res.rows && res.rows.length > 0) {
      clienteRestaurado = mapClienteRow(res.rows[0]);
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao restaurar cliente #${cleanId} no Postgres:`, err.message);
  }

  // 2. Atualiza Cache Local
  const cache = await readClientesCache();
  const idx = cache.clientes.findIndex(c => String(c.id) === cleanId);
  if (idx !== -1) {
    cache.clientes[idx].deleted_at = null;
    cache.clientes[idx].updated_at = new Date().toISOString();
    clienteRestaurado = cache.clientes[idx];
    await writeClientesCache(cache);
  }

  if (!clienteRestaurado) {
    const err = new Error(`Cliente #${cleanId} não encontrado para restauração.`);
    err.status = 404;
    err.code = 'CLIENTE_NOT_FOUND';
    throw err;
  }

  // 3. Telemetria
  await recordTelemetry(u, 'RESTAURACAO_CRM_CLIENTE', `Restaurou o cliente comercial #${cleanId} ("${clienteRestaurado.nome_razao}")`, {
    clienteId: cleanId,
    nomeRazao: clienteRestaurado.nome_razao,
    cnpjCpf: clienteRestaurado.cnpj_cpf
  });

  return clienteRestaurado;
}

/**
 * 12. OBTER CLIENTE POR ID OU CÓDIGO PROTHEUS (COM ESPELHAMENTO JUST-IN-TIME)
 */
async function obterClientePorId(id) {
  if (!id || !String(id).trim()) return null;
  const cleanId = String(id).trim();
  const digitsOnly = cleanId.replace(/\D/g, '');
  const cleanTerm = sanitizeSqlParam(cleanId).replace(/[\[\]]/g, '');
  const paddedCod = /^\d+$/.test(cleanTerm) && cleanTerm.length <= 6 ? cleanTerm.padStart(6, '0') : cleanTerm;

  // 1. Tenta Postgres (busca por ID primário, protheus_cod exato ou com pad 6 dígitos, ou CNPJ)
  try {
    let query = `
      SELECT * FROM crm_clientes
      WHERE deleted_at IS NULL
        AND (id = $1 OR protheus_cod = $1 OR protheus_cod = $2
    `;
    const params = [cleanId, paddedCod];
    if (digitsOnly.length >= 11) {
      params.push(digitsOnly);
      query += ` OR cnpj_cpf = $${params.length}`;
    }
    query += `) ORDER BY updated_at DESC LIMIT 1;`;

    const res = await safeQuery(query, params);
    if (res && res.rows && res.rows.length > 0) {
      return mapClienteRow(res.rows[0]);
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao buscar cliente #${cleanId} no Postgres:`, err.message);
  }

  // 2. Cache Local / Fallback Atômico
  try {
    const cache = await readClientesCache();
    const clienteLocal = (cache.clientes || []).find(c => {
      if (c.deleted_at) return false;
      if (String(c.id) === cleanId) return true;
      if (String(c.protheus_cod || '').trim() === cleanId) return true;
      if (String(c.protheus_cod || '').trim() === paddedCod) return true;
      if (digitsOnly.length >= 11 && String(c.cnpj_cpf || '').replace(/\D/g, '') === digitsOnly) return true;
      return false;
    });
    if (clienteLocal) return mapClienteRow(clienteLocal);
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao buscar cliente #${cleanId} no cache local:`, err.message);
  }

  // 3. Just-in-Time Mirroring: Se não está no super banco, consulta SA1010 no Protheus ERP
  try {
    const sql = `
      SELECT TOP 1
        RTRIM(A1_COD) AS A1_COD,
        RTRIM(ISNULL(A1_LOJA, '01')) AS A1_LOJA,
        RTRIM(A1_NOME) AS A1_NOME,
        RTRIM(ISNULL(A1_NREDUZ, '')) AS A1_NREDUZ,
        RTRIM(ISNULL(A1_CGC, '')) AS A1_CGC,
        RTRIM(ISNULL(A1_END, '')) AS A1_END,
        RTRIM(ISNULL(A1_BAIRRO, '')) AS A1_BAIRRO,
        RTRIM(ISNULL(A1_MUN, '')) AS A1_MUN,
        RTRIM(ISNULL(A1_EST, '')) AS A1_EST,
        RTRIM(ISNULL(A1_CEP, '')) AS A1_CEP,
        RTRIM(ISNULL(A1_TEL, '')) AS A1_TEL,
        RTRIM(ISNULL(A1_EMAIL, '')) AS A1_EMAIL,
        RTRIM(ISNULL(A1_CONTATO, '')) AS A1_CONTATO,
        RTRIM(ISNULL(A1_VEND, '')) AS A1_VEND,
        RTRIM(ISNULL(A1_HPAGE, '')) AS A1_HPAGE,
        RTRIM(ISNULL(A1_MAILNFE, '')) AS A1_MAILNFE,
        RTRIM(ISNULL(A1_MAILBOL, '')) AS A1_MAILBOL,
        RTRIM(ISNULL(A1_ZPESPAG, '')) AS A1_ZPESPAG,
        RTRIM(ISNULL(A1_ZTELPAG, '')) AS A1_ZTELPAG,
        RTRIM(ISNULL(A1_ZMAILPA, '')) AS A1_ZMAILPA,
        RTRIM(ISNULL(A1_TIPO, 'F')) AS A1_TIPO
      FROM SA1010
      WHERE D_E_L_E_T_ = ' '
        AND (
          A1_COD = '${cleanTerm}'
          OR A1_COD = '${paddedCod}'
          ${digitsOnly.length >= 11 ? `OR A1_CGC = '${digitsOnly}'` : ''}
        )
      ORDER BY A1_LOJA ASC;
    `;

    const res = await protheusDb.executeRailwayQuery(sql);
    if (res && Array.isArray(res.rows) && res.rows.length > 0) {
      const r = res.rows[0];
      const cod = (r.A1_COD || '').trim();
      const loja = (r.A1_LOJA || '01').trim();
      const cnpjLimpo = r.A1_CGC ? String(r.A1_CGC).replace(/\D/g, '') : '';
      const novoId = `CLI-PROTHEUS-${cod}-${loja}`;
      const nomeVendedorMapeado = (r.A1_VEND ? getNomeVendedor(r.A1_VEND) : '') || r.A1_VEND || '';

      const dadosParaSalvar = {
        id: novoId,
        is_espelhamento: true,
        tipo_pessoa: cnpjLimpo.length === 11 ? 'PF' : 'PJ',
        tipo_cliente_protheus: r.A1_TIPO || 'F',
        nome_razao: r.A1_NOME || '',
        nome_fantasia: r.A1_NREDUZ || '',
        cnpj_cpf: cnpjLimpo,
        ie: '',
        contato_nome: r.A1_CONTATO || '',
        telefone: r.A1_TEL || '',
        celular_whatsapp: '',
        email: r.A1_EMAIL || '',
        site_url: r.A1_HPAGE || '',
        email_nfe: r.A1_MAILNFE || '',
        email_boleto: r.A1_MAILBOL || '',
        contato_financeiro_nome: r.A1_ZPESPAG || '',
        contato_financeiro_tel: r.A1_ZTELPAG || '',
        contato_financeiro_email: r.A1_ZMAILPA || '',
        cep: r.A1_CEP || '',
        logradouro: r.A1_END || '',
        numero: '',
        complemento: '',
        bairro: r.A1_BAIRRO || '',
        cidade: r.A1_MUN || '',
        uf: r.A1_EST || '',
        origem: 'PROTHEUS',
        vendedor_responsavel: nomeVendedorMapeado,
        protheus_cod: cod,
        protheus_loja: loja,
        observacoes: 'Cliente espelhado automaticamente do ERP Protheus (SA1010).'
      };

      // Grava no super banco (crm_clientes) de forma atômica e resiliente
      const clienteEspelhado = await salvarCliente(dadosParaSalvar, { username: 'sistema', name: 'Sincronizador Protheus', role: 'admin' });
      return clienteEspelhado;
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao consultar SA1010 no Protheus para espelhamento:`, err.message);
  }

  return null;
}

/**
 * 13. EXCLUIR CLIENTE (SOFT DELETE)
 */
async function excluirCliente(id, usuario) {
  const u = normalizeUser(usuario);
  const cleanId = String(id).trim();

  const existente = await obterClientePorId(cleanId);
  if (!existente) {
    const err = new Error(`Cliente #${cleanId} não localizado para exclusão.`);
    err.status = 404;
    err.code = 'CLIENTE_NOT_FOUND';
    throw err;
  }

  // 1. Tenta Postgres
  try {
    await safeQuery('UPDATE crm_clientes SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1;', [cleanId]);
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro no soft delete do cliente #${cleanId} no Postgres:`, err.message);
  }

  // 2. Atualiza Cache Local
  const cache = await readClientesCache();
  const idx = cache.clientes.findIndex(c => String(c.id) === cleanId);
  if (idx !== -1) {
    cache.clientes[idx].deleted_at = new Date().toISOString();
    cache.clientes[idx].updated_at = new Date().toISOString();
    await writeClientesCache(cache);
  }

  // 3. Telemetria
  await recordTelemetry(u, 'EXCLUSAO_CRM_CLIENTE', `Excluiu o cliente comercial #${cleanId} ("${existente.nome_razao}")`, {
    clienteId: cleanId,
    nomeRazao: existente.nome_razao,
    cnpjCpf: existente.cnpj_cpf
  });

  return { success: true, id: cleanId, message: 'Cliente excluído com sucesso.' };
}

/**
 * 14. AUTOCOMPLETE DE CLIENTES (CRM_CLIENTES + PROTHEUS SA1010 + CACHE RESILIENTE)
 */
async function autocompleteClientes(termo) {
  if (!termo || String(termo).trim().length < 2) {
    return [];
  }

  // Sanitização estrita contra quebra de T-SQL (remove colchetes desbalanceados)
  const cleanTerm = sanitizeSqlParam(String(termo).trim()).replace(/[\[\]]/g, '');
  const digitsOnly = cleanTerm.replace(/\D/g, '');
  const termoLower = cleanTerm.toLowerCase();

  const clientesMap = new Map();

  // 1. Busca prioritária em crm_clientes (limite 10)
  try {
    let crmRows = [];
    const params = [`%${termoLower}%`];
    let query = `
      SELECT * FROM crm_clientes
      WHERE deleted_at IS NULL
        AND (
          LOWER(nome_razao) LIKE $1
          OR LOWER(COALESCE(nome_fantasia, '')) LIKE $1
    `;
    if (digitsOnly.length >= 3) {
      params.push(`%${digitsOnly}%`);
      query += ` OR cnpj_cpf LIKE $${params.length}`;
    }
    query += `) ORDER BY updated_at DESC LIMIT 10;`;

    const resCrm = await safeQuery(query, params);
    if (resCrm && Array.isArray(resCrm.rows) && resCrm.rows.length > 0) {
      crmRows = resCrm.rows;
    } else {
      // Fallback cache local se Postgres não retornar
      const cache = await readClientesCache();
      crmRows = (cache.clientes || []).filter(c => {
        if (c.deleted_at) return false;
        const n = (c.nome_razao || '').toLowerCase();
        const f = (c.nome_fantasia || '').toLowerCase();
        const doc = (c.cnpj_cpf || '').replace(/\D/g, '');
        return n.includes(termoLower) || f.includes(termoLower) || (digitsOnly.length >= 3 && doc.includes(digitsOnly));
      }).slice(0, 10);
    }

    for (const c of crmRows) {
      const cnpjLimpo = c.cnpj_cpf ? String(c.cnpj_cpf).replace(/\D/g, '') : '';
      const cod = (c.protheus_cod || c.id || '').trim();
      const key = cnpjLimpo && cnpjLimpo.length >= 11 ? cnpjLimpo : (cod || c.nome_razao);

      clientesMap.set(key, {
        id: c.id,
        cod: c.protheus_cod || c.id,
        loja: c.protheus_loja || '01',
        nome: c.nome_razao,
        nome_fantasia: c.nome_fantasia || '',
        cnpj: cnpjLimpo,
        cnpj_fmt: formatarCgc(cnpjLimpo),
        endereco: (c.logradouro ? (c.logradouro + (c.numero ? ', ' + c.numero : '')) : '') || '',
        logradouro: c.logradouro || '',
        numero: c.numero || '',
        complemento: c.complemento || '',
        bairro: c.bairro || '',
        cidade: c.cidade || '',
        uf: c.uf || '',
        cep: c.cep || '',
        telefone: c.telefone || '',
        telefone_fmt: formatarTelefone(c.telefone),
        celular_whatsapp: c.celular_whatsapp || '',
        celular_whatsapp_fmt: formatarTelefone(c.celular_whatsapp),
        email: c.email || '',
        site_url: c.site_url || '',
        email_nfe: c.email_nfe || '',
        email_boleto: c.email_boleto || '',
        contato_financeiro_nome: c.contato_financeiro_nome || '',
        contato_financeiro_tel: c.contato_financeiro_tel || '',
        contato_financeiro_tel_fmt: formatarTelefone(c.contato_financeiro_tel),
        contato_financeiro_email: c.contato_financeiro_email || '',
        tipo_cliente_protheus: c.tipo_cliente_protheus || 'F',
        contato: c.contato_nome || '',
        cod_vendedor: c.vendedor_responsavel || '',
        origem_fonte: 'CRM',
        is_novo_crm: true
      });
    }
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Erro ao buscar crm_clientes no autocomplete:', err.message);
  }

  // 2. Busca secundária em SA1010 do Protheus (limite 10)
  try {
    const sql = `
      SELECT TOP 10
        RTRIM(A1_COD) AS A1_COD,
        RTRIM(ISNULL(A1_LOJA, '01')) AS A1_LOJA,
        RTRIM(A1_NOME) AS A1_NOME,
        RTRIM(ISNULL(A1_NREDUZ, '')) AS A1_NREDUZ,
        RTRIM(ISNULL(A1_CGC, '')) AS A1_CGC,
        RTRIM(ISNULL(A1_END, '')) AS A1_END,
        RTRIM(ISNULL(A1_BAIRRO, '')) AS A1_BAIRRO,
        RTRIM(ISNULL(A1_MUN, '')) AS A1_MUN,
        RTRIM(ISNULL(A1_EST, '')) AS A1_EST,
        RTRIM(ISNULL(A1_CEP, '')) AS A1_CEP,
        RTRIM(ISNULL(A1_TEL, '')) AS A1_TEL,
        RTRIM(ISNULL(A1_EMAIL, '')) AS A1_EMAIL,
        RTRIM(ISNULL(A1_CONTATO, '')) AS A1_CONTATO,
        RTRIM(ISNULL(A1_VEND, '')) AS A1_VEND,
        RTRIM(ISNULL(A1_HPAGE, '')) AS A1_HPAGE,
        RTRIM(ISNULL(A1_MAILNFE, '')) AS A1_MAILNFE,
        RTRIM(ISNULL(A1_MAILBOL, '')) AS A1_MAILBOL,
        RTRIM(ISNULL(A1_ZPESPAG, '')) AS A1_ZPESPAG,
        RTRIM(ISNULL(A1_ZTELPAG, '')) AS A1_ZTELPAG,
        RTRIM(ISNULL(A1_ZMAILPA, '')) AS A1_ZMAILPA,
        RTRIM(ISNULL(A1_TIPO, 'F')) AS A1_TIPO
      FROM SA1010
      WHERE D_E_L_E_T_ = ' '
        AND (
          A1_NOME LIKE '%${cleanTerm}%' 
          OR A1_NREDUZ LIKE '%${cleanTerm}%' 
          OR A1_COD LIKE '%${cleanTerm}%' 
          ${digitsOnly.length >= 4 ? `OR A1_CGC LIKE '%${digitsOnly}%'` : ''}
        )
      ORDER BY A1_NOME ASC;
    `;

    const res = await protheusDb.executeRailwayQuery(sql);
    if (res && Array.isArray(res.rows) && res.rows.length > 0) {
      for (const r of res.rows) {
        const cnpjLimpo = r.A1_CGC ? String(r.A1_CGC).replace(/\D/g, '') : '';
        const cod = (r.A1_COD || '').trim();
        const key = cnpjLimpo && cnpjLimpo.length >= 11 ? cnpjLimpo : (cod || r.A1_NOME);

        // Se já existe no map vindo do CRM, prioriza o registro do CRM
        if (!clientesMap.has(key)) {
          clientesMap.set(key, {
            cod: r.A1_COD,
            loja: r.A1_LOJA || '01',
            nome: r.A1_NOME,
            nome_fantasia: r.A1_NREDUZ || '',
            cnpj: cnpjLimpo,
            cnpj_fmt: formatarCgc(cnpjLimpo),
            endereco: r.A1_END || '',
            bairro: r.A1_BAIRRO || '',
            cidade: r.A1_MUN || '',
            uf: r.A1_EST || '',
            cep: r.A1_CEP || '',
            telefone: r.A1_TEL || '',
            telefone_fmt: formatarTelefone(r.A1_TEL),
            email: r.A1_EMAIL || '',
            site_url: r.A1_HPAGE || '',
            email_nfe: r.A1_MAILNFE || '',
            email_boleto: r.A1_MAILBOL || '',
            contato_financeiro_nome: r.A1_ZPESPAG || '',
            contato_financeiro_tel: r.A1_ZTELPAG || '',
            contato_financeiro_tel_fmt: formatarTelefone(r.A1_ZTELPAG),
            contato_financeiro_email: r.A1_ZMAILPA || '',
            tipo_cliente_protheus: r.A1_TIPO || 'F',
            contato: r.A1_CONTATO || '',
            cod_vendedor: r.A1_VEND || '',
            origem_fonte: 'PROTHEUS'
          });
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Erro ao consultar SA1010 no Protheus. Tentando fallback local:', err.message);
    // Fallback histórico de análise de crédito se Protheus falhar
    try {
      const rawHist = await safeReadJson(analiseCreditoHistoryFile, []);
      if (Array.isArray(rawHist) && rawHist.length > 0) {
        for (const item of rawHist) {
          const nome = String(item.cliente_nome || item.nome_cliente || '').trim();
          const cnpj = String(item.cnpj || item.cliente_cnpj || '').replace(/\D/g, '');
          const cod = String(item.cliente_cod || item.codigo || '').trim();

          if (
            nome.toLowerCase().includes(termoLower) ||
            (digitsOnly && cnpj.includes(digitsOnly)) ||
            cod.toLowerCase().includes(termoLower)
          ) {
            const key = cnpj && cnpj.length >= 11 ? cnpj : (cod || nome);
            if (!clientesMap.has(key)) {
              clientesMap.set(key, {
                cod: cod || '999999',
                loja: '01',
                nome: nome || 'Cliente Sem Razão',
                nome_fantasia: nome,
                cnpj,
                cnpj_fmt: formatarCgc(cnpj),
                endereco: item.endereco || '',
                bairro: item.bairro || '',
                cidade: item.cidade || '',
                uf: item.uf || '',
                cep: item.cep || '',
                telefone: item.telefone || '',
                telefone_fmt: formatarTelefone(item.telefone),
                email: item.email || '',
                contato: '',
                cod_vendedor: item.cod_vendedor || '',
                origem_fonte: 'PROTHEUS'
              });
            }
          }
          if (clientesMap.size >= 15) break;
        }
      }
    } catch {}
  }

  // Retorna até 15 resultados mesclados enriquecidos com fidelidade de compras
  const results = Array.from(clientesMap.values()).slice(0, 15);
  for (const c of results) {
    const cgc = c.cnpj || c.cnpj_cpf || '';
    c.fidelidade_compras = obterFidelidadeRaizSync(cgc);
  }
  return results;
}

const cepCache = new Map();

/**
 * Consulta endereço a partir do CEP via ViaCEP com cache em memória
 * Preenche Logradouro, Bairro, Cidade e UF (sem número e sem complemento)
 * @param {string} cepParam 
 * @returns {Promise<object>} Endereço normalizado
 */
async function consultarCep(cepParam) {
  const cepDigits = String(cepParam || '').replace(/\D/g, '').slice(0, 8);
  if (cepDigits.length !== 8) {
    const err = new Error('CEP deve conter exatamente 8 dígitos numéricos.');
    err.status = 400;
    err.code = 'INVALID_CEP';
    throw err;
  }

  if (cepCache.has(cepDigits)) {
    return cepCache.get(cepDigits);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`ViaCEP retornou status ${res.status}`);
    }

    const data = await res.json();
    if (data.erro === true || data.erro === 'true') {
      const err = new Error(`CEP ${cepDigits} não foi localizado na base postal.`);
      err.status = 404;
      err.code = 'CEP_NOT_FOUND';
      throw err;
    }

    const cepFmt = `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}`;
    const resultado = {
      cep: cepFmt,
      cep_raw: cepDigits,
      logradouro: (data.logradouro || '').trim(),
      bairro: (data.bairro || '').trim(),
      cidade: (data.localidade || '').trim(),
      uf: (data.uf || '').trim().toUpperCase(),
      ibge: (data.ibge || '').trim(),
      ddd: (data.ddd || '').trim()
    };

    cepCache.set(cepDigits, resultado);
    return resultado;
  } catch (err) {
    if (err.code === 'CEP_NOT_FOUND' || err.code === 'INVALID_CEP') throw err;
    console.error(`❌ [CRM] Erro ao consultar CEP ${cepDigits}:`, err.message);
    const wrapErr = new Error(`Não foi possível consultar o CEP no momento: ${err.message}`);
    wrapErr.status = 502;
    wrapErr.code = 'CEP_SERVICE_UNAVAILABLE';
    throw wrapErr;
  }
}

/**
 * 15. SINCRONIZAÇÃO DE PRODUTOS DO PROTHEUS (SB1090/SB1160 -> CRM_PRODUTOS + CACHE)
 */
async function sincronizarProdutosCrmProtheus({ triggeredBy = 'MANUAL' } = {}) {
  const inicioMs = Date.now();
  console.log(`🔄 [CRM Produtos Sync] Iniciando sincronização do catálogo Protheus disparada por "${triggeredBy}"...`);

  const sb1Tables = ['SB1090', 'SB1160'];
  const produtosMap = new Map();

  for (const table of sb1Tables) {
    try {
      const sql = `
        SELECT 
          RTRIM(B1_COD) AS B1_COD,
          RTRIM(B1_DESC) AS B1_DESC,
          RTRIM(ISNULL(B1_POSIPI, '')) AS B1_POSIPI,
          RTRIM(ISNULL(B1_UM, 'UN')) AS B1_UM,
          RTRIM(ISNULL(B1_TIPO, 'PA')) AS B1_TIPO,
          RTRIM(ISNULL(B1_GRUPO, '')) AS B1_GRUPO,
          ISNULL(B1_PRV1, 0) AS B1_PRV1,
          ISNULL(B1_PESO, 0) AS B1_PESO,
          ISNULL(B1_PESBRU, 0) AS B1_PESBRU,
          ISNULL(B1_IPI, 0) AS B1_IPI,
          RTRIM(ISNULL(B1_MSBLQL, '')) AS B1_MSBLQL
        FROM ${table}
        WHERE D_E_L_E_T_ = ' '
        ORDER BY B1_COD ASC;
      `;

      const res = await protheusDb.executeRailwayQuery(sql);
      if (res && Array.isArray(res.rows) && res.rows.length > 0) {
        for (const r of res.rows) {
          const cod = String(r.B1_COD || '').trim();
          if (!cod || cod.length < 2 || cod.toLowerCase() === 'null' || cod.toLowerCase() === 'undefined') {
            continue;
          }

          const desc = String(r.B1_DESC || '').trim() || cod;
          const ncm = String(r.B1_POSIPI || '').trim();
          const unidade = String(r.B1_UM || 'UN').trim() || 'UN';
          const tipo = String(r.B1_TIPO || 'PA').trim() || 'PA';
          const grupo = String(r.B1_GRUPO || '').trim();
          const preco = Number(r.B1_PRV1) || 0.00;
          const pesoLiq = Number(r.B1_PESO) || 0.0000;
          const pesoBru = Number(r.B1_PESBRU) || 0.0000;
          const ipi = Number(r.B1_IPI) || 0.00;
          const bloqueado = ['1', 'S', 's'].includes(String(r.B1_MSBLQL || '').trim());

          if (!produtosMap.has(cod)) {
            produtosMap.set(cod, {
              codigo: cod,
              descricao: desc,
              ncm,
              unidade,
              tipo,
              grupo,
              preco_tabela: preco,
              peso_liquido: pesoLiq,
              peso_bruto: pesoBru,
              aliquota_ipi: ipi,
              bloqueado,
              custom: { fonte: table }
            });
          } else {
            // Mescla/enriquece se campo existente estiver zerado ou vazio
            const exist = produtosMap.get(cod);
            if (!exist.descricao && desc) exist.descricao = desc;
            if (!exist.ncm && ncm) exist.ncm = ncm;
            if (!exist.grupo && grupo) exist.grupo = grupo;
            if (exist.preco_tabela === 0 && preco > 0) exist.preco_tabela = preco;
            if (exist.peso_liquido === 0 && pesoLiq > 0) exist.peso_liquido = pesoLiq;
            if (exist.peso_bruto === 0 && pesoBru > 0) exist.peso_bruto = pesoBru;
            if (exist.aliquota_ipi === 0 && ipi > 0) exist.aliquota_ipi = ipi;
          }
        }
      }
    } catch (errTable) {
      console.warn(`⚠️ [CRM Produtos Sync] Aviso ao extrair produtos de ${table}:`, errTable.message);
    }
  }

  // Se nenhuma tabela Protheus respondeu (offline/erro), verifica se há cache local prévio
  let produtosArr = Array.from(produtosMap.values());
  if (produtosArr.length === 0) {
    console.warn('⚠️ [CRM Produtos Sync] Nenhuma linha retornada das consultas Protheus. Recorrendo ao cache local...');
    const cacheLocal = await readProdutosCache();
    if (cacheLocal.produtos && cacheLocal.produtos.length > 0) {
      produtosArr = cacheLocal.produtos;
    }
  }

  // 1. Grava no PostgreSQL Supabase em chunks de 100 itens (se conectado)
  if (produtosArr.length > 0) {
    try {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < produtosArr.length; i += CHUNK_SIZE) {
        const chunk = produtosArr.slice(i, i + CHUNK_SIZE);
        const values = [];
        const placeholders = [];
        let pIdx = 1;

        for (const p of chunk) {
          placeholders.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, NOW(), NOW())`);
          values.push(
            p.codigo,
            p.descricao,
            p.ncm || null,
            p.unidade || 'UN',
            p.tipo || 'PA',
            p.grupo || null,
            p.preco_tabela || 0,
            p.peso_liquido || 0,
            p.peso_bruto || 0,
            p.aliquota_ipi || 0,
            Boolean(p.bloqueado),
            JSON.stringify(p.custom || {})
          );
        }

        const sqlUpsert = `
          INSERT INTO crm_produtos (
            codigo, descricao, ncm, unidade, tipo, grupo,
            preco_tabela, peso_liquido, peso_bruto, aliquota_ipi,
            bloqueado, custom, synced_at, updated_at
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (codigo) DO UPDATE SET
            descricao = EXCLUDED.descricao,
            ncm = COALESCE(EXCLUDED.ncm, crm_produtos.ncm),
            unidade = EXCLUDED.unidade,
            tipo = EXCLUDED.tipo,
            grupo = COALESCE(EXCLUDED.grupo, crm_produtos.grupo),
            preco_tabela = EXCLUDED.preco_tabela,
            peso_liquido = EXCLUDED.peso_liquido,
            peso_bruto = EXCLUDED.peso_bruto,
            aliquota_ipi = EXCLUDED.aliquota_ipi,
            bloqueado = EXCLUDED.bloqueado,
            custom = EXCLUDED.custom,
            synced_at = EXCLUDED.synced_at,
            updated_at = NOW();
        `;

        await safeQuery(sqlUpsert, values);
      }
    } catch (errPg) {
      console.warn('⚠️ [CRM Produtos Sync] Aviso ao persistir produtos no PostgreSQL Supabase:', errPg.message);
    }

    // 2. Grava contingência atômica no cache JSON local
    await writeProdutosCache({ produtos: produtosArr });
  }

  const ativosCount = produtosArr.filter(p => !p.bloqueado).length;
  const duracaoMs = Date.now() - inicioMs;

  await recordTelemetry(
    { username: triggeredBy },
    'SYNC_PRODUTOS_CRM',
    `Catálogo de produtos Protheus sincronizado: ${produtosArr.length} itens (${ativosCount} ativos).`,
    { total: produtosArr.length, ativos: ativosCount, duracao_ms: duracaoMs }
  );

  console.log(`🟢 [CRM Produtos Sync] Sincronização concluída: ${produtosArr.length} produtos em ${duracaoMs}ms.`);

  return {
    success: true,
    total_produtos: produtosArr.length,
    produtos_ativos: ativosCount,
    produtos_bloqueados: produtosArr.length - ativosCount,
    duracao_ms: duracaoMs,
    status: 'SINCRONIZADO',
    triggered_by: triggeredBy
  };
}

/**
 * 16. AUTOCOMPLETE DE PRODUTOS (POSTGRESQL SUPABASE + CACHE LOCAL RESILIENTE)
 * @param {string} termo Termo de pesquisa (código ou descrição)
 * @param {object} options Opções de busca
 * @returns {Promise<Array>} Lista de produtos compatíveis
 */
async function autocompleteProdutos(termo, { limite = 15, apenasAtivos = true } = {}) {
  if (!termo || String(termo).trim().length < 2) {
    return [];
  }

  const cleanTerm = sanitizeSqlParam(String(termo).trim()).replace(/[\[\]]/g, '');
  const termLower = cleanTerm.toLowerCase();
  const limitNum = Math.min(Math.max(parseInt(limite, 10) || 15, 1), 50);

  // 1. Busca prioritária no Supabase Postgres
  try {
    let whereClause = `WHERE (LOWER(codigo) LIKE $1 OR LOWER(descricao) LIKE $1)`;
    if (apenasAtivos) {
      whereClause += ` AND (bloqueado IS FALSE OR bloqueado IS NULL)`;
    }

    const sql = `
      SELECT 
        codigo, descricao, ncm, unidade, tipo, grupo,
        preco_tabela, peso_liquido, peso_bruto, aliquota_ipi,
        bloqueado, custom, synced_at
      FROM crm_produtos
      ${whereClause}
      ORDER BY 
        CASE 
          WHEN LOWER(codigo) = LOWER($2) THEN 0
          WHEN LOWER(codigo) LIKE LOWER($3) THEN 1
          WHEN LOWER(descricao) LIKE LOWER($3) THEN 2
          ELSE 3
        END,
        codigo ASC
      LIMIT $4;
    `;

    const res = await safeQuery(sql, [
      `%${termLower}%`,
      cleanTerm,
      `${cleanTerm}%`,
      limitNum
    ]);

    if (res && Array.isArray(res.rows) && res.rows.length > 0) {
      return res.rows.map(r => ({
        codigo: r.codigo,
        descricao: r.descricao,
        ncm: r.ncm || '',
        unidade: r.unidade || 'UN',
        tipo: r.tipo || 'PA',
        grupo: r.grupo || '',
        preco_tabela: Number(r.preco_tabela) || 0,
        peso_liquido: Number(r.peso_liquido) || 0,
        peso_bruto: Number(r.peso_bruto) || 0,
        aliquota_ipi: Number(r.aliquota_ipi) || 0,
        bloqueado: Boolean(r.bloqueado),
        synced_at: r.synced_at
      }));
    }
  } catch (errPg) {
    console.warn('⚠️ [CRM Autocomplete Produtos] Falha ao consultar Supabase Postgres. Usando cache local:', errPg.message);
  }

  // 2. Fallback resiliente no cache local (crm_produtos_cache.json)
  const cache = await readProdutosCache();
  const list = (cache.produtos || []).filter(p => {
    if (apenasAtivos && p.bloqueado) return false;
    const c = (p.codigo || '').toLowerCase();
    const d = (p.descricao || '').toLowerCase();
    return c.includes(termLower) || d.includes(termLower);
  });

  list.sort((a, b) => {
    const aCod = (a.codigo || '').toLowerCase();
    const bCod = (b.codigo || '').toLowerCase();
    const aDesc = (a.descricao || '').toLowerCase();
    const bDesc = (b.descricao || '').toLowerCase();
    if (aCod === termLower && bCod !== termLower) return -1;
    if (bCod === termLower && aCod !== termLower) return 1;
    if (aCod.startsWith(termLower) && !bCod.startsWith(termLower)) return -1;
    if (bCod.startsWith(termLower) && !aCod.startsWith(termLower)) return 1;
    if (aDesc.startsWith(termLower) && !bDesc.startsWith(termLower)) return -1;
    if (bDesc.startsWith(termLower) && !aDesc.startsWith(termLower)) return 1;
    return aCod.localeCompare(bCod);
  });

  return list.slice(0, limitNum).map(p => ({
    codigo: p.codigo,
    descricao: p.descricao,
    ncm: p.ncm || '',
    unidade: p.unidade || 'UN',
    tipo: p.tipo || 'PA',
    grupo: p.grupo || '',
    preco_tabela: Number(p.preco_tabela) || 0,
    peso_liquido: Number(p.peso_liquido) || 0,
    peso_bruto: Number(p.peso_bruto) || 0,
    aliquota_ipi: Number(p.aliquota_ipi) || 0,
    bloqueado: Boolean(p.bloqueado),
    synced_at: p.synced_at || cache.updated_at
  }));
}

/**
 * 17. OBTENÇÃO DE STATUS DO CATÁLOGO DE PRODUTOS DO CRM
 */
async function obterStatusProdutosCrm() {
  try {
    const res = await safeQuery(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE bloqueado IS FALSE OR bloqueado IS NULL)::int AS ativos,
        COUNT(*) FILTER (WHERE bloqueado IS TRUE)::int AS bloqueados,
        MAX(synced_at) AS last_sync
      FROM crm_produtos;
    `);

    if (res && Array.isArray(res.rows) && res.rows.length > 0 && res.rows[0].total !== null) {
      const r = res.rows[0];
      return {
        success: true,
        total_produtos: Number(r.total) || 0,
        produtos_ativos: Number(r.ativos) || 0,
        produtos_bloqueados: Number(r.bloqueados) || 0,
        last_synced_at: r.last_sync || null,
        origem: 'DATABASE'
      };
    }
  } catch (errPg) {
    console.warn('⚠️ [CRM Status Produtos] Falha ao consultar PostgreSQL. Usando cache local:', errPg.message);
  }

  // Fallback para cache local
  const cache = await readProdutosCache();
  const prods = cache.produtos || [];
  const ativos = prods.filter(p => !p.bloqueado).length;

  return {
    success: true,
    total_produtos: prods.length,
    produtos_ativos: ativos,
    produtos_bloqueados: prods.length - ativos,
    last_synced_at: cache.updated_at || null,
    origem: 'CACHE_LOCAL'
  };
}

/**
 * 18. SINCRONIZAÇÃO DE TRANSPORTADORAS DO PROTHEUS (SA4010/SA4160 -> CRM_TRANSPORTADORAS + CACHE)
 */
async function sincronizarTransportadorasProtheus({ triggeredBy = 'MANUAL' } = {}) {
  const inicioMs = Date.now();
  console.log(`🔄 [CRM Transportadoras Sync] Iniciando sincronização do cadastro Protheus disparada por "${triggeredBy}"...`);

  const sa4Tables = ['SA4010', 'SA4160'];
  const transpMap = new Map();

  for (const table of sa4Tables) {
    try {
      const sql = `
        SELECT 
          RTRIM(A4_COD) AS A4_COD,
          RTRIM(A4_NOME) AS A4_NOME,
          RTRIM(ISNULL(A4_NREDUZ, '')) AS A4_NREDUZ,
          RTRIM(ISNULL(A4_CGC, '')) AS A4_CGC,
          RTRIM(ISNULL(A4_MUN, '')) AS A4_MUN,
          RTRIM(ISNULL(A4_EST, '')) AS A4_EST,
          RTRIM(ISNULL(A4_TEL, '')) AS A4_TEL,
          RTRIM(ISNULL(A4_MSBLQL, '')) AS A4_MSBLQL
        FROM ${table}
        WHERE D_E_L_E_T_ = ' '
        ORDER BY A4_COD ASC;
      `;

      const res = await protheusDb.executeRailwayQuery(sql);
      if (res && Array.isArray(res.rows) && res.rows.length > 0) {
        for (const r of res.rows) {
          const cod = String(r.A4_COD || '').trim();
          if (!cod || cod.length < 1) continue;

          const nome = String(r.A4_NOME || '').trim() || cod;
          const fantasia = String(r.A4_NREDUZ || '').trim();
          const cnpj = String(r.A4_CGC || '').replace(/\D/g, '');
          const cidade = String(r.A4_MUN || '').trim();
          const uf = String(r.A4_EST || '').trim();
          const tel = String(r.A4_TEL || '').trim();
          const bloqueado = ['1', 'S', 's'].includes(String(r.A4_MSBLQL || '').trim());

          if (!transpMap.has(cod)) {
            transpMap.set(cod, {
              codigo: cod,
              nome,
              fantasia,
              cnpj,
              cidade,
              uf,
              telefone: tel,
              bloqueado
            });
          } else {
            const exist = transpMap.get(cod);
            if (!exist.fantasia && fantasia) exist.fantasia = fantasia;
            if (!exist.cnpj && cnpj) exist.cnpj = cnpj;
            if (!exist.cidade && cidade) exist.cidade = cidade;
            if (!exist.uf && uf) exist.uf = uf;
          }
        }
      }
    } catch (errTable) {
      console.warn(`⚠️ [CRM Transportadoras Sync] Aviso ao extrair transportadoras de ${table}:`, errTable.message);
    }
  }

  // Garantia de segurança canônica para Cliente Retira (Código 000009)
  if (!transpMap.has('000009')) {
    transpMap.set('000009', {
      codigo: '000009',
      nome: 'CLIENTE RETIRA',
      fantasia: 'CLIENTE RETIRA',
      cnpj: '',
      cidade: 'SAO PAULO',
      uf: 'SP',
      telefone: '',
      bloqueado: false
    });
  }

  let transpArr = Array.from(transpMap.values());
  if (transpArr.length === 0) {
    console.warn('⚠️ [CRM Transportadoras Sync] Nenhuma linha retornada das consultas Protheus. Recorrendo ao cache local...');
    const cacheLocal = await readTransportadorasCache();
    if (cacheLocal.transportadoras && cacheLocal.transportadoras.length > 0) {
      transpArr = cacheLocal.transportadoras;
    }
  }

  // 1. Grava no PostgreSQL Supabase em chunks de 100 itens (se conectado)
  if (transpArr.length > 0) {
    try {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < transpArr.length; i += CHUNK_SIZE) {
        const chunk = transpArr.slice(i, i + CHUNK_SIZE);
        const values = [];
        const placeholders = [];
        let pIdx = 1;

        for (const t of chunk) {
          placeholders.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, NOW(), NOW())`);
          values.push(
            t.codigo,
            t.nome,
            t.fantasia || null,
            t.cnpj || null,
            t.cidade || null,
            t.uf || null,
            t.telefone || null,
            Boolean(t.bloqueado)
          );
        }

        const sqlUpsert = `
          INSERT INTO crm_transportadoras (
            codigo, nome, fantasia, cnpj, cidade, uf, telefone, bloqueado, synced_at, updated_at
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (codigo) DO UPDATE SET
            nome = EXCLUDED.nome,
            fantasia = COALESCE(EXCLUDED.fantasia, crm_transportadoras.fantasia),
            cnpj = COALESCE(EXCLUDED.cnpj, crm_transportadoras.cnpj),
            cidade = COALESCE(EXCLUDED.cidade, crm_transportadoras.cidade),
            uf = COALESCE(EXCLUDED.uf, crm_transportadoras.uf),
            telefone = COALESCE(EXCLUDED.telefone, crm_transportadoras.telefone),
            bloqueado = EXCLUDED.bloqueado,
            synced_at = EXCLUDED.synced_at,
            updated_at = NOW();
        `;

        await safeQuery(sqlUpsert, values);
      }
    } catch (errPg) {
      console.warn('⚠️ [CRM Transportadoras Sync] Aviso ao persistir no PostgreSQL Supabase:', errPg.message);
    }

    // 2. Grava contingência atômica no cache JSON local
    await writeTransportadorasCache({ transportadoras: transpArr });
  }

  const ativasCount = transpArr.filter(t => !t.bloqueado).length;
  const duracaoMs = Date.now() - inicioMs;

  await recordTelemetry(
    { username: triggeredBy },
    'SYNC_TRANSPORTADORAS_CRM',
    `Cadastro de transportadoras Protheus sincronizado: ${transpArr.length} itens (${ativasCount} ativas).`,
    { total: transpArr.length, ativas: ativasCount, duracao_ms: duracaoMs }
  );

  console.log(`🟢 [CRM Transportadoras Sync] Sincronização concluída: ${transpArr.length} transportadoras em ${duracaoMs}ms.`);

  return {
    success: true,
    total_transportadoras: transpArr.length,
    transportadoras_ativas: ativasCount,
    transportadoras_bloqueadas: transpArr.length - ativasCount,
    duracao_ms: duracaoMs,
    status: 'SINCRONIZADO',
    triggered_by: triggeredBy
  };
}

/**
 * 19. AUTOCOMPLETE DE TRANSPORTADORAS (POSTGRESQL SUPABASE + CACHE LOCAL RESILIENTE)
 */
async function autocompleteTransportadoras(termo, { limite = 15 } = {}) {
  const cleanTerm = sanitizeSqlParam(String(termo || '').trim()).replace(/[\[\]]/g, '');
  const digitsOnly = cleanTerm.replace(/\D/g, '');
  const termoLower = cleanTerm.toLowerCase();
  const maxResults = Math.min(Math.max(parseInt(limite, 10) || 15, 1), 50);

  // Se termo vazio, retorna as principais opções (ex: CLIENTE RETIRA, Braspress, etc.)
  if (!cleanTerm) {
    const cache = await readTransportadorasCache();
    const list = cache.transportadoras || [];
    return list.slice(0, maxResults).map(r => ({
      codigo: r.codigo,
      nome: r.nome,
      fantasia: r.fantasia || '',
      cnpj: r.cnpj || '',
      cnpj_fmt: formatarCgc(r.cnpj),
      cidade: r.cidade || '',
      uf: r.uf || '',
      cidade_uf: r.cidade && r.uf ? `${r.cidade}/${r.uf}` : (r.cidade || r.uf || ''),
      telefone: r.telefone || '',
      bloqueado: Boolean(r.bloqueado)
    }));
  }

  // 1. Tenta buscar no PostgreSQL Supabase
  try {
    const params = [`%${termoLower}%`];
    let query = `
      SELECT codigo, nome, fantasia, cnpj, cidade, uf, telefone, bloqueado
      FROM crm_transportadoras
      WHERE (
        LOWER(nome) LIKE $1
        OR LOWER(COALESCE(fantasia, '')) LIKE $1
        OR LOWER(codigo) LIKE $1
    `;
    if (digitsOnly.length >= 3) {
      params.push(`%${digitsOnly}%`);
      query += ` OR cnpj LIKE $${params.length}`;
    }
    params.push(maxResults);
    query += `) ORDER BY
      bloqueado ASC,
      CASE 
        WHEN LOWER(codigo) = '${termoLower}' THEN 0
        WHEN LOWER(codigo) LIKE '${termoLower}%' THEN 1
        WHEN LOWER(nome) = '${termoLower}' THEN 2
        WHEN LOWER(nome) LIKE '${termoLower}%' THEN 3
        WHEN LOWER(COALESCE(fantasia, '')) LIKE '${termoLower}%' THEN 4
        ELSE 5 
      END,
      nome ASC LIMIT $${params.length};`;

    const res = await safeQuery(query, params);
    if (res && Array.isArray(res.rows) && res.rows.length > 0) {
      return res.rows.map(r => ({
        codigo: r.codigo,
        nome: r.nome,
        fantasia: r.fantasia || '',
        cnpj: r.cnpj || '',
        cnpj_fmt: formatarCgc(r.cnpj),
        cidade: r.cidade || '',
        uf: r.uf || '',
        cidade_uf: r.cidade && r.uf ? `${r.cidade}/${r.uf}` : (r.cidade || r.uf || ''),
        telefone: r.telefone || '',
        bloqueado: Boolean(r.bloqueado)
      }));
    }
  } catch (errPg) {
    console.warn('⚠️ [CRM Transportadoras Autocomplete] Falha ao consultar PostgreSQL. Usando fallback cache:', errPg.message);
  }

  // 2. Fallback de contingência no Cache Local
  try {
    const cache = await readTransportadorasCache();
    let list = cache.transportadoras || [];
    
    // Auto-inicialização sob demanda se o cache ainda estiver zerado
    if (list.length === 0) {
      const syncRes = await sincronizarTransportadorasProtheus({ triggeredBy: 'AUTO_INIT' }).catch(() => null);
      if (syncRes && syncRes.total_transportadoras > 0) {
        const freshCache = await readTransportadorasCache();
        list = freshCache.transportadoras || [];
      }
    }

    const filtrados = list.filter(t => {
      const n = (t.nome || '').toLowerCase();
      const f = (t.fantasia || '').toLowerCase();
      const c = (t.codigo || '').toLowerCase();
      const doc = (t.cnpj || '').replace(/\D/g, '');
      return n.includes(termoLower) || f.includes(termoLower) || c.includes(termoLower) || (digitsOnly.length >= 3 && doc.includes(digitsOnly));
    });

    filtrados.sort((a, b) => {
      if (a.bloqueado !== b.bloqueado) return a.bloqueado ? 1 : -1;
      const aCod = (a.codigo || '').toLowerCase();
      const bCod = (b.codigo || '').toLowerCase();
      if (aCod === termoLower && bCod !== termoLower) return -1;
      if (bCod === termoLower && aCod !== termoLower) return 1;
      if (aCod.startsWith(termoLower) && !bCod.startsWith(termoLower)) return -1;
      if (bCod.startsWith(termoLower) && !aCod.startsWith(termoLower)) return 1;

      const aNome = (a.nome || '').toLowerCase();
      const bNome = (b.nome || '').toLowerCase();
      if (aNome === termoLower && bNome !== termoLower) return -1;
      if (bNome === termoLower && aNome !== termoLower) return 1;
      if (aNome.startsWith(termoLower) && !bNome.startsWith(termoLower)) return -1;
      if (bNome.startsWith(termoLower) && !aNome.startsWith(termoLower)) return 1;

      const aFan = (a.fantasia || '').toLowerCase();
      const bFan = (b.fantasia || '').toLowerCase();
      if (aFan.startsWith(termoLower) && !bFan.startsWith(termoLower)) return -1;
      if (bFan.startsWith(termoLower) && !aFan.startsWith(termoLower)) return 1;

      return aNome.localeCompare(bNome);
    });

    return filtrados.slice(0, maxResults).map(r => ({
      codigo: r.codigo,
      nome: r.nome,
      fantasia: r.fantasia || '',
      cnpj: r.cnpj || '',
      cnpj_fmt: formatarCgc(r.cnpj),
      cidade: r.cidade || '',
      uf: r.uf || '',
      cidade_uf: r.cidade && r.uf ? `${r.cidade}/${r.uf}` : (r.cidade || r.uf || ''),
      telefone: r.telefone || '',
      bloqueado: Boolean(r.bloqueado)
    }));
  } catch (errCache) {
    console.warn('⚠️ [CRM Transportadoras Autocomplete] Falha no fallback cache:', errCache.message);
  }

  return [];
}

/**
 * 20. OBTENÇÃO DE STATUS DAS TRANSPORTADORAS DO CRM
 */
async function obterStatusTransportadorasCrm() {
  try {
    const res = await safeQuery(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE bloqueado IS FALSE OR bloqueado IS NULL)::int AS ativos,
        COUNT(*) FILTER (WHERE bloqueado IS TRUE)::int AS bloqueados,
        MAX(synced_at) AS last_sync
      FROM crm_transportadoras;
    `);

    if (res && Array.isArray(res.rows) && res.rows.length > 0 && res.rows[0].total !== null) {
      const r = res.rows[0];
      return {
        success: true,
        total_transportadoras: Number(r.total) || 0,
        transportadoras_ativas: Number(r.ativos) || 0,
        transportadoras_bloqueadas: Number(r.bloqueados) || 0,
        last_synced_at: r.last_sync || null,
        origem: 'DATABASE'
      };
    }
  } catch (errPg) {
    console.warn('⚠️ [CRM Status Transportadoras] Falha ao consultar PostgreSQL. Usando cache local:', errPg.message);
  }

  // Fallback para cache local
  const cache = await readTransportadorasCache();
  const transps = cache.transportadoras || [];
  const ativas = transps.filter(t => !t.bloqueado).length;

  return {
    success: true,
    total_transportadoras: transps.length,
    transportadoras_ativas: ativas,
    transportadoras_bloqueadas: transps.length - ativas,
    last_synced_at: cache.updated_at || null,
    origem: 'CACHE_LOCAL'
  };
}

/**
 * 21. VALIDAÇÃO DE TRANSPORTADORA CADASTRADA NO PROTHEUS
 */
async function validarTransportadoraProtheus(codigo) {
  if (!codigo || String(codigo).trim().length === 0) return null;
  const cleanCod = String(codigo).trim();

  // 1. Tenta Postgres
  try {
    const res = await safeQuery('SELECT * FROM crm_transportadoras WHERE codigo = $1 LIMIT 1;', [cleanCod]);
    if (res && res.rows && res.rows.length > 0) {
      return res.rows[0];
    }
  } catch {}

  // 2. Fallback cache local
  const cache = await readTransportadorasCache();
  const found = (cache.transportadoras || []).find(t => String(t.codigo).trim() === cleanCod);
  return found || null;
}

const initCrmDatabase = initCrmTables;

module.exports = {
  CANONICAL_STAGES,
  initCrmTables,
  initCrmDatabase,
  listarDeals,
  obterDealPorId,
  criarDeal,
  atualizarDeal,
  atualizarEstagioDeal,
  excluirDeal,
  restaurarDeal,
  listarAtividadesDeal,
  criarAtividadeDeal,
  autocompleteClientes,
  salvarCliente,
  listarClientes,
  obterClientePorId,
  excluirCliente,
  restaurarCliente,
  consultarCep,
  normalizarSiteUrl,
  readProdutosCache,
  writeProdutosCache,
  sincronizarProdutosCrmProtheus,
  autocompleteProdutos,
  obterStatusProdutosCrm,
  readTransportadorasCache,
  writeTransportadorasCache,
  sincronizarTransportadorasProtheus,
  autocompleteTransportadoras,
  obterStatusTransportadorasCrm,
  validarTransportadoraProtheus,
  obterProximoIdDeal,
  migrarDealsLegadosParaSequencial,
  extrairRaizCnpj,
  obterFidelidadeRaiz,
  obterFidelidadeRaizSync,
  formatarObjetoFidelidade,
  obterCacheRaizes,
  calcularScoreDeal
};
