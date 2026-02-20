/**
 * Reports Routes — PDF generation for financial reports
 * 
 * GET /api/reports/faturas?mes=2026-01    → PDF monthly invoice summary
 * GET /api/reports/repositorio            → PDF ERP repository summary
 */

const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { getDb } = require('../../database/connection');
const logger = require('../../utils/logger');

// ─── Helpers ──────────────────────────────────

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value || 0);
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR');
}

/**
 * Shared PDF header section
 */
function addHeader(doc, title, subtitle) {
    // Brand bar
    doc.rect(0, 0, 612, 60).fill('#1a1f36');
    doc.fontSize(20).fillColor('#ffffff').text('Calisul — Central Financeira', 40, 18);
    doc.fontSize(10).fillColor('#8b95b3').text(new Date().toLocaleDateString('pt-BR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }), 40, 40);

    doc.moveDown(2);
    doc.fontSize(16).fillColor('#1a1f36').text(title, 40);
    if (subtitle) {
        doc.fontSize(10).fillColor('#6b7394').text(subtitle, 40);
    }
    doc.moveDown(1);
}

/**
 * KPI box in PDF
 */
function addKPI(doc, x, y, label, value, width = 130) {
    doc.rect(x, y, width, 50).lineWidth(0.5).stroke('#e0e4ef');
    doc.fontSize(8).fillColor('#6b7394').text(label, x + 8, y + 8, { width: width - 16 });
    doc.fontSize(14).fillColor('#1a1f36').text(value, x + 8, y + 26, { width: width - 16 });
}

/**
 * Simple table renderer
 */
function addTable(doc, headers, rows, startX = 40) {
    const colWidth = (530 / headers.length);
    let y = doc.y + 10;

    // Header row
    doc.rect(startX, y, 530, 20).fill('#f0f2f8');
    headers.forEach((h, i) => {
        doc.fontSize(8).fillColor('#4a5076')
            .text(h, startX + (i * colWidth) + 4, y + 5, { width: colWidth - 8, lineBreak: false });
    });
    y += 22;

    // Data rows
    rows.forEach((row, ri) => {
        if (y > 720) {
            doc.addPage();
            y = 50;
        }
        if (ri % 2 === 0) {
            doc.rect(startX, y, 530, 18).fill('#fafbfd');
        }
        row.forEach((cell, ci) => {
            doc.fontSize(8).fillColor('#1a1f36')
                .text(String(cell || '—'), startX + (ci * colWidth) + 4, y + 4, { width: colWidth - 8, lineBreak: false });
        });
        y += 18;
    });

    doc.y = y + 10;
}

// ─── Invoice Summary Report ───────────────────

router.get('/faturas', (req, res) => {
    try {
        const db = getDb();
        const mes = req.query.mes || new Date().toISOString().slice(0, 7);
        const [year, month] = mes.split('-').map(Number);

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = month === 12
            ? `${year + 1}-01-01`
            : `${year}-${String(month + 1).padStart(2, '0')}-01`;

        // Fetch statements for the month
        const statements = db.prepare(`
            SELECT cs.*, 
                   COUNT(ct.id) as total_transactions,
                   SUM(CASE WHEN ct.category IS NOT NULL AND ct.category != '' THEN 1 ELSE 0 END) as categorized_count,
                   SUM(CASE WHEN ct.olist_status = 'sent' THEN 1 ELSE 0 END) as sent_count
            FROM card_statements cs
            LEFT JOIN card_transactions ct ON ct.statement_id = cs.id
            WHERE cs.closing_date >= ? AND cs.closing_date < ?
            GROUP BY cs.id
            ORDER BY cs.closing_date ASC
        `).all(startDate, endDate);

        // Summary stats
        const totalStatements = statements.length;
        const totalValue = statements.reduce((sum, s) => sum + (s.total_amount || 0), 0);
        const totalTransactions = statements.reduce((sum, s) => sum + s.total_transactions, 0);
        const totalCategorized = statements.reduce((sum, s) => sum + s.categorized_count, 0);
        const totalSent = statements.reduce((sum, s) => sum + s.sent_count, 0);

        // Create PDF
        const doc = new PDFDocument({ size: 'LETTER', margin: 40 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="faturas_${mes}.pdf"`);
        doc.pipe(res);

        const monthName = new Date(year, month - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        addHeader(doc, `Relatório de Faturas — ${monthName}`, `Período: ${startDate} a ${endDate}`);

        // KPIs
        const kpiY = doc.y + 5;
        addKPI(doc, 40, kpiY, 'FATURAS', String(totalStatements));
        addKPI(doc, 178, kpiY, 'VALOR TOTAL', formatCurrency(totalValue));
        addKPI(doc, 316, kpiY, 'TRANSAÇÕES', String(totalTransactions));
        addKPI(doc, 454, kpiY, 'CATEGORIZADAS', `${totalCategorized}/${totalTransactions}`);
        doc.y = kpiY + 65;

        // Statements table
        doc.fontSize(12).fillColor('#1a1f36').text('Faturas do Período', 40);
        doc.moveDown(0.5);

        if (statements.length === 0) {
            doc.fontSize(10).fillColor('#6b7394').text('Nenhuma fatura encontrada para este período.', 40);
        } else {
            addTable(doc,
                ['Cartão', 'Fechamento', 'Valor Total', 'Transações', 'Categorizadas', 'Enviadas'],
                statements.map(s => [
                    s.card_name || '—',
                    formatDate(s.closing_date),
                    formatCurrency(s.total_amount),
                    String(s.total_transactions),
                    String(s.categorized_count),
                    String(s.sent_count),
                ])
            );
        }

        // Footer
        doc.y = 740;
        doc.fontSize(7).fillColor('#aaa')
            .text(`Gerado automaticamente por Central Financeira Calisul em ${new Date().toLocaleString('pt-BR')}`, 40, 740, { align: 'center' });

        doc.end();
    } catch (e) {
        logger.error('Erro ao gerar PDF de faturas:', e);
        res.status(500).json({ erro: 'Erro ao gerar relatório: ' + e.message });
    }
});

// ─── Repository Summary Report ────────────────

router.get('/repositorio', (req, res) => {
    try {
        const db = getDb();

        // Gather stats
        const stats = {};
        const tables = [
            { key: 'contas_pagar', table: 'erp_contas_pagar', label: 'Contas a Pagar' },
            { key: 'contas_receber', table: 'erp_contas_receber', label: 'Contas a Receber' },
            { key: 'contatos', table: 'erp_contatos', label: 'Fornecedores' },
            { key: 'notas_entrada', table: 'erp_notas_entrada', label: 'Notas de Entrada' },
        ];

        for (const t of tables) {
            try {
                stats[t.key] = {
                    label: t.label,
                    count: db.prepare(`SELECT COUNT(*) as c FROM ${t.table}`).get().c,
                };
            } catch {
                stats[t.key] = { label: t.label, count: 0 };
            }
        }

        // Top categories
        let topCategories = [];
        try {
            topCategories = db.prepare(`
                SELECT nome_cat as categoria, COUNT(*) as total
                FROM erp_contas_pagar
                WHERE nome_cat IS NOT NULL AND nome_cat != ''
                GROUP BY nome_cat
                ORDER BY total DESC
                LIMIT 10
            `).all();
        } catch { /* table might not exist */ }

        // Top suppliers
        let topSuppliers = [];
        try {
            topSuppliers = db.prepare(`
                SELECT nome_fornecedor as fornecedor, SUM(valor) as total_valor, COUNT(*) as qtd
                FROM erp_contas_pagar
                WHERE nome_fornecedor IS NOT NULL AND nome_fornecedor != ''
                GROUP BY nome_fornecedor
                ORDER BY total_valor DESC
                LIMIT 10
            `).all();
        } catch { /* table might not exist */ }

        // Create PDF
        const doc = new PDFDocument({ size: 'LETTER', margin: 40 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="repositorio_olist.pdf"');
        doc.pipe(res);

        addHeader(doc, 'Relatório do Repositório Olist', 'Dados sincronizados do ERP');

        // KPIs
        const kpiY = doc.y + 5;
        tables.forEach((t, i) => {
            addKPI(doc, 40 + (i * 133), kpiY, t.label.toUpperCase(), String(stats[t.key].count));
        });
        doc.y = kpiY + 65;

        // Top categories
        if (topCategories.length > 0) {
            doc.fontSize(12).fillColor('#1a1f36').text('Top 10 Categorias (por volume)', 40);
            doc.moveDown(0.5);
            addTable(doc,
                ['#', 'Categoria', 'Quantidade'],
                topCategories.map((c, i) => [String(i + 1), c.categoria, String(c.total)])
            );
        }

        // Top suppliers
        if (topSuppliers.length > 0) {
            doc.fontSize(12).fillColor('#1a1f36').text('Top 10 Fornecedores (por valor)', 40);
            doc.moveDown(0.5);
            addTable(doc,
                ['#', 'Fornecedor', 'Valor Total', 'Qtd'],
                topSuppliers.map((s, i) => [
                    String(i + 1),
                    s.fornecedor,
                    formatCurrency(s.total_valor),
                    String(s.qtd),
                ])
            );
        }

        // Footer
        doc.y = 740;
        doc.fontSize(7).fillColor('#aaa')
            .text(`Gerado automaticamente por Central Financeira Calisul em ${new Date().toLocaleString('pt-BR')}`, 40, 740, { align: 'center' });

        doc.end();
    } catch (e) {
        logger.error('Erro ao gerar PDF repositório:', e);
        res.status(500).json({ erro: 'Erro ao gerar relatório: ' + e.message });
    }
});

module.exports = router;
