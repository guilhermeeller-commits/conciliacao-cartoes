/**
 * Repository: Card Statements & Transactions
 * Data access layer for credit card statement management.
 */
const { getDb } = require('../database/connection');

// ─── Statements ───────────────────────────────

function insertStatement({ filename, card_name, financial_account, statement_date, due_date, total_transactions, reconciled_count, total_amount, raw_data }) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO card_statements (filename, card_name, financial_account, statement_date, due_date, total_transactions, reconciled_count, total_amount, raw_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(filename, card_name, financial_account, statement_date, due_date, total_transactions, reconciled_count || 0, total_amount, raw_data ? JSON.stringify(raw_data) : null);
    return result.lastInsertRowid;
}

/**
 * Check if a statement already exists for the same card and month/year.
 * Returns the existing statement row if found, or undefined if not.
 */
function findDuplicateStatement(card_name, statement_date) {
    const db = getDb();
    // Extract YYYY-MM from statement_date (supports both YYYY-MM-DD and DD/MM/YYYY)
    let yearMonth;
    if (statement_date.includes('-')) {
        yearMonth = statement_date.slice(0, 7); // "YYYY-MM"
    } else {
        const parts = statement_date.split('/');
        yearMonth = `${parts[2]}-${parts[1].padStart(2, '0')}`; // "YYYY-MM"
    }

    return db.prepare(`
        SELECT id, filename, statement_date FROM card_statements
        WHERE card_name = ? AND strftime('%Y-%m', statement_date) = ?
        LIMIT 1
    `).get(card_name, yearMonth);
}

function listStatements({ card, dateFrom, dateTo, search } = {}) {
    const db = getDb();
    let sql = 'SELECT * FROM card_statements WHERE 1=1';
    const params = [];

    if (card) {
        sql += ' AND card_name = ?';
        params.push(card);
    }
    if (dateFrom) {
        sql += ' AND statement_date >= ?';
        params.push(dateFrom);
    }
    if (dateTo) {
        sql += ' AND statement_date <= ?';
        params.push(dateTo);
    }
    if (search) {
        sql += ' AND filename LIKE ?';
        params.push(`%${search}%`);
    }

    sql += ' ORDER BY statement_date DESC, created_at DESC';
    return db.prepare(sql).all(...params);
}

function getStatementById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM card_statements WHERE id = ?').get(id);
}

function deleteStatement(id) {
    const db = getDb();
    // card_transactions are cascade-deleted
    return db.prepare('DELETE FROM card_statements WHERE id = ?').run(id);
}

function getDistinctCards() {
    const db = getDb();
    return db.prepare('SELECT DISTINCT card_name FROM card_statements ORDER BY card_name').all().map(r => r.card_name);
}

function updateStatementCounts(statementId) {
    const db = getDb();
    const counts = db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN reconciled = 1 THEN 1 ELSE 0 END) as reconciled,
            SUM(CASE WHEN category IS NOT NULL AND TRIM(category) != '' AND category NOT LIKE '%NÃO CLASSIFICADO%' THEN 1 ELSE 0 END) as categorized
        FROM card_transactions WHERE statement_id = ?
    `).get(statementId);

    db.prepare(`
        UPDATE card_statements 
        SET total_transactions = ?, reconciled_count = ?, categorized_count = ?
        WHERE id = ?
    `).run(counts.total, counts.reconciled, counts.categorized, statementId);
}

// ─── Transactions ─────────────────────────────

function insertTransactions(statementId, transactions) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO card_transactions (statement_id, date, description, amount, installment, category, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((txns) => {
        for (const t of txns) {
            stmt.run(
                statementId,
                t.data || t.date || null,
                t.descricao || t.description || null,
                t.valor || t.amount || 0,
                t.parcela || t.installment || null,
                t.categoria || t.category || null,
                t.confianca || t.confidence || 'pending'
            );
        }
    });

    insertMany(transactions);
}

function getTransactions(statementId) {
    const db = getDb();
    return db.prepare('SELECT * FROM card_transactions WHERE statement_id = ? ORDER BY date ASC, id ASC').all(statementId);
}

function updateTransactionCategory(transactionId, category, confidence) {
    const db = getDb();
    return db.prepare('UPDATE card_transactions SET category = ?, confidence = ? WHERE id = ?').run(category, confidence || 'manual', transactionId);
}

function setTransactionReconciled(transactionId, reconciled) {
    const db = getDb();
    return db.prepare('UPDATE card_transactions SET reconciled = ? WHERE id = ?').run(reconciled ? 1 : 0, transactionId);
}

function markTransactionSent(transactionId, olistId) {
    const db = getDb();
    return db.prepare('UPDATE card_transactions SET sent_to_olist = 1, olist_id = ? WHERE id = ?').run(olistId || null, transactionId);
}

module.exports = {
    insertStatement,
    findDuplicateStatement,
    listStatements,
    getStatementById,
    deleteStatement,
    getDistinctCards,
    updateStatementCounts,
    insertTransactions,
    getTransactions,
    updateTransactionCategory,
    setTransactionReconciled,
    markTransactionSent,
};
