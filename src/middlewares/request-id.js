/**
 * request-id.js — Middleware de correlação de exceções
 * 
 * Gera um ID único por requisição (UUID v4 ou recebe via header X-Request-Id).
 * Armazena em AsyncLocalStorage para uso transversal (logs, etc).
 */

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Middleware Express: injeta request ID no contexto
 */
function requestIdMiddleware(req, res, next) {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();

    // Expor no header de resposta
    res.setHeader('X-Request-Id', requestId);

    // Armazenar no request
    req.requestId = requestId;

    // Executar dentro do contexto async
    asyncLocalStorage.run({ requestId }, () => next());
}

/**
 * Retorna o request ID do contexto atual (ou null se fora de request)
 */
function getRequestId() {
    const store = asyncLocalStorage.getStore();
    return store?.requestId || null;
}

module.exports = { requestIdMiddleware, getRequestId, asyncLocalStorage };
