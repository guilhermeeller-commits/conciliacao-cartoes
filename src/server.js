require('dotenv').config();

const express = require('express');
const path = require('path');

// ─── Database ─────────────────────────────────
const { runMigrations } = require('./database/migrations');
runMigrations();

// ─── Scheduler ────────────────────────────────
const { startScheduler } = require('./services/sync-scheduler');
startScheduler();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Redirects from old/legacy pages (MUST be before static middleware)
app.get('/extratos-cartao.html', (req, res) => res.redirect(301, '/faturas.html'));
app.get('/conciliacoes.html', (req, res) => res.redirect(301, '/faturas.html'));
app.get('/conciliacao.html', (req, res) => res.redirect(301, '/'));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes — Conciliação de Cartões
const reconciliationRoutes = require('./modules/conciliacao-cartao/reconciliation.routes');
app.use('/api/reconciliation', reconciliationRoutes);

// API routes — Extratos de Cartão
const cardStatementsRoutes = require('./modules/conciliacao-cartao/card-statements.routes');
app.use('/api/card-statements', cardStatementsRoutes);

// API routes — Repositório Olist
const repositoryRoutes = require('./modules/repositorio/repository.routes');
app.use('/api/repository', repositoryRoutes);

// API routes — Categorização Automática (dados ERP importados)
const categorizationRoutes = require('./modules/categorizacao/categorization.routes');
app.use('/api/categorization', categorizationRoutes);

// API routes — Dashboard
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
app.use('/api/dashboard', dashboardRoutes);

// API routes — Settings
const settingsRoutes = require('./modules/settings/settings.routes');
app.use('/api/settings', settingsRoutes);

// API routes — Reports (PDF)
const reportsRoutes = require('./modules/reports/reports.routes');
app.use('/api/reports', reportsRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'conciliacao-cartoes',
        timestamp: new Date().toISOString(),
    });
});



// Serve dashboard at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`💳 Conciliação de Cartões rodando na porta ${PORT}`);
    console.log(`   App:     http://localhost:${PORT}/`);
    console.log(`   API:     http://localhost:${PORT}/api/reconciliation/categories`);
    console.log(`   Health:  http://localhost:${PORT}/health`);
});
