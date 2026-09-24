/**
 * test_crm_filtros.js
 * Suíte de Testes Automatizados para os Novos Filtros do CRM Comercial:
 * - Executa diretamente a implementação REAL de public/js/crm.js (sem testes viciados/phantom)
 * - Remoção de 'Diretoria' do filtro de proprietário/vendedor (UI e Backend)
 * - Opção 'Oportunidades Abertas' (exclui GANHO e PERDIDO)
 * - Opções 'Somente Ganhas', 'Ganhas Hoje', 'Ganhas Ontem', 'Somente Perdidos' e 'Todas'
 * - Verificação de resiliência a strings de data pura (YYYY-MM-DD) contra Timezone Shift UTC-3
 * - Reset de filtros para 'ABERTAS'
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Iniciando Bateria de Testes dos Novos Filtros do CRM Comercial...\n');

// 1. Teste de Arquitetura DOM e Acessibilidade (index.html)
console.log('1️⃣  Teste: Verificação das Opções de Filtro e Acessibilidade em public/index.html');
const htmlContent = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');

assert.ok(htmlContent.includes('<select id="crmFilterStatus"'), 'Elemento crmFilterStatus deve existir no HTML');
assert.ok(htmlContent.includes('value="ABERTAS">Oportunidades Abertas</option>'), 'Opção Oportunidades Abertas deve existir');
assert.ok(htmlContent.includes('value="GANHO">Somente Ganhas</option>'), 'Opção Somente Ganhas deve existir');
assert.ok(htmlContent.includes('value="GANHO_HOJE">Ganhas Hoje</option>'), 'Opção Ganhas Hoje deve existir');
assert.ok(htmlContent.includes('value="GANHO_ONTEM">Ganhas Ontem</option>'), 'Opção Ganhas Ontem deve existir');
assert.ok(htmlContent.includes('value="PERDIDO">Somente Perdidos</option>'), 'Opção Somente Perdidos deve existir');
assert.ok(htmlContent.includes('value="TODOS">Todas (inclui Perdidos)</option>'), 'Opção Todas deve existir');
assert.ok(!htmlContent.includes('value="ATIVOS"'), 'Valor legado ATIVOS deve ter sido substituído no HTML');

// Acessibilidade WCAG 2.1
assert.ok(htmlContent.includes('id="crmFilterStatus" class="form-control" aria-label="Filtrar oportunidades por status"'),
          'crmFilterStatus deve possuir aria-label descritivo');
assert.ok(htmlContent.includes('id="crmFilterVendedor" class="form-control" aria-label="Filtrar oportunidades por vendedor"'),
          'crmFilterVendedor deve possuir aria-label descritivo');
console.log('   ✅ Opções de status e atributos aria-label no DOM validados com sucesso.');

// 2. Teste: Remoção de "Diretoria" do seletor e do backend
console.log('2️⃣  Teste: Remoção de "Diretoria" dos Vendedores Operacionais');
const jsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'crm.js'), 'utf-8');
const routesContent = fs.readFileSync(path.join(__dirname, 'crm_routes.js'), 'utf-8');

// DEFAULT_VENDEDORES não deve conter 'Diretoria'
const defaultVendMatch = jsContent.match(/const DEFAULT_VENDEDORES = \[([\s\S]*?)\];/);
assert.ok(defaultVendMatch, 'DEFAULT_VENDEDORES deve existir em crm.js');
assert.ok(!defaultVendMatch[1].includes("'Diretoria'"), 'DEFAULT_VENDEDORES não pode conter Diretoria');

// crm_routes.js não deve retornar Diretoria no GET /vendedores
const routesVendMatch = routesContent.match(/router\.get\('\/vendedores'[\s\S]*?data: \[([\s\S]*?)\]/);
assert.ok(routesVendMatch, 'GET /vendedores deve existir em crm_routes.js');
assert.ok(!routesVendMatch[1].includes("'Diretoria'"), 'Endpoint de vendedores não pode conter Diretoria');

// selectFilter no crm.js filtra 'diretoria'
assert.ok(jsContent.includes("nomesVendedores.filter(v => String(v).trim().toLowerCase() !== 'diretoria')"),
          'loadVendedoresOptions deve filtrar Diretoria do selectFilter');
console.log('   ✅ Opção Diretoria removida de todos os seletores de vendedores operacionais.');

// 3. Teste Funcional: Mapeamento de data_fechamento_real
console.log('3️⃣  Teste: Mapeamento de data_fechamento_real em mapDealFromApi');
assert.ok(jsContent.includes('dataFechamentoReal: d.data_fechamento_real || d.dataFechamentoReal || null'),
          'mapDealFromApi deve mapear dataFechamentoReal');
console.log('   ✅ dataFechamentoReal mapeado com resiliência.');

// 4. Teste Anti-Phantom: Execução da LÓGICA REAL extraída de public/js/crm.js
console.log('4️⃣  Teste Anti-Phantom: Execução da Lógica Real de getFilteredDeals() de crm.js');

const matchFn = jsContent.match(/function getFilteredDeals\(\)\s*\{([\s\S]*?)\r?\n\s*\}\r?\n\s*\/\*\*/);
assert.ok(matchFn && matchFn[1], 'A função getFilteredDeals() deve ser extraída com sucesso de public/js/crm.js');

