const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const DB_PATH = path.join(__dirname, '../../data/calisul-financeiro.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
        logger.info(`🗄️  SQLite conectado: ${DB_PATH}`);
    }
    return db;
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
        logger.info('🗄️  SQLite fechado');
    }
}

// Graceful shutdown
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

module.exports = { getDb, closeDb };
