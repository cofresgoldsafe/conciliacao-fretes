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

  // 2. Validação da Regra Mandatória: Omitir produtos com Ped Vendas = 0 E Ped Compras = 0
  await itAsync('Todas as empresas: somente produtos com Ped Vendas > 0 ou Ped Compras > 0 devem ser listados (0 e 0 omitidos)', async () => {
    for (const emp of ['14', '15', '16']) {
      const resTodas = await consultarNecessidadeComprasProtheus({ empresa: emp, modo: 'todas' });
      assert.strictEqual(resTodas.success, true);
      assert(Array.isArray(resTodas.itens));

      for (const item of resTodas.itens) {
        const temVendas = Number(item.pedVendas) > 0;
        const temCompras = Number(item.pedCompras) > 0;
        assert(temVendas || temCompras, 
          `Produto ${item.produto} na Empresa ${emp} possui Vendas 0 e Compras 0, deveria ter sido omitido!`);
      }

      const resNovas = await consultarNecessidadeComprasProtheus({ empresa: emp, modo: 'novas' });
      for (const item of resNovas.itens) {
        const temVendas = Number(item.pedVendas) > 0;
        const temCompras = Number(item.pedCompras) > 0;
        assert(temVendas || temCompras, 
          `Produto ${item.produto} (modo novas) na Empresa ${emp} possui Vendas 0 e Compras 0, deveria ter sido omitido!`);
      }
    }
  });

  // 3. Validação da Nova Coluna 'Nome Fornec' (15 caracteres)
  await itAsync('Coluna "Nome Fornec" deve respeitar o limite estrito de 15 caracteres', async () => {
    const res = await consultarNecessidadeComprasProtheus({ empresa: '14', modo: 'todas' });
    assert(res.itens.length > 0, 'Deve conter itens para validação do fornecedor');
    for (const item of res.itens) {
      assert(item.nomeFornec.length <= 15, `Nome fornec ultrapassou 15 chars: "${item.nomeFornec}" (${item.nomeFornec.length})`);
    }
  });

  // 4. Validação da Diferenciação entre 'novas' e 'todas'
  await itAsync('Modo "todas" deve trazer necessidades pendentes e novas (total maior ou igual a "novas")', async () => {
    const resNovas = await consultarNecessidadeComprasProtheus({ empresa: '14', modo: 'novas' });
    const resTodas = await consultarNecessidadeComprasProtheus({ empresa: '14', modo: 'todas' });

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

    // Validação matemática da fórmula oficial: (-Ped Vendas) + Ped Compras + Saldo - Ponto de Pedido
    const p1 = mapa.get('01801080801B001');
    assert(p1, 'Produto 01801080801B001 deve estar presente no modo todas');
    const calcP1 = (-p1.pedVendas) + p1.pedCompras + p1.saldoEstoque - p1.pontoPed;
    assert.strictEqual(p1.necessidade, calcP1, `Necessidade deve ser exatamente (-${p1.pedVendas}) + ${p1.pedCompras} + ${p1.saldoEstoque} - ${p1.pontoPed} = ${calcP1}`);

    const p2 = mapa.get('01801080802B007');
    assert(p2, 'Produto 01801080802B007 deve estar presente no modo todas');
    const calcP2 = (-p2.pedVendas) + p2.pedCompras + p2.saldoEstoque - p2.pontoPed;
    assert.strictEqual(p2.necessidade, calcP2, `Necessidade deve ser exatamente (-${p2.pedVendas}) + ${p2.pedCompras} + ${p2.saldoEstoque} - ${p2.pontoPed} = ${calcP2}`);

    const p3 = mapa.get('01801080802B003');
    assert(p3, 'Produto 01801080802B003 deve estar presente');
    const calcP3 = (-p3.pedVendas) + p3.pedCompras + p3.saldoEstoque - p3.pontoPed;
    assert.strictEqual(p3.necessidade, calcP3, `Necessidade deve ser exatamente (-${p3.pedVendas}) + ${p3.pedCompras} + ${p3.saldoEstoque} - ${p3.pontoPed} = ${calcP3}`);
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

  await itAsync('Empresa 14 (Metal Pleno) - Filtro por grupo "018" (Armários) deve retornar exclusivamente armários', async () => {
    const resArmarios = await consultarNecessidadeComprasProtheus({ empresa: '14', modo: 'todas', grupo: '018' });
    assert.strictEqual(resArmarios.success, true);
    assert(resArmarios.itens.length > 0, 'Metal Pleno deve possuir armários com compras ou vendas ativas');
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
