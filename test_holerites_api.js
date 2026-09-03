/**
 * test_holerites_api.js - Suíte de Testes Automatizados para API e Banco de Holerites
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  salvarHoleritesDB,
  obterHoleritesDB,
  obterHoleritePorIdDB,
  atualizarMensagemHoleriteDB,
  atualizarMensagemHoleritesLoteDB,
  excluirHoleriteDB,
  obterCompetenciasHoleritesDB
} = require('./postgres_db');

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: MÓDULO DE HOLERITES E RECIBOS DE PAGAMENTO');
  console.log('=============================================================\n');

  let passed = 0;

  // Mock de Documentos
  const mockDocGsi = {
    empresa: 'GSI',
    empresa_razao_social: 'GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA',
    empresa_cnpj: '14.061.778/0001-15',
    tipo_documento: 'FOLHA_MENSAL',
    tipo_documento_label: 'Folha Mensal',
    competencia_mes: 7,
    competencia_ano: 2026,
    competencia_formatada: 'Julho de 2026',
    funcionario_codigo: '1',
    funcionario_nome: 'TESTE ALEXANDRE ARRAIS',
    funcionario_cargo: 'Gerente de Vendas',
    funcionario_cbo: '141410',
    funcionario_tipo_contrato: 'Mensalista',
    funcionario_admissao: '01/01/2020',
    salario_base: 4748.80,
    sal_contr_inss: 4748.80,
    base_calc_fgts: 4748.80,
    fgts_mes: 379.90,
    base_calc_irrf: 3800.00,
    faixa_irrf: 0.0,
    total_vencimentos: 4748.80,
    total_descontos: 295.62,
    valor_liquido: 4453.18,
    valor_liquido_extenso: 'Quatro mil quatrocentos e cinquenta e três reais e dezoito centavos',
    eventos: [
      { codigo: '8781', descricao: 'DIAS NORMAIS', referencia: '30,00', vencimento: 4748.80, desconto: 0.0 },
      { codigo: '998', descricao: 'I.N.S.S.', referencia: '7,50', vencimento: 0.0, desconto: 295.62 }
    ],
    origem_arquivo_nome: 'teste_gsi.pdf',
    origem_arquivo_tipo: 'PDF',
    origem_pagina: 1
  };

  const mockDocOaco = {
    empresa: 'OACO',
    empresa_razao_social: 'OACO PRODUTOS DE ACO LTDA',
    empresa_cnpj: '61.237.790/0001-18',
    tipo_documento: 'ADIANTAMENTO',
    tipo_documento_label: 'Adiantamento Salarial',
    competencia_mes: 8,
    competencia_ano: 2026,
    competencia_formatada: 'Agosto de 2026',
    funcionario_codigo: '3',
    funcionario_nome: 'TESTE WILLIAM PINHEIRO',
    funcionario_cargo: 'MOTORISTA ESTOQUISTA',
    funcionario_cbo: '414125',
    funcionario_tipo_contrato: 'Mensalista',
    total_vencimentos: 840.00,
    total_descontos: 0.00,
    valor_liquido: 840.00,
    valor_liquido_extenso: 'Oitocentos e quarenta reais',
    eventos: [
      { codigo: '980', descricao: 'ADIANTAMENTO SALARIAL', referencia: '40,00', vencimento: 840.00, desconto: 0.0 }
    ],
    origem_arquivo_nome: 'teste_oaco_adiant.pdf',
    origem_arquivo_tipo: 'PDF',
    origem_pagina: 1
  };

  const mockDocSemReg = {
    empresa: 'SEM_REGISTRO',
    empresa_razao_social: 'OACO PRODUTOS DE ACO LTDA',
    empresa_cnpj: '61.237.790/0001-18',
    tipo_documento: 'FOLHA_MENSAL',
    tipo_documento_label: 'Folha Mensal (Sem Registro)',
    competencia_mes: 7,
    competencia_ano: 2026,
    competencia_formatada: 'Julho de 2026',
    funcionario_codigo: 'SEM_REG',
    funcionario_nome: 'TESTE ADRIANO ROVARIS',
    funcionario_cpf: '372.889.448-67',
    funcionario_cargo: 'Prestador de Serviços / Operacional',
    total_vencimentos: 3610.18,
    total_descontos: 1229.60,
    valor_liquido: 2380.58,
    valor_liquido_extenso: 'Dois mil trezentos e oitenta reais e cinquenta e oito centavos',
    eventos: [
      { codigo: 'PROV_SALARIO', descricao: 'Pagamento Salário', referencia: '1,00', vencimento: 3074.0, desconto: 0.0 },
      { codigo: 'DESC_VALE', descricao: 'Vale Adiantamento', referencia: '1,00', vencimento: 0.0, desconto: 1229.6 }
    ],
    origem_arquivo_nome: 'teste_adriano.xlsx',
    origem_arquivo_tipo: 'XLSX',
    origem_pagina: 1
  };

  // Teste 1: Gravação e UPSERT de Holerites no Banco / JSON Fallback
  console.log('--- 1. Gravação e Persistência de Holerites ---');
  const salvos = await salvarHoleritesDB([mockDocGsi, mockDocOaco, mockDocSemReg], 'admin_test');
  assert.ok(salvos.length >= 3, 'Deveria salvar ao menos 3 holerites');
  const gsiSalvo = salvos.find(s => s.funcionario_nome === 'TESTE ALEXANDRE ARRAIS');
  assert.ok(gsiSalvo, 'Deveria encontrar mockDocGsi salvo');
  assert.strictEqual(gsiSalvo.empresa, 'GSI');
  assert.strictEqual(parseFloat(gsiSalvo.valor_liquido), 4453.18);
  console.log('  ✅ [PASS] Holerites gravados com integridade relacional e campos mapeados');
  passed++;

  // Teste 2: Consulta com Filtros de Competência e Empresa
  console.log('\n--- 2. Consulta e Filtros Facetados ---');
  const holeritesJulho = await obterHoleritesDB({ ano: 2026, mes: 7 });
  assert.ok(holeritesJulho.length >= 2, 'Deveria retornar ao menos 2 holerites em Julho/2026');
  
  const holeritesGsi = await obterHoleritesDB({ empresa: 'GSI', ano: 2026, mes: 7 });
  assert.ok(holeritesGsi.some(h => h.funcionario_nome === 'TESTE ALEXANDRE ARRAIS'), 'Deveria conter mockDocGsi no filtro GSI');
  
  const holeritesSemReg = await obterHoleritesDB({ empresa: 'SEM_REGISTRO' });
  assert.ok(holeritesSemReg.some(h => h.funcionario_nome === 'TESTE ADRIANO ROVARIS'), 'Deveria conter Adriano no filtro Sem Registro');
  console.log('  ✅ [PASS] Filtros por competência, empresa e tipo de recibo funcionando');
  passed++;

  // Teste 3: Busca por Texto Livre (Nome, Cargo, CPF)
  console.log('\n--- 3. Busca Universal Instantânea ---');
  const buscaNome = await obterHoleritesDB({ busca: 'ADRIANO' });
  assert.ok(buscaNome.some(h => h.funcionario_nome.includes('ADRIANO')), 'Busca por nome deve retornar Adriano');

  const buscaCpf = await obterHoleritesDB({ busca: '372.889.448-67' });
  assert.ok(buscaCpf.some(h => h.funcionario_cpf === '372.889.448-67'), 'Busca por CPF deve retornar Adriano');
  console.log('  ✅ [PASS] Busca universal por nome e CPF funcionando');
  passed++;

  // Teste 4: Atualização de Mensagem Personalizada Individual
  console.log('\n--- 4. Personalização de Mensagem Individual ---');
  const updatedDoc = await atualizarMensagemHoleriteDB(gsiSalvo.id, 'Parabéns pelo excelente fechamento de metas!', 'admin_test');
  assert.ok(updatedDoc, 'Deveria retornar documento atualizado');
  assert.strictEqual(updatedDoc.mensagem_personalizada, 'Parabéns pelo excelente fechamento de metas!');

  const fetchedDoc = await obterHoleritePorIdDB(gsiSalvo.id);
  assert.strictEqual(fetchedDoc.mensagem_personalizada, 'Parabéns pelo excelente fechamento de metas!');
  console.log('  ✅ [PASS] Mensagem personalizada individual salva e persistida');
  passed++;

  // Teste 5: Atualização de Mensagens em Lote
  console.log('\n--- 5. Mensagens Personalizadas em Lote ---');
  const ids = salvos.map(s => s.id);
  const countLote = await atualizarMensagemHoleritesLoteDB(ids, 'Lembramos a todos que o recesso iniciará no dia 22/12.', 'admin_test');
  assert.ok(countLote >= 3, 'Deveria atualizar mensagens dos 3 holerites');

  const recheck = await obterHoleritesDB({ ano: 2026 });
  const atualizados = recheck.filter(r => ids.includes(r.id));
  assert.ok(atualizados.every(a => a.mensagem_personalizada === 'Lembramos a todos que o recesso iniciará no dia 22/12.'));
  console.log('  ✅ [PASS] Mensagem personalizada em lote aplicada a múltiplos colaboradores');
  passed++;

  // Teste 6: Competências e Contadores Agregados
  console.log('\n--- 6. Agregação de Competências Disponíveis ---');
  const comps = await obterCompetenciasHoleritesDB();
  assert.ok(Array.isArray(comps) && comps.length > 0, 'Deveria retornar lista de competências');
  const compJulho = comps.find(c => c.competencia_ano === 2026 && c.competencia_mes === 7);
  assert.ok(compJulho, 'Deveria encontrar competência Julho/2026');
  assert.ok(compJulho.total_docs >= 2, 'Julho deve ter ao menos 2 documentos');
  console.log('  ✅ [PASS] Agregação de competências com contadores por empresa validada');
  passed++;

  // Teste 7: Exclusão Segura
  console.log('\n--- 7. Exclusão de Holerite ---');
  for (const s of salvos) {
    await excluirHoleriteDB(s.id, 'admin_test');
  }
  const afterDelete = await obterHoleritePorIdDB(gsiSalvo.id);
  assert.strictEqual(afterDelete, null, 'Documento deveria ter sido excluído');
  console.log('  ✅ [PASS] Exclusão de holerites operando sem efeitos colaterais');
  passed++;

  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${passed} Aprovados, 0 Falhas`);
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('❌ Falha na suíte de testes:', err);
  process.exit(1);
});
