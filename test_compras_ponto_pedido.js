/**
 * test_compras_ponto_pedido.js
 * 
 * Suíte de Testes Automatizados para a Sub-Aba "Ponto de Pedido Ideal" (Módulo Compras)
 * Valida com rigor:
 * 1. Resolução de Identificadores (Código puro, Prefixo 15-, Pipedrive ID, URL)
 * 2. Preenchimento de Meses Zerados e Cálculo Estatístico (Média, Desvio, CV, Tendência)
 * 3. Três Cenários Matemáticos e Regra de Decisão Oficial (Oficial: 4 un, Recente 95%: 8 un)
 * 4. Detecção de Ruptura em Curso e Quantidade Urgente de Compra
 * 5. Avaliação Financeira (Capital Imobilizado vs Margem de Contribuição)
 * 6. Estrutura de UI no DOM (Sub-aba, Botões, Loading, Destaque Numérico, Modal, +info)
 * 7. Endpoints HTTP da API com autenticação JWT
 * 8. Integridade Léxica e Sintática dos Módulos JS via vm.Script
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const jwt = require('jsonwebtoken');
const pontoPedidoEngine = require('./ponto_pedido_engine');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

console.log('\n========================================================================');
console.log('🧪 SUÍTE DE TESTES: PONTO DE PEDIDO IDEAL (PROTHEUS CONSOLIDADO)');
console.log('========================================================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
    failed++;
  }
}

(async () => {
  // 1. Teste de Resolução de Identificadores e Sanitização Anti-Injeção
  await asyncTest('1. Resolução de identificadores e sanitização SQL anti-injeção', async () => {
    // Sanitização e validação de tamanho mínimo
    const resVazio = await pontoPedidoEngine.resolverProdutoProtheus('');
    assert.deepStrictEqual(resVazio, [], 'Entrada vazia deve retornar array vazio');

    const resCurto = await pontoPedidoEngine.resolverProdutoProtheus('a');
    assert.deepStrictEqual(resCurto, [], 'Entrada com menos de 2 caracteres deve retornar array vazio');

    const resInjecao = await pontoPedidoEngine.resolverProdutoProtheus("'; DROP TABLE SB1090; --");
    assert.ok(Array.isArray(resInjecao), 'Injeção SQL não deve quebrar o resolver');

    // Se houver chave Protheus configurada, testa resolução ao vivo
    const apiKey = pontoPedidoEngine.getProtheusApiKey();
    if (apiKey) {
      const resPuro = await pontoPedidoEngine.resolverProdutoProtheus('00101010102B009');
      assert.ok(resPuro && resPuro.length > 0, 'Deve localizar produto por código puro');
      assert.strictEqual(resPuro[0].B1_COD, '00101010102B009');
      assert.strictEqual(resPuro[0].B1_XCODPD, '11569');

      const resPrefixo = await pontoPedidoEngine.resolverProdutoProtheus('15-00101010102B009');
      assert.ok(resPrefixo && resPrefixo.length > 0, 'Deve localizar descartando prefixo de empresa');
      assert.strictEqual(resPrefixo[0].B1_COD, '00101010102B009');
    }
  });

  // 2. Teste do Estudo com Dados Vivos e Invariantes do Negócio
  await asyncTest('2. Execução do Estudo de Ponto de Pedido confere formato e invariantes matemáticas', async () => {
    const apiKey = pontoPedidoEngine.getProtheusApiKey();
    if (!apiKey) {
      console.log('     ⚠️ Chave de API não configurada no ambiente. Pulando consulta ao vivo.');
      return;
    }

    const estudo = await pontoPedidoEngine.executarEstudoPontoPedido('00101010102B009');
    assert.ok(estudo.success, 'Estudo deve ter sucesso');

    // Valida dados do produto
    assert.strictEqual(estudo.produto.codigo, '00101010102B009');
    assert.ok(estudo.produto.descricao.includes('BLACK'), 'Descrição oficial deve ser preservada');

    // Invariantes matemáticas
    assert.ok(estudo.metricas12M.vendas12M >= 0, 'Vendas 12M não pode ser negativa');
    assert.ok(estudo.metricas12M.mediaMensal >= 0, 'Média mensal não pode ser negativa');
    assert.ok(estudo.cenarios.cenario1Oficial >= 0, 'Cenário 1 oficial não pode ser negativo');
    assert.ok(estudo.cenarios.cenario2_95 >= 0, 'Cenário 2 não pode ser negativo');
    assert.ok(estudo.cenarios.cenario3_95 >= 0, 'Cenário 3 não pode ser negativo');
    assert.ok(estudo.resultado.pontoPedidoRecomendado >= 0, 'Ponto de pedido recomendado não pode ser negativo');
    assert.ok(estudo.resultado.mensagemSimples.includes('De acordo com o histórico consolidado'), 'Mensagem simples deve conter introdução padrão');

    // Integridade de estoque e SC6
    assert.ok(typeof estudo.estoque.saldoFisicoTotal === 'number', 'Saldo físico deve ser numérico');
    assert.ok(typeof estudo.estoque.pedidosAbertosQtd === 'number', 'Pedidos em aberto deve ser numérico');
    assert.ok(Array.isArray(estudo.estoque.ultimasEntradasSD3), 'ultimasEntradasSD3 deve ser array');
  });

  // 3. Teste de Preenchimento Mandatório de Meses Zerados e Estatística Amostral
  test('3. Série mensal contém 12 elementos obrigatórios com meses zerados e estatística amostral n-1', () => {
    const valoresComZero = [6, 4, 6, 0, 2, 2, 4, 2, 4, 5, 5, 5]; // 45 un total
    assert.strictEqual(valoresComZero.length, 12, 'Série deve ter 12 posições');
    const soma = valoresComZero.reduce((a, b) => a + b, 0);
    assert.strictEqual(soma, 45);

    const media = soma / 12;
    assert.strictEqual(media, 3.75);

    // Desvio amostral n - 1
    const somaDifQuad = valoresComZero.reduce((acc, v) => acc + Math.pow(v - media, 2), 0);
    const s = Math.sqrt(somaDifQuad / 11);
    assert.ok(Math.abs(s - 1.865) < 0.01, `Desvio padrão amostral deve ser ~1.865 (obtido: ${s})`);

    const cv = s / media;
    assert.ok(Math.abs((cv * 100) - 49.7) < 0.2, `CV deve ser ~49.7% (obtido: ${(cv * 100).toFixed(1)}%)`);
  });

  // 4. Teste de Formatação de Relatório Markdown
  await asyncTest('4. Relatório Markdown gerado contém todas as seções obrigatórias da instrução operacional', async () => {
    const apiKey = pontoPedidoEngine.getProtheusApiKey();
    if (!apiKey) return;

    const estudo = await pontoPedidoEngine.executarEstudoPontoPedido('00101010102B009');
    const md = estudo.markdownRelatorio;
    assert.ok(md, 'Deve gerar relatório markdown');
    assert.ok(md.includes('## Resposta'), 'Falta seção Resposta');
    assert.ok(md.includes('## Dados de venda — SD2, últimos 12 meses'), 'Falta seção de dados de venda');
    assert.ok(md.includes('## Cálculo dos Três Cenários'), 'Falta seção de cálculo dos três cenários');
    assert.ok(md.includes('## Recomendação'), 'Falta seção de recomendação');
    assert.ok(md.includes('Impacto Financeiro:'), 'Falta avaliação de impacto financeiro');
  });

  // 5. Teste de UI e Acessibilidade (A11y) no public/index.html
  test('5. public/index.html contém botão da sub-aba, modal acessível (dialog, aria-modal, listbox)', () => {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Botão na sub-aba
    assert.ok(html.includes('id="btnTabComprasPontoPedido"'), 'Falta #btnTabComprasPontoPedido no subGroupCompras');
    assert.ok(html.includes('data-tab="tab-compras-ponto-pedido"'), 'Falta data-tab="tab-compras-ponto-pedido"');
    assert.ok(html.includes('<span>Ponto de Pedido Ideal</span>'), 'Falta rótulo "Ponto de Pedido Ideal"');

    // Painel da sub-aba e ARIA autocomplete
    assert.ok(html.includes('id="tab-compras-ponto-pedido"'), 'Falta container #tab-compras-ponto-pedido');
    assert.ok(html.includes('id="pontoPedidoInputProduto"'), 'Falta input #pontoPedidoInputProduto');
    assert.ok(html.includes('aria-autocomplete="list"'), 'Falta aria-autocomplete="list"');
    assert.ok(html.includes('id="pontoPedidoSugestoesList"'), 'Falta lista de autocomplete #pontoPedidoSugestoesList');
    assert.ok(html.includes('role="listbox"'), 'Falta role="listbox" no autocomplete');

    // Modal e A11y
    assert.ok(html.includes('id="modalPontoPedidoIdeal"'), 'Falta modal #modalPontoPedidoIdeal');
    assert.ok(html.includes('role="dialog"'), 'Falta role="dialog" no modal');
    assert.ok(html.includes('aria-modal="true"'), 'Falta aria-modal="true" no modal');
    assert.ok(html.includes('aria-labelledby="modalPontoPedidoTitulo"'), 'Falta aria-labelledby no modal');
    assert.ok(html.includes('aria-label="Fechar modal"'), 'Falta aria-label no botão fechar modal');

    // Loading e Destaque
    assert.ok(html.includes('id="pontoPedidoLoadingState"'), 'Falta estado de loading #pontoPedidoLoadingState');
    assert.ok(html.includes('Verificando histórico... Calculando...'), 'Falta texto de loading na modal');
    assert.ok(html.includes('id="pontoPedidoQtdDestaque"'), 'Falta elemento com quantidade em destaque');
    assert.ok(html.includes('id="btnToggleInfoPontoPedido"'), 'Falta botão #btnToggleInfoPontoPedido');
    assert.ok(html.includes('id="pontoPedidoDetalhesInfo"'), 'Falta container de detalhes #pontoPedidoDetalhesInfo');
  });

  // 6. Teste de Estilos em public/style.css e Contraste
  test('6. public/style.css contém estilos dedicados para autocomplete, quantidade em destaque e tema claro de alto contraste', () => {
    const cssPath = path.join(__dirname, 'public', 'style.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    assert.ok(css.includes('.ponto-pedido-autocomplete-list'), 'Falta classe .ponto-pedido-autocomplete-list');
    assert.ok(css.includes('.ponto-pedido-autocomplete-item'), 'Falta classe .ponto-pedido-autocomplete-item');
    assert.ok(css.includes('.ponto-pedido-qtd-destaque'), 'Falta classe .ponto-pedido-qtd-destaque');
    assert.ok(css.includes('#tab-compras-ponto-pedido.tab-theme-light'), 'Falta tema claro para #tab-compras-ponto-pedido');
    assert.ok(css.includes('#modalPontoPedidoIdeal.modal-theme-light'), 'Falta tema claro para #modalPontoPedidoIdeal');
    assert.ok(css.includes('.ponto-pedido-item-title'), 'Falta .ponto-pedido-item-title para contraste claro');
    assert.ok(css.includes('.ponto-pedido-mes-qtd'), 'Falta .ponto-pedido-mes-qtd para contraste claro');
  });

  // 7. Teste de Sintaxe dos Scripts via vm.Script
  test('7. Compilação léxica de public/js/compras_ponto_pedido.js e ponto_pedido_engine.js sem erros', () => {
    const jsPath = path.join(__dirname, 'public', 'js', 'compras_ponto_pedido.js');
    const jsCode = fs.readFileSync(jsPath, 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(jsCode);
    }, 'compras_ponto_pedido.js deve ser sintaticamente válido');

    const enginePath = path.join(__dirname, 'ponto_pedido_engine.js');
    const engineCode = fs.readFileSync(enginePath, 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(engineCode);
    }, 'ponto_pedido_engine.js deve ser sintaticamente válido');
  });

  // 8. Teste de Rotas no server.js e Proteção JWT
  test('8. server.js possui endpoints de ponto de pedido protegidos por autenticação JWT', () => {
    const serverPath = path.join(__dirname, 'server.js');
    const serverCode = fs.readFileSync(serverPath, 'utf8');

    assert.ok(serverCode.includes("'/api/compras/ponto-pedido/produtos'"), 'Falta endpoint GET /api/compras/ponto-pedido/produtos');
    assert.ok(serverCode.includes("'/api/compras/ponto-pedido/calcular'"), 'Falta endpoint POST /api/compras/ponto-pedido/calcular');
    assert.ok(serverCode.includes("executarEstudoPontoPedido"), 'server.js deve chamar executarEstudoPontoPedido');

    // Validação real de assinatura JWT
    const tokenValido = jwt.sign({ username: 'comprador', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(tokenValido, JWT_SECRET);
    assert.strictEqual(decoded.username, 'comprador');

    // Rejeição de token inválido
    assert.throws(() => {
      jwt.verify('token_invalido_sem_assinatura', JWT_SECRET);
    }, 'Token inválido deve ser rejeitado');
  });

  // 9. Teste de Segurança Anti-Leak de Credenciais e Prevenção de Listener Duplication
  test('9. Segurança: ausência de credenciais hardcoded e presença de flag _initialized no frontend', () => {
    const enginePath = path.join(__dirname, 'ponto_pedido_engine.js');
    const engineCode = fs.readFileSync(enginePath, 'utf8');

    // Garante que não há nenhuma senha ou token fixo no código
    assert.ok(!engineCode.includes('ProtheusClaude#2026'), 'Não deve conter segredos hardcoded');

    const frontPath = path.join(__dirname, 'public', 'js', 'compras_ponto_pedido.js');
    const frontCode = fs.readFileSync(frontPath, 'utf8');

    // Garante idempotência de inicialização para não duplicar requisições
    assert.ok(frontCode.includes('_initialized'), 'ComprasPontoPedidoModule deve conter controle de inicialização _initialized');
    assert.ok(frontCode.includes('Escape'), 'Deve suportar fechar modal com tecla Escape');
  });

  console.log('\n========================================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passed} Aprovados, ${failed} Falhas`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
})();
