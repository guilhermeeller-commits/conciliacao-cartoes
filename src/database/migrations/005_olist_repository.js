/**
 * Migration 005 — Olist Repository Tables
 *
 * Creates local cache tables for Olist/Tiny ERP data.
 * Purpose: Build training dataset for AI expense categorization.
 */

async function up(client) {
    // ─── Contas a Pagar ─────
    await client.query(`
        CREATE TABLE IF NOT EXISTS olist_contas_pagar (
            id SERIAL PRIMARY KEY,
            olist_id TEXT NOT NULL UNIQUE,
            fornecedor TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            valor DOUBLE PRECISION DEFAULT 0,
            saldo DOUBLE PRECISION DEFAULT 0,
            data_emissao TEXT DEFAULT '',
            data_vencimento TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            situacao TEXT DEFAULT '',
            competencia TEXT DEFAULT '',
            imported_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Contas a Receber ────────────────────────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS olist_contas_receber (
            id SERIAL PRIMARY KEY,
            olist_id TEXT NOT NULL UNIQUE,
            cliente TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            valor DOUBLE PRECISION DEFAULT 0,
            saldo DOUBLE PRECISION DEFAULT 0,
            data_emissao TEXT DEFAULT '',
            data_vencimento TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            situacao TEXT DEFAULT '',
            competencia TEXT DEFAULT '',
            imported_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Contatos (Fornecedores + Clientes) ──────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS olist_contatos (
            id SERIAL PRIMARY KEY,
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
            imported_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Notas Fiscais de Entrada ────────────────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS olist_notas_entrada (
            id SERIAL PRIMARY KEY,
            olist_id TEXT NOT NULL UNIQUE,
            numero TEXT DEFAULT '',
            serie TEXT DEFAULT '',
            fornecedor TEXT DEFAULT '',
            cliente TEXT DEFAULT '',
            valor DOUBLE PRECISION DEFAULT 0,
            data_emissao TEXT DEFAULT '',
            situacao TEXT DEFAULT '',
            tipo TEXT DEFAULT '',
            imported_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Sync Log ────────────────────────────────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS olist_sync_log (
            id SERIAL PRIMARY KEY,
            entity TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            records_imported INTEGER DEFAULT 0,
            records_total INTEGER DEFAULT 0,
            pages_fetched INTEGER DEFAULT 0,
            error TEXT DEFAULT NULL,
            started_at TIMESTAMP DEFAULT NOW(),
            finished_at TIMESTAMP DEFAULT NULL
        );
    `);

    // ─── Indexes for common queries ──────────────────────────
    await client.query(`
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
