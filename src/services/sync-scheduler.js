/**
 * Sync Scheduler — Automated Olist repository synchronization
 *
 * Runs a cron job every 6 hours to sync data from Olist/Tiny ERP.
 * Can be toggled on/off via API.
 */

const cron = require('node-cron');
const {
    importContasPagar,
    importContasReceber,
    importContatos,
    importNotasEntrada,
} = require('./olist-repository');
const { query } = require('../database/connection');
const logger = require('../utils/logger');

let schedulerTask = null;
let isEnabled = true;
let isRunning = false;
let lastRun = null;
let lastResult = null;

const CRON_EXPRESSION = '0 */6 * * *'; // Every 6 hours

/**
 * Start the scheduler. Called once at server boot.
 */
function startScheduler() {
    schedulerTask = cron.schedule(CRON_EXPRESSION, async () => {
        if (!isEnabled || isRunning) return;
        await runSync();
    }, {
        scheduled: true,
        timezone: 'America/Sao_Paulo',
    });

    logger.info(`⏰ Sync scheduler iniciado (cron: ${CRON_EXPRESSION})`);
}

/**
 * Run a full sync cycle.
 */
async function runSync() {
    if (isRunning) {
        logger.warn('⏳ Sync já em andamento, ignorando...');
        return { ok: false, message: 'Sync já em andamento' };
    }

    isRunning = true;
    const startTime = Date.now();
    const results = [];

    const entities = [
        { name: 'contas_pagar', label: 'Contas a Pagar', fn: importContasPagar },
        { name: 'contas_receber', label: 'Contas a Receber', fn: importContasReceber },
        { name: 'contatos', label: 'Fornecedores', fn: importContatos },
        { name: 'notas_entrada', label: 'Notas de Entrada', fn: importNotasEntrada },
    ];

    logger.info('🔄 Sync automático iniciado...');

    for (const entity of entities) {
        try {
            const result = await entity.fn(() => { }); // No progress callback for cron
            results.push({ entity: entity.name, status: 'ok', count: result.count });
            logger.info(`  ✅ ${entity.label}: ${result.count} registros`);
        } catch (err) {
            results.push({ entity: entity.name, status: 'error', error: err.message });
            logger.error(`  ❌ ${entity.label}: ${err.message}`);
        }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const totalRecords = results.filter(r => r.status === 'ok').reduce((sum, r) => sum + r.count, 0);
    const hasErrors = results.some(r => r.status === 'error');

    lastRun = new Date().toISOString();
    lastResult = {
        timestamp: lastRun,
        duration,
        results,
        totalRecords,
        status: hasErrors ? 'partial' : 'success',
    };

    // Save notification
    try {
        const title = hasErrors
            ? '⚠️ Sync parcial concluído'
            : '✅ Sync automático concluído';
        const message = `${totalRecords} registros sincronizados em ${duration}s`;

        await query(
            'INSERT INTO notifications (type, title, message) VALUES ($1, $2, $3)',
            [hasErrors ? 'warning' : 'success', title, message]
        );
    } catch (e) {
        // Notifications table might not exist yet
        logger.warn('Notificação não salva:', e.message);
    }

    isRunning = false;
    logger.info(`🔄 Sync automático concluído em ${duration}s — ${totalRecords} registros`);

    return lastResult;
}

/**
 * Get current scheduler status.
 */
function getSchedulerStatus() {
    return {
        enabled: isEnabled,
        running: isRunning,
        cron: CRON_EXPRESSION,
        lastRun,
        lastResult,
        nextRun: isEnabled && schedulerTask ? getNextRun() : null,
    };
}

/**
 * Calculate approximate next run time.
 */
function getNextRun() {
    const now = new Date();
    const hour = now.getHours();
    const nextHour = Math.ceil((hour + 1) / 6) * 6;
    const next = new Date(now);

    if (nextHour >= 24) {
        next.setDate(next.getDate() + 1);
        next.setHours(0, 0, 0, 0);
    } else {
        next.setHours(nextHour, 0, 0, 0);
    }

    return next.toISOString();
}

/**
 * Toggle scheduler on/off.
 */
function toggleScheduler(enabled) {
    isEnabled = enabled;
    if (schedulerTask) {
        if (enabled) {
            schedulerTask.start();
            logger.info('⏰ Scheduler ativado');
        } else {
            schedulerTask.stop();
            logger.info('⏸️  Scheduler desativado');
        }
    }
    return { enabled: isEnabled };
}

/**
 * Manually trigger a sync (for API use).
 */
async function runSyncNow() {
    return await runSync();
}

module.exports = {
    startScheduler,
    getSchedulerStatus,
    toggleScheduler,
    runSyncNow,
};
