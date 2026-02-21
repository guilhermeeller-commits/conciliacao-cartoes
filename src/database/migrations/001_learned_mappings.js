/**
 * Migration 001 — Mapeamentos aprendidos (learned-mappings).
 * Migra config/learned-mappings.json para o PostgreSQL.
 */
const path = require('path');
const fs = require('fs');

async function up(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS learned_mappings (
            id SERIAL PRIMARY KEY,
            descricao TEXT NOT NULL UNIQUE,
            categoria TEXT NOT NULL,
            criado_em TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_lm_descricao ON learned_mappings(descricao);
    `);

    // Migrar dados do JSON se existir
    const jsonPath = path.join(__dirname, '../../../config/learned-mappings.json');
    if (fs.existsSync(jsonPath)) {
        try {
            const mappings = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            let count = 0;
            for (const [descricao, categoria] of Object.entries(mappings)) {
                await client.query(
                    'INSERT INTO learned_mappings (descricao, categoria) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [descricao, categoria]
                );
                count++;
            }
        } catch (err) {
            // Non-fatal: table created, data migration failed
        }
    }
}

module.exports = { up };
