/**
 * Data Matcher — Motor de Cruzamento de Dados
 *
 * Cruza movimentações financeiras com dados do ERP para
 * categorização automática. Duas estratégias principais:
 *
 *   1. Por Fornecedor (nome/CNPJ) → herda categoria mais frequente
 *   2. Por Valor + Data (±1 dia) → vincula à conta a pagar/receber
 */

const { getDb } = require('../database/connection');
const logger = require('../utils/logger');

// ─── Cache do mapa fornecedor → categoria ────────────────

/**
 * Constrói mapa fornecedor → categoria mais frequente
 * a partir das contas a pagar importadas.
 *
 * Resultado: { "FORNECEDOR X": { categoria, frequencia, cnpj } }
 */
function buildSupplierCategoryMap() {
    const db = getDb();

    // Agrupa por fornecedor + categoria, conta frequência
    const rows = db.prepare(`
        SELECT
            UPPER(TRIM(fornecedor)) as fornecedor_norm,
            categoria,
            COUNT(*) as freq
        FROM erp_contas_pagar
        WHERE categoria != '' AND fornecedor != ''
        GROUP BY fornecedor_norm, categoria
        ORDER BY fornecedor_norm, freq DESC
    `).all();

    // Para cada fornecedor, pega a categoria mais frequente
    const map = {};
    for (const row of rows) {
        if (!map[row.fornecedor_norm] || row.freq > map[row.fornecedor_norm].frequencia) {
            map[row.fornecedor_norm] = {
                categoria: row.categoria,
                frequencia: row.freq,
            };
        }
    }

    // Enriquece com CNPJ dos fornecedores cadastrados
    const fornecedores = db.prepare(`
        SELECT UPPER(TRIM(nome)) as nome_norm, cpf_cnpj
        FROM erp_fornecedores
        WHERE cpf_cnpj != ''
    `).all();

    const cnpjMap = {};
    for (const f of fornecedores) {
        cnpjMap[f.nome_norm] = f.cpf_cnpj;
    }

    // Mescla
    for (const [forn, info] of Object.entries(map)) {
        map[forn].cnpj = cnpjMap[forn] || '';
    }

    // Também indexa por CNPJ nos extratos
    const extratoCnpjs = db.prepare(`
        SELECT
            UPPER(TRIM(contato)) as contato_norm,
            cnpj,
            categoria,
            COUNT(*) as freq
        FROM erp_extratos_banco
        WHERE cnpj != '' AND categoria != '' AND contato != ''
        GROUP BY contato_norm, categoria
        ORDER BY contato_norm, freq DESC
    `).all();

    for (const row of extratoCnpjs) {
        if (!map[row.contato_norm] || row.freq > map[row.contato_norm].frequencia) {
            map[row.contato_norm] = {
                categoria: row.categoria,
                frequencia: row.freq,
                cnpj: row.cnpj,
            };
        }
    }

    logger.info(`🗺️  Mapa fornecedor→categoria: ${Object.keys(map).length} entradas`);
    return map;
}

/**
 * Persiste o mapa fornecedor→categoria na tabela cache.
 */
function saveSupplierCategoryMap(map) {
    const db = getDb();
    const upsert = db.prepare(`
        INSERT INTO erp_supplier_category_map (fornecedor, cpf_cnpj, categoria, frequencia, confianca)
        VALUES (?, ?, ?, ?, 'media')
        ON CONFLICT(fornecedor, categoria) DO UPDATE SET
            cpf_cnpj = excluded.cpf_cnpj,
            frequencia = excluded.frequencia,
            updated_at = datetime('now', 'localtime')
    `);

    const tx = db.transaction(() => {
        for (const [forn, info] of Object.entries(map)) {
            upsert.run(forn, info.cnpj || '', info.categoria, info.frequencia);
        }
    });
    tx();

    logger.info(`💾 Mapa salvo: ${Object.keys(map).length} entradas`);
}

// ─── Cruzamento por Fornecedor ───────────────────────────

/**
 * Tenta encontrar a categoria de um item pelo nome do fornecedor.
 *
 * @param {string} descricao - Descrição da movimentação
 * @param {Object} supplierMap - Mapa fornecedor→categoria
 * @returns {{ categoria, confianca, match } | null}
 */
function matchBySupplier(descricao, supplierMap) {
    const descNorm = descricao.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // Match exato
    if (supplierMap[descNorm]) {
        return {
            categoria: supplierMap[descNorm].categoria,
            confianca: 'media',
            match: `fornecedor exato: "${descNorm}" (freq: ${supplierMap[descNorm].frequencia})`,
        };
    }

    // Match parcial: o nome do fornecedor está contido na descrição
    for (const [forn, info] of Object.entries(supplierMap)) {
        if (forn.length >= 4 && (descNorm.includes(forn) || forn.includes(descNorm))) {
            return {
                categoria: info.categoria,
                confianca: 'media',
                match: `fornecedor parcial: "${forn}" (freq: ${info.frequencia})`,
            };
        }
    }

    return null;
}

// ─── Cruzamento por Valor + Data ─────────────────────────

/**
 * Busca contas a pagar com o mesmo valor e data próxima.
 *
 * @param {number} valor - Valor da movimentação
 * @param {string} data - Data ISO (YYYY-MM-DD)
 * @param {number} toleranceDays - Dias de tolerância (padrão: 1)
 * @returns {{ categoria, confianca, match, olist_id } | null}
 */
