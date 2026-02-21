/**
 * Migration 004: Standardize card statement filenames
 * Renames existing records from raw PDF filenames to: MM/YY - Cartão - {Fornecedor}
 */
const path = require('path');
const fs = require('fs');

module.exports = {
    name: '004_standardize_filenames',

    async up(client) {
        // Load card config
        const cardRulesPath = path.join(__dirname, '../../../config/card-rules.json');
        if (!fs.existsSync(cardRulesPath)) return;

        const cardRules = JSON.parse(fs.readFileSync(cardRulesPath, 'utf-8'));

        // Build card_name → fornecedor map
        const cardToFornecedor = {};
        for (const [cardName, info] of Object.entries(cardRules.cartoes || {})) {
            cardToFornecedor[cardName] = info.fornecedor;
        }

        // Get all existing statements
        const { rows: statements } = await client.query(
            'SELECT id, filename, card_name, statement_date, due_date FROM card_statements'
        );

        for (const s of statements) {
            const fornecedor = cardToFornecedor[s.card_name] || s.card_name;
            const dateStr = s.due_date || s.statement_date;
            if (!dateStr) continue;

            let mm, yy;
            if (dateStr.includes('-')) {
                const parts = dateStr.split('-');
                mm = parts[1];
                yy = parts[0].slice(-2);
            } else {
                const parts = dateStr.split('/');
                if (parts.length !== 3) continue;
                mm = parts[1].padStart(2, '0');
                yy = parts[2].slice(-2);
            }

            const newName = `${mm}/${yy} - Cartão - ${fornecedor}`;
            await client.query(
                'UPDATE card_statements SET filename = $1 WHERE id = $2',
                [newName, s.id]
            );
        }
    },
};
