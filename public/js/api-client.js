/**
 * api-client.js — Cliente HTTP com CSRF automático
 * 
 * Gerencia token CSRF e padroniza chamadas fetch ao backend.
 * Inclui tratamento de erros padronizado e retry de CSRF expirado.
 * 
 * Uso:
 *   const api = window.apiClient;
 *   const data = await api.post('/api/reconciliation/upload', formData);
 *   const list = await api.get('/api/card-statements');
 */

(function () {
    'use strict';

    let csrfToken = null;
    let csrfFetchPromise = null;

    /**
     * Obtém (ou renova) o token CSRF do backend.
     */
    async function fetchCsrfToken() {
        // Evitar múltiplas chamadas simultâneas
        if (csrfFetchPromise) return csrfFetchPromise;

        csrfFetchPromise = (async () => {
            try {
                const res = await fetch('/api/csrf-token', { credentials: 'same-origin' });
                if (!res.ok) throw new Error(`CSRF token fetch failed: ${res.status}`);
                const data = await res.json();
                csrfToken = data.csrfToken;
                return csrfToken;
            } finally {
                csrfFetchPromise = null;
            }
        })();

        return csrfFetchPromise;
    }

    /**
     * Garante que o token CSRF está disponível.
     */
    async function ensureCsrfToken() {
        if (!csrfToken) {
            await fetchCsrfToken();
        }
        return csrfToken;
    }

    /**
     * Faz uma requisição fetch com CSRF automático.
     * Retenta automaticamente se o token expirar (403 CSRF_INVALID).
     */
    async function request(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);

        // Montar headers
        const headers = { ...(options.headers || {}) };

        if (needsCsrf) {
            const token = await ensureCsrfToken();
            headers['X-CSRF-Token'] = token;
        }

        // Se não é FormData, adicionar Content-Type
        if (!(options.body instanceof FormData) && options.body && typeof options.body === 'object') {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }

        const fetchOptions = {
            ...options,
            method,
            headers,
            credentials: 'same-origin',
        };

        let res = await fetch(url, fetchOptions);

        // Se CSRF expirou (403), renovar e retentear 1x
        if (res.status === 403 && needsCsrf) {
            try {
                const errorData = await res.clone().json();
                if (errorData.codigo === 'CSRF_INVALID') {
                    csrfToken = null;
                    const newToken = await fetchCsrfToken();
                    fetchOptions.headers['X-CSRF-Token'] = newToken;
                    res = await fetch(url, fetchOptions);
                }
            } catch (e) {
                // Se não conseguir parsear o JSON, continuar com a resposta original
            }
        }

        // Parsear resposta
        if (!res.ok) {
            let errorData;
            try {
                errorData = await res.json();
            } catch (e) {
                errorData = { erro: res.statusText };
            }

            const error = new Error(errorData.erro || errorData.error || `HTTP ${res.status}`);
            error.status = res.status;
            error.data = errorData;
            throw error;
        }

        // Tentar parsear como JSON
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return await res.json();
        }

        return res;
    }

    // ─── Atalhos ──────────────────────────────────

    const apiClient = {
        get: (url, options = {}) => request(url, { ...options, method: 'GET' }),
        post: (url, body, options = {}) => request(url, { ...options, method: 'POST', body }),
        put: (url, body, options = {}) => request(url, { ...options, method: 'PUT', body }),
        delete: (url, options = {}) => request(url, { ...options, method: 'DELETE' }),

        // Atalho para FormData (sem JSON.stringify)
        postForm: (url, formData, options = {}) => {
            return request(url, {
                ...options,
                method: 'POST',
                body: formData,
                // Não definir Content-Type — o browser define automaticamente com boundary
            });
        },

        /** Forçar renovação do token CSRF */
        refreshCsrfToken: fetchCsrfToken,

        /** Obter token CSRF atual (para uso em formulários inline) */
        getCsrfToken: ensureCsrfToken,
    };

    // Expor globalmente
    window.apiClient = apiClient;

    // ═══════════════════════════════════════════════
    // Interceptador global de fetch
    // Injeta X-CSRF-Token em todas as chamadas POST/PUT/DELETE
    // automaticamente — compatível com código legado inline.
    // ═══════════════════════════════════════════════
    const originalFetch = window.fetch;
    window.fetch = async function (url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);

        if (needsCsrf) {
            const token = await ensureCsrfToken();
            if (token) {
                // Suporta Headers object ou plain object
                if (options.headers instanceof Headers) {
                    if (!options.headers.has('X-CSRF-Token')) {
                        options.headers.set('X-CSRF-Token', token);
                    }
                } else {
                    options.headers = options.headers || {};
                    if (!options.headers['X-CSRF-Token'] && !options.headers['x-csrf-token']) {
                        options.headers['X-CSRF-Token'] = token;
                    }
                }
            }
        }

        const response = await originalFetch.call(window, url, options);

        // Se CSRF expirou (403), renovar token e retentear 1x
        if (response.status === 403 && needsCsrf) {
            try {
                const cloned = response.clone();
                const errorData = await cloned.json();
                if (errorData.codigo === 'CSRF_INVALID') {
                    csrfToken = null;
                    const newToken = await fetchCsrfToken();
                    if (options.headers instanceof Headers) {
                        options.headers.set('X-CSRF-Token', newToken);
                    } else {
                        options.headers['X-CSRF-Token'] = newToken;
                    }
                    return originalFetch.call(window, url, options);
                }
            } catch (e) {
                // Se não parsear JSON, retornar resposta original
            }
        }

        return response;
    };

    // Pre-fetch CSRF token na carga da página
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => fetchCsrfToken());
    } else {
        fetchCsrfToken();
    }
})();

