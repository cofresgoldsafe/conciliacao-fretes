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
    assert.strictEqual(p1.necessidade, -5, 'Necessidade: (-0) + 0 + 0 - 5 = -5');
    assert.strictEqual(p1.codFornec, '120415');
    assert.strictEqual(p1.nomeFornec, 'GSI COMERCIO DE');

    // 2. 01801080802B001
    const p2 = mapaProds.get('01801080802B001');
    assert(p2, 'Produto 01801080802B001 deve estar presente');
    assert.strictEqual(p2.pedVendas, 0);
    assert.strictEqual(p2.pedCompras, 0);
    assert.strictEqual(p2.saldoEstoque, 0);
    assert.strictEqual(p2.pontoPed, 11);
    assert.strictEqual(p2.necessidade, -11, 'Necessidade: (-0) + 0 + 0 - 11 = -11');
    assert.strictEqual(p2.codFornec, '120415');

    // 3. 01801080802B003 (Saldo negativo: -1, PP: 25 -> Necessidade: -26)
    const p3 = mapaProds.get('01801080802B003');
    assert(p3, 'Produto 01801080802B003 deve estar presente');
    assert.strictEqual(p3.pedVendas, 0);
    assert.strictEqual(p3.pedCompras, 0);
    assert.strictEqual(p3.saldoEstoque, -1);
    assert.strictEqual(p3.pontoPed, 25);
    assert.strictEqual(p3.necessidade, -26, 'Necessidade: (-0) + 0 + (-1) - 25 = -26');
    assert.strictEqual(p3.codFornec, '120415');

    // 4. 01801080802B005
    const p4 = mapaProds.get('01801080802B005');
    assert(p4, 'Produto 01801080802B005 deve estar presente');
    assert.strictEqual(p4.pedVendas, 0);
    assert.strictEqual(p4.pedCompras, 0);
    assert.strictEqual(p4.saldoEstoque, 0);
    assert.strictEqual(p4.pontoPed, 1);
    assert.strictEqual(p4.necessidade, -1, 'Necessidade: (-0) + 0 + 0 - 1 = -1');
    assert.strictEqual(p4.codFornec, '120415');

    // 5. 01801080802B007
    const p5 = mapaProds.get('01801080802B007');
    assert(p5, 'Produto 01801080802B007 deve estar presente');
    assert.strictEqual(p5.pedVendas, 0);
    assert.strictEqual(p5.pedCompras, 0);
    assert.strictEqual(p5.saldoEstoque, 0);
    assert.strictEqual(p5.pontoPed, 4);
    assert.strictEqual(p5.necessidade, -4, 'Necessidade: (-0) + 0 + 0 - 4 = -4');
    assert.strictEqual(p5.codFornec, '120415');

    // 6. 01801084402B001
    const p6 = mapaProds.get('01801084402B001');
    assert(p6, 'Produto 01801084402B001 deve estar presente');
    assert.strictEqual(p6.pedVendas, 0);
    assert.strictEqual(p6.pedCompras, 0);
    assert.strictEqual(p6.saldoEstoque, 0);
    assert.strictEqual(p6.pontoPed, 1);
    assert.strictEqual(p6.necessidade, -1, 'Necessidade: (-0) + 0 + 0 - 1 = -1');
    assert.strictEqual(p6.codFornec, '120415');

    // 7. 01801990000B001
    const p7 = mapaProds.get('01801990000B001');
    assert(p7, 'Produto 01801990000B001 deve estar presente');
    assert.strictEqual(p7.pedVendas, 0);
    assert.strictEqual(p7.pedCompras, 0);
    assert.strictEqual(p7.saldoEstoque, 0);
    assert.strictEqual(p7.pontoPed, 12);
    assert.strictEqual(p7.necessidade, -12, 'Necessidade: (-0) + 0 + 0 - 12 = -12');
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

  await itAsync('Empresa 14 (Metal Pleno) - NUNCA deve trazer cofres (grupo 001), apenas produtos operados (018/017)', async () => {
    const resNovas = await consultarNecessidadeComprasProtheus({ empresa: '14', modo: 'novas' });
    assert.strictEqual(resNovas.success, true);
    assert.strictEqual(resNovas.empresa, '14');
    assert(Array.isArray(resNovas.itens));
    // Validação estrita: Nenhum cofre (001) pode aparecer na Metal Pleno
    const cofresNovas = resNovas.itens.filter(i => i.produto.startsWith('001') || i.grupo === '001');
    assert.strictEqual(cofresNovas.length, 0, 'Empresa 14 não opera cofres e não pode listar itens do grupo 001 em novas');

    const resTodas = await consultarNecessidadeComprasProtheus({ empresa: '14', modo: 'todas' });
    const cofresTodas = resTodas.itens.filter(i => i.produto.startsWith('001') || i.grupo === '001');
    assert.strictEqual(cofresTodas.length, 0, 'Empresa 14 não pode listar cofres mesmo no modo "todas"');
    
    // Todos os produtos listados devem pertencer às linhas de Armários (018) ou Racks (017)
    for (const item of resTodas.itens) {
      assert(['018', '017'].includes(item.grupo) || item.produto.startsWith('018') || item.produto.startsWith('017'), 
        `Item ${item.produto} na Empresa 14 possui linha inesperada: ${item.grupo}`);
    }
  });

  await itAsync('Empresa 14 (Metal Pleno) - Fórmula Oficial: validação dos exemplos do usuário', async () => {
    const resTodas = await consultarNecessidadeComprasProtheus({ empresa: '14', modo: 'todas' });
    const mapa = new Map(resTodas.itens.map(i => [i.produto, i]));

    // Exemplo 1 do usuário: 01801080801B001 -> (-5) + 11 + 0 - 5 = 1
    const p1 = mapa.get('01801080801B001');
    assert(p1, 'Produto 01801080801B001 deve estar presente no modo todas');
    assert.strictEqual(p1.pedVendas, 5);
    assert.strictEqual(p1.pedCompras, 11);
    assert.strictEqual(p1.saldoEstoque, 0);
    assert.strictEqual(p1.pontoPed, 5);
    assert.strictEqual(p1.necessidade, 1, 'Necessidade deve ser exatamente 1: (-5) + 11 + 0 - 5 = 1');

    // Exemplo 2 do usuário: 01801080802B007 -> (-2) + 2 + 4 - 4 = 0
    const p2 = mapa.get('01801080802B007');
    assert(p2, 'Produto 01801080802B007 deve estar presente no modo todas');
    assert.strictEqual(p2.pedVendas, 2);
    assert.strictEqual(p2.pedCompras, 2);
    assert.strictEqual(p2.saldoEstoque, 4);
    assert.strictEqual(p2.pontoPed, 4);
    assert.strictEqual(p2.necessidade, 0, 'Necessidade deve ser exatamente 0: (-2) + 2 + 4 - 4 = 0');

    // Exemplo 3 (Carência real): 01801080802B003 -> (-17) + 30 + 9 - 25 = -3 (déficit de 3)
    const p3 = mapa.get('01801080802B003');
    assert(p3, 'Produto 01801080802B003 deve estar presente');
    assert.strictEqual(p3.necessidade, -3, 'Necessidade deve ser -3: (-17) + 30 + 9 - 25 = -3');
  });

  // 6. Teste do Filtro de Linha / Grupo
  await itAsync('Empresa 16 (OAÇO) - Filtro por grupo "001" (Cofres) deve retornar exclusivamente cofres', async () => {
    const resCofres = await consultarNecessidadeComprasProtheus({ empresa: '16', modo: 'todas', grupo: '001' });
    assert.strictEqual(resCofres.success, true);
    assert(resCofres.itens.length > 0, 'OAÇO deve possuir cofres com necessidade');
    for (const item of resCofres.itens) {
      assert(item.produto.startsWith('001') || item.grupo === '001', `Item ${item.produto} não pertence ao grupo 001`);
    }
  });

  await itAsync('Empresa 16 (OAÇO) - Filtro por grupo "018" (Armários) deve retornar exclusivamente armários', async () => {
    const resArmarios = await consultarNecessidadeComprasProtheus({ empresa: '16', modo: 'novas', grupo: '018' });
    assert.strictEqual(resArmarios.success, true);
    assert(resArmarios.itens.length > 0, 'OAÇO deve possuir armários');
    for (const item of resArmarios.itens) {
      assert(item.produto.startsWith('018') || item.grupo === '018', `Item ${item.produto} não pertence ao grupo 018`);
    }
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
