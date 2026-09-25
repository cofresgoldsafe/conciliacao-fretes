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
