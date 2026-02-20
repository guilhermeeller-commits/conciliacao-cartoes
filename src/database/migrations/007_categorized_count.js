/**
 * Migration 007: Add categorized_count to card_statements
 * 
 * Adds a column to track how many transactions have a category assigned,
 * separate from the reconciled_count (which tracks Olist reconciliation).
 */
module.exports = {
    up(db) {
        // Add categorized_count column
        const columns = db.pragma('table_info(card_statements)').map(c => c.name);
        if (!columns.includes('categorized_count')) {
            db.exec('ALTER TABLE card_statements ADD COLUMN categorized_count INTEGER DEFAULT 0');
        }

        // Backfill categorized_count for existing statements
        const statements = db.prepare('SELECT id FROM card_statements').all();
        const updateStmt = db.prepare(`
            UPDATE card_statements 
            SET categorized_count = (
                SELECT COUNT(*) FROM card_transactions 
                WHERE statement_id = ? AND category IS NOT NULL AND TRIM(category) != '' AND category NOT LIKE '%NÃO CLASSIFICADO%'
            )
            WHERE id = ?
        `);

        for (const s of statements) {
            updateStmt.run(s.id, s.id);
        }
    }
};
