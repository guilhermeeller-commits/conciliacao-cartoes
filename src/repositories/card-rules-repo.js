/**
 * Repository: Card Rules
 *
 * CRUD operations for card_accounts, classification_rules, and categories tables.
 * Replaces the old fs-based card-rules.json read/write pattern.
 */
const { query, getClient } = require('../database/connection');

// ─── Card Accounts ────────────────────────────

async function getCardAccounts() {
    const { rows } = await query('SELECT card_name, conta_numero, conta_nome, fornecedor FROM card_accounts ORDER BY card_name');
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

async function saveCardAccounts(cartoes) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM card_accounts');
        for (const [name, cfg] of Object.entries(cartoes)) {
            await client.query(
                'INSERT INTO card_accounts (card_name, conta_numero, conta_nome, fornecedor) VALUES ($1, $2, $3, $4)',
                [name, cfg.conta_numero || null, cfg.conta_nome || null, cfg.fornecedor || null]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getCardAccountByName(cardName) {
    const { rows } = await query(
        'SELECT card_name, conta_numero, conta_nome, fornecedor FROM card_accounts WHERE card_name = $1',
        [cardName]
    );
    return rows[0] || null;
}

// ─── Classification Rules ─────────────────────

async function getClassificationRules() {
    const { rows } = await query('SELECT id, padrao, categoria, ordem FROM classification_rules ORDER BY ordem ASC');
    return rows;
}

async function saveClassificationRules(regras) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM classification_rules');
        for (let idx = 0; idx < regras.length; idx++) {
            const rule = regras[idx];
            await client.query(
                'INSERT INTO classification_rules (padrao, categoria, ordem) VALUES ($1, $2, $3)',
                [rule.padrao, rule.categoria, idx]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ─── Categories ───────────────────────────────

async function getCategories() {
    const { rows } = await query('SELECT nome FROM categories ORDER BY nome ASC');
    return rows.map(r => r.nome);
}

async function saveCategories(categorias) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM categories');
        for (const cat of categorias) {
            await client.query(
                'INSERT INTO categories (nome) VALUES ($1) ON CONFLICT DO NOTHING',
                [cat]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
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
