require('dotenv').config();

// ─── Fallback: CLOUD_SQL_URL → DATABASE_URL ────────────────
// Railway pode reservar o nome DATABASE_URL. Aceitamos ambos.
if (process.env.CLOUD_SQL_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.CLOUD_SQL_URL;
}
if (process.env.TINY_ERP_TOKEN && !process.env.TINY_API_TOKEN) {
    process.env.TINY_API_TOKEN = process.env.TINY_ERP_TOKEN;
}

// ═══════════════════════════════════════════════════════════
// Validação de variáveis de ambiente obrigatórias (item 1.4)
// DEVE rodar ANTES de qualquer import que dependa de env vars
// ═══════════════════════════════════════════════════════════

function validateEnv() {
    const required = [
        { name: 'SESSION_SECRET', minLength: 32 },
        { name: 'DATABASE_URL' },
        { name: 'TINY_API_TOKEN' },
        { name: 'GOOGLE_CLIENT_ID' },
        { name: 'GOOGLE_CLIENT_SECRET' },
    ];

    const missing = [];
    const invalid = [];

    for (const { name, minLength } of required) {
        const value = process.env[name];
        if (!value || value.trim() === '') {
            missing.push(name);
        } else if (minLength && value.length < minLength) {
            invalid.push(`${name} (mínimo ${minLength} caracteres, atual: ${value.length})`);
        }
    }

    if (missing.length > 0 || invalid.length > 0) {
        console.error('');
        console.error('═══════════════════════════════════════════════════');
        console.error('❌ ERRO FATAL: Variáveis de ambiente obrigatórias');
        console.error('═══════════════════════════════════════════════════');
        if (missing.length > 0) {
            console.error(`\n  Variáveis AUSENTES: ${missing.join(', ')}`);
        }
        if (invalid.length > 0) {
            console.error(`\n  Variáveis INVÁLIDAS: ${invalid.join(', ')}`);
        }
        console.error('\n  Copie o .env.example para .env e preencha todas as variáveis.');
        console.error('  Para gerar um SESSION_SECRET seguro: openssl rand -base64 48');
        console.error('═══════════════════════════════════════════════════\n');
        process.exit(1);
    }
}

validateEnv();

// ═══════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('./config/passport');
const { allowPublicAssets } = require('./middlewares/auth.middleware');
const { requestIdMiddleware } = require('./middlewares/request-id');
const { pool } = require('./database/connection');
const { query } = require('./database/connection');

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

    // Request ID — correlação de logs por requisição
    app.use(requestIdMiddleware);

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Session Configuration — armazena sessões no PostgreSQL
    // SESSION_SECRET já é validado no boot (item 1.1 — sem fallback hardcoded)
    app.use(session({
        store: new pgSession({
            pool,
            tableName: 'session',
            createTableIfMissing: true,
        }),
        secret: process.env.SESSION_SECRET,
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

    // ═══════════════════════════════════════════════
    // CSRF Protection — Double-Submit Cookie Pattern (item 1.2)
    // ═══════════════════════════════════════════════

    // Endpoint para obter token CSRF (chamado pelo frontend)
    app.get('/api/csrf-token', (req, res) => {
        // Gera token CSRF e armazena na sessão
        if (!req.session.csrfToken) {
            req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        }
        res.json({ csrfToken: req.session.csrfToken });
    });

    // Middleware CSRF — valida token em requisições mutantes
    app.use((req, res, next) => {
        // Skip para métodos seguros (GET, HEAD, OPTIONS)
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return next();
        }

        // Skip para rotas de autenticação (antes da sessão estar estabelecida)
        if (req.path.startsWith('/auth/')) {
            return next();
        }

        // Skip para health check
        if (req.path === '/health') {
            return next();
        }

        // Verificar token CSRF
        const tokenFromHeader = req.headers['x-csrf-token'];
        const tokenFromSession = req.session?.csrfToken;

        if (!tokenFromSession || !tokenFromHeader || tokenFromHeader !== tokenFromSession) {
            return res.status(403).json({
                erro: 'Token CSRF inválido ou ausente. Obtenha um token via GET /api/csrf-token',
                codigo: 'CSRF_INVALID',
            });
        }

        next();
    });

    // ═══════════════════════════════════════════════

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

    // Health check avançado
    const serverStartTime = Date.now();
    app.get('/health', async (req, res) => {
        const health = {
            status: 'ok',
            service: 'conciliacao-cartoes',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - serverStartTime) / 1000),
            memory: {
                rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            },
            database: { status: 'unknown' },
        };

        // Verificar banco de dados
        try {
            const start = Date.now();
            await query('SELECT 1');
            health.database = {
                status: 'ok',
                responseMs: Date.now() - start,
            };
        } catch (dbErr) {
            health.status = 'degraded';
            health.database = {
                status: 'error',
                error: dbErr.message,
            };
        }

        const statusCode = health.status === 'ok' ? 200 : 503;
        res.status(statusCode).json(health);
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

