/**
 * Routes: Card Statements
 * API endpoints for importing, listing, and managing credit card statements.
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { parsePdfFatura } = require('../../services/pdf-parser');
const { classificarItens, gerarResumo } = require('../../services/expense-classifier');
const logger = require('../../utils/logger');
const repo = require('../../repositories/card-statements-repo');

// Card name → financial account mapping (from card-rules.json)
const cardRulesPath = path.join(__dirname, '../../../config/card-rules.json');
const cardRules = JSON.parse(fs.readFileSync(cardRulesPath, 'utf-8'));

function getFinancialAccount(bancoDetectado) {
    const mapping = {
        'mercadopago': 'Cartão Mercado Pago',
        'caixa': 'Cartão Caixa',
        'cresol': 'Cartão Cresol',
        'santander': 'Cartão Santander',
    };
    const cardName = mapping[bancoDetectado] || bancoDetectado;
    const cardInfo = cardRules.cartoes?.[cardName];
    return {
        cardName,
        financialAccount: cardInfo?.conta_nome || null,
    };
}

/**
 * Gera nome de exibição padronizado: MM/YY - Cartão - {Fornecedor}
 * Ex: vencimento="15/02/2026", fornecedor="Caixa Econômica Federal"
 *  →  "02/26 - Cartão - Caixa Econômica Federal"
 */
function formatDisplayName(vencimento, fornecedor) {
    if (!vencimento || !fornecedor) return null;
    let mm, yy;
    if (vencimento.includes('-')) {
        const parts = vencimento.split('-');
        mm = parts[1];
        yy = parts[0].slice(-2);
    } else {
        const parts = vencimento.split('/');
        if (parts.length !== 3) return null;
        mm = parts[1].padStart(2, '0');
        yy = parts[2].slice(-2);
    }
    return `${mm}/${yy} - Cartão - ${fornecedor}`;
}

// Multer — upload PDF to memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Apenas arquivos PDF são aceitos'));
    },
});

/**
 * GET /api/card-statements
 * List all card statements with optional filters
 */
