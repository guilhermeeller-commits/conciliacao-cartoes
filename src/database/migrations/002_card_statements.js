/**
 * Migration 002: Card Statements & Transactions
 * Tables for storing imported credit card PDF statements and their parsed transactions.
 */
module.exports = {
    name: '002_card_statements',

    async up(client) {
        await client.query(`
            CREATE TABLE IF NOT EXISTS card_statements (
                id SERIAL PRIMARY KEY,
                filename TEXT NOT NULL,
                card_name TEXT NOT NULL,
                financial_account TEXT,
                statement_date TEXT,
                due_date TEXT,
                total_transactions INTEGER DEFAULT 0,
                reconciled_count INTEGER DEFAULT 0,
                total_amount DOUBLE PRECISION DEFAULT 0,
                raw_data TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS card_transactions (
                id SERIAL PRIMARY KEY,
                statement_id INTEGER NOT NULL REFERENCES card_statements(id) ON DELETE CASCADE,
                date TEXT,
                description TEXT,
                amount DOUBLE PRECISION,
                installment TEXT,
                category TEXT,
                confidence TEXT DEFAULT 'pending',
                reconciled INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
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
