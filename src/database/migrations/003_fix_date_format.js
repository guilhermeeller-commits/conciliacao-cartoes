/**
 * Migration 003: Fix date format from DD/MM/YYYY to YYYY-MM-DD (ISO)
 *
 * Existing records have statement_date and due_date stored as DD/MM/YYYY.
 * The frontend filters compare with YYYY-MM-DD, so nothing matches.
 * This migration converts all existing dates to ISO format.
 */
module.exports = {
    name: '003_fix_date_format',

    async up(client) {
        // Fix card_statements.statement_date (DD/MM/YYYY → YYYY-MM-DD)
        const { rows: statements } = await client.query(
            "SELECT id, statement_date, due_date FROM card_statements WHERE statement_date LIKE '%/%'"
        );

        for (const s of statements) {
            const stmtDate = convertDate(s.statement_date);
            const dueDate = convertDate(s.due_date);
            await client.query(
                'UPDATE card_statements SET statement_date = $1, due_date = $2 WHERE id = $3',
                [stmtDate, dueDate, s.id]
            );
        }

        // Fix card_transactions.date
        const { rows: transactions } = await client.query(
            "SELECT id, date FROM card_transactions WHERE date LIKE '%/%'"
        );

        for (const t of transactions) {
            await client.query(
                'UPDATE card_transactions SET date = $1 WHERE id = $2',
                [convertDate(t.date), t.id]
            );
        }

        console.log(`   Converted ${statements.length} statement dates and ${transactions.length} transaction dates to ISO format`);
    },
};

function convertDate(dateStr) {
    if (!dateStr) return dateStr;
    const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return dateStr;
}
