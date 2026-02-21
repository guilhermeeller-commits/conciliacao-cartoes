/**
 * Database Connection — PostgreSQL via `pg` Pool.
 *
 * Usa a variável de ambiente DATABASE_URL para conectar ao Cloud SQL (PostgreSQL).
 * Exporta helpers query(), getClient() (para transactions) e o pool.
 */
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
    logger.info('🗄️  PostgreSQL conectado');
});

pool.on('error', (err) => {
    logger.error('🗄️  Erro inesperado no pool PostgreSQL:', err.message);
});

/**
 * Execute a query using the connection pool.
 * @param {string} text - SQL query (use $1, $2, ... for params)
 * @param {Array} params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
    return pool.query(text, params);
}

/**
 * Get a dedicated client from the pool (for transactions).
 * MUST call client.release() when done.
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
    return pool.connect();
}

/**
 * Close the pool gracefully.
 */
async function closeDb() {
    await pool.end();
    logger.info('🗄️  PostgreSQL pool fechado');
}

// Graceful shutdown
process.on('SIGINT', async () => { await closeDb(); process.exit(0); });
process.on('SIGTERM', async () => { await closeDb(); process.exit(0); });

module.exports = { query, getClient, pool, closeDb };
