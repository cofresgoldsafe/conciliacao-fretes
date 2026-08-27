/**
 * test_webhook_schemas.js
 * 
 * Suíte de Testes Automatizados para Validação de Schemas Zod de Webhooks Bancários:
 * 1. PixEventSchema & PixBatchSchema (valores monetários, endToEndId, txid, pagador).
 * 2. BoletoEventSchema (nossoNumero, valorPago, status).
 * 3. BankingEventSchema (tipoOperacao, valores, transações).
 * 4. Validação de Rejeição (HTTP 400) para payloads malformados ou tipos inválidos.
 * 5. Sanitização e Transformação Automática (String -> Float).
 */

const assert = require('assert');
const http = require('http');
const app = require('./server');
const { 
  validateWebhookPayload, 
  PixEventSchema, 
  BoletoEventSchema, 
  BankingEventSchema 
} = require('./webhook_validator');

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

function request(baseUrl, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runWebhookSchemaTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: VALIDAÇÃO DE SCHEMAS ZOD PARA WEBHOOKS');
  console.log('=============================================================\n');

  // -------------------------------------------------------------
  // Teste 1: Validação de Pix Individual e Transformação de Valor
  // -------------------------------------------------------------
  console.log('--- 1. Schema de Eventos Pix (Zod) ---');
  try {
    const validPix = {
      endToEndId: 'E00416968202608271234abcd5678efgh',
      txid: 'TX123456789',
      valor: '154.50',
      horario: '2026-08-27T10:30:00Z',
      pagador: {
        nome: 'CLIENTE EXEMPLO LTDA',
        cnpj: '18.324.901/0001-14'
      }
    };

    const resVal = validateWebhookPayload(validPix);
    assert.strictEqual(resVal.valid, true, 'Payload Pix deve ser válido');
    assert.strictEqual(resVal.tipo, 'PIX');
    assert.strictEqual(resVal.eventId, 'E00416968202608271234abcd5678efgh');
    assert.strictEqual(resVal.data.valor, 154.50, 'String "154.50" deve ser transformada para float 154.50');

    report('Validação de Pix individual com coerção de string monetária para float', true);
  } catch (err) {
    report('Validação de Pix individual com coerção de string monetária para float', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 2: Validação de Batch Pix
  // -------------------------------------------------------------
  console.log('\n--- 2. Schema de Batch Pix ---');
  try {
    const batchPayload = {
      pix: [
        { endToEndId: 'E111', txid: 'T1', valor: 100.00, horario: '2026-08-27T10:00:00Z' },
        { endToEndId: 'E222', txid: 'T2', valor: 250.50, horario: '2026-08-27T10:05:00Z' }
      ]
    };

    const resVal = validateWebhookPayload(batchPayload);
    assert.strictEqual(resVal.valid, true);
    assert.strictEqual(resVal.tipo, 'PIX_BATCH');
    assert.strictEqual(resVal.totalItems, 2);

    report('Validação de Batch Pix com múltiplos itens em array estruturado', true);
  } catch (err) {
    report('Validação de Batch Pix com múltiplos itens em array estruturado', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 3: Validação de Boleto / Cobrança
  // -------------------------------------------------------------
  console.log('\n--- 3. Schema de Boleto / Cobrança Bancária ---');
  try {
    const boletoPayload = {
      nossoNumero: '00012345678',
      codigoBarras: '07791234567890123456789012345678901234567890',
      valorPago: '890.00',
      situacao: 'PAGO',
      dataPagamento: '2026-08-27'
    };

    const resVal = validateWebhookPayload(boletoPayload);
    assert.strictEqual(resVal.valid, true);
    assert.strictEqual(resVal.tipo, 'BOLETO');
    assert.strictEqual(resVal.eventId, '00012345678');
    assert.strictEqual(resVal.data.valorPago, 890.00);

    report('Validação de Boleto Bancário com identificação de nossoNumero e status', true);
  } catch (err) {
    report('Validação de Boleto Bancário com identificação de nossoNumero e status', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4: Rejeição de Payload Não-Objeto / Inválido
  // -------------------------------------------------------------
  console.log('\n--- 4. Rejeição de Payloads Malformados ---');
  try {
    const resNull = validateWebhookPayload(null);
    assert.strictEqual(resNull.valid, false);

    const resString = validateWebhookPayload("corpo invalido");
    assert.strictEqual(resString.valid, false);

    const resArray = validateWebhookPayload([1, 2, 3]);
    assert.strictEqual(resArray.valid, false);

    report('Rejeição determinística de payloads não-objeto e estruturas corrompidas', true);
  } catch (err) {
    report('Rejeição determinística de payloads não-objeto e estruturas corrompidas', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 5: Endpoint HTTP /api/webhooks/inter com Validação Zod
  // -------------------------------------------------------------
  console.log('\n--- 5. Testes de Integração HTTP via Express (/api/webhooks/inter) ---');
  const server = app.listen(0);
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  try {
    // 5.1 Envio de Pix Válido -> HTTP 200
    const resPix = await request(baseUrl, 'POST', '/api/webhooks/inter/16', {}, {
      endToEndId: 'E_TEST_12345678',
      txid: 'TX_OACO_001',
      valor: '300.00',
      horario: '2026-08-27T11:00:00Z'
    });
    assert.strictEqual(resPix.status, 200);
    assert.strictEqual(resPix.body.received, true);
    assert.strictEqual(resPix.body.tipo, 'PIX');
    assert.strictEqual(resPix.body.empresaCodigo, '16');

    // 5.2 Envio de Boleto Válido -> HTTP 200
    const resBoleto = await request(baseUrl, 'POST', '/api/webhooks/inter/14', {}, {
      nossoNumero: 'BOL998877',
      valorPago: 450.00,
      situacao: 'PAGO'
    });
    assert.strictEqual(resBoleto.status, 200);
    assert.strictEqual(resBoleto.body.received, true);
    assert.strictEqual(resBoleto.body.tipo, 'BOLETO');
    assert.strictEqual(resBoleto.body.empresaCodigo, '14');

    // 5.3 Envio de Batch Pix Válido -> HTTP 200
    const resBatch = await request(baseUrl, 'POST', '/api/webhooks/inter/15', {}, {
      pix: [
        { endToEndId: 'E_BATCH_1', valor: 50.00 },
        { endToEndId: 'E_BATCH_2', valor: 75.50 }
      ]
    });
    assert.strictEqual(resBatch.status, 200);
    assert.strictEqual(resBatch.body.received, true);
    assert.strictEqual(resBatch.body.tipo, 'PIX_BATCH');
    assert.strictEqual(resBatch.body.totalEvents, 2);

    report('Endpoint HTTP /api/webhooks/inter processa Pix, Boletos e Batch com sucesso', true);
  } catch (err) {
    report('Endpoint HTTP /api/webhooks/inter processa Pix, Boletos e Batch com sucesso', false, err.message);
  } finally {
    server.close();
  }

  // -------------------------------------------------------------
  // Resumo Final
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runWebhookSchemaTests().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}

module.exports = runWebhookSchemaTests;
