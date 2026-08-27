/**
 * circuit_breaker.js
 * 
 * Implementação robusta do Padrão Circuit Breaker com Retries, Backoff Exponencial e Jitter
 * para chamadas externas e integrações bancárias (Banco Inter, Mercado Pago, etc.)
 */

class CircuitBreakerOpenError extends Error {
  constructor(message, metrics) {
    super(message || 'Circuito aberto: chamadas temporariamente bloqueadas para proteger o serviço.');
    this.name = 'CircuitBreakerOpenError';
    this.code = 'CIRCUIT_BREAKER_OPEN';
    this.metrics = metrics;
  }
}

class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {string} options.name Identificador do circuito (ex: 'Inter_14', 'Inter_15')
   * @param {number} options.failureThreshold Número de falhas consecutivas para abrir o circuito (padrão: 4)
   * @param {number} options.recoveryTimeMs Tempo em ms para tentar transição para HALF_OPEN (padrão: 30000ms)
   * @param {number} options.timeoutMs Timeout máximo por tentativa em ms (padrão: 15000ms)
   */
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 4;
    this.recoveryTimeMs = options.recoveryTimeMs || 30000;
    this.timeoutMs = options.timeoutMs || 15000;

    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.consecutiveFailures = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.totalCalls = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.lastStateChange = Date.now();
  }

  /**
   * Verifica se o circuito permite execução no momento
   */
  canExecute() {
    const now = Date.now();

    if (this.state === 'OPEN') {
      if (now - this.lastStateChange >= this.recoveryTimeMs) {
        this.transitionTo('HALF_OPEN');
        return true;
      }
      return false;
    }

    return true; // CLOSED ou HALF_OPEN
  }

  /**
   * Transiciona o estado do circuito
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    console.log(`⚡ [CircuitBreaker:${this.name}] Transição de Estado: ${oldState} ➔ ${newState}`);
  }

  /**
   * Registra uma execução com sucesso
   */
  recordSuccess() {
    this.totalSuccesses++;
    this.totalCalls++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
    }
  }

  /**
   * Registra uma falha
   */
  recordFailure(error) {
    this.totalFailures++;
    this.totalCalls++;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      if (this.state !== 'OPEN') {
        this.transitionTo('OPEN');
      }
    }
  }

  /**
   * Retorna snapshot das métricas atuais do circuito
   */
  getMetrics() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalCalls: this.totalCalls,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      lastSuccessTime: this.lastSuccessTime ? new Date(this.lastSuccessTime).toISOString() : null,
      lastStateChange: new Date(this.lastStateChange).toISOString()
    };
  }

  /**
   * Executa uma função protegida pelo Circuit Breaker com suporte a timeout
   */
  async execute(fn) {
    if (!this.canExecute()) {
      const remainingCooldown = Math.max(0, Math.ceil((this.recoveryTimeMs - (Date.now() - this.lastStateChange)) / 1000));
      throw new CircuitBreakerOpenError(
        `Serviço bancário temporariamente indisponível [${this.name}]. Circuito ABERTO (cooldown restante: ${remainingCooldown}s).`,
        this.getMetrics()
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }
}

/**
 * Classifica se um erro é transitório e elegível para retentativa
 */
function isTransientError(error) {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  const code = String(error.code || '').toUpperCase();

  // Erros de conexão de rede e timeouts
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return true;
  }
  if (msg.includes('timeout') || msg.includes('socket hang up') || msg.includes('econnreset') || msg.includes('network error')) {
    return true;
  }

  // HTTP Status transitórios (429 Rate Limit, 500, 502, 503, 504)
  if (msg.includes('status 429') || msg.includes('status 500') || msg.includes('status 502') || msg.includes('status 503') || msg.includes('status 504')) {
    return true;
  }

  return false;
}

/**
 * Executa uma função assíncrona com política de Retries, Backoff Exponencial e Jitter
 * @param {Function} fn Função a executar
 * @param {Object} options Configurações de Retry
 * @param {number} options.maxRetries Máximo de tentativas adicionais (padrão: 3)
 * @param {number} options.baseDelayMs Delay inicial em ms (padrão: 350ms)
 * @param {number} options.maxDelayMs Delay máximo em ms (padrão: 3000ms)
 * @param {string} options.operationName Nome da operação para logging
 */
async function executeWithRetry(fn, options = {}) {
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
  const baseDelayMs = options.baseDelayMs || 350;
  const maxDelayMs = options.maxDelayMs || 3000;
  const opName = options.operationName || 'Operation';

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      // Se não for transitório ou for a última tentativa, não retenta
      if (!isTransientError(err) || attempt >= maxRetries) {
        throw err;
      }

      // Backoff Exponencial com Jitter: delay = min(maxDelay, baseDelay * 2^attempt) + jitter (0-200ms)
      const exponentialBackoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitter = Math.floor(Math.random() * 200);
      const totalDelay = exponentialBackoff + jitter;

      console.warn(`⚠️ [Retry:${opName}] Tentativa ${attempt + 1}/${maxRetries} falhou (${err.message}). Retentando em ${totalDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }

  throw lastError;
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerOpenError,
  executeWithRetry,
  isTransientError
};
