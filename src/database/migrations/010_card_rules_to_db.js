/**
 * Migration 010: Move card-rules.json data into PostgreSQL tables.
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
    async up(client) {
        // ─── Create Tables ────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS card_accounts (
                id SERIAL PRIMARY KEY,
                card_name TEXT NOT NULL UNIQUE,
                conta_numero INTEGER,
                conta_nome TEXT,
                fornecedor TEXT
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS classification_rules (
                id SERIAL PRIMARY KEY,
                padrao TEXT NOT NULL,
                categoria TEXT NOT NULL,
                ordem INTEGER NOT NULL DEFAULT 0
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
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
            for (const [name, cfg] of Object.entries(data.cartoes)) {
                await client.query(
                    `INSERT INTO card_accounts (card_name, conta_numero, conta_nome, fornecedor)
                     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                    [name, cfg.conta_numero || null, cfg.conta_nome || null, cfg.fornecedor || null]
                );
            }
        }

        // Seed classification_rules
        if (data.regras_classificacao) {
            for (let idx = 0; idx < data.regras_classificacao.length; idx++) {
                const rule = data.regras_classificacao[idx];
                await client.query(
                    `INSERT INTO classification_rules (padrao, categoria, ordem)
                     VALUES ($1, $2, $3)`,
                    [rule.padrao, rule.categoria, idx]
                );
            }
        }

        // Seed categories
        if (data.categorias) {
            for (const cat of data.categorias) {
                await client.query(
                    'INSERT INTO categories (nome) VALUES ($1) ON CONFLICT DO NOTHING',
                    [cat]
                );
            }
        }
    },
};
