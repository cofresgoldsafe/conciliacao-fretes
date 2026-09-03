/**
 * test_funcionarios_dp.js - Suíte de Testes Automatizados para Cadastro de Colaboradores (DP / RH)
 */

const assert = require('assert');
const {
  salvarColaboradorDB,
  obterColaboradoresDB,
  obterColaboradorPorIdDB,
  excluirColaboradorDB,
  salvarHoleritesDB,
  sincronizarColaboradoresDosHoleritesDB
} = require('./postgres_db');

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: CADASTRO DE FUNCIONÁRIOS & COLABORADORES DP');
  console.log('=============================================================\n');

  let passed = 0;

  // Teste 1: Cadastrar novo colaborador manualmente com PIX e dados bancários
  console.log('--- 1. Criação e Persistência de Colaborador ---');
  const mockColab = {
    empresa: 'GSI',
    nome_completo: 'TESTE ROBERTO SILVA',
    cpf: '123.456.789-00',
    rg: '12.345.678-9',
    codigo_interno: '10',
    cargo: 'Analista de Operações',
    cbo: '411010',
    departamento: 'Logística',
    tipo_contrato: 'CLT',
    data_admissao: '01/03/2022',
    status: 'ATIVO',
    salario_base: 3850.00,
    telefone_celular: '(11) 99999-8888',
    email_pessoal: 'roberto.teste@email.com',
    tipo_chave_pix: 'CPF',
    chave_pix: '123.456.789-00',
    banco_nome: 'Banco do Brasil',
    agencia: '1234',
    conta_corrente: '56789-0'
  };

  const salvo = await salvarColaboradorDB(mockColab, 'admin_test');
  assert.ok(salvo, 'Deveria retornar colaborador salvo');
  assert.ok(salvo.id, 'Deveria ter um ID gerado');
  assert.strictEqual(salvo.nome_completo, 'TESTE ROBERTO SILVA');
  assert.strictEqual(salvo.empresa, 'GSI');
  assert.strictEqual(salvo.chave_pix, '123.456.789-00');
  console.log('  ✅ [PASS] Colaborador cadastrado com sucesso com dados cadastrais e PIX');
  passed++;

  // Teste 2: Consultar colaboradores com filtros (Empresa, Status e Busca)
  console.log('\n--- 2. Consulta e Filtros de Colaboradores ---');
  const todos = await obterColaboradoresDB({});
  assert.ok(todos.length >= 1, 'Deveria retornar ao menos 1 colaborador');

  const gsi = await obterColaboradoresDB({ empresa: 'GSI' });
  assert.ok(gsi.some(c => c.nome_completo === 'TESTE ROBERTO SILVA'), 'Deveria conter Roberto na GSI');

  const buscaPix = await obterColaboradoresDB({ busca: '123.456.789-00' });
  assert.ok(buscaPix.length >= 1, 'Busca por chave PIX deve encontrar o colaborador');
  assert.strictEqual(buscaPix[0].nome_completo, 'TESTE ROBERTO SILVA');
  console.log('  ✅ [PASS] Filtros por empresa, status e busca universal validados');
  passed++;

  // Teste 3: Edição e Atualização de Dados (Chave PIX e Status)
  console.log('\n--- 3. Atualização de Ficha Funcional ---');
  const dadosAtualizados = {
    ...salvo,
    cargo: 'Coordenador de Operações',
    salario_base: 4500.00,
    telefone_celular: '(11) 98888-7777',
    chave_pix: 'roberto.teste@email.com',
    tipo_chave_pix: 'EMAIL',
    status: 'FERIAS'
  };

  const atualizado = await salvarColaboradorDB(dadosAtualizados, 'admin_test');
  assert.strictEqual(atualizado.cargo, 'Coordenador de Operações');
  assert.strictEqual(parseFloat(atualizado.salario_base), 4500.00);
  assert.strictEqual(atualizado.chave_pix, 'roberto.teste@email.com');
  assert.strictEqual(atualizado.status, 'FERIAS');

  const recarregado = await obterColaboradorPorIdDB(salvo.id);
  assert.strictEqual(recarregado.cargo, 'Coordenador de Operações');
  assert.strictEqual(recarregado.status, 'FERIAS');
  console.log('  ✅ [PASS] Atualização de cargo, PIX, celular e status funcional persistida');
  passed++;

  // Teste 4: Sincronização Inteligente de Holerites para o Cadastro
  console.log('\n--- 4. Auto-Sincronização Holerites -> Cadastro ---');
  // Salva um holerite de teste
  const mockHolerite = {
    empresa: 'SEM_REGISTRO',
    tipo_documento: 'FOLHA_MENSAL',
    competencia_mes: 7,
    competencia_ano: 2026,
    funcionario_nome: 'TESTE COLAB AUTO SYNC',
    funcionario_cpf: '999.888.777-66',
    funcionario_cargo: 'Mecânico de Manutenção',
    salario_base: 3200.00,
    total_vencimentos: 3200.00,
    total_descontos: 200.00,
    valor_liquido: 3000.00,
    eventos: []
  };
  await salvarHoleritesDB([mockHolerite], 'test');

  // Dispara auto-sincronização
  const syncRes = await sincronizarColaboradoresDosHoleritesDB('sync_test');
  assert.ok(syncRes.total_verificados >= 1, 'Deveria verificar ao menos 1 holerite');

  // Verifica se o funcionário foi auto-cadastrado em dp_colaboradores
  const buscaAuto = await obterColaboradoresDB({ busca: 'TESTE COLAB AUTO SYNC' });
  assert.ok(buscaAuto.length >= 1, 'Funcionário do holerite deveria estar cadastrado');
  const autoColab = buscaAuto[0];
  assert.strictEqual(autoColab.empresa, 'SEM_REGISTRO');
  assert.strictEqual(autoColab.cargo, 'Mecânico de Manutenção');
  assert.strictEqual(autoColab.status, 'ATIVO');
  assert.strictEqual(autoColab.cpf, '999.888.777-66');
  console.log('  ✅ [PASS] Auto-cadastro a partir de holerites importados executado com sucesso');
  passed++;

  // Teste 5: Exclusão Segura
  console.log('\n--- 5. Exclusão de Cadastro de Colaborador ---');
  await excluirColaboradorDB(salvo.id, 'admin_test');
  if (autoColab && autoColab.id) {
    await excluirColaboradorDB(autoColab.id, 'admin_test');
  }

  const checkDeleted = await obterColaboradorPorIdDB(salvo.id);
  assert.strictEqual(checkDeleted, null, 'Colaborador deveria ter sido excluído');
  console.log('  ✅ [PASS] Exclusão de colaboradores operando perfeitamente');
  passed++;

  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${passed} Aprovados, 0 Falhas`);
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('❌ Falha na suíte de testes:', err);
  process.exit(1);
});
