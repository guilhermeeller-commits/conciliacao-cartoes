/**
 * Settings API Routes
 * CRUD for card rules, classification rules, learned mappings, and Olist API testing.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDb } = require('../../database/connection');
const logger = require('../../utils/logger');

const CARD_RULES_PATH = path.join(__dirname, '..', '..', '..', 'config', 'card-rules.json');

// ─── Helpers ──────────────────────────────────

function readCardRules() {
    const raw = fs.readFileSync(CARD_RULES_PATH, 'utf-8');
    return JSON.parse(raw);
}

function writeCardRules(data) {
    fs.writeFileSync(CARD_RULES_PATH, JSON.stringify(data, null, 4), 'utf-8');
}

// ─── Card Rules (cartões → conta financeira) ──

router.get('/card-rules', (req, res) => {
    try {
        const rules = readCardRules();
        res.json({ cartoes: rules.cartoes || {} });
    } catch (e) {
        logger.error('Erro ao ler card-rules:', e);
        res.status(500).json({ erro: 'Erro ao ler configurações de cartões' });
    }
});

router.put('/card-rules', (req, res) => {
    try {
        const rules = readCardRules();
        rules.cartoes = req.body.cartoes || rules.cartoes;
        writeCardRules(rules);
        res.json({ ok: true, message: 'Configurações de cartões salvas' });
    } catch (e) {
        logger.error('Erro ao salvar card-rules:', e);
        res.status(500).json({ erro: 'Erro ao salvar configurações' });
    }
});

// ─── Classification Rules (regex → categoria) ─

router.get('/classification-rules', (req, res) => {
    try {
        const rules = readCardRules();
        res.json({
            regras: rules.regras_classificacao || [],
            categorias: rules.categorias || [],
        });
    } catch (e) {
        logger.error('Erro ao ler regras:', e);
        res.status(500).json({ erro: 'Erro ao ler regras de classificação' });
    }
});

router.put('/classification-rules', (req, res) => {
    try {
        const rules = readCardRules();
        if (req.body.regras) rules.regras_classificacao = req.body.regras;
        if (req.body.categorias) rules.categorias = req.body.categorias;
        writeCardRules(rules);
        res.json({ ok: true, message: 'Regras de classificação salvas' });
    } catch (e) {
        logger.error('Erro ao salvar regras:', e);
        res.status(500).json({ erro: 'Erro ao salvar regras' });
    }
});

// ─── Learned Mappings (SQLite) ─────────────────

router.get('/learned-mappings', (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT id, descricao, categoria, criado_em FROM learned_mappings ORDER BY criado_em DESC').all();
        res.json({ mappings: rows });
    } catch (e) {
        logger.error('Erro ao ler mapeamentos:', e);
        res.status(500).json({ erro: 'Erro ao ler mapeamentos' });
    }
});

router.delete('/learned-mappings/:id', (req, res) => {
    try {
        const db = getDb();
        const result = db.prepare('DELETE FROM learned_mappings WHERE id = ?').run(req.params.id);
        if (result.changes === 0) {
            return res.status(404).json({ erro: 'Mapeamento não encontrado' });
        }
        res.json({ ok: true, message: 'Mapeamento removido' });
    } catch (e) {
        logger.error('Erro ao remover mapeamento:', e);
        res.status(500).json({ erro: 'Erro ao remover mapeamento' });
    }
});

// ─── Test Olist Connection ─────────────────────

router.post('/test-olist', async (req, res) => {
    try {
        const token = process.env.TINY_API_TOKEN;
        if (!token) {
            return res.json({ ok: false, message: 'Token não configurado no .env' });
        }

        const response = await fetch(
            `https://api.tiny.com.br/api2/info.php?token=${token}&formato=JSON`
        );
        const data = await response.json();

        if (data.retorno && data.retorno.status === 'OK') {
            res.json({
                ok: true,
                message: 'Conexão com Olist/Tiny ERP estabelecida com sucesso',
                empresa: data.retorno.info?.razao_social || 'N/A',
            });
        } else {
            res.json({
                ok: false,
                message: data.retorno?.erros?.[0]?.erro || 'Erro na conexão',
            });
        }
    } catch (e) {
        logger.error('Erro ao testar Olist:', e);
        res.json({ ok: false, message: `Erro: ${e.message}` });
    }
});

// ─── Plano de Contas (read from SQLite) ────────

router.get('/plano-contas', (req, res) => {
    try {
        const db = getDb();
        const search = (req.query.search || '').trim();

        let query = 'SELECT id, olist_id, descricao, grupo, considera_dre, competencia_padrao FROM erp_plano_contas';
        const params = [];

        if (search) {
            query += ' WHERE descricao LIKE ? OR grupo LIKE ?';
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY descricao ASC';
        const rows = db.prepare(query).all(...params);

        res.json({ ok: true, plano_contas: rows, total: rows.length });
    } catch (e) {
        logger.error('Erro ao ler plano de contas:', e);
        res.status(500).json({ erro: 'Erro ao ler plano de contas' });
    }
});

// ─── Database Backup ───────────────────────────

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'calisul-financeiro.db');

router.get('/backup', (req, res) => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return res.status(404).json({ erro: 'Banco de dados não encontrado' });
        }

        const stat = fs.statSync(DB_PATH);
        const dateStr = new Date().toISOString().slice(0, 10);

        res.setHeader('Content-Disposition', `attachment; filename="calisul-financeiro_backup_${dateStr}.db"`);
        res.setHeader('Content-Type', 'application/x-sqlite3');
        res.setHeader('Content-Length', stat.size);

        const stream = fs.createReadStream(DB_PATH);
        stream.pipe(res);
    } catch (e) {
        logger.error('Erro ao criar backup:', e);
        res.status(500).json({ erro: 'Erro ao criar backup do banco' });
    }
});

router.get('/backup/info', (req, res) => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return res.json({ exists: false });
        }
        const stat = fs.statSync(DB_PATH);
        res.json({
            exists: true,
            size: stat.size,
            sizeFormatted: formatBytes(stat.size),
            lastModified: stat.mtime.toISOString(),
        });
    } catch (e) {
        logger.error('Erro ao verificar info do banco:', e);
        res.status(500).json({ erro: 'Erro ao verificar banco' });
    }
});

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Restore requires multer for file upload
const multer = require('multer');
const Database = require('better-sqlite3');
const { closeDb } = require('../../database/connection');

const upload = multer({
    dest: path.join(__dirname, '..', '..', '..', '.tmp'),
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

router.post('/restore', upload.single('database'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
        }

        const uploadPath = req.file.path;

        // Validate: try to open the uploaded file as SQLite
        try {
            const testDb = new Database(uploadPath, { readonly: true });
            // Quick sanity check: run a simple query
            testDb.pragma('integrity_check');
            testDb.close();
        } catch (validationErr) {
            // Clean up invalid file
            fs.unlinkSync(uploadPath);
            return res.status(400).json({
                erro: 'Arquivo inválido — não é um banco SQLite válido',
                detalhes: validationErr.message,
            });
        }

        // Close current connection
        closeDb();

        // Backup current db before replacing
        const backupPath = DB_PATH + '.bak';
        if (fs.existsSync(DB_PATH)) {
            fs.copyFileSync(DB_PATH, backupPath);
        }

        // Replace with uploaded file
        fs.copyFileSync(uploadPath, DB_PATH);
        fs.unlinkSync(uploadPath);

        // WAL files should be removed so the new db starts clean
        const walPath = DB_PATH + '-wal';
        const shmPath = DB_PATH + '-shm';
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

        logger.info('🗄️  Banco restaurado com sucesso');
        res.json({
            ok: true,
            message: 'Banco de dados restaurado com sucesso. Recarregue a página.',
        });
    } catch (e) {
        logger.error('Erro ao restaurar banco:', e);
        res.status(500).json({ erro: 'Erro ao restaurar banco: ' + e.message });
    }
});

module.exports = router;

// ─── Scheduler Status ──────────────────────────

const { getSchedulerStatus, toggleScheduler, runSyncNow } = require('../../services/sync-scheduler');

router.get('/scheduler', (req, res) => {
    try {
        res.json({ ok: true, ...getSchedulerStatus() });
    } catch (e) {
        logger.error('Erro ao ler scheduler:', e);
        res.status(500).json({ erro: 'Erro ao ler status do scheduler' });
    }
});

router.post('/scheduler/toggle', (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ erro: 'Campo "enabled" (boolean) obrigatório' });
        }
        const result = toggleScheduler(enabled);
        res.json({ ok: true, ...result });
    } catch (e) {
        logger.error('Erro ao toggle scheduler:', e);
        res.status(500).json({ erro: 'Erro ao alterar scheduler' });
    }
});

router.post('/scheduler/run-now', async (req, res) => {
    try {
        const result = await runSyncNow();
        res.json({ ok: true, ...result });
    } catch (e) {
        logger.error('Erro ao executar sync manual:', e);
        res.status(500).json({ erro: 'Erro ao executar sync: ' + e.message });
    }
});

// ─── Olist Token Management ────────────────────

const ENV_PATH = path.join(__dirname, '..', '..', '..', '.env');

router.get('/olist-token', (req, res) => {
    try {
        const token = process.env.TINY_API_TOKEN || '';
        const masked = token.length > 8
            ? '***' + token.slice(-4)
            : token ? '****' : '';
        res.json({ ok: true, token: masked, configured: !!token });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao ler token' });
    }
});

router.put('/olist-token', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token || typeof token !== 'string' || token.trim().length < 10) {
            return res.status(400).json({ erro: 'Token inválido (mínimo 10 caracteres)' });
        }

        const trimmedToken = token.trim();

        // Validate token by calling Tiny API
        try {
            const response = await fetch(
                `https://api.tiny.com.br/api2/info.php?token=${trimmedToken}&formato=JSON`
            );
            const data = await response.json();
            if (!data.retorno || data.retorno.status !== 'OK') {
                return res.status(400).json({
                    erro: 'Token rejeitado pela API Tiny',
                    detalhes: data.retorno?.erros?.[0]?.erro || 'Token inválido',
                });
            }
        } catch (apiErr) {
            return res.status(400).json({
                erro: 'Não foi possível validar o token',
                detalhes: apiErr.message,
            });
        }

        // Update .env file
        let envContent = '';
        if (fs.existsSync(ENV_PATH)) {
            envContent = fs.readFileSync(ENV_PATH, 'utf-8');
        }

        if (envContent.includes('TINY_API_TOKEN=')) {
            envContent = envContent.replace(/TINY_API_TOKEN=.*/g, `TINY_API_TOKEN=${trimmedToken}`);
        } else {
            envContent += `\nTINY_API_TOKEN=${trimmedToken}\n`;
        }

        fs.writeFileSync(ENV_PATH, envContent, 'utf-8');

        // Update process.env in-memory
        process.env.TINY_API_TOKEN = trimmedToken;

        logger.info('🔑 Token Olist atualizado via UI');
        res.json({ ok: true, message: 'Token atualizado e validado com sucesso' });
    } catch (e) {
        logger.error('Erro ao atualizar token:', e);
        res.status(500).json({ erro: 'Erro ao atualizar token: ' + e.message });
    }
});

// ─── Notifications ─────────────────────────────

router.get('/notifications', (req, res) => {
    try {
        const db = getDb();
        const limit = parseInt(req.query.limit) || 20;
        const rows = db.prepare(`
            SELECT id, type, title, message, read, created_at
            FROM notifications
            ORDER BY created_at DESC
            LIMIT ?
        `).all(limit);

        const unreadCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read = 0').get().c;

        res.json({ ok: true, notifications: rows, unreadCount });
    } catch (e) {
        // Table might not exist yet
        res.json({ ok: true, notifications: [], unreadCount: 0 });
    }
});

router.post('/notifications/:id/read', (req, res) => {
    try {
        const db = getDb();
        db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
        res.json({ ok: true });
    } catch (e) {
        logger.error('Erro ao marcar notificação:', e);
        res.status(500).json({ erro: 'Erro ao marcar notificação' });
    }
});

router.post('/notifications/read-all', (req, res) => {
    try {
        const db = getDb();
        db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
        res.json({ ok: true });
    } catch (e) {
        logger.error('Erro ao marcar todas notificações:', e);
        res.status(500).json({ erro: 'Erro ao marcar notificações' });
    }
});
