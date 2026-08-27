/**
 * Testes Automatizados: Automação do Campo Registro.Br Confere via RDAP e Raiz do CNPJ
 */

const assert = require('assert');
const { calcularScore } = require('./analise_credito_engine');

console.log('====================================================');
console.log('🧪 TESTES: AUTOMAÇÃO REGISTRO.BR & RAIZ DO CNPJ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
  }
}

// Simulador da função pura de comparação de Registro.Br
function compararRegistroBr(cnpjCliente, infoRDAP, dominioPrincipal) {
  if (!infoRDAP) {
    if (dominioPrincipal && !dominioPrincipal.toLowerCase().endsWith('.br')) {
      return {
        valor: 'N',
        confere: false,
        motivo: 'Domínio internacional (.com/.org) não gerido pelo Registro.br',
        dominio: dominioPrincipal
      };
    }
    return {
      valor: 'N',
      confere: false,
      motivo: dominioPrincipal ? 'Domínio não encontrado no Registro.br' : 'Cliente sem domínio próprio',
      dominio: dominioPrincipal || ''
    };
  }

  const cnpjCliDigits = String(cnpjCliente || '').replace(/\D/g, '');
  const cnpjCliRaiz = cnpjCliDigits.length >= 8 ? cnpjCliDigits.substring(0, 8) : '';

  if (infoRDAP.tipoDocumento === 'cnpj' || (infoRDAP.cnpjDigits && infoRDAP.cnpjDigits.length === 14)) {
    const regDigits = infoRDAP.cnpjDigits || (infoRDAP.documento || '').replace(/\D/g, '');
    const regRaiz = regDigits.length >= 8 ? regDigits.substring(0, 8) : '';

    if (cnpjCliRaiz && regRaiz) {
      if (cnpjCliRaiz === regRaiz) {
        return {
          valor: 'S',
          confere: true,
          motivo: 'CNPJ confere pela raiz (Matriz/Filial)',
          cnpjCliente: cnpjCliente || '',
          cnpjRegistroBr: infoRDAP.documento || '',
          titularRegistroBr: infoRDAP.titular || '',
          dominio: infoRDAP.dominio || ''
        };
      } else {
        return {
          valor: 'N',
          confere: false,
          motivo: 'CNPJ divergente no Registro.br',
          cnpjCliente: cnpjCliente || '',
          cnpjRegistroBr: infoRDAP.documento || '',
          titularRegistroBr: infoRDAP.titular || '',
          dominio: infoRDAP.dominio || ''
        };
      }
    }
  } else if (infoRDAP.tipoDocumento === 'cpf') {
    return {
      valor: 'N',
      confere: false,
      motivo: 'Domínio registrado por CPF (Pessoa Física)',
      cnpjCliente: cnpjCliente || '',
      cpfRegistroBr: infoRDAP.documento || '',
      titularRegistroBr: infoRDAP.titular || '',
      dominio: infoRDAP.dominio || ''
    };
  }

  return {
    valor: 'N',
    confere: false,
    motivo: 'Documento não identificado no Registro.br',
    dominio: infoRDAP.dominio || ''
  };
}

// 1. Cenário Matriz x Filial: Mesma Raiz de CNPJ
runTest('Cenário 1: Filial comprando com domínio registrado na Matriz -> Confere Sim (S)', () => {
  const cnpjClienteFilial = '14.061.778/0002-00'; // Filial 0002
  const infoRDAPMatriz = {
    dominio: 'gsicofres.com.br',
    documento: '14.061.778/0001-15', // Matriz 0001
    tipoDocumento: 'cnpj',
    cnpjDigits: '14061778000115',
    cnpjRaiz: '14061778',
    titular: 'GSICOFRES COMERCIO E SERVICOS LTDA'
  };

  const res = compararRegistroBr(cnpjClienteFilial, infoRDAPMatriz, 'gsicofres.com.br');
  assert.strictEqual(res.valor, 'S');
  assert.strictEqual(res.confere, true);
  assert.strictEqual(res.cnpjRegistroBr, '14.061.778/0001-15');
  assert.strictEqual(res.motivo, 'CNPJ confere pela raiz (Matriz/Filial)');
});

// 2. Cenário Matriz x Matriz: CNPJ Exatamente Igual
runTest('Cenário 2: Matriz comprando com domínio da Matriz -> Confere Sim (S)', () => {
  const cnpjClienteMatriz = '47.960.950/0001-21';
  const infoRDAP = {
    dominio: 'magazineluiza.com.br',
    documento: '47.960.950/0001-21',
    tipoDocumento: 'cnpj',
    cnpjDigits: '47960950000121',
    cnpjRaiz: '47960950',
    titular: 'MAGAZINE LUIZA S/A'
  };

  const res = compararRegistroBr(cnpjClienteMatriz, infoRDAP, 'magazineluiza.com.br');
  assert.strictEqual(res.valor, 'S');
  assert.strictEqual(res.confere, true);
  assert.strictEqual(res.titularRegistroBr, 'MAGAZINE LUIZA S/A');
});