const executeRealGetFilteredDeals = (dealsList, statusVal, vendedorVal = 'TODOS', textVal = '') => {
  const fakeDoc = {
    getElementById: (id) => {
      if (id === 'crmSearchInput') return { value: textVal };
      if (id === 'crmFilterVendedor') return { value: vendedorVal };
      if (id === 'crmFilterStatus') return { value: statusVal };
      return null;
    }
  };
  const runner = new Function('deals', 'document', matchFn[1]);
  return runner(dealsList, fakeDoc);
};

// Preparação das datas de hoje, ontem e anteontem
const agora = new Date();
const formatBrHoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
const ontemData = new Date(agora);
ontemData.setDate(ontemData.getDate() - 1);
const anteontemData = new Date(agora);
anteontemData.setDate(anteontemData.getDate() - 2);

// Formato YYYY-MM-DD local para teste do Timezone Shift
const pad = (n) => String(n).padStart(2, '0');
const hojeDateOnly = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
const ontemDateOnly = `${ontemData.getFullYear()}-${pad(ontemData.getMonth() + 1)}-${pad(ontemData.getDate())}`;

const mockDeals = [
  { id: '1', titulo: 'Lead Novo', fase: 'LEAD', vendedor: 'Alexandre' },
  { id: '2', titulo: 'Contato Feito', fase: 'CONTATO', vendedor: 'Juliana' },
  { id: '3', titulo: 'Proposta Enviada', fase: 'PROPOSTA', vendedor: 'Andrea' },
  { id: '4', titulo: 'Negociação Quente', fase: 'NEGOCIACAO', vendedor: 'Figueiredo' },
  { id: '5', titulo: 'Venda Hoje ISO', fase: 'GANHO', vendedor: 'Alexandre', dataFechamentoReal: agora.toISOString() },
  { id: '6', titulo: 'Venda Hoje DateOnly', fase: 'GANHO', vendedor: 'Alexandre', dataFechamentoReal: hojeDateOnly },
  { id: '7', titulo: 'Venda Ontem ISO', fase: 'GANHO', vendedor: 'Juliana', dataFechamentoReal: ontemData.toISOString() },
  { id: '8', titulo: 'Venda Ontem DateOnly', fase: 'GANHO', vendedor: 'Juliana', dataFechamentoReal: ontemDateOnly },
  { id: '9', titulo: 'Venda Antiga', fase: 'GANHO', vendedor: 'Andrea', dataFechamentoReal: anteontemData.toISOString() },
  { id: '10', titulo: 'Negócio Perdido', fase: 'PERDIDO', vendedor: 'Figueiredo' }
];

