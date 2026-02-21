/**
 * Olist Repository Service
 *
 * Imports and caches Olist/Tiny ERP data locally in PostgreSQL.
 * Purpose: Build training dataset for AI expense categorization.
 *
 * Entities:
 *   - Contas a Pagar   (contas.pagar.pesquisa.php)
 *   - Contas a Receber  (contas.receber.pesquisa.php)
 *   - Contatos          (contatos.pesquisa.php)
 *   - Notas de Entrada  (notas.fiscais.pesquisa.php, tipo=E)
 */

const axios = require('axios');
const { query, getClient } = require('../database/connection');
const logger = require('../utils/logger');

const TINY_API_BASE = 'https://api.tiny.com.br/api2';
const RATE_LIMIT_MS = 2100;

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function getToken() {
    const token = process.env.TINY_API_TOKEN;
    if (!token || token === 'placeholder') {
        throw new Error('TINY_API_TOKEN não configurado no .env');
    }
    return token;
}

// ─── Generic paginated fetcher ───────────────────────────

async function fetchAllPages(endpoint, extraParams = {}, onProgress = null, onBatch = null) {
    const token = getToken();
    let pagina = 1;
    let totalPaginas = 1;
    let totalSaved = 0;

    while (pagina <= totalPaginas) {
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('formato', 'json');
        params.append('pagina', String(pagina));

        for (const [key, value] of Object.entries(extraParams)) {
            if (value) params.append(key, value);
        }

        const { data: resposta } = await axios.post(
            `${TINY_API_BASE}/${endpoint}`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
            }
        );

        if (resposta.retorno?.status === 'OK') {
            totalPaginas = parseInt(resposta.retorno?.numero_paginas) || 1;
            const records = extractRecords(endpoint, resposta.retorno);

            // Save immediately if onBatch callback provided
            if (onBatch && records.length > 0) {
                const saved = await onBatch(records);
                totalSaved += (typeof saved === 'number' ? saved : records.length);
            }

            if (onProgress) {
                onProgress({
                    page: pagina,
                    totalPages: totalPaginas,
                    recordsThisPage: records.length,
                    totalRecords: totalSaved,
                });
            }

            logger.info(`   📄 Página ${pagina}/${totalPaginas}: ${records.length} registros (${totalSaved} salvos)`);
        } else {
            const erros = resposta.retorno?.erros || [];
            const msgErro = Array.isArray(erros)
                ? erros.map(e => {
                    const val = e.erro || e;
                    return typeof val === 'object' ? JSON.stringify(val) : val;
                }).join('; ')
                : JSON.stringify(erros);

            if (msgErro.includes('Nenhum registro') || msgErro.includes('não retornou registros')) {
                logger.info(`   📄 Página ${pagina}: nenhum registro`);
                break;
            }

            throw new Error(`Erro API Tiny (${endpoint}): ${msgErro}`);
        }

        pagina++;
        if (pagina <= totalPaginas) {
            await sleep(RATE_LIMIT_MS);
        }
    }

    return { totalSaved, pages: totalPaginas };
}

function extractRecords(endpoint, retorno) {
    if (endpoint.includes('contas.pagar')) {
        return (retorno.contas || []).map(c => c.conta || c);
    }
    if (endpoint.includes('contas.receber')) {
        return (retorno.contas || []).map(c => c.conta || c);
    }
    if (endpoint.includes('contatos')) {
        return (retorno.contatos || []).map(c => c.contato || c);
    }
    if (endpoint.includes('notas.fiscais')) {
        return (retorno.notas_fiscais || retorno.notas || []).map(n => n.nota_fiscal || n.nota || n);
    }
    return [];
}

// ─── UPSERT functions ────────────────────────────────────

async function upsertContasPagar(records) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        for (const r of records) {
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
                String(r.id || ''),
                r.nome_cliente || r.cliente || '',
                r.historico || '',
                r.categoria || '',
                parseFloat(r.valor) || 0,
                parseFloat(r.saldo) || 0,
                r.data_emissao || '',
                r.data_vencimento || r.vencimento || '',
                r.nro_documento || '',
                r.situacao || '',
                r.competencia || '',
            ]);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    return records.length;
}

async function upsertContasReceber(records) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        for (const r of records) {
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
                String(r.id || ''),
                r.nome_cliente || r.cliente || '',
                r.historico || '',
                r.categoria || '',
                parseFloat(r.valor) || 0,
                parseFloat(r.saldo) || 0,
                r.data_emissao || '',
                r.data_vencimento || r.vencimento || '',
                r.nro_documento || '',
                r.situacao || '',
                r.competencia || '',
            ]);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    return records.length;
}

