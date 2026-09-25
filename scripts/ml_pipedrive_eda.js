/**
 * scripts/ml_pipedrive_eda.js
 * Motor Estatístico de Análise Exploratória (EDA) e Correlações de Fechamento de Vendas
 * Plataforma de Apoio GSI (Gemini-Cli)
 * 
 * Uso:
 *   node scripts/ml_pipedrive_eda.js
 */

const fs = require('fs');
const path = require('path');

const datasetFile = path.join(__dirname, '..', 'data', 'ml_pipedrive_dataset.json');

if (!fs.existsSync(datasetFile)) {
  console.error(`❌ Arquivo de dataset não encontrado em: ${datasetFile}`);
  console.error('Execute primeiro: node scripts/ml_pipedrive_extractor.js');
  process.exit(1);
}

const rawData = JSON.parse(fs.readFileSync(datasetFile, 'utf-8'));
const deals = rawData.deals || [];

console.log('================================================================');
console.log('📊 RELATÓRIO DE ANÁLISE EXPLORATÓRIA E INTELIGÊNCIA PREDITIVA');
console.log(`📅 Amostra Analisada: ${deals.length} deals extraídos em ${rawData.extracted_at}`);
console.log('================================================================\n');

// 1. Filtrar Deals Concluídos (Won e Lost)
const closedDeals = deals.filter(d => d.status === 'won' || d.status === 'lost');
const openDeals = deals.filter(d => d.status === 'open');

console.log(`📌 Base Fechada (Won/Lost para Treino & Análise): ${closedDeals.length} deals`);
console.log(`   - 🏆 Ganhos (WON): ${closedDeals.filter(d => d.status === 'won').length} (${((closedDeals.filter(d => d.status === 'won').length / closedDeals.length) * 100).toFixed(1)}%)`);
console.log(`   - ❌ Perdidos (LOST): ${closedDeals.filter(d => d.status === 'lost').length} (${((closedDeals.filter(d => d.status === 'lost').length / closedDeals.length) * 100).toFixed(1)}%)`);
console.log(`📌 Base em Aberto (Target Imediato): ${openDeals.length} deals\n`);

