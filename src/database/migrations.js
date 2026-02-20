/**
 * Migration Runner — Executa migrations sequenciais.
 * 
 * Cada migration é um arquivo em src/database/migrations/ nomeado como:
 *   001_nome_descritivo.js
 *   002_outra_migration.js
 * 
 * Cada arquivo exporta { up(db) } onde db é a instância better-sqlite3.
 * A tabela _migrations registra quais já rodaram.
 */
const path = require('path');
const fs = require('fs');
const { getDb } = require('./connection');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function runMigrations() {
    const db = getDb();

    // Criar tabela de controle
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            executed_at TEXT DEFAULT (datetime('now', 'localtime'))
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
    const executed = new Set(
        db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
    );

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
            db.transaction(() => {
                migration.up(db);
                db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
            })();
            logger.info(`   ✅ ${file}`);
        } catch (err) {
            logger.error(`   ❌ ${file}: ${err.message}`);
            throw err; // Falha em migration é fatal
        }
    }

    logger.info(`🗄️  ${pending.length} migration(s) executada(s) com sucesso`);
}

module.exports = { runMigrations };
