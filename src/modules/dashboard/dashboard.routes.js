/**
 * Dashboard Routes — Estatísticas e KPIs
 *
 * Retorna dados estruturados para o frontend:
 *   { kpis, alerts, charts, recent, cardProgress, erp }
 */
const express = require('express');
const router = express.Router();
const { query } = require('../../database/connection');
const logger = require('../../utils/logger');

// ─── GET /stats — Dashboard Statistics ───────────────────
router.get('/stats', async (req, res) => {
    try {
        // ── 1. KPIs ──────────────────────────────────────
        const stmtResult = await query(`
            SELECT
                COUNT(*) as total,
                COALESCE(SUM(total_amount), 0) as total_amount,
                COUNT(DISTINCT card_name) as distinct_cards
            FROM card_statements
        `);
        const totalStatements = parseInt(stmtResult.rows[0].total);
        const totalAmount = parseFloat(stmtResult.rows[0].total_amount);
        const distinctCards = parseInt(stmtResult.rows[0].distinct_cards);

        const txResult = await query('SELECT COUNT(*) as total FROM card_transactions');
        const totalTransactions = parseInt(txResult.rows[0].total);

        const catResult = await query(`
            SELECT COUNT(*) as total FROM card_transactions
            WHERE category IS NOT NULL AND TRIM(category) != '' AND category NOT LIKE '%NÃO CLASSIFICADO%'
        `);
        const totalCategorized = parseInt(catResult.rows[0].total);
        const totalPending = totalTransactions - totalCategorized;
        const pctCategorized = totalTransactions > 0
            ? parseFloat(((totalCategorized / totalTransactions) * 100).toFixed(1))
            : 0;

        // Conciliadas
        const recResult = await query('SELECT COUNT(*) as total FROM card_transactions WHERE reconciled = 1');
        const reconciledCount = parseInt(recResult.rows[0].total);
        const pctReconciled = totalTransactions > 0
            ? parseFloat(((reconciledCount / totalTransactions) * 100).toFixed(1))
            : 0;

        // Última sincronização com Olist
        let lastOlistSync = null;
        try {
            const syncResult = await query('SELECT MAX(created_at) as last_sync FROM sent_transactions');
            if (syncResult.rows[0].last_sync) {
                lastOlistSync = syncResult.rows[0].last_sync;
            }
        } catch (_) {
            // tabela pode não existir ainda
        }

        // ── 1b. Trends (comparação com mês anterior) ────
        let trendAmount = 0;
        let trendTransactions = 0;
        try {
            const currentMonthResult = await query(`
                SELECT COALESCE(SUM(ABS(t.amount)), 0) as total, COUNT(*) as count
                FROM card_transactions t
                WHERE t.date >= TO_CHAR(DATE_TRUNC('month', NOW()), 'YYYY-MM-DD')
            `);
            const prevMonthResult = await query(`
                SELECT COALESCE(SUM(ABS(t.amount)), 0) as total, COUNT(*) as count
                FROM card_transactions t
                WHERE t.date >= TO_CHAR(DATE_TRUNC('month', NOW() - INTERVAL '1 month'), 'YYYY-MM-DD')
                  AND t.date < TO_CHAR(DATE_TRUNC('month', NOW()), 'YYYY-MM-DD')
            `);
            const curAmt = parseFloat(currentMonthResult.rows[0].total);
            const prevAmt = parseFloat(prevMonthResult.rows[0].total);
            const curCount = parseInt(currentMonthResult.rows[0].count);
            const prevCount = parseInt(prevMonthResult.rows[0].count);

            trendAmount = prevAmt > 0 ? parseFloat((((curAmt - prevAmt) / prevAmt) * 100).toFixed(1)) : 0;
            trendTransactions = prevCount > 0 ? parseFloat((((curCount - prevCount) / prevCount) * 100).toFixed(1)) : 0;
        } catch (_) { /* ignore */ }

        // ── 1c. Sparklines (últimos 12 meses) ────────────
        let sparklineMonthly = [];
        try {
            const sparkResult = await query(`
                SELECT
                    SUBSTRING(t.date FROM 1 FOR 7) as month,
                    COALESCE(SUM(ABS(t.amount)), 0) as total
                FROM card_transactions t
                WHERE t.date >= TO_CHAR(NOW() - INTERVAL '12 months', 'YYYY-MM-DD')
                GROUP BY SUBSTRING(t.date FROM 1 FOR 7)
                ORDER BY month ASC
            `);
            sparklineMonthly = sparkResult.rows.map(r => parseFloat(r.total));
        } catch (_) { /* ignore */ }

        const kpis = {
            total_statements: totalStatements,
            distinct_cards: distinctCards,
            total_categorized: totalCategorized,
            pct_categorized: pctCategorized,
            total_transactions: totalTransactions,
            total_pending: totalPending,
            total_amount: totalAmount,
            reconciled_count: reconciledCount,
            pct_reconciled: pctReconciled,
            last_olist_sync: lastOlistSync,
            trends: {
                amount: trendAmount,
                transactions: trendTransactions,
            },
            sparkline: sparklineMonthly,
        };

        // ── 2. Alerts (faturas com transações pendentes) ─
        const alertsResult = await query(`
            SELECT
                s.id,
                s.filename,
                s.card_name,
                s.statement_date,
                s.total_transactions,
                COALESCE(s.categorized_count, 0) as categorized_count,
                s.total_transactions - COALESCE(s.categorized_count, 0) as pending_count
            FROM card_statements s
            WHERE s.total_transactions > COALESCE(s.categorized_count, 0)
            ORDER BY pending_count DESC, s.created_at DESC
            LIMIT 10
        `);

        const alerts = alertsResult.rows.map(r => ({
            id: r.id,
            filename: r.filename,
            card_name: r.card_name,
            statement_date: r.statement_date,
            total_transactions: parseInt(r.total_transactions),
            categorized_count: parseInt(r.categorized_count),
            pending_count: parseInt(r.pending_count),
        }));

        // ── 3. Charts ────────────────────────────────────

        // 3a. Mensal por categoria (top 5 categorias + "Outros", últimos 6 meses)
        const monthlyResult = await query(`
            SELECT
                SUBSTRING(t.date FROM 1 FOR 7) as month,
                COALESCE(t.category, 'Sem categoria') as category,
                COALESCE(SUM(ABS(t.amount)), 0) as total
            FROM card_transactions t
            WHERE t.date >= TO_CHAR(NOW() - INTERVAL '6 months', 'YYYY-MM-DD')
              AND t.category IS NOT NULL AND TRIM(t.category) != ''
              AND t.category NOT LIKE '%NÃO CLASSIFICADO%'
            GROUP BY month, t.category
            ORDER BY month ASC, total DESC
        `);

        // Montar estrutura Chart.js: labels (meses) + datasets (categorias)
        const monthSet = new Set();
        const catTotals = {};

        for (const row of monthlyResult.rows) {
            monthSet.add(row.month);
            if (!catTotals[row.category]) catTotals[row.category] = 0;
            catTotals[row.category] += parseFloat(row.total);
        }

        const months = Array.from(monthSet).sort();

        // Top 5 categorias por valor total
        const sortedCats = Object.entries(catTotals)
            .sort((a, b) => b[1] - a[1]);
        const topCatNames = sortedCats.slice(0, 5).map(c => c[0]);
        const hasOther = sortedCats.length > 5;

        // Montar datasets
        const monthlyDataMap = {};
        for (const row of monthlyResult.rows) {
            const cat = topCatNames.includes(row.category) ? row.category : 'Outros';
            if (!monthlyDataMap[cat]) monthlyDataMap[cat] = {};
            if (!monthlyDataMap[cat][row.month]) monthlyDataMap[cat][row.month] = 0;
            monthlyDataMap[cat][row.month] += parseFloat(row.total);
        }

        const datasetNames = [...topCatNames];
        if (hasOther && monthlyDataMap['Outros']) datasetNames.push('Outros');

        const monthlyChart = {
            labels: months.map(m => {
                const [y, mo] = m.split('-');
                return `${mo}/${y}`;
            }),
            datasets: datasetNames.map(cat => ({
                label: cat,
                data: months.map(m => monthlyDataMap[cat]?.[m] || 0),
            })),
        };

        // 3b. Donut por cartão
        const byCardResult = await query(`
            SELECT
                s.card_name,
                COALESCE(SUM(ABS(t.amount)), 0) as total
            FROM card_transactions t
            JOIN card_statements s ON s.id = t.statement_id
            GROUP BY s.card_name
            ORDER BY total DESC
        `);

        const byCardChart = {
            labels: byCardResult.rows.map(r => r.card_name),
            data: byCardResult.rows.map(r => parseFloat(r.total)),
        };

        // 3c. Tendência mensal (linha) — últimos 12 meses
        const trendResult = await query(`
            SELECT
                SUBSTRING(t.date FROM 1 FOR 7) as month,
                COALESCE(SUM(ABS(t.amount)), 0) as total,
                COUNT(*) as tx_count
            FROM card_transactions t
            WHERE t.date >= TO_CHAR(NOW() - INTERVAL '12 months', 'YYYY-MM-DD')
            GROUP BY SUBSTRING(t.date FROM 1 FOR 7)
            ORDER BY month ASC
        `);

        const trendChart = {
            labels: trendResult.rows.map(r => {
                const [y, mo] = r.month.split('-');
                return `${mo}/${y}`;
            }),
            amounts: trendResult.rows.map(r => parseFloat(r.total)),
            counts: trendResult.rows.map(r => parseInt(r.tx_count)),
        };

        // 3d. Top categorias (horizontal bars)
        const topCategoriesResult = await query(`
            SELECT
                COALESCE(t.category, 'Sem categoria') as category,
                COUNT(*) as count,
                COALESCE(SUM(ABS(t.amount)), 0) as total
            FROM card_transactions t
            WHERE t.category IS NOT NULL AND TRIM(t.category) != ''
              AND t.category NOT LIKE '%NÃO CLASSIFICADO%'
            GROUP BY t.category
            ORDER BY total DESC
            LIMIT 8
        `);

        const topCategories = topCategoriesResult.rows.map(r => ({
            category: r.category,
            count: parseInt(r.count),
            total: parseFloat(r.total),
        }));

        // ── 4. Recent (últimas faturas importadas) ───────
        const recentResult = await query(`
            SELECT
                s.id,
                s.filename,
                s.card_name,
                s.financial_account,
                s.statement_date,
                s.total_transactions,
                COALESCE(s.categorized_count, 0) as categorized_count,
                s.total_amount,
                s.created_at
            FROM card_statements s
            ORDER BY s.created_at DESC
            LIMIT 8
        `);

        const recent = recentResult.rows.map(r => ({
            id: r.id,
            filename: r.filename,
            card_name: r.card_name,
            financial_account: r.financial_account,
            statement_date: r.statement_date,
            total_transactions: parseInt(r.total_transactions),
            categorized_count: parseInt(r.categorized_count),
            total_amount: parseFloat(r.total_amount),
        }));

        // ── 5. Card Progress (progresso por cartão) ──────
        const progressResult = await query(`
            SELECT
                s.card_name,
                COUNT(*) as statement_count,
                COALESCE(SUM(s.total_transactions), 0) as total_tx,
                COALESCE(SUM(s.categorized_count), 0) as categorized_tx,
                COALESCE(SUM(s.total_amount), 0) as total_amount
            FROM card_statements s
            GROUP BY s.card_name
            ORDER BY total_amount DESC
        `);

        const cardProgress = progressResult.rows.map(r => ({
            card_name: r.card_name,
            statement_count: parseInt(r.statement_count),
            total_tx: parseInt(r.total_tx),
            categorized_tx: parseInt(r.categorized_tx),
            total_amount: parseFloat(r.total_amount),
        }));

        // ── 6. ERP Data (contas a pagar/receber) ─────────
        let erp = { contasPagar: {}, contasReceber: {}, topFornecedores: [] };
        try {
            const cpResult = await query(`
                SELECT
                    COUNT(*) as total,
                    COALESCE(SUM(valor), 0) as valor_total,
                    SUM(CASE WHEN situacao = 'aberto' OR situacao = 'parcial' THEN 1 ELSE 0 END) as em_aberto,
                    COALESCE(SUM(CASE WHEN situacao = 'aberto' OR situacao = 'parcial' THEN saldo ELSE 0 END), 0) as saldo_aberto,
                    SUM(CASE WHEN data_vencimento < TO_CHAR(NOW(), 'DD/MM/YYYY') AND (situacao = 'aberto' OR situacao = 'parcial') THEN 1 ELSE 0 END) as vencidas
                FROM olist_contas_pagar
            `);
            erp.contasPagar = {
                total: parseInt(cpResult.rows[0].total),
                valor_total: parseFloat(cpResult.rows[0].valor_total),
                em_aberto: parseInt(cpResult.rows[0].em_aberto),
                saldo_aberto: parseFloat(cpResult.rows[0].saldo_aberto),
                vencidas: parseInt(cpResult.rows[0].vencidas),
            };

            const crResult = await query(`
                SELECT
                    COUNT(*) as total,
                    COALESCE(SUM(valor), 0) as valor_total,
                    SUM(CASE WHEN situacao = 'aberto' OR situacao = 'parcial' THEN 1 ELSE 0 END) as em_aberto,
                    COALESCE(SUM(CASE WHEN situacao = 'aberto' OR situacao = 'parcial' THEN saldo ELSE 0 END), 0) as saldo_aberto
                FROM olist_contas_receber
            `);
            erp.contasReceber = {
                total: parseInt(crResult.rows[0].total),
                valor_total: parseFloat(crResult.rows[0].valor_total),
                em_aberto: parseInt(crResult.rows[0].em_aberto),
                saldo_aberto: parseFloat(crResult.rows[0].saldo_aberto),
            };

            const fornResult = await query(`
                SELECT fornecedor, COUNT(*) as count, COALESCE(SUM(valor), 0) as total
                FROM olist_contas_pagar
                WHERE fornecedor IS NOT NULL AND TRIM(fornecedor) != ''
                GROUP BY fornecedor
                ORDER BY total DESC
                LIMIT 6
            `);
            erp.topFornecedores = fornResult.rows.map(r => ({
                nome: r.fornecedor,
                count: parseInt(r.count),
                total: parseFloat(r.total),
            }));
        } catch (_) {
            // Tabelas ERP podem não existir
        }

        // ── Resposta final ───────────────────────────────
        res.json({
            kpis,
            alerts,
            charts: {
                monthly: monthlyChart,
                byCard: byCardChart,
                trend: trendChart,
                topCategories,
            },
            recent,
            cardProgress,
            erp,
        });
    } catch (err) {
        logger.error('Erro ao carregar dashboard:', err);
        res.status(500).json({ error: 'Erro ao carregar estatísticas do dashboard' });
    }
});

module.exports = router;
