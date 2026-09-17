/**
 * test_vendedores_nfe.js
 * Teste unitário e de integração para a lógica da coluna NF-e (C5_NOTA)
 * nos pedidos de vendedores.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const protheusDb = require('./protheus_db');

console.log('\n====================================================');
console.log('🧪 TESTES AUTOMATIZADOS: NF-E / C5_NOTA (VENDEDORES)');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

// Simulador da lógica client-side formatNFeBadge
function formatNFeBadge(notaFiscal) {
  const nf = (notaFiscal || '').trim();
  if (!nf || nf === '-' || nf === '0') {
    return { status: 'NAO_EMITIDA', label: '⏳ Não emitida' };
  }
  if (/^X+$/i.test(nf) || nf.toUpperCase().includes('CANCEL')) {
    return { status: 'CANCELADO', label: '🚫 Cancelado' };
  }
  return { status: 'EMITIDA', label: `📄 NF ${nf}`, nf: nf };
}

// 1. Testes de Classificação de C5_NOTA
test('C5_NOTA vazio resulta em "Não emitida"', () => {
  assert.strictEqual(formatNFeBadge('').status, 'NAO_EMITIDA');
  assert.strictEqual(formatNFeBadge('   ').status, 'NAO_EMITIDA');
  assert.strictEqual(formatNFeBadge(null).status, 'NAO_EMITIDA');
  assert.strictEqual(formatNFeBadge(undefined).status, 'NAO_EMITIDA');
  assert.strictEqual(formatNFeBadge('-').status, 'NAO_EMITIDA');
});

test('C5_NOTA com "XXXXXXXXX" resulta em "Cancelado"', () => {
  assert.strictEqual(formatNFeBadge('XXXXXXXXX').status, 'CANCELADO');
  assert.strictEqual(formatNFeBadge('xxxxxxxxx').status, 'CANCELADO');
  assert.strictEqual(formatNFeBadge('   XXXX   ').status, 'CANCELADO');
  assert.strictEqual(formatNFeBadge('CANCELADO').status, 'CANCELADO');
});

test('C5_NOTA com número preenchido resulta em "Emitida" com o número da NF', () => {
  const res1 = formatNFeBadge('000123456');
  assert.strictEqual(res1.status, 'EMITIDA');
  assert.strictEqual(res1.nf, '000123456');

  const res2 = formatNFeBadge('987654');
  assert.strictEqual(res2.status, 'EMITIDA');
  assert.strictEqual(res2.nf, '987654');
});

// 2. Testes de Classificação Fiscal da TES (SF4: F4_DUPLIC e F4_ESTOQUE)
test('F4_DUPLIC = "S" indica Gera Financeiro = Sim, "N" indica Não', () => {
  const parseGeraFin = (f4) => (f4 || '').trim().toUpperCase() === 'S' ? 'S' : ((f4 || '').trim().toUpperCase() === 'N' ? 'N' : '-');
  assert.strictEqual(parseGeraFin('S'), 'S');
  assert.strictEqual(parseGeraFin('s'), 'S');
  assert.strictEqual(parseGeraFin('N'), 'N');
  assert.strictEqual(parseGeraFin('n'), 'N');
  assert.strictEqual(parseGeraFin(''), '-');
  assert.strictEqual(parseGeraFin(null), '-');
});

test('F4_ESTOQUE = "S" indica Atualiza Estoque = Sim, "N" indica Não', () => {
  const parseAtuEstq = (f4) => (f4 || '').trim().toUpperCase() === 'S' ? 'S' : ((f4 || '').trim().toUpperCase() === 'N' ? 'N' : '-');
  assert.strictEqual(parseAtuEstq('S'), 'S');
  assert.strictEqual(parseAtuEstq('s'), 'S');
  assert.strictEqual(parseAtuEstq('N'), 'N');
  assert.strictEqual(parseAtuEstq('n'), 'N');
  assert.strictEqual(parseAtuEstq(''), '-');
  assert.strictEqual(parseAtuEstq(null), '-');
});

test('Consolidação fiscal do pedido agrega TES e indicadores fiscais', () => {
  const itens = [
    { TES: '501', F4_DUPLIC: 'S', F4_ESTOQUE: 'S' },
    { TES: '501', F4_DUPLIC: 'S', F4_ESTOQUE: 'S' }
  ];
  const distinctTes = [...new Set(itens.map(i => (i.TES || '').trim()).filter(Boolean))];
  const hasDuplicSim = itens.some(i => (i.F4_DUPLIC || '').trim().toUpperCase() === 'S');
  const hasEstoqueSim = itens.some(i => (i.F4_ESTOQUE || '').trim().toUpperCase() === 'S');

  assert.strictEqual(distinctTes.join(', '), '501');
  assert.strictEqual(hasDuplicSim, true);
  assert.strictEqual(hasEstoqueSim, true);
});

// 3. Testes de Faturas / Títulos SE1 (E1_BAIXA, E1_VENCTO, E1_PARCELA)
test('E1_BAIXA preenchido com data indica título PAGO', () => {
  const checkStatusBaixa = (baixa) => {
    const dataBaixa = (baixa || '').trim();
    const estaPago = !!(dataBaixa && dataBaixa !== '' && dataBaixa !== '0' && dataBaixa.length === 8);
    return {
      estaPago,
      status: estaPago ? 'PAGO' : 'PENDENTE'
    };
  };

  const res1 = checkStatusBaixa('20260815');
  assert.strictEqual(res1.estaPago, true);
  assert.strictEqual(res1.status, 'PAGO');

  const res2 = checkStatusBaixa('');
  assert.strictEqual(res2.estaPago, false);
  assert.strictEqual(res2.status, 'PENDENTE');

  const res3 = checkStatusBaixa('   ');
  assert.strictEqual(res3.estaPago, false);
  assert.strictEqual(res3.status, 'PENDENTE');

  const res4 = checkStatusBaixa(null);
  assert.strictEqual(res4.estaPago, false);
  assert.strictEqual(res4.status, 'PENDENTE');
});

test('E1_PARCELA identifica parcelas divididas (A, B, C, 01, 02) ou Parcela Única', () => {
  const parseParcela = (parcela) => {
    const p = (parcela || '').trim();
    return p || 'Única';
  };

  assert.strictEqual(parseParcela(''), 'Única');
  assert.strictEqual(parseParcela('   '), 'Única');
  assert.strictEqual(parseParcela(null), 'Única');
  assert.strictEqual(parseParcela('A'), 'A');
  assert.strictEqual(parseParcela('B'), 'B');
  assert.strictEqual(parseParcela('01'), '01');
  assert.strictEqual(parseParcela('AB'), 'AB');
});

test('Formatação de datas Protheus YYYYMMDD para DD/MM/AAAA', () => {
  const formatData = (dt) => {
    if (!dt || String(dt).trim().length !== 8) return dt ? String(dt).trim() : '-';
    const s = String(dt).trim();
    return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`;
  };

  assert.strictEqual(formatData('20260821'), '21/08/2026');
  assert.strictEqual(formatData('20260905'), '05/09/2026');
  assert.strictEqual(formatData(''), '-');
  assert.strictEqual(formatData(null), '-');
});

// 4. Testes de Contrato do Módulo protheus_db
test('protheus_db exporta buscarPedidosVendedores e obterDetalhesPedido', () => {
  assert.strictEqual(typeof protheusDb.buscarPedidosVendedores, 'function');
  assert.strictEqual(typeof protheusDb.obterDetalhesPedido, 'function');
});

// 5. Testes da Coluna CodWeb & Link do Pipedrive CRM (Consulta Ped Venda)
test('public/app.js renderiza CodWeb com link oficial do Pipedrive CRM e target="_blank"', () => {
  const appJsPath = path.join(__dirname, 'public', 'app.js');
  const appJsContent = fs.readFileSync(appJsPath, 'utf-8');

  // Verifica que renderVendPedidosTable gera o link para Pipedrive
  assert(
    appJsContent.includes('https://benetroncomercial.pipedrive.com/deal/${encodeURIComponent(codWebText)}'),
    'Link do CodWeb deve apontar para https://benetroncomercial.pipedrive.com/deal/${encodeURIComponent(codWebText)}'
  );
  assert(
    appJsContent.includes('title="Abrir Deal ${escapeHtml(codWebText)} no Pipedrive"'),
    'Link deve conter o title correspondente para abertura de Deal no Pipedrive'
  );
  assert(
    appJsContent.includes('target="_blank" rel="noopener noreferrer"'),
    'Link deve abrir em nova aba com rel="noopener noreferrer"'
  );
});

test('public/app.js restringe abertura do modal de detalhes aos seletores .link-pedido e .btn-ver-detalhe (não intercepta CodWeb)', () => {
  const appJsPath = path.join(__dirname, 'public', 'app.js');
  const appJsContent = fs.readFileSync(appJsPath, 'utf-8');

  // Verifica que o event listener em vendPedidosTableBody escuta apenas link-pedido e btn-ver-detalhe
  assert(
    appJsContent.includes("e.target.closest('.link-pedido, .btn-ver-detalhe')"),
    'Listener de clique em vendPedidosTableBody não deve interceptar .link-codweb, permitindo navegação ao Pipedrive'
  );
});

test('Simulação de formatação de CodWeb na Consulta Ped Venda', () => {
  const formatCodWebHtml = (codWeb) => {
    const codWebText = codWeb && codWeb !== '-' ? String(codWeb).trim() : '-';
    return codWebText !== '-'
      ? `<a href="https://benetroncomercial.pipedrive.com/deal/${encodeURIComponent(codWebText)}" target="_blank" rel="noopener noreferrer" class="badge-tag link-codweb-pipedrive">${codWebText}</a>`
      : `<span style="color: var(--text-muted);">-</span>`;
  };

  const html1 = formatCodWebHtml('25238');
  assert(html1.includes('href="https://benetroncomercial.pipedrive.com/deal/25238"'));
  assert(html1.includes('target="_blank"'));

  const html2 = formatCodWebHtml('');
  assert.strictEqual(html2, '<span style="color: var(--text-muted);">-</span>');

  const html3 = formatCodWebHtml('-');
  assert.strictEqual(html3, '<span style="color: var(--text-muted);">-</span>');

  const html4 = formatCodWebHtml(null);
  assert.strictEqual(html4, '<span style="color: var(--text-muted);">-</span>');
});

// 6. Testes de Descrição Relacional de Transportadora (SA4) e Condição de Pagamento (SE4)
test('protheus_db.js realiza LEFT JOIN com SA4010 e SE4010 em obterDetalhesPedido', () => {
  const protheusDbPath = path.join(__dirname, 'protheus_db.js');
  const protheusDbContent = fs.readFileSync(protheusDbPath, 'utf-8');

  // Verifica presença dos joins na query sqlC5
  assert(
    protheusDbContent.includes('LEFT JOIN SA4010 A4'),
    'sqlC5 deve conter LEFT JOIN SA4010 A4 para capturar o nome da transportadora'
  );
  assert(
    protheusDbContent.includes('LEFT JOIN SE4010 E4'),
    'sqlC5 deve conter LEFT JOIN SE4010 E4 para capturar a descrição da condição de pagamento'
  );
  assert(
    protheusDbContent.includes('RTRIM(ISNULL(A4.A4_NOME, \'\')) AS NOME_TRANSP'),
    'sqlC5 deve projetar NOME_TRANSP'
  );
  assert(
    protheusDbContent.includes('RTRIM(ISNULL(E4.E4_DESCRI, \'\')) AS DESC_CONDPAG'),
    'sqlC5 deve projetar DESC_CONDPAG'
  );
});

test('Simulação de formatação de Transportadora e Condição de Pagamento no objeto comercial', () => {
  const formatComercial = (head, nomeTransp, condPagInfo) => {
    return {
      transportadora: nomeTransp 
        ? `${(head.TRANSP || '').trim()} - ${nomeTransp}`
        : ((head.TRANSP || '').trim() || 'Transportadora Padrão'),
      codTransp: (head.TRANSP || '').trim(),
      nomeTransp: nomeTransp,
      condPagto: (condPagInfo.descricao && condPagInfo.descricao.trim())
        ? `${(head.CONDPAG || '').trim()} - ${condPagInfo.descricao.trim()}`
        : ((head.CONDPAG || '').trim() || 'À Vista / Boleto'),
      codCondPag: (head.CONDPAG || '').trim(),
      descCondPag: (condPagInfo.descricao || '').trim(),
      condPagInfo: condPagInfo
    };
  };

  // Caso 1: Código + Descrição presentes
  const c1 = formatComercial(
    { TRANSP: '000003', CONDPAG: '014' },
    'BRASPRESS TRANSPORTES URGENTES',
    { codigo: '014', descricao: '30/60 DIAS', e4_cond: '30,60', e4_ctradt: '0', possuiEntrada: 'N', faturado: 'S' }
  );
  assert.strictEqual(c1.transportadora, '000003 - BRASPRESS TRANSPORTES URGENTES');
  assert.strictEqual(c1.condPagto, '014 - 30/60 DIAS');
  assert.strictEqual(c1.codTransp, '000003');
  assert.strictEqual(c1.nomeTransp, 'BRASPRESS TRANSPORTES URGENTES');
  assert.strictEqual(c1.condPagInfo.faturado, 'S');

  // Caso 2: Somente código sem nome encontrado no cadastro
  const c2 = formatComercial(
    { TRANSP: '000999', CONDPAG: '999' },
    '',
    { codigo: '999', descricao: '', e4_cond: '', e4_ctradt: '', possuiEntrada: 'N', faturado: 'N' }
  );
  assert.strictEqual(c2.transportadora, '000999');
  assert.strictEqual(c2.condPagto, '999');

  // Caso 3: Campos vazios utilizam fallbacks amigáveis
  const c3 = formatComercial(
    { TRANSP: '', CONDPAG: '' },
    '',
    { codigo: '', descricao: '', e4_cond: '', e4_ctradt: '', possuiEntrada: 'N', faturado: 'N' }
  );
  assert.strictEqual(c3.transportadora, 'Transportadora Padrão');
  assert.strictEqual(c3.condPagto, 'À Vista / Boleto');
});

test('public/app.js renderiza campos de Transportadora e Condição Pagto no modal #pedidoDetalhesModal', () => {
  const appJsPath = path.join(__dirname, 'public', 'app.js');
  const appJsContent = fs.readFileSync(appJsPath, 'utf-8');

  assert(
    appJsContent.includes('${escapeHtml(com.transportadora || \'\-\')}'),
    'Modal deve renderizar com.transportadora com escapeHtml'
  );
  assert(
    appJsContent.includes('${escapeHtml(com.condPagto || \'\-\')}'),
    'Modal deve renderizar com.condPagto com escapeHtml'
  );
});

console.log(`\n====================================================`);
console.log(`📊 RESULTADOS: ${passCount} aprovados, ${failCount} falhas`);
console.log(`====================================================\n`);

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

