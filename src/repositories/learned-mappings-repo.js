/**
 * Repository — learned_mappings
 * Mapeamentos aprendidos (descrição → categoria).
 * Substitui o antigo config/learned-mappings.json.
 */
const { query } = require('../database/connection');
const logger = require('../utils/logger');

const learnedMappingsRepo = {
    async getAll() {
        const { rows } = await query('SELECT descricao, categoria FROM learned_mappings');
        const map = {};
        for (const r of rows) map[r.descricao] = r.categoria;
        return map;
    },

    async salvar(descricao, categoria) {
        await query(
            `INSERT INTO learned_mappings (descricao, categoria)
             VALUES ($1, $2)
             ON CONFLICT(descricao) DO UPDATE SET categoria = EXCLUDED.categoria`,
            [descricao, categoria]
        );
        logger.info(`💾 Mapeamento salvo: "${descricao}" → ${categoria}`);
    },
};

module.exports = learnedMappingsRepo;
