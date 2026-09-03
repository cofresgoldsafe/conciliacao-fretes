/**
 * scripts/gerar_fechamento_manual.js
 * 
 * Script utilitário para calcular e persistir o fechamento de um período específico
 * no Supabase / PostgreSQL e no cache JSON local.
 */

const { consolidarFechamentoMensal } = require('../fechamento_vendedores_engine');
const { initPostgres, obterFechamentosPorCicloDB, isPostgresConnected } = require('../postgres_db');

async function main() {
  const dataIni = process.argv[2] || '20260626';
  const dataFim = process.argv[3] || '20260725';

  console.log(`=======================================================`);
  console.log(`🚀 Iniciando Consolidação de Fechamento Manual`);
  console.log(`📅 Período: ${dataIni} até ${dataFim}`);
  console.log(`=======================================================\n`);

  try {
    // Inicializa conexão com o Postgres se disponível
    await initPostgres();
    console.log(`🔌 Status Banco Postgres/Supabase: ${isPostgresConnected() ? '✅ Conectado' : 'ℹ️ Modo Local / JSON Fallback'}`);

    console.log(`⏳ Consultando ERP Protheus e calculando regras comerciais...`);
    const resultado = await consolidarFechamentoMensal({
      dataIni,
      dataFim,
      triggeredBy: 'MANUAL_CLI',
      persist: true
    });

    console.log(`\n✅ Fechamento consolidado e gravado com sucesso!`);
    console.log(`📋 Ciclo ID: ${resultado.periodo.cicloId}`);
    console.log(`🏷️ Label: ${resultado.periodo.label}`);
    console.log(`🏢 Faturamento Global por Empresa:`, resultado.faturamentoGlobalPorEmpresa);
    console.log(`📊 Benchmarking Global da Equipe:`, resultado.benchmarkingGlobal);
    console.log(`\n👥 Vendedores Processados (${resultado.todosVendedores.length}):`);

    for (const v of resultado.todosVendedores) {
      console.log(`\n-------------------------------------------------------`);
      console.log(`👤 Vendedor: ${v.nomeVendedor} (${v.codVendedor})`);
      console.log(`  - Venda Base Bruta (SE3): R$ ${Number(v.vendasBaseBruta).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(`  - Fretes Embutidos Deduzidos (SC5): R$ ${Number(v.fretesEmbutidos).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(`  - Venda Base Líquida: R$ ${Number(v.vendasBaseLiquida).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(`  - Meta Vendas (${v.pctMetaVendas}%): Prêmio R$ ${Number(v.premioMetaVendas).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} [${v.faixaMetaVendas}]`);
      console.log(`  - Gordura de Frete: R$ ${Number(v.gorduraFreteTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | Prêmio R$ ${Number(v.premioGorduraFrete).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} [${v.faixaGorduraFrete}]`);
      console.log(`  - Comissão Bruta (1,3%): R$ ${Number(v.comissaoBruta).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(`  - Inadimplentes do Período (SE1): R$ ${Number(v.inadimplentesTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(`  - Comissão Líquida: R$ ${Number(v.comissaoLiquida).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(`  - Total de Prêmios: R$ ${Number(v.totalPremios).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(`  ⭐ TOTAL GERAL A RECEBER: R$ ${Number(v.totalGeralReceber).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(`  📈 Benchmarking Vendas: ${v.benchmarking?.diffVendasPct}% (${v.benchmarking?.statusVendasBench})`);
    }

    console.log(`\n🔍 Conferindo registros persistidos no banco...`);
    const gravados = await obterFechamentosPorCicloDB(resultado.periodo.cicloId);
    console.log(`✅ Total de registros confirmados no banco para o ciclo '${resultado.periodo.cicloId}': ${gravados.length}`);

  } catch (err) {
    console.error(`❌ Erro durante a consolidação do fechamento:`, err);
    process.exitCode = 1;
  }
}

main();
