/**
 * test_crm_mesmo_cnpj.js
 * 
 * Bateria de testes de validação do Alerta de "Mesmo CNPJ" (CRM-24 / Opção A):
 * 1. CNPJ vazio / curto / inválido
 * 2. CNPJ sem negócios em aberto
 * 3. Oportunidade aberta com OUTRO vendedor (alerta amigável ⚠️ com sigilo de valores/título)
 * 4. Oportunidade aberta com o PRÓPRIO vendedor (aviso informativo ℹ️ com link/ID)
 * 5. Edição do próprio deal (dealIdAtual é ignorado e não auto-alerta)
 * 6. Deals fechados (ganho ou perdido) são rigorosamente ignorados
 * 7. Identificação de mesma raiz de CNPJ (outra filial da mesma rede)
 * 8. Conformidade do HTML em public/crm.html e public/index.html
 * 9. Conformidade dos estilos em public/style.css (dark e light)
 * 10. Integração e exportação em public/js/crm.js e crm_routes.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crmEngine = require('./crm_engine');

let passCount = 0;
let failCount = 0;

function test(descricao, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${descricao}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${descricao}`);
    console.error(`     Erro: ${err.message}`);
    failCount++;
  }
}

async function runTests() {
  console.log('🧪 Iniciando testes de validação do Alerta de Mesmo CNPJ (CRM-24 / Opção A)...\n');

  // =========================================================================
  // BLOCO 1: TESTES UNITÁRIOS DO MOTOR (crm_engine.checarDealsAbertosPorCnpj)
  // =========================================================================
  console.log('--- 1. Validação do Motor Backend (crm_engine) ---');

  // Teste 1.1: Documentos vazios ou curtos
  const resVazio = await crmEngine.checarDealsAbertosPorCnpj('', {}, { all: true });
  test('CNPJ vazio retorna has_deals: false', () => {
    assert.strictEqual(resVazio.has_deals, false);
    assert.strictEqual(resVazio.total, 0);
    assert.strictEqual(resVazio.deals.length, 0);
    assert.strictEqual(resVazio.alerta_texto, '');
  });

  const resCurto = await crmEngine.checarDealsAbertosPorCnpj('12345', {}, { all: true });
  test('CNPJ com menos de 8 dígitos retorna has_deals: false', () => {
    assert.strictEqual(resCurto.has_deals, false);
    assert.strictEqual(resCurto.total, 0);
  });

  // Teste 1.2: CNPJ inexistente
  const resInexistente = await crmEngine.checarDealsAbertosPorCnpj('99.999.999/0001-99', {}, { all: true });
  test('CNPJ sem negócios abertos retorna has_deals: false', () => {
    assert.strictEqual(resInexistente.has_deals, false);
    assert.strictEqual(resInexistente.tem_outro_vendedor, false);
    assert.strictEqual(resInexistente.tem_proprio_vendedor, false);
    assert.strictEqual(resInexistente.deals.length, 0);
  });

  // Criamos deals mockados no cache local para testar cenários determinísticos
  const cnpjTeste1 = '11222333000181'; // CNPJ 1 (Juliana)
  const cnpjTeste2 = '44555666000192'; // CNPJ 2 (Andrea)
  const cnpjFilial = '11222333000262'; // Filial do CNPJ 1 (mesma raiz 11222333)

  // Salva estado original do cache para restaurar ao final
  const cachePath = path.join(__dirname, 'data', 'crm_deals_cache.json');
  let originalCache = null;
  try {
    if (fs.existsSync(cachePath)) {
      originalCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch {}

  const mockCache = {
    deals: [
      {
        id: '99001',
        titulo: 'Cofre Boca de Lobo - Empresa Alfa',
        cliente_nome: 'Empresa Alfa Ltda',
        cliente_cnpj: '11.222.333/0001-81',
        valor_total: 15400.00,
        estagio: 'proposta',
        status: 'aberto',
        cod_vendedor: '000074', // Juliana
        nome_vendedor: 'Juliana Silva',
        contatos: [{ nome: 'Carlos Gerente', telefone: '11988887777' }],
        ativo: true,
        created_at: '2026-11-03T10:00:00Z'
      },
      {
        id: '99002',
        titulo: 'Porta Blindada - Empresa Beta',
        cliente_nome: 'Empresa Beta SA',
        cliente_cnpj: '44.555.666/0001-92',
        valor_total: 28900.00,
        estagio: 'negociacao',
        status: 'aberto',
        cod_vendedor: '000064', // Andrea
        nome_vendedor: 'Andrea Vendedora',
        contatos: [{ nome: 'Fernanda Compras' }],
        ativo: true,
        created_at: '2026-11-10T14:30:00Z'
      },
      {
        id: '99003',
        titulo: 'Cofre Legado Ganho - Empresa Gama',
        cliente_nome: 'Empresa Gama',
        cliente_cnpj: '77.888.999/0001-00',
        valor_total: 5000.00,
        estagio: 'ganho',
        status: 'fechado',
        cod_vendedor: '000074',
        nome_vendedor: 'Juliana Silva',
        ativo: true,
        created_at: '2026-10-01T10:00:00Z'
      },
      {
        id: '99004',
        titulo: 'Cofre Perdido - Empresa Delta',
        cliente_nome: 'Empresa Delta',
        cliente_cnpj: '55.666.777/0001-11',
        valor_total: 8000.00,
        estagio: 'perdido',
        status: 'fechado',
        cod_vendedor: '000064',
        nome_vendedor: 'Andrea Vendedora',
        ativo: true,
        created_at: '2026-10-05T10:00:00Z'
      }
    ]
  };

  try {
    fs.writeFileSync(cachePath, JSON.stringify(mockCache, null, 2), 'utf8');

    // Teste 1.3: Vendedor Andrea consultando CNPJ com deal da Juliana (Outro Vendedor)
    const scopeAndrea = { all: false, codVendedor: '000064' };
    const resOutro = await crmEngine.checarDealsAbertosPorCnpj(cnpjTeste1, {}, scopeAndrea);

    test('Identifica oportunidade aberta de outro vendedor', () => {
      assert.strictEqual(resOutro.has_deals, true);
      assert.strictEqual(resOutro.tem_outro_vendedor, true);
      assert.strictEqual(resOutro.tem_proprio_vendedor, false);
      assert.strictEqual(resOutro.deals.length, 1);
    });

    test('Sigilo Comercial: Mascara ID, título, valor e estágio de outro vendedor', () => {
      const d = resOutro.deals[0];
      assert.strictEqual(d.id, null);
      assert.strictEqual(d.titulo, undefined);
      assert.strictEqual(d.valor_total, undefined);
      assert.strictEqual(d.estagio, undefined);
      assert.strictEqual(d.proprio_vendedor, false);
      assert.strictEqual(d.nome_vendedor, 'Juliana Silva');
      assert.strictEqual(d.contato_nome, 'Carlos Gerente');
    });

    test('Formata mensagem amigável de alerta para outro vendedor', () => {
      assert.ok(resOutro.alerta_texto.includes('⚠️'));
      assert.ok(resOutro.alerta_texto.includes('Juliana Silva'));
      assert.ok(resOutro.alerta_texto.includes('Carlos Gerente'));
      assert.ok(!resOutro.alerta_texto.includes('15400'));
      assert.ok(!resOutro.alerta_texto.includes('Boca de Lobo'));
    });

    // Teste 1.4: Vendedor Andrea consultando o próprio CNPJ (Próprio Vendedor)
    const resProprio = await crmEngine.checarDealsAbertosPorCnpj(cnpjTeste2, {}, scopeAndrea);

    test('Identifica oportunidade aberta do próprio vendedor', () => {
      assert.strictEqual(resProprio.has_deals, true);
      assert.strictEqual(resProprio.tem_outro_vendedor, false);
      assert.strictEqual(resProprio.tem_proprio_vendedor, true);
      assert.strictEqual(resProprio.deals.length, 1);
    });

    test('Exibe ID, título e estágio para o próprio vendedor', () => {
      const d = resProprio.deals[0];
      assert.strictEqual(d.id, '99002');
      assert.strictEqual(d.titulo, 'Porta Blindada - Empresa Beta');
      assert.strictEqual(d.estagio, 'negociacao');
      assert.strictEqual(d.proprio_vendedor, true);
      assert.ok(resProprio.alerta_texto.includes('ℹ️'));
      assert.ok(resProprio.alerta_texto.includes('#99002'));
    });

    // Teste 1.5: Edição do próprio negócio (dealIdAtual é ignorado)
    const resEditandoProprio = await crmEngine.checarDealsAbertosPorCnpj(cnpjTeste2, { dealIdAtual: '99002' }, scopeAndrea);
    test('Ignora o próprio deal ao editar (dealIdAtual não gera auto-alerta)', () => {
      assert.strictEqual(resEditandoProprio.has_deals, false);
      assert.strictEqual(resEditandoProprio.deals.length, 0);
      assert.strictEqual(resEditandoProprio.alerta_texto, '');
    });

    // Teste 1.6: Negócios fechados (ganho ou perdido) não geram alerta
    const resGanho = await crmEngine.checarDealsAbertosPorCnpj('77.888.999/0001-00', {}, scopeAndrea);
    test('Negócio Ganho é ignorado e não gera alerta', () => {
      assert.strictEqual(resGanho.has_deals, false);
      assert.strictEqual(resGanho.deals.length, 0);
    });

    const resPerdido = await crmEngine.checarDealsAbertosPorCnpj('55.666.777/0001-11', {}, scopeAndrea);
    test('Negócio Perdido é ignorado e não gera alerta', () => {
      assert.strictEqual(resPerdido.has_deals, false);
      assert.strictEqual(resPerdido.deals.length, 0);
    });

    // Teste 1.7: Mesma raiz de CNPJ (outra filial)
    const resRaiz = await crmEngine.checarDealsAbertosPorCnpj(cnpjFilial, {}, scopeAndrea);
    test('Detecta oportunidade aberta na mesma raiz (outra filial)', () => {
      assert.strictEqual(resRaiz.has_deals, true);
      assert.strictEqual(resRaiz.tem_outro_vendedor, true);
      assert.strictEqual(resRaiz.deals[0].tipo_match, 'mesma_raiz');
      assert.ok(resRaiz.alerta_texto.includes('outra filial desta rede'));
    });

    // Teste 1.8: Perfil Admin / Diretoria vê todos os dados
    const scopeAdmin = { all: true };
    const resAdmin = await crmEngine.checarDealsAbertosPorCnpj(cnpjTeste1, {}, scopeAdmin);
    test('Admin tem acesso completo a ID, título e valor de qualquer vendedor', () => {
      assert.strictEqual(resAdmin.has_deals, true);
      assert.strictEqual(resAdmin.deals[0].id, '99001');
      assert.strictEqual(resAdmin.deals[0].titulo, 'Cofre Boca de Lobo - Empresa Alfa');
      assert.strictEqual(resAdmin.deals[0].valor_total, 15400.00);
      assert.strictEqual(resAdmin.deals[0].proprio_vendedor, true);
    });

  } finally {
    // Restaura o cache original
    if (originalCache) {
      fs.writeFileSync(cachePath, JSON.stringify(originalCache, null, 2), 'utf8');
    }
  }

  // =========================================================================
  // BLOCO 2: CONFORMIDADE DE ESTRUTURA VISUAL E ARQUIVOS (HTML / CSS / JS)
  // =========================================================================
  console.log('\n--- 2. Conformidade de Interface & Roteamento ---');

  const crmHtml = fs.readFileSync(path.join(__dirname, 'public', 'crm.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
  const crmJs = fs.readFileSync(path.join(__dirname, 'public', 'js', 'crm.js'), 'utf8');
  const crmRoutes = fs.readFileSync(path.join(__dirname, 'crm_routes.js'), 'utf8');

  test('public/crm.html contém o elemento #crmDealMesmoCnpjAlert', () => {
    assert.ok(crmHtml.includes('id="crmDealMesmoCnpjAlert"'));
    assert.ok(crmHtml.includes('class="crm-alert-mesmo-cnpj"'));
  });

  test('public/index.html contém o elemento #crmDealMesmoCnpjAlert', () => {
    assert.ok(indexHtml.includes('id="crmDealMesmoCnpjAlert"'));
    assert.ok(indexHtml.includes('class="crm-alert-mesmo-cnpj"'));
  });

  test('public/style.css contém regras para .crm-alert-mesmo-cnpj', () => {
    assert.ok(styleCss.includes('.crm-alert-mesmo-cnpj'));
    assert.ok(styleCss.includes('.crm-alert-mesmo-cnpj.alert-warning'));
    assert.ok(styleCss.includes('.crm-alert-mesmo-cnpj.alert-info'));
  });

  test('public/style.css contém suporte específico para Modo Claro (.theme-light)', () => {
    assert.ok(styleCss.includes('.theme-light .crm-alert-mesmo-cnpj.alert-warning'));
    assert.ok(styleCss.includes('.theme-light .crm-alert-mesmo-cnpj.alert-info'));
  });

  test('public/js/crm.js implementa a função checarMesmoCnpjCliente()', () => {
    assert.ok(crmJs.includes('async function checarMesmoCnpjCliente('));
    assert.ok(crmJs.includes('AbortController'));
    assert.ok(crmJs.includes('/api/bi/crm/deals/checar-cnpj/'));
  });

  test('public/js/crm.js aciona a checagem no autocomplete de clientes', () => {
    assert.ok(crmJs.includes('checarMesmoCnpjCliente(cnpjVal);'));
  });

  test('public/js/crm.js limpa a checagem ao esvaziar o cliente', () => {
    assert.ok(crmJs.includes("checarMesmoCnpjCliente('');"));
  });

  test('public/js/crm.js checa ao abrir oportunidade para edição com deal.id', () => {
    assert.ok(crmJs.includes('checarMesmoCnpjCliente(deal.clienteCnpj, deal.id);'));
  });

  test('public/js/crm.js exporta checarMesmoCnpjCliente no window.CRMModule', () => {
    assert.ok(crmJs.includes('checarMesmoCnpjCliente,'));
  });

  test('crm_routes.js define rota GET /deals/checar-cnpj/:cnpj', () => {
    assert.ok(crmRoutes.includes("router.get('/deals/checar-cnpj/:cnpj'"));
    assert.ok(crmRoutes.includes('crmEngine.checarDealsAbertosPorCnpj'));
  });

  // =========================================================================
  // RELATÓRIO FINAL
  // =========================================================================
  console.log('\n========================================');
  console.log(`📊 Resultado dos Testes: ${passCount} aprovados / ${failCount} falhas`);
  console.log('========================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal durante a execução dos testes:', err);
  process.exit(1);
});
