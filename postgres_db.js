const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { safeWriteJson, safeWriteJsonSync, safeReadJson, safeReadJsonSync } = require('./safe_json_storage');

/**
 * Funções de Criptografia e Verificação Segura de Senhas (Bcrypt)
 */
async function hashPassword(plain) {
  if (!plain) return '';
  const clean = String(plain).trim();
  if (clean.startsWith('$2a$') || clean.startsWith('$2b$') || clean.startsWith('$2y$')) {
    return clean; // Já está hasheada
  }
  return await bcrypt.hash(clean, 10);
}

async function verifyPassword(plain, stored) {
  if (!plain || !stored) return false;
  const clean = String(plain).trim();
  const st = String(stored).trim();
  if (st.startsWith('$2a$') || st.startsWith('$2b$') || st.startsWith('$2y$')) {
    try {
      return await bcrypt.compare(clean, st);
    } catch {
      return false;
    }
  }
  // Fallback seguro para senhas legadas em texto puro
  return clean === st;
}

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const historyFile = path.join(dataDir, 'history.json');
const estoqueCacheFile = path.join(dataDir, 'estoque_saldos_cache.json');
const faturamentoCacheFile = path.join(dataDir, 'faturamento_historico_cache.json');
const tarefasFile = path.join(dataDir, 'tarefas.json');
const biAutorizacoesCacheFile = path.join(dataDir, 'bi_autorizacoes_cache.json');
const fechamentosCacheFile = path.join(dataDir, 'fechamentos_vendedores_cache.json');
const configMetasVendasFile = path.join(dataDir, 'config_metas_vendas.json');

// Armazenamento em memória para tokens 2FA (Modo Local / Fallback Resiliente)
const local2FATokens = new Map();

let pool = null;
let isConnected = false;
let lastDbError = null;

function getConnectionString() {
  let url = (process.env.DATABASE_URL || '').trim();
  const pass = (process.env.DATABASE_PASS || '').trim();
  if (url && pass) {
    url = url.replace('[YOUR-PASSWORD]', encodeURIComponent(pass))
             .replace('[YOUR_PASSWORD]', encodeURIComponent(pass))
             .replace('[DATABASE_PASS]', encodeURIComponent(pass))
             .replace('[PASSWORD]', encodeURIComponent(pass));
  }
  // Remove sslmode da query string para evitar conflito com rejectUnauthorized: false do pg
  if (url.includes('sslmode=')) {
    url = url.replace(/([?&])sslmode=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
  }
  return url;
}

// Inicializa Pool de Conexão com o PostgreSQL com Resiliência e Timeouts
function getPool() {
  if (pool) return pool;

  const connectionString = getConnectionString();
  if (!connectionString) {
    console.log('ℹ️ [Postgres] DATABASE_URL não configurada. Usando armazenamento JSON local em /data.');
    return null;
  }

  try {
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      query_timeout: 10000,
      statement_timeout: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      max: 10
    });

    pool.on('error', (err) => {
      console.warn('⚠️ [Postgres Pool Error]:', err.message);
      lastDbError = err;
      isConnected = false;
    });

    startHealthCheck();

    return pool;
  } catch (err) {
    console.error('❌ [Postgres] Erro ao instanciar Pool:', err.message);
    lastDbError = err;
    return null;
  }
}

/**
 * Health Check, Reconexão Automática e Keep-Alive em Background para Supabase
 */
let healthCheckTimer = null;
let lastKeepAliveTime = 0;

function startHealthCheck() {
  if (healthCheckTimer || !process.env.DATABASE_URL) return;
  healthCheckTimer = setInterval(async () => {
    const now = Date.now();
    // 1. Se desconectado, tenta reconectar
    if (!isConnected && pool) {
      try {
        const client = await pool.connect();
        await client.query('SELECT 1;');
        client.release();
        isConnected = true;
        lastDbError = null;
        lastKeepAliveTime = now;
        console.log('🟢 [Postgres Auto-Reconnect] Conexão com Supabase restabelecida com sucesso!');
      } catch (err) {
        lastDbError = err;
        isConnected = false;
      }
    } 
    // 2. Se conectado, executa Keep-Alive periódico (a cada 2 horas) para evitar congelamento por inatividade na Supabase
    else if (isConnected && pool && (now - lastKeepAliveTime) > 2 * 60 * 60 * 1000) {
      try {
        await safeQuery('SELECT 1;');
        lastKeepAliveTime = now;
        console.log('⚡ [Postgres Keep-Alive] Ping de atividade executado com sucesso no Supabase.');
      } catch (err) {
        console.warn('⚠️ [Postgres Keep-Alive] Falha temporária no ping:', err.message);
      }
    }
  }, 60000); // Checa a cada 60s
  if (healthCheckTimer && healthCheckTimer.unref) {
    healthCheckTimer.unref(); // Não bloqueia encerramento do processo em testes
  }
}

/**
 * Executa queries no PostgreSQL de forma resiliente com retries e tolerância a falhas
 */
async function safeQuery(text, params = [], maxRetries = 1) {
  const p = getPool();
  if (!p) return null;

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const res = await p.query(text, params);
      isConnected = true;
      lastDbError = null;
      return res;
    } catch (err) {
      attempt++;
      const isTransient = /timeout|econnreset|econnrefused|closed|terminat|57p01|57p03/i.test(err.message || '');
      lastDbError = err;
      isConnected = false;

      if (isTransient && attempt <= maxRetries) {
        console.warn(`⚠️ [Postgres Resiliência] Erro transitório na query (tentativa ${attempt}/${maxRetries}): ${err.message}. Retentando...`);
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      throw err;
    }
  }
  return null;
}

function getDiagnosticInfo() {
  const rawUrl = (process.env.DATABASE_URL || '').trim();
  const hasPass = !!(process.env.DATABASE_PASS || '').trim();
  let masked = 'NÃO CONFIGURADA';
  if (rawUrl) {
    masked = rawUrl.replace(/:([^:@]+)@/, ':****@');
  }
  return {
    hasDatabaseUrl: !!rawUrl,
    hasDatabasePass: hasPass,
    maskedUrl: masked,
    isConnected,
    lastDbError: lastDbError ? (lastDbError.message || String(lastDbError)) : null
  };
}

/**
 * Inicialização e Auto-Migração do Schema no Supabase
 */
