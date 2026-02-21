/**
 * Categorization Routes — API de Categorização Automática
 *
 * Rotas para importação de dados ERP, cruzamento/conciliação
 * e categorização automática de movimentações financeiras.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const logger = require('../../utils/logger');
const { query, getClient } = require('../../database/connection');
const xlsParser = require('../../services/xls-parser');
const dataMatcher = require('../../services/data-matcher');

// ─── Multer: upload de XLS/XLSX ──────────────────────────
const upload = multer({
    dest: path.join(__dirname, '../../../.tmp/uploads'),
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.xls', '.xlsx'].includes(ext)) cb(null, true);
        else cb(new Error('Apenas arquivos .xls e .xlsx são aceitos'));
    },
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// Helper: upsert a batch of records into a table
async function upsertBatch(client, table, columns, conflictCol, records, getValues) {
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns
        .filter(c => c !== conflictCol)
        .map(c => `${c} = EXCLUDED.${c}`)
        .join(', ');

    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
                 ON CONFLICT(${conflictCol}) DO UPDATE SET ${updateSet}`;

    for (const r of records) {
        await client.query(sql, getValues(r));
    }
}

// ─── POST /import — Importa dados dos XLS default ────────
router.post('/import', async (req, res) => {
    try {
        const basePath = path.join(__dirname, '../../../dados-financeiros/exportacoes-erp');

        if (!fs.existsSync(basePath)) {
            return res.status(404).json({
                error: 'Pasta de exportações ERP não encontrada',
                path: basePath,
            });
        }

        logger.info('🔄 Iniciando importação de exportações ERP...');

        // Parse de todos os dados
        const data = xlsParser.parseAllExports(basePath);
        const client = await getClient();
        const results = {};

        try {
            await client.query('BEGIN');

            // ─── Contas a Pagar ──────
            if (data.contasPagar.length > 0) {
                const cols = ['olist_id', 'fornecedor', 'data_emissao', 'data_vencimento', 'data_liquidacao',
                    'valor', 'saldo', 'situacao', 'nro_documento', 'categoria', 'historico',
                    'valor_pago', 'competencia', 'forma_pagamento'];
                await upsertBatch(client, 'erp_contas_pagar', cols, 'olist_id', data.contasPagar,
                    r => [r.olist_id, r.fornecedor, r.data_emissao, r.data_vencimento,
                    r.data_liquidacao, r.valor, r.saldo, r.situacao, r.nro_documento,
                    r.categoria, r.historico, r.valor_pago, r.competencia, r.forma_pagamento]);
                results.contas_pagar = data.contasPagar.length;
            }

            // ─── Contas a Receber ────
            if (data.contasReceber.length > 0) {
                const cols = ['olist_id', 'cliente', 'data_emissao', 'data_vencimento', 'data_liquidacao',
                    'valor', 'saldo', 'situacao', 'nro_documento', 'nro_banco', 'categoria', 'historico',
                    'forma_recebimento', 'meio_recebimento', 'taxas', 'competencia',
                    'data_recebimento', 'valor_recebido'];
                await upsertBatch(client, 'erp_contas_receber', cols, 'olist_id', data.contasReceber,
                    r => [r.olist_id, r.cliente, r.data_emissao, r.data_vencimento,
                    r.data_liquidacao, r.valor, r.saldo, r.situacao, r.nro_documento,
                    r.nro_banco, r.categoria, r.historico, r.forma_recebimento,
                    r.meio_recebimento, r.taxas, r.competencia, r.data_recebimento,
                    r.valor_recebido]);
                results.contas_receber = data.contasReceber.length;
            }

            // ─── Fornecedores ────────
            if (data.fornecedores.length > 0) {
                const cols = ['olist_id', 'codigo', 'nome', 'fantasia', 'endereco', 'numero', 'complemento',
                    'bairro', 'cep', 'cidade', 'estado', 'telefone', 'celular', 'email',
                    'tipo_pessoa', 'cpf_cnpj', 'ie_rg', 'situacao', 'tipo_contato'];
                await upsertBatch(client, 'erp_fornecedores', cols, 'olist_id', data.fornecedores,
                    r => [r.olist_id, r.codigo, r.nome, r.fantasia, r.endereco,
                    r.numero, r.complemento, r.bairro, r.cep, r.cidade, r.estado,
                    r.telefone, r.celular, r.email, r.tipo_pessoa, r.cpf_cnpj,
                    r.ie_rg, r.situacao, r.tipo_contato]);
                results.fornecedores = data.fornecedores.length;
            }

            // ─── Plano de Contas ─────
            if (data.planoContas.length > 0) {
                const cols = ['olist_id', 'descricao', 'grupo', 'considera_dre', 'competencia_padrao'];
                await upsertBatch(client, 'erp_plano_contas', cols, 'olist_id', data.planoContas,
                    r => [r.olist_id, r.descricao, r.grupo, r.considera_dre, r.competencia_padrao]);
                results.plano_contas = data.planoContas.length;
            }

            // ─── Extratos Bancários ──
            let totalExtratos = 0;
            for (const [banco, registros] of Object.entries(data.extratosBanco)) {
                if (registros.length > 0) {
                    const cols = ['olist_id', 'data', 'categoria', 'historico', 'tipo', 'valor',
                        'contato', 'cnpj', 'marcadores', 'conta', 'nro_documento', 'banco'];
                    // Composite unique: (olist_id, banco) — use custom SQL
                    for (const r of registros) {
                        await client.query(`
                            INSERT INTO erp_extratos_banco (olist_id, data, categoria, historico, tipo, valor, contato, cnpj, marcadores, conta, nro_documento, banco)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                            ON CONFLICT(olist_id, banco) DO UPDATE SET
                                data = EXCLUDED.data, categoria = EXCLUDED.categoria, historico = EXCLUDED.historico,
                                tipo = EXCLUDED.tipo, valor = EXCLUDED.valor, contato = EXCLUDED.contato,
                                cnpj = EXCLUDED.cnpj, marcadores = EXCLUDED.marcadores, conta = EXCLUDED.conta,
                                nro_documento = EXCLUDED.nro_documento
                        `, [r.olist_id, r.data, r.categoria, r.historico, r.tipo,
                        r.valor, r.contato, r.cnpj, r.marcadores, r.conta,
                        r.nro_documento, r.banco]);
                    }
                    totalExtratos += registros.length;
                }
            }
            results.extratos_banco = totalExtratos;

            // ─── Investimentos ───────
            let totalInvest = 0;
            for (const [conta, registros] of Object.entries(data.investimentos)) {
                if (registros.length > 0) {
                    for (const r of registros) {
                        await client.query(`
                            INSERT INTO erp_investimentos (olist_id, data, categoria, historico, tipo, valor, contato, cnpj, marcadores, conta, nro_documento, banco)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                            ON CONFLICT(olist_id, banco) DO UPDATE SET
                                data = EXCLUDED.data, categoria = EXCLUDED.categoria, historico = EXCLUDED.historico,
                                tipo = EXCLUDED.tipo, valor = EXCLUDED.valor, contato = EXCLUDED.contato,
                                cnpj = EXCLUDED.cnpj, marcadores = EXCLUDED.marcadores, conta = EXCLUDED.conta,
                                nro_documento = EXCLUDED.nro_documento
                        `, [r.olist_id, r.data, r.categoria, r.historico, r.tipo,
                        r.valor, r.contato, r.cnpj, r.marcadores, r.conta,
                        r.nro_documento, r.banco]);
                    }
                    totalInvest += registros.length;
                }
            }
            results.investimentos = totalInvest;

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        // ─── Constrói mapa fornecedor→categoria ──
        const supplierMap = await dataMatcher.buildSupplierCategoryMap();
        await dataMatcher.saveSupplierCategoryMap(supplierMap);
        results.supplier_map_entries = Object.keys(supplierMap).length;

        // ─── Log ─────────────────
        const totalRecords = Object.values(results).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
        await query(
            `INSERT INTO erp_import_log (entity, file_name, records_imported, status) VALUES ('all', 'bulk-import', $1, 'success')`,
            [totalRecords]
        );

        logger.info(`✅ Importação concluída: ${JSON.stringify(results)}`);

        res.json({
            success: true,
            message: 'Importação concluída com sucesso',
            results,
        });
    } catch (err) {
        logger.error(`❌ Erro na importação: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /import/upload — Upload de XLS avulso ──────────
router.post('/import/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const type = req.body.type;
        const filePath = req.file.path;
        const fileName = req.file.originalname;

        let records = [];
        switch (type) {
            case 'contas_pagar':
                records = xlsParser.parseContasPagar(filePath);
                break;
            case 'contas_receber':
                records = xlsParser.parseContasReceber(filePath);
                break;
            case 'fornecedores':
                records = xlsParser.parseFornecedores(filePath);
                break;
            case 'plano_contas':
                records = xlsParser.parsePlanoContas(filePath);
                break;
            case 'extrato_banco':
                records = xlsParser.parseExtratoBanco(filePath, req.body.banco || 'desconhecido');
                break;
            default:
                fs.unlinkSync(filePath);
                return res.status(400).json({ error: `Tipo inválido: ${type}` });
        }

        fs.unlinkSync(filePath);

        res.json({
            success: true,
            type,
            fileName,
            records: records.length,
            preview: records.slice(0, 10),
        });
    } catch (err) {
        logger.error(`❌ Erro no upload: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /stats — Estatísticas ───────────────────────────
router.get('/stats', async (req, res) => {
    try {
        const stats = await dataMatcher.getMatcherStats();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /suppliers — Mapa fornecedor→categoria ──────────
router.get('/suppliers', async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let sql = 'SELECT * FROM erp_supplier_category_map';
        let countSql = 'SELECT COUNT(*) as total FROM erp_supplier_category_map';
        const params = [];
        let paramIdx = 1;

        if (search) {
            sql += ` WHERE fornecedor ILIKE $${paramIdx}`;
            countSql += ` WHERE fornecedor ILIKE $${paramIdx}`;
            params.push(`%${search.toUpperCase()}%`);
            paramIdx++;
        }

        const countParams = [...params];
        sql += ` ORDER BY frequencia DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(parseInt(limit), offset);

        const { rows } = await query(sql, params);
        const totalResult = await query(countSql, countParams);
        const total = parseInt(totalResult.rows[0]?.total) || 0;

        res.json({ rows, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /plano-contas — Plano de Contas ─────────────────
router.get('/plano-contas', async (req, res) => {
    try {
        const { rows } = await query(`
            SELECT descricao, grupo, considera_dre
            FROM erp_plano_contas
            ORDER BY descricao
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /reconcile — Conciliação cruzada ───────────────
router.post('/reconcile', async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ error: 'items deve ser um array' });
        }

        const results = await dataMatcher.reconcileItems(items);

        const matched = results.filter(r => r.confianca !== 'manual');
        const unmatched = results.filter(r => r.confianca === 'manual');

        res.json({
            total: results.length,
            matched: matched.length,
            unmatched: unmatched.length,
            percentage: results.length > 0
                ? ((matched.length / results.length) * 100).toFixed(1)
                : '0',
            results,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /teach — Ensina categorização ──────────────────
router.post('/teach', async (req, res) => {
    try {
        const { descricao, categoria } = req.body;
        if (!descricao || !categoria) {
            return res.status(400).json({ error: 'descricao e categoria são obrigatórios' });
        }

        const { salvarMapeamento } = require('../../services/expense-classifier');
        await salvarMapeamento(descricao, categoria);

        logger.info(`📝 Novo mapeamento ensinado: "${descricao}" → "${categoria}"`);

        res.json({ success: true, descricao, categoria });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /categories — Categorias disponíveis ────────────
router.get('/categories', async (req, res) => {
    try {
        const { rows: planoCats } = await query(`
            SELECT DISTINCT descricao as categoria, grupo
            FROM erp_plano_contas
            WHERE descricao != ''
            ORDER BY descricao
        `);

        const { rows: usedCats } = await query(`
            SELECT DISTINCT categoria, COUNT(*) as freq
            FROM erp_contas_pagar
            WHERE categoria != ''
            GROUP BY categoria
            ORDER BY freq DESC
        `);

        res.json({ plano_contas: planoCats, categorias_usadas: usedCats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /data/:entity — Dados importados ────────────────
router.get('/data/:entity', async (req, res) => {
    try {
        const { entity } = req.params;
        const { page = 1, limit = 50, search = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const tableMap = {
            contas_pagar: 'erp_contas_pagar',
            contas_receber: 'erp_contas_receber',
            fornecedores: 'erp_fornecedores',
            plano_contas: 'erp_plano_contas',
            extratos_banco: 'erp_extratos_banco',
            investimentos: 'erp_investimentos',
        };

        const table = tableMap[entity];
        if (!table) {
            return res.status(400).json({ error: `Entidade inválida: ${entity}` });
        }

        let sql = `SELECT * FROM ${table}`;
        let countSql = `SELECT COUNT(*) as total FROM ${table}`;
        const params = [];
        let paramIdx = 1;

        if (search) {
            const searchCols = {
                erp_contas_pagar: ['fornecedor', 'categoria', 'historico'],
                erp_contas_receber: ['cliente', 'categoria', 'historico'],
                erp_fornecedores: ['nome', 'fantasia', 'cpf_cnpj'],
                erp_plano_contas: ['descricao', 'grupo'],
                erp_extratos_banco: ['contato', 'categoria', 'historico'],
                erp_investimentos: ['contato', 'categoria', 'historico'],
            };

            const cols = searchCols[table] || [];
            if (cols.length > 0) {
                const clauses = cols.map(c => `${c} ILIKE $${paramIdx++}`).join(' OR ');
                sql += ` WHERE (${clauses})`;
                countSql += ` WHERE (${clauses})`;
                cols.forEach(() => params.push(`%${search}%`));
            }
        }

        const countParams = [...params];
        sql += ` ORDER BY id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(parseInt(limit), offset);

        const { rows } = await query(sql, params);
        const totalResult = await query(countSql, countParams);
        const total = parseInt(totalResult.rows[0]?.total) || 0;

        res.json({ rows, total, page: parseInt(page), limit: parseInt(limit), entity });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
