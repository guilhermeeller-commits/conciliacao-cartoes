/**
 * Migration 009: Sent to Olist tracking
 * Adds sent_to_olist flag and olist_id to card_transactions.
 */
module.exports = {
    name: '009_sent_to_olist',

    async up(client) {
        // Check if columns exist
        const { rows } = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'card_transactions' AND column_name IN ('sent_to_olist', 'olist_id')
        `);
        const existing = new Set(rows.map(r => r.column_name));

        if (!existing.has('sent_to_olist')) {
            await client.query('ALTER TABLE card_transactions ADD COLUMN sent_to_olist INTEGER DEFAULT 0');
        }
        if (!existing.has('olist_id')) {
            await client.query('ALTER TABLE card_transactions ADD COLUMN olist_id TEXT');
        }
    },
};
