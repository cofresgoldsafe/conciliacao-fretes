/**
 * test_holerite_manual_pf.js - Suíte de Testes Automatizados para:
 * 1. Botão Manual PF e Modal de Emissão no DOM
 * 2. Emissão de Recibos Avulsos (13º 1ª Parc, Adiantamento, Salário) para Pessoa Física Sem Registro
 * 3. Renderização HTML Limpa: Zero logos corporativos e zero CNPJs
 * 4. Valor por extenso em português
 * 5. Filtro e Persistência sob empresa SEM_REGISTRO
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const {
  salvarHoleritesDB,
  obterHoleritesDB,
  excluirHoleriteDB
} = require('./postgres_db');

console.log('\n=============================================================');
console.log('🧪 SUÍTE DE TESTES: EMISSÃO MANUAL PF (SEM REGISTRO)');
console.log('=============================================================\n');

let passed = 0;
let failed = 0;

function report(name, ok, err = null) {
  if (ok) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.log(`  ❌ [FAIL] ${name}: ${err}`);
    failed++;
  }
}

async function runAllTests() {
  // Teste 1: Validação do Botão e Modal no index.html
  try {
    console.log('--- 1. Validação dos Elementos no DOM (HTML) ---');
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');

    assert.ok(html.includes('id="btnManualPfHolerite"'), 'Deve conter botão #btnManualPfHolerite');
    assert.ok(html.includes('📝 Manual PF'), 'Botão deve conter o texto 📝 Manual PF');
    assert.ok(html.includes('id="modalHoleriteManualPf"'), 'Deve conter modal #modalHoleriteManualPf');
    assert.ok(html.includes('id="selectManualPfTipo"'), 'Modal deve conter select #selectManualPfTipo');
    assert.ok(html.includes('id="selectManualPfColaborador"'), 'Modal deve conter select #selectManualPfColaborador');
    assert.ok(html.includes('id="inputManualPfValor"'), 'Modal deve conter input #inputManualPfValor');
    assert.ok(html.includes('id="btnConfirmarManualPf"'), 'Modal deve conter botão #btnConfirmarManualPf');

    report('Botão #btnManualPfHolerite e modal #modalHoleriteManualPf presentes no DOM', true);
  } catch (err) {
    report('Botão #btnManualPfHolerite e modal #modalHoleriteManualPf presentes no DOM', false, err.message);
  }

  // Teste 2: Validação da Conversão de Valor por Extenso em JS
  try {
    console.log('\n--- 2. Conversão de Valores por Extenso em Português ---');
    const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');
    assert.ok(serverCode.includes('function converterNumeroPorExtenso'), 'server.js deve conter converterNumeroPorExtenso');

    // Executa no sandbox
    const contextServer = {};
    vm.createContext(contextServer);
    vm.runInContext(serverCode.substring(serverCode.indexOf('function converterNumeroPorExtenso'), serverCode.indexOf('app.post(\'/api/financeiro/holerites/manual\'')), contextServer);

    const ext1 = contextServer.converterNumeroPorExtenso(1500);
    assert.ok(ext1.toLowerCase().includes('mil e quinhentos reais'), `Esperava "mil e quinhentos reais", obtido: ${ext1}`);

    const ext2 = contextServer.converterNumeroPorExtenso(2450.50);
    assert.ok(ext2.toLowerCase().includes('dois mil') && ext2.toLowerCase().includes('cinquenta centavos'), `Esperava centavos em 2450.50, obtido: ${ext2}`);

    const ext3 = contextServer.converterNumeroPorExtenso(100);
    assert.ok(ext3.toLowerCase().includes('cem reais'), `Esperava "cem reais", obtido: ${ext3}`);

    report('Função converterNumeroPorExtenso converte inteiros e centavos com precisão', true);
  } catch (err) {
    report('Função converterNumeroPorExtenso converte inteiros e centavos com precisão', false, err.message);
  }

  // Teste 3: Renderização do HTML do Recibo PF (Zero Logos Corporativos e Zero CNPJs)
  try {
    console.log('\n--- 3. Renderização do Recibo PF Limpo (Sem Logo e Sem CNPJ) ---');
    const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'holerites.js'), 'utf-8');

    const contextJs = {
      window: {},
      document: {
        readyState: 'complete',
        getElementById: () => null,
        addEventListener: () => {}
      },
      localStorage: { getItem: () => null }
    };
    vm.createContext(contextJs);
    vm.runInContext(js, contextJs);

    assert.ok(contextJs.window.holeritesModule, 'holeritesModule deve estar registrado');
    const gerarHtml = contextJs.window.holeritesModule.gerarHoleriteHtml;

    // Amostra de Recibo Manual PF (13º 1ª Parcela)
    const docManualPf = {
      id: 9999,
      empresa: 'SEM_REGISTRO',
      empresa_razao_social: '',
      empresa_cnpj: '',
      tipo_documento: '13_PRIMEIRA_PARCELA',
      tipo_documento_label: '13º Salário - 1ª Parcela',
      competencia_mes: 11,
      competencia_ano: 2026,
      competencia_formatada: 'Novembro de 2026',
      data_pagamento: '20/11/2026',
      funcionario_nome: 'JOSE DA SILVA PEREIRA',
      funcionario_cpf: '123.456.789-00',
      funcionario_cargo: 'Prestador de Serviços Gerais',
      total_vencimentos: 1750.00,
      total_descontos: 0.00,
      valor_liquido: 1750.00,
      valor_liquido_extenso: 'Mil setecentos e cinquenta reais',
      eventos: [
        { codigo: '001', descricao: '13º Salário - 1ª Parcela', referencia: '1,00', vencimento: 1750.00, desconto: 0.00 }
      ],
      origem_arquivo_tipo: 'MANUAL_PF'
    };

    const htmlGerado = gerarHtml(docManualPf);

    // Validações Cruciais do Usuário:
    // 1. Sem logos da GSI nem da OAÇO
    assert.ok(!htmlGerado.includes('alt="Logo GSI"'), 'Recibo PF NÃO deve conter alt Logo GSI');
    assert.ok(!htmlGerado.includes('alt="Logo OAÇO"'), 'Recibo PF NÃO deve conter alt Logo OAÇO');
    assert.ok(!htmlGerado.includes('LOGO_GSI_B64') && !htmlGerado.includes('LOGO_OACO_B64'), 'Recibo PF NÃO deve renderizar imagens dos logos corporativos');

    // 2. Sem informações de CNPJ corporativo
    assert.ok(!htmlGerado.includes('14.061.778/0001-15'), 'Recibo PF NÃO deve conter CNPJ da GSI');
    assert.ok(!htmlGerado.includes('61.237.790/0001-18'), 'Recibo PF NÃO deve conter CNPJ da OAÇO');
    assert.ok(!htmlGerado.includes('CNPJ: <strong>'), 'Recibo PF NÃO deve exibir rótulo de CNPJ');

    // 3. Cabeçalho limpo "RECIBO DE PAGAMENTO"
    assert.ok(htmlGerado.includes('RECIBO DE PAGAMENTO'), 'Cabeçalho central deve exibir RECIBO DE PAGAMENTO');
    assert.ok(htmlGerado.includes('JOSE DA SILVA PEREIRA'), 'Deve conter nome do colaborador');
    assert.ok(htmlGerado.includes('13º SALÁRIO - 1ª PARCELA'), 'Deve conter o tipo do documento');
    assert.ok(htmlGerado.includes('Mil setecentos e cinquenta reais'), 'Deve conter valor por extenso');
    assert.ok(htmlGerado.includes('20/11/2026'), 'Deve conter a data de pagamento');

    // 4. Bases contábeis de FGTS/INSS CLT suprimidas
    assert.ok(!htmlGerado.includes('Sal. Contr. INSS'), 'Bases de CLT não devem ser exibidas em recibos PF');

    report('HTML gerado atende perfeitamente aos requisitos: sem logo, sem CNPJ e com quitação limpa', true);
  } catch (err) {
    report('HTML gerado atende perfeitamente aos requisitos: sem logo, sem CNPJ e com quitação limpa', false, err.message);
  }

  // Teste 4: Persistência e Consulta no Banco / Fallback
  try {
    console.log('\n--- 4. Persistência e Filtro no Banco de Dados ---');
    const docDb = {
      empresa: 'SEM_REGISTRO',
      empresa_razao_social: '',
      empresa_cnpj: '',
      tipo_documento: '13_PRIMEIRA_PARCELA',
      tipo_documento_label: '13º Salário - 1ª Parcela',
      competencia_mes: 11,
      competencia_ano: 2026,
      competencia_formatada: 'Novembro de 2026',
      data_pagamento: '20/11/2026',
      funcionario_codigo: 'SEM_REG',
      funcionario_nome: 'TESTE MANOEL DA COSTA',
      funcionario_cpf: '444.555.666-77',
      funcionario_cargo: 'Auxiliar Autônomo',
      funcionario_tipo_contrato: 'Sem Registro',
      salario_base: 2200.00,
      total_vencimentos: 2200.00,
      total_descontos: 0.00,
      valor_liquido: 2200.00,
      valor_liquido_extenso: 'Dois mil e duzentos reais',
      eventos: [
        { codigo: '001', descricao: '13º Salário - 1ª Parcela', referencia: '1,00', vencimento: 2200.00, desconto: 0.00 }
      ],
      origem_arquivo_nome: 'Emissão Manual PF',
      origem_arquivo_tipo: 'MANUAL_PF',
      origem_pagina: 1,
      status: 'ATIVO'
    };

    const salvos = await salvarHoleritesDB([docDb], 'test_runner');
    assert.ok(salvos.length > 0, 'Deveria persistir o documento manual PF');
    const salvo = salvos.find(s => s.funcionario_nome === 'TESTE MANOEL DA COSTA');
    assert.ok(salvo, 'Deveria localizar o documento persistido');
    assert.strictEqual(salvo.empresa, 'SEM_REGISTRO');
    assert.strictEqual(parseFloat(salvo.valor_liquido), 2200.00);

    // Consulta filtrada por empresa SEM_REGISTRO
    const listaSemReg = await obterHoleritesDB({ empresa: 'SEM_REGISTRO', busca: 'MANOEL' });
    assert.ok(listaSemReg.some(d => d.funcionario_nome === 'TESTE MANOEL DA COSTA'), 'Documento deve ser recuperável na busca e filtro Sem Registro');

    // Limpeza
    if (salvo.id) {
      await excluirHoleriteDB(salvo.id, 'test_cleanup');
    }

    report('Documento manual PF gravado, indexado por Sem Registro e excluído sem efeitos colaterais', true);
  } catch (err) {
    report('Documento manual PF gravado, indexado por Sem Registro e excluído sem efeitos colaterais', false, err.message);
  }

  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${passed} Aprovados, ${failed} Falhas`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
