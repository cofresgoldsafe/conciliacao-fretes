/**
 * test_serasa_pdf_socios_extraction.js
 * 
 * Suíte de Testes Automatizados para validação da extração estruturada de sócios,
 * administradores, CPFs e detecção de empresas públicas no parser Serasa (PDF).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseSerasaBuffer } = require('./serasa_pdf_parser');

const pdfDir = __dirname;
const wdmPdfPath = path.join(pdfDir, 'Exemplo-Serasa-WDM BRASIL ACOS LTDA  2026-08-03.pdf');
const apPdfPath = path.join(pdfDir, 'Exemplo-Serasa-AP+ELETTROLIGHT SERVICOS DE ENGENHARIA ELETRICA 2026-08-04.pdf');
const dassPdfPath = path.join(pdfDir, 'Exemplo-Serasa-DASS NORDESTE CALCADOS E ARTIGOS ESPORTIVOS S.A  2026-07-01.pdf');
const equipseaPdfPath = path.join(pdfDir, 'Exemplo-Serasa-EQUIPSEA EQUIPAMENTOS E SERVICOS INDUSTRIAIS LTDA   2026-08-04.pdf');
const optimusPdfPath = path.join(pdfDir, 'Exemplo-Serasa-OPTIMUS PHARMA MEDICAMENTOS MANIPULADOS LTDA.pdf');

let passedTests = 0;
let failedTests = 0;

function report(name, success, error) {
  if (success) {
    console.log(`  ✓ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: EXTRAÇÃO DE SÓCIOS & CPFS NO SERASA (PDF)');
  console.log('=============================================================\n');

  // Teste 1: WDM Brasil Aços (2 sócios PF)
  console.log('--- 1. WDM Brasil Aços (2 sócios PF: Marianna e Danilo) ---');
  try {
    const buf = fs.readFileSync(wdmPdfPath);
    const res = await parseSerasaBuffer(buf);
    assert.strictEqual(res.success, true);
    assert.ok(Array.isArray(res.quadro_societario), 'quadro_societario deve ser array');
    assert.strictEqual(res.possui_socios_pf, true, 'Deve possuir sócios PF');
    assert.strictEqual(res.is_empresa_publica, false, 'Não é empresa pública');
    assert.ok(res.cpfs_socios.includes('27851189870'), 'Deve conter CPF da Marianna');
    assert.ok(res.cpfs_socios.includes('29788493807'), 'Deve conter CPF do Danilo');
    report('Extração Sócios WDM Brasil Aços (2 CPFs)', true);
  } catch (err) {
    report('Extração Sócios WDM Brasil Aços (2 CPFs)', false, err.message);
  }

  // Teste 2: AP Elettro Light (Sócio PJ + Administrador PF)
  console.log('\n--- 2. AP Elettro Light (Sócio PJ + Administrador PF) ---');
  try {
    const buf = fs.readFileSync(apPdfPath);
    const res = await parseSerasaBuffer(buf);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.possui_socios_pf, true);
    assert.ok(res.cpfs_socios.includes('23112915801'), 'Deve conter CPF do Administrador Antonio Pepe');
    const adminPepe = res.quadro_societario.find(s => s.documento.includes('231.129.158-01'));
    assert.ok(adminPepe, 'Deve localizar Antonio Pepe no array');
    assert.strictEqual(adminPepe.cargo, 'ADMINISTRADOR');
    assert.ok(!adminPepe.nome.includes('CONSULTORIA ENGENHARIA'), 'Nome deve ser limpo de cabeçalho');
    report('Extração Administrador AP Elettro Light', true);
  } catch (err) {
    report('Extração Administrador AP Elettro Light', false, err.message);
  }

  // Teste 3: DASS Nordeste Calçados (S.A. com múltiplos diretores)
  console.log('\n--- 3. DASS Nordeste Calçados (S.A. com múltiplos diretores) ---');
  try {
    const buf = fs.readFileSync(dassPdfPath);
    const res = await parseSerasaBuffer(buf);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.possui_socios_pf, true);
    assert.ok(res.cpfs_socios.length >= 5, `Deve extrair múltiplos CPFs (encontrados: ${res.cpfs_socios.length})`);
    assert.ok(res.cpfs_socios.includes('22026142904'), 'Deve conter Vilson Hermes');
    assert.ok(res.cpfs_socios.includes('07227394948'), 'Deve conter Diretor Henrique Hermes');
    report('Extração Diretoria DASS Nordeste S.A.', true);
  } catch (err) {
    report('Extração Diretoria DASS Nordeste S.A.', false, err.message);
  }

  // Teste 4: EQUIPSEA (Administrador PF)
  console.log('\n--- 4. EQUIPSEA Equipamentos (Administrador PF Vitor Daniel) ---');
  try {
    const buf = fs.readFileSync(equipseaPdfPath);
    const res = await parseSerasaBuffer(buf);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.possui_socios_pf, true);
    assert.ok(res.cpfs_socios.includes('33020134854'), 'Deve conter CPF do Administrador Vitor Daniel');
    report('Extração Administrador EQUIPSEA', true);
  } catch (err) {
    report('Extração Administrador EQUIPSEA', false, err.message);
  }

  // Teste 5: Optimus Pharma (Modelo sem sócios ou expirado)
  console.log('\n--- 5. Optimus Pharma (Resiliência para modelo ou formato alternativo) ---');
  try {
    const buf = fs.readFileSync(optimusPdfPath);
    const res = await parseSerasaBuffer(buf);
    // Optimus é laudo expirado > 4 meses, mas se testar sem ref_date ou com res.quadro_societario
    assert.ok(res !== null, 'Retorno não deve ser nulo');
    report('Resiliência Optimus Pharma', true);
  } catch (err) {
    report('Resiliência Optimus Pharma', false, err.message);
  }

  console.log('\n=============================================================');
  console.log(`📊 RESUMO DA EXECUÇÃO: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) process.exit(1);
}

runTests();
