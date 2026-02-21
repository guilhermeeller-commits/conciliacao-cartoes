require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('./config/passport');
const { allowPublicAssets } = require('./middlewares/auth.middleware');
const { pool } = require('./database/connection');

// ─── Database & Bootstrap ─────────────────────
const { runMigrations } = require('./database/migrations');
const { startScheduler } = require('./services/sync-scheduler');

async function bootstrap() {
    // Run migrations before starting the server
    await runMigrations();

    // Start scheduler
    startScheduler();

    const app = express();

    // Railway/Render usam um proxy reverso (essencial para cookies seguros funcionarem)
    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 1);
    }

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Session Configuration — armazena sessões no PostgreSQL
    app.use(session({
        store: new pgSession({
            pool,
            tableName: 'session',
            createTableIfMissing: true,
        }),
        secret: process.env.SESSION_SECRET || 'calisul-financeira-secret-key-12345',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
        }
    }));

    // Initialize Passport
    app.use(passport.initialize());
    app.use(passport.session());

    // Redirects from old/legacy pages (MUST be before static middleware)
    app.get('/extratos-cartao.html', (req, res) => res.redirect(301, '/faturas.html'));
    app.get('/conciliacoes.html', (req, res) => res.redirect(301, '/faturas.html'));
    app.get('/conciliacao.html', (req, res) => res.redirect(301, '/'));

    // --- Authentication Routes ---
    app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/login.html?error=unauthorized' }),
        function (req, res) {
            res.redirect('/');
        }
    );

    app.get('/logout', (req, res) => {
        req.logout(function (err) {
            if (err) { return next(err); }
            res.redirect('/login.html');
        });
    });

    app.get('/api/auth/me', (req, res) => {
        if (req.isAuthenticated()) {
            res.json({ user: req.user });
        } else {
            res.status(401).json({ error: 'Não autenticado' });
        }
    });

    // Protect all routes below this middleware
    app.use(allowPublicAssets);

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
            database: 'postgresql',
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
        console.log(`   DB:      PostgreSQL (Cloud SQL)`);
    });
}

bootstrap().catch(err => {
    console.error('❌ Falha ao iniciar servidor:', err);
    process.exit(1);
});
