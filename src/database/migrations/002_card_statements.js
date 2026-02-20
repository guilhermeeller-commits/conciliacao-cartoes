/**
 * Migration 002: Card Statements & Transactions
 * Tables for storing imported credit card PDF statements and their parsed transactions.
 */
module.exports = {
    name: '002_card_statements',

    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS card_statements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                card_name TEXT NOT NULL,
                financial_account TEXT,
                statement_date TEXT,
                due_date TEXT,
                total_transactions INTEGER DEFAULT 0,
                reconciled_count INTEGER DEFAULT 0,
                total_amount REAL DEFAULT 0,
                raw_data TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS card_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                statement_id INTEGER NOT NULL REFERENCES card_statements(id) ON DELETE CASCADE,
                date TEXT,
                description TEXT,
                amount REAL,
                installment TEXT,
                category TEXT,
                confidence TEXT DEFAULT 'pending',
                reconciled INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_card_transactions_statement
                ON card_transactions(statement_id);

            CREATE INDEX IF NOT EXISTS idx_card_statements_card_name
                ON card_statements(card_name);

            CREATE INDEX IF NOT EXISTS idx_card_statements_date
                ON card_statements(statement_date);
        `);
    },
};
