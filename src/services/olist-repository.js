/**
 * Olist Repository Service
 * 
 * Imports and caches Olist/Tiny ERP data locally in SQLite.
 * Purpose: Build training dataset for AI expense categorization.
 * 
 * Entities:
 *   - Contas a Pagar   (contas.pagar.pesquisa.php)
 *   - Contas a Receber  (contas.receber.pesquisa.php)
 *   - Contatos          (contatos.pesquisa.php)
 *   - Notas de Entrada  (notas.fiscais.pesquisa.php, tipo=E)
 */

const axios = require('axios');
const { getDb } = require('../database/connection');
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
                const saved = onBatch(records);
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
                ? erros.map(e => e.erro || e).join('; ')
                : JSON.stringify(erros);

            // "No records" is not really an error
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

function upsertContasPagar(records) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO olist_contas_pagar (olist_id, fornecedor, historico, categoria, valor, saldo, data_emissao, data_vencimento, nro_documento, situacao, competencia)
        VALUES (@olist_id, @fornecedor, @historico, @categoria, @valor, @saldo, @data_emissao, @data_vencimento, @nro_documento, @situacao, @competencia)
        ON CONFLICT(olist_id) DO UPDATE SET
            fornecedor = excluded.fornecedor,
            historico = excluded.historico,
            categoria = excluded.categoria,
            valor = excluded.valor,
            saldo = excluded.saldo,
            data_emissao = excluded.data_emissao,
            data_vencimento = excluded.data_vencimento,
            nro_documento = excluded.nro_documento,
            situacao = excluded.situacao,
            competencia = excluded.competencia,
            updated_at = datetime('now', 'localtime')
    `);

    const upsertMany = db.transaction((rows) => {
        for (const r of rows) {
            stmt.run({
                olist_id: String(r.id || ''),
                fornecedor: r.nome_cliente || r.cliente || '',
                historico: r.historico || '',
                categoria: r.categoria || '',
                valor: parseFloat(r.valor) || 0,
                saldo: parseFloat(r.saldo) || 0,
                data_emissao: r.data_emissao || '',
                data_vencimento: r.data_vencimento || r.vencimento || '',
                nro_documento: r.nro_documento || '',
                situacao: r.situacao || '',
                competencia: r.competencia || '',
            });
        }
    });

    upsertMany(records);
    return records.length;
}

function upsertContasReceber(records) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO olist_contas_receber (olist_id, cliente, historico, categoria, valor, saldo, data_emissao, data_vencimento, nro_documento, situacao, competencia)
        VALUES (@olist_id, @cliente, @historico, @categoria, @valor, @saldo, @data_emissao, @data_vencimento, @nro_documento, @situacao, @competencia)
        ON CONFLICT(olist_id) DO UPDATE SET
            cliente = excluded.cliente,
            historico = excluded.historico,
            categoria = excluded.categoria,
            valor = excluded.valor,
            saldo = excluded.saldo,
            data_emissao = excluded.data_emissao,
            data_vencimento = excluded.data_vencimento,
            nro_documento = excluded.nro_documento,
            situacao = excluded.situacao,
            competencia = excluded.competencia,
            updated_at = datetime('now', 'localtime')
    `);

    const upsertMany = db.transaction((rows) => {
        for (const r of rows) {
            stmt.run({
                olist_id: String(r.id || ''),
                cliente: r.nome_cliente || r.cliente || '',
                historico: r.historico || '',
                categoria: r.categoria || '',
                valor: parseFloat(r.valor) || 0,
                saldo: parseFloat(r.saldo) || 0,
                data_emissao: r.data_emissao || '',
                data_vencimento: r.data_vencimento || r.vencimento || '',
                nro_documento: r.nro_documento || '',
                situacao: r.situacao || '',
                competencia: r.competencia || '',
            });
        }
    });

    upsertMany(records);
    return records.length;
}

