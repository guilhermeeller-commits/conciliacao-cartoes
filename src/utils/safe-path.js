/**
 * safe-path.js — Utilitário para prevenção de path traversal
 * 
 * Valida e constrói caminhos de arquivo de forma segura,
 * garantindo que o caminho resultante esteja dentro do diretório base esperado.
 */

const path = require('path');

/**
 * Constrói um caminho seguro a partir de segmentos, prevenindo path traversal.
 * 
 * @param {string} baseDir - Diretório base permitido (absoluto ou relativo ao cwd)
 * @param {...string} segments - Segmentos do caminho (year, month, banco, filename, etc.)
 * @returns {string} Caminho absoluto seguro
 * @throws {Error} Se algum segmento for inválido ou o caminho resultante sair do baseDir
 */
function safePath(baseDir, ...segments) {
    // Validate each segment individually
    for (const segment of segments) {
        if (typeof segment !== 'string' || segment.length === 0) {
            throw new SafePathError(`Segmento de caminho inválido: valor vazio ou não-string`);
        }

        // Block path traversal patterns
        if (segment.includes('..')) {
            throw new SafePathError(`Segmento de caminho rejeitado (contém ".."): "${segment}"`);
        }
        if (segment.includes('/') || segment.includes('\\')) {
            throw new SafePathError(`Segmento de caminho rejeitado (contém separador): "${segment}"`);
        }
        // Block null bytes
        if (segment.includes('\0')) {
            throw new SafePathError(`Segmento de caminho rejeitado (contém null byte): "${segment}"`);
        }
    }

    // Resolve the base directory to absolute
    const resolvedBase = path.resolve(baseDir);

    // Build the full path
    const fullPath = path.resolve(resolvedBase, ...segments);

    // Verify the resulting path is inside the base directory
    if (!fullPath.startsWith(resolvedBase + path.sep) && fullPath !== resolvedBase) {
        throw new SafePathError(`Caminho resultante fora do diretório permitido: "${fullPath}" não está em "${resolvedBase}"`);
    }

    return fullPath;
}

/**
 * Validators for common parameter formats
 */
const validators = {
    /** Year: exactly 4 digits */
    year(value) {
        if (!/^\d{4}$/.test(value)) {
            throw new SafePathError(`Ano inválido (esperado 4 dígitos): "${value}"`);
        }
        return value;
    },

    /** Month: exactly 2 digits, 01-12 */
    month(value) {
        if (!/^\d{2}$/.test(value)) {
            throw new SafePathError(`Mês inválido (esperado 2 dígitos): "${value}"`);
        }
        const num = parseInt(value, 10);
        if (num < 1 || num > 12) {
            throw new SafePathError(`Mês fora do intervalo (01-12): "${value}"`);
        }
        return value;
    },

    /** Banco: alphanumeric + hyphens + underscores + spaces */
    banco(value) {
        if (!/^[a-zA-Z0-9\-_\s]+$/.test(value)) {
            throw new SafePathError(`Nome de banco inválido (apenas alfanumérico, hífens, underscores): "${value}"`);
        }
        return value;
    },

    /** Filename: must end in .pdf, .xls, or .xlsx */
    filename(value) {
        if (!/\.(pdf|xls|xlsx)$/i.test(value)) {
            throw new SafePathError(`Nome de arquivo inválido (deve terminar em .pdf, .xls ou .xlsx): "${value}"`);
        }
        // Additional check: no path separators in filename
        if (/[/\\]/.test(value)) {
            throw new SafePathError(`Nome de arquivo contém separadores de caminho: "${value}"`);
        }
        return value;
    },
};

/**
 * Custom error class for safe path violations
 */
class SafePathError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SafePathError';
        this.statusCode = 400;
    }
}

module.exports = { safePath, validators, SafePathError };
