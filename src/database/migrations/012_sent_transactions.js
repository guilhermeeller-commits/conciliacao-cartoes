/**
 * Migration 012: Sent Transactions (idempotência)
 * Tabela para rastrear transações já enviadas ao Tiny ERP,
 * prevenindo duplicatas e permitindo retries seguros.
 */
module.exports = {
    name: '012_sent_transactions',

    async up(client) {
        await client.query(`
            CREATE TABLE IF NOT EXISTS sent_transactions (
                id SERIAL PRIMARY KEY,
                idempotency_key VARCHAR(255) UNIQUE NOT NULL,
                card_name VARCHAR(255),
                transaction_date TEXT,
                amount DECIMAL(10,2),
                description TEXT,
                olist_id VARCHAR(100),
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_sent_transactions_key
                ON sent_transactions(idempotency_key);

            CREATE INDEX IF NOT EXISTS idx_sent_transactions_status
                ON sent_transactions(status);

            CREATE INDEX IF NOT EXISTS idx_sent_transactions_olist_id
                ON sent_transactions(olist_id);
        `);
    },

    async down(client) {
        await client.query('DROP TABLE IF EXISTS sent_transactions;');
    },
};
