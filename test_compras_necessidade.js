/**
 * test_compras_necessidade.js
 * 
 * Suite de Testes Automatizados para a tela "Necessidade de Compras" (Módulo Compras)
 * Valida:
 * 1. Tratamento e validação de parâmetros de empresa e modo
 * 2. Batimento exato dos dados da Empresa 16 contra o print do Protheus (necessidade-empresa-16.png)
 * 3. Precisão matemática do cálculo: (Ponto de Ped + Ped Vendas) - (Saldo Estoque + Ped Compras)
 * 4. Validação da nova coluna 'Nome Fornec' (primeiros 15 dígitos da SA2010)
 * 5. Comportamento do filtro 'Somente Novas Necessidades' vs 'Novas e Pendentes'
 * 6. Consulta nas empresas 14 (Metal Pleno) e 15 (GSI)
 */

const assert = require('assert');
const { consultarNecessidadeComprasProtheus } = require('./protheus_db');

let passCount = 0;
let failCount = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     Erro: ${err.message}`);
    failCount++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     Erro: ${err.message}`);
    failCount++;
  }
}

async function runTests() {
  console.log('🧪 Iniciando Bateria de Testes: Necessidade de Compras Protheus...\n');

  // 1. Validação de Parâmetros
  await itAsync('Deve rejeitar empresas inválidas ou não selecionadas', async () => {
    let errorCaught = false;
    try {
      await consultarNecessidadeComprasProtheus({ empresa: '' });
    } catch (e) {
      errorCaught = true;
      assert(e.message.includes('Empresa inválida'));
    }
    assert.strictEqual(errorCaught, true, 'Deveria lançar erro para empresa vazia');

    try {
      await consultarNecessidadeComprasProtheus({ empresa: '99' });
      assert.fail('Deveria falhar para empresa inexistente');
    } catch (e) {
      assert(e.message.includes('Empresa inválida'));
    }
  });

  // 2. Batimento Fiel com o Print Protheus (necessidade-empresa-16.png)
  await itAsync('Empresa 16 (OAÇO) - Modo "novas" deve conter os 7 produtos do print Protheus', async () => {
    const res = await consultarNecessidadeComprasProtheus({ empresa: '16', modo: 'novas' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.empresa, '16');
    assert.strictEqual(res.modo, 'novas');
    assert(Array.isArray(res.itens));
    assert(res.itens.length >= 7, `Deveria ter pelo menos 7 itens, encontrou ${res.itens.length}`);

    const mapaProds = new Map(res.itens.map(i => [i.produto, i]));

    // 1. 01801080801B001
    const p1 = mapaProds.get('01801080801B001');
    assert(p1, 'Produto 01801080801B001 deve estar presente');
    assert.strictEqual(p1.pedVendas, 0);
    assert.strictEqual(p1.pedCompras, 0);
    assert.strictEqual(p1.saldoEstoque, 0);
    assert.strictEqual(p1.pontoPed, 5);
    assert.strictEqual(p1.necessidade, 5);
    assert.strictEqual(p1.codFornec, '120415');
    assert.strictEqual(p1.nomeFornec, 'GSI COMERCIO DE');

    // 2. 01801080802B001
    const p2 = mapaProds.get('01801080802B001');
    assert(p2, 'Produto 01801080802B001 deve estar presente');
    assert.strictEqual(p2.pedVendas, 0);
    assert.strictEqual(p2.pedCompras, 0);
    assert.strictEqual(p2.saldoEstoque, 0);
    assert.strictEqual(p2.pontoPed, 11);
    assert.strictEqual(p2.necessidade, 11);
    assert.strictEqual(p2.codFornec, '120415');

    // 3. 01801080802B003 (Saldo negativo: -1, PP: 25 -> Necessidade: 26)
    const p3 = mapaProds.get('01801080802B003');
    assert(p3, 'Produto 01801080802B003 deve estar presente');
    assert.strictEqual(p3.pedVendas, 0);
    assert.strictEqual(p3.pedCompras, 0);
    assert.strictEqual(p3.saldoEstoque, -1);
    assert.strictEqual(p3.pontoPed, 25);
    assert.strictEqual(p3.necessidade, 26, 'Necessidade de 25 - (-1) deve ser exatamente 26');
    assert.strictEqual(p3.codFornec, '120415');

    // 4. 01801080802B005
    const p4 = mapaProds.get('01801080802B005');
    assert(p4, 'Produto 01801080802B005 deve estar presente');
    assert.strictEqual(p4.pedVendas, 0);
    assert.strictEqual(p4.pedCompras, 0);
    assert.strictEqual(p4.saldoEstoque, 0);
    assert.strictEqual(p4.pontoPed, 1);
    assert.strictEqual(p4.necessidade, 1);
    assert.strictEqual(p4.codFornec, '120415');

    // 5. 01801080802B007
    const p5 = mapaProds.get('01801080802B007');
    assert(p5, 'Produto 01801080802B007 deve estar presente');
    assert.strictEqual(p5.pedVendas, 0);
    assert.strictEqual(p5.pedCompras, 0);
    assert.strictEqual(p5.saldoEstoque, 0);
    assert.strictEqual(p5.pontoPed, 4);
    assert.strictEqual(p5.necessidade, 4);
    assert.strictEqual(p5.codFornec, '120415');

    // 6. 01801084402B001
    const p6 = mapaProds.get('01801084402B001');
    assert(p6, 'Produto 01801084402B001 deve estar presente');
    assert.strictEqual(p6.pedVendas, 0);
    assert.strictEqual(p6.pedCompras, 0);
    assert.strictEqual(p6.saldoEstoque, 0);
    assert.strictEqual(p6.pontoPed, 1);
    assert.strictEqual(p6.necessidade, 1);
    assert.strictEqual(p6.codFornec, '120415');

    // 7. 01801990000B001
    const p7 = mapaProds.get('01801990000B001');
    assert(p7, 'Produto 01801990000B001 deve estar presente');
    assert.strictEqual(p7.pedVendas, 0);
    assert.strictEqual(p7.pedCompras, 0);
    assert.strictEqual(p7.saldoEstoque, 0);
    assert.strictEqual(p7.pontoPed, 12);
    assert.strictEqual(p7.necessidade, 12);
    assert.strictEqual(p7.codFornec, '120415');
  });

  // 3. Validação da Nova Coluna 'Nome Fornec' (15 caracteres)
  await itAsync('Coluna "Nome Fornec" deve respeitar o limite estrito de 15 caracteres', async () => {
    const res = await consultarNecessidadeComprasProtheus({ empresa: '16', modo: 'novas' });
    for (const item of res.itens) {
      assert(item.nomeFornec.length <= 15, `Nome fornec ultrapassou 15 chars: "${item.nomeFornec}" (${item.nomeFornec.length})`);
    }
  });

  // 4. Validação da Diferenciação entre 'novas' e 'todas'
  await itAsync('Modo "todas" deve trazer necessidades pendentes e novas (total maior ou igual a "novas")', async () => {
    const resNovas = await consultarNecessidadeComprasProtheus({ empresa: '16', modo: 'novas' });
    const resTodas = await consultarNecessidadeComprasProtheus({ empresa: '16', modo: 'todas' });

    assert(resTodas.total >= resNovas.total, `Total de 'todas' (${resTodas.total}) deve ser >= 'novas' (${resNovas.total})`);

    // Deve conter itens que possuem compras abertas
    const comCompras = resTodas.itens.filter(i => i.possuiComprasAbertas);
    assert(comCompras.length > 0, 'No modo "todas" devem existir itens com ordens de compra em aberto');
  });

  // 5. Consulta nas outras empresas
  await itAsync('Empresa 15 (GSI) - Consulta deve executar com integridade', async () => {
    const res = await consultarNecessidadeComprasProtheus({ empresa: '15', modo: 'novas' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.empresa, '15');
    assert(Array.isArray(res.itens));
    assert(res.total >= 0);
  });

  await itAsync('Empresa 14 (Metal Pleno) - Consulta deve executar com integridade', async () => {
    const res = await consultarNecessidadeComprasProtheus({ empresa: '14', modo: 'novas' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.empresa, '14');
    assert(Array.isArray(res.itens));
    assert(res.total >= 0);
  });

  // 6. Teste de Rota e Injeção de Dependências
  it('Controlador routes/compras_necessidade.js deve ser instanciável e montar a rota GET /', () => {
    const createRouter = require('./routes/compras_necessidade');
    assert.strictEqual(typeof createRouter, 'function');
    const mockRouter = createRouter({
      requireAuth: (req, res, next) => next(),
      handleServerError: (res, err) => res.status(500).json({ error: err.message })
    });
    assert(mockRouter);
    assert(mockRouter.stack.some(layer => layer.route && layer.route.methods.get));
  });

  console.log(`\n==================================================`);
  console.log(`Resultado dos Testes: ${passCount} Aprovados | ${failCount} Falhos`);
  console.log(`==================================================\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();