function formatBRL(val) {
  return 'R$ ' + (Number(val) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcMetrics(dealsGroup) {
  const total = dealsGroup.length;
  if (total === 0) return { total: 0, won: 0, lost: 0, winRate: 0, totalVal: 0, avgVal: 0 };
  const won = dealsGroup.filter(d => d.status === 'won').length;
  const lost = dealsGroup.filter(d => d.status === 'lost').length;
  const winRate = (won / total) * 100;
  const totalVal = dealsGroup.reduce((acc, d) => acc + (d.value || 0), 0);
  const avgVal = totalVal / total;
  return { total, won, lost, winRate, totalVal, avgVal };
}

function printTable(title, rows) {
  console.log(`----------------------------------------------------------------`);
  console.log(`📈 ${title}`);
  console.log(`----------------------------------------------------------------`);
  console.log(
    'Faixa / Grupo'.padEnd(25) +
    'Total'.padStart(8) +
    'Ganhos'.padStart(8) +
    'Perdidos'.padStart(10) +
    'Win Rate'.padStart(12) +
    'Ticket Médio'.padStart(18)
  );
  console.log('-'.repeat(81));
  for (const r of rows) {
    const rateStr = r.total > 0 ? `${r.winRate.toFixed(1)}%` : '-';
    console.log(
      r.label.padEnd(25) +
      String(r.total).padStart(8) +
      String(r.won).padStart(8) +
      String(r.lost).padStart(10) +
      rateStr.padStart(12) +
      formatBRL(r.avgVal).padStart(18)
    );
  }
  console.log('\n');
}

// -----------------------------------------------------------------------------
// 1. ANÁLISE: IMPACTO DAS ANOTAÇÕES (NOTES_COUNT)
// -----------------------------------------------------------------------------
const noteBuckets = [
  { label: '0 anotações', filter: d => d.notes_count === 0 },
  { label: '1 anotação', filter: d => d.notes_count === 1 },
  { label: '2 anotações', filter: d => d.notes_count === 2 },
  { label: '3 a 4 anotações', filter: d => d.notes_count >= 3 && d.notes_count <= 4 },
  { label: '5 a 8 anotações', filter: d => d.notes_count >= 5 && d.notes_count <= 8 },
  { label: '> 8 anotações', filter: d => d.notes_count > 8 }
];

const noteRows = noteBuckets.map(b => {
  const subset = closedDeals.filter(b.filter);
  const m = calcMetrics(subset);
  return { label: b.label, ...m };
});
printTable('1. IMPACTO DO NÚMERO DE ANOTAÇÕES (NOTES_COUNT)', noteRows);

// -----------------------------------------------------------------------------
// 2. ANÁLISE: IMPACTO DE ATIVIDADES CONCLUÍDAS (DONE_ACTIVITIES_COUNT)
// -----------------------------------------------------------------------------
const actBuckets = [
  { label: '0 concluídas', filter: d => d.done_activities_count === 0 },
  { label: '1 concluída', filter: d => d.done_activities_count === 1 },
  { label: '2 a 3 concluídas', filter: d => d.done_activities_count >= 2 && d.done_activities_count <= 3 },
  { label: '4 a 6 concluídas', filter: d => d.done_activities_count >= 4 && d.done_activities_count <= 6 },
  { label: '> 6 concluídas', filter: d => d.done_activities_count > 6 }
];

const actRows = actBuckets.map(b => {
  const subset = closedDeals.filter(b.filter);
  const m = calcMetrics(subset);
  return { label: b.label, ...m };
});
printTable('2. IMPACTO DAS ATIVIDADES CONCLUÍDAS (TAREFAS/REUNIÕES)', actRows);

// -----------------------------------------------------------------------------
// 3. ANÁLISE: CLIENTE RECORRENTE (ORGANIZAÇÃO COM MAIS DE 1 DEAL NA BASE)
// -----------------------------------------------------------------------------
// Mapeia histórico de cada organização na base
const orgStats = {};
for (const d of closedDeals) {
  if (!d.org_id) continue;
  if (!orgStats[d.org_id]) orgStats[d.org_id] = { count: 0, won: 0, lost: 0 };
  orgStats[d.org_id].count++;
  if (d.status === 'won') orgStats[d.org_id].won++;
  if (d.status === 'lost') orgStats[d.org_id].lost++;
}

const recBuckets = [
  { label: 'Cliente Inédito (1 Deal)', filter: d => !d.org_id || (orgStats[d.org_id]?.count === 1) },
  { label: 'Cliente Recorrente (2+ Deals)', filter: d => d.org_id && (orgStats[d.org_id]?.count >= 2) },
  { label: 'Cliente com Vitória Anterior', filter: d => d.org_id && (orgStats[d.org_id]?.won >= 2) }
];

const recRows = recBuckets.map(b => {
  const subset = closedDeals.filter(b.filter);
  const m = calcMetrics(subset);
  return { label: b.label, ...m };
});
printTable('3. CLIENTE NOVO vs CLIENTE RECORRENTE (HISTÓRICO ORG)', recRows);

// -----------------------------------------------------------------------------
// 4. ANÁLISE: FAIXA DE VALOR (TICKET MÉDIO)
// -----------------------------------------------------------------------------
const ticketBuckets = [
  { label: 'Até R$ 1.500,00', filter: d => d.value <= 1500 },
  { label: 'R$ 1.500 a R$ 4.000', filter: d => d.value > 1500 && d.value <= 4000 },
  { label: 'R$ 4.000 a R$ 10.000', filter: d => d.value > 4000 && d.value <= 10000 },
  { label: 'R$ 10.000 a R$ 25.000', filter: d => d.value > 10000 && d.value <= 25000 },
  { label: 'Acima de R$ 25.000,00', filter: d => d.value > 25000 }
];

const ticketRows = ticketBuckets.map(b => {
  const subset = closedDeals.filter(b.filter);
  const m = calcMetrics(subset);
  return { label: b.label, ...m };
});
printTable('4. IMPACTO DA FAIXA DE VALOR (TICKET)', ticketRows);

// -----------------------------------------------------------------------------
// 5. ANÁLISE: VENDEDOR RESPONSÁVEL
// -----------------------------------------------------------------------------
const owners = {};
for (const d of closedDeals) {
  const o = d.owner_name || 'Desconhecido';
  if (!owners[o]) owners[o] = [];
  owners[o].push(d);
}

const ownerRows = Object.keys(owners)
  .filter(o => owners[o].length >= 20) // apenas com volume relevante
  .map(o => {
    const m = calcMetrics(owners[o]);
    return { label: o, ...m };
  })
  .sort((a, b) => b.total - a.total);

printTable('5. DESEMPENHO POR VENDEDOR (Volume >= 20 deals)', ownerRows);

// -----------------------------------------------------------------------------
// 6. ANÁLISE: TEMPO DE CICLO DE VENDA (DIAS DE DURAÇÃO)
// -----------------------------------------------------------------------------
function getDealDays(d) {
  if (!d.add_time) return null;
  const start = new Date(d.add_time).getTime();
  const end = (d.close_time || d.won_time || d.lost_time) ? new Date(d.close_time || d.won_time || d.lost_time).getTime() : Date.now();
  const diffDays = Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  return diffDays;
}

const cycleBuckets = [
  { label: 'Mesmo dia (0 dias)', filter: d => getDealDays(d) === 0 },
  { label: '1 a 3 dias', filter: d => { const days = getDealDays(d); return days >= 1 && days <= 3; } },
  { label: '4 a 7 dias', filter: d => { const days = getDealDays(d); return days >= 4 && days <= 7; } },
  { label: '8 a 15 dias', filter: d => { const days = getDealDays(d); return days >= 8 && days <= 15; } },
  { label: '16 a 30 dias', filter: d => { const days = getDealDays(d); return days >= 16 && days <= 30; } },
  { label: '31 a 90 dias', filter: d => { const days = getDealDays(d); return days >= 31 && days <= 90; } },
  { label: '> 90 dias', filter: d => { const days = getDealDays(d); return days > 90; } }
];

const cycleRows = cycleBuckets.map(b => {
  const subset = closedDeals.filter(b.filter);
  const m = calcMetrics(subset);
  return { label: b.label, ...m };
});
printTable('6. TEMPO DE DURAÇÃO DO CICLO DE VENDA (DIAS NO FUNIL)', cycleRows);

// -----------------------------------------------------------------------------
// 7. ANÁLISE: CRUZAMENTO DE CARACTERÍSTICAS (INTERACTION EFFECTS)
// -----------------------------------------------------------------------------
const interactionBuckets = [
  {
    label: '[Cliente Recorrente] + [1+ Notas]',
    filter: d => (d.org_id && orgStats[d.org_id]?.count >= 2) && (d.notes_count >= 1)
  },
  {
    label: '[Cliente Recorrente] + [0 Notas]',
    filter: d => (d.org_id && orgStats[d.org_id]?.count >= 2) && (d.notes_count === 0)
  },
  {
    label: '[Cliente Novo] + [2+ Notas]',
    filter: d => (!d.org_id || orgStats[d.org_id]?.count === 1) && (d.notes_count >= 2)
  },
  {
    label: '[Cliente Novo] + [1 Nota]',
    filter: d => (!d.org_id || orgStats[d.org_id]?.count === 1) && (d.notes_count === 1)
  },
  {
    label: '[Cliente Novo] + [0 Notas]',
    filter: d => (!d.org_id || orgStats[d.org_id]?.count === 1) && (d.notes_count === 0)
  },
  {
    label: '[Ticket > R$ 5k] + [2+ Notas]',
    filter: d => (d.value > 5000) && (d.notes_count >= 2)
  },
  {
    label: '[Ticket > R$ 5k] + [0 Notas]',
    filter: d => (d.value > 5000) && (d.notes_count === 0)
  }
];

const interRows = interactionBuckets.map(b => {
  const subset = closedDeals.filter(b.filter);
  const m = calcMetrics(subset);
  return { label: b.label, ...m };
});
printTable('7. CRUZAMENTO DE FATORES (EFEITOS DE INTERAÇÃO)', interRows);

// -----------------------------------------------------------------------------
// 8. RANKING DE MOTIVOS DE PERDA (LOST_REASON)
// -----------------------------------------------------------------------------
const lostDeals = closedDeals.filter(d => d.status === 'lost');
const lostReasons = {};
for (const d of lostDeals) {
  const r = d.lost_reason || 'Não informado / Em branco';
  if (!lostReasons[r]) lostReasons[r] = { count: 0, val: 0 };
  lostReasons[r].count++;
  lostReasons[r].val += (d.value || 0);
}

const reasonRows = Object.keys(lostReasons)
  .map(k => ({
    reason: k,
    count: lostReasons[k].count,
    pct: ((lostReasons[k].count / lostDeals.length) * 100).toFixed(1),
    val: lostReasons[k].val
  }))
  .sort((a, b) => b.count - a.count);

console.log('----------------------------------------------------------------');
console.log('❌ 8. TOP MOTIVOS DE PERDA (LOST REASONS)');
console.log('----------------------------------------------------------------');
console.log(
  'Motivo da Perda'.padEnd(42) +
  'Qtd'.padStart(8) +
  '% Perdas'.padStart(12) +
  'Valor Perdido'.padStart(19)
);
console.log('-'.repeat(81));
for (const r of reasonRows.slice(0, 10)) {
  console.log(
    r.reason.slice(0, 40).padEnd(42) +
    String(r.count).padStart(8) +
    `${r.pct}%`.padStart(12) +
    formatBRL(r.val).padStart(19)
  );
}
console.log('\n================================================================\n');
