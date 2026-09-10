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
 * 10. AUTOCOMPLETE DE CLIENTES (PROTHEUS SA1010 + CACHE RESILIENTE)
 */
async function autocompleteClientes(termo) {
  if (!termo || String(termo).trim().length < 2) {
    return [];
  }

  // Sanitização estrita contra quebra de T-SQL (remove colchetes desbalanceados)
  const cleanTerm = sanitizeSqlParam(String(termo).trim()).replace(/[\[\]]/g, '');
  const digitsOnly = cleanTerm.replace(/\D/g, '');
  let clientes = [];

  // 1. Tenta consulta ao vivo no Protheus SA1010 via Railway
  try {
    const sql = `
      SELECT TOP 15
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
        RTRIM(ISNULL(A1_VEND, '')) AS A1_VEND
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
      clientes = res.rows.map(r => ({
        cod: r.A1_COD,
        loja: r.A1_LOJA || '01',
        nome: r.A1_NOME,
        nome_fantasia: r.A1_NREDUZ || '',
        cnpj: r.A1_CGC,
        cnpj_fmt: formatarCgc(r.A1_CGC),
        endereco: r.A1_END || '',
        bairro: r.A1_BAIRRO || '',
        cidade: r.A1_MUN || '',
        uf: r.A1_EST || '',
        cep: r.A1_CEP || '',
        telefone: r.A1_TEL || '',
        telefone_fmt: formatarTelefone(r.A1_TEL),
        email: r.A1_EMAIL || '',
        contato: r.A1_CONTATO || '',
        cod_vendedor: r.A1_VEND || ''
      }));
      return clientes;
    }
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Erro ao consultar SA1010 no Protheus. Tentando fallback local:', err.message);
  }

  // 2. Fallback em histórico de análise de crédito e cache local
  try {
    const rawHist = await safeReadJson(analiseCreditoHistoryFile, []);
    if (Array.isArray(rawHist) && rawHist.length > 0) {
      const b = cleanTerm.toLowerCase();
      const unicos = new Map();

      for (const item of rawHist) {
        const nome = String(item.cliente_nome || item.nome_cliente || '').trim();
        const cnpj = String(item.cnpj || item.cliente_cnpj || '').replace(/\D/g, '');
        const cod = String(item.cliente_cod || item.codigo || '').trim();

        if (
          nome.toLowerCase().includes(b) ||
          cnpj.includes(digitsOnly || b) ||
          cod.toLowerCase().includes(b)
        ) {
          const key = `${cod}_${cnpj}`;
          if (!unicos.has(key)) {
            unicos.set(key, {
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
              cod_vendedor: item.cod_vendedor || ''
            });
          }
        }
        if (unicos.size >= 15) break;
      }

      if (unicos.size > 0) {
        return Array.from(unicos.values());
      }
    }
  } catch (err) {
    console.warn('⚠️ [CRM Engine] Falha no fallback de clientes:', err.message);
  }

  return [];
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
  autocompleteClientes
};
