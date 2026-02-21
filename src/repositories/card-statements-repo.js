/**
 * Repository: Card Statements & Transactions
 * Data access layer for credit card statement management.
 */
const { query, getClient } = require('../database/connection');

// ─── Statements ───────────────────────────────

async function insertStatement({ filename, card_name, financial_account, statement_date, due_date, total_transactions, reconciled_count, total_amount, raw_data }) {
    const { rows } = await query(
        `INSERT INTO card_statements (filename, card_name, financial_account, statement_date, due_date, total_transactions, reconciled_count, total_amount, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [filename, card_name, financial_account, statement_date, due_date, total_transactions, reconciled_count || 0, total_amount, raw_data ? JSON.stringify(raw_data) : null]
    );
    return rows[0].id;
}

/**
 * Check if a statement already exists for the same card and month/year.
 * Returns the existing statement row if found, or undefined if not.
 */
async function findDuplicateStatement(card_name, statement_date) {
    // Extract YYYY-MM from statement_date (supports both YYYY-MM-DD and DD/MM/YYYY)
    let yearMonth;
    if (statement_date.includes('-')) {
        yearMonth = statement_date.slice(0, 7); // "YYYY-MM"
    } else {
        const parts = statement_date.split('/');
        yearMonth = `${parts[2]}-${parts[1].padStart(2, '0')}`; // "YYYY-MM"
    }

    const { rows } = await query(
        `SELECT id, filename, statement_date FROM card_statements
         WHERE card_name = $1 AND SUBSTRING(statement_date FROM 1 FOR 7) = $2
         LIMIT 1`,
        [card_name, yearMonth]
    );
    return rows[0];
}

async function listStatements({ card, dateFrom, dateTo, search } = {}) {
    let sql = 'SELECT * FROM card_statements WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (card) {
        sql += ` AND card_name = $${paramIdx++}`;
        params.push(card);
    }
    if (dateFrom) {
        sql += ` AND statement_date >= $${paramIdx++}`;
        params.push(dateFrom);
    }
    if (dateTo) {
        sql += ` AND statement_date <= $${paramIdx++}`;
        params.push(dateTo);
    }
    if (search) {
        sql += ` AND filename ILIKE $${paramIdx++}`;
        params.push(`%${search}%`);
    }

    sql += ' ORDER BY statement_date DESC, created_at DESC';
    const { rows } = await query(sql, params);
    return rows;
}

async function getStatementById(id) {
    const { rows } = await query('SELECT * FROM card_statements WHERE id = $1', [id]);
    return rows[0];
}

async function deleteStatement(id) {
    // card_transactions are cascade-deleted
    const result = await query('DELETE FROM card_statements WHERE id = $1', [id]);
    return result;
}

async function getDistinctCards() {
    const { rows } = await query('SELECT DISTINCT card_name FROM card_statements ORDER BY card_name');
    return rows.map(r => r.card_name);
}

async function updateStatementCounts(statementId) {
    const { rows } = await query(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN reconciled = 1 THEN 1 ELSE 0 END) as reconciled,
            SUM(CASE WHEN category IS NOT NULL AND TRIM(category) != '' AND category NOT LIKE '%NÃO CLASSIFICADO%' THEN 1 ELSE 0 END) as categorized
        FROM card_transactions WHERE statement_id = $1
    `, [statementId]);

    const counts = rows[0];
    await query(
        'UPDATE card_statements SET total_transactions = $1, reconciled_count = $2, categorized_count = $3 WHERE id = $4',
        [counts.total, counts.reconciled, counts.categorized, statementId]
    );
}

// ─── Transactions ─────────────────────────────

async function insertTransactions(statementId, transactions) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        for (const t of transactions) {
            await client.query(
                `INSERT INTO card_transactions (statement_id, date, description, amount, installment, category, confidence)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    statementId,
                    t.data || t.date || null,
                    t.descricao || t.description || null,
                    t.valor || t.amount || 0,
                    t.parcela || t.installment || null,
                    t.categoria || t.category || null,
                    t.confianca || t.confidence || 'pending'
                ]
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

async function getTransactions(statementId) {
    const { rows } = await query('SELECT * FROM card_transactions WHERE statement_id = $1 ORDER BY date ASC, id ASC', [statementId]);
    return rows;
}

async function updateTransactionCategory(transactionId, category, confidence) {
    return query('UPDATE card_transactions SET category = $1, confidence = $2 WHERE id = $3', [category, confidence || 'manual', transactionId]);
}

async function setTransactionReconciled(transactionId, reconciled) {
    return query('UPDATE card_transactions SET reconciled = $1 WHERE id = $2', [reconciled ? 1 : 0, transactionId]);
}

async function markTransactionSent(transactionId, olistId) {
    return query('UPDATE card_transactions SET sent_to_olist = 1, olist_id = $1 WHERE id = $2', [olistId || null, transactionId]);
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
