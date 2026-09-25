/**
 * scripts/carga_inicial_raizes_cnpj.js
 * Carga Inicial e Consolidação de Faturamento por Raiz de CNPJ (Grupo GSI)
 * Plataforma de Apoio GSI (Gemini-Cli)
 * 
 * Empresas Processadas:
 *   - Inativas: 01 (SF2010), 04 (SF2040), 05 (SF2050), 09 (SF2090)
 *   - Ativas:   14 (SF2140), 15 (SF2150), 16 (SF2160)
 * Destinos:
 *   - Supabase PostgreSQL: crm_clientes_raiz_cnpj (se conectado)
 *   - Cache Local Atômico: data/crm_clientes_raiz_cnpj_cache.json
 * 
 * Uso:
 *   node scripts/carga_inicial_raizes_cnpj.js
 */

const fs = require('fs');
const path = require('path');
const { executeRailwayQuery } = require('../protheus_db');
const { safeQuery, isPostgresConnected } = require('../postgres_db');
const { safeWriteJson } = require('../safe_json_storage');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const cacheFile = path.join(dataDir, 'crm_clientes_raiz_cnpj_cache.json');

const companies = [
  { cod: '01', nome: 'Empresa 01 (Inativa)', table: 'SF2010' },
  { cod: '04', nome: 'Empresa 04 (Inativa)', table: 'SF2040' },
  { cod: '05', nome: 'Empresa 05 (Inativa)', table: 'SF2050' },
  { cod: '09', nome: 'Empresa 09 (Inativa)', table: 'SF2090' },
  { cod: '14', nome: 'Metal Pleno 14 (Ativa)', table: 'SF2140' },
  { cod: '15', nome: 'GSI 15 (Ativa)', table: 'SF2150' },
  { cod: '16', nome: 'OAÇO 16 (Ativa)', table: 'SF2160' }
];

