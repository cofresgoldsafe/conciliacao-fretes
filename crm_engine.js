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
const { executeRailwayQuery, sanitizeSqlParam, getNomeVendedor } = require('./protheus_db');
const { safeReadJson, safeReadJsonSync, safeWriteJson } = require('./safe_json_storage');

const dataDir = path.join(__dirname, 'data');
const crmCacheFile = path.join(dataDir, 'crm_deals_cache.json');
const crmClientesCacheFile = path.join(dataDir, 'crm_clientes_cache.json');
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
        deals: data.deals || [],
        atividades: Array.isArray(data.atividades) ? data.atividades : []
      };
    }
  } catch (err) {
    console.warn('⚠️ [CRM Cache] Aviso ao ler cache local:', err.message);
  }
  return {
    updated_at: new Date().toISOString(),
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
      deals: Array.isArray(data.deals) ? data.deals : [],
      atividades: Array.isArray(data.atividades) ? data.atividades : []
    };
    await safeWriteJson(crmCacheFile, payload);
  } catch (err) {
    console.error('❌ [CRM Cache] Erro ao gravar cache local:', err.message);
  }
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
        transportadora VARCHAR(100),
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
      CREATE INDEX IF NOT EXISTS idx_crm_clientes_deleted_at ON crm_clientes(deleted_at);

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
    `);
    console.log('🟢 [CRM Engine] Schema do CRM verificado/inicializado com sucesso no Supabase PostgreSQL.');
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Aviso ao verificar schema do CRM no Postgres:', err.message);
  }
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

  // 1. Tenta Postgres
  try {
    const res = await safeQuery('SELECT * FROM crm_deals WHERE id = $1 AND ativo = TRUE;', [cleanId]);
    if (res && res.rows && res.rows.length > 0) {
      return mapDealRow(res.rows[0]);
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao buscar Deal #${cleanId} no Postgres:`, err.message);
  }

  // 2. Fallback Cache Local
  const cache = await readCache();
  const deal = (cache.deals || []).find(d => String(d.id) === cleanId && d.ativo !== false);
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
  const custom = typeof dados.custom === 'object' && dados.custom !== null ? dados.custom : {};
  const dealId = 'CRM-' + Date.now() + '-' + Math.floor(Math.random() * 8999 + 1000);

  let novoDeal = null;

  // 1. Tenta Supabase Postgres
  try {
    const res = await safeQuery(`
      INSERT INTO crm_deals (
        id, titulo, cliente_cod, cliente_loja, cliente_nome, cliente_cnpj,
        cliente_email, cliente_telefone, cliente_cidade, cliente_uf,
        valor_total, estagio, probabilidade, data_fechamento_esperada,
        cod_vendedor, nome_vendedor, origem, status, motivo_perda,
        cond_pgto, tipo_frete, frete_cobrado, frete_embutido, transportadora, prazo_entrega, num_pedido_compra, obs_nfe,
        itens_cotados, contatos, historico_estagios, custom, observacoes,
        ativo, created_by, updated_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27,
        $28, $29, $30, $31, $32,
        TRUE, $33, $34, NOW(), NOW()
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
        prazo_entrega = COALESCE($25, prazo_entrega),
        num_pedido_compra = COALESCE($26, num_pedido_compra),
        obs_nfe = COALESCE($27, obs_nfe),
        itens_cotados = $28,
        contatos = $29,
        historico_estagios = $30,
        custom = $31,
        observacoes = $32,
        updated_by = $33,
        updated_at = NOW()
      WHERE id = $34 AND ativo = TRUE
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
      dados.prazo_entrega !== undefined ? dados.prazo_entrega : null,
      dados.num_pedido_compra !== undefined ? dados.num_pedido_compra : null,
      dados.obs_nfe !== undefined ? dados.obs_nfe : null,
      JSON.stringify(itensCotados),
      JSON.stringify(dados.contatos !== undefined ? dados.contatos : existente.contatos),
      JSON.stringify(historicoEstagios),
      JSON.stringify(dados.custom !== undefined ? dados.custom : existente.custom),
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
    if (!dealAtualizado) {
      dealAtualizado = {
        ...cache.deals[idx],
        ...dados,
        valor_total: valorTotal,
        estagio: estagioNovo,
        cod_vendedor: codVendedor,
        nome_vendedor: nomeVendedor,
        frete_cobrado: freteCobrado,
        frete_embutido: freteEmbutido,
        itens_cotados: itensCotados,
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
      ORDER BY created_at DESC;
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
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
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
  const isEdicao = !!cleanId;

  if (isEdicao) {
    const clienteExistente = await obterClientePorId(cleanId);
    if (!clienteExistente) {
      const err = new Error(`Cliente #${cleanId} não encontrado para edição.`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
  }

  const clienteId = isEdicao ? cleanId : ('CLI-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 899 + 100).toString(36));

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
        ) RETURNING *;
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
 * 12. OBTER CLIENTE POR ID
 */
async function obterClientePorId(id) {
  if (!id) return null;
  const cleanId = String(id).trim();

  // 1. Tenta Postgres
  try {
    const res = await safeQuery('SELECT * FROM crm_clientes WHERE id = $1 AND deleted_at IS NULL;', [cleanId]);
    if (res && res.rows && res.rows.length > 0) {
      return mapClienteRow(res.rows[0]);
    }
  } catch (err) {
    console.warn(`⚠️ [CRM Engine] Erro ao buscar cliente #${cleanId} no Postgres:`, err.message);
  }

  // 2. Cache Local
  const cache = await readClientesCache();
  const cliente = (cache.clientes || []).find(c => String(c.id) === cleanId && !c.deleted_at);
  return cliente ? mapClienteRow(cliente) : null;
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

    const res = await executeRailwayQuery(sql);
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

  // Retorna até 15 resultados mesclados
  return Array.from(clientesMap.values()).slice(0, 15);
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

module.exports = {
  CANONICAL_STAGES,
  initCrmTables,
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
  normalizarSiteUrl
};
