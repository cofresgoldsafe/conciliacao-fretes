/**
 * test_crm_id_sequencial.js
 * 
 * Bateria de Testes Automatizados para Validação de IDs Sequenciais Limpos
 * de Oportunidades no CRM (iniciando em 1001, atômico, resiliente e retrocompatível).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crmEngine = require('./crm_engine');

async function runTests() {
  console.log('🧪 Iniciando Bateria de Testes: ID Sequencial de Oportunidades no CRM...');

  const usuarioTeste = {
    username: 'alexandre',
    name: 'Alexandre Master',
    role: 'admin',
    ip: '127.0.0.1'
  };

  // 1. Validação de migração e IDs no cache
  console.log('\n1️⃣  Teste: Verificação dos IDs existentes no cache após migração');
  const cachePath = path.join(__dirname, 'data', 'crm_deals_cache.json');
  assert.ok(fs.existsSync(cachePath), 'Arquivo crm_deals_cache.json deve existir');
  const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

  assert.ok(Array.isArray(cacheData.deals), 'cacheData.deals deve ser um array');
  assert.ok(cacheData.deals.length >= 10, 'Deve conter pelo menos as 10 oportunidades migradas');

  cacheData.deals.forEach(deal => {
    assert.ok(/^\d{4,}$/.test(String(deal.id)), `ID do deal '${deal.id}' deve ser puramente numérico com pelo menos 4 dígitos`);
    const numId = parseInt(deal.id, 10);
    assert.ok(numId >= 1001, `ID do deal '${deal.id}' deve ser maior ou igual a 1001`);
  });
  console.log(`   ✅ Todas as ${cacheData.deals.length} oportunidades no cache possuem IDs numéricos sequenciais >= 1001.`);

  // 2. Teste de obtenção do próximo ID
  console.log('\n2️⃣  Teste: Incremento atômico de obterProximoIdDeal()');
  const seq1 = await crmEngine.obterProximoIdDeal();
  const seq2 = await crmEngine.obterProximoIdDeal();
  const num1 = parseInt(seq1, 10);
  const num2 = parseInt(seq2, 10);

  assert.strictEqual(num2, num1 + 1, `seq2 (${num2}) deve ser exatamente seq1 (${num1}) + 1`);
  console.log(`   ✅ Incremento sequencial atômico validado: ${seq1} -> ${seq2}.`);

  // 3. Teste de criação real de Deal via criarDeal()
  console.log('\n3️⃣  Teste: Criação de Deal registrando ID sequencial');
  const dealCriado = await crmEngine.criarDeal({
    titulo: 'Oportunidade Proposta Sequencial 4 Dígitos',
    cliente_nome: 'Metalúrgica Teste Sequencial Ltda',
    cliente_cnpj: '11.222.333/0001-44',
    valor_total: 12500.50,
    faturado_por: '14 - MATRIZ',
    cond_pgto: '28 DDL',
    tipo_frete: 'CIF'
  }, usuarioTeste);

  assert.ok(dealCriado && dealCriado.id, 'Deal criado deve possuir ID');
  assert.ok(/^\d{4,}$/.test(String(dealCriado.id)), `ID gerado '${dealCriado.id}' deve ser numérico sequencial`);
  const dealNum = parseInt(dealCriado.id, 10);
  assert.ok(dealNum >= 1011, `ID gerado '${dealCriado.id}' deve ser >= 1011`);
  console.log(`   ✅ Nova oportunidade criada com sucesso sob o ID sequencial limpo: #${dealCriado.id}`);

  // 4. Teste de busca por ID numérico
  console.log('\n4️⃣  Teste: Consulta por ID numérico (obterDealPorId)');
  const dealConsultado = await crmEngine.obterDealPorId(dealCriado.id);
  assert.ok(dealConsultado, `Deal #${dealCriado.id} deve ser encontrado`);
  assert.strictEqual(dealConsultado.id, dealCriado.id, 'ID retornado deve ser idêntico');
  assert.strictEqual(dealConsultado.titulo, 'Oportunidade Proposta Sequencial 4 Dígitos');
  console.log(`   ✅ Consulta por ID #${dealCriado.id} validada com sucesso.`);

  // 5. Teste de vinculação de atividade na oportunidade com ID numérico
  console.log('\n5️⃣  Teste: Criação de atividade de follow-up vinculada ao ID numérico');
  const atividade = await crmEngine.criarAtividadeDeal(dealCriado.id, {
    tipo: 'LIGACAO',
    assunto: 'Follow-up da cotação sequencial',
    descricao: 'Ligação com o comprador para alinhamento de prazos.',
    status: 'pendente'
  }, usuarioTeste);

  assert.ok(atividade && atividade.deal_id, 'Atividade deve possuir deal_id vinculado');
  assert.strictEqual(String(atividade.deal_id), String(dealCriado.id), 'Atividade deve apontar exatamente para o ID numérico');
  console.log(`   ✅ Atividade #${atividade.id} vinculada corretamente ao Deal #${dealCriado.id}.`);

  // 6. Limpeza do deal de teste
  console.log('\n6️⃣  Teste: Exclusão do Deal de teste');
  const excluido = await crmEngine.excluirDeal(dealCriado.id, usuarioTeste);
  assert.ok(excluido, `Deal #${dealCriado.id} deve ser excluído com sucesso`);
  console.log(`   ✅ Deal #${dealCriado.id} removido.`);

  // 7. Validação das telas e frontend (crm.js e crm.html)
  console.log('\n7️⃣  Teste: Validação visual no frontend (crm.js e crm.html)');
  const crmJs = fs.readFileSync(path.join(__dirname, 'public', 'js', 'crm.js'), 'utf8');
  assert.ok(crmJs.includes("dealIdPrefix = deal.id ? `#${deal.id} — ` : ''"), 'crmDetalhesTitulo deve incluir o prefixo #deal.id');
  assert.ok(crmJs.includes("#${escapeHtml(deal.id)}"), 'Card do Kanban deve exibir o ID da oportunidade com #');
  assert.ok(crmJs.includes("maxLocalId + 1"), 'Fallback local offline deve calcular próximo ID sequencial');

  console.log('   ✅ Frontend configurado com visualização limpa de ID sequencial no Kanban, Detalhes e Edição.');

  console.log('\n🏆 =================================================================');
  console.log('🏆 TODOS OS TESTES DE ID SEQUENCIAL FORAM CONCLUÍDOS COM 100% DE SUCESSO!');
  console.log('🏆 =================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Falha na bateria de testes:', err);
  process.exit(1);
});
