/**
 * test_farois_resiliencia_credito.js
 * 
 * Suíte de Testes Automatizados para Verificação Adversarial:
 * 1. Faróis de Conectividade Externa (SRE / Telemetria)
 * 2. Arquitetura Fail-Neutral no Motor de Score (Sem distorção por queda de rede)
 * 3. Validação de UI (HTML/CSS/JS) para todos os 6 faróis
 * 4. Tratamento de Erros e Proteções no Parser Serasa
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { calcularScore, getScoreConfig } = require('./analise_credito_engine');

console.log('🧪 Iniciando Suíte de Testes: Faróis de Conectividade & Resiliência SRE na Análise de Crédito...\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
    failCount++;
  }
}

// 1. Testes de Fail-Neutral no Motor de Score (analise_credito_engine.js)
console.log('--- 1. Motor de Score: Arquitetura Fail-Neutral ---');

test('1.1 Fail-Neutral Registro.br: Indisponibilidade técnica não deve penalizar com -7 pts', () => {
  const dadosComErro = {
    pedido_venda: '1001',
    total_pedido: 1500,
    faturado: 'S',
    idade_dominio_rdap_erro: true, // Flag de erro técnico de rede no Registro.br
    idade_dominio_rdap: null
  };
  const resComErro = calcularScore(dadosComErro);
  assert.strictEqual(resComErro.detalhesPontos.idade_dominio, 0, 'Indisponibilidade do Registro.br deve atribuir 0 pontos (Neutro)');

  const dadosDominioRecente = {
    pedido_venda: '1001',
    total_pedido: 1500,
    faturado: 'S',
    idade_dominio_rdap_erro: false,
    idade_dominio_rdap: 0 // Domínio realmente novo (< 1 ano)
  };
  const resRecente = calcularScore(dadosDominioRecente);
  assert.strictEqual(resRecente.detalhesPontos.idade_dominio, -7, 'Domínio genuinamente recente (< 1 ano) deve receber -7 pts');

  const dadosDominioAntigo = {
    pedido_venda: '1001',
    total_pedido: 1500,
    faturado: 'S',
    idade_dominio_rdap: 12 // Domínio com 12 anos
  };
  const resAntigo = calcularScore(dadosDominioAntigo);
  assert.strictEqual(resAntigo.detalhesPontos.idade_dominio, 6, 'Domínio antigo (>= 10 anos) deve receber +6 pts');
});

test('1.2 Fail-Neutral DNS MX: Falha na resolução de DNS não deve aplicar penalidade de -4 pts', () => {
  const dadosDnsErro = {
    pedido_venda: '1002',
    total_pedido: 2000,
    faturado: 'S',
    email_corporativo: 'S',
    servidor_mx_offline: true, // Falha de conexão DNS
    tipo_servidor_mx: 'ERRO_REDE'
  };
  const resDnsErro = calcularScore(dadosDnsErro);
  assert.strictEqual(resDnsErro.detalhesPontos.servidor_mx, 0, 'Falha DNS deve atribuir 0 pontos (Neutro)');

  const dadosSemMx = {
    pedido_venda: '1002',
    total_pedido: 2000,
    faturado: 'S',
    email_corporativo: 'S',
    tipo_servidor_mx: 'NENHUM' // Domínio corporativo sem registro MX
  };
  const resSemMx = calcularScore(dadosSemMx);
  assert.strictEqual(resSemMx.detalhesPontos.servidor_mx, -4, 'Domínio corporativo sem MX ativo deve tomar -4 pts');

  const dadosMxPremium = {
    pedido_venda: '1002',
    total_pedido: 2000,
    faturado: 'S',
    tipo_servidor_mx: 'PREMIUM'
  };
  const resPremium = calcularScore(dadosMxPremium);
  assert.strictEqual(resPremium.detalhesPontos.servidor_mx, 3, 'Servidor MX Premium deve receber +3 pts');
});

test('1.3 Fail-Neutral Receita Federal: Indisponibilidade das APIs não mascara conformidade e alerta conferência manual', () => {
  const dadosReceitaOffline = {
    pedido_venda: '1003',
    total_pedido: 3000,
    faturado: 'S',
    receita_offline: true,
    cadastro_igual_receita: 'INDISPONIVEL'
  };
  const resOffline = calcularScore(dadosReceitaOffline);
  assert.strictEqual(resOffline.detalhesPontos.cadastro_igual_receita, 0, 'Receita offline deve atribuir 0 pontos');
  assert.strictEqual(resOffline.alertaCadastroReceita, 'RECEITA OFFLINE - CONFERIR ENDEREÇO');
  assert(resOffline.sugestoesLista.includes('RECEITA OFFLINE - CONFERIR ENDEREÇO'), 'Deve incluir sugestão de conferência manual');

  const dadosEndDivergente = {
    pedido_venda: '1003',
    total_pedido: 3000,
    faturado: 'S',
    cadastro_igual_receita: 'N'
  };
  const resDiv = calcularScore(dadosEndDivergente);
  assert.strictEqual(resDiv.detalhesPontos.cadastro_igual_receita, -3, 'Endereço divergente na Receita deve descontar -3 pts');
  assert.strictEqual(resDiv.alertaCadastroReceita, 'PRECISA CORRIGIR END DIVERGENTE');
});

// 2. Validação da Estrutura de Telemetria e Faróis no Backend (server.js)
console.log('\n--- 2. Telemetria e Rastreamento de Latência no Backend ---');

test('2.1 Backend server.js deve conter objeto status_conexoes com os 6 faróis', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');
  assert(serverCode.includes('status_conexoes: statusConexoes'), 'server.js deve enviar status_conexoes no JSON');
  assert(serverCode.includes('receita: {'), 'Deve mapear farol da receita');
  assert(serverCode.includes('registro_br: {'), 'Deve mapear farol do registro_br');
  assert(serverCode.includes('wayback: {'), 'Deve mapear farol do wayback');
  assert(serverCode.includes('dns_mx: {'), 'Deve mapear farol do dns_mx');
  assert(serverCode.includes('fgts_caixa: {'), 'Deve mapear farol do fgts_caixa');
  assert(serverCode.includes('protheus_db: {'), 'Deve mapear farol do protheus_db');
});

test('2.2 Funções de consulta externa em server.js devem rastrear tempoMs e status estruturado', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');
  assert(serverCode.includes("provedor: 'BrasilAPI'"), 'consultarCnpjPublico deve rastrear provedor BrasilAPI');
  assert(serverCode.includes("provedor: 'ReceitaWS (Fallback)'"), 'consultarCnpjPublico deve rastrear provedor ReceitaWS');
  assert(serverCode.includes("provedor: 'Registro.br (RDAP)'"), 'consultarRDAP deve rastrear provedor RDAP');
  assert(serverCode.includes("provedor: 'Archive.org (Wayback)'"), 'consultarWayback deve rastrear Archive.org');
  assert(serverCode.includes("provedor: 'InfoSimples / Caixa'"), 'consultarFgtsInfoSimples deve rastrear InfoSimples');
});

// 3. Validação de Interface (UI/UX) e Componentes Faróis
console.log('\n--- 3. Validação de Interface HTML, CSS e JavaScript ---');

test('3.1 public/index.html deve conter container dos Faróis e 6 cards dedicados', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
  assert(html.includes('id="creditoFaroisConectividade"'), 'Deve conter #creditoFaroisConectividade');
  assert(html.includes('id="farol_receita"'), 'Deve conter card #farol_receita');
  assert(html.includes('id="farol_registro_br"'), 'Deve conter card #farol_registro_br');
  assert(html.includes('id="farol_wayback"'), 'Deve conter card #farol_wayback');
  assert(html.includes('id="farol_dns_mx"'), 'Deve conter card #farol_dns_mx');
  assert(html.includes('id="farol_fgts_caixa"'), 'Deve conter card #farol_fgts_caixa');
  assert(html.includes('id="farol_protheus_db"'), 'Deve conter card #farol_protheus_db');
  assert(html.includes('class="farol-pulse-dot"'), 'Deve conter LED pulsante');
});

test('3.2 public/style.css deve conter estilos e classes de LED para os 4 estados visuais', () => {
  const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf-8');
  assert(css.includes('.farois-container'), 'Deve estilizar .farois-container');
  assert(css.includes('.farol-led.farol-ok'), 'Deve conter classe .farol-ok (verde)');
  assert(css.includes('.farol-led.farol-alert'), 'Deve conter classe .farol-alert (amarelo)');
  assert(css.includes('.farol-led.farol-error'), 'Deve conter classe .farol-error (vermelho)');
  assert(css.includes('.farol-led.farol-info'), 'Deve conter classe .farol-info (azul)');
  assert(css.includes('.tab-theme-light .farois-container'), 'Deve conter suporte ao tema claro');
});

test('3.3 public/app.js deve conter renderFaroisConectividade e tratamento de erros do Protheus', () => {
  const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');
  assert(js.includes('function renderFaroisConectividade('), 'Deve implementar renderFaroisConectividade');
  assert(js.includes('renderFaroisConectividade(data.status_conexoes)'), 'Deve chamar renderFaroisConectividade após consulta');
  assert(js.includes('Falha de Conexão com o ERP Protheus (Railway SQL)'), 'Deve alertar falha de conexão sem mascarar como pedido inexistente');
  assert(js.includes('FGTS Caixa Não Consultado:'), 'Deve exibir badge informativo quando FGTS não puder ser executado');
});

// 4. Proteção no Parser Serasa
console.log('\n--- 4. Proteções de Processo e Timeout no Parser Serasa ---');

test('4.1 serasa_pdf_parser.js deve conter timeout de segurança de 15 segundos', () => {
  const parserJs = fs.readFileSync(path.join(__dirname, 'serasa_pdf_parser.js'), 'utf-8');
  assert(parserJs.includes('15000'), 'Deve conter timer de 15000ms (15s)');
  assert(parserJs.includes('TIMEOUT_PROCESSAMENTO'), 'Deve conter error_type TIMEOUT_PROCESSAMENTO');
});

// Relatório Final
console.log('\n========================================');
console.log(`📊 Resultado Final dos Testes:`);
console.log(`   Total de Testes: ${passCount + failCount}`);
console.log(`   Aprovados: ${passCount}`);
console.log(`   Falhas: ${failCount}`);
console.log('========================================\n');

if (failCount > 0) {
  process.exit(1);
}
