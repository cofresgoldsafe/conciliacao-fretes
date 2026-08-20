const assert = require('assert');
const http = require('http');
const app = require('./server');
const { saveInterWebhookEvent, getInterWebhookEvents } = require('./postgres_db');

function makeRequest(server, options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function runTestSuite() {
  const runId = 'R' + Date.now() + Math.random().toString(36).substr(2, 4);
  console.log(`🧪 Iniciando Suite Completa (Unitária + HTTP E2E) [${runId}]...\n`);

  // ==========================================
  // PARTE 1: TESTES DE CAMADA DE BANCO (Unitários)
  // ==========================================
  console.log('--- [1/2] Testes Unitários de Persistência e Idempotência ---');

  // 1. Pix Individual
  const pixSingle = {
    endToEndId: `E_${runId}_001`,
    txid: `TX_${runId}_001`,
    valor: '150.00',
    horario: '2026-08-20T12:00:00Z',
    pagador: { nome: 'CLIENTE TESTE MP', cpfCnpj: '00000000000' }
  };
  const res1 = await saveInterWebhookEvent({
    empresaCodigo: '14',
    eventId: pixSingle.endToEndId,
    tipo: 'PIX',
    payload: pixSingle
  });
  assert.strictEqual(res1.success, true, 'Teste 1 Falhou: Erro ao salvar Pix');
  assert.strictEqual(res1.duplicate, undefined, 'Teste 1 Falhou: Primeiro envio não deve ser duplicado');
  console.log('✅ Unit 1: Pix individual persistido com sucesso.');

  // 2. Idempotência Unitária
  const res2 = await saveInterWebhookEvent({
    empresaCodigo: '14',
    eventId: pixSingle.endToEndId,
    tipo: 'PIX',
    payload: pixSingle
  });
  assert.strictEqual(res2.duplicate, true, 'Teste 2 Falhou: Reenvio DEVE ser deduplicado');
  console.log('✅ Unit 2: Idempotência estrita confirmada.');

  // 3. Isolamento Multi-Empresa com o mesmo eventId (14 vs 16)
  const res3 = await saveInterWebhookEvent({
    empresaCodigo: '16',
    eventId: pixSingle.endToEndId,
    tipo: 'PIX',
    payload: { ...pixSingle, pagador: { nome: 'CLIENTE TESTE OACO' } }
  });
  assert.strictEqual(res3.success, true, 'Teste 3 Falhou: Erro ao salvar na Empresa 16');
  assert.strictEqual(res3.duplicate, undefined, 'Teste 3 Falhou: Chave composta por empresa não deve colidir');
  console.log('✅ Unit 3: Isolamento Multi-Empresa validado.');

  // 4. Hash Determinístico para Payloads sem ID
  const noIdPayload = { evento: `Extrato_${runId}`, valor: 88.00 };
  const res4a = await saveInterWebhookEvent({ empresaCodigo: '14', tipo: 'BANKING', payload: noIdPayload });
  const res4b = await saveInterWebhookEvent({ empresaCodigo: '14', tipo: 'BANKING', payload: noIdPayload });
  assert.strictEqual(res4a.success, true);
  assert.strictEqual(res4b.duplicate, true, 'Teste 4 Falhou: Hash SHA-256 deve deduplicar retransmissões');
  console.log('✅ Unit 4: Hash determinístico SHA-256 validado.');

  // ==========================================
  // PARTE 2: TESTES DE INTEGRAÇÃO HTTP (Express Server)
  // ==========================================
  console.log('\n--- [2/2] Testes HTTP End-to-End no Express Server ---');

  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, resolve));

  try {
    // 5. HTTP: POST /api/webhooks/inter/14 (Pix Único)
    const httpRes1 = await makeRequest(testServer, {
      path: '/api/webhooks/inter/14',
      method: 'POST'
    }, {
      endToEndId: `E_HTTP_${runId}_001`,
      valor: '250.00'
    });
    assert.strictEqual(httpRes1.status, 200, 'HTTP 1 Falhou: Status deve ser 200');
    assert.strictEqual(httpRes1.body.received, true);
    assert.strictEqual(httpRes1.body.empresaCodigo, '14');
    assert.strictEqual(httpRes1.body.tipo, 'PIX');
    console.log('✅ HTTP 1: POST /api/webhooks/inter/14 (Pix Único) respondeu 200 OK.');

    // 6. HTTP: POST /api/webhooks/inter/14 com Batch Pix (múltiplas transações)
    const httpRes2 = await makeRequest(testServer, {
      path: '/api/webhooks/inter/14',
      method: 'POST'
    }, {
      pix: [
        { endToEndId: `E_BATCH_${runId}_1`, valor: '10.00' },
        { endToEndId: `E_BATCH_${runId}_2`, valor: '20.00' }
      ]
    });
    assert.strictEqual(httpRes2.status, 200);
    assert.strictEqual(httpRes2.body.totalEvents, 2);
    assert.strictEqual(httpRes2.body.tipo, 'PIX_BATCH');
    console.log('✅ HTTP 2: POST Batch Pix com múltiplos itens processado com sucesso.');

    // 7. HTTP: POST /api/webhooks/inter/14 com array Pix vazio (sem registro fantasma)
    const httpRes3 = await makeRequest(testServer, {
      path: '/api/webhooks/inter/14',
      method: 'POST'
    }, { pix: [] });
    assert.strictEqual(httpRes3.status, 200);
    assert.strictEqual(httpRes3.body.totalEvents, 0);
    console.log('✅ HTTP 3: Array Pix vazio tratado com totalEvents: 0 e sem registros fantasmas.');

    // 8. HTTP: Proteção de Acesso Anônimo / Spoofing em GET /api/financeiro/webhooks
    const httpRes4 = await makeRequest(testServer, {
      path: '/api/financeiro/webhooks',
      method: 'GET',
      headers: { 'x-user-username': 'hacker_anonimo' }
    });
    assert.strictEqual(httpRes4.status, 401, 'HTTP 4 Falhou: Acesso de usuário não cadastrado DEVE retornar 401');
    console.log('✅ HTTP 4: Tentativa de header spoofing bloqueada com 401 Unauthorized.');

    // 9. HTTP: Acesso Autorizado em GET /api/financeiro/webhooks para Administrador
    const httpRes5 = await makeRequest(testServer, {
      path: '/api/financeiro/webhooks?empresa=14',
      method: 'GET',
      headers: { 'x-user-username': 'alexandre' }
    });
    assert.strictEqual(httpRes5.status, 200, 'HTTP 5 Falhou: Usuário alexandre deve ter acesso aos logs');
    assert.strictEqual(httpRes5.body.success, true);
    assert.ok(Array.isArray(httpRes5.body.eventos));
    console.log('✅ HTTP 5: Acesso autorizado a administrador validado com sucesso.');

  } finally {
    testServer.close();
  }

  console.log('\n=============================================================');
  console.log('🎉 TODOS OS TESTES UNITÁRIOS E HTTP E2E PASSARAM COM SUCESSO!');
  console.log('=============================================================');
  process.exit(0);
}

runTestSuite().catch(err => {
  console.error('\n❌ TESTE FALHOU:', err);
  process.exit(1);
});
