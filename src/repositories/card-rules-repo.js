/**
 * Repository: Card Rules
 *
 * CRUD operations for card_accounts, classification_rules, and categories tables.
 * Replaces the old fs-based card-rules.json read/write pattern.
 */
const { getDb } = require('../database/connection');

// ─── Card Accounts ────────────────────────────

function getCardAccounts() {
    const db = getDb();
    const rows = db.prepare('SELECT card_name, conta_numero, conta_nome, fornecedor FROM card_accounts ORDER BY card_name').all();
    // Return as object keyed by card_name (same format the frontend expects)
    const result = {};
    for (const row of rows) {
        result[row.card_name] = {
            conta_numero: row.conta_numero,
            conta_nome: row.conta_nome,
            fornecedor: row.fornecedor,
        };
    }
    return result;
}

function saveCardAccounts(cartoes) {
    const db = getDb();
    const deleteAll = db.prepare('DELETE FROM card_accounts');
    const insert = db.prepare(`
        INSERT INTO card_accounts (card_name, conta_numero, conta_nome, fornecedor)
        VALUES (?, ?, ?, ?)
    `);

    db.transaction(() => {
        deleteAll.run();
        for (const [name, cfg] of Object.entries(cartoes)) {
            insert.run(name, cfg.conta_numero || null, cfg.conta_nome || null, cfg.fornecedor || null);
        }
    })();
}

function getCardAccountByName(cardName) {
    const db = getDb();
    return db.prepare('SELECT card_name, conta_numero, conta_nome, fornecedor FROM card_accounts WHERE card_name = ?').get(cardName) || null;
}

// ─── Classification Rules ─────────────────────

function getClassificationRules() {
    const db = getDb();
    return db.prepare('SELECT id, padrao, categoria, ordem FROM classification_rules ORDER BY ordem ASC').all();
}

function saveClassificationRules(regras) {
    const db = getDb();
    const deleteAll = db.prepare('DELETE FROM classification_rules');
    const insert = db.prepare(`
        INSERT INTO classification_rules (padrao, categoria, ordem)
        VALUES (?, ?, ?)
    `);

    db.transaction(() => {
        deleteAll.run();
        regras.forEach((rule, idx) => {
            insert.run(rule.padrao, rule.categoria, idx);
        });
    })();
}

// ─── Categories ───────────────────────────────

function getCategories() {
    const db = getDb();
    return db.prepare('SELECT nome FROM categories ORDER BY nome ASC').all().map(r => r.nome);
}

function saveCategories(categorias) {
    const db = getDb();
    const deleteAll = db.prepare('DELETE FROM categories');
    const insert = db.prepare('INSERT OR IGNORE INTO categories (nome) VALUES (?)');

    db.transaction(() => {
        deleteAll.run();
        categorias.forEach(cat => insert.run(cat));
    })();
}

module.exports = {
    getCardAccounts,
    saveCardAccounts,
    getCardAccountByName,
    getClassificationRules,
    saveClassificationRules,
    getCategories,
    saveCategories,
};
