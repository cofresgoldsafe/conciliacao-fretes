/**
 * test_resilience_sre.js
 * 
 * Suíte de Testes Automatizados para:
 * 1. Eliminação de Concorrência em Arquivos JSON (safe_json_storage.js).
 * 2. Circuit Breaker & Retries com Backoff Exponencial e Jitter (circuit_breaker.js & inter_api.js).
 * 3. Event Delegation e Gestão de Memória no Frontend (public/app.js).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { safeWriteJson, safeWriteJsonSync, safeReadJson, safeReadJsonSync } = require('./safe_json_storage');
const { CircuitBreaker, CircuitBreakerOpenError, executeWithRetry, isTransientError } = require('./circuit_breaker');
const { getCircuitBreakersStatus, getInterCircuitBreaker } = require('./inter_api');

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

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: RESILIÊNCIA, SRE & PERSISTÊNCIA');
  console.log('=============================================================\n');

  // -------------------------------------------------------------
  // Teste 1: safe_json_storage - Concorrência e Gravações Atômicas
  // -------------------------------------------------------------
  console.log('--- 1. Persistência Segura & Concorrência JSON (safe_json_storage) ---');
  const testJsonPath = path.join(__dirname, 'data', '.test_concurrency.json');
  try {
    // Limpa arquivo prévio
    if (fs.existsSync(testJsonPath)) fs.unlinkSync(testJsonPath);

    // Dispara 50 gravações concorrentes simultâneas
    const writePromises = [];
    for (let i = 1; i <= 50; i++) {
      writePromises.push(
        safeWriteJson(testJsonPath, {
          counter: i,
          timestamp: Date.now(),
          payload: `Operação Concorrente #${i}`
        })
      );
    }

    await Promise.all(writePromises);

    // Lê o resultado final
    const finalData = safeReadJsonSync(testJsonPath);
    assert.ok(finalData !== null, 'Arquivo JSON deve existir e conter dados válidos');
    assert.ok(typeof finalData.counter === 'number', 'Contador deve ser numérico');
    assert.strictEqual(finalData.counter, 50, 'A última operação enfileirada (50) deve ser o estado final consistente');

    // Valida que nenhum arquivo temporário (.tmp.*) ficou órfão
    const dataDirFiles = fs.readdirSync(path.join(__dirname, 'data'));
    const orphanedTemps = dataDirFiles.filter(f => f.includes('.test_concurrency.json.tmp'));
    assert.strictEqual(orphanedTemps.length, 0, 'Nenhum arquivo temporário deve restar no diretório');

    report('50 gravações concorrentes serializadas com atomicidade sem corrupção de JSON', true);
  } catch (err) {
    report('50 gravações concorrentes serializadas com atomicidade sem corrupção de JSON', false, err.message);
  } finally {
    try {
      if (fs.existsSync(testJsonPath)) fs.unlinkSync(testJsonPath);
    } catch {}
  }

  // -------------------------------------------------------------
  // Teste 2: safe_json_storage - Leitura Resiliente e Fallback
  // -------------------------------------------------------------
  console.log('\n--- 2. Leitura Resiliente com Fallback Seguro ---');
  try {
    const nonExistent = safeReadJsonSync(path.join(__dirname, 'data', 'nao_existe_xyz.json'), { fallback: true });
    assert.deepStrictEqual(nonExistent, { fallback: true }, 'Arquivo inexistente deve retornar defaultValue');

    const corruptPath = path.join(__dirname, 'data', '.test_corrupt.json');
    fs.writeFileSync(corruptPath, '{ json invalido... @#$%', 'utf-8');
    const corruptData = safeReadJsonSync(corruptPath, []);
    assert.deepStrictEqual(corruptData, [], 'JSON corrompido deve retornar defaultValue com aviso gracioso');

    if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
    report('Leitura resiliente trata arquivos inexistentes ou corrompidos com fallback seguro', true);
  } catch (err) {
    report('Leitura resiliente trata arquivos inexistentes ou corrompidos com fallback seguro', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 3: Circuit Breaker - Transições de Estado (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)
  // -------------------------------------------------------------
  console.log('\n--- 3. Padrão Circuit Breaker (Transições de Estado) ---');
  try {
    const cb = new CircuitBreaker({ name: 'Test_Bank_API', failureThreshold: 3, recoveryTimeMs: 150 });
    assert.strictEqual(cb.state, 'CLOSED', 'Estado inicial deve ser CLOSED');

    // Simula 2 falhas (não deve abrir ainda)
    await assert.rejects(cb.execute(() => Promise.reject(new Error('Falha 1'))));
    await assert.rejects(cb.execute(() => Promise.reject(new Error('Falha 2'))));
    assert.strictEqual(cb.state, 'CLOSED', 'Após 2 falhas (< threshold 3), deve permanecer CLOSED');

    // 3ª falha -> deve transicionar para OPEN
    await assert.rejects(cb.execute(() => Promise.reject(new Error('Falha 3'))));
    assert.strictEqual(cb.state, 'OPEN', 'Após 3 falhas consecutivas, circuito deve estar OPEN');

    // Requisição imediata com circuito OPEN deve falhar rápido com CircuitBreakerOpenError
    let threwCircuitOpen = false;
    try {
      await cb.execute(() => Promise.resolve('ok'));
    } catch (e) {
      if (e instanceof CircuitBreakerOpenError) threwCircuitOpen = true;
    }
    assert.ok(threwCircuitOpen, 'Chamada com circuito OPEN deve lançar CircuitBreakerOpenError imediatamente');

    // Aguarda período de cooldown para testar transição HALF_OPEN
    await new Promise(r => setTimeout(r, 180));
    assert.strictEqual(cb.canExecute(), true, 'Após recoveryTimeMs, canExecute deve permitir tentativa');
    assert.strictEqual(cb.state, 'HALF_OPEN', 'Circuito deve ter transicionado para HALF_OPEN');

    // Execução com sucesso em HALF_OPEN restaura circuito para CLOSED
    const canaryResult = await cb.execute(() => Promise.resolve('Canary OK'));
    assert.strictEqual(canaryResult, 'Canary OK');
    assert.strictEqual(cb.state, 'CLOSED', 'Sucesso no teste de sondagem deve restaurar circuito para CLOSED');
    assert.strictEqual(cb.consecutiveFailures, 0, 'Falhas consecutivas devem ser resetadas para 0');

    report('Ciclo de vida completo do Circuit Breaker validado (CLOSED ➔ OPEN ➔ HALF_OPEN ➔ CLOSED)', true);
  } catch (err) {
    report('Ciclo de vida completo do Circuit Breaker validado (CLOSED ➔ OPEN ➔ HALF_OPEN ➔ CLOSED)', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4: Retry com Backoff Exponencial e Classificação de Erros
  // -------------------------------------------------------------
  console.log('\n--- 4. Política de Retries Inteligentes & Backoff Exponencial ---');
  try {
    // 1. Classificador de erros transitórios
    assert.strictEqual(isTransientError(new Error('Timeout ao consultar saldo')), true, 'Timeout é transitório');
    assert.strictEqual(isTransientError(new Error('Erro HTTP Status 503 Service Unavailable')), true, 'Status 503 é transitório');
    assert.strictEqual(isTransientError(new Error('Erro HTTP Status 429 Too Many Requests')), true, 'Status 429 é transitório');
    assert.strictEqual(isTransientError(new Error('Erro HTTP Status 400 Bad Request')), false, 'Status 400 NÃO é transitório');
    assert.strictEqual(isTransientError(new Error('Erro HTTP Status 401 Unauthorized')), false, 'Status 401 NÃO é transitório');

    // 2. Execução com recuperação em retry
    let callCount = 0;
    const retryResult = await executeWithRetry(async (attempt) => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`Timeout simulado na tentativa ${attempt + 1}`);
      }
      return 'Recuperado com Sucesso!';
    }, { maxRetries: 3, baseDelayMs: 20, operationName: 'TesteRetry' });

    assert.strictEqual(retryResult, 'Recuperado com Sucesso!');
    assert.strictEqual(callCount, 3, 'Deve ter executado 3 tentativas até o sucesso');

    // 3. Erro não transitório deve falhar imediatamente sem retentar
    let nonTransientCalls = 0;
    await assert.rejects(
      executeWithRetry(async () => {
        nonTransientCalls++;
        throw new Error('Status 401: Token expirado ou credencial inválida');
      }, { maxRetries: 3, baseDelayMs: 20, operationName: 'TesteAuthFail' })
    );
    assert.strictEqual(nonTransientCalls, 1, 'Erro 401 deve falhar na 1ª tentativa sem retries desnecessários');

    report('Retries com backoff executam apenas para falhas transitórias e respeitam limites', true);
  } catch (err) {
    report('Retries com backoff executam apenas para falhas transitórias e respeitam limites', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 5: Integração em inter_api.js e Métricas de Observabilidade
  // -------------------------------------------------------------
  console.log('\n--- 5. Observabilidade & Circuit Breakers em inter_api.js ---');
  try {
    const metrics = getCircuitBreakersStatus();
    assert.ok(metrics['14'] !== undefined, 'Circuito Empresa 14 (Metal Pleno) deve existir');
    assert.ok(metrics['15'] !== undefined, 'Circuito Empresa 15 (GSI) deve existir');
    assert.ok(metrics['16'] !== undefined, 'Circuito Empresa 16 (OACO) deve existir');
    assert.strictEqual(metrics['14'].state, 'CLOSED', 'Estado inicial da Empresa 14 deve ser CLOSED');

    const cb14 = getInterCircuitBreaker('14');
    assert.ok(cb14 instanceof CircuitBreaker, 'getInterCircuitBreaker deve retornar instância de CircuitBreaker');

    report('inter_api.js exporta métricas de observabilidade e circuitos isolados por empresa', true);
  } catch (err) {
    report('inter_api.js exporta métricas de observabilidade e circuitos isolados por empresa', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 6: Event Delegation no Frontend (public/app.js)
  // -------------------------------------------------------------
  console.log('\n--- 6. Verificação de Código Frontend: Event Delegation em public/app.js ---');
  try {
    const appJsContent = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');

    assert.ok(appJsContent.includes("usersTableBody.addEventListener('click'"), 'usersTableBody deve usar Event Delegation');
    assert.ok(appJsContent.includes("vendPedidosTableBody.addEventListener('click'"), 'vendPedidosTableBody deve usar Event Delegation');
    assert.ok(appJsContent.includes("pedidosAbertosTableBody.addEventListener('click'"), 'pedidosAbertosTableBody deve usar Event Delegation');
    assert.ok(appJsContent.includes("historicoCreditoTableBody.addEventListener('click'"), 'historicoCreditoTableBody deve usar Event Delegation');
    assert.ok(appJsContent.includes("estoqueTableBody.addEventListener('click'"), 'estoqueTableBody deve usar Event Delegation');

    report('public/app.js adota Event Delegation centralizado eliminando listeners redundantes', true);
  } catch (err) {
    report('public/app.js adota Event Delegation centralizado eliminando listeners redundantes', false, err.message);
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