async function run() {
  console.log('================================================================');
  console.log('🚀 INICIANDO CARGA INICIAL DE RAÍZES DE CNPJ (GRUPO GSI)');
  console.log('📦 Minerando 7 Empresas no TOTVS Protheus (01, 04, 05, 09, 14, 15, 16)');
  console.log('================================================================\n');

  const startTime = Date.now();
  const mapRaizes = {};
  let totalNotasProcessadas = 0;

  for (const c of companies) {
    const q = `
      SELECT 
        SUBSTRING(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(a.A1_CGC)), '.', ''), '/', ''), '-', ''), 1, 8) as raiz_cnpj,
        COUNT(DISTINCT f.F2_DOC + f.F2_SERIE) as total_compras,
        MIN(f.F2_EMISSAO) as primeira_compra,
        MAX(f.F2_EMISSAO) as ultima_compra,
        SUM(f.F2_VALBRUT) as valor_total,
        MAX(a.A1_NOME) as razao_social
      FROM ${c.table} f
      INNER JOIN SA1010 a ON a.A1_COD = f.F2_CLIENTE AND a.A1_LOJA = f.F2_LOJA AND a.D_E_L_E_T_ = ''
      WHERE f.D_E_L_E_T_ = '' AND LEN(LTRIM(RTRIM(a.A1_CGC))) >= 8
      GROUP BY SUBSTRING(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(a.A1_CGC)), '.', ''), '/', ''), '-', ''), 1, 8)
    `;

    process.stdout.write(`⏳ Extraindo ${c.nome} (${c.table})... `);
    try {
      const res = await executeRailwayQuery(q);
      const rows = res.rows || [];
      console.log(`✅ ${rows.length} raízes encontradas.`);

      for (const r of rows) {
        const raiz = String(r.raiz_cnpj || '').replace(/\D/g, '').slice(0, 8);
        if (!raiz || raiz.length < 8) continue;

        const qtd = parseInt(r.total_compras, 10) || 0;
        const val = parseFloat(r.valor_total) || 0;
        totalNotasProcessadas += qtd;

        if (!mapRaizes[raiz]) {
          mapRaizes[raiz] = {
            raiz_cnpj: raiz,
            razao_social: (r.razao_social || '').trim(),
            total_compras: 0,
            valor_total: 0,
            primeira_compra: r.primeira_compra || null,
            ultima_compra: r.ultima_compra || null,
            empresas: []
          };
        }

        mapRaizes[raiz].total_compras += qtd;
        mapRaizes[raiz].valor_total += val;
        if (!mapRaizes[raiz].empresas.includes(c.cod)) {
          mapRaizes[raiz].empresas.push(c.cod);
        }

        if (r.primeira_compra && (!mapRaizes[raiz].primeira_compra || r.primeira_compra < mapRaizes[raiz].primeira_compra)) {
          mapRaizes[raiz].primeira_compra = r.primeira_compra;
        }
        if (r.ultima_compra && (!mapRaizes[raiz].ultima_compra || r.ultima_compra > mapRaizes[raiz].ultima_compra)) {
          mapRaizes[raiz].ultima_compra = r.ultima_compra;
        }
        if (r.razao_social && !mapRaizes[raiz].razao_social) {
          mapRaizes[raiz].razao_social = r.razao_social.trim();
        }
      }
    } catch (err) {
      console.error(`\n❌ Falha na extração de ${c.nome}: ${err.message}`);
    }
  }

  const raizesArray = Object.values(mapRaizes);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n================================================================');
  console.log(`🎉 EXTRAÇÃO CONCLUÍDA EM ${duration}s!`);
  console.log(`📊 Total de Raízes de CNPJ Únicas: ${raizesArray.length}`);
  console.log(`🧾 Total de Notas Fiscais Processadas: ${totalNotasProcessadas}`);

  const vip = raizesArray.filter(r => r.total_compras >= 6);
  const fidelidade = raizesArray.filter(r => r.total_compras >= 1 && r.total_compras <= 5);

  console.log(`   - 💎 Diamante VIP (>= 6 compras): ${vip.length} raízes (${((vip.length / raizesArray.length) * 100).toFixed(1)}%)`);
  console.log(`   - ⭐ Fidelidade (1 a 5 compras):   ${fidelidade.length} raízes (${((fidelidade.length / raizesArray.length) * 100).toFixed(1)}%)`);

  // 1. Gravação no Cache Local Atômico
  const cachePayload = {
    updated_at: new Date().toISOString(),
    total_raizes: raizesArray.length,
    vip_count: vip.length,
    fidelidade_count: fidelidade.length,
    raizes: mapRaizes
  };

  await safeWriteJson(cacheFile, cachePayload);
  console.log(`💾 Cache local gravado com sucesso em: ${cacheFile}`);

  // 2. Gravação no Supabase Postgres (se conectado)
  if (isPostgresConnected()) {
    console.log('🔄 Sincronizando com Supabase PostgreSQL...');
    try {
      await safeQuery(`
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
        CREATE INDEX IF NOT EXISTS idx_crm_raiz_total ON crm_clientes_raiz_cnpj(total_compras DESC);
      `);

      // Inserção em lotes de 500
      const batchSize = 500;
      for (let i = 0; i < raizesArray.length; i += batchSize) {
        const batch = raizesArray.slice(i, i + batchSize);
        const valuesList = [];
        const params = [];
        let pIdx = 1;

        for (const item of batch) {
          valuesList.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, $${pIdx+3}, $${pIdx+4}, $${pIdx+5}, $${pIdx+6}::jsonb, NOW(), NOW())`);
          params.push(
            item.raiz_cnpj,
            item.razao_social.slice(0, 255),
            item.total_compras,
            item.valor_total,
            item.primeira_compra ? `${item.primeira_compra.slice(0,4)}-${item.primeira_compra.slice(4,6)}-${item.primeira_compra.slice(6,8)}` : null,
            item.ultima_compra ? `${item.ultima_compra.slice(0,4)}-${item.ultima_compra.slice(4,6)}-${item.ultima_compra.slice(6,8)}` : null,
            JSON.stringify(item.empresas)
          );
          pIdx += 7;
        }

        const insertSql = `
          INSERT INTO crm_clientes_raiz_cnpj (raiz_cnpj, razao_social, total_compras, valor_total, primeira_compra, ultima_compra, empresas, created_at, updated_at)
          VALUES ${valuesList.join(', ')}
          ON CONFLICT (raiz_cnpj) DO UPDATE SET
            razao_social = EXCLUDED.razao_social,
            total_compras = EXCLUDED.total_compras,
            valor_total = EXCLUDED.valor_total,
            primeira_compra = EXCLUDED.primeira_compra,
            ultima_compra = EXCLUDED.ultima_compra,
            empresas = EXCLUDED.empresas,
            updated_at = NOW();
        `;

        await safeQuery(insertSql, params);
      }
      console.log('✅ Supabase PostgreSQL atualizado com sucesso!');
    } catch (errDb) {
      console.warn(`⚠️ Aviso na sincronização do Supabase: ${errDb.message}`);
    }
  } else {
    console.log('ℹ️ Supabase não conectado diretamente no ambiente local. Cache local atômico ativo.');
  }

  console.log('================================================================\n');
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
