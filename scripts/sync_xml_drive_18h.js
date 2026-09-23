/**
 * scripts/sync_xml_drive_18h.js — Job de Sincronização Automática de XMLs de Faturamento no Google Drive
 * 
 * Executa pontualmente às 18:00 (Segunda a Sexta-Feira).
 * Varre o faturamento do Protheus do dia e grava os XMLs nas pastas correspondentes do Google Drive:
 * G:\Drives compartilhados\Fiscal e Faturamento\NF's\XML's Saídas\XML's Saídas [ANO]\[EMPRESA]\[MM.ANO]\
 * 
 * Uso:
 *   node scripts/sync_xml_drive_18h.js
 *   node scripts/sync_xml_drive_18h.js --force
 *   node scripts/sync_xml_drive_18h.js --data=20260923
 */

const { executarJobSincronizacaoDrive18h } = require('../logistica_xml_service');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    force: false,
    data: null,
    basePath: null
  };

  for (const arg of args) {
    if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--data=')) {
      options.data = arg.split('=')[1].replace(/\D/g, '');
    } else if (arg.startsWith('--base=')) {
      options.basePath = arg.split('=')[1].trim();
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log('========================================================================');
  console.log('📁 [JOB 18:00] SINCRONIZADOR DE XMLS DE FATURAMENTO NO GOOGLE DRIVE');
  console.log('========================================================================');
  console.log(`⏰ Execução: Segunda a Sexta-feira às 18:00 BRT`);
  if (options.force) console.log('⚠️ Modo --force ativado: checagem de fim de semana ignorada.');
  if (options.data) console.log(`📅 Data específica informada: ${options.data}`);
  console.log('------------------------------------------------------------------------\n');

  try {
    const resultado = await executarJobSincronizacaoDrive18h({
      force: options.force,
      dataAlvo: options.data,
      basePath: options.basePath
    });

    console.log('\n------------------------------------------------------------------------');
    if (!resultado.ok || resultado.erro) {
      console.error(`❌ Job finalizado com erro: ${resultado.erro || resultado.motivo}`);
      console.log('========================================================================\n');
      process.exit(1);
    }

    if (!resultado.executado) {
      console.log(`ℹ️ Job finalizado sem gravação: ${resultado.motivo}`);
    } else {
      console.log(`🎉 Sucesso! Total de Notas Processadas: ${resultado.totalNotas}`);
      console.log(`✅ Novos XMLs gravados no Drive: ${resultado.gravados}`);
      console.log(`⏩ Já existentes no Drive (ignorados): ${resultado.jaExistentes}`);
      if (resultado.canceladasIgnoradas > 0) {
        console.log(`🛡️ Canceladas ignoradas (segurança contábil): ${resultado.canceladasIgnoradas}`);
      }
      if (resultado.erros > 0) {
        console.log(`⚠️ Falhas de gravação: ${resultado.erros}`);
      }
      console.log(`⏱️ Tempo de Execução: ${resultado.duracaoSegundos}s`);
    }
    console.log('========================================================================\n');

    process.exit(resultado.erros > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n❌ Erro fatal durante a execução do Job das 18h:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