async function upsertContatos(records) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        for (const r of records) {
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
                String(r.id || ''),
                r.nome || '',
                r.fantasia || r.nome_fantasia || '',
                r.tipo_pessoa || '',
                r.cpf_cnpj || '',
                r.email || '',
                r.fone || r.telefone || '',
                r.cidade || '',
                r.uf || '',
                r.situacao || '',
            ]);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    return records.length;
}

async function upsertNotasEntrada(records) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        for (const r of records) {
            await client.query(`
                INSERT INTO olist_notas_entrada (olist_id, numero, serie, fornecedor, cliente, valor, data_emissao, situacao, tipo)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT(olist_id) DO UPDATE SET
                    numero = EXCLUDED.numero,
                    serie = EXCLUDED.serie,
                    fornecedor = EXCLUDED.fornecedor,
                    cliente = EXCLUDED.cliente,
                    valor = EXCLUDED.valor,
                    data_emissao = EXCLUDED.data_emissao,
                    situacao = EXCLUDED.situacao,
                    tipo = EXCLUDED.tipo,
                    updated_at = NOW()
            `, [
                String(r.id || ''),
                r.numero || '',
                r.serie || '',
                r.nome || r.nome_cliente || '',
                r.cliente?.nome || r.cliente || '',
                parseFloat(r.valor) || 0,
                r.data_emissao || '',
                r.situacao || '',
                r.tipo || 'E',
            ]);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    return records.length;
}

// ─── High-level import functions ─────────────────────────

async function importContasPagar(onProgress = null) {
    logger.info('📥 Importando Contas a Pagar...');

    const { rows } = await query(
        `INSERT INTO olist_sync_log (entity, status) VALUES ('contas_pagar', 'running') RETURNING id`
    );
    const logId = rows[0].id;

    try {
        const { totalSaved, pages } = await fetchAllPages(
            'contas.pagar.pesquisa.php', {}, onProgress,
            (batch) => upsertContasPagar(batch)
        );

        await query(
            `UPDATE olist_sync_log SET status = 'done', records_imported = $1, pages_fetched = $2, finished_at = NOW() WHERE id = $3`,
            [totalSaved, pages, logId]
        );

        logger.info(`✅ Contas a Pagar: ${totalSaved} registros importados`);
        return { entity: 'contas_pagar', count: totalSaved, pages };
    } catch (err) {
        await query(
            `UPDATE olist_sync_log SET status = 'error', error = $1, finished_at = NOW() WHERE id = $2`,
            [err.message, logId]
        );
        throw err;
    }
}

async function importContasReceber(onProgress = null) {
    logger.info('📥 Importando Contas a Receber...');

    const { rows } = await query(
        `INSERT INTO olist_sync_log (entity, status) VALUES ('contas_receber', 'running') RETURNING id`
    );
    const logId = rows[0].id;

    try {
        const { totalSaved, pages } = await fetchAllPages(
            'contas.receber.pesquisa.php', {}, onProgress,
            (batch) => upsertContasReceber(batch)
        );

        await query(
            `UPDATE olist_sync_log SET status = 'done', records_imported = $1, pages_fetched = $2, finished_at = NOW() WHERE id = $3`,
            [totalSaved, pages, logId]
        );

        logger.info(`✅ Contas a Receber: ${totalSaved} registros importados`);
        return { entity: 'contas_receber', count: totalSaved, pages };
    } catch (err) {
        await query(
            `UPDATE olist_sync_log SET status = 'error', error = $1, finished_at = NOW() WHERE id = $2`,
            [err.message, logId]
        );
        throw err;
    }
}

async function importContatos(onProgress = null) {
    logger.info('📥 Importando Contatos (Fornecedores)...');

    const { rows } = await query(
        `INSERT INTO olist_sync_log (entity, status) VALUES ('contatos', 'running') RETURNING id`
    );
    const logId = rows[0].id;

    try {
        const { totalSaved, pages } = await fetchAllPages(
            'contatos.pesquisa.php', {}, onProgress,
            (batch) => upsertContatos(batch)
        );

        await query(
            `UPDATE olist_sync_log SET status = 'done', records_imported = $1, pages_fetched = $2, finished_at = NOW() WHERE id = $3`,
            [totalSaved, pages, logId]
        );

        logger.info(`✅ Contatos: ${totalSaved} registros importados`);
        return { entity: 'contatos', count: totalSaved, pages };
    } catch (err) {
        await query(
            `UPDATE olist_sync_log SET status = 'error', error = $1, finished_at = NOW() WHERE id = $2`,
            [err.message, logId]
        );
        throw err;
    }
}

