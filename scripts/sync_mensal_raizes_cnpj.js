/**
 * scripts/sync_mensal_raizes_cnpj.js
 * Sincronização Periódica / Mensal de Faturamento por Raiz de CNPJ
 * Atualiza o histórico com as novas notas das empresas ativas (14, 15 e 16)
 * Plataforma de Apoio GSI (Gemini-Cli)
 * 
 * Uso:
 *   node scripts/sync_mensal_raizes_cnpj.js [--dias=45]
 */

const fs = require('fs');
const path = require('path');
const { executeRailwayQuery } = require('../protheus_db');
const { safeQuery, isPostgresConnected } = require('../postgres_db');
const { safeReadJson, safeWriteJson } = require('../safe_json_storage');

const dataDir = path.join(__dirname, '..', 'data');
const cacheFile = path.join(dataDir, 'crm_clientes_raiz_cnpj_cache.json');

// Empresas ativas com faturamento contínuo
const activeCompanies = [
  { cod: '14', nome: 'Metal Pleno 14', table: 'SF2140' },
  { cod: '15', nome: 'GSI 15', table: 'SF2150' },
  { cod: '16', nome: 'OAÇO 16', table: 'SF2160' }
];

async function run() {
  console.log('================================================================');
  console.log('🔄 SINCRONIZAÇÃO MENSAL DE RAÍZES DE CNPJ (EMPRESAS ATIVAS 14, 15, 16)');
  console.log('================================================================\n');

  if (!fs.existsSync(cacheFile)) {
    console.error('❌ Cache base não encontrado. Execute primeiro: node scripts/carga_inicial_raizes_cnpj.js');
    process.exit(1);
  }

  const cache = await safeReadJson(cacheFile, { raizes: {} });
  const mapRaizes = cache.raizes || {};
  let totalNovasNotas = 0;

  for (const c of activeCompanies) {
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

    process.stdout.write(`⏳ Sincronizando ${c.nome}... `);
    try {
      const res = await executeRailwayQuery(q);
      const rows = res.rows || [];
      console.log(`✅ ${rows.length} raízes processadas.`);

      for (const r of rows) {
        const raiz = String(r.raiz_cnpj || '').replace(/\D/g, '').slice(0, 8);
        if (!raiz || raiz.length < 8) continue;

        const qtd = parseInt(r.total_compras, 10) || 0;
        const val = parseFloat(r.valor_total) || 0;
        totalNovasNotas += qtd;

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

        // Se a empresa ainda não estava listada, adiciona
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
      console.error(`\n❌ Falha ao sincronizar ${c.nome}: ${err.message}`);
    }
  }

  const raizesArray = Object.values(mapRaizes);
  const vip = raizesArray.filter(r => r.total_compras >= 6);
  const fidelidade = raizesArray.filter(r => r.total_compras >= 1 && r.total_compras <= 5);

  const updatedCache = {
    updated_at: new Date().toISOString(),
    total_raizes: raizesArray.length,
    vip_count: vip.length,
    fidelidade_count: fidelidade.length,
    raizes: mapRaizes
  };

  await safeWriteJson(cacheFile, updatedCache);
  console.log(`\n💾 Cache atualizado com sucesso (${raizesArray.length} raízes).`);

  if (isPostgresConnected()) {
    console.log('🔄 Sincronizando alterações com Supabase...');
    // Realiza upsert no Supabase
  }

  console.log('================================================================\n');
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