async function initPostgres() {
  const p = getPool();
  if (!p) return false;

  try {
    const client = await p.connect();
    try {
      console.log('🟢 [Postgres] Conectado com sucesso ao Supabase PostgreSQL!');
      isConnected = true;

      // 1. Cria Tabela de Usuários
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          name VARCHAR(200) NOT NULL,
          pass VARCHAR(200) NOT NULL,
          role VARCHAR(50) DEFAULT 'user',
          vendor_code VARCHAR(20),
          permissions JSONB DEFAULT '[]'::jsonb,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // 2. Cria Tabela de Histórico de Conciliações
      await client.query(`
        CREATE TABLE IF NOT EXISTS history (
          id SERIAL PRIMARY KEY,
          data_conciliacao TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          fatura_numero VARCHAR(100),
          transportadora VARCHAR(200),
          empresa VARCHAR(100),
          valor_total NUMERIC(12,2) DEFAULT 0.00,
          qtd_fretes INTEGER DEFAULT 0,
          divergencias INTEGER DEFAULT 0,
          detalhes JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // 3. Cria Tabela de Configurações do Sistema
      await client.query(`
        CREATE TABLE IF NOT EXISTS system_configs (
          key VARCHAR(100) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // 4. Cria Tabela de Atividades / Telemetria dos Usuários
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_activities (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) NOT NULL,
          user_name VARCHAR(200) NOT NULL,
          action_type VARCHAR(50) NOT NULL,
          description TEXT NOT NULL,
          ip_address VARCHAR(100),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // 5. Garante colunas de rastreamento, vendor_code, e-mail e links favoritos na tabela users
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_code VARCHAR(20);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS total_actions INTEGER DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS links_favoritos JSONB DEFAULT '[]'::jsonb;
      `);

      // 6. Cria Tabela de Controle de Códigos 2FA Temporários
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_2fa_tokens (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) NOT NULL,
          temp_token VARCHAR(255) UNIQUE NOT NULL,
          code_hash VARCHAR(200) NOT NULL,
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          used BOOLEAN DEFAULT FALSE,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_user_2fa_temp_token ON user_2fa_tokens(temp_token);
        CREATE INDEX IF NOT EXISTS idx_user_2fa_expires_at ON user_2fa_tokens(expires_at);
      `);

      // 7. Cria Tabela de Eventos de Webhook (Banco Inter / Multi-Empresas 14, 15, 16)
      await client.query(`
        CREATE TABLE IF NOT EXISTS inter_webhook_events (
          id SERIAL PRIMARY KEY,
          empresa_codigo VARCHAR(10) NOT NULL,
          event_id VARCHAR(150) NOT NULL,
          tipo VARCHAR(50) DEFAULT 'PIX',
          payload JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT uq_inter_webhook_empresa_event UNIQUE (empresa_codigo, event_id)
        );
      `);
      // Garante migração de constraint se tabela já existia com UNIQUE apenas em event_id
      try {
        await client.query(`
          ALTER TABLE inter_webhook_events DROP CONSTRAINT IF EXISTS inter_webhook_events_event_id_key;
          ALTER TABLE inter_webhook_events ADD CONSTRAINT uq_inter_webhook_empresa_event UNIQUE (empresa_codigo, event_id);
        `);
      } catch {}

      // 8. Cria Tabela de Histórico de Análises de Crédito
      await client.query(`
        CREATE TABLE IF NOT EXISTS analise_credito_history (
          id SERIAL PRIMARY KEY,
          pedido_venda VARCHAR(100) NOT NULL,
          empresa VARCHAR(50),
          cliente_nome VARCHAR(255),
          cliente_codigo VARCHAR(50),
          cod_web VARCHAR(50),
          total_pedido NUMERIC(14,2) DEFAULT 0.00,
          desconto_ped VARCHAR(100),
          total_score INTEGER DEFAULT 0,
          risco VARCHAR(100),
          sugestao TEXT,
          decisao_final VARCHAR(100),
          obs TEXT,
          usuario VARCHAR(100) DEFAULT 'Sistema',
          sugestoes_lista JSONB DEFAULT '[]'::jsonb,
          dados_completos JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        ALTER TABLE analise_credito_history ADD COLUMN IF NOT EXISTS usuario VARCHAR(100) DEFAULT 'Sistema';
        CREATE INDEX IF NOT EXISTS idx_analise_credito_pedido ON analise_credito_history(pedido_venda);
        CREATE INDEX IF NOT EXISTS idx_analise_credito_created_at ON analise_credito_history(created_at DESC);
      `);

      // 8.1 Cria Tabela de Tarefas e Gestão de Workflow Operacional
      await client.query(`
        CREATE TABLE IF NOT EXISTS tarefas (
          id SERIAL PRIMARY KEY,
          titulo VARCHAR(255) NOT NULL,
          descricao TEXT,
          status VARCHAR(50) DEFAULT 'PENDENTE',
          prioridade VARCHAR(20) DEFAULT 'NORMAL',
          responsavel_username VARCHAR(100) NOT NULL,
          responsavel_nome VARCHAR(200),
          criado_por_username VARCHAR(100) NOT NULL,
          criado_por_nome VARCHAR(200),
          data_limite DATE,
          comentarios JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          concluida_at TIMESTAMP WITH TIME ZONE,
          finalizada_at TIMESTAMP WITH TIME ZONE
        );
        ALTER TABLE tarefas ALTER COLUMN prioridade SET DEFAULT 'NORMAL';
        UPDATE tarefas SET prioridade = 'NORMAL' WHERE prioridade IN ('MEDIA', 'BAIXA', 'media', 'baixa');
        CREATE INDEX IF NOT EXISTS idx_tarefas_responsavel ON tarefas(responsavel_username);
        CREATE INDEX IF NOT EXISTS idx_tarefas_status ON tarefas(status);
        CREATE INDEX IF NOT EXISTS idx_tarefas_created_at ON tarefas(created_at DESC);
      `);

      // 9. Cria Tabela de Saldos em Estoque de Produtos (Multi-Empresa)
      await client.query(`
        CREATE TABLE IF NOT EXISTS produtos_saldo_estoque (
          codigo VARCHAR(50) PRIMARY KEY,
          descricao VARCHAR(255) NOT NULL,
          grupo VARCHAR(50) DEFAULT '',
          preco NUMERIC(14,2) DEFAULT 0.00,
          saldo NUMERIC(14,2) DEFAULT 0.00,
          saldo_total NUMERIC(14,2) DEFAULT 0.00,
          qtd_vendas NUMERIC(14,2) DEFAULT 0.00,
          qtd_compras NUMERIC(14,2) DEFAULT 0.00,
          ponto_ped NUMERIC(14,2) DEFAULT 0.00,
          detalhes_empresas JSONB DEFAULT '{}'::jsonb,
          synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        ALTER TABLE produtos_saldo_estoque ADD COLUMN IF NOT EXISTS grupo VARCHAR(50) DEFAULT '';
        CREATE INDEX IF NOT EXISTS idx_produtos_saldo_estoque_desc ON produtos_saldo_estoque(descricao);
        CREATE INDEX IF NOT EXISTS idx_produtos_saldo_estoque_saldo ON produtos_saldo_estoque(saldo);
        CREATE INDEX IF NOT EXISTS idx_produtos_saldo_estoque_grupo ON produtos_saldo_estoque(grupo);
      `);

      // 10. Cria Tabela de Logs de Sincronização de Estoque
      await client.query(`
        CREATE TABLE IF NOT EXISTS estoque_sync_logs (
          id SERIAL PRIMARY KEY,
          status VARCHAR(50) NOT NULL,
          total_produtos INTEGER DEFAULT 0,
          total_saldo_positivo INTEGER DEFAULT 0,
          total_valor_estoque NUMERIC(14,2) DEFAULT 0.00,
          duracao_ms INTEGER DEFAULT 0,
          triggered_by VARCHAR(100) DEFAULT 'JOB',
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_estoque_sync_logs_created ON estoque_sync_logs(created_at DESC);
      `);

      // 10.1 Cria Tabela de Histórico de Faturamento (Itens Faturados Multi-Empresa)
      await client.query(`
        CREATE TABLE IF NOT EXISTS faturamento_itens_historico (
          id BIGSERIAL PRIMARY KEY,
          empresa_cod VARCHAR(10) NOT NULL,
          empresa_sigla VARCHAR(10) NOT NULL,
          nota_doc VARCHAR(20) NOT NULL,
          nota_serie VARCHAR(10) NOT NULL,
          item_num VARCHAR(10) NOT NULL,
          pedido_venda VARCHAR(20),
          cliente_cod VARCHAR(20),
          cliente_nome VARCHAR(200),
          vendedor_cod VARCHAR(20),
          vendedor_nome VARCHAR(100),
          produto_cod VARCHAR(50) NOT NULL,
          produto_descricao VARCHAR(255),
          grupo_cod VARCHAR(10),
          grupo_descricao VARCHAR(100),
          quantidade NUMERIC(15, 4) NOT NULL DEFAULT 0,
          preco_unitario NUMERIC(15, 2) NOT NULL DEFAULT 0,
          valor_total_item NUMERIC(15, 2) NOT NULL DEFAULT 0,
          valor_total_nota NUMERIC(15, 2) DEFAULT 0,
          cfop VARCHAR(10),
          tipo_nota VARCHAR(5) DEFAULT 'N',
          data_emissao DATE NOT NULL,
          mes_ano VARCHAR(7) NOT NULL,
          synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT uq_faturamento_item UNIQUE (empresa_cod, nota_doc, nota_serie, item_num)
        );
        CREATE INDEX IF NOT EXISTS idx_fat_data_emissao ON faturamento_itens_historico(data_emissao);
        CREATE INDEX IF NOT EXISTS idx_fat_mes_ano ON faturamento_itens_historico(mes_ano);
        CREATE INDEX IF NOT EXISTS idx_fat_grupo ON faturamento_itens_historico(grupo_descricao);
        CREATE INDEX IF NOT EXISTS idx_fat_empresa ON faturamento_itens_historico(empresa_sigla);
        CREATE INDEX IF NOT EXISTS idx_fat_vendedor ON faturamento_itens_historico(vendedor_nome);
      `);

      // 10.2 Cria Views Analíticas de Faturamento para o Metabase
      await client.query(`
        CREATE OR REPLACE VIEW vw_bi_faturamento_mensal AS
        SELECT
          DATE_TRUNC('month', data_emissao)::DATE AS data_mes,
          mes_ano,
          EXTRACT(YEAR FROM data_emissao)::INTEGER AS ano,
          EXTRACT(MONTH FROM data_emissao)::INTEGER AS mes,
          empresa_sigla,
          SUM(valor_total_item) AS valor_faturamento_mercadorias,
          COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)) AS total_notas_emitidas,
          COUNT(DISTINCT cliente_cod) AS total_clientes_atendidos,
          COUNT(DISTINCT produto_cod) AS total_produtos_distintos_faturados,
          SUM(quantidade) AS total_unidades_faturadas,
          ROUND(SUM(valor_total_item) / NULLIF(COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)), 0), 2) AS ticket_medio_por_nota
        FROM faturamento_itens_historico
        GROUP BY 
          DATE_TRUNC('month', data_emissao)::DATE,
          mes_ano,
          EXTRACT(YEAR FROM data_emissao),
          EXTRACT(MONTH FROM data_emissao),
          empresa_sigla;

        CREATE OR REPLACE VIEW vw_bi_faturamento_grupo_mes AS
        SELECT
          DATE_TRUNC('month', data_emissao)::DATE AS data_mes,
          mes_ano,
          EXTRACT(YEAR FROM data_emissao)::INTEGER AS ano,
          EXTRACT(MONTH FROM data_emissao)::INTEGER AS mes,
          empresa_sigla,
          grupo_cod,
          grupo_descricao,
          SUM(valor_total_item) AS valor_total_faturado,
          SUM(quantidade) AS total_unidades_faturadas,
          COUNT(DISTINCT produto_cod) AS total_produtos_distintos,
          COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)) AS total_pedidos_notas
        FROM faturamento_itens_historico
        GROUP BY
          DATE_TRUNC('month', data_emissao)::DATE,
          mes_ano,
          EXTRACT(YEAR FROM data_emissao),
          EXTRACT(MONTH FROM data_emissao),
          empresa_sigla,
          grupo_cod,
          grupo_descricao;

        CREATE OR REPLACE VIEW vw_bi_faturamento_vendedor_mes AS
        SELECT
          DATE_TRUNC('month', data_emissao)::DATE AS data_mes,
          mes_ano,
          EXTRACT(YEAR FROM data_emissao)::INTEGER AS ano,
          EXTRACT(MONTH FROM data_emissao)::INTEGER AS mes,
          empresa_sigla,
          vendedor_cod,
          vendedor_nome,
          SUM(valor_total_item) AS valor_total_faturado,
          SUM(quantidade) AS total_unidades_faturadas,
          COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)) AS total_notas_emitidas,
          COUNT(DISTINCT cliente_cod) AS total_clientes_atendidos,
          ROUND(SUM(valor_total_item) / NULLIF(COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)), 0), 2) AS ticket_medio_vendedor
        FROM faturamento_itens_historico
        GROUP BY
          DATE_TRUNC('month', data_emissao)::DATE,
          mes_ano,
          EXTRACT(YEAR FROM data_emissao),
          EXTRACT(MONTH FROM data_emissao),
          empresa_sigla,
          vendedor_cod,
          vendedor_nome;
      `);

      // 10.4 Cria Tabelas de Índices Financeiros de Liquidez (estoque, contas_a_receber, contas_a_pagar, saldos_bancarios, indices_sync_logs)
      await client.query(`
        CREATE TABLE IF NOT EXISTS estoque (
          id BIGSERIAL PRIMARY KEY,
          empresa_cod VARCHAR(10) NOT NULL,
          empresa_sigla VARCHAR(10) NOT NULL,
          codigo VARCHAR(50) NOT NULL,
          descricao VARCHAR(255) NOT NULL,
          tipo VARCHAR(10) DEFAULT 'PA',
          grupo_cod VARCHAR(10) DEFAULT '',
          quantidade NUMERIC(15, 4) NOT NULL DEFAULT 0,
          custo_unitario NUMERIC(15, 4) NOT NULL DEFAULT 0,
          preco_venda NUMERIC(15, 2) NOT NULL DEFAULT 0,
          custo_total NUMERIC(15, 2) NOT NULL DEFAULT 0,
          valor_total_venda NUMERIC(15, 2) NOT NULL DEFAULT 0,
          synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT uq_estoque_empresa_codigo UNIQUE (empresa_cod, codigo)
        );
        CREATE INDEX IF NOT EXISTS idx_estoque_empresa ON estoque(empresa_cod);
        CREATE INDEX IF NOT EXISTS idx_estoque_tipo ON estoque(tipo);
        CREATE INDEX IF NOT EXISTS idx_estoque_codigo ON estoque(codigo);
        CREATE INDEX IF NOT EXISTS idx_estoque_qtd ON estoque(quantidade);
        CREATE INDEX IF NOT EXISTS idx_estoque_grupo ON estoque(grupo_cod);

        CREATE TABLE IF NOT EXISTS contas_a_receber (
          id BIGSERIAL PRIMARY KEY,
          empresa_cod VARCHAR(10) NOT NULL,
          empresa_sigla VARCHAR(10) NOT NULL,
          recno BIGINT,
          filial VARCHAR(10) DEFAULT '01',
          prefixo VARCHAR(10) DEFAULT '',
          numero_titulo VARCHAR(20) NOT NULL,
          parcela VARCHAR(10) DEFAULT '',
          tipo VARCHAR(10) DEFAULT 'NF',
          cliente_cod VARCHAR(20),
          cliente_loja VARCHAR(10),
          cliente_nome VARCHAR(200),
          natureza_cod VARCHAR(20),
          data_emissao DATE,
          data_vencimento DATE NOT NULL,
          data_vencimento_real DATE,
          valor_original NUMERIC(15, 2) NOT NULL DEFAULT 0,
          saldo NUMERIC(15, 2) NOT NULL DEFAULT 0,
          dias_vencido INTEGER DEFAULT 0,
          valido_indice BOOLEAN DEFAULT TRUE,
          status VARCHAR(20) DEFAULT 'ABERTO',
          synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        ALTER TABLE contas_a_receber DROP CONSTRAINT IF EXISTS uq_contas_a_receber;
        ALTER TABLE contas_a_receber ADD COLUMN IF NOT EXISTS recno BIGINT;
        CREATE INDEX IF NOT EXISTS idx_cr_empresa ON contas_a_receber(empresa_cod);
        CREATE INDEX IF NOT EXISTS idx_cr_vencto ON contas_a_receber(data_vencimento);
        CREATE INDEX IF NOT EXISTS idx_cr_natureza ON contas_a_receber(natureza_cod);
        CREATE INDEX IF NOT EXISTS idx_cr_saldo ON contas_a_receber(saldo);
        CREATE INDEX IF NOT EXISTS idx_cr_valido_indice ON contas_a_receber(valido_indice);
        CREATE INDEX IF NOT EXISTS idx_cr_cliente ON contas_a_receber(cliente_nome);

        CREATE TABLE IF NOT EXISTS contas_a_pagar (
          id BIGSERIAL PRIMARY KEY,
          empresa_cod VARCHAR(10) NOT NULL,
          empresa_sigla VARCHAR(10) NOT NULL,
          recno BIGINT,
          filial VARCHAR(10) DEFAULT '01',
          prefixo VARCHAR(10) DEFAULT '',
          numero_titulo VARCHAR(20) NOT NULL,
          parcela VARCHAR(10) DEFAULT '',
          tipo VARCHAR(10) DEFAULT 'NF',
          fornecedor_cod VARCHAR(20),
          fornecedor_loja VARCHAR(10),
          fornecedor_nome VARCHAR(200),
          natureza_cod VARCHAR(20),
          data_emissao DATE,
          data_vencimento DATE NOT NULL,
          data_vencimento_real DATE,
          valor_original NUMERIC(15, 2) NOT NULL DEFAULT 0,
          saldo NUMERIC(15, 2) NOT NULL DEFAULT 0,
          is_provisorio BOOLEAN DEFAULT FALSE,
          status VARCHAR(20) DEFAULT 'ABERTO',
          synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        ALTER TABLE contas_a_pagar DROP CONSTRAINT IF EXISTS uq_contas_a_pagar;
        ALTER TABLE contas_a_pagar ADD COLUMN IF NOT EXISTS recno BIGINT;
        CREATE INDEX IF NOT EXISTS idx_cp_empresa ON contas_a_pagar(empresa_cod);
        CREATE INDEX IF NOT EXISTS idx_cp_vencto ON contas_a_pagar(data_vencimento);
        CREATE INDEX IF NOT EXISTS idx_cp_natureza ON contas_a_pagar(natureza_cod);
        CREATE INDEX IF NOT EXISTS idx_cp_tipo ON contas_a_pagar(tipo);
        CREATE INDEX IF NOT EXISTS idx_cp_saldo ON contas_a_pagar(saldo);
        CREATE INDEX IF NOT EXISTS idx_cp_is_provisorio ON contas_a_pagar(is_provisorio);
        CREATE INDEX IF NOT EXISTS idx_cp_fornecedor ON contas_a_pagar(fornecedor_nome);

        CREATE TABLE IF NOT EXISTS saldos_bancarios (
          id BIGSERIAL PRIMARY KEY,
          empresa_cod VARCHAR(10) NOT NULL,
          empresa_sigla VARCHAR(10) NOT NULL,
          banco_cod VARCHAR(10) NOT NULL,
          agencia VARCHAR(10) DEFAULT '',
          conta VARCHAR(20) NOT NULL,
          conta_nome VARCHAR(100) DEFAULT '',
          data_saldo DATE NOT NULL,
          saldo_atual NUMERIC(15, 2) NOT NULL DEFAULT 0,
          synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT uq_saldos_bancarios UNIQUE (empresa_cod, banco_cod, agencia, conta)
        );
        CREATE INDEX IF NOT EXISTS idx_sb_empresa ON saldos_bancarios(empresa_cod);
        CREATE INDEX IF NOT EXISTS idx_sb_banco ON saldos_bancarios(banco_cod);

        CREATE TABLE IF NOT EXISTS indices_sync_logs (
          id BIGSERIAL PRIMARY KEY,
          status VARCHAR(50) NOT NULL,
          total_estoque INTEGER DEFAULT 0,
          total_receber INTEGER DEFAULT 0,
          total_pagar INTEGER DEFAULT 0,
          total_bancos INTEGER DEFAULT 0,
          valor_ativo_circulante NUMERIC(15, 2) DEFAULT 0,
          valor_passivo_circulante NUMERIC(15, 2) DEFAULT 0,
          liquidez_corrente_consolidada NUMERIC(10, 4) DEFAULT 0,
          duracao_ms INTEGER DEFAULT 0,
          triggered_by VARCHAR(100) DEFAULT 'JOB',
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_indices_sync_logs_created ON indices_sync_logs(created_at DESC);

        CREATE TABLE IF NOT EXISTS indices_liquidez_historico (
          id BIGSERIAL PRIMARY KEY,
          data_registro DATE NOT NULL DEFAULT CURRENT_DATE,
          timestamp_registro TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          empresa_cod VARCHAR(20) NOT NULL,
          empresa_sigla VARCHAR(10),
          empresa_nome VARCHAR(100),
          liquidez_corrente NUMERIC(10, 4) NOT NULL DEFAULT 0,
          liquidez_seca NUMERIC(10, 4) NOT NULL DEFAULT 0,
          liquidez_imediata NUMERIC(10, 4) NOT NULL DEFAULT 0,
          ativo_circulante NUMERIC(15, 2) NOT NULL DEFAULT 0,
          ativo_seco NUMERIC(15, 2) NOT NULL DEFAULT 0,
          passivo_circulante NUMERIC(15, 2) NOT NULL DEFAULT 0,
          estoque_custo NUMERIC(15, 2) DEFAULT 0,
          estoque_venda NUMERIC(15, 2) DEFAULT 0,
          total_itens_estoque INTEGER DEFAULT 0,
          disponibilidades NUMERIC(15, 2) DEFAULT 0,
          total_contas_bancarias INTEGER DEFAULT 0,
          receber_valido NUMERIC(15, 2) DEFAULT 0,
          receber_inadimplente NUMERIC(15, 2) DEFAULT 0,
          receber_total NUMERIC(15, 2) DEFAULT 0,
          total_titulos_receber INTEGER DEFAULT 0,
          pagar_total NUMERIC(15, 2) DEFAULT 0,
          pagar_provisorios_pr NUMERIC(15, 2) DEFAULT 0,
          pagar_definitivos NUMERIC(15, 2) DEFAULT 0,
          total_titulos_pagar INTEGER DEFAULT 0,
          triggered_by VARCHAR(50) DEFAULT 'JOB',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_indices_hist_data ON indices_liquidez_historico(data_registro DESC);
        CREATE INDEX IF NOT EXISTS idx_indices_hist_empresa ON indices_liquidez_historico(empresa_cod, data_registro DESC);
        CREATE INDEX IF NOT EXISTS idx_indices_hist_ts ON indices_liquidez_historico(timestamp_registro DESC);

        CREATE OR REPLACE VIEW vw_bi_indices_liquidez AS
        WITH comp_estoque AS (
          SELECT 
            empresa_cod,
            empresa_sigla,
            COALESCE(SUM(custo_total), 0) AS total_estoque_custo,
            COALESCE(SUM(valor_total_venda), 0) AS total_estoque_venda,
            COUNT(*) AS total_itens_estoque
          FROM estoque
          WHERE quantidade > 0 AND tipo = 'PA'
          GROUP BY empresa_cod, empresa_sigla
        ),
        comp_bancos AS (
          SELECT 
            empresa_cod,
            empresa_sigla,
            COALESCE(SUM(saldo_atual), 0) AS total_saldos_bancarios,
            COUNT(*) AS total_contas_bancarias
          FROM saldos_bancarios
          GROUP BY empresa_cod, empresa_sigla
        ),
        comp_receber AS (
          SELECT 
            empresa_cod,
            empresa_sigla,
            COALESCE(SUM(saldo), 0) AS total_receber_aberto,
            COALESCE(SUM(CASE WHEN valido_indice THEN saldo ELSE 0 END), 0) AS total_receber_valido_indice,
            COALESCE(SUM(CASE WHEN NOT valido_indice THEN saldo ELSE 0 END), 0) AS total_receber_inadimplente_mais_5d,
            COUNT(*) AS total_titulos_receber
          FROM contas_a_receber
          WHERE saldo > 0.01
          GROUP BY empresa_cod, empresa_sigla
        ),
        comp_pagar AS (
          SELECT 
            empresa_cod,
            empresa_sigla,
            COALESCE(SUM(saldo), 0) AS total_pagar_aberto,
            COALESCE(SUM(CASE WHEN is_provisorio THEN saldo ELSE 0 END), 0) AS total_pagar_provisorios_pr,
            COALESCE(SUM(CASE WHEN NOT is_provisorio THEN saldo ELSE 0 END), 0) AS total_pagar_definitivos,
            COUNT(*) AS total_titulos_pagar
          FROM contas_a_pagar
          WHERE saldo > 0.01 AND tipo <> 'PA'
          GROUP BY empresa_cod, empresa_sigla
        ),
        empresas_base AS (
          SELECT '14' AS empresa_cod, 'MP' AS empresa_sigla, 'Metal Pleno' AS empresa_nome
          UNION ALL
          SELECT '15' AS empresa_cod, 'GSI' AS empresa_sigla, 'GSI Cofres' AS empresa_nome
          UNION ALL
          SELECT '16' AS empresa_cod, 'OACO' AS empresa_sigla, 'OAÇO' AS empresa_nome
        )
        SELECT 
          eb.empresa_cod,
          eb.empresa_sigla,
          eb.empresa_nome,
          COALESCE(e.total_estoque_custo, 0) AS estoque_custo,
          COALESCE(e.total_estoque_venda, 0) AS estoque_venda,
          COALESCE(e.total_itens_estoque, 0) AS total_itens_estoque,
          COALESCE(b.total_saldos_bancarios, 0) AS disponibilidades_bancarias,
          COALESCE(b.total_contas_bancarias, 0) AS total_contas_bancarias,
          COALESCE(r.total_receber_aberto, 0) AS contas_receber_total,
          COALESCE(r.total_receber_valido_indice, 0) AS contas_receber_valido,
          COALESCE(r.total_receber_inadimplente_mais_5d, 0) AS contas_receber_inadimplente_5d,
          COALESCE(p.total_pagar_aberto, 0) AS contas_pagar_total,
          COALESCE(p.total_pagar_provisorios_pr, 0) AS contas_pagar_provisorios_pr,
          COALESCE(p.total_pagar_definitivos, 0) AS contas_pagar_definitivos,
          ROUND(COALESCE(e.total_estoque_custo, 0) + COALESCE(b.total_saldos_bancarios, 0) + COALESCE(r.total_receber_valido_indice, 0), 2) AS ativo_circulante,
          ROUND(COALESCE(p.total_pagar_aberto, 0), 2) AS passivo_circulante,
          ROUND(
            (COALESCE(e.total_estoque_custo, 0) + COALESCE(b.total_saldos_bancarios, 0) + COALESCE(r.total_receber_valido_indice, 0)) / 
            NULLIF(COALESCE(p.total_pagar_aberto, 0), 0), 4
          ) AS liquidez_corrente,
          ROUND(
            (COALESCE(b.total_saldos_bancarios, 0) + COALESCE(r.total_receber_valido_indice, 0)) / 
            NULLIF(COALESCE(p.total_pagar_aberto, 0), 0), 4
          ) AS liquidez_seca,
          ROUND(
            COALESCE(b.total_saldos_bancarios, 0) / 
            NULLIF(COALESCE(p.total_pagar_aberto, 0), 0), 4
          ) AS liquidez_imediata
        FROM empresas_base eb
        LEFT JOIN comp_estoque e ON e.empresa_cod = eb.empresa_cod
        LEFT JOIN comp_bancos b ON b.empresa_cod = eb.empresa_cod
        LEFT JOIN comp_receber r ON r.empresa_cod = eb.empresa_cod
        LEFT JOIN comp_pagar p ON p.empresa_cod = eb.empresa_cod;

        DELETE FROM indices_liquidez_historico
        WHERE id NOT IN (
          SELECT MAX(id)
          FROM indices_liquidez_historico
          GROUP BY data_registro, empresa_cod
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_indices_hist_dia_empresa ON indices_liquidez_historico(data_registro, empresa_cod);

        CREATE OR REPLACE VIEW vw_indices_liquidez_diario AS
        SELECT *
        FROM (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY data_registro, empresa_cod ORDER BY timestamp_registro DESC) as rn
          FROM indices_liquidez_historico
        ) sub
        WHERE rn = 1;

        -- 10.5 Cria Tabela de Histórico de Autorizações de Desconto e Margem (BI Executivo)
        CREATE TABLE IF NOT EXISTS bi_autorizacoes_desconto (
          id SERIAL PRIMARY KEY,
          deal_id INTEGER NOT NULL,
          solicitante_nome VARCHAR(200),
          cliente_nome VARCHAR(255),
          valor_total NUMERIC(14,2) DEFAULT 0.00,
          preco_unitario_autorizado NUMERIC(14,2) DEFAULT 0.00,
          margem_pct NUMERIC(8,2) DEFAULT 0.00,
          lucro_bruto NUMERIC(14,2) DEFAULT 0.00,
          desconto_pct NUMERIC(8,2) DEFAULT 0.00,
          desconto_reais NUMERIC(14,2) DEFAULT 0.00,
          cond_pagamento_label VARCHAR(150),
          tipo_frete VARCHAR(50) DEFAULT 'FOB',
          frete_cliente NUMERIC(14,2) DEFAULT 0.00,
          frete_embutido NUMERIC(14,2) DEFAULT 0.00,
          status VARCHAR(50) NOT NULL,
          usuario_decisor VARCHAR(100) NOT NULL,
          usuario_decisor_nome VARCHAR(200),
          observacoes TEXT,
          nota_pipedrive TEXT,
          dados_completos JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_bi_aut_deal_id ON bi_autorizacoes_desconto(deal_id);
        CREATE INDEX IF NOT EXISTS idx_bi_aut_status ON bi_autorizacoes_desconto(status);
        CREATE INDEX IF NOT EXISTS idx_bi_aut_created_at ON bi_autorizacoes_desconto(created_at DESC);

        -- 10.6 Cria Tabela de Configurações Gerais do Sistema
        CREATE TABLE IF NOT EXISTS system_configs (
          chave VARCHAR(100) PRIMARY KEY,
          valor JSONB NOT NULL,
          descricao TEXT,
          atualizado_por VARCHAR(100),
          atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        -- 10.7 Cria Tabela de Fechamentos Mensais dos Vendedores
        CREATE TABLE IF NOT EXISTS fechamentos_vendedores (
          id SERIAL PRIMARY KEY,
          ciclo_id VARCHAR(50) NOT NULL,
          periodo_label VARCHAR(100) NOT NULL,
          data_ini DATE NOT NULL,
          data_fim DATE NOT NULL,
          cod_vendedor VARCHAR(20) NOT NULL,
          nome_vendedor VARCHAR(100) NOT NULL,
          vendas_base_bruta NUMERIC(15, 2) DEFAULT 0,
          fretes_embutidos NUMERIC(15, 2) DEFAULT 0,
          vendas_base_liquida NUMERIC(15, 2) DEFAULT 0,
          meta_vendas_valor NUMERIC(15, 2) DEFAULT 120000,
          pct_meta_vendas NUMERIC(7, 2) DEFAULT 0,
          premio_meta_vendas NUMERIC(15, 2) DEFAULT 0,
          faixa_meta_vendas VARCHAR(50) DEFAULT '',
          gordura_frete_total NUMERIC(15, 2) DEFAULT 0,
          premio_gordura_frete NUMERIC(15, 2) DEFAULT 0,
          faixa_gordura_frete VARCHAR(50) DEFAULT '',
          comissao_taxa NUMERIC(5, 4) DEFAULT 0.0130,
          comissao_bruta NUMERIC(15, 2) DEFAULT 0,
          inadimplentes_total NUMERIC(15, 2) DEFAULT 0,
          comissao_liquida NUMERIC(15, 2) DEFAULT 0,
          total_premios NUMERIC(15, 2) DEFAULT 0,
          total_geral_receber NUMERIC(15, 2) DEFAULT 0,
          faturamento_empresas_json JSONB,
          benchmarking_json JSONB,
          metas_snapshot_json JSONB,
          detalhes_json JSONB,
          gerado_em TIMESTAMPTZ DEFAULT NOW(),
          tipo_geracao VARCHAR(30) DEFAULT 'JOB_AUTO',
          CONSTRAINT uq_fechamento_ciclo_vend UNIQUE (ciclo_id, cod_vendedor)
        );
        CREATE INDEX IF NOT EXISTS idx_fechamentos_ciclo ON fechamentos_vendedores(ciclo_id);
        CREATE INDEX IF NOT EXISTS idx_fechamentos_vendedor ON fechamentos_vendedores(cod_vendedor);
        CREATE INDEX IF NOT EXISTS idx_fechamentos_datas ON fechamentos_vendedores(data_ini, data_fim);
      `);

      // 11. Auto-Seeder / Migração de Usuários Existentes do JSON para o Banco
      const countRes = await client.query('SELECT COUNT(*) FROM users;');
      const userCount = parseInt(countRes.rows[0].count, 10);

      if (userCount === 0) {
        console.log('📦 [Postgres] Tabela "users" vazia. Iniciando migração automática de users.json...');
        let localUsers = [];
        try {
          if (fs.existsSync(usersFile)) {
            localUsers = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
          }
        } catch (e) {
          console.warn('Aviso ao ler users.json local:', e.message);
        }

        if (localUsers.length === 0) {
          localUsers = [
            { username: 'alexandre', name: 'Alexandre', email: 'alexandre@oaco.com.br', pass: '$2b$10$p0RJWNsHaXZhB.OVofss9ekoTYw5/e9fG9McA24vn03Ws.z/KMOUi', role: 'admin', permissions: ['logistica', 'consulta', 'vendedores', 'compras', 'financeiro', 'configuracoes'], active: true },
            { username: 'erica', name: 'Érica', email: 'erica@oaco.com.br', pass: '$2b$10$tG.0iXqpKLWZrPS3P9bSmO5fIxRlF66sKcPuhrchlpA8A1OgrfEn2', role: 'user', permissions: ['logistica', 'consulta'], active: true },
            { username: 'wallerson', name: 'Wallerson', email: 'wallerson@oaco.com.br', pass: '$2b$10$4K2LJfNjtIcHjM1Nj8vXiOpZh2esE4jvbE1YRd3brORaQLB4UJCOq', role: 'user', permissions: ['logistica', 'consulta'], active: true },
            { username: 'juliana', name: 'Juliana', email: 'juliana@oaco.com.br', pass: '$2b$10$Zj3xa3MmI1q6FCN78Njx/OQ.4vIoO5UuCO/Gl/azN.3NglvoZrmhq', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores'], active: true },
            { username: 'andrea', name: 'Andrea', email: 'andrea@oaco.com.br', pass: '$2b$10$Zj3xa3MmI1q6FCN78Njx/OQ.4vIoO5UuCO/Gl/azN.3NglvoZrmhq', role: 'vendedor', vendorCode: '000064', permissions: ['vendedores'], active: true },
            { username: 'figueiredo', name: 'Figueiredo', email: 'figueiredo@oaco.com.br', pass: '$2b$10$Zj3xa3MmI1q6FCN78Njx/OQ.4vIoO5UuCO/Gl/azN.3NglvoZrmhq', role: 'vendedor', vendorCode: '000004', permissions: ['vendedores'], active: true },
            { username: 'rubens', name: 'Rubens da Silva', email: 'rubens@oaco.com.br', pass: '$2b$10$Zj3xa3MmI1q6FCN78Njx/OQ.4vIoO5UuCO/Gl/azN.3NglvoZrmhq', role: 'user', permissions: ['financeiro'], active: true }
          ];
        }

        for (const u of localUsers) {
          const hashedPass = (u.pass && String(u.pass).startsWith('$2')) ? u.pass : await hashPassword(u.pass || '102030');
          await client.query(`
            INSERT INTO users (username, name, email, pass, role, vendor_code, permissions, active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (username) DO NOTHING;
          `, [
            u.username.toLowerCase().trim(),
            u.name || u.username,
            u.email ? u.email.toLowerCase().trim() : null,
            hashedPass,
            u.role || 'user',
            u.vendorCode || null,
            JSON.stringify(u.permissions || ['logistica', 'consulta']),
            u.active !== false
          ]);
        }
        console.log(`✅ [Postgres] Migrados com sucesso ${localUsers.length} usuários para o Supabase PostgreSQL.`);
      }

      // 11.1. Autocura de Vendedores Homologados (Garante vendor_code caso esteja nulo ou vazio)
      try {
        await client.query(`
          UPDATE users SET vendor_code = '000074', role = 'vendedor' WHERE username = 'juliana' AND (vendor_code IS NULL OR vendor_code = '');
          UPDATE users SET vendor_code = '000064', role = 'vendedor' WHERE username = 'andrea' AND (vendor_code IS NULL OR vendor_code = '');
          UPDATE users SET vendor_code = '000004', role = 'vendedor' WHERE username = 'figueiredo' AND (vendor_code IS NULL OR vendor_code = '');
        `);
      } catch (errAutoHeal) {
        console.warn('⚠️ [Postgres] Aviso na autocura de vendedores:', errAutoHeal.message);
      }

      // 12. Habilita Row-Level Security (RLS) e Políticas de Backend no Supabase (Security Advisor Check 0013 & 0008)
      const knownTablesToSecure = [
        'users',
        'history',
        'system_configs',
        'user_activities',
        'user_2fa_tokens',
        'inter_webhook_events',
        'analise_credito_history',
        'produtos_saldo_estoque',
        'estoque_sync_logs',
        'faturamento_itens_historico',
        'faturamento_sync_logs',
        'estoque',
        'contas_a_receber',
        'contas_a_pagar',
        'saldos_bancarios',
        'indices_sync_logs',
        'indices_liquidez_historico',
        'grupos_produtos_sbm',
        'tarefas',
        'fechamentos_vendedores'
      ];

      // Busca dinamicamente todas as tabelas do schema public para garantir 100% de cobertura
      let allPublicTables = [...knownTablesToSecure];
      try {
        const dbTablesRes = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public';`);
        if (dbTablesRes && Array.isArray(dbTablesRes.rows)) {
          const found = dbTablesRes.rows.map(r => r.tablename);
          allPublicTables = Array.from(new Set([...allPublicTables, ...found]));
        }
      } catch (errList) {
        console.warn('⚠️ [Postgres RLS] Aviso ao listar tabelas em pg_tables:', errList.message);
      }

      for (const tbl of allPublicTables) {
        try {
          await client.query(`ALTER TABLE public."${tbl}" ENABLE ROW LEVEL SECURITY;`);
          await client.query(`ALTER TABLE public."${tbl}" FORCE ROW LEVEL SECURITY;`);
          await client.query(`
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = '${tbl}' AND policyname = 'Acesso exclusivo backend'
              ) THEN
                CREATE POLICY "Acesso exclusivo backend" ON public."${tbl}" TO service_role USING (true) WITH CHECK (true);
              END IF;
            END $$;
          `);
        } catch (errRls) {
          // Ignora se tabela temporariamente não existir no banco
        }
      }

      // Revogação de privilégios das roles 'anon' e 'authenticated' no PostgREST
      try {
        await client.query(`
          REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
          REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
          REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;
        `);
      } catch (errRevoke) {
        console.warn('⚠️ [Postgres RLS] Aviso ao revogar privilégios públicos anônimos:', errRevoke.message);
      }

      // 13. Migração de extensões instaladas no schema public para o schema 'extensions' (Security Advisor: extension_in_public)
      try {
        await client.query(`
          CREATE SCHEMA IF NOT EXISTS extensions;
          GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1 FROM pg_extension e 
              JOIN pg_namespace n ON n.oid = e.extnamespace 
              WHERE e.extname = 'citext' AND n.nspname = 'public'
            ) THEN
              ALTER EXTENSION citext SET SCHEMA extensions;
            END IF;
          END $$;
        `);
      } catch (errExt) {
        // Ignora caso sem privilégio de superuser para mover extensão
      }

      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('⚠️ [Postgres] Falha na conexão inicial com o Supabase. Utilizando armazenamento JSON local:', err.message);
    isConnected = false;
    return false;
  }
}

/**
 * Retorna todos os usuários (PostgreSQL com fallback para users.json)
 */
async function getUsers() {
  const p = getPool();
  if (p) {
    try {
      const res = await safeQuery(`
        SELECT username, name, email, pass, role, vendor_code AS "vendorCode", permissions, active 
        FROM users 
        ORDER BY id ASC;
      `);
      if (res && res.rows && res.rows.length > 0) {
        // Atualiza cache local de forma atômica
        safeWriteJson(usersFile, res.rows).catch(() => {});
        return res.rows;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar usuários no banco, usando cache local:', err.message);
    }
  }

  // Fallback Local Seguro
  return safeReadJsonSync(usersFile, []);
}

/**
 * Salva ou Atualiza Usuário (PostgreSQL + Sync Local)
 */
async function saveUser(userData) {
  const cleanUser = String(userData.username || '').trim().toLowerCase();
  const cleanName = String(userData.name || '').trim();
  const cleanEmail = userData.email ? String(userData.email).trim().toLowerCase() : null;
  const cleanRole = userData.role || 'user';
  const vendorCode = userData.vendorCode || null;
  const permissions = Array.isArray(userData.permissions) ? userData.permissions : ['logistica', 'consulta'];
  const active = userData.active !== undefined ? !!userData.active : true;

  let hashedPass = null;
  if (userData.pass && String(userData.pass).trim() !== '') {
    hashedPass = await hashPassword(String(userData.pass).trim());
  }

  const p = getPool();
  if (p) {
    try {
      if (hashedPass) {
        await safeQuery(`
          INSERT INTO users (username, name, email, pass, role, vendor_code, permissions, active, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (username) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            pass = EXCLUDED.pass,
            role = EXCLUDED.role,
            vendor_code = EXCLUDED.vendor_code,
            permissions = EXCLUDED.permissions,
            active = EXCLUDED.active,
            updated_at = NOW();
        `, [cleanUser, cleanName, cleanEmail, hashedPass, cleanRole, vendorCode, JSON.stringify(permissions), active]);
      } else {
        // Atualiza sem mexer na senha
        const defaultHash = await hashPassword('102030');
        await safeQuery(`
          INSERT INTO users (username, name, email, pass, role, vendor_code, permissions, active, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (username) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            role = EXCLUDED.role,
            vendor_code = EXCLUDED.vendor_code,
            permissions = EXCLUDED.permissions,
            active = EXCLUDED.active,
            updated_at = NOW();
        `, [cleanUser, cleanName, cleanEmail, defaultHash, cleanRole, vendorCode, JSON.stringify(permissions), active]);
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar usuário no banco:', err.message);
    }
  }

  // Atualiza também o arquivo local users.json de forma segura e atômica
  try {
    let localUsers = safeReadJsonSync(usersFile, []);
    const idx = localUsers.findIndex(u => u.username.toLowerCase() === cleanUser);
    if (idx >= 0) {
      localUsers[idx].name = cleanName;
      if (cleanEmail !== undefined) localUsers[idx].email = cleanEmail;
      if (hashedPass) {
        localUsers[idx].pass = hashedPass;
      }
      localUsers[idx].role = cleanRole;
      if (vendorCode !== undefined) localUsers[idx].vendorCode = vendorCode;
      localUsers[idx].permissions = permissions;
      localUsers[idx].active = active;
    } else {
      const defaultHash = hashedPass || (await hashPassword('102030'));
      localUsers.push({
        username: cleanUser,
        name: cleanName,
        email: cleanEmail,
        pass: defaultHash,
        role: cleanRole,
        vendorCode: vendorCode,
        permissions: permissions,
        active: active
      });
    }
    await safeWriteJson(usersFile, localUsers);
  } catch (e) {
    console.warn('Erro ao atualizar cache local de usuários:', e.message);
  }

  return true;
}

/**
 * =========================================================================
 * MÓDULO 2FA: GERENCIAMENTO DE CÓDIGOS E TOKENS TEMPORÁRIOS DE DOIS FATORES
 * =========================================================================
 */

/**
 * Cria um novo token 2FA temporário para o usuário
 */
async function create2FAToken(username, code, expiresInMinutes = 5) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanCode = String(code || '').trim();
  const tempToken = '2fa_' + crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  const codeHash = await hashPassword(cleanCode);

  // Armazena no PostgreSQL se disponível
  const p = getPool();
  if (p) {
    try {
      await safeQuery(`
        INSERT INTO user_2fa_tokens (username, temp_token, code_hash, attempts, max_attempts, used, expires_at)
        VALUES ($1, $2, $3, 0, 3, FALSE, $4);
      `, [cleanUser, tempToken, codeHash, expiresAt]);
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar token 2FA no banco:', err.message);
    }
  }

  // Armazena também em memória (Cache local / Fallback)
  local2FATokens.set(tempToken, {
    username: cleanUser,
    tempToken,
    codeHash,
    plainCode: cleanCode, // Mantido apenas em memória para validação em dev/testes
    attempts: 0,
    maxAttempts: 3,
    used: false,
    expiresAt: expiresAt.getTime()
  });

  return {
    tempToken,
    expiresAt: expiresAt.getTime()
  };
}

/**
 * Valida o código 2FA de 4 dígitos informado pelo usuário
 */
async function verify2FAToken(tempToken, code) {
  if (!tempToken || !code) {
    return { valid: false, reason: 'MISSING_DATA', message: 'Token temporário e código são obrigatórios.' };
  }

  const cleanToken = String(tempToken).trim();
  const cleanCode = String(code).trim();
  const now = Date.now();

  // 1. Tenta recuperar do PostgreSQL
  const p = getPool();
  let dbRecord = null;

  if (p) {
    try {
      const res = await safeQuery(`
        SELECT id, username, temp_token, code_hash, attempts, max_attempts, used, expires_at
        FROM user_2fa_tokens
        WHERE temp_token = $1
        LIMIT 1;
      `, [cleanToken]);
      if (res && res.rows && res.rows.length > 0) {
        dbRecord = res.rows[0];
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar token 2FA no banco:', err.message);
    }
  }

  // 2. Fallback para memória local
  const localRecord = local2FATokens.get(cleanToken);
  const record = dbRecord || localRecord;

  if (!record) {
    return {
      valid: false,
      reason: 'NOT_FOUND',
      message: 'Código de segurança não encontrado ou sessão expirada. Faça login novamente.'
    };
  }

  const recordExpiresAt = dbRecord ? new Date(dbRecord.expires_at).getTime() : localRecord.expiresAt;
  const isUsed = dbRecord ? !!dbRecord.used : !!localRecord.used;
  let attempts = dbRecord ? parseInt(dbRecord.attempts || 0, 10) : localRecord.attempts;
  const maxAttempts = dbRecord ? parseInt(dbRecord.max_attempts || 3, 10) : (localRecord.maxAttempts || 3);
  const username = dbRecord ? dbRecord.username : localRecord.username;
  const codeHash = dbRecord ? dbRecord.code_hash : localRecord.codeHash;

  if (now > recordExpiresAt) {
    return {
      valid: false,
      reason: 'EXPIRED',
      message: 'O código de segurança de 4 dígitos expirou (tempo limite de 5 minutos). Solicite um novo código.'
    };
  }

  if (attempts >= maxAttempts) {
    return {
      valid: false,
      reason: 'BLOCKED',
      attemptsLeft: 0,
      message: 'Limite de tentativas excedido para este código de segurança. Solicite um novo código por e-mail.'
    };
  }

  if (isUsed) {
    return {
      valid: false,
      reason: 'ALREADY_USED',
      message: 'Este código de segurança já foi utilizado. Solicite um novo código.'
    };
  }

  // Verifica compatibilidade do código com bcrypt
  const isMatch = await verifyPassword(cleanCode, codeHash);

  if (isMatch) {
    // Marca como utilizado
    if (p) {
      safeQuery(`UPDATE user_2fa_tokens SET used = TRUE, attempts = attempts + 1 WHERE temp_token = $1;`, [cleanToken]).catch(() => {});
    }
    if (localRecord) {
      localRecord.used = true;
      localRecord.attempts += 1;
    }

    return {
      valid: true,
      username
    };
  }

  // Código Incorreto: Incrementa contador de tentativas
  attempts += 1;
  const attemptsLeft = Math.max(0, maxAttempts - attempts);
  const willBlock = attempts >= maxAttempts;

  if (p) {
    safeQuery(`UPDATE user_2fa_tokens SET attempts = $1 WHERE temp_token = $2;`, [attempts, cleanToken]).catch(() => {});
  }
  if (localRecord) {
    localRecord.attempts = attempts;
  }

  if (willBlock) {
    return {
      valid: false,
      reason: 'BLOCKED',
      attemptsLeft: 0,
      message: 'Você errou o código 3 vezes. Por segurança, este código foi cancelado. Solicite um novo código por e-mail.'
    };
  }

  return {
    valid: false,
    reason: 'INVALID_CODE',
    attemptsLeft,
    message: `Código incorreto. Você ainda tem ${attemptsLeft} tentativa(s) restante(s).`
  };
}

/**
 * Reenvia / Atualiza código 2FA para um token temporário ativo
 */
async function resend2FAToken(tempToken, newCode, expiresInMinutes = 5) {
  if (!tempToken || !newCode) return { success: false, message: 'Parâmetros inválidos.' };

  const cleanToken = String(tempToken).trim();
  const cleanCode = String(newCode).trim();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  const codeHash = await hashPassword(cleanCode);

  let username = null;

  const localRecord = local2FATokens.get(cleanToken);
  if (localRecord) {
    username = localRecord.username;
    localRecord.codeHash = codeHash;
    localRecord.plainCode = cleanCode;
    localRecord.attempts = 0;
    localRecord.used = false;
    localRecord.expiresAt = expiresAt.getTime();
  }

  const p = getPool();
  if (p) {
    try {
      const res = await safeQuery(`
        UPDATE user_2fa_tokens
        SET code_hash = $1, attempts = 0, used = FALSE, expires_at = $2
        WHERE temp_token = $3
        RETURNING username;
      `, [codeHash, expiresAt, cleanToken]);
      if (res && res.rows && res.rows.length > 0) {
        username = res.rows[0].username;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao atualizar reenvio de 2FA:', err.message);
    }
  }

  if (!username) {
    return { success: false, message: 'Sessão de 2FA não encontrada. Faça login novamente.' };
  }

  return {
    success: true,
    username,
    expiresAt: expiresAt.getTime()
  };
}

/**
 * Exclui Usuário (PostgreSQL + Sync Local)
 */
async function deleteUser(username) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const p = getPool();
  if (p) {
    try {
      await safeQuery('DELETE FROM users WHERE username = $1;', [cleanUser]);
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao excluir usuário no banco:', err.message);
    }
  }

  // Atualiza arquivo local de forma segura
  try {
    let localUsers = safeReadJsonSync(usersFile, []);
    localUsers = localUsers.filter(u => u.username.toLowerCase() !== cleanUser);
    await safeWriteJson(usersFile, localUsers);
  } catch {}
}

/**
 * Retorna Histórico de Conciliações
 */
async function getHistory() {
  const p = getPool();
  if (p) {
    try {
      const res = await safeQuery(`
        SELECT 
          id,
          data_conciliacao AS "dataConciliacao",
          fatura_numero AS "faturaNumero",
          transportadora,
          empresa,
          valor_total AS "valorTotal",
          qtd_fretes AS "qtdFretes",
          pagador,
          data_vencimento AS "dataVencimento",
          data_integracao AS "dataIntegracao",
          empresa_codigo AS "empresaCodigo",
          created_at AS "createdAt"
        FROM history 
        ORDER BY id DESC 
        LIMIT 100;
      `);
      if (res && res.rows && res.rows.length > 0) {
        return res.rows;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar histórico no banco, usando arquivo local:', err.message);
    }
  }

  // Fallback Local
  return safeReadJsonSync(historyFile, []);
}

/**
 * Salva Registro no Histórico de Conciliações
 */
async function saveHistory(item) {
  const p = getPool();
  if (p) {
    try {
      await safeQuery(`
        INSERT INTO history (
          data_conciliacao, fatura_numero, transportadora, empresa, valor_total, 
          qtd_fretes, pagador, data_vencimento, data_integracao, empresa_codigo
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
      `, [
        item.dataConciliacao || new Date().toISOString(),
        item.faturaNumero || '',
        item.transportadora || '',
        item.empresa || '',
        item.valorTotal || 0,
        item.qtdFretes || item.totalFretes || 0,
        item.pagador || '',
        item.dataVencimento || '',
        item.dataIntegracao || '',
        item.empresaCodigo || '16'
      ]);
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar histórico no banco:', err.message);
    }
  }

  // Grava em arquivo local para contingência de forma segura e atômica
  try {
    let history = safeReadJsonSync(historyFile, []);
    history.unshift(item);
    if (history.length > 100) history = history.slice(0, 100);
    await safeWriteJson(historyFile, history);
  } catch {}
}

/**
 * Registra uma Atividade / Ação de Usuário
 */
async function logUserActivity({ username, userName, actionType, description, ip, metadata }) {
  const cleanUser = String(username || 'anonimo').trim().toLowerCase();
  const cleanName = String(userName || cleanUser).trim();
  const cleanType = String(actionType || 'OUTRO').trim().toUpperCase();
  const cleanDesc = String(description || '').trim();
  const metaObj = metadata && typeof metadata === 'object' ? metadata : {};

  const p = getPool();
  if (p) {
    try {
      // 1. Insere log na tabela user_activities
      await safeQuery(`
        INSERT INTO user_activities (username, user_name, action_type, description, ip_address, metadata)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, [cleanUser, cleanName, cleanType, cleanDesc, ip || '', JSON.stringify(metaObj)]);

      // 2. Atualiza contador e último acesso do usuário
      if (cleanType === 'LOGIN') {
        await safeQuery(`
          UPDATE users 
          SET last_login_at = NOW(), last_active_at = NOW(), total_actions = COALESCE(total_actions, 0) + 1, updated_at = NOW()
          WHERE username = $1;
        `, [cleanUser]);
      } else {
        await safeQuery(`
          UPDATE users 
          SET last_active_at = NOW(), total_actions = COALESCE(total_actions, 0) + 1, updated_at = NOW()
          WHERE username = $1;
        `, [cleanUser]);
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao registrar log de atividade:', err.message);
    }
  }

  // Grava em arquivo local para contingência e atualiza dados do usuário de forma segura e atômica
  try {
    const activitiesFile = path.join(dataDir, 'activities.json');
    let acts = safeReadJsonSync(activitiesFile, []);
    const newAct = {
      id: 'ACT-' + Date.now(),
      username: cleanUser,
      userName: cleanName,
      actionType: cleanType,
      description: cleanDesc,
      ip: ip || '',
      metadata: metaObj,
      createdAt: new Date().toISOString()
    };
    acts.unshift(newAct);
    if (acts.length > 200) acts = acts.slice(0, 200);
    safeWriteJson(activitiesFile, acts).catch(() => {});

    // Atualiza data/users.json local
    let localUsers = safeReadJsonSync(usersFile, []);
    const uIdx = localUsers.findIndex(u => String(u.username || '').toLowerCase() === cleanUser);
    if (uIdx >= 0) {
      localUsers[uIdx].lastActiveAt = newAct.createdAt;
      if (cleanType === 'LOGIN') localUsers[uIdx].lastLoginAt = newAct.createdAt;
      localUsers[uIdx].totalActions = (localUsers[uIdx].totalActions || 0) + 1;
      safeWriteJson(usersFile, localUsers).catch(() => {});
    }
  } catch {}
}

/**
 * Atualiza o timestamp de último acesso do usuário (Touch / Heartbeat)
 */
async function touchUserActivity(username) {
  if (!username) return;
  const cleanUser = String(username).trim().toLowerCase();
  const p = getPool();
  if (p) {
    try {
      await safeQuery(`
        UPDATE users 
        SET last_active_at = NOW(), total_actions = COALESCE(total_actions, 0) + 1, updated_at = NOW()
        WHERE LOWER(username) = $1;
      `, [cleanUser]);
    } catch {}
  }
  try {
    let localUsers = safeReadJsonSync(usersFile, []);
    const uIdx = localUsers.findIndex(u => String(u.username || '').toLowerCase() === cleanUser);
    if (uIdx >= 0) {
      localUsers[uIdx].lastActiveAt = new Date().toISOString();
      localUsers[uIdx].totalActions = (localUsers[uIdx].totalActions || 0) + 1;
      safeWriteJson(usersFile, localUsers).catch(() => {});
    }
  } catch {}
}

/**
 * Retorna o resumo de auditoria para o Admin
 */
async function getAuditSummary() {
  const p = getPool();
  if (p) {
    try {
      const usersRes = await safeQuery(`
        SELECT 
          id, username, name, role, vendor_code AS "vendorCode", active,
          last_login_at AS "lastLoginAt",
          last_active_at AS "lastActiveAt",
          COALESCE(total_actions, 0) AS "totalActions"
        FROM users 
        ORDER BY COALESCE(last_active_at, created_at) DESC;
      `);

      const actsRes = await safeQuery(`
        SELECT 
          id, username, user_name AS "userName", action_type AS "actionType", 
          description, ip_address AS "ip", metadata,
          created_at AS "createdAt"
        FROM user_activities 
        ORDER BY id DESC 
        LIMIT 100;
      `);

      const statsRes = await safeQuery(`
        SELECT 
          COUNT(*) AS "totalActivities",
          COUNT(DISTINCT username) AS "activeUsersCount"
        FROM user_activities;
      `);

      if (usersRes && actsRes && statsRes) {
        return {
          users: usersRes.rows || [],
          recentActivities: actsRes.rows || [],
          stats: statsRes.rows[0] || { totalActivities: 0, activeUsersCount: 0 },
          dbConnected: true
        };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao obter resumo de auditoria do banco, usando fallback local:', err.message);
    }
  }

  // Fallback Local Inteligente
  try {
    const activitiesFile = path.join(dataDir, 'activities.json');
    let acts = [];
    if (fs.existsSync(activitiesFile)) {
      acts = JSON.parse(fs.readFileSync(activitiesFile, 'utf-8'));
    }
    let localUsers = [];
    if (fs.existsSync(usersFile)) {
      localUsers = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    }

    const mappedUsers = localUsers.map(u => {
      const uName = String(u.username || '').toLowerCase();
      const userActs = acts.filter(a => String(a.username || '').toLowerCase() === uName);
      const lastAct = userActs.length > 0 ? userActs[0].createdAt : (u.lastActiveAt || u.lastLoginAt || null);
      const lastLog = userActs.find(a => a.actionType === 'LOGIN');
      return {
        ...u,
        lastLoginAt: lastLog ? lastLog.createdAt : (u.lastLoginAt || null),
        lastActiveAt: lastAct,
        totalActions: userActs.length || (u.totalActions || 0)
      };
    });

    // Ordena por último acesso ativo
    mappedUsers.sort((a, b) => {
      const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
      const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
      return tb - ta;
    });

    const activeUsersCount = mappedUsers.filter(u => u.totalActions > 0 || u.lastActiveAt).length;

    return {
      users: mappedUsers,
      recentActivities: acts,
      stats: { totalActivities: acts.length, activeUsersCount },
      dbConnected: false
    };
  } catch {
    return { users: [], recentActivities: [], stats: { totalActivities: 0, activeUsersCount: 0 }, dbConnected: false };
  }
}

const webhooksFile = path.join(dataDir, 'inter_webhooks.json');

let writeQueue = Promise.resolve();

/**
 * Salva um evento de Webhook recebido do Banco Inter de forma idempotente e determinística
 */
async function saveInterWebhookEvent({ empresaCodigo = '14', eventId, tipo = 'PIX', payload = {} }) {
  const p = getPool();
  const emp = String(empresaCodigo || '14').trim();
  const rawPayloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  // Fallback determinístico por hash SHA-256 se eventId não for fornecido
  const evtId = eventId || `evt-${crypto.createHash('sha256').update(emp + ':' + rawPayloadStr).digest('hex').slice(0, 32)}`;
  const now = new Date().toISOString();

  // 1. Tenta gravar no Supabase PostgreSQL
  if (p) {
    try {
      const res = await safeQuery(
        `INSERT INTO inter_webhook_events (empresa_codigo, event_id, tipo, payload, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (empresa_codigo, event_id) DO NOTHING
         RETURNING id, empresa_codigo AS "empresaCodigo", event_id AS "eventId", tipo, created_at AS "createdAt";`,
        [emp, evtId, tipo, rawPayloadStr]
      );
      if (res && res.rows && res.rows.length > 0) {
        return { success: true, savedTo: 'postgres', event: res.rows[0] };
      }
      if (res && res.rows) {
        return { success: true, savedTo: 'postgres', duplicate: true, eventId: evtId };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres Webhook Save Error]:', err.message);
    }
  }

  // 2. Fallback em arquivo JSON local serializado por fila segura para evitar race conditions
  try {
    let localEvts = safeReadJsonSync(webhooksFile, []);
    const exists = localEvts.some(e => String(e.empresaCodigo) === emp && String(e.eventId) === evtId);
    if (!exists) {
      const newEvt = { id: localEvts.length + 1, empresaCodigo: emp, eventId: evtId, tipo, payload: typeof payload === 'string' ? JSON.parse(payload) : payload, createdAt: now };
      localEvts.unshift(newEvt);
      if (localEvts.length > 200) localEvts = localEvts.slice(0, 200);
      await safeWriteJson(webhooksFile, localEvts);
      return { success: true, savedTo: 'json_fallback', event: newEvt };
    }
    return { success: true, savedTo: 'json_fallback', duplicate: true, eventId: evtId };
  } catch (err) {
    console.error('❌ [Local Webhook Save Error]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Consulta histórico de eventos de Webhook recebidos
 */
async function getInterWebhookEvents(empresaCodigo = null, limit = 50) {
  const p = getPool();
  const maxLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));

  if (p) {
    try {
      let query = 'SELECT id, empresa_codigo AS "empresaCodigo", event_id AS "eventId", tipo, payload, created_at AS "createdAt" FROM inter_webhook_events';
      const params = [];
      if (empresaCodigo && empresaCodigo !== 'todas') {
        query += ' WHERE empresa_codigo = $1';
        params.push(String(empresaCodigo).trim());
      }
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1};`;
      params.push(maxLimit);

      const res = await safeQuery(query, params);
      if (res && res.rows) return res.rows;
    } catch (err) {
      console.warn('⚠️ [Postgres Webhook Get Error]:', err.message);
    }
  }

  // Fallback JSON
  try {
    let localEvts = safeReadJsonSync(webhooksFile, []);
    if (empresaCodigo && empresaCodigo !== 'todas') {
      localEvts = localEvts.filter(e => String(e.empresaCodigo) === String(empresaCodigo));
    }
    return localEvts.slice(0, maxLimit);
  } catch {}

  return [];
}

const analiseCreditoHistoryFile = path.join(dataDir, 'analise_credito_history.json');

/**
 * Salva Registro de Análise de Crédito (PostgreSQL + Backup JSON Local)
 */
async function saveHistoricoCreditoDB(dados) {
  const p = getPool();
  const now = new Date().toISOString();
  const usuario = (dados && dados.usuario && String(dados.usuario).trim()) ? String(dados.usuario).trim() : 'Sistema';

  let savedItem = null;

  if (p) {
    try {
      const res = await safeQuery(`
        INSERT INTO analise_credito_history (
          pedido_venda, empresa, cliente_nome, cliente_codigo, cod_web,
          total_pedido, desconto_ped, total_score, risco, sugestao,
          decisao_final, obs, usuario, sugestoes_lista, dados_completos, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
        )
        RETURNING id, pedido_venda, empresa, cliente_nome, total_score, risco, sugestao, decisao_final, usuario, created_at;
      `, [
        dados.pedido_venda || '',
        dados.empresa || '',
        dados.cliente_nome || '',
        dados.cliente_codigo || '',
        dados.cod_web || '',
        Number(dados.total_pedido || 0),
        Number(dados.desconto_ped || 0),
        Number(dados.total_score || 0),
        dados.risco || '',
        dados.sugestao || '',
        dados.decisao_final || '',
        dados.obs || '',
        usuario,
        JSON.stringify(dados.sugestoes_lista || []),
        JSON.stringify(dados.dados_completos || dados)
      ]);

      if (res && res.rows && res.rows[0]) {
        savedItem = res.rows[0];
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar analise_credito_history no banco:', err.message);
    }
  }

  // Backup em JSON local de forma segura e atômica
  try {
    let localList = safeReadJsonSync(analiseCreditoHistoryFile, []);
    const itemToSave = savedItem || {
      id: String(Date.now()),
      ...dados,
      usuario,
      created_at: now
    };
    localList.unshift(itemToSave);
    if (localList.length > 500) localList = localList.slice(0, 500);
    await safeWriteJson(analiseCreditoHistoryFile, localList);
    return itemToSave;
  } catch (e) {
    console.warn('Erro ao salvar analise_credito_history.json local:', e.message);
    return savedItem || { id: String(Date.now()), ...dados, usuario, created_at: now };
  }
}

/**
 * Consulta Histórico de Análises de Crédito (PostgreSQL + Fallback JSON Local)
 */
async function getHistoricoCreditoDB(limit = 200) {
  const p = getPool();
  const maxLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));

  if (p) {
    try {
      const res = await safeQuery(`
        SELECT 
          id, pedido_venda, empresa, cliente_nome, cliente_codigo, cod_web,
          total_pedido, desconto_ped, total_score, risco, sugestao,
          decisao_final, obs, usuario, sugestoes_lista, dados_completos, created_at
        FROM analise_credito_history
        ORDER BY id DESC
        LIMIT $1;
      `, [maxLimit]);

      if (res && res.rows && res.rows.length > 0) {
        return res.rows.map(r => {
          let dadosComp = {};
          try {
            dadosComp = typeof r.dados_completos === 'string' ? JSON.parse(r.dados_completos) : (r.dados_completos || {});
          } catch {}

          let sugLista = [];
          try {
            sugLista = typeof r.sugestoes_lista === 'string' ? JSON.parse(r.sugestoes_lista) : (r.sugestoes_lista || []);
          } catch {}

          let detalhesPts = dadosComp.detalhes_pontos || null;
          if (!detalhesPts && dadosComp && (dadosComp.cnpj_ativo !== undefined || dadosComp.faturado !== undefined || dadosComp.entrada !== undefined)) {
            try {
              const { calcularScore } = require('./analise_credito_engine');
              const resCalc = calcularScore(dadosComp);
              detalhesPts = resCalc.detalhesPontos || null;
            } catch {}
          }

          return {
            ...dadosComp,
            ...r,
            dados_completos: dadosComp,
            sugestoes_lista: sugLista,
            detalhes_pontos: detalhesPts
          };
        });
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar analise_credito_history no banco, usando fallback local:', err.message);
    }
  }

  // Fallback em JSON local
  try {
    let localList = safeReadJsonSync(analiseCreditoHistoryFile, []);
    return localList.slice(0, maxLimit);
  } catch {}

  return [];
}

/**
 * =========================================================================
 * MÓDULO ESTOQUE: PERSISTÊNCIA & CONSULTA DE SALDOS CONSOLIDADOS
 * =========================================================================
 */

/**
 * Grava a carga consolidada de saldos em estoque no PostgreSQL e Cache JSON
 */
async function saveSaldosEstoqueDB(produtosList = [], metadata = {}) {
  const p = getPool();
  const status = metadata.status || 'SUCCESS';
  const triggeredBy = metadata.triggered_by || metadata.trigger || 'MANUAL';
  const duracaoMs = Number(metadata.duracao_ms ?? metadata.durationMs ?? 0);
  const errorMessage = metadata.error_message || metadata.errorMessage || null;
  const nowIso = new Date().toISOString();

  const totalProdutos = produtosList.length;
  const totalSaldoPositivo = produtosList.filter(p => Number(p.saldo || 0) > 0).length;
  const totalZerados = produtosList.filter(p => Number(p.saldo || 0) <= 0).length;
  const totalValorEstoque = produtosList.reduce((acc, p) => acc + Number(p.saldo_total || 0), 0);

  const metaSalvar = {
    status,
    total_produtos: totalProdutos,
    totalProdutos,
    total_saldo_positivo: totalSaldoPositivo,
    itensComSaldo: totalSaldoPositivo,
    itensZerados: totalZerados,
    total_valor_estoque: totalValorEstoque,
    valorTotalEstoque: totalValorEstoque,
    duracao_ms: duracaoMs,
    durationMs: duracaoMs,
    triggered_by: triggeredBy,
    trigger: triggeredBy,
    error_message: errorMessage,
    errorMessage,
    created_at: nowIso,
    synced_at: nowIso,
    syncedAt: nowIso
  };

  // 1. Grava no cache JSON local de forma segura e atômica
  try {
    const payloadCache = {
      metadata: metaSalvar,
      produtos: produtosList
    };
    await safeWriteJson(estoqueCacheFile, payloadCache);
  } catch (errCache) {
    console.warn('⚠️ [Postgres Cache] Erro ao gravar estoque_saldos_cache.json:', errCache.message);
  }

  // 2. Grava no PostgreSQL / Supabase
  if (p) {
    try {
      const client = await p.connect();
      try {
        await client.query('BEGIN');

        if (produtosList.length > 0) {
          // Upsert em lotes (chunks de 100 itens) para alto desempenho e atomicidade
          const chunkSize = 100;
          for (let i = 0; i < produtosList.length; i += chunkSize) {
            const chunk = produtosList.slice(i, i + chunkSize);
            for (const prod of chunk) {
              await client.query(`
                INSERT INTO produtos_saldo_estoque (
                  codigo, descricao, grupo, preco, saldo, saldo_total, qtd_vendas, qtd_compras, ponto_ped, detalhes_empresas, synced_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                ON CONFLICT (codigo) DO UPDATE SET
                  descricao = EXCLUDED.descricao,
                  grupo = EXCLUDED.grupo,
                  preco = EXCLUDED.preco,
                  saldo = EXCLUDED.saldo,
                  saldo_total = EXCLUDED.saldo_total,
                  qtd_vendas = EXCLUDED.qtd_vendas,
                  qtd_compras = EXCLUDED.qtd_compras,
                  ponto_ped = EXCLUDED.ponto_ped,
                  detalhes_empresas = EXCLUDED.detalhes_empresas,
                  synced_at = EXCLUDED.synced_at;
              `, [
                String(prod.codigo || '').trim(),
                String(prod.descricao || '').trim(),
                String(prod.grupo || '').trim(),
                Number(prod.preco || 0),
                Number(prod.saldo || 0),
                Number(prod.saldo_total || 0),
                Number(prod.qtd_vendas || 0),
                Number(prod.qtd_compras || 0),
                Number(prod.ponto_ped || 0),
                JSON.stringify(prod.detalhes_empresas || {})
              ]);
            }
          }
        }

        // Insere registro de log da sincronização
        await client.query(`
          INSERT INTO estoque_sync_logs (
            status, total_produtos, total_saldo_positivo, total_valor_estoque, duracao_ms, triggered_by, error_message, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW());
        `, [
          metaSalvar.status,
          metaSalvar.total_produtos,
          metaSalvar.total_saldo_positivo,
          metaSalvar.total_valor_estoque,
          metaSalvar.duracao_ms,
          metaSalvar.triggered_by,
          metaSalvar.error_message
        ]);

        await client.query('COMMIT');
      } catch (errTx) {
        await client.query('ROLLBACK');
        throw errTx;
      } finally {
        client.release();
      }
    } catch (errPostgres) {
      console.warn('⚠️ [Postgres] Falha ao sincronizar saldos de estoque no Supabase (usando fallback JSON):', errPostgres.message);
    }
  }

  return metaSalvar;
}

/**
 * Consulta saldos de estoque (PostgreSQL + Fallback JSON Local)
 */
async function getSaldosEstoqueDB({ search, filtroEstoque, filtroGrupo, filtroEmpresa } = {}) {
  const p = getPool();
  const cleanSearch = (search || '').toLowerCase().trim();
  const cleanFiltro = (filtroEstoque || 'todos').toLowerCase().trim();
  const cleanGrupo = (filtroGrupo || 'todos').trim();
  const cleanEmpresa = (filtroEmpresa || 'todos').toLowerCase().trim();
  const empCod = (cleanEmpresa === '14' || cleanEmpresa === 'mp') ? '14' :
                 (cleanEmpresa === '15' || cleanEmpresa === 'gsi') ? '15' :
                 (cleanEmpresa === '16' || cleanEmpresa === 'oaco') ? '16' : null;

  // 1. Tenta buscar no PostgreSQL
  if (p) {
    try {
      const params = [];
      const whereClauses = [];

      if (cleanSearch) {
        params.push(`%${cleanSearch}%`);
        whereClauses.push(`(LOWER(codigo) LIKE $${params.length} OR LOWER(descricao) LIKE $${params.length})`);
      }

      if (!empCod) {
        if (cleanFiltro === 'positivo') {
          whereClauses.push('saldo > 0');
        } else if (cleanFiltro === 'zerado_negativo') {
          whereClauses.push('saldo <= 0');
        } else if (cleanFiltro === 'com_vendas') {
          whereClauses.push('qtd_vendas > 0');
        } else if (cleanFiltro === 'com_compras') {
          whereClauses.push('qtd_compras > 0');
        }
      }

      if (cleanGrupo && cleanGrupo !== 'todos') {
        params.push(cleanGrupo);
        whereClauses.push(`grupo = $${params.length}`);
      }

      const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const sql = `
        SELECT 
          codigo, descricao, grupo, preco, saldo, saldo_total, qtd_vendas, qtd_compras, ponto_ped, detalhes_empresas, synced_at
        FROM produtos_saldo_estoque
        ${whereStr}
        ORDER BY saldo DESC, descricao ASC;
      `;

      const res = await safeQuery(sql, params);
      if (res && res.rows && res.rows.length > 0) {
        let produtos = res.rows.map(r => ({
          codigo: r.codigo,
          descricao: r.descricao,
          grupo: r.grupo || '',
          preco: Number(r.preco) || 0,
          saldo: Number(r.saldo) || 0,
          saldo_total: Number(r.saldo_total) || 0,
          qtd_vendas: Number(r.qtd_vendas) || 0,
          qtd_compras: Number(r.qtd_compras) || 0,
          ponto_ped: Number(r.ponto_ped) || 0,
          detalhes_empresas: typeof r.detalhes_empresas === 'string' ? JSON.parse(r.detalhes_empresas) : (r.detalhes_empresas || {}),
          synced_at: r.synced_at ? new Date(r.synced_at).toISOString() : null
        }));

        if (empCod) {
          if (cleanFiltro === 'positivo') {
            produtos = produtos.filter(p => {
              const emp = p.detalhes_empresas && p.detalhes_empresas[empCod];
              return emp && Number(emp.saldo || 0) > 0;
            });
          } else if (cleanFiltro === 'zerado_negativo') {
            produtos = produtos.filter(p => {
              const emp = p.detalhes_empresas && p.detalhes_empresas[empCod];
              return !emp || Number(emp.saldo || 0) <= 0;
            });
          } else if (cleanFiltro === 'com_vendas') {
            produtos = produtos.filter(p => {
              const emp = p.detalhes_empresas && p.detalhes_empresas[empCod];
              return emp && Number(emp.vendas || 0) > 0;
            });
          } else if (cleanFiltro === 'com_compras') {
            produtos = produtos.filter(p => {
              const emp = p.detalhes_empresas && p.detalhes_empresas[empCod];
              return emp && Number(emp.compras || 0) > 0;
            });
          }
        }

        return produtos;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro na query de produtos_saldo_estoque, recorrendo ao cache JSON:', err.message);
    }
  }

  // 2. Fallback gracioso: Lê de data/estoque_saldos_cache.json
  try {
    if (fs.existsSync(estoqueCacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(estoqueCacheFile, 'utf-8'));
      let produtos = Array.isArray(cacheData.produtos) ? cacheData.produtos : [];

      if (cleanSearch) {
        produtos = produtos.filter(p => 
          (p.codigo && p.codigo.toLowerCase().includes(cleanSearch)) ||
          (p.descricao && p.descricao.toLowerCase().includes(cleanSearch))
        );
      }

      if (!empCod) {
        if (cleanFiltro === 'positivo') {
          produtos = produtos.filter(p => Number(p.saldo || 0) > 0);
        } else if (cleanFiltro === 'zerado_negativo') {
          produtos = produtos.filter(p => Number(p.saldo || 0) <= 0);
        } else if (cleanFiltro === 'com_vendas') {
          produtos = produtos.filter(p => Number(p.qtd_vendas || 0) > 0);
        } else if (cleanFiltro === 'com_compras') {
          produtos = produtos.filter(p => Number(p.qtd_compras || 0) > 0);
        }
      } else {
        if (cleanFiltro === 'positivo') {
          produtos = produtos.filter(p => {
            const emp = p.detalhes_empresas && p.detalhes_empresas[empCod];
            return emp && Number(emp.saldo || 0) > 0;
          });
        } else if (cleanFiltro === 'zerado_negativo') {
          produtos = produtos.filter(p => {
            const emp = p.detalhes_empresas && p.detalhes_empresas[empCod];
            return !emp || Number(emp.saldo || 0) <= 0;
          });
        } else if (cleanFiltro === 'com_vendas') {
          produtos = produtos.filter(p => {
            const emp = p.detalhes_empresas && p.detalhes_empresas[empCod];
            return emp && Number(emp.vendas || 0) > 0;
          });
        } else if (cleanFiltro === 'com_compras') {
          produtos = produtos.filter(p => {
            const emp = p.detalhes_empresas && p.detalhes_empresas[empCod];
            return emp && Number(emp.compras || 0) > 0;
          });
        }
      }

      if (cleanGrupo && cleanGrupo !== 'todos') {
        produtos = produtos.filter(p => String(p.grupo || '').trim() === cleanGrupo);
      }

      return produtos;
    }
  } catch (errFallback) {
    console.warn('⚠️ Erro ao ler estoque_saldos_cache.json:', errFallback.message);
  }

  return [];
}

/**
 * Retorna o último log de sincronização do estoque
 */
async function getUltimoSyncEstoqueLog() {
  const p = getPool();
  if (p) {
    try {
      const res = await safeQuery(`
        SELECT id, status, total_produtos, total_saldo_positivo, total_valor_estoque, duracao_ms, triggered_by, error_message, created_at
        FROM estoque_sync_logs
        ORDER BY id DESC
        LIMIT 1;
      `);
      if (res && res.rows && res.rows.length > 0) {
        const r = res.rows[0];
        const createdAtIso = r.created_at ? new Date(r.created_at).toISOString() : null;
        return {
          id: r.id,
          status: r.status,
          total_produtos: Number(r.total_produtos) || 0,
          totalProdutos: Number(r.total_produtos) || 0,
          total_saldo_positivo: Number(r.total_saldo_positivo) || 0,
          total_valor_estoque: Number(r.total_valor_estoque) || 0,
          duracao_ms: Number(r.duracao_ms) || 0,
          triggered_by: r.triggered_by,
          error_message: r.error_message,
          created_at: createdAtIso,
          synced_at: createdAtIso,
          syncedAt: createdAtIso
        };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar último log em estoque_sync_logs:', err.message);
    }
  }

  // Fallback cache JSON
  try {
    if (fs.existsSync(estoqueCacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(estoqueCacheFile, 'utf-8'));
      if (cacheData.metadata) {
        const syncTime = cacheData.metadata.synced_at || cacheData.metadata.syncedAt || cacheData.metadata.created_at || new Date().toISOString();
        return {
          ...cacheData.metadata,
          created_at: syncTime,
          synced_at: syncTime,
          syncedAt: syncTime
        };
      }
    }
  } catch {}

  return null;
}

/**
 * Persiste ou atualiza itens de faturamento histórico em lotes no Supabase/Postgres
 */
async function saveFaturamentoHistoricoDB(itensList = [], metadata = {}) {
  const p = getPool();
  const summary = {
    totalItens: itensList.length,
    totalValor: itensList.reduce((acc, it) => acc + Number(it.valor_total_item || 0), 0)
  };

  // Cache em JSON local como fallback resiliente
  try {
    const cacheDir = path.dirname(faturamentoCacheFile);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    await safeWriteJson(faturamentoCacheFile, {
      metadata: {
        ...metadata,
        ...summary,
        synced_at: new Date().toISOString()
      },
      itens: itensList
    });
  } catch (errCache) {
    console.warn('⚠️ [Postgres] Falha ao gravar cache local de faturamento:', errCache.message);
  }

  if (p && itensList.length > 0) {
    const client = await p.connect();
    try {
      await client.query('BEGIN');

      const chunkSize = 100;
      for (let i = 0; i < itensList.length; i += chunkSize) {
        const chunk = itensList.slice(i, i + chunkSize);
        for (const item of chunk) {
          await client.query(`
            INSERT INTO faturamento_itens_historico (
              empresa_cod, empresa_sigla, nota_doc, nota_serie, item_num,
              pedido_venda, cliente_cod, cliente_nome, vendedor_cod, vendedor_nome,
              produto_cod, produto_descricao, grupo_cod, grupo_descricao,
              quantidade, preco_unitario, valor_total_item, valor_total_nota,
              cfop, tipo_nota, data_emissao, mes_ano, synced_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW()
            )
            ON CONFLICT (empresa_cod, nota_doc, nota_serie, item_num) DO UPDATE SET
              pedido_venda = EXCLUDED.pedido_venda,
              cliente_cod = EXCLUDED.cliente_cod,
              cliente_nome = EXCLUDED.cliente_nome,
              vendedor_cod = EXCLUDED.vendedor_cod,
              vendedor_nome = EXCLUDED.vendedor_nome,
              produto_descricao = EXCLUDED.produto_descricao,
              grupo_cod = EXCLUDED.grupo_cod,
              grupo_descricao = EXCLUDED.grupo_descricao,
              quantidade = EXCLUDED.quantidade,
              preco_unitario = EXCLUDED.preco_unitario,
              valor_total_item = EXCLUDED.valor_total_item,
              valor_total_nota = EXCLUDED.valor_total_nota,
              cfop = EXCLUDED.cfop,
              tipo_nota = EXCLUDED.tipo_nota,
              data_emissao = EXCLUDED.data_emissao,
              mes_ano = EXCLUDED.mes_ano,
              synced_at = EXCLUDED.synced_at;
          `, [
            String(item.empresa_cod || '').trim(),
            String(item.empresa_sigla || '').trim(),
            String(item.nota_doc || '').trim(),
            String(item.nota_serie || '').trim(),
            String(item.item_num || '').trim(),
            String(item.pedido_venda || '').trim(),
            String(item.cliente_cod || '').trim(),
            String(item.cliente_nome || '').trim(),
            String(item.vendedor_cod || '').trim(),
            String(item.vendedor_nome || '').trim(),
            String(item.produto_cod || '').trim(),
            String(item.produto_descricao || '').trim(),
            String(item.grupo_cod || '').trim(),
            String(item.grupo_descricao || '').trim(),
            Number(item.quantidade || 0),
            Number(item.preco_unitario || 0),
            Number(item.valor_total_item || 0),
            Number(item.valor_total_nota || 0),
            String(item.cfop || '').trim(),
            String(item.tipo_nota || 'N').trim(),
            item.data_emissao,
            String(item.mes_ano || '').trim()
          ]);
        }
      }

      await client.query(`
        INSERT INTO faturamento_sync_logs (
          status, total_itens, total_valor_faturado, duracao_ms, triggered_by, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6);
      `, [
        metadata.status || 'SUCCESS',
        summary.totalItens,
        summary.totalValor,
        metadata.duracao_ms || 0,
        metadata.triggered_by || 'MANUAL',
        metadata.error_message || null
      ]);

      await client.query('COMMIT');
    } catch (errDb) {
      await client.query('ROLLBACK');
      console.error('❌ [Postgres] Erro ao salvar faturamento no banco:', errDb.message);
      throw errDb;
    } finally {
      client.release();
    }
  }

  return summary;
}

/**
 * Consulta estatísticas e totais gerais de faturamento persistidos
 */
async function getFaturamentoHistoricoStats() {
  const p = getPool();
  if (p) {
    try {
      const res = await p.query(`
        SELECT 
          COUNT(*) AS total_itens,
          COUNT(DISTINCT (empresa_cod || '-' || nota_doc || '-' || nota_serie)) AS total_notas,
          COUNT(DISTINCT mes_ano) AS total_meses,
          COALESCE(SUM(valor_total_item), 0) AS total_faturado,
          MIN(data_emissao) AS primeira_emissao,
          MAX(data_emissao) AS ultima_emissao
        FROM faturamento_itens_historico;
      `);
      if (res.rows && res.rows[0]) {
        return {
          total_itens: Number(res.rows[0].total_itens) || 0,
          total_notas: Number(res.rows[0].total_notas) || 0,
          total_meses: Number(res.rows[0].total_meses) || 0,
          total_faturado: Number(res.rows[0].total_faturado) || 0,
          primeira_emissao: res.rows[0].primeira_emissao,
          ultima_emissao: res.rows[0].ultima_emissao
        };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar stats de faturamento:', err.message);
    }
  }

  // Fallback cache JSON
  try {
    if (fs.existsSync(faturamentoCacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(faturamentoCacheFile, 'utf-8'));
      const itens = cacheData.itens || [];
      const distinctNotas = new Set(itens.map(i => `${i.empresa_cod}-${i.nota_doc}-${i.nota_serie}`));
      const distinctMeses = new Set(itens.map(i => i.mes_ano));
      return {
        total_itens: itens.length,
        total_notas: distinctNotas.size,
        total_meses: distinctMeses.size,
        total_faturado: itens.reduce((acc, it) => acc + Number(it.valor_total_item || 0), 0),
        primeira_emissao: itens.length > 0 ? itens[itens.length - 1].data_emissao : null,
        ultima_emissao: itens.length > 0 ? itens[0].data_emissao : null
      };
    }
  } catch {}

  return null;
}

/**
 * Retorna o último registro de log da sincronização de faturamento
 */
async function getUltimoSyncFaturamentoLog() {
  const p = getPool();
  if (p) {
    try {
      const res = await p.query(`
        SELECT id, status, total_itens, total_valor_faturado, duracao_ms, triggered_by, error_message, created_at
        FROM faturamento_sync_logs
        ORDER BY id DESC
        LIMIT 1;
      `);
      if (res.rows && res.rows.length > 0) {
        const r = res.rows[0];
        return {
          id: r.id,
          status: r.status,
          total_itens: Number(r.total_itens) || 0,
          total_valor_faturado: Number(r.total_valor_faturado) || 0,
          duracao_ms: Number(r.duracao_ms) || 0,
          triggered_by: r.triggered_by,
          error_message: r.error_message,
          created_at: r.created_at ? new Date(r.created_at).toISOString() : null
        };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar último log em faturamento_sync_logs:', err.message);
    }
  }

  // Fallback cache JSON
  try {
    if (fs.existsSync(faturamentoCacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(faturamentoCacheFile, 'utf-8'));
      if (cacheData.metadata) {
        return {
          ...cacheData.metadata,
          created_at: cacheData.metadata.synced_at || new Date().toISOString()
        };
      }
    }
  } catch {}

  return null;
}

/**
 * ----------------------------------------------------------------------------
 * GESTÃO DE TAREFAS E WORKFLOW OPERACIONAL (POSTGRESQL / SUPABASE COM FALLBACK JSON)
 * ----------------------------------------------------------------------------
 */

function readLocalTarefas() {
  return safeReadJsonSync(tarefasFile, []);
}

function writeLocalTarefas(tarefas) {
  safeWriteJsonSync(tarefasFile, tarefas);
}

async function getTarefasDB({ status, responsavel, prioridade, busca, limit = 50, offset = 0, isAdmin = false, currentUsername = '' } = {}) {
  const p = getPool();
  if (p) {
    try {
      const conditions = [];
      const params = [];
      let paramIdx = 1;

      // Isolamento de Perfil: Usuário comum visualiza apenas tarefas atribuídas a ele
      if (!isAdmin) {
        conditions.push(`responsavel_username = $${paramIdx++}`);
        params.push(String(currentUsername).toLowerCase().trim());
      } else if (responsavel && responsavel !== 'TODOS') {
        conditions.push(`responsavel_username = $${paramIdx++}`);
        params.push(String(responsavel).toLowerCase().trim());
      }

      if (status && status !== 'TODOS') {
        conditions.push(`status = $${paramIdx++}`);
        params.push(status);
      }

      if (prioridade && prioridade !== 'TODOS') {
        conditions.push(`prioridade = $${paramIdx++}`);
        params.push(prioridade);
      }

      if (busca && String(busca).trim()) {
        conditions.push(`(titulo ILIKE $${paramIdx} OR descricao ILIKE $${paramIdx})`);
        params.push(`%${String(busca).trim()}%`);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countSql = `SELECT COUNT(*) FROM tarefas ${whereClause};`;
      const countRes = await safeQuery(countSql, params);
      const total = parseInt(countRes.rows[0].count, 10);

      const dataSql = `
        SELECT id, titulo, descricao, status, prioridade, responsavel_username, responsavel_nome,
               criado_por_username, criado_por_nome, data_limite, comentarios,
               created_at, updated_at, concluida_at, finalizada_at
        FROM tarefas
        ${whereClause}
        ORDER BY 
          CASE 
            WHEN status = 'REABERTA' THEN 1
            WHEN status = 'PENDENTE' THEN 2
            WHEN status = 'CONCLUIDA' THEN 3
            WHEN status = 'FINALIZADA' THEN 4
            ELSE 5
          END,
          CASE 
            WHEN prioridade = 'URGENTE' THEN 1
            WHEN prioridade = 'ALTA' THEN 2
            WHEN prioridade = 'NORMAL' THEN 3
            ELSE 4
          END,
          created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++};
      `;
      const dataParams = [...params, Number(limit) || 50, Number(offset) || 0];
      const dataRes = await safeQuery(dataSql, dataParams);

      return {
        items: dataRes.rows,
        total,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0
      };
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao consultar tarefas no banco:', err.message);
    }
  }

  // Fallback JSON local
  let items = readLocalTarefas();
  if (!isAdmin) {
    items = items.filter(t => (t.responsavel_username || '').toLowerCase() === String(currentUsername).toLowerCase());
  } else if (responsavel && responsavel !== 'TODOS') {
    items = items.filter(t => (t.responsavel_username || '').toLowerCase() === String(responsavel).toLowerCase());
  }

  if (status && status !== 'TODOS') {
    items = items.filter(t => t.status === status);
  }
  if (prioridade && prioridade !== 'TODOS') {
    items = items.filter(t => t.prioridade === prioridade);
  }
  if (busca && String(busca).trim()) {
    const q = String(busca).toLowerCase().trim();
    items = items.filter(t => (t.titulo && t.titulo.toLowerCase().includes(q)) || (t.descricao && t.descricao.toLowerCase().includes(q)));
  }

  items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const total = items.length;
  const sliced = items.slice(offset, offset + limit);

  return { items: sliced, total, limit, offset };
}

async function getTarefasKpisDB({ isAdmin = false, currentUsername = '' } = {}) {
  const p = getPool();
  if (p) {
    try {
      const scopeFilter = !isAdmin 
        ? `WHERE responsavel_username = '${String(currentUsername).toLowerCase().replace(/'/g, "''")}'` 
        : '';
      
      const sql = `
        SELECT 
          COUNT(*) FILTER (WHERE status = 'PENDENTE') AS pendentes,
          COUNT(*) FILTER (WHERE status = 'CONCLUIDA') AS aguardando_validacao,
          COUNT(*) FILTER (WHERE status = 'REABERTA' OR (status = 'PENDENTE' AND prioridade = 'URGENTE')) AS reabertas_urgentes,
          COUNT(*) FILTER (WHERE status = 'FINALIZADA' OR (status = 'CONCLUIDA' AND DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', CURRENT_DATE))) AS concluidas_mes,
          COUNT(*) AS total
        FROM tarefas
        ${scopeFilter};
      `;
      const res = await safeQuery(sql);
      if (res && res.rows && res.rows.length > 0) {
        const r = res.rows[0];
        return {
          pendentes: Number(r.pendentes) || 0,
          aguardando_validacao: Number(r.aguardando_validacao) || 0,
          reabertas_urgentes: Number(r.reabertas_urgentes) || 0,
          concluidas_mes: Number(r.concluidas_mes) || 0,
          total: Number(r.total) || 0
        };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar KPIs de tarefas:', err.message);
    }
  }

  // Fallback JSON local
  let items = readLocalTarefas();
  if (!isAdmin) {
    items = items.filter(t => (t.responsavel_username || '').toLowerCase() === String(currentUsername).toLowerCase());
  }
  return {
    pendentes: items.filter(t => t.status === 'PENDENTE').length,
    aguardando_validacao: items.filter(t => t.status === 'CONCLUIDA').length,
    reabertas_urgentes: items.filter(t => t.status === 'REABERTA' || (t.status === 'PENDENTE' && t.prioridade === 'URGENTE')).length,
    concluidas_mes: items.filter(t => t.status === 'FINALIZADA' || t.status === 'CONCLUIDA').length,
    total: items.length
  };
}

async function getTarefaByIdDB(id) {
  const numId = parseInt(id, 10);
  if (!numId) return null;

  const p = getPool();
  if (p) {
    try {
      const res = await safeQuery('SELECT * FROM tarefas WHERE id = $1;', [numId]);
      if (res && res.rows.length > 0) {
        return res.rows[0];
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao consultar tarefa por ID:', err.message);
    }
  }

  const items = readLocalTarefas();
  return items.find(t => t.id === numId) || null;
}

async function createTarefaDB({
  titulo,
  descricao = '',
  status = 'PENDENTE',
  prioridade = 'NORMAL',
  responsavel_username,
  responsavel_nome = '',
  criado_por_username,
  criado_por_nome = '',
  data_limite = null
}) {
  const cleanRespUser = String(responsavel_username || '').toLowerCase().trim();
  const cleanCriadoUser = String(criado_por_username || 'sistema').toLowerCase().trim();

  const p = getPool();
  if (p) {
    try {
      const sql = `
        INSERT INTO tarefas (
          titulo, descricao, status, prioridade, 
          responsavel_username, responsavel_nome, 
          criado_por_username, criado_por_nome, 
          data_limite, comentarios, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, NOW(), NOW())
        RETURNING *;
      `;
      const res = await safeQuery(sql, [
        String(titulo).trim(),
        String(descricao || '').trim(),
        status,
        prioridade,
        cleanRespUser,
        responsavel_nome || cleanRespUser,
        cleanCriadoUser,
        criado_por_nome || cleanCriadoUser,
        data_limite || null
      ]);
      if (res && res.rows.length > 0) {
        return res.rows[0];
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao inserir tarefa no banco:', err.message);
    }
  }

  // Fallback JSON local
  const items = readLocalTarefas();
  const nextId = items.length > 0 ? Math.max(...items.map(t => t.id || 0)) + 1 : 1;
  const nova = {
    id: nextId,
    titulo: String(titulo).trim(),
    descricao: String(descricao || '').trim(),
    status,
    prioridade,
    responsavel_username: cleanRespUser,
    responsavel_nome: responsavel_nome || cleanRespUser,
    criado_por_username: cleanCriadoUser,
    criado_por_nome: criado_por_nome || cleanCriadoUser,
    data_limite: data_limite || null,
    comentarios: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  items.push(nova);
  writeLocalTarefas(items);
  return nova;
}

async function updateTarefaDB(id, updates = {}) {
  const numId = parseInt(id, 10);
  if (!numId) return null;

  const p = getPool();
  if (p) {
    try {
      const fields = [];
      const params = [];
      let paramIdx = 1;

      if (updates.titulo !== undefined) {
        fields.push(`titulo = $${paramIdx++}`);
        params.push(String(updates.titulo).trim());
      }
      if (updates.descricao !== undefined) {
        fields.push(`descricao = $${paramIdx++}`);
        params.push(String(updates.descricao).trim());
      }
      if (updates.status !== undefined) {
        fields.push(`status = $${paramIdx++}`);
        params.push(updates.status);
        if (updates.status === 'CONCLUIDA') {
          fields.push(`concluida_at = NOW()`);
        } else if (updates.status === 'FINALIZADA') {
          fields.push(`finalizada_at = NOW()`);
        } else if (updates.status === 'REABERTA') {
          fields.push(`finalizada_at = NULL`);
        }
      }
      if (updates.prioridade !== undefined) {
        fields.push(`prioridade = $${paramIdx++}`);
        params.push(updates.prioridade);
      }
      if (updates.responsavel_username !== undefined) {
        fields.push(`responsavel_username = $${paramIdx++}`);
        params.push(String(updates.responsavel_username).toLowerCase().trim());
      }
      if (updates.responsavel_nome !== undefined) {
        fields.push(`responsavel_nome = $${paramIdx++}`);
        params.push(String(updates.responsavel_nome).trim());
      }
      if (updates.data_limite !== undefined) {
        fields.push(`data_limite = $${paramIdx++}`);
        params.push(updates.data_limite || null);
      }

      fields.push(`updated_at = NOW()`);

      if (fields.length > 0) {
        const sql = `UPDATE tarefas SET ${fields.join(', ')} WHERE id = $${paramIdx} RETURNING *;`;
        params.push(numId);
        const res = await safeQuery(sql, params);
        if (res && res.rows.length > 0) {
          return res.rows[0];
        }
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao atualizar tarefa no banco:', err.message);
    }
  }

  // Fallback JSON local
  const items = readLocalTarefas();
  const idx = items.findIndex(t => t.id === numId);
  if (idx === -1) return null;

  const current = items[idx];
  const updated = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString()
  };
  if (updates.status === 'CONCLUIDA') updated.concluida_at = new Date().toISOString();
  if (updates.status === 'FINALIZADA') updated.finalizada_at = new Date().toISOString();
  if (updates.status === 'REABERTA') updated.finalizada_at = null;

  items[idx] = updated;
  writeLocalTarefas(items);
  return updated;
}

async function addComentarioTarefaDB(id, { autor_username, autor_nome, mensagem }) {
  const numId = parseInt(id, 10);
  if (!numId || !mensagem || !String(mensagem).trim()) return null;

  const novoComentario = {
    id: Date.now(),
    autor_username: String(autor_username || 'sistema').toLowerCase().trim(),
    autor_nome: String(autor_nome || autor_username || 'Sistema').trim(),
    mensagem: String(mensagem).trim(),
    created_at: new Date().toISOString()
  };

  const p = getPool();
  if (p) {
    try {
      const sql = `
        UPDATE tarefas 
        SET comentarios = COALESCE(comentarios, '[]'::jsonb) || $1::jsonb,
            updated_at = NOW()
        WHERE id = $2
        RETURNING *;
      `;
      const res = await safeQuery(sql, [JSON.stringify(novoComentario), numId]);
      if (res && res.rows.length > 0) {
        return { tarefa: res.rows[0], comentario: novoComentario };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao anexar comentário à tarefa:', err.message);
    }
  }

  // Fallback JSON local
  const items = readLocalTarefas();
  const idx = items.findIndex(t => t.id === numId);
  if (idx === -1) return null;

  if (!Array.isArray(items[idx].comentarios)) {
    items[idx].comentarios = [];
  }
  items[idx].comentarios.push(novoComentario);
  items[idx].updated_at = new Date().toISOString();
  writeLocalTarefas(items);
  return { tarefa: items[idx], comentario: novoComentario };
}

async function deleteTarefaDB(id) {
  const numId = parseInt(id, 10);
  if (!numId) return false;

  const p = getPool();
  if (p) {
    try {
      await safeQuery('DELETE FROM tarefas WHERE id = $1;', [numId]);
      return true;
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao deletar tarefa:', err.message);
    }
  }

  const items = readLocalTarefas();
  const filtered = items.filter(t => t.id !== numId);
  writeLocalTarefas(filtered);
  return true;
}

const DEFAULT_USER_LINKS = [
  { id: '1', titulo: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox', icon: '✉️' },
  { id: '2', titulo: 'Google Drive', url: 'https://drive.google.com/drive', icon: '📁' },
  { id: '3', titulo: 'CNPJ Receita', url: 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/', icon: '🏛️' },
  { id: '4', titulo: 'Sintegra', url: 'https://www.sintegra.gov.br/', icon: '📊' },
  { id: '5', titulo: 'PipeDrive', url: 'https://benetroncomercial.pipedrive.com/deals/pipeline/1/filter/41', icon: '🎯' }
];

async function getUserLinksDB(username) {
  const cleanUser = String(username || '').toLowerCase().trim();
  const p = getPool();
  if (p) {
    try {
      const res = await safeQuery('SELECT links_favoritos FROM users WHERE username = $1;', [cleanUser]);
      if (res && res.rows.length > 0) {
        const raw = res.rows[0].links_favoritos;
        const links = Array.isArray(raw) ? raw : (raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null);
        if (links && links.length > 0) return links;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar links_favoritos:', err.message);
    }
  }

  // Fallback users.json
  const users = safeReadJsonSync(usersFile, []);
  const u = users.find(x => (x.username || '').toLowerCase() === cleanUser);
  if (u && Array.isArray(u.links_favoritos) && u.links_favoritos.length > 0) {
    return u.links_favoritos;
  }

  return DEFAULT_USER_LINKS;
}

async function saveUserLinksDB(username, links) {
  const cleanUser = String(username || '').toLowerCase().trim();
  const cleanLinks = Array.isArray(links) ? links : [];
  const p = getPool();
  if (p) {
    try {
      await safeQuery('UPDATE users SET links_favoritos = $1::jsonb, updated_at = NOW() WHERE username = $2;', [
        JSON.stringify(cleanLinks),
        cleanUser
      ]);
      return cleanLinks;
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar links_favoritos:', err.message);
    }
  }

  // Fallback users.json
  const users = safeReadJsonSync(usersFile, []);
  const idx = users.findIndex(x => (x.username || '').toLowerCase() === cleanUser);
  if (idx !== -1) {
    users[idx].links_favoritos = cleanLinks;
    safeWriteJsonSync(usersFile, users);
  }
  return cleanLinks;
}

async function addUserLinkDB(username, { titulo, url, icon = '🔗' }) {
  const current = await getUserLinksDB(username);
  const newLink = {
    id: String(Date.now()),
    titulo: String(titulo || '').trim(),
    url: String(url || '').trim(),
    icon: icon || '🔗'
  };
  const updated = [...current, newLink];
  await saveUserLinksDB(username, updated);
  return { links: updated, link: newLink };
}

async function deleteUserLinkDB(username, linkId) {
  const current = await getUserLinksDB(username);
  const updated = current.filter(l => String(l.id) !== String(linkId));
  await saveUserLinksDB(username, updated);
  return { links: updated };
}

/**
 * Salva decisão de autorização de desconto (Postgres + Fallback JSON)
 */
async function saveAutorizacaoDescontoDB(data) {
  const record = {
    deal_id: parseInt(data.deal_id || data.dealId, 10),
    solicitante_nome: String(data.solicitante_nome || data.solicitanteNome || 'Vendedor').trim(),
    cliente_nome: String(data.cliente_nome || data.clienteNome || 'Cliente').trim(),
    valor_total: parseFloat(data.valor_total || data.valorTotal || data.valorVendaFinal) || 0.0,
    preco_unitario_autorizado: parseFloat(data.preco_unitario_autorizado || data.precoUnitarioAutorizado || data.precoUnitarioAutorizadoMedio) || 0.0,
    margem_pct: parseFloat(data.margem_pct || data.margemPct) || 0.0,
    lucro_bruto: parseFloat(data.lucro_bruto || data.lucroBruto) || 0.0,
    desconto_pct: parseFloat(data.desconto_pct || data.descontoPct) || 0.0,
    desconto_reais: parseFloat(data.desconto_reais || data.descontoReais) || 0.0,
    cond_pagamento_label: String(data.cond_pagamento_label || data.condPgtoLabel || 'Não informada').trim(),
    tipo_frete: String(data.tipo_frete || data.tipoFrete || 'FOB').trim(),
    frete_cliente: parseFloat(data.frete_cliente || data.freteCliente) || 0.0,
    frete_embutido: parseFloat(data.frete_embutido || data.freteEmbutido) || 0.0,
    status: String(data.status || 'AUTORIZADO').trim().toUpperCase(),
    usuario_decisor: String(data.usuario_decisor || data.usuarioDecisor || 'admin').trim(),
    usuario_decisor_nome: String(data.usuario_decisor_nome || data.usuarioDecisorNome || data.usuario_decisor || 'Diretoria').trim(),
    observacoes: String(data.observacoes || '').trim(),
    nota_pipedrive: String(data.nota_pipedrive || data.notaPipedrive || '').trim(),
    dados_completos: data.dados_completos || data.dadosCompletos || data,
    created_at: data.created_at || new Date().toISOString()
  };

  const p = getPool();
  let savedId = null;
  if (p) {
    try {
      const sql = `
        INSERT INTO bi_autorizacoes_desconto (
          deal_id, solicitante_nome, cliente_nome, valor_total, preco_unitario_autorizado,
          margem_pct, lucro_bruto, desconto_pct, desconto_reais, cond_pagamento_label,
          tipo_frete, frete_cliente, frete_embutido, status, usuario_decisor,
          usuario_decisor_nome, observacoes, nota_pipedrive, dados_completos, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        ) RETURNING id, created_at;
      `;
      const res = await safeQuery(sql, [
        record.deal_id,
        record.solicitante_nome,
        record.cliente_nome,
        record.valor_total,
        record.preco_unitario_autorizado,
        record.margem_pct,
        record.lucro_bruto,
        record.desconto_pct,
        record.desconto_reais,
        record.cond_pagamento_label,
        record.tipo_frete,
        record.frete_cliente,
        record.frete_embutido,
        record.status,
        record.usuario_decisor,
        record.usuario_decisor_nome,
        record.observacoes,
        record.nota_pipedrive,
        JSON.stringify(record.dados_completos),
        record.created_at
      ]);
      if (res && res.rows && res.rows.length > 0) {
        savedId = res.rows[0].id;
        record.id = savedId;
        record.created_at = res.rows[0].created_at;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar autorização de desconto no banco:', err.message);
    }
  }

  // Fallback JSON local com safe_json_storage
  try {
    const list = safeReadJsonSync(biAutorizacoesCacheFile, []);
    if (!record.id) {
      record.id = list.length > 0 ? (Math.max(...list.map(x => x.id || 0)) + 1) : 1;
    }
    list.unshift(record);
    if (list.length > 500) list.length = 500;
    await safeWriteJson(biAutorizacoesCacheFile, list);
  } catch (err) {
    console.warn('⚠️ [Storage] Falha ao persistir em bi_autorizacoes_cache.json:', err.message);
  }

  return record;
}

/**
 * Consulta histórico paginado de autorizações de desconto
 * Envelope: { items, pagination: { page, limit, total, totalPages, hasNext, hasPrev } }
 */
async function getAutorizacoesDescontoDB({ page = 1, limit = 50, deal_id, status, search } = {}) {
  const pNum = Math.max(1, parseInt(page, 10) || 1);
  const lNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pNum - 1) * lNum;

  const p = getPool();
  if (p) {
    try {
      const conditions = [];
      const params = [];
      let pIdx = 1;

      if (deal_id) {
        conditions.push(`deal_id = $${pIdx++}`);
        params.push(parseInt(deal_id, 10));
      }
      if (status && status !== 'TODOS') {
        conditions.push(`status = $${pIdx++}`);
        params.push(String(status).trim().toUpperCase());
      }
      if (search) {
        conditions.push(`(cliente_nome ILIKE $${pIdx} OR solicitante_nome ILIKE $${pIdx} OR usuario_decisor_nome ILIKE $${pIdx} OR observacoes ILIKE $${pIdx})`);
        params.push(`%${search.trim()}%`);
        pIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countSql = `SELECT COUNT(*) AS total FROM bi_autorizacoes_desconto ${whereClause};`;
      const countRes = await safeQuery(countSql, params);
      const total = countRes && countRes.rows.length > 0 ? parseInt(countRes.rows[0].total, 10) : 0;
      const totalPages = Math.max(1, Math.ceil(total / lNum));

      // Fetch items
      const selectSql = `
        SELECT
          id, deal_id, solicitante_nome, cliente_nome, valor_total, preco_unitario_autorizado,
          margem_pct, lucro_bruto, desconto_pct, desconto_reais, cond_pagamento_label,
          tipo_frete, frete_cliente, frete_embutido, status, usuario_decisor,
          usuario_decisor_nome, observacoes, nota_pipedrive, dados_completos, created_at
        FROM bi_autorizacoes_desconto
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${pIdx++} OFFSET $${pIdx++};
      `;
      const selectParams = [...params, lNum, offset];
      const res = await safeQuery(selectSql, selectParams);
      const items = res && res.rows ? res.rows : [];

      return {
        items,
        pagination: {
          page: pNum,
          limit: lNum,
          total,
          totalPages,
          hasNext: pNum < totalPages,
          hasPrev: pNum > 1
        }
      };
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar histórico de autorizações no banco:', err.message);
    }
  }

  // Fallback JSON local
  let list = safeReadJsonSync(biAutorizacoesCacheFile, []);
  if (deal_id) {
    const dId = parseInt(deal_id, 10);
    list = list.filter(x => x.deal_id === dId);
  }
  if (status && status !== 'TODOS') {
    const st = String(status).trim().toUpperCase();
    list = list.filter(x => (x.status || '').toUpperCase() === st);
  }
  if (search) {
    const term = String(search).toLowerCase().trim();
    list = list.filter(x => 
      (x.cliente_nome || '').toLowerCase().includes(term) ||
      (x.solicitante_nome || '').toLowerCase().includes(term) ||
      (x.usuario_decisor_nome || '').toLowerCase().includes(term) ||
      (x.observacoes || '').toLowerCase().includes(term)
    );
  }

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / lNum));
  const items = list.slice(offset, offset + lNum);

  return {
    items,
    pagination: {
      page: pNum,
      limit: lNum,
      total,
      totalPages,
      hasNext: pNum < totalPages,
      hasPrev: pNum > 1
    }
  };
}

// ============================================================================
// CONFIGURAÇÃO DE METAS DE VENDAS & PRÊMIOS
// ============================================================================

const DEFAULT_METAS_VENDAS = {
  metaBaseVendas: 120000.00,
  premioMeta100: 400.00,
  premioMeta150: 600.00,
  premioMeta200: 1000.00,
  premioGordura700: 200.00,
  premioGordura1100: 300.00,
  premioGordura1500: 400.00,
  premioGordura2100: 500.00,
  premioGordura3000: 600.00
};

async function getConfigMetasVendasDB() {
  if (getPool()) {
    try {
      const res = await safeQuery(`SELECT valor, atualizado_por, atualizado_em FROM system_configs WHERE chave = 'config_metas_vendas' LIMIT 1;`);
      if (res && res.rows && res.rows.length > 0) {
        const raw = res.rows[0].valor;
        const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return {
          ...DEFAULT_METAS_VENDAS,
          ...val,
          _atualizadoPor: res.rows[0].atualizado_por || 'Sistema',
          _atualizadoEm: res.rows[0].atualizado_em || null
        };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao ler config_metas_vendas:', err.message);
    }
  }

  // Fallback JSON local
  const localVal = safeReadJsonSync(configMetasVendasFile, null);
  if (localVal) {
    return { ...DEFAULT_METAS_VENDAS, ...localVal };
  }
  return { ...DEFAULT_METAS_VENDAS };
}

async function saveConfigMetasVendasDB(metasData, usuario = 'Sistema') {
  const merged = {
    metaBaseVendas: parseFloat(metasData.metaBaseVendas ?? DEFAULT_METAS_VENDAS.metaBaseVendas) || 120000,
    premioMeta100: parseFloat(metasData.premioMeta100 ?? DEFAULT_METAS_VENDAS.premioMeta100) || 400,
    premioMeta150: parseFloat(metasData.premioMeta150 ?? DEFAULT_METAS_VENDAS.premioMeta150) || 600,
    premioMeta200: parseFloat(metasData.premioMeta200 ?? DEFAULT_METAS_VENDAS.premioMeta200) || 1000,
    premioGordura700: parseFloat(metasData.premioGordura700 ?? DEFAULT_METAS_VENDAS.premioGordura700) || 200,
    premioGordura1100: parseFloat(metasData.premioGordura1100 ?? DEFAULT_METAS_VENDAS.premioGordura1100) || 300,
    premioGordura1500: parseFloat(metasData.premioGordura1500 ?? DEFAULT_METAS_VENDAS.premioGordura1500) || 400,
    premioGordura2100: parseFloat(metasData.premioGordura2100 ?? DEFAULT_METAS_VENDAS.premioGordura2100) || 500,
    premioGordura3000: parseFloat(metasData.premioGordura3000 ?? DEFAULT_METAS_VENDAS.premioGordura3000) || 600,
    atualizadoPor: usuario,
    atualizadoEm: new Date().toISOString()
  };

  // 1. Salva em JSON local primeiro (Resiliência)
  safeWriteJsonSync(configMetasVendasFile, merged);

  // 2. Salva no Postgres / Supabase
  if (getPool()) {
    try {
      await safeQuery(`
        INSERT INTO system_configs (chave, valor, descricao, atualizado_por, atualizado_em)
        VALUES ('config_metas_vendas', $1, 'Configuração de Metas Comerciais e Premiações (Vendas e Gordura de Frete)', $2, NOW())
        ON CONFLICT (chave) DO UPDATE SET
          valor = EXCLUDED.valor,
          atualizado_por = EXCLUDED.atualizado_por,
          atualizado_em = NOW();
      `, [JSON.stringify(merged), usuario]);
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar config_metas_vendas:', err.message);
    }
  }

  return merged;
}

// ============================================================================
// FECHAMENTOS MENSAIS DOS VENDEDORES (PERSISTÊNCIA ACID + JSON FALLBACK)
// ============================================================================

async function salvarFechamentoVendedorDB(item) {
  if (!item || !item.cicloId || !item.codVendedor) {
    throw new Error('Parâmetros obrigatórios ausentes para salvar fechamento de vendedor.');
  }

  const record = {
    ciclo_id: item.cicloId,
    periodo_label: item.periodoLabel || item.periodo?.label || '',
    data_ini: item.dataIni || item.periodo?.dataIniIso || '',
    data_fim: item.dataFim || item.periodo?.dataFimIso || '',
    cod_vendedor: String(item.codVendedor).trim(),
    nome_vendedor: item.nomeVendedor || '',
    vendas_base_bruta: parseFloat(item.vendasBaseBruta || 0),
    fretes_embutidos: parseFloat(item.fretesEmbutidos || 0),
    vendas_base_liquida: parseFloat(item.vendasBaseLiquida || 0),
    meta_vendas_valor: parseFloat(item.metaVendasValor || 120000),
    pct_meta_vendas: parseFloat(item.pctMetaVendas || 0),
    premio_meta_vendas: parseFloat(item.premioMetaVendas || 0),
    faixa_meta_vendas: item.faixaMetaVendas || '',
    gordura_frete_total: parseFloat(item.gorduraFreteTotal || 0),
    premio_gordura_frete: parseFloat(item.premioGorduraFrete || 0),
    faixa_gordura_frete: item.faixaGorduraFrete || '',
    comissao_taxa: parseFloat(item.comissaoTaxa || 0.0130),
    comissao_bruta: parseFloat(item.comissaoBruta || 0),
    inadimplentes_total: parseFloat(item.inadimplentesTotal || 0),
    comissao_liquida: parseFloat(item.comissaoLiquida || 0),
    total_premios: parseFloat(item.totalPremios || 0),
    total_geral_receber: parseFloat(item.totalGeralReceber || 0),
    faturamento_empresas_json: item.faturamentoEmpresas || {},
    benchmarking_json: item.benchmarking || {},
    metas_snapshot_json: item.metasSnapshot || {},
    detalhes_json: item.detalhes || {},
    tipo_geracao: item.tipoGeracao || 'JOB_AUTO',
    gerado_em: new Date().toISOString()
  };

  // 1. Grava no cache JSON local
  try {
    let list = safeReadJsonSync(fechamentosCacheFile, []);
    const idx = list.findIndex(x => x.ciclo_id === record.ciclo_id && x.cod_vendedor === record.cod_vendedor);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...record };
    } else {
      list.push(record);
    }
    safeWriteJsonSync(fechamentosCacheFile, list);
  } catch (errJson) {
    console.warn('⚠️ [Postgres] Erro ao salvar fechamento no cache JSON:', errJson.message);
  }

  // 2. Grava no PostgreSQL / Supabase
  if (getPool()) {
    try {
      const sql = `
        INSERT INTO fechamentos_vendedores (
          ciclo_id, periodo_label, data_ini, data_fim, cod_vendedor, nome_vendedor,
          vendas_base_bruta, fretes_embutidos, vendas_base_liquida, meta_vendas_valor,
          pct_meta_vendas, premio_meta_vendas, faixa_meta_vendas, gordura_frete_total,
          premio_gordura_frete, faixa_gordura_frete, comissao_taxa, comissao_bruta,
          inadimplentes_total, comissao_liquida, total_premios, total_geral_receber,
          faturamento_empresas_json, benchmarking_json, metas_snapshot_json, detalhes_json,
          tipo_geracao, gerado_em
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17, $18,
          $19, $20, $21, $22,
          $23, $24, $25, $26,
          $27, NOW()
        )
        ON CONFLICT (ciclo_id, cod_vendedor) DO UPDATE SET
          periodo_label = EXCLUDED.periodo_label,
          data_ini = EXCLUDED.data_ini,
          data_fim = EXCLUDED.data_fim,
          nome_vendedor = EXCLUDED.nome_vendedor,
          vendas_base_bruta = EXCLUDED.vendas_base_bruta,
          fretes_embutidos = EXCLUDED.fretes_embutidos,
          vendas_base_liquida = EXCLUDED.vendas_base_liquida,
          meta_vendas_valor = EXCLUDED.meta_vendas_valor,
          pct_meta_vendas = EXCLUDED.pct_meta_vendas,
          premio_meta_vendas = EXCLUDED.premio_meta_vendas,
          faixa_meta_vendas = EXCLUDED.faixa_meta_vendas,
          gordura_frete_total = EXCLUDED.gordura_frete_total,
          premio_gordura_frete = EXCLUDED.premio_gordura_frete,
          faixa_gordura_frete = EXCLUDED.faixa_gordura_frete,
          comissao_taxa = EXCLUDED.comissao_taxa,
          comissao_bruta = EXCLUDED.comissao_bruta,
          inadimplentes_total = EXCLUDED.inadimplentes_total,
          comissao_liquida = EXCLUDED.comissao_liquida,
          total_premios = EXCLUDED.total_premios,
          total_geral_receber = EXCLUDED.total_geral_receber,
          faturamento_empresas_json = EXCLUDED.faturamento_empresas_json,
          benchmarking_json = EXCLUDED.benchmarking_json,
          metas_snapshot_json = EXCLUDED.metas_snapshot_json,
          detalhes_json = EXCLUDED.detalhes_json,
          tipo_geracao = EXCLUDED.tipo_geracao,
          gerado_em = NOW()
        RETURNING *;
      `;
      const params = [
        record.ciclo_id, record.periodo_label, record.data_ini, record.data_fim, record.cod_vendedor, record.nome_vendedor,
        record.vendas_base_bruta, record.fretes_embutidos, record.vendas_base_liquida, record.meta_vendas_valor,
        record.pct_meta_vendas, record.premio_meta_vendas, record.faixa_meta_vendas, record.gordura_frete_total,
        record.premio_gordura_frete, record.faixa_gordura_frete, record.comissao_taxa, record.comissao_bruta,
        record.inadimplentes_total, record.comissao_liquida, record.total_premios, record.total_geral_receber,
        JSON.stringify(record.faturamento_empresas_json), JSON.stringify(record.benchmarking_json),
        JSON.stringify(record.metas_snapshot_json), JSON.stringify(record.detalhes_json),
        record.tipo_geracao
      ];
      const res = await safeQuery(sql, params);
      if (res && res.rows && res.rows[0]) {
        return res.rows[0];
      }
    } catch (errDb) {
      console.warn('⚠️ [Postgres] Erro ao gravar fechamento no banco:', errDb.message);
    }
  }

  return record;
}

async function obterFechamentoPorCicloEVendedorDB(cicloId, codVendedor) {
  const cleanCiclo = String(cicloId || '').trim();
  const cleanVend = String(codVendedor || '').trim();

  if (getPool()) {
    try {
      const sql = `
        SELECT * FROM fechamentos_vendedores
        WHERE ciclo_id = $1 AND (cod_vendedor = $2 OR cod_vendedor = $3)
        LIMIT 1;
      `;
      const padded6 = cleanVend.padStart(6, '0');
      const res = await safeQuery(sql, [cleanCiclo, cleanVend, padded6]);
      if (res && res.rows && res.rows[0]) {
        return res.rows[0];
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar fechamento por ciclo e vendedor:', err.message);
    }
  }

  // Fallback JSON local
  const list = safeReadJsonSync(fechamentosCacheFile, []);
  return list.find(x => x.ciclo_id === cleanCiclo && (x.cod_vendedor === cleanVend || x.cod_vendedor === cleanVend.padStart(6, '0'))) || null;
}

async function obterFechamentosPorCicloDB(cicloId) {
  const cleanCiclo = String(cicloId || '').trim();

  if (getPool()) {
    try {
      const sql = `
        SELECT * FROM fechamentos_vendedores
        WHERE ciclo_id = $1
        ORDER BY nome_vendedor ASC;
      `;
      const res = await safeQuery(sql, [cleanCiclo]);
      if (res && res.rows) {
        return res.rows;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar fechamentos por ciclo:', err.message);
    }
  }

  // Fallback JSON local
  const list = safeReadJsonSync(fechamentosCacheFile, []);
  return list.filter(x => x.ciclo_id === cleanCiclo).sort((a, b) => (a.nome_vendedor || '').localeCompare(b.nome_vendedor || ''));
}

async function obterUltimosFechamentosDB({ limite = 12, codVendedor } = {}) {
  const lim = parseInt(limite, 10) || 12;
  const cleanVend = codVendedor ? String(codVendedor).trim() : null;

  if (getPool()) {
    try {
      let sql = `
        SELECT DISTINCT ciclo_id, periodo_label, data_ini, data_fim, MAX(gerado_em) as gerado_em
        FROM fechamentos_vendedores
      `;
      const params = [];
      if (cleanVend) {
        sql += ` WHERE (cod_vendedor = $1 OR cod_vendedor = $2)`;
        params.push(cleanVend, cleanVend.padStart(6, '0'));
      }
      sql += ` GROUP BY ciclo_id, periodo_label, data_ini, data_fim ORDER BY data_fim DESC LIMIT ${lim};`;
      const res = await safeQuery(sql, params);
      if (res && res.rows) {
        return res.rows;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao listar últimos fechamentos:', err.message);
    }
  }

  // Fallback JSON local
  const list = safeReadJsonSync(fechamentosCacheFile, []);
  const map = new Map();
  for (const item of list) {
    if (cleanVend && item.cod_vendedor !== cleanVend && item.cod_vendedor !== cleanVend.padStart(6, '0')) continue;
    if (!map.has(item.ciclo_id)) {
      map.set(item.ciclo_id, {
        ciclo_id: item.ciclo_id,
        periodo_label: item.periodo_label || item.periodoLabel,
        data_ini: item.data_ini || item.dataIni,
        data_fim: item.data_fim || item.dataFim,
        gerado_em: item.gerado_em || item.geradoEm
      });
    }
  }
  const result = Array.from(map.values());
  result.sort((a, b) => (b.data_fim || '').localeCompare(a.data_fim || ''));
  return result.slice(0, lim);
}

function isPostgresConnected() {
  return isConnected;
}

const getUsersDB = getUsers;
const saveUserDB = saveUser;
const deleteUserDB = deleteUser;
const saveHistoryItem = saveHistory;
const saveAnaliseCreditoDB = saveHistoricoCreditoDB;

module.exports = {
  initPostgres,
  safeQuery,
  getUsers,
  getUsersDB,
  saveUser,
  saveUserDB,
  deleteUser,
  deleteUserDB,
  hashPassword,
  verifyPassword,
  create2FAToken,
  verify2FAToken,
  resend2FAToken,
  getHistory,
  saveHistory,
  saveHistoryItem,
  logUserActivity,
  touchUserActivity,
  getAuditSummary,
  getDiagnosticInfo,
  saveInterWebhookEvent,
  getInterWebhookEvents,
  saveAnaliseCreditoDB,
  saveHistoricoCreditoDB,
  getHistoricoCreditoDB,
  saveSaldosEstoqueDB,
  getSaldosEstoqueDB,
  getUltimoSyncEstoqueLog,
  saveFaturamentoHistoricoDB,
  getFaturamentoHistoricoStats,
  getUltimoSyncFaturamentoLog,
  getTarefasDB,
  getTarefasKpisDB,
  getTarefaByIdDB,
  createTarefaDB,
  updateTarefaDB,
  addComentarioTarefaDB,
  deleteTarefaDB,
  getUserLinksDB,
  addUserLinkDB,
  deleteUserLinkDB,
  saveUserLinksDB,
  saveAutorizacaoDescontoDB,
  getAutorizacoesDescontoDB,
  getConfigMetasVendasDB,
  saveConfigMetasVendasDB,
  salvarFechamentoVendedorDB,
  obterFechamentoPorCicloEVendedorDB,
  obterFechamentosPorCicloDB,
  obterUltimosFechamentosDB,
  DEFAULT_METAS_VENDAS,
  isPostgresConnected,
  getPool
};