function matchByValueAndDate(valor, data, toleranceDays = 1) {
    if (!valor || !data) return null;

    const db = getDb();

    // Busca contas a pagar com mesmo valor e data próxima
    const rows = db.prepare(`
        SELECT olist_id, fornecedor, categoria, data_vencimento, data_liquidacao, valor
        FROM erp_contas_pagar
        WHERE ABS(valor - ?) < 0.01
          AND categoria != ''
          AND (
              ABS(julianday(data_vencimento) - julianday(?)) <= ?
              OR ABS(julianday(data_liquidacao) - julianday(?)) <= ?
          )
        ORDER BY ABS(julianday(data_vencimento) - julianday(?))
        LIMIT 1
    `).all(valor, data, toleranceDays, data, toleranceDays, data);

    if (rows.length > 0) {
        const row = rows[0];
        return {
            categoria: row.categoria,
            confianca: 'media',
            match: `valor+data: R$${row.valor.toFixed(2)} — ${row.fornecedor} (${row.data_vencimento})`,
            olist_id: row.olist_id,
        };
    }

    // Tenta também nos extratos bancários (já categorizados)
    const extratoRows = db.prepare(`
        SELECT olist_id, contato, categoria, data, valor
        FROM erp_extratos_banco
        WHERE ABS(valor - ?) < 0.01
          AND categoria != ''
          AND ABS(julianday(data) - julianday(?)) <= ?
        ORDER BY ABS(julianday(data) - julianday(?))
        LIMIT 1
    `).all(valor, data, toleranceDays, data);

    if (extratoRows.length > 0) {
        const row = extratoRows[0];
        return {
            categoria: row.categoria,
            confianca: 'media',
            match: `extrato banco: R$${row.valor.toFixed(2)} — ${row.contato} (${row.data})`,
            olist_id: row.olist_id,
        };
    }

    return null;
}

// ─── Conciliação Cruzada Completa ────────────────────────

/**
 * Executa conciliação cruzada de uma lista de movimentações.
 *
 * @param {Array<{ descricao, valor, data }>} movimentacoes
 * @returns {Array<{ ...item, categoria, confianca, match_type, match_detail }>}
 */
function reconcileItems(movimentacoes) {
    const supplierMap = buildSupplierCategoryMap();
    let matched = 0;

    const results = movimentacoes.map(item => {
        // Camada 3: Cruzamento por fornecedor
        const supplierMatch = matchBySupplier(item.descricao || '', supplierMap);
        if (supplierMatch) {
            matched++;
            return {
                ...item,
                categoria: supplierMatch.categoria,
                confianca: supplierMatch.confianca,
                match_type: 'fornecedor',
                match_detail: supplierMatch.match,
            };
        }

        // Camada 4: Cruzamento por valor + data
        const valueMatch = matchByValueAndDate(item.valor, item.data);
        if (valueMatch) {
            matched++;
            return {
                ...item,
                categoria: valueMatch.categoria,
                confianca: valueMatch.confianca,
                match_type: 'valor_data',
                match_detail: valueMatch.match,
            };
        }

        return {
            ...item,
            categoria: null,
            confianca: 'manual',
            match_type: null,
            match_detail: null,
        };
    });

    logger.info(`🔄 Conciliação: ${matched}/${movimentacoes.length} itens cruzados`);
    return results;
}

// ─── Estatísticas do mapa ────────────────────────────────

/**
 * Retorna estatísticas do mapa fornecedor→categoria.
 */
function getMatcherStats() {
    const db = getDb();

    const cpCount = db.prepare('SELECT COUNT(*) as c FROM erp_contas_pagar').get()?.c || 0;
    const crCount = db.prepare('SELECT COUNT(*) as c FROM erp_contas_receber').get()?.c || 0;
    const fnCount = db.prepare('SELECT COUNT(*) as c FROM erp_fornecedores').get()?.c || 0;
    const pcCount = db.prepare('SELECT COUNT(*) as c FROM erp_plano_contas').get()?.c || 0;
    const ebCount = db.prepare('SELECT COUNT(*) as c FROM erp_extratos_banco').get()?.c || 0;
    const eiCount = db.prepare('SELECT COUNT(*) as c FROM erp_investimentos').get()?.c || 0;
    const mapCount = db.prepare('SELECT COUNT(*) as c FROM erp_supplier_category_map').get()?.c || 0;

    // Categorias únicas
    const uniqueCats = db.prepare(`
        SELECT COUNT(DISTINCT categoria) as c
        FROM erp_contas_pagar WHERE categoria != ''
    `).get()?.c || 0;

    // Fornecedores com categoria
    const fornComCat = db.prepare(`
        SELECT COUNT(DISTINCT fornecedor) as c
        FROM erp_contas_pagar WHERE categoria != '' AND fornecedor != ''
    `).get()?.c || 0;

    // Último import
    const lastImport = db.prepare(`
        SELECT * FROM erp_import_log ORDER BY id DESC LIMIT 1
    `).get();

    return {
        erp_contas_pagar: cpCount,
        erp_contas_receber: crCount,
        erp_fornecedores: fnCount,
        erp_plano_contas: pcCount,
        erp_extratos_banco: ebCount,
        erp_investimentos: eiCount,
        supplier_category_map: mapCount,
        unique_categories: uniqueCats,
        suppliers_with_category: fornComCat,
        last_import: lastImport || null,
    };
}

module.exports = {
    buildSupplierCategoryMap,
    saveSupplierCategoryMap,
    matchBySupplier,
    matchByValueAndDate,
    reconcileItems,
    getMatcherStats,
};
