/**
 * Migration 006 — ERP Exports Tables
 *
 * Tabelas para armazenar dados importados dos XLS/XLSX das exportações ERP.
 * Usadas para cruzamento e categorização automática de movimentações.
 */

async function up(client) {
    // ─── Contas a Pagar (importadas dos XLS) ─────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS erp_contas_pagar (
            id SERIAL PRIMARY KEY,
            olist_id TEXT NOT NULL UNIQUE,
            fornecedor TEXT DEFAULT '',
            data_emissao TEXT DEFAULT '',
            data_vencimento TEXT DEFAULT '',
            data_liquidacao TEXT DEFAULT '',
            valor DOUBLE PRECISION DEFAULT 0,
            saldo DOUBLE PRECISION DEFAULT 0,
            situacao TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            valor_pago DOUBLE PRECISION DEFAULT 0,
            competencia TEXT DEFAULT '',
            forma_pagamento TEXT DEFAULT '',
            imported_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Contas a Receber (importadas dos XLS) ───────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS erp_contas_receber (
            id SERIAL PRIMARY KEY,
            olist_id TEXT NOT NULL UNIQUE,
            cliente TEXT DEFAULT '',
            data_emissao TEXT DEFAULT '',
            data_vencimento TEXT DEFAULT '',
            data_liquidacao TEXT DEFAULT '',
            valor DOUBLE PRECISION DEFAULT 0,
            saldo DOUBLE PRECISION DEFAULT 0,
            situacao TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            nro_banco TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            forma_recebimento TEXT DEFAULT '',
            meio_recebimento TEXT DEFAULT '',
            taxas DOUBLE PRECISION DEFAULT 0,
            competencia TEXT DEFAULT '',
            data_recebimento TEXT DEFAULT '',
            valor_recebido DOUBLE PRECISION DEFAULT 0,
            imported_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Fornecedores ────────────────────────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS erp_fornecedores (
            id SERIAL PRIMARY KEY,
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
            imported_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Plano de Contas ─────────────────────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS erp_plano_contas (
            id SERIAL PRIMARY KEY,
            olist_id TEXT NOT NULL UNIQUE,
            descricao TEXT DEFAULT '',
            grupo TEXT DEFAULT '',
            considera_dre TEXT DEFAULT '',
            competencia_padrao TEXT DEFAULT '',
            imported_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Extratos Bancários ──────────────────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS erp_extratos_banco (
            id SERIAL PRIMARY KEY,
            olist_id TEXT NOT NULL,
            data TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            tipo TEXT DEFAULT '',
            valor DOUBLE PRECISION DEFAULT 0,
            contato TEXT DEFAULT '',
            cnpj TEXT DEFAULT '',
            marcadores TEXT DEFAULT '',
            conta TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            banco TEXT DEFAULT '',
            imported_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(olist_id, banco)
        );
    `);

    // ─── Investimentos ───────────────────────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS erp_investimentos (
            id SERIAL PRIMARY KEY,
            olist_id TEXT NOT NULL,
            data TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            historico TEXT DEFAULT '',
            tipo TEXT DEFAULT '',
            valor DOUBLE PRECISION DEFAULT 0,
            contato TEXT DEFAULT '',
            cnpj TEXT DEFAULT '',
            marcadores TEXT DEFAULT '',
            conta TEXT DEFAULT '',
            nro_documento TEXT DEFAULT '',
            banco TEXT DEFAULT '',
            imported_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(olist_id, banco)
        );
    `);

    // ─── Log de Importações ──────────────────────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS erp_import_log (
            id SERIAL PRIMARY KEY,
            entity TEXT NOT NULL,
            file_name TEXT DEFAULT '',
            records_imported INTEGER DEFAULT 0,
            records_skipped INTEGER DEFAULT 0,
            status TEXT DEFAULT 'success',
            error TEXT DEFAULT NULL,
            imported_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // ─── Mapa Fornecedor → Categoria (cache) ─────────────
    await client.query(`
        CREATE TABLE IF NOT EXISTS erp_supplier_category_map (
            id SERIAL PRIMARY KEY,
            fornecedor TEXT NOT NULL,
            cpf_cnpj TEXT DEFAULT '',
            categoria TEXT NOT NULL,
            frequencia INTEGER DEFAULT 1,
            confianca TEXT DEFAULT 'media',
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(fornecedor, categoria)
        );
    `);

    // ─── Índices ─────────────────────────────────────────
    await client.query(`
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
