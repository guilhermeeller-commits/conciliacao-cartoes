/**
 * Settings API Routes
 * CRUD for card rules, classification rules, learned mappings, and Olist API testing.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { query } = require('../../database/connection');
const logger = require('../../utils/logger');
const cardRulesRepo = require('../../repositories/card-rules-repo');

// ─── Card Rules (cartões → conta financeira) ──

router.get('/card-rules', async (req, res) => {
    try {
        const cartoes = await cardRulesRepo.getCardAccounts();
        res.json({ cartoes });
    } catch (e) {
        logger.error('Erro ao ler card-rules:', e);
        res.status(500).json({ erro: 'Erro ao ler configurações de cartões' });
    }
});

router.put('/card-rules', async (req, res) => {
    try {
        await cardRulesRepo.saveCardAccounts(req.body.cartoes || {});
        res.json({ ok: true, message: 'Configurações de cartões salvas' });
    } catch (e) {
        logger.error('Erro ao salvar card-rules:', e);
        res.status(500).json({ erro: 'Erro ao salvar configurações' });
    }
});

// ─── Classification Rules (regex → categoria) ─

router.get('/classification-rules', async (req, res) => {
    try {
        const regras = (await cardRulesRepo.getClassificationRules()).map(r => ({
            padrao: r.padrao,
            categoria: r.categoria,
        }));
        const categorias = await cardRulesRepo.getCategories();
        res.json({ regras, categorias });
    } catch (e) {
        logger.error('Erro ao ler regras:', e);
        res.status(500).json({ erro: 'Erro ao ler regras de classificação' });
    }
});

router.put('/classification-rules', async (req, res) => {
    try {
        if (req.body.regras) await cardRulesRepo.saveClassificationRules(req.body.regras);
        if (req.body.categorias) await cardRulesRepo.saveCategories(req.body.categorias);
        res.json({ ok: true, message: 'Regras de classificação salvas' });
    } catch (e) {
        logger.error('Erro ao salvar regras:', e);
        res.status(500).json({ erro: 'Erro ao salvar regras' });
    }
});

// ─── Learned Mappings ──────────────────────────

router.get('/learned-mappings', async (req, res) => {
    try {
        const { rows } = await query('SELECT id, descricao, categoria, criado_em FROM learned_mappings ORDER BY criado_em DESC');
        res.json({ mappings: rows });
    } catch (e) {
        logger.error('Erro ao ler mapeamentos:', e);
        res.status(500).json({ erro: 'Erro ao ler mapeamentos' });
    }
});

router.delete('/learned-mappings/:id', async (req, res) => {
    try {
        const result = await query('DELETE FROM learned_mappings WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) {
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

// ─── Plano de Contas (read from PostgreSQL) ────

router.get('/plano-contas', async (req, res) => {
    try {
        const search = (req.query.search || '').trim();

        let sql = 'SELECT id, olist_id, descricao, grupo, considera_dre, competencia_padrao FROM erp_plano_contas';
        const params = [];
        let paramIdx = 1;

        if (search) {
            sql += ` WHERE descricao ILIKE $${paramIdx++} OR grupo ILIKE $${paramIdx++}`;
            params.push(`%${search}%`, `%${search}%`);
        }

        sql += ' ORDER BY descricao ASC';
        const { rows } = await query(sql, params);

        res.json({ ok: true, plano_contas: rows, total: rows.length });
    } catch (e) {
        logger.error('Erro ao ler plano de contas:', e);
        res.status(500).json({ erro: 'Erro ao ler plano de contas' });
    }
});

// ─── Database Info (Cloud SQL — no file-based backup) ────

router.get('/backup', async (req, res) => {
    try {
        res.status(501).json({
            message: 'Backup via download não disponível para PostgreSQL (Cloud SQL). Use os backups automáticos do Google Cloud Console.',
        });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao verificar backup' });
    }
});

router.get('/backup/info', async (req, res) => {
    try {
        // Get database size from PostgreSQL
        const { rows } = await query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
        res.json({
            exists: true,
            sizeFormatted: rows[0].size,
            type: 'Cloud SQL (PostgreSQL)',
            message: 'Backups gerenciados automaticamente pelo Google Cloud SQL',
        });
    } catch (e) {
        logger.error('Erro ao verificar info do banco:', e);
        res.status(500).json({ erro: 'Erro ao verificar banco' });
    }
});

router.post('/restore', (req, res) => {
    res.status(501).json({
        message: 'Restore via upload não disponível para PostgreSQL (Cloud SQL). Use os backups automáticos do Google Cloud Console.',
    });
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

// ─── Validate Sent Transactions ────────────────

const { obterContaPagar } = require('../../services/olist-financial');

router.post('/validate-sent', async (req, res) => {
    try {
        const { rows: sentRecords } = await query(
            "SELECT id, olist_id, card_name, description, amount, created_at FROM sent_transactions WHERE status = 'sent' AND olist_id IS NOT NULL ORDER BY created_at DESC"
        );

        if (sentRecords.length === 0) {
            return res.json({
                ok: true,
                total: 0,
                valid: 0,
                removed: 0,
                message: 'Nenhuma transação enviada encontrada para validar.',
            });
        }

        logger.info(`🔍 Validando ${sentRecords.length} transações enviadas ao Olist...`);

        let valid = 0;
        let removed = 0;
        const details = [];
        const RATE_LIMIT_MS = 1100; // Tiny API rate limit

        for (let i = 0; i < sentRecords.length; i++) {
            const record = sentRecords[i];

            try {
                const result = await obterContaPagar(record.olist_id);

                if (result.sucesso) {
                    valid++;
                    details.push({
                        id: record.id,
                        olist_id: record.olist_id,
                        description: record.description,
                        status: 'valid',
                    });
                } else {
                    // Conta não existe mais no Tiny — limpar registro
                    await query(
                        "UPDATE sent_transactions SET status = 'removed', updated_at = NOW() WHERE id = $1",
                        [record.id]
                    );

                    // Resetar flag sent_to_olist nas card_transactions que apontam pra esse olist_id
                    await query(
                        "UPDATE card_transactions SET sent_to_olist = 0, olist_id = NULL WHERE olist_id = $1",
                        [record.olist_id]
                    );

                    removed++;
                    details.push({
                        id: record.id,
                        olist_id: record.olist_id,
                        description: record.description,
                        status: 'removed',
                        reason: result.erro || 'Conta não encontrada no Tiny',
                    });

                    logger.info(`🗑️ Conta ${record.olist_id} não encontrada no Tiny — registro limpo`);
                }
            } catch (err) {
                details.push({
                    id: record.id,
                    olist_id: record.olist_id,
                    description: record.description,
                    status: 'error',
                    reason: err.message,
                });
            }

            // Rate limit
            if (i < sentRecords.length - 1) {
                await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
            }
        }

        logger.info(`✅ Validação concluída: ${valid} válidas, ${removed} removidas de ${sentRecords.length} total`);

        res.json({
            ok: true,
            total: sentRecords.length,
            valid,
            removed,
            details,
            message: removed > 0
                ? `${removed} transação(ões) não encontrada(s) no Tiny foram limpas. Agora podem ser reenviadas.`
                : `Todas as ${valid} transações ainda existem no Tiny.`,
        });
    } catch (e) {
        logger.error('Erro ao validar transações:', e);
        res.status(500).json({ erro: 'Erro ao validar transações: ' + e.message });
    }
});

// ─── Notifications ─────────────────────────────

router.get('/notifications', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const { rows } = await query(
            'SELECT id, type, title, message, read, created_at FROM notifications ORDER BY created_at DESC LIMIT $1',
            [limit]
        );

        const unreadResult = await query('SELECT COUNT(*) as c FROM notifications WHERE read = 0');
        const unreadCount = parseInt(unreadResult.rows[0].c);

        res.json({ ok: true, notifications: rows, unreadCount });
    } catch (e) {
        // Table might not exist yet
        res.json({ ok: true, notifications: [], unreadCount: 0 });
    }
});

router.post('/notifications/:id/read', async (req, res) => {
    try {
        await query('UPDATE notifications SET read = 1 WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) {
        logger.error('Erro ao marcar notificação:', e);
        res.status(500).json({ erro: 'Erro ao marcar notificação' });
    }
});

router.post('/notifications/read-all', async (req, res) => {
    try {
        await query('UPDATE notifications SET read = 1 WHERE read = 0');
        res.json({ ok: true });
    } catch (e) {
        logger.error('Erro ao marcar todas notificações:', e);
        res.status(500).json({ erro: 'Erro ao marcar notificações' });
    }
});
