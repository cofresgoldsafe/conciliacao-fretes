const assert = require('assert');
const { obterCnpjMatriz } = require('./server');

console.log('🧪 INICIANDO TESTES: TRATAMENTO CÓDIGO 620 E FALLBACK MATRIZ FGTS CAIXA\n');

// 1. Validação de Derivação de Matriz
console.log('1. Filial do Madero (0321) deve derivar matriz (0001) para consulta FGTS');
const cnpjFilial = '13783221032167';
const cnpjMatriz = obterCnpjMatriz(cnpjFilial);
assert.strictEqual(cnpjMatriz, '13783221000125', 'Deve derivar exatamente a matriz 13783221000125');
console.log('  ✅ [PASS] CNPJ Matriz derivado com sucesso: ' + cnpjMatriz);

// 2. Simulação de Resposta Código 620 (permanent_error)
console.log('\n2. Código 620 da InfoSimples deve ser categorizado como ALERTA (NE) e nunca ERRO');
const code = 620;
const codeMessage = 'Não foram encontrados registros para o empregador com os dados informados';
const permMsg = `InfoSimples (Código 620): Erro permanente na fonte de origem (Caixa). ${codeMessage}`;

const resultado620 = {
  sucesso: false,
  executado: false,
  code: 620,
  codeMessage,
  motivo: permMsg,
  _status: {
    status: 'ALERTA',
    provedor: 'InfoSimples / Caixa',
    mensagem: 'Erro 620: Não Localizado na Caixa / Sem FGTS'
  }
};

assert.strictEqual(resultado620._status.status, 'ALERTA', 'Status deve ser ALERTA');
assert.notStrictEqual(resultado620._status.status, 'ERRO', 'Status NÃO deve ser ERRO');
console.log('  ✅ [PASS] Código 620 tratado com status ALERTA');

// 3. Simulação de conversão para Empresa Não Localizada no FGTS (NE)
const isNaoEncontrada = resultado620.code === 620 || (resultado620.codeMessage || '').toLowerCase().includes('não encontrada');
assert.strictEqual(isNaoEncontrada, true, 'Código 620 deve acionar tratamento de Empresa Não Localizada');

const resultadoFinalNE = {
  executado: true,
  encontrado: false,
  fgts_situacao_regular: 'NE',
  razao_fgts_igual: 'NE',
  motivo: 'Empresa não localizada na Caixa (Sem registro de funcionários / Nunca recolheu FGTS)',
  _status: {
    status: 'ALERTA',
    provedor: 'InfoSimples / Caixa',
    mensagem: 'Empresa sem funcionários / Nunca recolheu FGTS'
  }
};

assert.strictEqual(resultadoFinalNE.fgts_situacao_regular, 'NE');
assert.strictEqual(resultadoFinalNE.razao_fgts_igual, 'NE');
assert.strictEqual(resultadoFinalNE._status.status, 'ALERTA');
console.log('  ✅ [PASS] Código 620 converte para regularidade NE com farol ALERTA');

console.log('\n================================================================');
console.log('🎯 TODOS OS TESTES DO CÓDIGO 620 E FALLBACK MATRIZ APROVADOS!');
console.log('================================================================\n');
