#!/usr/bin/env node
/**
 * import-from-files.js — Importação direta de dados ERP via arquivos XLS/XLSX
 * 
 * Lê os arquivos exportados do Tiny ERP na pasta dados-financeiros/exportacoes-erp
 * e insere direto no PostgreSQL via UPSERT, sem depender da API.
 * 
 * Uso: node scripts/import-from-files.js
 * 
 * Pode ser re-executado sem duplicar dados (ON CONFLICT DO UPDATE).
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { query, getClient, pool } = require('../src/database/connection');

const BASE_DIR = path.join(__dirname, '..', 'dados-financeiros', 'exportacoes-erp');

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function readAllXls(dirPath) {
    if (!fs.existsSync(dirPath)) {
        console.log(`   ⚠️ Pasta não encontrada: ${dirPath}`);
        return [];
    }

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.xls') || f.endsWith('.xlsx'));
    const allRows = [];

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const wb = XLSX.readFile(filePath);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        allRows.push(...rows);
        console.log(`   📄 ${file}: ${rows.length} registros`);
    }

    return allRows;
}

function str(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

function num(val) {
    if (val === null || val === undefined) return 0;
    return parseFloat(val) || 0;
}

// ═══════════════════════════════════════════
// Import: Contas a Pagar
// ═══════════════════════════════════════════

async function importContasPagar() {
    console.log('\n📥 Importando CONTAS A PAGAR...');
    const rows = readAllXls(path.join(BASE_DIR, 'Contas a Pagar'));
    if (rows.length === 0) return 0;

    const client = await getClient();
    let imported = 0;

    try {
        await client.query('BEGIN');

        for (const r of rows) {
            await client.query(`
                INSERT INTO olist_contas_pagar (olist_id, fornecedor, historico, categoria, valor, saldo, data_emissao, data_vencimento, nro_documento, situacao, competencia)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT(olist_id) DO UPDATE SET
                    fornecedor = EXCLUDED.fornecedor,
                    historico = EXCLUDED.historico,
                    categoria = EXCLUDED.categoria,
                    valor = EXCLUDED.valor,
                    saldo = EXCLUDED.saldo,
                    data_emissao = EXCLUDED.data_emissao,
                    data_vencimento = EXCLUDED.data_vencimento,
                    nro_documento = EXCLUDED.nro_documento,
                    situacao = EXCLUDED.situacao,
                    competencia = EXCLUDED.competencia,
                    updated_at = NOW()
            `, [
                str(r['ID']),
                str(r['Fornecedor']),
                str(r['Histórico']),
                str(r['Categoria']),
                num(r['Valor documento']),
                num(r['Saldo']),
                str(r['Data Emissão']),
                str(r['Data Vencimento']),
                str(r['Número documento']),
                str(r['Situação']),
                str(r['Competência']),
            ]);
            imported++;
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    // Log de sync
    await query(
        `INSERT INTO olist_sync_log (entity, status, records_imported, pages_fetched, finished_at)
         VALUES ('contas_pagar', 'done', $1, 0, NOW())`,
        [imported]
    );

    console.log(`   ✅ ${imported} contas a pagar importadas`);
    return imported;
}

// ═══════════════════════════════════════════
// Import: Contas a Receber
// ═══════════════════════════════════════════

async function importContasReceber() {
    console.log('\n📥 Importando CONTAS A RECEBER...');
    const rows = readAllXls(path.join(BASE_DIR, 'Contas a Receber'));
    if (rows.length === 0) return 0;

    const client = await getClient();
    let imported = 0;

    try {
        await client.query('BEGIN');

        for (const r of rows) {
            await client.query(`
                INSERT INTO olist_contas_receber (olist_id, cliente, historico, categoria, valor, saldo, data_emissao, data_vencimento, nro_documento, situacao, competencia)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT(olist_id) DO UPDATE SET
                    cliente = EXCLUDED.cliente,
                    historico = EXCLUDED.historico,
                    categoria = EXCLUDED.categoria,
                    valor = EXCLUDED.valor,
                    saldo = EXCLUDED.saldo,
                    data_emissao = EXCLUDED.data_emissao,
                    data_vencimento = EXCLUDED.data_vencimento,
                    nro_documento = EXCLUDED.nro_documento,
                    situacao = EXCLUDED.situacao,
                    competencia = EXCLUDED.competencia,
                    updated_at = NOW()
            `, [
                str(r['ID']),
                str(r['Cliente']),
                str(r['Histórico']),
                str(r['Categoria']),
                num(r['Valor documento']),
                num(r['Saldo']),
                str(r['Data Emissão']),
                str(r['Data Vencimento']),
                str(r['Número documento']),
                str(r['Situação']),
                str(r['Competência']),
            ]);
            imported++;
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await query(
        `INSERT INTO olist_sync_log (entity, status, records_imported, pages_fetched, finished_at)
         VALUES ('contas_receber', 'done', $1, 0, NOW())`,
        [imported]
    );

    console.log(`   ✅ ${imported} contas a receber importadas`);
    return imported;
}

// ═══════════════════════════════════════════
// Import: Fornecedores (Contatos)
// ═══════════════════════════════════════════

async function importFornecedores() {
    console.log('\n📥 Importando FORNECEDORES...');
    const rows = readAllXls(path.join(BASE_DIR, 'Fornecedores'));
    if (rows.length === 0) return 0;

    const client = await getClient();
    let imported = 0;

    try {
        await client.query('BEGIN');

        for (const r of rows) {
            await client.query(`
                INSERT INTO olist_contatos (olist_id, nome, fantasia, tipo_pessoa, cpf_cnpj, email, telefone, cidade, uf, situacao)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT(olist_id) DO UPDATE SET
                    nome = EXCLUDED.nome,
                    fantasia = EXCLUDED.fantasia,
                    tipo_pessoa = EXCLUDED.tipo_pessoa,
                    cpf_cnpj = EXCLUDED.cpf_cnpj,
                    email = EXCLUDED.email,
                    telefone = EXCLUDED.telefone,
                    cidade = EXCLUDED.cidade,
                    uf = EXCLUDED.uf,
                    situacao = EXCLUDED.situacao,
                    updated_at = NOW()
            `, [
                str(r['ID']),
                str(r['Nome']),
                str(r['Fantasia']),
                str(r['Tipo pessoa']),
                str(r['CNPJ / CPF']),
                str(r['E-mail']),
                str(r['Fone']),
                str(r['Cidade']),
                str(r['Estado']),
                str(r['Situação']),
            ]);
            imported++;
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await query(
        `INSERT INTO olist_sync_log (entity, status, records_imported, pages_fetched, finished_at)
         VALUES ('contatos', 'done', $1, 0, NOW())`,
        [imported]
    );

    console.log(`   ✅ ${imported} fornecedores importados`);
    return imported;
}

// ═══════════════════════════════════════════
// Main
// ═══════════════════════════════════════════

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('📦 IMPORTAÇÃO DIRETA DE DADOS ERP');
    console.log(`   Base: ${BASE_DIR}`);
    console.log('═══════════════════════════════════════════');

    const startTime = Date.now();
    const results = {};

    try {
        results.contasPagar = await importContasPagar();
        results.contasReceber = await importContasReceber();
        results.fornecedores = await importFornecedores();
    } catch (err) {
        console.error(`\n❌ ERRO: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const total = Object.values(results).reduce((a, b) => a + b, 0);

    console.log('\n═══════════════════════════════════════════');
    console.log('📊 RESULTADO DA IMPORTAÇÃO');
    console.log(`   Contas a Pagar:   ${results.contasPagar}`);
    console.log(`   Contas a Receber: ${results.contasReceber}`);
    console.log(`   Fornecedores:     ${results.fornecedores}`);
    console.log(`   ────────────────────────`);
    console.log(`   TOTAL:            ${total} registros`);
    console.log(`   TEMPO:            ${elapsed}s`);
    console.log('═══════════════════════════════════════════');

    await pool.end();
    process.exit(0);
}

main();