// Bateria 4.1: Oportunidades Abertas (deve trazer LEAD, CONTATO, PROPOSTA, NEGOCIACAO = 4 deals)
const resAbertas = executeRealGetFilteredDeals(mockDeals, 'ABERTAS');
assert.strictEqual(resAbertas.length, 4, 'ABERTAS deve retornar exatamente 4 deals abertos');
assert.ok(resAbertas.every(d => d.fase !== 'GANHO' && d.fase !== 'PERDIDO'), 'Nenhum ganho ou perdido em ABERTAS');
console.log('   ✅ Filtro REAL "Oportunidades Abertas" validado (exclui ganhos e perdidos).');

// Bateria 4.2: Retrocompatibilidade com valor ATIVOS
const resAtivos = executeRealGetFilteredDeals(mockDeals, 'ATIVOS');
assert.strictEqual(resAtivos.length, 4, 'ATIVOS legado deve ter o mesmo comportamento de ABERTAS');
console.log('   ✅ Retrocompatibilidade de "ATIVOS" confirmada.');

// Bateria 4.3: Somente Ganhas (deve trazer todas as 5 ganhas)
const resGanhos = executeRealGetFilteredDeals(mockDeals, 'GANHO');
assert.strictEqual(resGanhos.length, 5, 'GANHO deve retornar os 5 deals ganhos');
assert.ok(resGanhos.every(d => d.fase === 'GANHO'), 'Todos os retornados devem ser GANHO');
console.log('   ✅ Filtro REAL "Somente Ganhas" validado.');

// Bateria 4.4: Ganhas Hoje (com proteção contra Timezone Shift UTC-3)
const resGanhasHoje = executeRealGetFilteredDeals(mockDeals, 'GANHO_HOJE');
assert.strictEqual(resGanhasHoje.length, 2, 'GANHO_HOJE deve retornar exatamente os 2 deals de hoje (ISO e DateOnly)');
console.log('   ✅ Filtro REAL "Ganhas Hoje" validado com suporte tanto a ISO timestamp quanto DateOnly.');

// Bateria 4.5: Ganhas Ontem (com proteção contra Timezone Shift UTC-3)
const resGanhasOntem = executeRealGetFilteredDeals(mockDeals, 'GANHO_ONTEM');
assert.strictEqual(resGanhasOntem.length, 2, 'GANHO_ONTEM deve retornar exatamente os 2 deals de ontem (ISO e DateOnly)');
console.log('   ✅ Filtro REAL "Ganhas Ontem" validado com suporte tanto a ISO timestamp quanto DateOnly.');

// Bateria 4.6: Somente Perdidos
const resPerdidos = executeRealGetFilteredDeals(mockDeals, 'PERDIDO');
assert.strictEqual(resPerdidos.length, 1, 'PERDIDO deve retornar exatamente 1 deal');
assert.strictEqual(resPerdidos[0].fase, 'PERDIDO');
console.log('   ✅ Filtro REAL "Somente Perdidos" validado.');

// Bateria 4.7: Todas as oportunidades
const resTodos = executeRealGetFilteredDeals(mockDeals, 'TODOS');
assert.strictEqual(resTodos.length, 10, 'TODOS deve retornar todos os 10 deals cadastrados');
console.log('   ✅ Filtro REAL "Todas" validado.');

// Bateria 4.8: Combinação de Vendedor + Status Abertas
const resAlexandreAbertas = executeRealGetFilteredDeals(mockDeals, 'ABERTAS', 'Alexandre');
assert.strictEqual(resAlexandreAbertas.length, 1, 'Alexandre deve possuir 1 deal em aberto');
assert.strictEqual(resAlexandreAbertas[0].titulo, 'Lead Novo');
console.log('   ✅ Combinação de filtro de vendedor + status validada com o código real.');

// 5. Teste: Reset do botão #btnCrmLimparFiltros
console.log('5️⃣  Teste: Reset de Filtros');
assert.ok(jsContent.includes("filterStatus.value = 'ABERTAS'"),
          'Ao limpar filtros, status deve ser resetado para ABERTAS');
console.log('   ✅ Reset para "ABERTAS" confirmado.');

console.log('\n🎉 TODOS OS TESTES DOS NOVOS FILTROS DO CRM COMERCIAL FORAM APROVADOS COM 100% DE SUCESSO!\n');
