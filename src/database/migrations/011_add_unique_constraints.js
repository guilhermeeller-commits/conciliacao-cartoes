/**
 * Migration 011: Add unique constraints to card_statements
 * Prevents duplicate uploads of the same PDF statement.
 * Constraint: UNIQUE(card_name, statement_date, filename)
 */
module.exports = {
    name: '011_add_unique_constraints',

    async up(client) {
        // First, remove any existing duplicates (keep the most recent one)
        await client.query(`
            DELETE FROM card_statements a
            USING card_statements b
            WHERE a.id < b.id
              AND a.card_name = b.card_name
              AND a.statement_date = b.statement_date
              AND a.filename = b.filename;
        `);

        await client.query(`
            ALTER TABLE card_statements
            ADD CONSTRAINT uq_card_statements_card_date_file
            UNIQUE (card_name, statement_date, filename);
        `);
    },

    async down(client) {
        await client.query(`
            ALTER TABLE card_statements
            DROP CONSTRAINT IF EXISTS uq_card_statements_card_date_file;
        `);
    },
};
