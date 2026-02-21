/**
 * Data Matcher — Motor de Cruzamento de Dados
 *
 * Cruza movimentações financeiras com dados do ERP para
 * categorização automática. Duas estratégias principais:
 *
 *   1. Por Fornecedor (nome/CNPJ) → herda categoria mais frequente
 *   2. Por Valor + Data (±1 dia) → vincula à conta a pagar/receber
 */

const { query, getClient } = require('../database/connection');
const logger = require('../utils/logger');

// ─── Cache do mapa fornecedor → categoria ────────────────

/**
 * Constrói mapa fornecedor → categoria mais frequente
 * a partir das contas a pagar importadas.
 *
 * Resultado: { "FORNECEDOR X": { categoria, frequencia, cnpj } }
 */
async function buildSupplierCategoryMap() {
    // Agrupa por fornecedor + categoria, conta frequência
    const { rows } = await query(`
        SELECT
            UPPER(TRIM(fornecedor)) as fornecedor_norm,
            categoria,
            COUNT(*) as freq
        FROM erp_contas_pagar
        WHERE categoria != '' AND fornecedor != ''
        GROUP BY UPPER(TRIM(fornecedor)), categoria
        ORDER BY UPPER(TRIM(fornecedor)), freq DESC
    `);

    // Para cada fornecedor, pega a categoria mais frequente
    const map = {};
    for (const row of rows) {
        if (!map[row.fornecedor_norm] || parseInt(row.freq) > map[row.fornecedor_norm].frequencia) {
            map[row.fornecedor_norm] = {
                categoria: row.categoria,
                frequencia: parseInt(row.freq),
            };
        }
    }

    // Enriquece com CNPJ dos fornecedores cadastrados
    const { rows: fornecedores } = await query(`
        SELECT UPPER(TRIM(nome)) as nome_norm, cpf_cnpj
        FROM erp_fornecedores
        WHERE cpf_cnpj != ''
    `);

    const cnpjMap = {};
    for (const f of fornecedores) {
        cnpjMap[f.nome_norm] = f.cpf_cnpj;
    }

    // Mescla
    for (const [forn, info] of Object.entries(map)) {
        map[forn].cnpj = cnpjMap[forn] || '';
    }

    // Também indexa por CNPJ nos extratos
    const { rows: extratoCnpjs } = await query(`
        SELECT
            UPPER(TRIM(contato)) as contato_norm,
            cnpj,
            categoria,
            COUNT(*) as freq
        FROM erp_extratos_banco
        WHERE cnpj != '' AND categoria != '' AND contato != ''
        GROUP BY UPPER(TRIM(contato)), categoria, cnpj
        ORDER BY UPPER(TRIM(contato)), freq DESC
    `);

    for (const row of extratoCnpjs) {
        if (!map[row.contato_norm] || parseInt(row.freq) > map[row.contato_norm].frequencia) {
            map[row.contato_norm] = {
                categoria: row.categoria,
                frequencia: parseInt(row.freq),
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
async function saveSupplierCategoryMap(map) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        for (const [forn, info] of Object.entries(map)) {
            await client.query(`
                INSERT INTO erp_supplier_category_map (fornecedor, cpf_cnpj, categoria, frequencia, confianca)
                VALUES ($1, $2, $3, $4, 'media')
                ON CONFLICT(fornecedor, categoria) DO UPDATE SET
                    cpf_cnpj = EXCLUDED.cpf_cnpj,
                    frequencia = EXCLUDED.frequencia,
                    updated_at = NOW()
            `, [forn, info.cnpj || '', info.categoria, info.frequencia]);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

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
async function matchByValueAndDate(valor, data, toleranceDays = 1) {
    if (!valor || !data) return null;

    // Busca contas a pagar com mesmo valor e data próxima
    // PostgreSQL: use date arithmetic instead of julianday
    const { rows } = await query(`
        SELECT olist_id, fornecedor, categoria, data_vencimento, data_liquidacao, valor
        FROM erp_contas_pagar
        WHERE ABS(valor - $1) < 0.01
          AND categoria != ''
          AND (
              ABS(CAST(data_vencimento AS DATE) - CAST($2 AS DATE)) <= $3
              OR ABS(CAST(data_liquidacao AS DATE) - CAST($2 AS DATE)) <= $3
          )
        ORDER BY ABS(CAST(data_vencimento AS DATE) - CAST($2 AS DATE))
        LIMIT 1
    `, [valor, data, toleranceDays]);

    if (rows.length > 0) {
        const row = rows[0];
        return {
            categoria: row.categoria,
            confianca: 'media',
            match: `valor+data: R$${parseFloat(row.valor).toFixed(2)} — ${row.fornecedor} (${row.data_vencimento})`,
            olist_id: row.olist_id,
        };
    }

    // Tenta também nos extratos bancários (já categorizados)
    const { rows: extratoRows } = await query(`
        SELECT olist_id, contato, categoria, data, valor
        FROM erp_extratos_banco
        WHERE ABS(valor - $1) < 0.01
          AND categoria != ''
          AND ABS(CAST(data AS DATE) - CAST($2 AS DATE)) <= $3
        ORDER BY ABS(CAST(data AS DATE) - CAST($2 AS DATE))
        LIMIT 1
    `, [valor, data, toleranceDays]);

    if (extratoRows.length > 0) {
        const row = extratoRows[0];
        return {
            categoria: row.categoria,
            confianca: 'media',
            match: `extrato banco: R$${parseFloat(row.valor).toFixed(2)} — ${row.contato} (${row.data})`,
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
async function reconcileItems(movimentacoes) {
    const supplierMap = await buildSupplierCategoryMap();
    let matched = 0;

    const results = [];
    for (const item of movimentacoes) {
        // Camada 3: Cruzamento por fornecedor
        const supplierMatch = matchBySupplier(item.descricao || '', supplierMap);
        if (supplierMatch) {
            matched++;
            results.push({
                ...item,
                categoria: supplierMatch.categoria,
                confianca: supplierMatch.confianca,
                match_type: 'fornecedor',
                match_detail: supplierMatch.match,
            });
            continue;
        }

        // Camada 4: Cruzamento por valor + data
        const valueMatch = await matchByValueAndDate(item.valor, item.data);
        if (valueMatch) {
            matched++;
            results.push({
                ...item,
                categoria: valueMatch.categoria,
                confianca: valueMatch.confianca,
                match_type: 'valor_data',
                match_detail: valueMatch.match,
            });
            continue;
        }

        results.push({
            ...item,
            categoria: null,
            confianca: 'manual',
            match_type: null,
            match_detail: null,
        });
    }

    logger.info(`🔄 Conciliação: ${matched}/${movimentacoes.length} itens cruzados`);
    return results;
}

// ─── Estatísticas do mapa ────────────────────────────────

/**
 * Retorna estatísticas do mapa fornecedor→categoria.
 */
async function getMatcherStats() {
    const tables = [
        ['erp_contas_pagar', 'erp_contas_pagar'],
        ['erp_contas_receber', 'erp_contas_receber'],
        ['erp_fornecedores', 'erp_fornecedores'],
        ['erp_plano_contas', 'erp_plano_contas'],
        ['erp_extratos_banco', 'erp_extratos_banco'],
        ['erp_investimentos', 'erp_investimentos'],
        ['supplier_category_map', 'erp_supplier_category_map'],
    ];

    const counts = {};
    for (const [key, table] of tables) {
        const { rows } = await query(`SELECT COUNT(*) as c FROM ${table}`);
        counts[key] = parseInt(rows[0].c);
    }

    // Categorias únicas
    const { rows: uniqueCatsRows } = await query(`
        SELECT COUNT(DISTINCT categoria) as c
        FROM erp_contas_pagar WHERE categoria != ''
    `);
    const uniqueCats = parseInt(uniqueCatsRows[0].c) || 0;

    // Fornecedores com categoria
    const { rows: fornComCatRows } = await query(`
        SELECT COUNT(DISTINCT fornecedor) as c
        FROM erp_contas_pagar WHERE categoria != '' AND fornecedor != ''
    `);
    const fornComCat = parseInt(fornComCatRows[0].c) || 0;

    // Último import
    const { rows: lastImportRows } = await query(`
        SELECT * FROM erp_import_log ORDER BY id DESC LIMIT 1
    `);

    return {
        ...counts,
        unique_categories: uniqueCats,
        suppliers_with_category: fornComCat,
        last_import: lastImportRows[0] || null,
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
