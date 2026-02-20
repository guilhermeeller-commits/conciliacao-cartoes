require('dotenv').config();

const express = require('express');
const path = require('path');

// ─── Database ─────────────────────────────────
const { runMigrations } = require('./database/migrations');
runMigrations();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// API routes — Categorização Automática
const categorizationRoutes = require('./modules/categorizacao/categorization.routes');
app.use('/api/categorization', categorizationRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'conciliacao-cartoes',
        timestamp: new Date().toISOString(),
    });
});

// Serve conciliação page at root
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
