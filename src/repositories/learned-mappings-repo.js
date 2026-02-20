/**
 * Repository — learned_mappings
 * Mapeamentos aprendidos (descrição → categoria).
 * Substitui o antigo config/learned-mappings.json.
 */
const { getDb } = require('../database/connection');
const logger = require('../utils/logger');

const learnedMappingsRepo = {
    getAll() {
        const rows = getDb().prepare(`SELECT descricao, categoria FROM learned_mappings`).all();
        const map = {};
        for (const r of rows) map[r.descricao] = r.categoria;
        return map;
    },

    salvar(descricao, categoria) {
        getDb().prepare(`
            INSERT INTO learned_mappings (descricao, categoria)
            VALUES (?, ?)
            ON CONFLICT(descricao) DO UPDATE SET categoria = excluded.categoria
        `).run(descricao, categoria);
        logger.info(`💾 Mapeamento salvo: "${descricao}" → ${categoria}`);
    },
};

module.exports = learnedMappingsRepo;
