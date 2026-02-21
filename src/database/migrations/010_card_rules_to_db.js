/**
 * Migration 010: Move card-rules.json data into SQLite tables.
 *
 * Creates three tables:
 *   - card_accounts       (card → financial account mapping)
 *   - classification_rules (regex pattern → category)
 *   - categories           (valid category names)
 *
 * Seeds them with existing data from config/card-rules.json.
 */
const fs = require('fs');
const path = require('path');

const CARD_RULES_PATH = path.join(__dirname, '../../../config/card-rules.json');

module.exports = {
    up(db) {
        // ─── Create Tables ────────────────────────────

        db.exec(`
            CREATE TABLE IF NOT EXISTS card_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_name TEXT NOT NULL UNIQUE,
                conta_numero INTEGER,
                conta_nome TEXT,
                fornecedor TEXT
            );
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS classification_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                padrao TEXT NOT NULL,
                categoria TEXT NOT NULL,
                ordem INTEGER NOT NULL DEFAULT 0
            );
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE
            );
        `);

        // ─── Seed from JSON if available ──────────────

        if (!fs.existsSync(CARD_RULES_PATH)) return;

        let data;
        try {
            data = JSON.parse(fs.readFileSync(CARD_RULES_PATH, 'utf-8'));
        } catch (e) {
            return; // JSON inválido, pula seed
        }

        // Seed card_accounts
        if (data.cartoes) {
            const insertCard = db.prepare(`
                INSERT OR IGNORE INTO card_accounts (card_name, conta_numero, conta_nome, fornecedor)
                VALUES (?, ?, ?, ?)
            `);
            for (const [name, cfg] of Object.entries(data.cartoes)) {
                insertCard.run(name, cfg.conta_numero || null, cfg.conta_nome || null, cfg.fornecedor || null);
            }
        }

        // Seed classification_rules
        if (data.regras_classificacao) {
            const insertRule = db.prepare(`
                INSERT INTO classification_rules (padrao, categoria, ordem)
                VALUES (?, ?, ?)
            `);
            data.regras_classificacao.forEach((rule, idx) => {
                insertRule.run(rule.padrao, rule.categoria, idx);
            });
        }

        // Seed categories
        if (data.categorias) {
            const insertCat = db.prepare(`
                INSERT OR IGNORE INTO categories (nome) VALUES (?)
            `);
            data.categorias.forEach(cat => {
                insertCat.run(cat);
            });
        }
    },
};
