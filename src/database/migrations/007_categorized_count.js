/**
 * Migration 007: Add categorized_count to card_statements
 *
 * Adds a column to track how many transactions have a category assigned,
 * separate from the reconciled_count (which tracks Olist reconciliation).
 */
module.exports = {
    async up(client) {
        // Check if column exists
        const { rows } = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'card_statements' AND column_name = 'categorized_count'
        `);

        if (rows.length === 0) {
            await client.query('ALTER TABLE card_statements ADD COLUMN categorized_count INTEGER DEFAULT 0');
        }

        // Backfill categorized_count for existing statements
        const { rows: statements } = await client.query('SELECT id FROM card_statements');

        for (const s of statements) {
            await client.query(`
                UPDATE card_statements
                SET categorized_count = (
                    SELECT COUNT(*) FROM card_transactions
                    WHERE statement_id = $1 AND category IS NOT NULL AND TRIM(category) != '' AND category NOT LIKE '%NÃO CLASSIFICADO%'
                )
                WHERE id = $1
            `, [s.id]);
        }
    }
};
