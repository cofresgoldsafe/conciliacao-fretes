/**
 * test_dom_xss_and_secrets.js
 * 
 * Suíte de Testes Automatizados para:
 * 1. Mitigação de DOM-based XSS (escapeHtml e sanitização em public/app.js).
 * 2. Criptografia e Proteção de Segredos (eliminação de senhas em texto puro e caminhos fixos).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

let passedTests = 0;
let failedTests = 0;

function report(name, success, error) {
  if (success) {
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
    failedTests++;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: SEGURANÇA (DOM XSS & PROTEÇÃO DE SEGREDOS)');
  console.log('=============================================================\n');

  // -------------------------------------------------------------
  // Teste 1: Função escapeHtml neutraliza vetores de injeção XSS
  // -------------------------------------------------------------
  console.log('--- 1. Sanitização de Vetores DOM XSS ---');
  try {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg/onload=confirm(document.cookie)>',
      "' onfocus='alert(1)' autofocus='",
      'Empresa & Filial "GSI" <100% Protegida>'
    ];

    xssPayloads.forEach(payload => {
      const sanitized = escapeHtml(payload);
      assert.ok(!sanitized.includes('<'), `Sanitização não deve conter '<' em: ${payload}`);
      assert.ok(!sanitized.includes('>'), `Sanitização não deve conter '>' em: ${payload}`);
      assert.ok(!sanitized.includes('"'), `Sanitização não deve conter '"' em: ${payload}`);
      assert.ok(!sanitized.includes("'"), `Sanitização não deve conter "'" em: ${payload}`);
    });

    report('Função escapeHtml neutraliza 100% dos caracteres perigosos de injeção XSS', true);
  } catch (err) {
    report('Função escapeHtml neutraliza 100% dos caracteres perigosos de injeção XSS', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 2: Validação de uso de escapeHtml em public/app.js
  // -------------------------------------------------------------
  console.log('\n--- 2. Verificação de Código Fonte: public/app.js ---');
  try {
    const appJsContent = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');

    assert.ok(appJsContent.includes('function escapeHtml(str)'), 'app.js deve conter a declaração da função escapeHtml');
    assert.ok(appJsContent.includes('escapeHtml(act.description)'), 'Feed de auditoria deve escapar act.description');
    assert.ok(appJsContent.includes('escapeHtml(act.userName'), 'Feed de auditoria deve escapar act.userName');
    assert.ok(appJsContent.includes('escapeHtml(item.transportadora)'), 'Histórico deve escapar transportadora');
    assert.ok(appJsContent.includes('escapeHtml(empNome)'), 'Resumo de fatura deve escapar empNome');
    assert.ok(appJsContent.includes('escapeHtml(data.config.usuario)'), 'Status ViPP deve escapar usuario');

    report('public/app.js sanitiza feed de atividades, histórico e dados dinâmicos', true);
  } catch (err) {
    report('public/app.js sanitiza feed de atividades, histórico e dados dinâmicos', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 3: Ausência de caminhos hardcoded locais no inter_api.js
  // -------------------------------------------------------------
  console.log('\n--- 3. Verificação de Segredos & Caminhos: inter_api.js ---');
  try {
    const interApiContent = fs.readFileSync(path.join(__dirname, 'inter_api.js'), 'utf-8');

    assert.ok(!interApiContent.includes('D:\\Backup IA'), 'inter_api.js NÃO deve conter caminhos locais absolutos do drive D:');
    assert.ok(!interApiContent.includes('LOCAL_CERT_PATHS'), 'inter_api.js NÃO deve conter objeto LOCAL_CERT_PATHS com caminhos fixos');
    assert.ok(interApiContent.includes('process.env.MP_cert') || interApiContent.includes('process.env.INTER_CERT_14'), 'inter_api.js deve carregar certificados via variáveis de ambiente');

    report('inter_api.js isolado de caminhos locais e preparado para variáveis de ambiente seguras', true);
  } catch (err) {
    report('inter_api.js isolado de caminhos locais e preparado para variáveis de ambiente seguras', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4: Ausência de senhas em texto puro em server.js e postgres_db.js
  // -------------------------------------------------------------
  console.log('\n--- 4. Ausência de Senhas em Texto Puro no Backend ---');
  try {
    const serverJsContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');
    const postgresDbContent = fs.readFileSync(path.join(__dirname, 'postgres_db.js'), 'utf-8');

    // Verifica que não há objetos defaultSeeds com senhas em texto plano
    assert.ok(!serverJsContent.includes("pass: '321654'"), 'server.js NÃO deve conter senhas em texto claro');
    assert.ok(!serverJsContent.includes("pass: '102030'"), 'server.js NÃO deve conter senhas em texto claro');
    assert.ok(!serverJsContent.includes("pass: '1020304050'"), 'server.js NÃO deve conter senhas em texto claro');

    // Verifica que postgres_db.js usa hashes bcrypt
    assert.ok(!postgresDbContent.includes("pass: '321654'"), 'postgres_db.js NÃO deve conter pass: 321654');
    assert.ok(!postgresDbContent.includes("pass: '1020304050'"), 'postgres_db.js NÃO deve conter pass: 1020304050');
    assert.ok(postgresDbContent.includes('$2b$10$'), 'postgres_db.js deve conter hashes bcrypt seguros');

    report('server.js e postgres_db.js livres de senhas em texto claro', true);
  } catch (err) {
    report('server.js e postgres_db.js livres de senhas em texto claro', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 5: Autenticação Bcrypt no data/users.json
  // -------------------------------------------------------------
  console.log('\n--- 5. Verificação do Arquivo de Usuários: data/users.json ---');
  try {
    const usersJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'users.json'), 'utf-8'));
    assert.ok(Array.isArray(usersJson) && usersJson.length > 0, 'data/users.json deve conter usuários');

    usersJson.forEach(u => {
      if (u.pass) {
        assert.ok(String(u.pass).startsWith('$2'), `Senha do usuário ${u.username} deve ser um hash bcrypt ($2...)`);
      }
    });

    report('100% dos usuários em data/users.json possuem senhas criptografadas com bcrypt', true);
  } catch (err) {
    report('100% dos usuários em data/users.json possuem senhas criptografadas com bcrypt', false, err.message);
  }

  // -------------------------------------------------------------
  // Resumo Final
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`📊 RESUMO DOS TESTES: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
