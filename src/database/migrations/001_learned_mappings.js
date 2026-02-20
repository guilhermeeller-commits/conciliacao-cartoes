/**
 * Migration 002 — Mapeamentos aprendidos (learned-mappings).
 * Migra config/learned-mappings.json para o SQLite.
 */
const path = require('path');
const fs = require('fs');

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS learned_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            descricao TEXT NOT NULL UNIQUE,
            categoria TEXT NOT NULL,
            criado_em TEXT DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_lm_descricao ON learned_mappings(descricao);
    `);

    // Migrar dados do JSON se existir
    const jsonPath = path.join(__dirname, '../../../config/learned-mappings.json');
    if (fs.existsSync(jsonPath)) {
        try {
            const mappings = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            const stmt = db.prepare(
                'INSERT OR IGNORE INTO learned_mappings (descricao, categoria) VALUES (?, ?)'
            );
            let count = 0;
            for (const [descricao, categoria] of Object.entries(mappings)) {
                stmt.run(descricao, categoria);
                count++;
            }
            // Leave the JSON file as backup — do not delete
        } catch (err) {
            // Non-fatal: table created, data migration failed
        }
    }
}

module.exports = { up };
