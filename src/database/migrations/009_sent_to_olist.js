/**
 * Migration 009: Sent to Olist tracking
 * Adds sent_to_olist flag and olist_id to card_transactions.
 */
module.exports = {
    name: '009_sent_to_olist',

    up(db) {
        // Check if column already exists
        const cols = db.pragma('table_info(card_transactions)').map(c => c.name);
        if (!cols.includes('sent_to_olist')) {
            db.exec(`ALTER TABLE card_transactions ADD COLUMN sent_to_olist INTEGER DEFAULT 0`);
        }
        if (!cols.includes('olist_id')) {
            db.exec(`ALTER TABLE card_transactions ADD COLUMN olist_id TEXT`);
        }
    },
};
