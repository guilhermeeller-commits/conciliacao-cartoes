/**
 * Migration 005 — Olist Repository Tables
 * 
 * Creates local cache tables for Olist/Tiny ERP data.
 * Purpose: Build training dataset for AI expense categorization.
 */

function up(db) {
    // ─── Contas a Pagar (most important for AI training) ─────
    db.exec(`
        CREATE TABLE IF NOT EXISTS olist_contas_pagar (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL UNIQUE,
            fornecedor TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            valor REAL DEFAULT 0,
            saldo REAL DEFAULT 0,
            data_emissao TEXT DEFAULT '',
            data_vencimento TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            situacao TEXT DEFAULT '',
            competencia TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Contas a Receber ────────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS olist_contas_receber (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL UNIQUE,
            cliente TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            valor REAL DEFAULT 0,
            saldo REAL DEFAULT 0,
            data_emissao TEXT DEFAULT '',
            data_vencimento TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            situacao TEXT DEFAULT '',
            competencia TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Contatos (Fornecedores + Clientes) ──────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS olist_contatos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL UNIQUE,
            nome TEXT DEFAULT '',
            fantasia TEXT DEFAULT '',
            tipo_pessoa TEXT DEFAULT '',
            cpf_cnpj TEXT DEFAULT '',
            email TEXT DEFAULT '',
            telefone TEXT DEFAULT '',
            cidade TEXT DEFAULT '',
            uf TEXT DEFAULT '',
            situacao TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Notas Fiscais de Entrada ────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS olist_notas_entrada (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL UNIQUE,
            numero TEXT DEFAULT '',
            serie TEXT DEFAULT '',
            fornecedor TEXT DEFAULT '',
            cliente TEXT DEFAULT '',
            valor REAL DEFAULT 0,
            data_emissao TEXT DEFAULT '',
            situacao TEXT DEFAULT '',
            tipo TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Sync Log ────────────────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS olist_sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            records_imported INTEGER DEFAULT 0,
            records_total INTEGER DEFAULT 0,
            pages_fetched INTEGER DEFAULT 0,
            error TEXT DEFAULT NULL,
            started_at TEXT DEFAULT (datetime('now', 'localtime')),
            finished_at TEXT DEFAULT NULL
        );
    `);

    // ─── Indexes for common queries ──────────────────────────
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cp_categoria ON olist_contas_pagar(categoria);
        CREATE INDEX IF NOT EXISTS idx_cp_fornecedor ON olist_contas_pagar(fornecedor);
        CREATE INDEX IF NOT EXISTS idx_cp_situacao ON olist_contas_pagar(situacao);
        CREATE INDEX IF NOT EXISTS idx_cp_vencimento ON olist_contas_pagar(data_vencimento);
        CREATE INDEX IF NOT EXISTS idx_cr_situacao ON olist_contas_receber(situacao);
        CREATE INDEX IF NOT EXISTS idx_cr_vencimento ON olist_contas_receber(data_vencimento);
        CREATE INDEX IF NOT EXISTS idx_contatos_nome ON olist_contatos(nome);
        CREATE INDEX IF NOT EXISTS idx_ne_data ON olist_notas_entrada(data_emissao);
    `);
}

module.exports = { up };
