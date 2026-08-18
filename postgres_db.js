const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const historyFile = path.join(dataDir, 'history.json');

let pool = null;
let isConnected = false;

// Inicializa Pool de Conexão com o PostgreSQL
function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
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
      max: 10
    });

    pool.on('error', (err) => {
      console.warn('⚠️ [Postgres Pool Error]:', err.message);
      isConnected = false;
    });

    return pool;
  } catch (err) {
    console.error('❌ [Postgres] Erro ao instanciar Pool:', err.message);
    return null;
  }
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
            { username: 'alexandre', name: 'Alexandre', pass: '102030', role: 'admin', permissions: ['logistica', 'consulta', 'vendedores', 'configuracoes'], active: true },
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
  isPostgresConnected
};
