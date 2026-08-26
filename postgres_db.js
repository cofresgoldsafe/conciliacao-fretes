const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

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

      // 5. Garante colunas de rastreamento e e-mail na tabela users
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS total_actions INTEGER DEFAULT 0;
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
            { username: 'alexandre', name: 'Alexandre', email: 'alexandre@oaco.com.br', pass: '321654', role: 'admin', permissions: ['logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes'], active: true },
            { username: 'erica', name: 'Érica', email: 'erica@oaco.com.br', pass: '1020304050', role: 'user', permissions: ['logistica', 'consulta'], active: true },
            { username: 'wallerson', name: 'Wallerson', email: 'wallerson@oaco.com.br', pass: '10203040', role: 'user', permissions: ['logistica', 'consulta'], active: true },
            { username: 'juliana', name: 'Juliana', email: 'juliana@oaco.com.br', pass: '102030', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores'], active: true },
            { username: 'andrea', name: 'Andrea', email: 'andrea@oaco.com.br', pass: '102030', role: 'vendedor', vendorCode: '000064', permissions: ['vendedores'], active: true },
            { username: 'figueiredo', name: 'Figueiredo', email: 'figueiredo@oaco.com.br', pass: '102030', role: 'vendedor', vendorCode: '000004', permissions: ['vendedores'], active: true }
          ];
        }

        for (const u of localUsers) {
          const hashedPass = await hashPassword(u.pass || '102030');
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
        // Atualiza cache local
        try {
          fs.writeFileSync(usersFile, JSON.stringify(res.rows, null, 2));
        } catch {}
        return res.rows;
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar usuários no banco, usando cache local:', err.message);
    }
  }

  // Fallback Local
  try {
    if (fs.existsSync(usersFile)) {
      return JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    }
  } catch {}

  return [];
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

  // Atualiza também o arquivo local users.json
  try {
    let localUsers = [];
    if (fs.existsSync(usersFile)) {
      localUsers = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    }
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
    fs.writeFileSync(usersFile, JSON.stringify(localUsers, null, 2));
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

  // Atualiza arquivo local
  try {
    if (fs.existsSync(usersFile)) {
      let localUsers = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      localUsers = localUsers.filter(u => u.username.toLowerCase() !== cleanUser);
      fs.writeFileSync(usersFile, JSON.stringify(localUsers, null, 2));
    }
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
          divergencias,
          detalhes
        FROM history 
        ORDER BY id DESC 
        LIMIT 100;
      `);
      if (res && res.rows && res.rows.length > 0) {
        return res.rows.map(r => ({
          ...r,
          ...(r.detalhes || {})
        }));
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar histórico no banco:', err.message);
    }
  }

  try {
    if (fs.existsSync(historyFile)) {
      return JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    }
  } catch {}

  return [];
}

/**
 * Salva Item no Histórico
 */
async function saveHistoryItem(item) {
  const p = getPool();
  if (p) {
    try {
      await safeQuery(`
        INSERT INTO history (
          fatura_numero, transportadora, empresa, valor_total, qtd_fretes, divergencias, detalhes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [
        item.numeroFatura || item.faturaNumero || item.protheusDoc || 'S/N',
        item.transportadora || 'RODONAVES',
        item.empresa || item.empresaProtheus || 'OACO',
        parseFloat(item.valorTotal || item.valorCobrado || 0),
        parseInt(item.qtdFretes || 1, 10),
        parseInt(item.divergencias || 0, 10),
        JSON.stringify(item)
      ]);
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar histórico no banco:', err.message);
    }
  }

  // Grava também no history.json local
  try {
    let history = [];
    if (fs.existsSync(historyFile)) {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    }
    history.unshift(item);
    if (history.length > 100) history = history.slice(0, 100);
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
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

  // Grava em arquivo local para contingência e atualiza dados do usuário
  try {
    const activitiesFile = path.join(dataDir, 'activities.json');
    let acts = [];
    if (fs.existsSync(activitiesFile)) {
      acts = JSON.parse(fs.readFileSync(activitiesFile, 'utf-8'));
    }
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
    fs.writeFileSync(activitiesFile, JSON.stringify(acts, null, 2));

    // Atualiza data/users.json local
    if (fs.existsSync(usersFile)) {
      let localUsers = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      const uIdx = localUsers.findIndex(u => String(u.username || '').toLowerCase() === cleanUser);
      if (uIdx >= 0) {
        localUsers[uIdx].lastActiveAt = newAct.createdAt;
        if (cleanType === 'LOGIN') localUsers[uIdx].lastLoginAt = newAct.createdAt;
        localUsers[uIdx].totalActions = (localUsers[uIdx].totalActions || 0) + 1;
        fs.writeFileSync(usersFile, JSON.stringify(localUsers, null, 2));
      }
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
    if (fs.existsSync(usersFile)) {
      let localUsers = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      const uIdx = localUsers.findIndex(u => String(u.username || '').toLowerCase() === cleanUser);
      if (uIdx >= 0) {
        localUsers[uIdx].lastActiveAt = new Date().toISOString();
        localUsers[uIdx].totalActions = (localUsers[uIdx].totalActions || 0) + 1;
        fs.writeFileSync(usersFile, JSON.stringify(localUsers, null, 2));
      }
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

  // 2. Fallback em arquivo JSON local serializado por fila para evitar race conditions
  return new Promise((resolve) => {
    writeQueue = writeQueue.then(async () => {
      try {
        let localEvts = [];
        if (fs.existsSync(webhooksFile)) {
          localEvts = JSON.parse(fs.readFileSync(webhooksFile, 'utf-8'));
        }
        const exists = localEvts.some(e => String(e.empresaCodigo) === emp && String(e.eventId) === evtId);
        if (!exists) {
          const newEvt = { id: localEvts.length + 1, empresaCodigo: emp, eventId: evtId, tipo, payload: typeof payload === 'string' ? JSON.parse(payload) : payload, createdAt: now };
          localEvts.unshift(newEvt);
          if (localEvts.length > 200) localEvts = localEvts.slice(0, 200);
          fs.writeFileSync(webhooksFile, JSON.stringify(localEvts, null, 2));
          resolve({ success: true, savedTo: 'json_fallback', event: newEvt });
          return;
        }
        resolve({ success: true, savedTo: 'json_fallback', duplicate: true, eventId: evtId });
      } catch (err) {
        console.error('❌ [Local Webhook Save Error]:', err.message);
        resolve({ success: false, error: err.message });
      }
    });
  });
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
    if (fs.existsSync(webhooksFile)) {
      let localEvts = JSON.parse(fs.readFileSync(webhooksFile, 'utf-8'));
      if (empresaCodigo && empresaCodigo !== 'todas') {
        localEvts = localEvts.filter(e => String(e.empresaCodigo) === String(empresaCodigo));
      }
      return localEvts.slice(0, maxLimit);
    }
  } catch {}

  return [];
}

const analiseCreditoHistoryFile = path.join(dataDir, 'analise_credito_history.json');

/**
 * Salva Análise de Crédito (PostgreSQL + Fallback JSON Local)
 */
async function saveAnaliseCreditoDB(registro) {
  const p = getPool();
  const now = new Date().toISOString();
  const dados = { ...registro };
  const ped = String(dados.pedido_venda || '').trim();
  const emp = String(dados.empresa || '').trim();
  const cliNome = String(dados.cliente_nome || '').trim();
  const cliCod = String(dados.cliente_codigo || '').trim();
  const codWeb = String(dados.cod_web || '').trim();
  const totalPed = Number(dados.total_pedido) || 0;
  const descPed = String(dados.desconto_ped || 'OK').trim();
  const score = parseInt(dados.total_score, 10) || 0;
  const risco = String(dados.risco || '').trim();
  const sugestao = String(dados.sugestao || '').trim();
  const decisao = String(dados.decisao_final || 'Liberado').trim();
  const obs = String(dados.obs || '').trim();
  const usuario = String(dados.usuario || 'Sistema').trim();
  const sugestoesArr = Array.isArray(dados.sugestoes_lista) ? dados.sugestoes_lista : [];

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
        ) RETURNING id, created_at;
      `, [
        ped, emp, cliNome, cliCod, codWeb,
        totalPed, descPed, score, risco, sugestao,
        decisao, obs, usuario, JSON.stringify(sugestoesArr), JSON.stringify({ ...dados, usuario })
      ]);

      if (res && res.rows && res.rows.length > 0) {
        savedItem = {
          id: String(res.rows[0].id),
          ...dados,
          usuario,
          created_at: res.rows[0].created_at ? new Date(res.rows[0].created_at).toISOString() : now
        };
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao salvar análise de crédito no banco:', err.message);
    }
  }

  // Backup em JSON local
  try {
    let localList = [];
    if (fs.existsSync(analiseCreditoHistoryFile)) {
      localList = JSON.parse(fs.readFileSync(analiseCreditoHistoryFile, 'utf-8'));
    }
    const itemToSave = savedItem || {
      id: String(Date.now()),
      ...dados,
      usuario,
      created_at: now
    };
    localList.unshift(itemToSave);
    if (localList.length > 500) localList = localList.slice(0, 500);
    fs.writeFileSync(analiseCreditoHistoryFile, JSON.stringify(localList, null, 2), 'utf-8');
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
          if (!detalhesPts) {
            try {
              const { calcularScore } = require('./analise_credito_engine');
              const resCalc = calcularScore(dadosComp);
              detalhesPts = resCalc.detalhesPontos;
            } catch {}
          }

          return {
            id: String(r.id),
            ...dadosComp,
            pedido_venda: r.pedido_venda,
            empresa: r.empresa,
            cliente_nome: r.cliente_nome,
            cliente_codigo: r.cliente_codigo,
            cod_web: r.cod_web,
            total_pedido: Number(r.total_pedido) || 0,
            desconto_ped: r.desconto_ped,
            total_score: r.total_score,
            risco: r.risco,
            sugestao: r.sugestao,
            decisao_final: r.decisao_final,
            obs: r.obs,
            usuario: r.usuario || dadosComp.usuario || 'Sistema',
            sugestoes_lista: sugLista,
            detalhes_pontos: detalhesPts,
            created_at: r.created_at ? new Date(r.created_at).toISOString() : null
          };
        });
      }
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao buscar histórico de análises de crédito no banco:', err.message);
    }
  }

  // Fallback JSON local
  try {
    if (fs.existsSync(analiseCreditoHistoryFile)) {
      const localList = JSON.parse(fs.readFileSync(analiseCreditoHistoryFile, 'utf-8'));
      if (Array.isArray(localList)) {
        return localList.slice(0, maxLimit).map(item => {
          let pts = item.detalhes_pontos;
          if (!pts) {
            try {
              const { calcularScore } = require('./analise_credito_engine');
              pts = calcularScore(item).detalhesPontos;
            } catch {}
          }
          return { ...item, usuario: item.usuario || 'Sistema', detalhes_pontos: pts };
        });
      }
    }
  } catch {}

  return [];
}

/**
 * Salva a lista de saldos em estoque de produtos (PostgreSQL + Fallback JSON Local)
 */
async function saveSaldosEstoqueDB(produtosList = [], metadata = {}) {
  const p = getPool();
  const now = new Date().toISOString();
  const metaSalvar = {
    status: metadata.status || 'SUCCESS',
    synced_at: now,
    total_produtos: produtosList.length,
    total_saldo_positivo: produtosList.filter(x => Number(x.saldo || 0) > 0).length,
    total_valor_estoque: produtosList.reduce((acc, x) => acc + (Number(x.saldo_total || 0)), 0),
    duracao_ms: metadata.duracao_ms || 0,
    triggered_by: metadata.triggered_by || 'JOB',
    error_message: metadata.error_message || null
  };

  // 1. Grava no cache JSON local garantindo persistência e fallback gracioso
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const payloadCache = {
      metadata: metaSalvar,
      produtos: produtosList
    };
    fs.writeFileSync(estoqueCacheFile, JSON.stringify(payloadCache, null, 2), 'utf-8');
  } catch (errCache) {
    console.warn('⚠️ [Postgres Cache] Erro ao gravar estoque_saldos_cache.json:', errCache.message);
  }

  // 2. Grava no PostgreSQL / Supabase
  if (p && produtosList.length > 0) {
    try {
      const client = await p.connect();
      try {
        await client.query('BEGIN');

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
async function getSaldosEstoqueDB({ search, filtroEstoque, filtroGrupo } = {}) {
  const p = getPool();
  const cleanSearch = (search || '').toLowerCase().trim();
  const cleanFiltro = (filtroEstoque || 'todos').toLowerCase().trim();
  const cleanGrupo = (filtroGrupo || 'todos').trim();

  // 1. Tenta buscar no PostgreSQL
  if (p) {
    try {
      const params = [];
      const whereClauses = [];

      if (cleanSearch) {
        params.push(`%${cleanSearch}%`);
        whereClauses.push(`(LOWER(codigo) LIKE $${params.length} OR LOWER(descricao) LIKE $${params.length})`);
      }

      if (cleanFiltro === 'positivo') {
        whereClauses.push('saldo > 0');
      } else if (cleanFiltro === 'zerado_negativo') {
        whereClauses.push('saldo <= 0');
      } else if (cleanFiltro === 'com_vendas') {
        whereClauses.push('qtd_vendas > 0');
      } else if (cleanFiltro === 'com_compras') {
        whereClauses.push('qtd_compras > 0');
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
        return res.rows.map(r => ({
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

      if (cleanFiltro === 'positivo') {
        produtos = produtos.filter(p => Number(p.saldo || 0) > 0);
      } else if (cleanFiltro === 'zerado_negativo') {
        produtos = produtos.filter(p => Number(p.saldo || 0) <= 0);
      } else if (cleanFiltro === 'com_vendas') {
        produtos = produtos.filter(p => Number(p.qtd_vendas || 0) > 0);
      } else if (cleanFiltro === 'com_compras') {
        produtos = produtos.filter(p => Number(p.qtd_compras || 0) > 0);
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
        return {
          id: r.id,
          status: r.status,
          total_produtos: Number(r.total_produtos) || 0,
          total_saldo_positivo: Number(r.total_saldo_positivo) || 0,
          total_valor_estoque: Number(r.total_valor_estoque) || 0,
          duracao_ms: Number(r.duracao_ms) || 0,
          triggered_by: r.triggered_by,
          error_message: r.error_message,
          created_at: r.created_at ? new Date(r.created_at).toISOString() : null
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
        return {
          ...cacheData.metadata,
          created_at: cacheData.metadata.synced_at || new Date().toISOString()
        };
      }
    }
  } catch {}

  return null;
}

function isPostgresConnected() {
  return isConnected;
}

module.exports = {
  initPostgres,
  safeQuery,
  getUsers,
  saveUser,
  deleteUser,
  hashPassword,
  verifyPassword,
  create2FAToken,
  verify2FAToken,
  resend2FAToken,
  getHistory,
  saveHistoryItem,
  logUserActivity,
  touchUserActivity,
  getAuditSummary,
  getDiagnosticInfo,
  saveInterWebhookEvent,
  getInterWebhookEvents,
  saveAnaliseCreditoDB,
  getHistoricoCreditoDB,
  saveSaldosEstoqueDB,
  getSaldosEstoqueDB,
  getUltimoSyncEstoqueLog,
  isPostgresConnected
};
