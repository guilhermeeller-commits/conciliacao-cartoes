/**
 * Migration 003: Fix date format from DD/MM/YYYY to YYYY-MM-DD (ISO)
 * 
 * Existing records have statement_date and due_date stored as DD/MM/YYYY.
 * The frontend filters compare with YYYY-MM-DD, so nothing matches.
 * This migration converts all existing dates to ISO format.
 */
module.exports = {
    name: '003_fix_date_format',

    up(db) {
        // Fix card_statements.statement_date (DD/MM/YYYY → YYYY-MM-DD)
        const statements = db.prepare(
            "SELECT id, statement_date, due_date FROM card_statements WHERE statement_date LIKE '%/%'"
        ).all();

        const updateStmt = db.prepare(
            'UPDATE card_statements SET statement_date = ?, due_date = ? WHERE id = ?'
        );

        for (const s of statements) {
            const stmtDate = convertDate(s.statement_date);
            const dueDate = convertDate(s.due_date);
            updateStmt.run(stmtDate, dueDate, s.id);
        }

        // Fix card_transactions.date
        const transactions = db.prepare(
            "SELECT id, date FROM card_transactions WHERE date LIKE '%/%'"
        ).all();

        const updateTxn = db.prepare(
            'UPDATE card_transactions SET date = ? WHERE id = ?'
        );

        for (const t of transactions) {
            updateTxn.run(convertDate(t.date), t.id);
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
