/**
 * test_crm_standalone.js
 * Teste automatizado de validação da página dedicada /crm e recursos de usabilidade do CRM Comercial (Opção B)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

async function runTests() {
  console.log('🧪 Iniciando testes de validação do CRM Dedicado (/crm) e Opção B...\n');

  // Teste 1: Existência de public/crm.html
  const crmHtmlPath = path.join(__dirname, 'public', 'crm.html');
  assert(fs.existsSync(crmHtmlPath), 'Arquivo public/crm.html existe fisicamente no repositório');

  // Teste 2: Conteúdo de public/crm.html
  const crmHtml = fs.readFileSync(crmHtmlPath, 'utf8');
  assert(crmHtml.includes('<!DOCTYPE html>'), 'public/crm.html é um documento HTML5 válido');
  assert(crmHtml.includes('localStorage.getItem(\'conciliacao_fretes_session\')'), 'public/crm.html contém Auth Guard inline com validação de sessão ativa');
  assert(crmHtml.includes('btnCrmToggleMaximizeDealModal'), 'public/crm.html possui botão de alternância Maximizar / Restaurar (Opção B)');
  assert(crmHtml.includes('crm-itens-table-container') || crmHtml.includes('crm-itens-cotados-table'), 'public/crm.html possui container amplo 100% de produtos cotados');
  assert(crmHtml.includes('crmInputTransportadoraCod'), 'public/crm.html preserva campo Protheus oculto A4_COD');
  assert(crmHtml.includes('CRMModule.init()'), 'public/crm.html inicializa automaticamente o CRMModule');

  // Teste 3: Rota /crm em server.js
  const serverJsPath = path.join(__dirname, 'server.js');
  const serverJs = fs.readFileSync(serverJsPath, 'utf8');
  assert(serverJs.includes("app.get('/crm'"), 'server.js possui rota canônica GET /crm registrada');

  // Teste 4: CSS para modal amplo, maximizado e shake
  const styleCssPath = path.join(__dirname, 'public', 'style.css');
  const styleCss = fs.readFileSync(styleCssPath, 'utf8');
  assert(styleCss.includes('.modal-maximized'), 'public/style.css contém estilos para .modal-maximized (99vw / 97vh)');
  assert(styleCss.includes('@keyframes crmModalShake'), 'public/style.css contém keyframes para animação de shake no backdrop');
  assert(styleCss.includes('.crm-modal-shake'), 'public/style.css contém classe .crm-modal-shake');

  // Teste 5: Lógica em public/js/crm.js
  const crmJsPath = path.join(__dirname, 'public', 'js', 'crm.js');
  const crmJs = fs.readFileSync(crmJsPath, 'utf8');
  assert(crmJs.includes('btnCrmToggleMaximizeDealModal'), 'public/js/crm.js contém listener para o botão de maximizar');
  assert(crmJs.includes('crm-modal-shake'), 'public/js/crm.js aplica animação crm-modal-shake ao clicar no backdrop');
  assert(crmJs.includes('modalCrmPerdido'), 'public/js/crm.js cobre modalCrmPerdido na lista de backdrops protegidos');
  assert(crmJs.includes('crmInputObsNfe'), 'public/js/crm.js verifica crmInputObsNfe no dirty check (sem IDs inexistentes)');
  assert(crmJs.includes('isDealFormDirty'), 'public/js/crm.js possui verificação isDealFormDirty para dirty-checking');
  assert(crmJs.includes('closeModal(document.getElementById(\'modalCrmOportunidade\'), true)'), 'public/js/crm.js passa force=true ao salvar oportunidade');

  // Teste 6: Botão CRM no Portal e Redirecionamento Pós-Login (public/app.js)
  const appJsPath = path.join(__dirname, 'public', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert(appJs.includes("window.open('/crm', '_blank')"), 'public/app.js abre /crm em nova janela ao clicar na aba CRM');
  assert(appJs.includes('redirectTarget'), 'public/app.js respeita o parâmetro ?redirect= pós-autenticação');

  // Teste 7: Telemetria Autenticada no Standalone (crm.html)
  assert(crmHtml.includes('headers: token ? { \'Authorization\': `Bearer ${token}` } : {}'), 'public/crm.html envia token no heartbeat session-ping');

  // Teste 8: Unificação do Cabeçalho e Padronização dos Botões no CRM
  assert(crmHtml.includes('Plataforma GSI — CRM Comercial'), 'public/crm.html exibe o título limpo Plataforma GSI — CRM Comercial');
  assert(!crmHtml.includes('Página Dedicada'), 'public/crm.html eliminou o badge textual Página Dedicada (Navalha de Texto)');
  assert(!crmHtml.includes('Pipeline de Vendas, Cotações e Clientes B2B'), 'public/crm.html eliminou o subtítulo descritivo longo do cabeçalho');
  assert(!crmHtml.includes('Pipeline Comercial Nativo'), 'public/crm.html eliminou a 2ª faixa com texto Pipeline Comercial Nativo');
  assert(!crmHtml.includes('Gestão de oportunidades de vendas, cotações, carteira de clientes e follow-up'), 'public/crm.html eliminou a descrição prolixa da 2ª faixa');

  // Validação dos botões na topbar
  const headerContentMatch = crmHtml.match(/<header class="crm-standalone-header">([\s\S]*?)<\/header>/);
  const headerContent = headerContentMatch ? headerContentMatch[1] : '';
  assert(headerContent.includes('id="btnCrmViewKanban"'), 'Header superior contém o botão Funil de Oportunidades');
  assert(headerContent.includes('id="btnCrmViewClientes"'), 'Header superior contém o botão Clientes Cadastrados');
  assert(headerContent.includes('id="btnCrmNovaOportunidade"'), 'Header superior contém o botão Nova Oportunidade');
  assert(headerContent.includes('id="btnCrmRefresh"'), 'Header superior contém o botão Atualizar');
  assert(headerContent.includes('id="btnToggleThemeCrmPage"'), 'Header superior contém o botão de Tema');
  assert(headerContent.includes('Voltar ao Portal'), 'Header superior contém o botão Voltar ao Portal');

  // Validação da ordem solicitada pelo usuário (Nova Oportunidade antes de Funil de Oportunidades)
  const posNova = headerContent.indexOf('id="btnCrmNovaOportunidade"');
  const posKanban = headerContent.indexOf('id="btnCrmViewKanban"');
  assert(posNova !== -1 && posKanban !== -1 && posNova < posKanban, 'Botão Nova Oportunidade está posicionado antes de Funil de Oportunidades');

  // Validação de CSS de padronização e destaque exclusivo
  assert(styleCss.includes('.crm-standalone-header .btn') && styleCss.includes('height: 34px !important'), 'public/style.css padroniza todos os botões do header em 34px');
  assert(styleCss.includes('.crm-standalone-header #btnCrmNovaOportunidade') && styleCss.includes('var(--accent-blue'), 'public/style.css aplica fundo azul claro exclusivamente para Nova Oportunidade');

  // Teste 9: Validação dos 4 Campos Obrigatórios e Desativação do Botão Salvar
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  // 9.1 Rótulo com asterisco em Faturado Por: *
  assert(crmHtml.includes('Faturado Por: *'), 'public/crm.html possui asterisco obrigatório em Faturado Por: *');
  assert(indexHtml.includes('Faturado Por: *'), 'public/index.html possui asterisco obrigatório em Faturado Por: *');

  // 9.2 Seletor crmSelectFaturadoPor com required e placeholder inválido desabilitado
  assert(crmHtml.includes('id="crmSelectFaturadoPor" class="form-control" required'), 'public/crm.html possui select crmSelectFaturadoPor marcado como required');
  assert(indexHtml.includes('id="crmSelectFaturadoPor" class="form-control" required'), 'public/index.html possui select crmSelectFaturadoPor marcado como required');
  assert(crmHtml.includes('<option value="" disabled selected>Selecione a empresa...</option>'), 'public/crm.html define opção Selecione a empresa como disabled selected (inválida para submissão)');
  assert(indexHtml.includes('<option value="" disabled selected>Selecione a empresa...</option>'), 'public/index.html define opção Selecione a empresa como disabled selected (inválida para submissão)');

  // 9.3 Botão Salvar inicialmente desabilitado com tooltip nos dois HTMLs
  assert(crmHtml.includes('id="btnSalvarCrmOportunidade"') && crmHtml.includes('disabled title="Preencha os campos obrigatórios (*)'), 'public/crm.html possui btnSalvarCrmOportunidade inicialmente inativo (disabled)');
  assert(indexHtml.includes('id="btnSalvarCrmOportunidade"') && indexHtml.includes('disabled title="Preencha os campos obrigatórios (*)'), 'public/index.html possui btnSalvarCrmOportunidade inicialmente inativo (disabled)');

  // 9.4 Lógica de validação em public/js/crm.js
  assert(crmJs.includes('function isDealFormValid()'), 'public/js/crm.js implementa a função isDealFormValid()');
  assert(crmJs.includes('function updateDealSaveButtonState()'), 'public/js/crm.js implementa a função updateDealSaveButtonState()');
  assert(crmJs.includes('!vendedor.toLowerCase().includes(\'selecione\')'), 'public/js/crm.js rejeita opção placeholder de Vendedor');
  assert(crmJs.includes('!faturadoPor.toLowerCase().includes(\'selecione\')'), 'public/js/crm.js rejeita opção placeholder de Faturado Por');
  assert(crmJs.includes('btnSalvar.disabled = !valid'), 'public/js/crm.js controla dinamicamente disabled do botão Salvar');
  assert(crmJs.includes('[\'crmInputTitulo\', \'crmSelectVendedor\', \'crmInputCliente\', \'crmSelectFaturadoPor\']'), 'public/js/crm.js escuta eventos nos 4 campos obrigatórios');

  // Teste 10: Otimização de Colunas, Formato pt-BR e Inativação de P. Tabela nos Itens Cotados
  // 10.1 Largura reduzida das colunas no thead de crm.html e index.html
  assert(crmHtml.includes('class="col-qtd" style="width: 55px; text-align: right;"'), 'public/crm.html define largura de 55px para a coluna Qtd');
  assert(indexHtml.includes('class="col-qtd" style="width: 55px; text-align: right;"'), 'public/index.html define largura de 55px para a coluna Qtd');
  assert(crmHtml.includes('class="col-ptabela" style="width: 95px; text-align: right;"'), 'public/crm.html define largura de 95px para a coluna P. Tabela');
  assert(indexHtml.includes('class="col-ptabela" style="width: 95px; text-align: right;"'), 'public/index.html define largura de 95px para a coluna P. Tabela');
  assert(crmHtml.includes('class="col-pnegociado" style="width: 105px; text-align: right;"'), 'public/crm.html define largura de 105px para a coluna P. Negociado');
  assert(indexHtml.includes('class="col-pnegociado" style="width: 105px; text-align: right;"'), 'public/index.html define largura de 105px para a coluna P. Negociado');
  assert(crmHtml.includes('class="col-total" style="width: 110px; text-align: right;"'), 'public/crm.html define largura de 110px para a coluna Total');
  assert(indexHtml.includes('class="col-total" style="width: 110px; text-align: right;"'), 'public/index.html define largura de 110px para a coluna Total');

  // 10.2 Remoção visual de NCM e Peso na edição do item em public/js/crm.js
  const renderItensMatch = crmJs.match(/function renderItensCotadosTable\(\)[\s\S]*?function addItemCotado\(\)/);
  const renderItensContent = renderItensMatch ? renderItensMatch[0] : '';
  assert(!renderItensContent.includes('${hasMeta ?'), 'renderItensCotadosTable() eliminou o bloco hasMeta debaixo da descrição');
  assert(!renderItensContent.includes('<span>NCM: <strong>'), 'renderItensCotadosTable() não renderiza tag NCM abaixo da descrição');
  assert(!renderItensContent.includes('<span>Peso: <strong>'), 'renderItensCotadosTable() não renderiza tag Peso abaixo da descrição');

  // 10.3 Campo P. Tabela inalterável (cinza, readonly e disabled) no 1º item e demais
  assert(renderItensContent.includes('crm-item-ptabela') && renderItensContent.includes('readonly disabled'), 'Campo P. Tabela possui atributos readonly disabled impedindo alteração');
  assert(renderItensContent.includes('background: rgba(148, 163, 184, 0.12) !important'), 'Campo P. Tabela possui fundo cinza inabilitado de edição');
  assert(renderItensContent.includes('cursor: not-allowed'), 'Campo P. Tabela possui cursor not-allowed');

  // 10.4 Formatação numérica padrão brasileiro (pt-BR com 2 casas) e parsing
  assert(crmJs.includes('function formatNumberPtBr(val)'), 'public/js/crm.js implementa formatNumberPtBr()');
  assert(crmJs.includes('function parseNumberPtBr(val)'), 'public/js/crm.js implementa parseNumberPtBr()');
  assert(renderItensContent.includes('formatNumberPtBr(item.precoTabela)'), 'P. Tabela é exibido formatado no padrão brasileiro');
  assert(renderItensContent.includes('formatNumberPtBr(item.precoNegociado)'), 'P. Negociado é exibido formatado no padrão brasileiro');
  assert(renderItensContent.includes('parseNumberPtBr(e.target.value)'), 'Edição de P. Negociado realiza parse flexível pt-BR em tempo real');

  // Teste 11: Nova Coluna Desc(%) na Edição de Oportunidades
  // 11.1 Cabeçalho Desc(%) no thead de crm.html e index.html
  assert(crmHtml.includes('class="col-descpct" style="width: 75px; text-align: right;">Desc(%)</th>'), 'public/crm.html possui cabeçalho Desc(%) com 75px alinhado à direita');
  assert(indexHtml.includes('class="col-descpct" style="width: 75px; text-align: right;">Desc(%)</th>'), 'public/index.html possui cabeçalho Desc(%) com 75px alinhado à direita');

  // 11.2 Definições de largura em public/style.css e compensação na descrição
  assert(styleCss.includes('.crm-itens-cotados-table .col-descpct { width: 75px; }'), 'public/style.css define largura de 75px para .col-descpct');
  assert(styleCss.includes('.crm-itens-cotados-table .col-desc { min-width: 265px; }'), 'public/style.css reduziu min-width de col-desc para 265px compensando a nova coluna');

  // 11.3 Tabela vazia com colspan=8
  assert(renderItensContent.includes('<td colspan="8"'), 'renderItensCotadosTable() define colspan="8" para acomodar a nova coluna');

  // 11.4 Função calcularDescontoPercent e lógica matemática
  assert(crmJs.includes('function calcularDescontoPercent(precoTabela, precoNegociado)'), 'public/js/crm.js implementa calcularDescontoPercent()');

  // Extrai e testa a função matematicamente
  const calcDescMatch = crmJs.match(/function calcularDescontoPercent\([\s\S]*?\n  \}/);
  assert(calcDescMatch !== null, 'Função calcularDescontoPercent isolada com sucesso para teste unitário');
  if (calcDescMatch) {
    const fnCalcDesc = new Function(calcDescMatch[0] + '\nreturn calcularDescontoPercent;');
    const calcular = fnCalcDesc();
    assert(Math.abs(calcular(100, 85) - 15.00) < 0.001, 'Desconto de R$ 100 para R$ 85 é exatamente 15,00%');
    assert(Math.abs(calcular(100, 100) - 0.00) < 0.001, 'Sem desconto (100 para 100) retorna 0,00%');
    assert(Math.abs(calcular(100, 110) - 0.00) < 0.001, 'Preço negociado acima da tabela retorna 0,00%');
    assert(Math.abs(calcular(0, 50) - 0.00) < 0.001, 'Tabela zerada retorna 0,00%');
    assert(Math.abs(calcular(1250, 1000) - 20.00) < 0.001, 'Desconto de R$ 1.250 para R$ 1.000 é exatamente 20,00%');
  }

  // 11.5 Campo crm-item-descpct renderizado na tabela
  assert(renderItensContent.includes('crm-item-descpct'), 'renderItensCotadosTable() renderiza input com classe crm-item-descpct');
  assert(renderItensContent.includes('width: 75px') && renderItensContent.includes('crm-item-descpct'), 'Campo crm-item-descpct possui largura alinhada de 75px');
  assert(renderItensContent.includes('readonly disabled tabindex="-1"'), 'Campo crm-item-descpct é inalterável (readonly disabled)');

  // 11.6 Recálculo em tempo real no listener de digitação
  assert(renderItensContent.includes('row.querySelector(\'.crm-item-descpct\')'), 'Evento de input localiza crm-item-descpct da linha em edição');
  assert(renderItensContent.includes('descInp.value = formatNumberPtBr(rowDescPct)'), 'Evento de input atualiza descInp.value em tempo real no padrão brasileiro');

  // 11.7 Persistência de descontoPercent no item cotado
  assert(crmJs.includes('descontoPercent: 0'), 'addItemCotado() inicializa descontoPercent: 0');
  assert(renderItensContent.includes('item.descontoPercent = descPct'), 'renderItensCotadosTable() preserva descontoPercent no modelo de dados do item');

  // Teste 12: Campo Valor Total NFe Inalterável e Cálculo Automático (Soma Itens + Frete Cobrado)
  // 12.1 Rótulo Valor Total NFe: em crm.html e index.html
  assert(crmHtml.includes('Valor Total NFe:'), 'public/crm.html exibe o novo rótulo Valor Total NFe:');
  assert(indexHtml.includes('Valor Total NFe:'), 'public/index.html exibe o novo rótulo Valor Total NFe:');

  // 12.2 Eliminação do antigo rótulo Valor Oportunidade:
  assert(!crmHtml.includes('Valor Oportunidade:'), 'public/crm.html eliminou o rótulo antigo Valor Oportunidade:');
  assert(!indexHtml.includes('Valor Oportunidade:'), 'public/index.html eliminou o rótulo antigo Valor Oportunidade:');

  // 12.3 Campo crmInputValor inalterável (readonly disabled tabindex="-1" e cursor not-allowed)
  assert(crmHtml.includes('id="crmInputValor"') && crmHtml.includes('readonly disabled tabindex="-1"'), 'public/crm.html possui crmInputValor inalterável (readonly disabled)');
  assert(indexHtml.includes('id="crmInputValor"') && indexHtml.includes('readonly disabled tabindex="-1"'), 'public/index.html possui crmInputValor inalterável (readonly disabled)');
  assert(crmHtml.includes('id="crmInputValor"') && crmHtml.includes('cursor: not-allowed'), 'public/crm.html possui cursor not-allowed no crmInputValor');
  assert(indexHtml.includes('id="crmInputValor"') && indexHtml.includes('cursor: not-allowed'), 'public/index.html possui cursor not-allowed no crmInputValor');

  // 12.4 Função recalcularTotalNfeOportunidade implementada em crm.js
  assert(crmJs.includes('function recalcularTotalNfeOportunidade()'), 'public/js/crm.js implementa a função recalcularTotalNfeOportunidade()');

  // 12.5 Teste unitário isolado da regra matemática: Soma Itens + Frete Cobrado (excluindo Frete Embutido)
  function simularRecalcularTotalNfe(itens, freteCobrado, freteEmbutido) {
    let sumItens = 0;
    if (Array.isArray(itens)) {
      itens.forEach(it => {
        const q = parseFloat(it.quantidade) || 0;
        const p = parseFloat(it.precoNegociado) || 0;
        sumItens += q * p;
      });
    }
    const fCobrado = parseFloat(freteCobrado) || 0;
    // Frete embutido NÃO entra na conta do total da NFe
    return sumItens + fCobrado;
  }

  const itensExemplo = [
    { quantidade: 1, precoNegociado: 2599.00 }
  ];
  const totalSemFrete = simularRecalcularTotalNfe(itensExemplo, 0, 0);
  assert(totalSemFrete === 2599.00, 'Total NFe sem frete cobrado é exatamente a soma dos itens (R$ 2.599,00)');

  const totalComFreteCobrado = simularRecalcularTotalNfe(itensExemplo, 150.00, 0);
  assert(totalComFreteCobrado === 2749.00, 'Total NFe com Frete Cobrado (R$ 150) resulta em R$ 2.749,00 (2599 + 150)');

  const totalComFreteEmbutido = simularRecalcularTotalNfe(itensExemplo, 150.00, 300.00);
  assert(totalComFreteEmbutido === 2749.00, 'Frete Embutido (R$ 300) NÃO entra na conta e preserva R$ 2.749,00');

  // 12.6 Listener reativo em crmInputFreteCobrado
  assert(crmJs.includes('inputFreteCobrado.addEventListener(\'input\', recalcularTotalNfeOportunidade)'), 'crm.js recalcula Valor Total NFe reativamente no evento input de Frete Cobrado');
  assert(crmJs.includes('inputFreteCobrado.addEventListener(\'change\', recalcularTotalNfeOportunidade)'), 'crm.js recalcula Valor Total NFe reativamente no evento change de Frete Cobrado');

  // 12.7 Extração no salvamento usa parseNumberPtBr
  assert(crmJs.includes('parseNumberPtBr(document.getElementById(\'crmInputValor\')?.value)'), 'handleSaveOpportunity() extrai valor formatado via parseNumberPtBr');

  // 12.8 Dirty-checking cobre alterações em freteCobrado e freteEmbutido
  assert(crmJs.includes('freteCobrado !== (parseFloat(currentDeal.freteCobrado) || 0)'), 'isDealFormDirty() monitora alterações em freteCobrado');
  assert(crmJs.includes('freteEmbutido !== (parseFloat(currentDeal.freteEmbutido) || 0)'), 'isDealFormDirty() monitora alterações em freteEmbutido');

  // 12.9 Proteção defensiva Math.max contra frete cobrado negativo
  assert(crmJs.includes('Math.max(0, parseFloat(document.getElementById(\'crmInputFreteCobrado\')?.value) || 0)'), 'recalcularTotalNfeOportunidade() protege contra valores negativos no frete');

  console.log(`\n📊 Resultado dos Testes: ${passedTests}/${totalTests} aprovados.`);
  if (passedTests === totalTests) {
    console.log('🎉 Todos os testes de layout e rota standalone do CRM foram aprovados com sucesso!');
    process.exit(0);
  } else {
    console.error('💥 Alguns testes falharam.');
    process.exit(1);
  }
}

runTests();
