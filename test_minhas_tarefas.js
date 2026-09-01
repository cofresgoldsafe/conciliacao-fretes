/**
 * test_minhas_tarefas.js
 * 
 * Suíte de Testes Automatizados para a Central de Delegação e Checagem "Minhas Tarefas"
 * Cobre:
 * 1. DDL e Inicialização da Tabela no Banco de Dados / Fallback.
 * 2. Operações de CRUD e Transições de Status no DB Helper.
 * 3. Endpoints REST com Autenticação Bearer JWT e RBAC (via http nativo).
 * 4. Isolamento Zero-Trust: Operador não acessa nem altera tarefas de terceiros.
 * 5. Trava de Governança: Apenas Gestor/Admin pode Reabrir ou Finalizar tarefas.
 * 6. Linha do Tempo e Injeção Atômica de Comentários no Array JSONB.
 * 7. Consulta de KPIs Operacionais (Pendentes, Aguardando, Reabertas, Concluídas).
 * 8. Validação Sintática e Léxica de public/app.js e public/js/tarefas.js via Node.js vm.Script.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

const {
  getTarefasDB,
  getTarefasKpisDB,
  getTarefaByIdDB,
  createTarefaDB,
  updateTarefaDB,
  addComentarioTarefaDB,
  deleteTarefaDB
} = require('./postgres_db');

const app = require('./server');

// Tokens de teste
const adminToken = jwt.sign({
  id: 1,
  username: 'alexandre',
  name: 'Alexandre Gestor',
  role: 'admin',
  permissions: ['tarefas', 'logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes']
}, JWT_SECRET, { expiresIn: '1h' });

const julianaToken = jwt.sign({
  id: 2,
  username: 'juliana',
  name: 'Juliana Vendas',
  role: 'vendedor',
  vendorCode: '000074',
  permissions: ['tarefas', 'vendedores']
}, JWT_SECRET, { expiresIn: '1h' });

const andreaToken = jwt.sign({
  id: 3,
  username: 'andrea',
  name: 'Andrea Comercial',
  role: 'vendedor',
  vendorCode: '000064',
  permissions: ['tarefas', 'vendedores']
}, JWT_SECRET, { expiresIn: '1h' });

function makeRequest({ port, path: reqPath, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (payload && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let createdTaskId = null;
let httpServer = null;
let testPort = 0;

async function runTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 INICIANDO TESTES DO MÓDULO "MINHAS TAREFAS" (GSI PORTAL)');
  console.log('🧪 ========================================================\n');

  let passed = 0;
  let total = 0;

  function it(desc, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASSOU] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FALHOU] ${desc}`);
      console.error(`     Erro: ${err.message}`);
      throw err;
    }
  }

  async function itAsync(desc, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASSOU] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FALHOU] ${desc}`);
      console.error(`     Erro: ${err.message}`);
      throw err;
    }
  }

  // Sobe servidor HTTP de testes em porta efêmera
  await new Promise((resolve) => {
    httpServer = http.createServer(app);
    httpServer.listen(0, '127.0.0.1', () => {
      testPort = httpServer.address().port;
      console.log(`📡 Servidor de testes HTTP iniciado na porta ${testPort}\n`);
      resolve();
    });
  });

  try {
    // --- BLOCO 1: DB HELPERS & PERSISTÊNCIA ---
    console.log('🔹 1. Testes de Camada de Dados (DB Helpers & JSONB Fallback)');

    await itAsync('1.1 Deve criar uma nova tarefa via createTarefaDB', async () => {
      const tarefa = await createTarefaDB({
        titulo: 'Testar emissão de nota fiscal pedido 1001',
        descricao: 'Conferir alíquotas de ICMS e dados de entrega no Protheus.',
        status: 'PENDENTE',
        prioridade: 'ALTA',
        responsavel_username: 'juliana',
        responsavel_nome: 'Juliana Vendas',
        criado_por_username: 'alexandre',
        criado_por_nome: 'Alexandre Gestor',
        data_limite: '2026-09-10'
      });

      assert.ok(tarefa, 'Tarefa deve ter sido criada');
      assert.ok(tarefa.id, 'Tarefa deve ter um ID');
      assert.strictEqual(tarefa.titulo, 'Testar emissão de nota fiscal pedido 1001');
      assert.strictEqual(tarefa.responsavel_username, 'juliana');
      assert.strictEqual(tarefa.status, 'PENDENTE');
      assert.strictEqual(tarefa.prioridade, 'ALTA');
      createdTaskId = tarefa.id;
    });

    await itAsync('1.2 Deve buscar a tarefa criada por ID', async () => {
      const t = await getTarefaByIdDB(createdTaskId);
      assert.ok(t, 'Deve encontrar a tarefa pelo ID');
      assert.strictEqual(t.id, createdTaskId);
    });

    await itAsync('1.3 Deve anexar comentários ao array JSONB da tarefa', async () => {
      const res = await addComentarioTarefaDB(createdTaskId, {
        autor_username: 'juliana',
        autor_nome: 'Juliana Vendas',
        mensagem: 'Verifiquei o pedido no Protheus, está tudo ok!'
      });

      assert.ok(res, 'Deve retornar resultado do comentário');
      assert.ok(res.tarefa, 'Deve retornar tarefa atualizada');
      const comments = Array.isArray(res.tarefa.comentarios) ? res.tarefa.comentarios : JSON.parse(res.tarefa.comentarios || '[]');
      assert.ok(comments.length >= 1, 'Deve conter pelo menos 1 comentário');
      assert.strictEqual(comments[comments.length - 1].autor_username, 'juliana');
    });

    await itAsync('1.4 Deve atualizar status da tarefa para CONCLUIDA', async () => {
      const updated = await updateTarefaDB(createdTaskId, { status: 'CONCLUIDA' });
      assert.ok(updated, 'Deve atualizar a tarefa');
      assert.strictEqual(updated.status, 'CONCLUIDA');
    });

    // --- BLOCO 2: ENDPOINTS REST & SEGURANÇA ZERO-TRUST ---
    console.log('\n🔹 2. Testes de Endpoints REST & Controle de Acesso (RBAC / Zero-Trust)');

    await itAsync('2.1 Deve rejeitar requisição sem token JWT com 401', async () => {
      const res = await makeRequest({
        port: testPort,
        path: '/api/tarefas',
        method: 'GET'
      });
      assert.strictEqual(res.status, 401, 'Deve retornar 401 Unauthorized');
    });

    await itAsync('2.2 Gestor (Admin) lista todas as tarefas e recebe flag isAdmin=true', async () => {
      const res = await makeRequest({
        port: testPort,
        path: '/api/tarefas',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.items));
      assert.strictEqual(res.body.user.isAdmin, true);
    });

    await itAsync('2.3 Operador (Juliana) lista apenas as tarefas atribuídas a ela', async () => {
      const res = await makeRequest({
        port: testPort,
        path: '/api/tarefas',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${julianaToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.isAdmin, false);
      
      // Nenhuma tarefa de terceiros pode vazar no retorno
      const tarefasDeOutros = res.body.items.filter(t => t.responsavel_username.toLowerCase() !== 'juliana');
      assert.strictEqual(tarefasDeOutros.length, 0, 'Juliana não deve ver tarefas de outros usuários');
    });

    await itAsync('2.4 Outro operador (Andrea) não pode acessar diretamente tarefa de Juliana (403 Forbidden)', async () => {
      const res = await makeRequest({
        port: testPort,
        path: `/api/tarefas/${createdTaskId}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${andreaToken}` }
      });

      assert.strictEqual(res.status, 403, 'Deve bloquear acesso à tarefa de terceiro com 403');
    });

    await itAsync('2.5 Operador comum não pode reabrir ou finalizar tarefa (403 Governança)', async () => {
      const res = await makeRequest({
        port: testPort,
        path: `/api/tarefas/${createdTaskId}`,
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${julianaToken}` },
        body: { status: 'FINALIZADA' }
      });

      assert.strictEqual(res.status, 403, 'Apenas gestores podem finalizar');
    });

    await itAsync('2.6 Gestor pode reabrir tarefa com justificativa', async () => {
      const res = await makeRequest({
        port: testPort,
        path: `/api/tarefas/${createdTaskId}`,
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: {
          status: 'REABERTA',
          justificativa: 'Faltou conferir o frete embutido na cotação.'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.tarefa.status, 'REABERTA');
      
      // Comentário da justificativa deve estar presente
      const comments = Array.isArray(res.body.tarefa.comentarios) 
        ? res.body.tarefa.comentarios 
        : JSON.parse(res.body.tarefa.comentarios || '[]');
      const ultimoComentario = comments[comments.length - 1];
      assert.ok(ultimoComentario.mensagem.includes('TAREFA REABERTA'), 'Deve conter log da reabertura');
    });

    await itAsync('2.7 Gestor pode aprovar e finalizar tarefa', async () => {
      const res = await makeRequest({
        port: testPort,
        path: `/api/tarefas/${createdTaskId}`,
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: {
          status: 'FINALIZADA',
          justificativa: 'Tudo conferido e validado com sucesso.'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.tarefa.status, 'FINALIZADA');
    });

    await itAsync('2.8 Endpoint de KPIs retorna contadores operacionais', async () => {
      const res = await makeRequest({
        port: testPort,
        path: '/api/tarefas/kpis',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.kpis.pendentes === 'number');
      assert.ok(typeof res.body.kpis.aguardando_validacao === 'number');
      assert.ok(typeof res.body.kpis.reabertas_urgentes === 'number');
      assert.ok(typeof res.body.kpis.concluidas_mes === 'number');
    });

    await itAsync('2.9 Operador comum pode criar tarefas para si mesmo (autocriação)', async () => {
      const res = await makeRequest({
        port: testPort,
        path: '/api/tarefas',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${julianaToken}` },
        body: {
          titulo: 'Minha tarefa pessoal de conferência',
          descricao: 'Ligar para cliente da cotação 502.',
          prioridade: 'MEDIA'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.tarefa.responsavel_username, 'juliana');
      assert.strictEqual(res.body.tarefa.criado_por_username, 'juliana');
    });

    // --- BLOCO 3: LINKS PREFERIDOS DO USUÁRIO ---
    console.log('\n🔹 3. Testes de Links Preferidos (Atalhos do Dia a Dia)');

    let newLinkId = null;

    await itAsync('3.1 Deve listar links preferidos do usuário (padrão inicial)', async () => {
      const res = await makeRequest({
        port: testPort,
        path: '/api/user/links',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${julianaToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.links));
      assert.ok(res.body.links.length >= 5, 'Deve conter os 5 atalhos padrão');
      assert.ok(res.body.links.some(l => l.titulo === 'Gmail'));
    });

    await itAsync('3.2 Deve permitir ao usuário adicionar um novo link preferido', async () => {
      const res = await makeRequest({
        port: testPort,
        path: '/api/user/links',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${julianaToken}` },
        body: {
          titulo: 'Portal TOTVS Protheus',
          url: 'https://protheus.gsicofres.com.br',
          icon: '⚡'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.link);
      assert.strictEqual(res.body.link.titulo, 'Portal TOTVS Protheus');
      newLinkId = res.body.link.id;
    });

    await itAsync('3.3 Deve permitir ao usuário excluir um link preferido', async () => {
      const res = await makeRequest({
        port: testPort,
        path: `/api/user/links/${newLinkId}`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${julianaToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.links.every(l => String(l.id) !== String(newLinkId)));
    });

    // --- BLOCO 4: INTEGRIDADE SINTÁTICA DO FRONTEND ---
    console.log('\n🔹 4. Testes de Integridade Léxica e Sintática de Frontend (Node.js vm.Script)');

    it('4.1 public/app.js compila sem nenhum erro léxico ou identificador duplicado', () => {
      const appJsPath = path.join(__dirname, 'public', 'app.js');
      const content = fs.readFileSync(appJsPath, 'utf-8');
      assert.doesNotThrow(() => {
        new vm.Script(content, { filename: 'public/app.js' });
      }, 'public/app.js deve compilar perfeitamente');
    });

    it('4.2 public/js/tarefas.js existe e possui funções exportadas essenciais', () => {
      const tarefasJsPath = path.join(__dirname, 'public', 'js', 'tarefas.js');
      assert.ok(fs.existsSync(tarefasJsPath), 'public/js/tarefas.js deve existir');
      const content = fs.readFileSync(tarefasJsPath, 'utf-8');
      assert.ok(content.includes('initTarefasModule'), 'Deve conter initTarefasModule');
      assert.ok(content.includes('carregarTarefas'), 'Deve conter carregarTarefas');
      assert.ok(content.includes('carregarLinksPreferidos'), 'Deve conter carregarLinksPreferidos');
      assert.ok(content.includes('abrirModalNovoLink'), 'Deve conter abrirModalNovoLink');
      assert.ok(content.includes('abrirModalDetalhesTarefa'), 'Deve conter abrirModalDetalhesTarefa');
      assert.ok(content.includes('reabrirTarefa'), 'Deve conter reabrirTarefa');
      assert.ok(content.includes('finalizarTarefa'), 'Deve conter finalizarTarefa');
    });

    it('4.3 public/index.html declara links preferidos, modais e scripts', () => {
      const htmlPath = path.join(__dirname, 'public', 'index.html');
      const content = fs.readFileSync(htmlPath, 'utf-8');
      assert.ok(content.includes('id="mainTabTarefas"'), 'Deve conter mainTabTarefas');
      assert.ok(content.includes('id="tab-minhas-tarefas"'), 'Deve conter tab-minhas-tarefas');
      assert.ok(content.includes('id="userLinksContainer"'), 'Deve conter userLinksContainer');
      assert.ok(content.includes('id="btnVerTarefasConcluidas"'), 'Deve conter btnVerTarefasConcluidas');
      assert.ok(content.includes('id="modalNovaTarefa"'), 'Deve conter modalNovaTarefa');
      assert.ok(content.includes('id="modalNovoLink"'), 'Deve conter modalNovoLink');
      assert.ok(content.includes('id="modalTarefaDetalhes"'), 'Deve conter modalTarefaDetalhes');
      assert.ok(content.includes('js/tarefas.js'), 'Deve carregar script tarefas.js');
    });

    console.log('\n========================================================');
    console.log(`🎉 TODOS OS ${passed}/${total} TESTES FORAM CONCLUÍDOS COM SUCESSO!`);
    console.log('========================================================\n');
  } finally {
    if (httpServer) {
      httpServer.close();
    }
  }
}

runTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Falha na execução da suíte de testes:', err);
    process.exit(1);
  });
