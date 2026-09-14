/**
 * scripts/sincronizar_nfse_gsi_manual.js
 * Script utilitário para sincronizar as NFS-e emitidas da GSI diretamente da máquina local
 * utilizando o arquivo PFX em Downloads e enviando as notas para o Gemini-Cli (Render / Local).
 * 
 * Uso:
 *   node scripts/sincronizar_nfse_gsi_manual.js <senha_do_certificado> [dataDe: YYYYMMDD] [dataAte: YYYYMMDD]
 */

const fs = require('fs');
const path = require('path');
const { consultarNFeEmitidasWsPaulistana } = require('../paulistana_client');

async function main() {
  const senha = process.argv[2] || process.env.NFSE_CERT_GSI_SENHA;
  if (!senha) {
    console.error('\n❌ ERRO: Informe a senha do certificado digital A1 da GSI:');
    console.error('   node scripts/sincronizar_nfse_gsi_manual.js <sua_senha>\n');
    process.exit(1);
  }

  const pfxPath = 'C:/Users/Alexandre/Downloads/120a2609105ad966.pfx';
  if (!fs.existsSync(pfxPath)) {
    console.error(`\n❌ ERRO: Arquivo do certificado não encontrado em: ${pfxPath}\n`);
    process.exit(1);
  }

  const pfxBuffer = fs.readFileSync(pfxPath);

  const hoje = new Date();
  const dtFimPadrao = hoje.toISOString().slice(0, 10).replace(/-/g, '');
  const dtIniPadrao = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString().slice(0, 10).replace(/-/g, '');

  const dtInicio = (process.argv[3] || dtIniPadrao).replace(/\D/g, '').slice(0, 8);
  const dtFim = (process.argv[4] || dtFimPadrao).replace(/\D/g, '').slice(0, 8);

  console.log('📡 =============================================================');
  console.log('📡 SINCRONIZAÇÃO MANUAL DE NFS-E EMITIDAS - PREFEITURA DE SP (GSI)');
  console.log('📡 =============================================================');
  console.log(`📅 Período: ${dtInicio} a ${dtFim}`);
  console.log(`🔐 Certificado: ${pfxPath} (${pfxBuffer.length} bytes)`);
  console.log(`🏢 Inscrição Municipal (CCM): 43419135`);

  try {
    const res = await consultarNFeEmitidasWsPaulistana({
      dtInicio,
      dtFim,
      inscricaoMunicipal: '43419135',
      pfxBuffer,
      passphrase: senha
    });

    console.log(`\n✅ Sucesso na comunicação com a Prefeitura de SP!`);
    console.log(`📊 Total de notas localizadas: ${res.totalNotas}`);

    if (res.notas && res.notas.length > 0) {
      // Salva no banco / cache
      const { salvarNfseEmitidasDB } = require('../postgres_db');
      const saveRes = await salvarNfseEmitidasDB(res.notas);
      console.log(`💾 Persistência concluída: ${saveRes.total} processadas (${saveRes.inseridas} novas, ${saveRes.atualizadas} atualizadas).`);
    } else {
      console.log('ℹ️ Nenhuma nota emitida encontrada para o período informado.');
    }
  } catch (err) {
    console.error(`\n❌ Erro na consulta à Prefeitura de SP: ${err.message}`);
    process.exit(1);
  }
}

main();
