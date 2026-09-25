/**
 * scripts/ml_pipedrive_extractor.js
 * Extrator Resiliente em Lotes de Deals do Pipedrive para Análise Preditiva e ML
 * Plataforma de Apoio GSI (Gemini-Cli)
 * 
 * Uso:
 *   node scripts/ml_pipedrive_extractor.js [--limit=10000] [--status=all_not_deleted]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN || '27c8e6f7f9bccd60101889f25369f6075e30f615';
const BASE_URL = 'https://api.pipedrive.com/v1';

// Parâmetros de linha de comando
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const maxTotalDeals = limitArg ? parseInt(limitArg.split('=')[1], 10) : 8000;
const statusArg = args.find(a => a.startsWith('--status='));
const targetStatus = statusArg ? statusArg.split('=')[1] : 'all_not_deleted';

const PAGE_SIZE = 250;
const SLEEP_MS = 250;

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const outputFile = path.join(dataDir, 'ml_pipedrive_dataset.json');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchBatch(start, limit, status) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/deals?status=${encodeURIComponent(status)}&start=${start}&limit=${limit}&sort=id%20DESC&api_token=${PIPEDRIVE_API_TOKEN}`;
    
    const req = https.get(url, { timeout: 20000 }, (res) => {
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} ao consultar Pipedrive: ${rawData.slice(0, 150)}`));
        }
        try {
          const json = JSON.parse(rawData);
          if (!json.success) {
            return reject(new Error(`Erro retornado pelo Pipedrive: ${json.error || 'Desconhecido'}`));
          }
          resolve(json);
        } catch (e) {
          reject(new Error(`Falha no parse JSON: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de 20s na chamada ao Pipedrive'));
    });
  });
}

function sanitizeDeal(d) {
  return {
    id: d.id,
    title: d.title || '',
    status: d.status, // won, lost, open
    value: typeof d.value === 'number' ? d.value : (parseFloat(d.value) || 0),
    currency: d.currency || 'BRL',
    owner_name: d.owner_name || 'Desconhecido',
    user_id: (d.user_id && typeof d.user_id === 'object') ? d.user_id.id : (d.user_id || null),
    notes_count: parseInt(d.notes_count, 10) || 0,
    activities_count: parseInt(d.activities_count, 10) || 0,
    done_activities_count: parseInt(d.done_activities_count, 10) || 0,
    undone_activities_count: parseInt(d.undone_activities_count, 10) || 0,
    email_messages_count: parseInt(d.email_messages_count, 10) || 0,
    products_count: parseInt(d.products_count, 10) || 0,
    files_count: parseInt(d.files_count, 10) || 0,
    lost_reason: d.lost_reason ? String(d.lost_reason).trim() : null,
    add_time: d.add_time || null,
    close_time: d.close_time || null,
    won_time: d.won_time || null,
    lost_time: d.lost_time || null,
    org_id: (d.org_id && typeof d.org_id === 'object') ? d.org_id.value : (d.org_id || null),
    org_name: (d.org_id && typeof d.org_id === 'object') ? d.org_id.name : (d.org_name || ''),
    cond_pgto: d['bdbc4635c15ed6d0add5748159b3a0b1f1b4b5a7'] || null,
    frete_embutido: parseFloat(d['cd279b000a096a971341df192fba61a673ed87d2']) || 0,
    tipo_frete: d['781267dafe83041b9a1d2c099eeef90677f75d0b'] || null,
    transportadora: d['94b2c3fe524af39274f1c8f50ed9732f931a3718'] || null
  };
}

async function run() {
  console.log('================================================================');
  console.log('🚀 INICIANDO EXTRAÇÃO DE DEALS DO PIPEDRIVE EM LOTES');
  console.log(`📦 Alvo Máximo: ${maxTotalDeals} deals | Status: ${targetStatus} | Lote: ${PAGE_SIZE}`);
  console.log('================================================================\n');

  let allDeals = [];
  let start = 0;
  let hasMore = true;
  let page = 1;
  const startTime = Date.now();

  while (hasMore && allDeals.length < maxTotalDeals) {
    const currentLimit = Math.min(PAGE_SIZE, maxTotalDeals - allDeals.length);
    process.stdout.write(`⏳ Lote #${page} (offset: ${start}, limit: ${currentLimit})... `);

    try {
      const response = await fetchBatch(start, currentLimit, targetStatus);
      const deals = response.data || [];
      
      if (deals.length === 0) {
        console.log('Vazio. Fim da coleção.');
        break;
      }

      for (const raw of deals) {
        allDeals.push(sanitizeDeal(raw));
      }

      const pagination = response.additional_data?.pagination;
      hasMore = pagination?.more_items_in_collection === true && pagination?.next_start !== undefined;
      start = pagination?.next_start || (start + deals.length);

      console.log(`✅ Recebidos: ${deals.length} deals (Total acumulado: ${allDeals.length})`);

      if (hasMore && allDeals.length < maxTotalDeals) {
        await sleep(SLEEP_MS);
      }
      page++;
    } catch (err) {
      console.error(`\n❌ Erro no Lote #${page}: ${err.message}`);
      console.log('Tentando novamente em 2 segundos...');
      await sleep(2000);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n================================================================');
  console.log(`🎉 EXTRAÇÃO CONCLUÍDA EM ${durationSec}s!`);
  console.log(`📊 Total de Deals Coletados: ${allDeals.length}`);

  // Resumo de status
  const wonCount = allDeals.filter(d => d.status === 'won').length;
  const lostCount = allDeals.filter(d => d.status === 'lost').length;
  const openCount = allDeals.filter(d => d.status === 'open').length;

  console.log(`   - 🏆 Ganhos (WON): ${wonCount} (${((wonCount / allDeals.length) * 100).toFixed(1)}%)`);
  console.log(`   - ❌ Perdidos (LOST): ${lostCount} (${((lostCount / allDeals.length) * 100).toFixed(1)}%)`);
  console.log(`   - ⏳ Em Aberto (OPEN): ${openCount} (${((openCount / allDeals.length) * 100).toFixed(1)}%)`);

  // Gravação em disco com UTF-8
  const payload = {
    extracted_at: new Date().toISOString(),
    total_count: allDeals.length,
    won_count: wonCount,
    lost_count: lostCount,
    open_count: openCount,
    deals: allDeals
  };

  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`💾 Dataset salvo com sucesso em: ${outputFile}`);
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
