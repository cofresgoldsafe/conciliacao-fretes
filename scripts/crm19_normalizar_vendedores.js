/**
 * scripts/crm19_normalizar_vendedores.js
 *
 * Saneamento de cod_vendedor e nome_vendedor em crm_deals (PostgreSQL) e data/crm_deals_cache.json.
 * Modo padrão: --dry-run (somente leitura e relatório).
 * Para aplicar alterações: node scripts/crm19_normalizar_vendedores.js --apply
 */

const path = require('path');
const { safeQuery, isPostgresConnected, getPool } = require('../postgres_db');
const { safeReadJson, safeWriteJson } = require('../safe_json_storage');
const { resolverCodigoVendedor, obterVendedorPorCodigo } = require('../crm_vendedores');

const applyMode = process.argv.includes('--apply');
const cacheFile = path.join(__dirname, '..', 'data', 'crm_deals_cache.json');

async function normalizarRegistro(deal) {
  const codAtual = String(deal.cod_vendedor || '').trim();
  const nomeAtual = String(deal.nome_vendedor || '').trim();

  let codNovo = await resolverCodigoVendedor(codAtual);
  if (!codNovo && nomeAtual) {
    codNovo = await resolverCodigoVendedor(nomeAtual);
  }
  if (!codNovo) {
    return { alterado: false, semMapeamento: true, codAtual, nomeAtual };
  }

  const vendInfo = await obterVendedorPorCodigo(codNovo);
  const nomeNovo = (vendInfo && vendInfo.nome) || nomeAtual;

  const mudou = codAtual !== codNovo || nomeAtual !== nomeNovo;
  return {
    alterado: mudou,
    semMapeamento: false,
    codAtual,
    nomeAtual,
    codNovo,
    nomeNovo
  };
}

async function executar() {
  console.log(`=== [CRM-19] Saneamento de Vendedores (${applyMode ? 'APPLY' : 'DRY-RUN'}) ===`);

  // 1. Cache Local JSON
  const cache = await safeReadJson(cacheFile, { deals: [], atividades: [] });
  const dealsCache = Array.isArray(cache.deals) ? cache.deals : [];
  let alteradosCache = 0;
  const naoMapeadosCache = [];

  for (const deal of dealsCache) {
    const res = await normalizarRegistro(deal);
    if (res.semMapeamento) {
      naoMapeadosCache.push({ id: deal.id, cod_vendedor: res.codAtual, nome_vendedor: res.nomeAtual });
      continue;
    }
    if (res.alterado) {
      alteradosCache++;
      console.log(`[Cache] Deal #${deal.id}: "${res.codAtual}" ("${res.nomeAtual}") -> "${res.codNovo}" ("${res.nomeNovo}")`);
      if (applyMode) {
        deal.cod_vendedor = res.codNovo;
        deal.nome_vendedor = res.nomeNovo;
        deal.updated_by = 'migracao_crm19';
        deal.updated_at = new Date().toISOString();
      }
    }
  }

  if (applyMode && alteradosCache > 0) {
    cache.updated_by = 'migracao_crm19';
    cache.updated_at = new Date().toISOString();
    await safeWriteJson(cacheFile, cache);
    console.log(`[Cache] ${alteradosCache} registro(s) atualizado(s) em data/crm_deals_cache.json.`);
  } else {
    console.log(`[Cache] ${alteradosCache} registro(s) seriam atualizados (${naoMapeadosCache.length} sem mapeamento).`);
  }

  if (naoMapeadosCache.length > 0) {
    console.warn('[Cache] Registros sem mapeamento:', JSON.stringify(naoMapeadosCache));
  }

  // 2. PostgreSQL (se conectado)
  if (isPostgresConnected()) {
    const dbRes = await safeQuery('SELECT id, cod_vendedor, nome_vendedor FROM crm_deals;');
    const rows = (dbRes && Array.isArray(dbRes.rows)) ? dbRes.rows : [];
    let alteradosDb = 0;
    const naoMapeadosDb = [];
    const paraAtualizarDb = [];

    for (const row of rows) {
      const res = await normalizarRegistro(row);
      if (res.semMapeamento) {
        naoMapeadosDb.push({ id: row.id, cod_vendedor: res.codAtual, nome_vendedor: res.nomeAtual });
        continue;
      }
      if (res.alterado) {
        alteradosDb++;
        console.log(`[Postgres] Deal #${row.id}: "${res.codAtual}" ("${res.nomeAtual}") -> "${res.codNovo}" ("${res.nomeNovo}")`);
        paraAtualizarDb.push({ id: row.id, codNovo: res.codNovo, nomeNovo: res.nomeNovo });
      }
    }

    if (applyMode && paraAtualizarDb.length > 0) {
      const pool = typeof getPool === 'function' ? getPool() : null;
      const client = (pool && typeof pool.connect === 'function') ? await pool.connect() : null;
      const runQuery = client
        ? (sql, params) => client.query(sql, params)
        : (sql, params) => safeQuery(sql, params);

      try {
        await runQuery('BEGIN');
        for (const item of paraAtualizarDb) {
          await runQuery(
            `UPDATE crm_deals
                SET cod_vendedor = $1,
                    nome_vendedor = $2,
                    updated_by = 'migracao_crm19',
                    updated_at = NOW()
              WHERE id = $3;`,
            [item.codNovo, item.nomeNovo, item.id]
          );
        }
        await runQuery('COMMIT');
      } catch (err) {
        await runQuery('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        if (client && typeof client.release === 'function') {
          client.release();
        }
      }
    }

    console.log(`[Postgres] ${alteradosDb} registro(s) ${applyMode ? 'atualizado(s)' : 'seriam atualizados'} (${naoMapeadosDb.length} sem mapeamento).`);
    if (naoMapeadosDb.length > 0) {
      console.warn('[Postgres] Registros sem mapeamento:', JSON.stringify(naoMapeadosDb));
    }
  } else {
    console.log('[Postgres] Banco não conectado neste processo; verificação restrita ao cache local.');
  }
}

if (require.main === module) {
  executar()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Erro ao executar script de normalização:', err);
      process.exit(1);
    });
}

module.exports = { executar, normalizarRegistro };
