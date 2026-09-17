/**
 * scripts/carga_inicial_nfe_central.js
 * 
 * Script de Carga Inicial (Backfill) para a Super Tabela nfe_central_documentos.
 * Extrai notas fiscais faturadas e canceladas (SF2 com OUTER APPLY em SD2/SC5 e joins com SA1/SA2)
 * de 01/07/2026 até a data atual para as 3 empresas (14, 15, 16),
 * consolidando metadados, vínculos com Pedido de Venda e Pipedrive CodWeb.
 * 
 * Uso:
 *   node scripts/carga_inicial_nfe_central.js
 *   node scripts/carga_inicial_nfe_central.js --de=20260701 --ate=20260831 --empresa=ALL
 */

const path = require('path');
const { initPostgres, upsertNfeCentralDocumentos, consultarNfeCentral } = require('../postgres_db');
const { extrairNotasFaturadasParaCentral } = require('../protheus_db');

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    de: '20260701',
    ate: null,
    empresa: 'ALL',
    dryRun: false
  };

  for (const arg of args) {
    if (arg.startsWith('--de=')) {
      params.de = arg.split('=')[1].replace(/\D/g, '');
    } else if (arg.startsWith('--ate=')) {
      params.ate = arg.split('=')[1].replace(/\D/g, '');
    } else if (arg.startsWith('--empresa=')) {
      params.empresa = arg.split('=')[1].trim().toUpperCase();
    } else if (arg === '--dry-run') {
      params.dryRun = true;
    }
  }

  if (!params.ate) {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    params.ate = `${ano}${mes}${dia}`;
  }

  return params;
}

function formatCurrency(val) {
  return (Number(val) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  const t0 = Date.now();
  const params = parseArgs();

  console.log('\n========================================================================');
  console.log('🚀 [NFE CENTRAL] INICIANDO CARGA INICIAL (BACKFILL HISTÓRICO)');
  console.log('========================================================================');
  console.log(`📅 Período Alvo: ${params.de.substring(6,8)}/${params.de.substring(4,6)}/${params.de.substring(0,4)} até ${params.ate.substring(6,8)}/${params.ate.substring(4,6)}/${params.ate.substring(0,4)}`);
  console.log(`🏢 Empresa(s): ${params.empresa}`);
  console.log(`🛠️ Modo: ${params.dryRun ? 'DRY-RUN (Apenas Consulta)' : 'PRODUÇÃO (Gravação no Banco)'}`);
  console.log('------------------------------------------------------------------------\n');

  // 1. Inicializa Banco PostgreSQL / Supabase
  console.log('⏳ 1. Conectando ao repositório PostgreSQL...');
  await initPostgres();

  // 2. Extração Protheus
  console.log(`⏳ 2. Extraindo notas faturadas e canceladas do Protheus (SF2/SD2/SC5/SA1)...`);
  const empresaFiltro = params.empresa === 'ALL' ? null : params.empresa;
  const notas = await extrairNotasFaturadasParaCentral({
    dataInicio: params.de,
    dataFim: params.ate,
    empresaEspecifica: empresaFiltro
  });

  console.log(`✅ Extração concluída: ${notas.length} notas localizadas no Protheus.\n`);

  if (notas.length === 0) {
    console.log('ℹ️ Nenhuma nota localizada no período informado.');
    return;
  }

  // 3. Agregação e Métricas
  const metricasPorEmpresa = {
    '14': { total: 0, valor: 0, comPed: 0, comCodWeb: 0, canceladas: 0, autorizadas: 0 },
    '15': { total: 0, valor: 0, comPed: 0, comCodWeb: 0, canceladas: 0, autorizadas: 0 },
    '16': { total: 0, valor: 0, comPed: 0, comCodWeb: 0, canceladas: 0, autorizadas: 0 }
  };

  let totalValorGeral = 0;
  let totalComPed = 0;
  let totalComCodWeb = 0;
  let totalCanceladas = 0;

  for (const n of notas) {
    const emp = n.empresa || '16';
    if (!metricasPorEmpresa[emp]) {
      metricasPorEmpresa[emp] = { total: 0, valor: 0, comPed: 0, comCodWeb: 0, canceladas: 0, autorizadas: 0 };
    }
    const m = metricasPorEmpresa[emp];
    m.total++;
    m.valor += n.valorTotal;
    totalValorGeral += n.valorTotal;

    if (n.numeroPed) {
      m.comPed++;
      totalComPed++;
    }
    if (n.codWeb) {
      m.comCodWeb++;
      totalComCodWeb++;
    }
    if (n.statusSefaz === 'CANCELADA') {
      m.canceladas++;
      totalCanceladas++;
    } else {
      m.autorizadas++;
    }
  }

  // 4. Gravação na Super Tabela (a menos que seja Dry-Run)
  let gravados = 0;
  if (!params.dryRun) {
    console.log('⏳ 3. Gravando dados na Super Tabela nfe_central_documentos...');
    const resUpsert = await upsertNfeCentralDocumentos(notas);
    gravados = resUpsert.inseridos || notas.length;
    console.log(`✅ Persistência concluída com sucesso: ${gravados} documentos sincronizados.\n`);
  } else {
    console.log('ℹ️ Modo dry-run: gravação ignorada.\n');
  }

  // 5. Exibição do Painel Analítico
  const nomesEmp = {
    '14': 'Metal Pleno (14)',
    '15': 'GSI Brasil (15)',
    '16': 'OAÇO / Cofres (16)'
  };

  console.log('========================================================================');
  console.log('📊 RESUMO CONSOLIDADO DA CARGA INICIAL (07 E 08)');
  console.log('========================================================================');
  console.log('| Empresa            | Qtd NFs | Vlr Faturado     | C/ Pedido | C/ CodWeb | Canceladas |');
  console.log('| :----------------- | :------ | :--------------- | :-------- | :-------- | :--------- |');

  for (const [cod, m] of Object.entries(metricasPorEmpresa)) {
    if (m.total === 0 && params.empresa !== 'ALL' && params.empresa !== cod) continue;
    const nome = (nomesEmp[cod] || `Empresa ${cod}`).padEnd(18, ' ');
    const qtd = String(m.total).padStart(7, ' ');
    const vlr = formatCurrency(m.valor).padStart(16, ' ');
    const ped = String(m.comPed).padStart(9, ' ');
    const web = String(m.comCodWeb).padStart(9, ' ');
    const canc = String(m.canceladas).padStart(10, ' ');
    console.log(`| ${nome} | ${qtd} | ${vlr} | ${ped} | ${web} | ${canc} |`);
  }

  console.log('------------------------------------------------------------------------');
  console.log(`| TOTAL GERAL        | ${String(notas.length).padStart(7, ' ')} | ${formatCurrency(totalValorGeral).padStart(16, ' ')} | ${String(totalComPed).padStart(9, ' ')} | ${String(totalComCodWeb).padStart(9, ' ')} | ${String(totalCanceladas).padStart(10, ' ')} |`);
  console.log('========================================================================');

  const duracao = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`⏱️ Tempo total de execução: ${duracao} segundos`);
  console.log('🎉 Carga inicial finalizada com sucesso!\n');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Falha fatal na carga inicial:', err);
      process.exit(1);
    });
}

module.exports = { main };
