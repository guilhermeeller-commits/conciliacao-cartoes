/**
 * Migration 006 — ERP Exports Tables
 *
 * Tabelas para armazenar dados importados dos XLS/XLSX das exportações ERP.
 * Usadas para cruzamento e categorização automática de movimentações.
 */

function up(db) {
    // ─── Contas a Pagar (importadas dos XLS) ─────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS erp_contas_pagar (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL UNIQUE,
            fornecedor TEXT DEFAULT '',
            data_emissao TEXT DEFAULT '',
            data_vencimento TEXT DEFAULT '',
            data_liquidacao TEXT DEFAULT '',
            valor REAL DEFAULT 0,
            saldo REAL DEFAULT 0,
            situacao TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            valor_pago REAL DEFAULT 0,
            competencia TEXT DEFAULT '',
            forma_pagamento TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Contas a Receber (importadas dos XLS) ───────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS erp_contas_receber (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL UNIQUE,
            cliente TEXT DEFAULT '',
            data_emissao TEXT DEFAULT '',
            data_vencimento TEXT DEFAULT '',
            data_liquidacao TEXT DEFAULT '',
            valor REAL DEFAULT 0,
            saldo REAL DEFAULT 0,
            situacao TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            nro_banco TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            forma_recebimento TEXT DEFAULT '',
            meio_recebimento TEXT DEFAULT '',
            taxas REAL DEFAULT 0,
            competencia TEXT DEFAULT '',
            data_recebimento TEXT DEFAULT '',
            valor_recebido REAL DEFAULT 0,
            imported_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Fornecedores ────────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS erp_fornecedores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL UNIQUE,
            codigo TEXT DEFAULT '',
            nome TEXT DEFAULT '',
            fantasia TEXT DEFAULT '',
            endereco TEXT DEFAULT '',
            numero TEXT DEFAULT '',
            complemento TEXT DEFAULT '',
            bairro TEXT DEFAULT '',
            cep TEXT DEFAULT '',
            cidade TEXT DEFAULT '',
            estado TEXT DEFAULT '',
            telefone TEXT DEFAULT '',
            celular TEXT DEFAULT '',
            email TEXT DEFAULT '',
            tipo_pessoa TEXT DEFAULT '',
            cpf_cnpj TEXT DEFAULT '',
            ie_rg TEXT DEFAULT '',
            situacao TEXT DEFAULT '',
            tipo_contato TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Plano de Contas ─────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS erp_plano_contas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL UNIQUE,
            descricao TEXT DEFAULT '',
            grupo TEXT DEFAULT '',
            considera_dre TEXT DEFAULT '',
            competencia_padrao TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Extratos Bancários ──────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS erp_extratos_banco (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL,
            data TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            tipo TEXT DEFAULT '',
            valor REAL DEFAULT 0,
            contato TEXT DEFAULT '',
            cnpj TEXT DEFAULT '',
            marcadores TEXT DEFAULT '',
            conta TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            banco TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE(olist_id, banco)
        );
    `);

    // ─── Investimentos ───────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS erp_investimentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            olist_id TEXT NOT NULL,
            data TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            tipo TEXT DEFAULT '',
            valor REAL DEFAULT 0,
            contato TEXT DEFAULT '',
            cnpj TEXT DEFAULT '',
            marcadores TEXT DEFAULT '',
            conta TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            banco TEXT DEFAULT '',
            imported_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE(olist_id, banco)
        );
    `);

    // ─── Log de Importações ──────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS erp_import_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity TEXT NOT NULL,
            file_name TEXT DEFAULT '',
            records_imported INTEGER DEFAULT 0,
            records_skipped INTEGER DEFAULT 0,
            status TEXT DEFAULT 'success',
            error TEXT DEFAULT NULL,
            imported_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // ─── Mapa Fornecedor → Categoria (cache) ─────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS erp_supplier_category_map (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fornecedor TEXT NOT NULL,
            cpf_cnpj TEXT DEFAULT '',
            categoria TEXT NOT NULL,
            frequencia INTEGER DEFAULT 1,
            confianca TEXT DEFAULT 'media',
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE(fornecedor, categoria)
        );
    `);

    // ─── Índices ─────────────────────────────────────────
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_erp_cp_fornecedor ON erp_contas_pagar(fornecedor);
        CREATE INDEX IF NOT EXISTS idx_erp_cp_categoria ON erp_contas_pagar(categoria);
        CREATE INDEX IF NOT EXISTS idx_erp_cp_data_vencimento ON erp_contas_pagar(data_vencimento);
        CREATE INDEX IF NOT EXISTS idx_erp_cp_valor ON erp_contas_pagar(valor);
        CREATE INDEX IF NOT EXISTS idx_erp_cr_categoria ON erp_contas_receber(categoria);
        CREATE INDEX IF NOT EXISTS idx_erp_cr_data_vencimento ON erp_contas_receber(data_vencimento);
        CREATE INDEX IF NOT EXISTS idx_erp_fn_nome ON erp_fornecedores(nome);
        CREATE INDEX IF NOT EXISTS idx_erp_fn_cpf_cnpj ON erp_fornecedores(cpf_cnpj);
        CREATE INDEX IF NOT EXISTS idx_erp_eb_data ON erp_extratos_banco(data);
        CREATE INDEX IF NOT EXISTS idx_erp_eb_banco ON erp_extratos_banco(banco);
        CREATE INDEX IF NOT EXISTS idx_erp_eb_contato ON erp_extratos_banco(contato);
        CREATE INDEX IF NOT EXISTS idx_erp_scm_fornecedor ON erp_supplier_category_map(fornecedor);
    `);
}

module.exports = { up };
