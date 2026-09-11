/**
 * Script de Ingestão e Carga Inicial do Histórico de NFS-e
 * Lê as 346 notas de data/nfse.csv (do claude-job-nfse), normaliza campos,
 * extrai número da nota e salva no Supabase PostgreSQL e data/nfse_recebidas.json.
 * Em seguida, dispara a reconciliação inteligente em lote com o Protheus SF1.
 */

const fs = require('fs');
const path = require('path');
const {
  initPostgres,
  salvarNfseRecebidasDB,
  reconciliarNfseComProtheusDB,
  obterNfsePendentesDB
} = require('../postgres_db');

function parseCsvRows(texto) {
  const linhas = [];
  let linha = [];
  let campo = '';
  let dentroDeAspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i += 1; }
      else if (c === '"') dentroDeAspas = false;
      else campo += c;
    } else if (c === '"') {
      dentroDeAspas = true;
    } else if (c === ',') {
      linha.push(campo); campo = '';
    } else if (c === '\n') {
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else if (c !== '\r') {
      campo += c;
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

async function main() {
  console.log('🚀 [NFS-e Ingest] Iniciando carga inicial do histórico de NFS-e...');

  // Inicializa Postgres se configurado
  await initPostgres();

  const pathsToTry = [
    'C:/Users/Alexandre/Documents/claude/claude-job-nfse/data/nfse.csv',
    path.join(__dirname, '..', 'data', 'nfse.csv'),
    path.join(__dirname, '..', 'data', 'nfse_recebidas.csv')
  ];

  let csvPath = null;
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      csvPath = p;
      break;
    }
  }

  if (!csvPath) {
    console.error('❌ Arquivo nfse.csv não encontrado nos caminhos conhecidos.');
    process.exit(1);
  }

  console.log(`📄 Lendo arquivo CSV: ${csvPath}`);
  const rawText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsvRows(rawText).slice(1);
  console.log(`📊 Total de linhas brutas encontradas: ${rows.length}`);

  const notas = [];
  for (const r of rows) {
    const [empresaNome, empresaCnpj, nsu, chaveAcesso, dataEmissao, prestadorCnpj, prestadorNome, valorLiquido, municipio, descricao] = r;
    if (!chaveAcesso || !prestadorCnpj) continue;

    notas.push({
      empresaNome,
      empresaCnpj,
      nsu,
      chaveAcesso,
      dataEmissao,
      prestadorCnpj,
      prestadorNome,
      valorLiquido: parseFloat(valorLiquido) || 0.0,
      municipio,
      descricao
    });
  }

  console.log(`💾 Salvando ${notas.length} notas no banco e cache local...`);
  const resSave = await salvarNfseRecebidasDB(notas);
  console.log(`✅ Ingestão concluída:`, resSave);

  console.log('🔄 Disparando reconciliação em lote com o Protheus (últimos 150 dias)...');
  const resReconcile = await reconciliarNfseComProtheusDB(150);
  console.log('✅ Reconciliação concluída:', resReconcile);

  console.log('📊 Verificando estado atual (filtro padrão 120 dias em aberto)...');
  const estadoAtual = await obterNfsePendentesDB({ status: 'PENDENTE' });
  console.log(`🎯 Total de NFS-e Pendentes nos últimos 120 dias: ${estadoAtual.kpis.totalPendentes}`);
  console.log(`💰 Valor Total Pendente: R$ ${estadoAtual.kpis.valorTotalPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  console.log('🏢 Por Empresa:', JSON.stringify(estadoAtual.kpis.porEmpresa, null, 2));

  console.log('🎉 Carga e reconciliação concluídas com sucesso!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Erro na carga de NFS-e:', err);
  process.exit(1);
});
