/**
 * Migration Runner — Executa migrations sequenciais (PostgreSQL).
 *
 * Cada migration é um arquivo em src/database/migrations/ nomeado como:
 *   001_nome_descritivo.js
 *   002_outra_migration.js
 *
 * Cada arquivo exporta { up(client) } onde client é um pg Client (dentro de transaction).
 * A tabela _migrations registra quais já rodaram.
 */
const path = require('path');
const fs = require('fs');
const { getClient } = require('./connection');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
    const client = await getClient();

    try {
        // Criar tabela de controle
        await client.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                executed_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Ler migrations disponíveis
        if (!fs.existsSync(MIGRATIONS_DIR)) {
            fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
            logger.info('🗄️  Nenhuma migration encontrada');
            return;
        }

        const files = fs.readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.js') && /^\d{3}_/.test(f))
            .sort();

        if (files.length === 0) {
            logger.info('🗄️  Nenhuma migration encontrada');
            return;
        }

        // Verificar quais já rodaram
        const { rows } = await client.query('SELECT name FROM _migrations');
        const executed = new Set(rows.map(r => r.name));

        const pending = files.filter(f => !executed.has(f));

        if (pending.length === 0) {
            logger.info(`🗄️  Schema atualizado (${files.length} migrations)`);
            return;
        }

        // Executar pendentes em ordem
        logger.info(`🗄️  ${pending.length} migration(s) pendente(s)...`);

        for (const file of pending) {
            const migration = require(path.join(MIGRATIONS_DIR, file));

            if (typeof migration.up !== 'function') {
                logger.error(`❌ Migration ${file} não exporta função up()`);
                continue;
            }

            try {
                await client.query('BEGIN');
                await migration.up(client);
                await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                logger.info(`   ✅ ${file}`);
            } catch (err) {
                await client.query('ROLLBACK');
                logger.error(`   ❌ ${file}: ${err.message}`);
                throw err; // Falha em migration é fatal
            }
        }

        logger.info(`🗄️  ${pending.length} migration(s) executada(s) com sucesso`);
    } finally {
        client.release();
    }
}

module.exports = { runMigrations };
