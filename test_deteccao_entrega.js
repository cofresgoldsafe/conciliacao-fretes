const test = require('node:test');
const assert = require('node:assert');
const { detectarEnderecoEntregaDiferente } = require('./protheus_db');
const { calcularScore } = require('./analise_credito_engine');

test('Suíte de Testes: Detecção Automática de Endereço de Entrega Diferente', async (t) => {

  await t.test('1. Detecção por C5_TRANSP = 000009 (Cliente Retira / Redespacho)', () => {
    // Código padrão com 6 dígitos
    const r1 = detectarEnderecoEntregaDiferente('', '000009');
    assert.strictEqual(r1.temEnderecoDiferente, true);
    assert.strictEqual(r1.origem, 'TRANSP_000009');
    assert.match(r1.motivo, /Transportadora 000009/);

    // Código numérico simples '9'
    const r2 = detectarEnderecoEntregaDiferente('', '9');
    assert.strictEqual(r2.temEnderecoDiferente, true);
    assert.strictEqual(r2.origem, 'TRANSP_000009');

    // Código com espaços ' 000009 '
    const r3 = detectarEnderecoEntregaDiferente('', ' 000009 ');
    assert.strictEqual(r3.temEnderecoDiferente, true);
    assert.strictEqual(r3.origem, 'TRANSP_000009');

    // Código com 2 dígitos '09'
    const r4 = detectarEnderecoEntregaDiferente('', '09');
    assert.strictEqual(r4.temEnderecoDiferente, true);
    assert.strictEqual(r4.origem, 'TRANSP_000009');
  });

  await t.test('2. Transportadora Comum (C5_TRANSP != 000009) sem observação deve retornar falso', () => {
    const r1 = detectarEnderecoEntregaDiferente('', '000001');
    assert.strictEqual(r1.temEnderecoDiferente, false);
    assert.strictEqual(r1.origem, 'NENHUM');

    const r2 = detectarEnderecoEntregaDiferente('', 'RODONAVES');
    assert.strictEqual(r2.temEnderecoDiferente, false);
    assert.strictEqual(r2.origem, 'NENHUM');

    const r3 = detectarEnderecoEntregaDiferente('', '');
    assert.strictEqual(r3.temEnderecoDiferente, false);
    assert.strictEqual(r3.origem, 'NENHUM');
  });

  await t.test('3. Detecção por C5_MENNOTA com "END ENTREGA"', () => {
    const mennota = 'END ENTREGA RUA AFONSO CARDOSO DA VEIGA, 600 REF POUSADA BAIRRO CANASVIEIRAS FLORIANOPOLIS SC CEP 88054050 PED LOJA 9035 CORREIOS PAC Ped Venda: 000760 Cod Web: 26435';
    const r = detectarEnderecoEntregaDiferente(mennota, '000001');
    assert.strictEqual(r.temEnderecoDiferente, true);
    assert.strictEqual(r.origem, 'MENNOTA');
    assert.match(r.enderecoExtraido, /RUA AFONSO CARDOSO DA VEIGA/i);
    assert.match(r.enderecoExtraido, /88054050/);
  });

  await t.test('4. Detecção por C5_MENNOTA com "ENDERECO DE ENTREGA" / "ENDEREÇO DE ENTREGA"', () => {
    const mennota1 = 'COT 217561766 PED P09938 ENDERECO DE ENTREGA AVENIDA LUIZ PELLIZZARI 370 DISTRITO INDUSTRIAL JUNDIAI SP CEP 13213073 HORARIO DE ENTREGA 8H AS 17H Ped Venda: 000292 Cod Web: 25992';
    const r1 = detectarEnderecoEntregaDiferente(mennota1, '');
    assert.strictEqual(r1.temEnderecoDiferente, true);
    assert.strictEqual(r1.origem, 'MENNOTA');
    assert.match(r1.enderecoExtraido, /AVENIDA LUIZ PELLIZZARI/i);

    const mennota2 = 'ENDEREÇO DE ENTREGA CONDOMINIO ESPACE CENTER GALPÃO 07 E 09 RUA CAMPOS VERGUEIRO 256 SAO PAULO-SP Ped Venda: 001701';
    const r2 = detectarEnderecoEntregaDiferente(mennota2, '');
    assert.strictEqual(r2.temEnderecoDiferente, true);
    assert.strictEqual(r2.origem, 'MENNOTA');
    assert.match(r2.enderecoExtraido, /CAMPOS VERGUEIRO/i);
  });

  await t.test('5. Detecção por C5_MENNOTA com "END DE ENTREGA" e "LOCAL DE ENTREGA"', () => {
    const mennota1 = 'AC DA DIRETORIA UNESP - COT 220314021 END DE ENTREGA AV ENG FRANCISCO J LONGO 777 SAO DIMAS SJ DOS CAMPOS CEP 12245-000 Ped Venda: 000342';
    const r1 = detectarEnderecoEntregaDiferente(mennota1, '');
    assert.strictEqual(r1.temEnderecoDiferente, true);
    assert.strictEqual(r1.origem, 'MENNOTA');
    assert.match(r1.enderecoExtraido, /AV ENG FRANCISCO J LONGO/i);

    const mennota2 = 'PEDIDO 123 LOCAL DE ENTREGA RUA DAS FLORES 99 CENTRO CURITIBA PR CEP 80000000 AC JOAO';
    const r2 = detectarEnderecoEntregaDiferente(mennota2, '');
    assert.strictEqual(r2.temEnderecoDiferente, true);
    assert.strictEqual(r2.origem, 'MENNOTA');
    assert.match(r2.enderecoExtraido, /RUA DAS FLORES 99/i);
  });

  await t.test('6. Detecção por C5_MENNOTA com "ENTREGAR EM" / "ENTREGAR NA"', () => {
    const mennota = 'SEGUNDA A SEXTA ENTREGAR NA RUA GENERAL VENANCIO FLORES 305 SALA 710 LEBLON RIO DE JANEIRO RJ CEP 22441090 FRETE CORREIOS';
    const r = detectarEnderecoEntregaDiferente(mennota, '');
    assert.strictEqual(r.temEnderecoDiferente, true);
    assert.strictEqual(r.origem, 'MENNOTA');
    assert.match(r.enderecoExtraido, /RUA GENERAL VENANCIO FLORES/i);
  });

  await t.test('7. Dupla Regra Simultânea: C5_TRANSP = 000009 E C5_MENNOTA com endereço', () => {
    const mennota = 'END ENTREGA CALCADA DOS ANTURIOS 21 ALPHAVILLE BARUERI SP CEP 06453055';
    const r = detectarEnderecoEntregaDiferente(mennota, '000009');
    assert.strictEqual(r.temEnderecoDiferente, true);
    assert.strictEqual(r.origem, 'AMBOS');
    assert.match(r.motivo, /Transportadora 000009 \+ Endereço em C5_MENNOTA/);
    assert.match(r.enderecoExtraido, /CALCADA DOS ANTURIOS/i);
  });

  await t.test('8. Rejeição de Falsos Positivos (Instruções operacionais e horários sem endereço)', () => {
    // Apenas horário de entrega
    const m1 = 'HORARIO DE ENTREGA 8H AS 18H DE SEGUNDA A SEXTA AC ALMOXARIFADO';
    const r1 = detectarEnderecoEntregaDiferente(m1, '000001');
    assert.strictEqual(r1.temEnderecoDiferente, false);

    // Instrução de recebimento sem endereço novo
    const m2 = 'RECEBE DAS 9H AS 16H AC CARLOS TEL 11 99999999 PAGAMENTO BANCO INTER';
    const r2 = detectarEnderecoEntregaDiferente(m2, '000001');
    assert.strictEqual(r2.temEnderecoDiferente, false);

    // Texto genérico
    const m3 = 'COT 218438582 FRETE RODONAVES Ped Venda: 000663 Cod Web: 25973';
    const r3 = detectarEnderecoEntregaDiferente(m3, '000001');
    assert.strictEqual(r3.temEnderecoDiferente, false);
  });

  await t.test('9. Integração com Motor de Score (analise_credito_engine)', () => {
    // Cenário A: Entrega Diferente ('N') em Pedido Faturado -> Penalidade -9 pts e Alerta de Perigo
    const resA = calcularScore({
      total_pedido: 5000,
      faturado: 'S',
      entrada: 'N',
      entrega_igual_cadastro: 'N',
      cadastro_igual_receita: 'S',
      cnpj_ativo: 'S',
      pgtos_abertos: 'N',
      comprou_pagou: 'S',
      uf_cliente: 'SP',
      google_maps: '5',
      registro_br: 'N',
      score_serasa: 'BOM',
      protestos: 'N',
      pfin: 'N',
      ch_sem_fundo: 'N',
      fgts_situacao_regular: 'S',
      razao_fgts_igual: 'S',
      tres_nfs_confirmadas: 'D'
    });

    assert.strictEqual(resA.detalhesPontos.entrega_igual_cadastro, -9);
    assert.strictEqual(resA.alertaPerigoGolpe, 'PERIGO CHECAGEM REVERSA');

    // Cenário B: Entrega Igual ('S') -> Bônus +2 pts e sem alerta de golpe
    const resB = calcularScore({
      total_pedido: 5000,
      faturado: 'S',
      entrada: 'N',
      entrega_igual_cadastro: 'S',
      cadastro_igual_receita: 'S',
      cnpj_ativo: 'S',
      pgtos_abertos: 'N',
      comprou_pagou: 'S',
      uf_cliente: 'SP',
      google_maps: '5',
      registro_br: 'N',
      score_serasa: 'BOM',
      protestos: 'N',
      pfin: 'N',
      ch_sem_fundo: 'N',
      fgts_situacao_regular: 'S',
      razao_fgts_igual: 'S',
      tres_nfs_confirmadas: 'D'
    });

    assert.strictEqual(resB.detalhesPontos.entrega_igual_cadastro, 2);
    assert.strictEqual(resB.alertaPerigoGolpe, 'N/A');
  });

});
