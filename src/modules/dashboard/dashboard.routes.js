/**
 * Routes: Dashboard Stats
 * Aggregated data for the Dashboard page: KPIs, chart data, and alerts.
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../../database/connection');
const logger = require('../../utils/logger');

/**
 * GET /api/dashboard/stats
 * Returns all data needed by the Dashboard in a single request.
 */
router.get('/stats', (req, res) => {
    try {
        const db = getDb();

        // ─── KPIs ─────────────────────────────────────
        const totals = db.prepare(`
            SELECT 
                COUNT(*) as total_statements,
                COALESCE(SUM(total_transactions), 0) as total_transactions,
                COALESCE(SUM(categorized_count), 0) as total_categorized,
                COALESCE(SUM(total_transactions - COALESCE(categorized_count, 0)), 0) as total_pending,
                COALESCE(SUM(total_amount), 0) as total_amount
            FROM card_statements
        `).get();

        const distinctCards = db.prepare(
            'SELECT COUNT(DISTINCT card_name) as count FROM card_statements'
        ).get();

        const pctCategorized = totals.total_transactions > 0
            ? Math.round((totals.total_categorized / totals.total_transactions) * 100)
            : 0;

        // ─── Chart: Gastos por Mês ────────────────────
        // Last 6 months, grouped by month and category
        const monthlyByCategory = db.prepare(`
            SELECT 
                strftime('%Y-%m', t.date) as month,
                t.category,
                COALESCE(SUM(t.amount), 0) as total
            FROM card_transactions t
            JOIN card_statements s ON t.statement_id = s.id
            WHERE t.date >= date('now', '-6 months')
              AND t.category IS NOT NULL 
              AND TRIM(t.category) != ''
              AND t.category NOT LIKE '%NÃO CLASSIFICADO%'
            GROUP BY month, t.category
            ORDER BY month ASC
        `).all();

        // Transform into chart-friendly format
        const months = [...new Set(monthlyByCategory.map(r => r.month))].sort();
        const categories = [...new Set(monthlyByCategory.map(r => r.category))].sort();

        const chartMonthly = {
            labels: months.map(m => {
                const [y, mo] = m.split('-');
                return `${mo}/${y.slice(2)}`;
            }),
            categories: categories.slice(0, 8), // Top 8 categories for readability
            datasets: categories.slice(0, 8).map(cat => ({
                label: cat,
                data: months.map(m => {
                    const row = monthlyByCategory.find(r => r.month === m && r.category === cat);
                    return row ? Math.round(row.total * 100) / 100 : 0;
                }),
            })),
        };

        // ─── Chart: Distribuição por Cartão ───────────
        const byCard = db.prepare(`
            SELECT 
                card_name,
                COALESCE(SUM(total_amount), 0) as total,
                COUNT(*) as count
            FROM card_statements
            GROUP BY card_name
            ORDER BY total DESC
        `).all();

        const chartByCard = {
            labels: byCard.map(r => r.card_name),
            data: byCard.map(r => Math.round(r.total * 100) / 100),
            counts: byCard.map(r => r.count),
        };

        // ─── Alerts: Faturas Pendentes ────────────────
        const pendingStatements = db.prepare(`
            SELECT id, filename, card_name, total_transactions, 
                   COALESCE(categorized_count, 0) as categorized_count,
                   total_transactions - COALESCE(categorized_count, 0) as pending_count
            FROM card_statements
            WHERE total_transactions > COALESCE(categorized_count, 0)
            ORDER BY pending_count DESC
            LIMIT 5
        `).all();

        // ─── Recent: Últimas 5 faturas ────────────────
        const recent = db.prepare(`
            SELECT id, filename, card_name, financial_account, statement_date,
                   total_transactions, COALESCE(categorized_count, 0) as categorized_count,
                   total_amount
            FROM card_statements
            ORDER BY statement_date DESC, created_at DESC
            LIMIT 5
        `).all();

        // ─── Progresso por Cartão ─────────────────────
        const cardProgress = db.prepare(`
            SELECT 
                card_name,
                SUM(total_transactions) as total_tx,
                SUM(COALESCE(categorized_count, 0)) as categorized_tx,
                SUM(total_amount) as total_amount,
                COUNT(*) as statement_count
            FROM card_statements
            GROUP BY card_name
            ORDER BY card_name
        `).all();

        // ─── Olist: última sincronização ──────────────
        let lastOlistSync = null;
        try {
            const syncRow = db.prepare(`
                SELECT MAX(updated_at) as last_sync FROM olist_contas_pagar
            `).get();
            lastOlistSync = syncRow?.last_sync || null;
        } catch (e) {
            // Table may not exist yet
        }

        res.json({
            kpis: {
                total_statements: totals.total_statements,
                total_transactions: totals.total_transactions,
                total_categorized: totals.total_categorized,
                total_pending: totals.total_pending,
                pct_categorized: pctCategorized,
                total_amount: totals.total_amount,
                distinct_cards: distinctCards.count,
                last_olist_sync: lastOlistSync,
            },
            charts: {
                monthly: chartMonthly,
                byCard: chartByCard,
            },
            alerts: pendingStatements,
            recent,
            cardProgress,
        });
    } catch (error) {
        logger.error(`❌ Erro no dashboard stats: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

module.exports = router;
