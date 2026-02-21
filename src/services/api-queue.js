/**
 * api-queue.js — Fila global de requisições à API Tiny ERP
 * 
 * Implementa:
 *  - Fila FIFO com semáforo (máx 1 req a cada 2.1s globalmente)
 *  - Retry com backoff exponencial (base 3: 3s → 9s → 27s)
 *  - Circuit breaker (CLOSED → OPEN → HALF-OPEN)
 * 
 * Uso:
 *   const { apiQueue } = require('./api-queue');
 *   const result = await apiQueue.enqueue(() => axios.post(url, data));
 */

const logger = require('../utils/logger');

const RATE_LIMIT_MS = 2100; // 2.1s entre chamadas
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 3000; // 3s base, exponencial base 3

// Erros que justificam retry
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// Erros definitivos — não fazer retry
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404]);

// ═══════════════════════════════════════════════
// Circuit Breaker
// ═══════════════════════════════════════════════

const CircuitState = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN',
};

class CircuitBreaker {
    constructor({ failureThreshold = 5, resetTimeoutMs = 60000 } = {}) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.failureThreshold = failureThreshold;
        this.resetTimeoutMs = resetTimeoutMs;
        this.nextAttemptTime = null;
    }

    canExecute() {
        if (this.state === CircuitState.CLOSED) {
            return true;
        }

        if (this.state === CircuitState.OPEN) {
            if (Date.now() >= this.nextAttemptTime) {
                this.state = CircuitState.HALF_OPEN;
                logger.info('🔌 Circuit breaker → HALF_OPEN (testando conexão)');
                return true;
            }
            return false;
        }

        // HALF_OPEN — permite 1 requisição de teste
        return true;
    }

    recordSuccess() {
        if (this.state === CircuitState.HALF_OPEN) {
            logger.info('🔌 Circuit breaker → CLOSED (conexão restaurada)');
        }
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.nextAttemptTime = null;
    }

    recordFailure() {
        this.failureCount++;

        if (this.state === CircuitState.HALF_OPEN) {
            // Teste falhou — voltar a OPEN
            this.state = CircuitState.OPEN;
            this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
            logger.warn(`🔌 Circuit breaker → OPEN (teste falhou, próximo em ${this.resetTimeoutMs / 1000}s)`);
            return;
        }

        if (this.failureCount >= this.failureThreshold) {
            this.state = CircuitState.OPEN;
            this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
            logger.warn(`🔌 Circuit breaker → OPEN (${this.failureCount} falhas consecutivas, bloqueado por ${this.resetTimeoutMs / 1000}s)`);
        }
    }

    getStatus() {
        const remainingMs = this.nextAttemptTime
            ? Math.max(0, this.nextAttemptTime - Date.now())
            : 0;

        return {
            state: this.state,
            failureCount: this.failureCount,
            failureThreshold: this.failureThreshold,
            remainingBlockMs: remainingMs,
        };
    }

    getBlockMessage() {
        const remaining = Math.ceil((this.nextAttemptTime - Date.now()) / 1000);
        return `API Tiny indisponível, tente novamente em ${remaining} segundos`;
    }
}

// ═══════════════════════════════════════════════
// API Queue
// ═══════════════════════════════════════════════

class ApiQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastRequestTime = 0;
        this.circuitBreaker = new CircuitBreaker();
    }

    /**
     * Enfileira uma função para execução com rate limiting, retry e circuit breaker.
     * 
     * @param {Function} fn - Função async que faz a chamada à API (recebe { signal } como argumento)
     * @param {object} [options] - Opções
     * @param {boolean} [options.skipRetry=false] - Se true, não faz retry em caso de erro
     * @returns {Promise<any>} - Resultado da função
     */
    enqueue(fn, options = {}) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, options, resolve, reject });

            if (this.queue.length === 1) {
                logger.info(`📋 Fila API: 1 requisição pendente`);
            } else {
                logger.info(`📋 Fila API: ${this.queue.length} requisições pendentes (~${((this.queue.length - 1) * RATE_LIMIT_MS / 1000).toFixed(0)}s de espera)`);
            }

            this._processNext();
        });
    }

    async _processNext() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        const { fn, options, resolve, reject } = this.queue.shift();

        try {
            // Verificar circuit breaker
            if (!this.circuitBreaker.canExecute()) {
                throw new ApiQueueError(
                    this.circuitBreaker.getBlockMessage(),
                    'CIRCUIT_OPEN'
                );
            }

            // Rate limiting — esperar se necessário
            const elapsed = Date.now() - this.lastRequestTime;
            if (elapsed < RATE_LIMIT_MS) {
                const waitTime = RATE_LIMIT_MS - elapsed;
                await new Promise(r => setTimeout(r, waitTime));
            }

            // Executar com retry
            const result = await this._executeWithRetry(fn, options);
            this.circuitBreaker.recordSuccess();
            this.lastRequestTime = Date.now();
            resolve(result);

        } catch (error) {
            // Se não foi erro de circuit breaker, registrar falha
            if (!(error instanceof ApiQueueError && error.code === 'CIRCUIT_OPEN')) {
                this.circuitBreaker.recordFailure();
            }
            this.lastRequestTime = Date.now();
            reject(error);

        } finally {
            this.processing = false;
            // Processar próximo item da fila
            if (this.queue.length > 0) {
                setImmediate(() => this._processNext());
            }
        }
    }

    async _executeWithRetry(fn, options = {}) {
        const maxAttempts = options.skipRetry ? 1 : MAX_RETRIES + 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const controller = new AbortController();
                const result = await fn({ signal: controller.signal });
                return result;

            } catch (error) {
                const status = error.response?.status;
                const isLastAttempt = attempt >= maxAttempts;
                const isRetryable = !NON_RETRYABLE_STATUS.has(status) && (
                    RETRYABLE_STATUS.has(status) ||
                    error.code === 'ECONNABORTED' ||
                    error.code === 'ETIMEDOUT' ||
                    error.code === 'ECONNRESET' ||
                    !status // Network errors without status
                );

                if (isLastAttempt || !isRetryable || options.skipRetry) {
                    throw error;
                }

                // Backoff exponencial: 3s → 9s → 27s
                const backoffMs = RETRY_BASE_MS * Math.pow(3, attempt - 1);
                logger.warn(`🔄 Retry ${attempt}/${MAX_RETRIES} — erro: ${error.message} — aguardando ${backoffMs / 1000}s`);
                await new Promise(r => setTimeout(r, backoffMs));
            }
        }
    }

    /**
     * Retorna o status atual da fila e do circuit breaker.
     */
    getStatus() {
        return {
            queueSize: this.queue.length,
            isProcessing: this.processing,
            circuitBreaker: this.circuitBreaker.getStatus(),
        };
    }
}

class ApiQueueError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'ApiQueueError';
        this.code = code;
    }
}

// Singleton
const apiQueue = new ApiQueue();

module.exports = { apiQueue, ApiQueue, ApiQueueError };