function upsertContatos(records) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO olist_contatos (olist_id, nome, fantasia, tipo_pessoa, cpf_cnpj, email, telefone, cidade, uf, situacao)
        VALUES (@olist_id, @nome, @fantasia, @tipo_pessoa, @cpf_cnpj, @email, @telefone, @cidade, @uf, @situacao)
        ON CONFLICT(olist_id) DO UPDATE SET
            nome = excluded.nome,
            fantasia = excluded.fantasia,
            tipo_pessoa = excluded.tipo_pessoa,
            cpf_cnpj = excluded.cpf_cnpj,
            email = excluded.email,
            telefone = excluded.telefone,
            cidade = excluded.cidade,
            uf = excluded.uf,
            situacao = excluded.situacao,
            updated_at = datetime('now', 'localtime')
    `);

    const upsertMany = db.transaction((rows) => {
        for (const r of rows) {
            stmt.run({
                olist_id: String(r.id || ''),
                nome: r.nome || '',
                fantasia: r.fantasia || r.nome_fantasia || '',
                tipo_pessoa: r.tipo_pessoa || '',
                cpf_cnpj: r.cpf_cnpj || '',
                email: r.email || '',
                telefone: r.fone || r.telefone || '',
                cidade: r.cidade || '',
                uf: r.uf || '',
                situacao: r.situacao || '',
            });
        }
    });

    upsertMany(records);
    return records.length;
}

function upsertNotasEntrada(records) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO olist_notas_entrada (olist_id, numero, serie, fornecedor, cliente, valor, data_emissao, situacao, tipo)
        VALUES (@olist_id, @numero, @serie, @fornecedor, @cliente, @valor, @data_emissao, @situacao, @tipo)
        ON CONFLICT(olist_id) DO UPDATE SET
            numero = excluded.numero,
            serie = excluded.serie,
            fornecedor = excluded.fornecedor,
            cliente = excluded.cliente,
            valor = excluded.valor,
            data_emissao = excluded.data_emissao,
            situacao = excluded.situacao,
            tipo = excluded.tipo,
            updated_at = datetime('now', 'localtime')
    `);

    const upsertMany = db.transaction((rows) => {
        for (const r of rows) {
            stmt.run({
                olist_id: String(r.id || ''),
                numero: r.numero || '',
                serie: r.serie || '',
                fornecedor: r.nome || r.nome_cliente || '',
                cliente: r.cliente?.nome || r.cliente || '',
                valor: parseFloat(r.valor) || 0,
                data_emissao: r.data_emissao || '',
                situacao: r.situacao || '',
                tipo: r.tipo || 'E',
            });
        }
    });

    upsertMany(records);
    return records.length;
}

// ─── High-level import functions ─────────────────────────

