/**
 * Dashboard Routes — Estatísticas e KPIs
 */
const express = require('express');
const router = express.Router();
const { query } = require('../../database/connection');
const logger = require('../../utils/logger');

// ─── GET /stats — Dashboard Statistics ───────────────────
router.get('/stats', async (req, res) => {
    try {
        // Total de faturas
        const stmtResult = await query('SELECT COUNT(*) as total, COALESCE(SUM(total_amount), 0) as total_amount FROM card_statements');
        const totalStatements = parseInt(stmtResult.rows[0].total);
        const totalAmount = parseFloat(stmtResult.rows[0].total_amount);

        // Transações
        const txResult = await query('SELECT COUNT(*) as total FROM card_transactions');
        const totalTransactions = parseInt(txResult.rows[0].total);

        // Categorizadas
        const catResult = await query(`
            SELECT COUNT(*) as total FROM card_transactions
            WHERE category IS NOT NULL AND TRIM(category) != '' AND category NOT LIKE '%NÃO CLASSIFICADO%'
        `);
        const categorizedCount = parseInt(catResult.rows[0].total);

        // Conciliadas
        const recResult = await query('SELECT COUNT(*) as total FROM card_transactions WHERE reconciled = 1');
        const reconciledCount = parseInt(recResult.rows[0].total);

        // Gastos por mês (últimos 6 meses)
        const monthlyResult = await query(`
            SELECT
                SUBSTRING(t.date FROM 1 FOR 7) as month,
                COALESCE(SUM(ABS(t.amount)), 0) as total
            FROM card_transactions t
            JOIN card_statements s ON s.id = t.statement_id
            WHERE t.date >= TO_CHAR(NOW() - INTERVAL '6 months', 'YYYY-MM-DD')
            GROUP BY SUBSTRING(t.date FROM 1 FOR 7)
            ORDER BY month ASC
        `);

        // Top categorias
        const topCatsResult = await query(`
            SELECT category, COUNT(*) as count, COALESCE(SUM(ABS(amount)), 0) as total
            FROM card_transactions
            WHERE category IS NOT NULL AND TRIM(category) != '' AND category NOT LIKE '%NÃO CLASSIFICADO%'
            GROUP BY category
            ORDER BY total DESC
            LIMIT 10
        `);

        // Cartões ativos
        const cardsResult = await query('SELECT DISTINCT card_name FROM card_statements ORDER BY card_name');

        res.json({
            totalStatements,
            totalAmount,
            totalTransactions,
            categorizedCount,
            reconciledCount,
            categorizationRate: totalTransactions > 0
                ? ((categorizedCount / totalTransactions) * 100).toFixed(1)
                : '0',
            monthlySpending: monthlyResult.rows.map(r => ({
                month: r.month,
                total: parseFloat(r.total),
            })),
            topCategories: topCatsResult.rows.map(r => ({
                category: r.category,
                count: parseInt(r.count),
                total: parseFloat(r.total),
            })),
            activeCards: cardsResult.rows.map(r => r.card_name),
        });
    } catch (err) {
        logger.error('Erro ao carregar dashboard:', err);
        res.status(500).json({ error: 'Erro ao carregar estatísticas do dashboard' });
    }
});

module.exports = router;