// 3. Cenário CNPJs Divergentes (Raiz Diferente)
runTest('Cenário 3: CNPJ do cliente diferente do Registro.br -> Divergente Não (N)', () => {
  const cnpjGolpe = '99.888.777/0001-00';
  const infoRDAP = {
    dominio: 'kalunga.com.br',
    documento: '43.283.811/0001-50',
    tipoDocumento: 'cnpj',
    cnpjDigits: '43283811000150',
    cnpjRaiz: '43283811',
    titular: 'KALUNGA SA'
  };

  const res = compararRegistroBr(cnpjGolpe, infoRDAP, 'kalunga.com.br');
  assert.strictEqual(res.valor, 'N');
  assert.strictEqual(res.confere, false);
  assert.strictEqual(res.motivo, 'CNPJ divergente no Registro.br');
});

// 4. Cenário Domínio Registrado sob CPF
runTest('Cenário 4: Domínio registrado sob CPF de Pessoa Física -> Não (N)', () => {
  const cnpjCliente = '14.061.778/0001-15';
  const infoRDAP = {
    dominio: 'oaco.com.br',
    documento: '***.949.258-**',
    tipoDocumento: 'cpf',
    titular: 'Alexandre Rodrigues Arrais'
  };

  const res = compararRegistroBr(cnpjCliente, infoRDAP, 'oaco.com.br');
  assert.strictEqual(res.valor, 'N');
  assert.strictEqual(res.confere, false);
  assert.strictEqual(res.motivo, 'Domínio registrado por CPF (Pessoa Física)');
});

// 5. Cenário Domínio Internacional (.com)
runTest('Cenário 5: Domínio internacional (.com/.org) sem RDAP .br -> Não (N)', () => {
  const cnpjCliente = '14.061.778/0001-15';
  const res = compararRegistroBr(cnpjCliente, null, 'empresa.com');
  assert.strictEqual(res.valor, 'N');
  assert.strictEqual(res.confere, false);
  assert.strictEqual(res.motivo, 'Domínio internacional (.com/.org) não gerido pelo Registro.br');
});

// 6. Cenário Cliente sem Domínio
runTest('Cenário 6: Cliente sem site e sem domínio de e-mail corporativo -> Não (N)', () => {
  const cnpjCliente = '14.061.778/0001-15';
  const res = compararRegistroBr(cnpjCliente, null, '');
  assert.strictEqual(res.valor, 'N');
  assert.strictEqual(res.confere, false);
  assert.strictEqual(res.motivo, 'Cliente sem domínio próprio');
});

// 7. Impacto na Pontuação: Entrega Diferente + Registro.Br Confere (+6 pts)
runTest('Cenário 7: Entrega Diferente e Registro.Br Confere concede +6 pts de segurança', () => {
  const payload = {
    total_pedido: 10000,
    faturado: 'S',
    entrada: 'N',
    comprou_pagou: 'S',
    comprou_pagou_5x: 'N',
    pgtos_abertos: 'N',
    quant_grande: 'N',
    prod_nao_combinam: 'N',
    armario_cofre_gt_2000: 'N',
    uf_cliente: 'SP',
    cnpj_ativo: 'S',
    fundacao_matriz: '2010-01-01',
    capital_social: 500000,
    entrega_igual_cadastro: 'N', // Entrega Diferente
    google_maps: '5',
    registro_br: 'S', // Confere
    score_serasa: '750',
    protestos: 'N',
    tres_nfs_confirmadas: 'D'
  };

  const resultado = calcularScore(payload);
  assert.strictEqual(resultado.detalhesPontos.registro_br, 6, 'Deve pontuar +6 pts quando entrega dif e registro_br=S');
  assert.strictEqual(resultado.detalhesPontos.entrega_igual_cadastro, -9, 'Entrega diferente pontua -9 pts');
});

// 8. Impacto na Pontuação: Entrega Igual + Registro.Br Confere (Dispensado 0 pts)
runTest('Cenário 8: Entrega Igual e Registro.Br Confere é dispensado (0 pts)', () => {
  const payload = {
    total_pedido: 10000,
    faturado: 'S',
    entrada: 'N',
    comprou_pagou: 'S',
    comprou_pagou_5x: 'N',
    pgtos_abertos: 'N',
    quant_grande: 'N',
    prod_nao_combinam: 'N',
    armario_cofre_gt_2000: 'N',
    uf_cliente: 'SP',
    cnpj_ativo: 'S',
    fundacao_matriz: '2010-01-01',
    capital_social: 500000,
    entrega_igual_cadastro: 'S', // Entrega Igual ao Cadastro
    google_maps: '5',
    registro_br: 'S',
    score_serasa: '750',
    protestos: 'N',
    tres_nfs_confirmadas: 'D'
  };

  const resultado = calcularScore(payload);
  assert.strictEqual(resultado.detalhesPontos.registro_br, 0, 'Deve pontuar 0 pts (dispensado) quando entrega é igual ao cadastro');
  assert.strictEqual(resultado.detalhesPontos.entrega_igual_cadastro, 2, 'Entrega igual pontua +2 pts');
});

console.log('\n====================================================');
console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} testes aprovados (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
