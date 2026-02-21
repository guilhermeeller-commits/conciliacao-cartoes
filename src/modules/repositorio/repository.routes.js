/**
 * Repository Routes — Import & browse Olist/Tiny ERP data
 * 
 * GET  /api/repository/stats          → Counts + summaries
 * GET  /api/repository/sync           → SSE streaming import
 * GET  /api/repository/data/:entity   → Paginated data browser
 */

const express = require('express');
const router = express.Router();
const {
    importContasPagar,
    importContasReceber,
    importContatos,
    importNotasEntrada,
    getStats,
    getData,
} = require('../../services/olist-repository');
const logger = require('../../utils/logger');

/**
 * GET /api/repository/stats
 * Returns counts, last sync info, and financial summaries.
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await getStats();
        res.json({ sucesso: true, ...stats });
    } catch (error) {
        logger.error(`❌ Erro ao obter stats: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * GET /api/repository/sync
 * SSE endpoint — streams progress of full import.
 */
router.get('/sync', async (req, res) => {
    // SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    function sendEvent(eventName, data) {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    const entities = [
        { name: 'contas_pagar', label: 'Contas a Pagar', fn: importContasPagar },
        { name: 'contas_receber', label: 'Contas a Receber', fn: importContasReceber },
        { name: 'contatos', label: 'Fornecedores / Contatos', fn: importContatos },
        { name: 'notas_entrada', label: 'Notas Fiscais de Entrada', fn: importNotasEntrada },
    ];

    sendEvent('start', {
        message: 'Iniciando sincronização com Olist...',
        totalEntities: entities.length,
    });

    const results = [];
    let completedEntities = 0;

    for (const entity of entities) {
        sendEvent('entity_start', {
            entity: entity.name,
            label: entity.label,
            index: completedEntities,
        });

        try {
            const result = await entity.fn((progress) => {
                sendEvent('progress', {
                    entity: entity.name,
                    ...progress,
                    entityIndex: completedEntities,
                    totalEntities: entities.length,
                });
            });

            results.push({ ...result, status: 'ok' });
            completedEntities++;

            sendEvent('entity_done', {
                entity: entity.name,
                label: entity.label,
                count: result.count,
                pages: result.pages,
                index: completedEntities,
            });
        } catch (err) {
            logger.error(`❌ Erro ao importar ${entity.name}: ${err.message}`);
            results.push({ entity: entity.name, status: 'error', error: err.message });
            completedEntities++;

            sendEvent('entity_error', {
                entity: entity.name,
                label: entity.label,
                error: err.message,
                index: completedEntities,
            });
        }
    }

    // Final stats
    const finalStats = await getStats();
    sendEvent('complete', {
        message: 'Sincronização concluída!',
        results,
        stats: finalStats,
    });

    res.end();
});

/**
 * GET /api/repository/data/:entity
 * Returns paginated data for a given entity.
 * Query params: page, limit, search
 */
router.get('/data/:entity', async (req, res) => {
    try {
        const { entity } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || '';

        const result = await getData(entity, { page, limit, search });
        res.json({ sucesso: true, ...result });
    } catch (error) {
        logger.error(`❌ Erro ao obter dados ${req.params.entity}: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

module.exports = router;
