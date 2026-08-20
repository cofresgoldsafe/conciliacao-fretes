const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const historyFile = path.join(dataDir, 'history.json');

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

// Inicializa Pool de Conexão com o PostgreSQL
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
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
      max: 10
    });

    pool.on('error', (err) => {
      console.warn('⚠️ [Postgres Pool Error]:', err.message);
      lastDbError = err;
      isConnected = false;
    });

    return pool;
  } catch (err) {
    console.error('❌ [Postgres] Erro ao instanciar Pool:', err.message);
    lastDbError = err;
    return null;
  }
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

      // 5. Garante colunas de rastreamento na tabela users
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS total_actions INTEGER DEFAULT 0;
      `);

      // 6. Cria Tabela de Eventos de Webhook (Banco Inter / Multi-Empresas 14, 15, 16)
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

      // 4. Auto-Seeder / Migração de Usuários Existentes do JSON para o Banco
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
            { username: 'alexandre', name: 'Alexandre', pass: '321654', role: 'admin', permissions: ['logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes'], active: true },
            { username: 'erica', name: 'Érica', pass: '1020304050', role: 'user', permissions: ['logistica', 'consulta'], active: true },
            { username: 'wallerson', name: 'Wallerson', pass: '10203040', role: 'user', permissions: ['logistica', 'consulta'], active: true },
            { username: 'juliana', name: 'Juliana', pass: '102030', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores'], active: true },
            { username: 'andrea', name: 'Andrea', pass: '102030', role: 'vendedor', vendorCode: '000064', permissions: ['vendedores'], active: true },
            { username: 'figueiredo', name: 'Figueiredo', pass: '102030', role: 'vendedor', vendorCode: '000004', permissions: ['vendedores'], active: true }
          ];
        }

        for (const u of localUsers) {
          await client.query(`
            INSERT INTO users (username, name, pass, role, vendor_code, permissions, active)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (username) DO NOTHING;
          `, [
            u.username.toLowerCase().trim(),
            u.name || u.username,
            u.pass,
            u.role || 'user',
            u.vendorCode || null,
            JSON.stringify(u.permissions || ['logistica', 'consulta']),
            u.active !== false
          ]);
        }
        console.log(`✅ [Postgres] Migrados com sucesso ${localUsers.length} usuários para o Supabase PostgreSQL.`);
      }

      // 6. Garante sincronização das senhas atualizadas no Supabase
      await client.query(`
        UPDATE users SET pass = '321654', permissions = '["logistica","consulta","vendedores","financeiro","configuracoes"]'::jsonb WHERE username = 'alexandre';
        UPDATE users SET pass = '10203040' WHERE username = 'wallerson';
      `);

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
  if (p && isConnected) {
    try {
      const res = await p.query(`
        SELECT username, name, pass, role, vendor_code AS "vendorCode", permissions, active 
        FROM users 
        ORDER BY id ASC;
      `);
      if (res.rows && res.rows.length > 0) {
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
  const cleanRole = userData.role || 'user';
  const vendorCode = userData.vendorCode || null;
  const permissions = Array.isArray(userData.permissions) ? userData.permissions : ['logistica', 'consulta'];
  const active = userData.active !== undefined ? !!userData.active : true;

  const p = getPool();
  if (p && isConnected) {
    try {
      if (userData.pass && String(userData.pass).trim() !== '') {
        const cleanPass = String(userData.pass).trim();
        await p.query(`
          INSERT INTO users (username, name, pass, role, vendor_code, permissions, active, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (username) DO UPDATE SET
            name = EXCLUDED.name,
            pass = EXCLUDED.pass,
            role = EXCLUDED.role,
            vendor_code = EXCLUDED.vendor_code,
            permissions = EXCLUDED.permissions,
            active = EXCLUDED.active,
            updated_at = NOW();
        `, [cleanUser, cleanName, cleanPass, cleanRole, vendorCode, JSON.stringify(permissions), active]);
      } else {
        // Atualiza sem mexer na senha
        await p.query(`
          INSERT INTO users (username, name, pass, role, vendor_code, permissions, active, updated_at)
          VALUES ($1, $2, '102030', $3, $4, $5, $6, NOW())
          ON CONFLICT (username) DO UPDATE SET
            name = EXCLUDED.name,
            role = EXCLUDED.role,
            vendor_code = EXCLUDED.vendor_code,
            permissions = EXCLUDED.permissions,
            active = EXCLUDED.active,
            updated_at = NOW();
        `, [cleanUser, cleanName, cleanRole, vendorCode, JSON.stringify(permissions), active]);
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
      if (userData.pass && String(userData.pass).trim() !== '') {
        localUsers[idx].pass = String(userData.pass).trim();
      }
      localUsers[idx].role = cleanRole;
      if (vendorCode) localUsers[idx].vendorCode = vendorCode;
      localUsers[idx].permissions = permissions;
      localUsers[idx].active = active;
    } else {
      localUsers.push({
        username: cleanUser,
        name: cleanName,
        pass: userData.pass || '102030',
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
}

/**
 * Exclui Usuário (PostgreSQL + Sync Local)
 */
async function deleteUser(username) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const p = getPool();
  if (p && isConnected) {
    try {
      await p.query('DELETE FROM users WHERE username = $1;', [cleanUser]);
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
  if (p && isConnected) {
    try {
      const res = await p.query(`
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
      if (res.rows && res.rows.length > 0) {
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
  if (p && isConnected) {
    try {
      await p.query(`
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
  if (p && isConnected) {
    try {
      // 1. Insere log na tabela user_activities
      await p.query(`
        INSERT INTO user_activities (username, user_name, action_type, description, ip_address, metadata)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, [cleanUser, cleanName, cleanType, cleanDesc, ip || '', JSON.stringify(metaObj)]);

      // 2. Atualiza contador e último acesso do usuário
      if (cleanType === 'LOGIN') {
        await p.query(`
          UPDATE users 
          SET last_login_at = NOW(), last_active_at = NOW(), total_actions = COALESCE(total_actions, 0) + 1, updated_at = NOW()
          WHERE username = $1;
        `, [cleanUser]);
      } else {
        await p.query(`
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
 * Retorna o resumo de auditoria para o Admin
 */
async function getAuditSummary() {
  const p = getPool();
  if (p) {
    try {
      const usersRes = await p.query(`
        SELECT 
          id, username, name, role, vendor_code AS "vendorCode", active,
          last_login_at AS "lastLoginAt",
          last_active_at AS "lastActiveAt",
          COALESCE(total_actions, 0) AS "totalActions"
        FROM users 
        ORDER BY COALESCE(last_active_at, created_at) DESC;
      `);

      const actsRes = await p.query(`
        SELECT 
          id, username, user_name AS "userName", action_type AS "actionType", 
          description, ip_address AS "ip", metadata,
          created_at AS "createdAt"
        FROM user_activities 
        ORDER BY id DESC 
        LIMIT 100;
      `);

      const statsRes = await p.query(`
        SELECT 
          COUNT(*) AS "totalActivities",
          COUNT(DISTINCT username) AS "activeUsersCount"
        FROM user_activities;
      `);

      isConnected = true;
      return {
        users: usersRes.rows || [],
        recentActivities: actsRes.rows || [],
        stats: statsRes.rows[0] || { totalActivities: 0, activeUsersCount: 0 },
        dbConnected: true
      };
    } catch (err) {
      console.warn('⚠️ [Postgres] Erro ao obter resumo de auditoria do banco, usando fallback local:', err.message);
      isConnected = false;
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
      const res = await p.query(
        `INSERT INTO inter_webhook_events (empresa_codigo, event_id, tipo, payload, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (empresa_codigo, event_id) DO NOTHING
         RETURNING id, empresa_codigo AS "empresaCodigo", event_id AS "eventId", tipo, created_at AS "createdAt";`,
        [emp, evtId, tipo, rawPayloadStr]
      );
      if (res.rows.length > 0) {
        return { success: true, savedTo: 'postgres', event: res.rows[0] };
      }
      return { success: true, savedTo: 'postgres', duplicate: true, eventId: evtId };
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

      const res = await p.query(query, params);
      return res.rows;
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

function isPostgresConnected() {
  return isConnected;
}

module.exports = {
  initPostgres,
  getUsers,
  saveUser,
  deleteUser,
  getHistory,
  saveHistoryItem,
  logUserActivity,
  getAuditSummary,
  getDiagnosticInfo,
  saveInterWebhookEvent,
  getInterWebhookEvents,
  isPostgresConnected
};