async function importNotasEntrada(onProgress = null) {
    logger.info('📥 Importando Notas Fiscais de Entrada...');

    const { rows } = await query(
        `INSERT INTO olist_sync_log (entity, status) VALUES ('notas_entrada', 'running') RETURNING id`
    );
    const logId = rows[0].id;

    try {
        const { totalSaved, pages } = await fetchAllPages(
            'notas.fiscais.pesquisa.php', { tipo: 'E' }, onProgress,
            (batch) => upsertNotasEntrada(batch)
        );

        await query(
            `UPDATE olist_sync_log SET status = 'done', records_imported = $1, pages_fetched = $2, finished_at = NOW() WHERE id = $3`,
            [totalSaved, pages, logId]
        );

        logger.info(`✅ Notas de Entrada: ${totalSaved} registros importados`);
        return { entity: 'notas_entrada', count: totalSaved, pages };
    } catch (err) {
        await query(
            `UPDATE olist_sync_log SET status = 'error', error = $1, finished_at = NOW() WHERE id = $2`,
            [err.message, logId]
        );
        throw err;
    }
}

// ─── Stats & data access ────────────────────────────────

async function getStats() {
    const counts = {};
    for (const [key, table] of Object.entries({
        contas_pagar: 'olist_contas_pagar',
        contas_receber: 'olist_contas_receber',
        contatos: 'olist_contatos',
        notas_entrada: 'olist_notas_entrada',
    })) {
        const { rows } = await query(`SELECT COUNT(*) as c FROM ${table}`);
        counts[key] = parseInt(rows[0].c);
    }

    // Last sync per entity
    const lastSync = {};
    for (const entity of Object.keys(counts)) {
        const { rows } = await query(
            `SELECT status, records_imported, finished_at FROM olist_sync_log WHERE entity = $1 ORDER BY id DESC LIMIT 1`,
            [entity]
        );
        lastSync[entity] = rows[0] || null;
    }

    // Financial summaries
    const totalAPagarResult = await query(
        `SELECT COALESCE(SUM(valor), 0) as total FROM olist_contas_pagar WHERE situacao IN ('aberto', 'parcial')`
    );
    const totalAReceberResult = await query(
        `SELECT COALESCE(SUM(valor), 0) as total FROM olist_contas_receber WHERE situacao IN ('aberto', 'parcial')`
    );
    const topCategoriasResult = await query(`
        SELECT categoria, COUNT(*) as count, SUM(valor) as total
        FROM olist_contas_pagar
        WHERE categoria != ''
        GROUP BY categoria
        ORDER BY count DESC
        LIMIT 10
    `);
    const topFornecedoresResult = await query(`
        SELECT fornecedor, COUNT(*) as count, SUM(valor) as total
        FROM olist_contas_pagar
        WHERE fornecedor != ''
        GROUP BY fornecedor
        ORDER BY total DESC
        LIMIT 10
    `);

    const summaries = {
        total_a_pagar: parseFloat(totalAPagarResult.rows[0].total),
        total_a_receber: parseFloat(totalAReceberResult.rows[0].total),
        top_categorias: topCategoriasResult.rows,
        top_fornecedores: topFornecedoresResult.rows,
    };

    return { counts, lastSync, summaries };
}

async function getData(entity, { page = 1, limit = 50, search = '' } = {}) {
    const tableMap = {
        contas_pagar: 'olist_contas_pagar',
        contas_receber: 'olist_contas_receber',
        contatos: 'olist_contatos',
        notas_entrada: 'olist_notas_entrada',
    };

    const table = tableMap[entity];
    if (!table) throw new Error(`Entidade inválida: ${entity}`);

    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];
    let paramIdx = 1;

    if (search) {
        const searchCols = {
            olist_contas_pagar: ['fornecedor', 'historico', 'categoria', 'nro_documento'],
            olist_contas_receber: ['cliente', 'historico', 'categoria', 'nro_documento'],
            olist_contatos: ['nome', 'fantasia', 'cpf_cnpj', 'email', 'cidade'],
            olist_notas_entrada: ['numero', 'fornecedor', 'cliente'],
        };
        const cols = searchCols[table] || [];
        if (cols.length > 0) {
            const conditions = cols.map(c => `${c} ILIKE $${paramIdx++}`).join(' OR ');
            whereClause = `WHERE (${conditions})`;
            params = cols.map(() => `%${search}%`);
        }
    }

    const totalResult = await query(`SELECT COUNT(*) as c FROM ${table} ${whereClause}`, params);
    const total = parseInt(totalResult.rows[0].c);

    const rowsResult = await query(
        `SELECT * FROM ${table} ${whereClause} ORDER BY id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset]
    );

    return {
        rows: rowsResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
    };
}

module.exports = {
    importContasPagar,
    importContasReceber,
    importContatos,
    importNotasEntrada,
    getStats,
    getData,
};