router.get('/', (req, res) => {
    try {
        const { card, dateFrom, dateTo, search } = req.query;
        const statements = repo.listStatements({ card, dateFrom, dateTo, search });
        res.json({ statements, total: statements.length });
    } catch (error) {
        logger.error(`❌ Erro ao listar extratos: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * GET /api/card-statements/cards
 * List distinct card names from imported statements + config
 */
router.get('/cards', (req, res) => {
    try {
        const fromDb = repo.getDistinctCards();
        const fromConfig = Object.keys(cardRules.cartoes || {});
        const all = [...new Set([...fromConfig, ...fromDb])].sort();
        res.json({ cards: all });
    } catch (error) {
        logger.error(`❌ Erro ao listar cartões: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * GET /api/card-statements/:id
 * Get statement detail with transactions
 */
router.get('/:id', (req, res) => {
    try {
        const statement = repo.getStatementById(req.params.id);
        if (!statement) {
            return res.status(404).json({ erro: 'Extrato não encontrado' });
        }
        const transactions = repo.getTransactions(statement.id);
        res.json({ statement, transactions });
    } catch (error) {
        logger.error(`❌ Erro ao buscar extrato: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/card-statements/upload
 * Upload a PDF, parse, classify, and save
 */
router.post('/upload', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhum arquivo PDF enviado' });
        }

        logger.info(`📤 Upload recebido: ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)}KB)`);

        // 1. Parse PDF
        const { banco, transacoes, metadados } = await parsePdfFatura(req.file.buffer);

        if (!transacoes || transacoes.length === 0) {
            return res.status(400).json({ erro: 'Nenhuma transação encontrada no PDF' });
        }

        // 2. Classify transactions
        const itensClassificados = classificarItens(transacoes);
        const resumo = gerarResumo(itensClassificados);

        // 3. Map card name and financial account
        const { cardName, financialAccount } = getFinancialAccount(banco);

        // 3.5 Check for duplicate: same card + same month/year
        const vencimentoRaw = metadados.vencimento || metadados.emissao || new Date().toISOString().slice(0, 10);
        const existing = repo.findDuplicateStatement(cardName, vencimentoRaw);
        if (existing) {
            logger.warn(`⚠️ Duplicata detectada: ${cardName} já tem extrato para este mês (ID ${existing.id}: "${existing.filename}")`);
            return res.status(409).json({
                erro: `Já existe um extrato de "${cardName}" importado para este mês`,
                existente: {
                    id: existing.id,
                    filename: existing.filename,
                    statement_date: existing.statement_date,
                },
            });
        }

        // 4. Calculate total
        const totalAmount = itensClassificados.reduce((sum, t) => sum + (t.valor || 0), 0);

        // 5. Generate standardized display name: MM/YY - Cartão - {Fornecedor}
        const cardInfo = cardRules.cartoes?.[cardName];
        const fornecedorNome = cardInfo?.fornecedor || cardName;
        const displayName = formatDisplayName(vencimentoRaw, fornecedorNome) || req.file.originalname;

        // 6. Save statement
        const statementId = repo.insertStatement({
            filename: displayName,
            card_name: cardName,
            financial_account: financialAccount,
            statement_date: vencimentoRaw,
            due_date: metadados.vencimento || null,
            total_transactions: itensClassificados.length,
            reconciled_count: 0,
            total_amount: totalAmount,
            raw_data: metadados,
        });

        // 7. Save transactions
        repo.insertTransactions(statementId, itensClassificados);

        // 8. Update counts (categorized_count based on classified transactions)
        repo.updateStatementCounts(statementId);

        logger.info(`✅ Extrato salvo: ID ${statementId}, "${displayName}", ${itensClassificados.length} transações`);

        res.json({
            id: statementId,
            filename: displayName,
            card_name: cardName,
            financial_account: financialAccount,
            total_transactions: itensClassificados.length,
            total_amount: totalAmount,
            resumo: {
                percentualClassificado: resumo.percentualClassificado,
                totalClassificado: resumo.totalClassificado,
                totalNaoClassificado: resumo.totalNaoClassificado,
            },
        });
    } catch (error) {
        logger.error(`❌ Erro no upload: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * DELETE /api/card-statements/:id
 * Remove a statement and all its transactions
 */
router.delete('/:id', (req, res) => {
    try {
        const statement = repo.getStatementById(req.params.id);
        if (!statement) {
            return res.status(404).json({ erro: 'Extrato não encontrado' });
        }
        repo.deleteStatement(req.params.id);
        logger.info(`🗑️  Extrato deletado: ID ${req.params.id}`);
        res.json({ ok: true, deleted: req.params.id });
    } catch (error) {
        logger.error(`❌ Erro ao deletar extrato: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * PATCH /api/card-statements/transactions/:id/category
 * Update category for a single transaction
 */
router.patch('/transactions/:id/category', (req, res) => {
    try {
        const { category } = req.body;
        if (!category) {
            return res.status(400).json({ erro: 'Categoria não informada' });
        }
        repo.updateTransactionCategory(req.params.id, category, 'manual');
        res.json({ ok: true });
    } catch (error) {
        logger.error(`❌ Erro ao atualizar categoria: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * PATCH /api/card-statements/transactions/:id/reconciled
 * Toggle reconciled status for a single transaction
 */
router.patch('/transactions/:id/reconciled', (req, res) => {
    try {
        const { reconciled } = req.body;
        if (reconciled === undefined) {
            return res.status(400).json({ erro: 'Campo reconciled não informado' });
        }
        repo.setTransactionReconciled(req.params.id, reconciled);

        // Update parent statement counts
        const db = require('../../database/connection').getDb();
        const row = db.prepare('SELECT statement_id FROM card_transactions WHERE id = ?').get(req.params.id);
        if (row) {
            repo.updateStatementCounts(row.statement_id);
        }

        res.json({ ok: true });
    } catch (error) {
        logger.error(`❌ Erro ao atualizar reconciliação: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

module.exports = router;
