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

  // 1. Validação de migração específica dos exemplos do usuário: CRM-...-9273 e CRM-...-2715
  console.log('\n1️⃣  Teste: Migração de IDs legados específicos (CRM-1790341501167-9273 -> 9273 e CRM-1789051276950-2715 -> 2715)');
  const cachePath = path.join(__dirname, 'data', 'crm_deals_cache.json');
  assert.ok(fs.existsSync(cachePath), 'Arquivo crm_deals_cache.json deve existir');
  const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

  // Adiciona temporariamente os dois deals nos formatos legados exatos citados pelo usuário
  cacheData.deals.unshift({
    id: 'CRM-1790341501167-9273',
    titulo: 'Oportunidade Legada 9273',
    cliente_nome: 'Cliente Exemplo 9273',
    valor_total: 9500,
    created_at: '2026-09-25T11:00:00.000Z'
  });
  cacheData.deals.unshift({
    id: 'CRM-1789051276950-2715',
    titulo: 'Oportunidade Legada 2715',
    cliente_nome: 'Cliente Exemplo 2715',
    valor_total: 7200,
    created_at: '2026-09-25T10:00:00.000Z'
  });
  cacheData.atividades.unshift({
    id: 'act-legado-9273',
    deal_id: 'CRM-1790341501167-9273',
    tipo: 'NOTA',
    assunto: 'Nota da oportunidade 9273'
  });
  cacheData.atividades.unshift({
    id: 'act-legado-2715',
    deal_id: 'CRM-1789051276950-2715',
    tipo: 'NOTA',
    assunto: 'Nota da oportunidade 2715'
  });
  fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf8');

  // Executa migração forçada
  await crmEngine.migrarDealsLegadosParaSequencial(true);

  const cachePosMig = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const deal9273 = cachePosMig.deals.find(d => d.id === '9273');
  const deal2715 = cachePosMig.deals.find(d => d.id === '2715');
  const ativ9273 = cachePosMig.atividades.find(a => a.id === 'act-legado-9273');
  const ativ2715 = cachePosMig.atividades.find(a => a.id === 'act-legado-2715');

  assert.ok(deal9273, "Oportunidade 'CRM-1790341501167-9273' deve ter sido migrada exatamente para o ID '9273'");
  assert.ok(deal2715, "Oportunidade 'CRM-1789051276950-2715' deve ter sido migrada exatamente para o ID '2715'");
  assert.strictEqual(ativ9273.deal_id, '9273', "Atividade vinculada a 9273 deve ter deal_id atualizado para '9273'");
  assert.strictEqual(ativ2715.deal_id, '2715', "Atividade vinculada a 2715 deve ter deal_id atualizado para '2715'");
  console.log('   ✅ CRM-1790341501167-9273 migrado com sucesso para 9273 com atividades vinculadas.');
  console.log('   ✅ CRM-1789051276950-2715 migrado com sucesso para 2715 com atividades vinculadas.');

  // 2. Teste de retrocompatibilidade de busca (obterDealPorId com ID antigo buscando novo)
  console.log('\n2️⃣  Teste: Retrocompatibilidade de busca por ID antigo');
  const dealViaAntigo = await crmEngine.obterDealPorId('CRM-1790341501167-9273');
  assert.ok(dealViaAntigo, 'obterDealPorId deve localizar o deal mesmo se passado o ID antigo');
  assert.strictEqual(dealViaAntigo.id, '9273', 'ID retornado deve ser o novo número limpo 9273');
  console.log('   ✅ Busca retrocompatível por ID antigo resolvida defensivamente para o ID 9273.');

  // Limpeza dos 2 deals de teste de migração
  await crmEngine.excluirDeal('9273', usuarioTeste);
  await crmEngine.excluirDeal('2715', usuarioTeste);

  // 3. Teste de obtenção do próximo ID
  console.log('\n3️⃣  Teste: Incremento atômico de obterProximoIdDeal()');
  const seq1 = await crmEngine.obterProximoIdDeal();
  const seq2 = await crmEngine.obterProximoIdDeal();
  const num1 = parseInt(seq1, 10);
  const num2 = parseInt(seq2, 10);

  assert.strictEqual(num2, num1 + 1, `seq2 (${num2}) deve ser exatamente seq1 (${num1}) + 1`);
  console.log(`   ✅ Incremento sequencial atômico validado: ${seq1} -> ${seq2}.`);

  // 4. Teste de criação real de Deal via criarDeal()
  console.log('\n4️⃣  Teste: Criação de Deal registrando ID sequencial');
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
  console.log(`   ✅ Nova oportunidade criada com sucesso sob o ID sequencial limpo: #${dealCriado.id}`);

  // 5. Teste de busca por ID numérico
  console.log('\n5️⃣  Teste: Consulta por ID numérico (obterDealPorId)');
  const dealConsultado = await crmEngine.obterDealPorId(dealCriado.id);
  assert.ok(dealConsultado, `Deal #${dealCriado.id} deve ser encontrado`);
  assert.strictEqual(dealConsultado.id, dealCriado.id, 'ID retornado deve ser idêntico');
  assert.strictEqual(dealConsultado.titulo, 'Oportunidade Proposta Sequencial 4 Dígitos');
  console.log(`   ✅ Consulta por ID #${dealCriado.id} validada com sucesso.`);

  // 6. Teste de vinculação de atividade na oportunidade com ID numérico
  console.log('\n6️⃣  Teste: Criação de atividade de follow-up vinculada ao ID numérico');
  const atividade = await crmEngine.criarAtividadeDeal(dealCriado.id, {
    tipo: 'LIGACAO',
    assunto: 'Follow-up da cotação sequencial',
    descricao: 'Ligação com o comprador para alinhamento de prazos.',
    status: 'pendente'
  }, usuarioTeste);

  assert.ok(atividade && atividade.deal_id, 'Atividade deve possuir deal_id vinculado');
  assert.strictEqual(String(atividade.deal_id), String(dealCriado.id), 'Atividade deve apontar exatamente para o ID numérico');
  console.log(`   ✅ Atividade #${atividade.id} vinculada corretamente ao Deal #${dealCriado.id}.`);

  // 7. Limpeza do deal de teste
  console.log('\n7️⃣  Teste: Exclusão do Deal de teste');
  const excluido = await crmEngine.excluirDeal(dealCriado.id, usuarioTeste);
  assert.ok(excluido, `Deal #${dealCriado.id} deve ser excluído com sucesso`);
  console.log(`   ✅ Deal #${dealCriado.id} removido.`);

  // 8. Validação das telas e frontend (crm.js e crm.html)
  console.log('\n8️⃣  Teste: Validação visual no frontend (crm.js e crm.html)');
  const crmJs = fs.readFileSync(path.join(__dirname, 'public', 'js', 'crm.js'), 'utf8');
  assert.ok(crmJs.includes("dealIdPrefix = deal.id ? `#${deal.id} — ` : ''"), 'crmDetalhesTitulo deve incluir o prefixo #deal.id');
  assert.ok(crmJs.includes("#${escapeHtml(deal.id)}"), 'Card do Kanban deve exibir o ID da oportunidade com #');
  assert.ok(crmJs.includes("maxLocalId + 1"), 'Fallback local offline deve calcular próximo ID sequencial');

  console.log('   ✅ Frontend configurado com visualização limpa de ID sequencial no Kanban, Detalhes e Edição.');

  // Higieniza cache local expurgando deals e atividades temporárias do teste
  const finalCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  finalCache.deals = finalCache.deals.filter(d => d.ativo !== false && !d.titulo.includes('Legada') && !d.titulo.includes('Sequencial'));
  finalCache.atividades = finalCache.atividades.filter(a => !a.id.includes('legado') && String(a.deal_id) !== String(dealCriado.id));
  fs.writeFileSync(cachePath, JSON.stringify(finalCache, null, 2), 'utf8');

  console.log('\n🏆 =================================================================');
  console.log('🏆 TODOS OS TESTES DE ID SEQUENCIAL FORAM CONCLUÍDOS COM 100% DE SUCESSO!');
  console.log('🏆 =================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Falha na bateria de testes:', err);
  process.exit(1);
});
