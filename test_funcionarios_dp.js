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
  excluirHoleriteDB,
  sincronizarColaboradoresDosHoleritesDB,
  limparEDeduplicarColaboradoresDB
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
    cod_protheus: 'TESTE001',
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
  assert.strictEqual(salvo.cod_protheus, 'TESTE001');
  console.log('  ✅ [PASS] Colaborador cadastrado com sucesso com dados cadastrais, PIX e Cód Protheus');
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

  const buscaCodProtheus = await obterColaboradoresDB({ busca: 'TESTE001' });
  assert.ok(buscaCodProtheus.length >= 1, 'Busca por Cód Protheus deve encontrar o colaborador');
  assert.strictEqual(buscaCodProtheus[0].nome_completo, 'TESTE ROBERTO SILVA');
  console.log('  ✅ [PASS] Filtros por empresa, status e busca universal (incluindo Cód Protheus) validados');
  passed++;

  // Teste 3: Edição e Atualização de Dados (Chave PIX e Status)
  console.log('\n--- 3. Atualização de Ficha Funcional ---');
  const dadosAtualizados = {
    ...salvo,
    cargo: 'Coordenador de Operações',
    cod_protheus: 'TESTE001_UPD',
    salario_base: 4500.00,
    telefone_celular: '(11) 98888-7777',
    chave_pix: 'roberto.teste@email.com',
    tipo_chave_pix: 'EMAIL',
    status: 'FERIAS'
  };

  const atualizado = await salvarColaboradorDB(dadosAtualizados, 'admin_test');
  assert.strictEqual(atualizado.cargo, 'Coordenador de Operações');
  assert.strictEqual(atualizado.cod_protheus, 'TESTE001_UPD');
  assert.strictEqual(parseFloat(atualizado.salario_base), 4500.00);
  assert.strictEqual(atualizado.chave_pix, 'roberto.teste@email.com');
  assert.strictEqual(atualizado.status, 'FERIAS');

  const recarregado = await obterColaboradorPorIdDB(salvo.id);
  assert.strictEqual(recarregado.cargo, 'Coordenador de Operações');
  assert.strictEqual(recarregado.cod_protheus, 'TESTE001_UPD');
  assert.strictEqual(recarregado.status, 'FERIAS');
  console.log('  ✅ [PASS] Atualização de cargo, PIX, Cód Protheus, celular e status funcional persistida');
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
  const savedHolerites = await salvarHoleritesDB([mockHolerite], 'test');

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
  if (savedHolerites && Array.isArray(savedHolerites)) {
    for (const h of savedHolerites) {
      await excluirHoleriteDB(h.id, 'admin_test');
    }
  }

  const checkDeleted = await obterColaboradorPorIdDB(salvo.id);
  assert.strictEqual(checkDeleted, null, 'Colaborador deveria ter sido excluído');
  console.log('  ✅ [PASS] Exclusão de colaboradores operando perfeitamente');
  passed++;

  // Teste 6: Validação da Base Completa dos 22 Colaboradores (Planilha/Print 2026-10)
  console.log('\n--- 6. Validação dos 22 Colaboradores Cadastrados (Sócios, CLT, PJ, Sem Registro) ---');
  const baseCompleta = await obterColaboradoresDB({});
  assert.ok(baseCompleta.length >= 22, `Base de colaboradores deve conter ao menos 22 cadastros (encontrados: ${baseCompleta.length})`);

  // Verifica sócios
  const socioGsi = baseCompleta.find(c => c.nome_completo === 'ALEXANDRE RODRIGUES ARRAIS');
  assert.ok(socioGsi, 'Alexandre Rodrigues Arrais deve estar cadastrado');
  assert.strictEqual(socioGsi.empresa, 'GSI');
  assert.strictEqual(socioGsi.data_nascimento, '19/09/1975');
  assert.strictEqual(socioGsi.chave_pix, '11998431909');

  const sociaMp = baseCompleta.find(c => c.nome_completo === 'MARINA MADEIRA LAGE');
  assert.ok(sociaMp, 'Marina Madeira Lage deve estar cadastrada');
  assert.strictEqual(sociaMp.empresa, 'MP');
  assert.strictEqual(sociaMp.data_nascimento, '02/09/2003');

  // Verifica prestadores PJ
  const pjLuis = baseCompleta.find(c => c.nome_completo === 'LUIS CARLOS DA SILVA');
  assert.ok(pjLuis, 'Luis Carlos da Silva deve estar cadastrado');
  assert.strictEqual(pjLuis.empresa, 'PJ');
  assert.strictEqual(pjLuis.tipo_contrato, 'PJ');
  assert.strictEqual(pjLuis.data_nascimento, '18/02/1973');

  const pjVanessa = baseCompleta.find(c => c.nome_completo === 'VANESSA MARY DA SILVA SANTOS CARLOS');
  assert.ok(pjVanessa, 'Vanessa Mary da Silva deve estar cadastrada');
  assert.strictEqual(pjVanessa.empresa, 'PJ');
  assert.strictEqual(pjVanessa.data_nascimento, '01/08/1988');

  // Verifica colaboradores Sem Registro
  const semRegAdriano = baseCompleta.find(c => c.nome_completo === 'ADRIANO ROVARIS');
  assert.ok(semRegAdriano, 'Adriano Rovaris deve estar cadastrado');
  assert.strictEqual(semRegAdriano.empresa, 'SEM_REGISTRO');
  assert.strictEqual(semRegAdriano.data_nascimento, '09/02/1989');

  // Valida que todos os 22 possuem data_nascimento preenchida para rotinas de aniversário
  const semDataNasc = baseCompleta.filter(c => !c.data_nascimento || !c.data_nascimento.includes('/'));
  assert.strictEqual(semDataNasc.length, 0, 'Todos os colaboradores devem ter data de nascimento válida (DD/MM/AAAA)');

  // Valida filtros por empresa
  const gsiList = await obterColaboradoresDB({ empresa: 'GSI' });
  const oacoList = await obterColaboradoresDB({ empresa: 'OACO' });
  const semList = await obterColaboradoresDB({ empresa: 'SEM_REGISTRO' });
  const mpList = await obterColaboradoresDB({ empresa: 'MP' });
  const pjList = await obterColaboradoresDB({ empresa: 'PJ' });

  assert.ok(gsiList.length >= 6, 'GSI deve ter pelo menos 6 colaboradores');
  assert.ok(oacoList.length >= 5, 'OACO deve ter pelo menos 5 colaboradores');
  assert.ok(semList.length >= 8, 'Sem Registro deve ter pelo menos 8 colaboradores');
  assert.ok(mpList.length >= 1, 'MP deve ter pelo menos 1 colaboradora');
  assert.ok(pjList.length >= 2, 'PJ deve ter pelo menos 2 prestadores');

  console.log('  ✅ [PASS] 22 Colaboradores validados com datas de aniversário, PIX e empresas');
  passed++;

  // Teste 7: Deduplicação e Concatenação Inteligente de Colaboradores
  console.log('\n--- 7. Deduplicação e Concatenação Inteligente ---');
  // Cria 2 cadastros duplicados propositais: um com acento e dados bancários, outro sem acento com salário
  const colab1 = await salvarColaboradorDB({
    empresa: 'GSI',
    nome_completo: 'CLÁUDIO TESTE DEDUPLICAÇÃO',
    cpf: '111.222.333-44',
    data_nascimento: '15/05/1985',
    chave_pix: 'claudio.dedup@email.com',
    tipo_chave_pix: 'EMAIL',
    cod_protheus: 'DEDUP001'
  }, 'test_dedup');

  const colab2 = await salvarColaboradorDB({
    empresa: 'GSI',
    nome_completo: 'CLAUDIO TESTE DEDUPLICACAO', // sem acento
    salario_base: 5200.00,
    cargo: 'Especialista em Logística',
    tipo_contrato: 'CLT'
  }, 'test_dedup');

  assert.ok(colab1.id && colab2.id, 'Ambos os cadastros de teste devem ter sido criados');

  // Executa a deduplicação
  const dedupRes = await limparEDeduplicarColaboradoresDB('test_runner');
  assert.ok(dedupRes.success, 'Deduplicação deve retornar sucesso');
  assert.ok(dedupRes.duplicados_removidos >= 1, 'Deveria remover pelo menos 1 duplicata');

  // Verifica se o registro sobrevivente foi mesclado com todas as informações
  const buscaSobrevivente = await obterColaboradoresDB({ busca: 'CLAUDIO TESTE DEDUPLICAÇÃO' });
  assert.strictEqual(buscaSobrevivente.length, 1, 'Deve existir exatamente 1 registro unificado para Cláudio');
  const merged = buscaSobrevivente[0];
  assert.strictEqual(merged.data_nascimento, '15/05/1985', 'Data de nascimento deve ter sido preservada');
  assert.strictEqual(merged.chave_pix, 'claudio.dedup@email.com', 'Chave PIX deve ter sido preservada');
  assert.strictEqual(merged.cod_protheus, 'DEDUP001', 'Cód Protheus deve ter sido preservado');
  assert.strictEqual(parseFloat(merged.salario_base), 5200.00, 'Salário base deve ter sido absorvido do registro secundário');
  assert.strictEqual(merged.cargo, 'Especialista em Logística', 'Cargo deve ter sido absorvido');

  // Limpa o registro de teste
  await excluirColaboradorDB(merged.id, 'cleanup_test');
  console.log('  ✅ [PASS] Algoritmo de deduplicação e fusão de registros duplicados homologado com sucesso');
  passed++;

  // Teste 8: Validação dos Códigos Protheus de Fornecedores (Contas a Pagar)
  console.log('\n--- 8. Validação dos Códigos Protheus de Fornecedores (Contas a Pagar) ---');
  const baseColabs = await obterColaboradoresDB({});
  assert.strictEqual(baseColabs.length, 22, 'Deve conter exatamente os 22 colaboradores');

  const juliana = baseColabs.find(c => c.nome_completo.includes('JULIANA'));
  const andrea = baseColabs.find(c => c.nome_completo.includes('ANDREA') || c.nome_completo.includes('ANDRÉA'));
  const figueiredo = baseColabs.find(c => c.nome_completo.includes('FIGUEIREDO'));
  const alexandre = baseColabs.find(c => c.nome_completo.includes('ALEXANDRE RODRIGUES'));
  const adriano = baseColabs.find(c => c.nome_completo.includes('ADRIANO ROVARIS'));
  const vanessa = baseColabs.find(c => c.nome_completo.includes('VANESSA MARY'));
  const yan = baseColabs.find(c => c.nome_completo.includes('YAN LUCAS'));

  assert.ok(juliana && juliana.cod_protheus === '001501', 'Juliana deve ter Cód Fornecedor Protheus 001501');
  assert.ok(andrea && andrea.cod_protheus === '001132', 'Andrea deve ter Cód Fornecedor Protheus 001132');
  assert.ok(figueiredo && figueiredo.cod_protheus === '000271', 'Figueiredo deve ter Cód Fornecedor Protheus 000271');
  assert.ok(alexandre && alexandre.cod_protheus === '000221', 'Alexandre deve ter Cód Fornecedor Protheus 000221');
  assert.ok(adriano && adriano.cod_protheus === '120946', 'Adriano deve ter Cód Fornecedor Protheus 120946');
  assert.ok(vanessa && vanessa.cod_protheus === '120278', 'Vanessa deve ter Cód Fornecedor Protheus 120278');
  assert.ok(yan && yan.cod_protheus === '121166', 'Yan deve ter Cód Fornecedor Protheus 121166');

  // Valida que TODOS os 22 colaboradores possuem cod_protheus preenchido
  const semCodProtheus = baseColabs.filter(c => !c.cod_protheus || String(c.cod_protheus).trim() === '');
  assert.strictEqual(semCodProtheus.length, 0, 'Todos os 22 colaboradores devem ter Cód Fornecedor Protheus preenchido');

  console.log('  ✅ [PASS] 100% dos 22 colaboradores possuem Códigos de Fornecedor Protheus cadastrados para geração do Contas a Pagar');
  passed++;

  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${passed} Aprovados, 0 Falhas`);
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('❌ Falha na suíte de testes:', err);
  process.exit(1);
});