async function importContasPagar(onProgress = null) {
    logger.info('📥 Importando Contas a Pagar...');
    const db = getDb();

    const logId = db.prepare(
        `INSERT INTO olist_sync_log (entity, status) VALUES ('contas_pagar', 'running')`
    ).run().lastInsertRowid;

    try {
        const { totalSaved, pages } = await fetchAllPages(
            'contas.pagar.pesquisa.php', {}, onProgress,
            (batch) => upsertContasPagar(batch)
        );

        db.prepare(`
            UPDATE olist_sync_log SET status = 'done', records_imported = ?, pages_fetched = ?, finished_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(totalSaved, pages, logId);

        logger.info(`✅ Contas a Pagar: ${totalSaved} registros importados`);
        return { entity: 'contas_pagar', count: totalSaved, pages };
    } catch (err) {
        db.prepare(`
            UPDATE olist_sync_log SET status = 'error', error = ?, finished_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(err.message, logId);
        throw err;
    }
}

async function importContasReceber(onProgress = null) {
    logger.info('📥 Importando Contas a Receber...');
    const db = getDb();

    const logId = db.prepare(
        `INSERT INTO olist_sync_log (entity, status) VALUES ('contas_receber', 'running')`
    ).run().lastInsertRowid;

    try {
        const { totalSaved, pages } = await fetchAllPages(
            'contas.receber.pesquisa.php', {}, onProgress,
            (batch) => upsertContasReceber(batch)
        );

        db.prepare(`
            UPDATE olist_sync_log SET status = 'done', records_imported = ?, pages_fetched = ?, finished_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(totalSaved, pages, logId);

        logger.info(`✅ Contas a Receber: ${totalSaved} registros importados`);
        return { entity: 'contas_receber', count: totalSaved, pages };
    } catch (err) {
        db.prepare(`
            UPDATE olist_sync_log SET status = 'error', error = ?, finished_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(err.message, logId);
        throw err;
    }
}

async function importContatos(onProgress = null) {
    logger.info('📥 Importando Contatos (Fornecedores)...');
    const db = getDb();

    const logId = db.prepare(
        `INSERT INTO olist_sync_log (entity, status) VALUES ('contatos', 'running')`
    ).run().lastInsertRowid;

    try {
        const { totalSaved, pages } = await fetchAllPages(
            'contatos.pesquisa.php', {}, onProgress,
            (batch) => upsertContatos(batch)
        );

        db.prepare(`
            UPDATE olist_sync_log SET status = 'done', records_imported = ?, pages_fetched = ?, finished_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(totalSaved, pages, logId);

        logger.info(`✅ Contatos: ${totalSaved} registros importados`);
        return { entity: 'contatos', count: totalSaved, pages };
    } catch (err) {
        db.prepare(`
            UPDATE olist_sync_log SET status = 'error', error = ?, finished_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(err.message, logId);
        throw err;
    }
}

async function importNotasEntrada(onProgress = null) {
    logger.info('📥 Importando Notas Fiscais de Entrada...');
    const db = getDb();

    const logId = db.prepare(
        `INSERT INTO olist_sync_log (entity, status) VALUES ('notas_entrada', 'running')`
    ).run().lastInsertRowid;

    try {
        const { totalSaved, pages } = await fetchAllPages(
            'notas.fiscais.pesquisa.php', { tipo: 'E' }, onProgress,
            (batch) => upsertNotasEntrada(batch)
        );

        db.prepare(`
            UPDATE olist_sync_log SET status = 'done', records_imported = ?, pages_fetched = ?, finished_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(totalSaved, pages, logId);

        logger.info(`✅ Notas de Entrada: ${totalSaved} registros importados`);
        return { entity: 'notas_entrada', count: totalSaved, pages };
    } catch (err) {
        db.prepare(`
            UPDATE olist_sync_log SET status = 'error', error = ?, finished_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(err.message, logId);
        throw err;
    }
}

// ─── Stats & data access ────────────────────────────────

function getStats() {
    const db = getDb();

    const counts = {
        contas_pagar: db.prepare('SELECT COUNT(*) as c FROM olist_contas_pagar').get().c,
        contas_receber: db.prepare('SELECT COUNT(*) as c FROM olist_contas_receber').get().c,
        contatos: db.prepare('SELECT COUNT(*) as c FROM olist_contatos').get().c,
        notas_entrada: db.prepare('SELECT COUNT(*) as c FROM olist_notas_entrada').get().c,
    };

    // Last sync per entity
    const lastSync = {};
    for (const entity of Object.keys(counts)) {
        const row = db.prepare(
            `SELECT status, records_imported, finished_at FROM olist_sync_log WHERE entity = ? ORDER BY id DESC LIMIT 1`
        ).get(entity);
        lastSync[entity] = row || null;
    }

    // Financial summaries
    const summaries = {
        total_a_pagar: db.prepare(
            `SELECT COALESCE(SUM(valor), 0) as total FROM olist_contas_pagar WHERE situacao IN ('aberto', 'parcial')`
        ).get().total,
        total_a_receber: db.prepare(
            `SELECT COALESCE(SUM(valor), 0) as total FROM olist_contas_receber WHERE situacao IN ('aberto', 'parcial')`
        ).get().total,
        top_categorias: db.prepare(`
            SELECT categoria, COUNT(*) as count, SUM(valor) as total
            FROM olist_contas_pagar
            WHERE categoria != ''
            GROUP BY categoria
            ORDER BY count DESC
            LIMIT 10
        `).all(),
        top_fornecedores: db.prepare(`
            SELECT fornecedor, COUNT(*) as count, SUM(valor) as total
            FROM olist_contas_pagar
            WHERE fornecedor != ''
            GROUP BY fornecedor
            ORDER BY total DESC
            LIMIT 10
        `).all(),
    };

    return { counts, lastSync, summaries };
}

function getData(entity, { page = 1, limit = 50, search = '' } = {}) {
    const db = getDb();

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
    if (search) {
        // Search across text columns
        const searchCols = {
            olist_contas_pagar: ['fornecedor', 'historico', 'categoria', 'nro_documento'],
            olist_contas_receber: ['cliente', 'historico', 'categoria', 'nro_documento'],
            olist_contatos: ['nome', 'fantasia', 'cpf_cnpj', 'email', 'cidade'],
            olist_notas_entrada: ['numero', 'fornecedor', 'cliente'],
        };
        const cols = searchCols[table] || [];
        if (cols.length > 0) {
            const conditions = cols.map(c => `${c} LIKE ?`).join(' OR ');
            whereClause = `WHERE (${conditions})`;
            params = cols.map(() => `%${search}%`);
        }
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM ${table} ${whereClause}`).get(...params).c;
    const rows = db.prepare(`SELECT * FROM ${table} ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

    return {
        rows,
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
