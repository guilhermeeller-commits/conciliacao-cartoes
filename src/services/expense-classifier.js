const logger = require('../utils/logger');
const path = require('path');

// ─── Carrega regras de classificação ──────────
const configPath = path.join(__dirname, '../../config/financial-rules.json');
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// ─── Repositório de mapeamentos aprendidos ────
// Fonte de verdade única: PostgreSQL via learned-mappings-repo.
let learnedMappingsRepo;
try {
    learnedMappingsRepo = require('../repositories/learned-mappings-repo');
} catch (e) {
    // Fallback silencioso — DB pode não estar pronto em boot
    learnedMappingsRepo = null;
}

async function carregarMapeamentos() {
    // Fonte de verdade: PostgreSQL
    if (learnedMappingsRepo) {
        try {
            return await learnedMappingsRepo.getAll();
        } catch (e) {
            logger.warn(`⚠️ Erro ao carregar mapeamentos do PostgreSQL: ${e.message}`);
        }
    }
    // Se o repositório não está disponível, retornar vazio
    logger.warn('⚠️ Repositório de mapeamentos não disponível — classificação por memória desabilitada');
    return {};
}

async function salvarMapeamento(descricao, categoria) {
    const key = normalizarDescricao(descricao);

    // Salvar apenas no PostgreSQL (fonte de verdade única)
    if (learnedMappingsRepo) {
        try {
            await learnedMappingsRepo.salvar(key, categoria);
        } catch (e) {
            logger.error(`❌ Erro ao salvar mapeamento no PostgreSQL: ${e.message}`);
            throw e;
        }
    } else {
        logger.error('❌ Repositório de mapeamentos não disponível — impossível salvar');
        throw new Error('Repositório de mapeamentos não disponível');
    }

    return true;
}

function normalizarDescricao(desc) {
    return desc
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Classifica uma lista de itens usando 3 camadas:
 *  1. Regras fixas (regex em card-rules.json)
 *  2. Mapeamentos aprendidos (learned-mappings)
 *  3. Fallback → marca como manual
 *
 * Nota: camada 3 (cruzamento com Olist NFs) é feita separadamente
 * via classifyWithOlistNFs() após a classificação inicial.
 *
 * @param {Array<{ data, descricao, valor, parcela }>} itens
 * @returns {Array<{ ...item, categoria, confianca, regra_match, fonte }>}
 */
async function classificarItens(itens) {
    const regras = config.regras_classificacao || [];
    const mappings = await carregarMapeamentos();

    // Compila as regras em regex
    const regrasCompiladas = regras.map(r => ({
        regex: new RegExp(r.padrao, 'i'),
        categoria: r.categoria,
        padrao_original: r.padrao,
    }));

    const resultados = itens.map(item => {
        // Camada 1: Mapeamentos aprendidos (prioridade máxima — o usuário já corrigiu)
        const classMem = classificarPorMemoria(item.descricao, mappings);
        if (classMem.confianca !== 'manual') {
            return { ...item, ...classMem, fonte: 'memória' };
        }

        // Camada 2: Regras fixas (regex)
        const classRegra = classificarPorRegra(item.descricao, regrasCompiladas);
        if (classRegra.confianca !== 'manual') {
            return { ...item, ...classRegra, fonte: 'regra' };
        }

        // Sem classificação → manual
        return {
            ...item,
            categoria: '⚠️ NÃO CLASSIFICADO',
            confianca: 'manual',
            regra_match: null,
            fonte: null,
        };
    });

    // Log
    const classificados = resultados.filter(r => r.confianca !== 'manual');
    const naoClassificados = resultados.filter(r => r.confianca === 'manual');
    const porFonte = {};
    classificados.forEach(r => { porFonte[r.fonte] = (porFonte[r.fonte] || 0) + 1; });

    logger.info(`🏷️  Classificação: ${classificados.length} classificados, ${naoClassificados.length} pendentes`);
    if (Object.keys(porFonte).length > 0) {
        logger.info(`   Fontes: ${Object.entries(porFonte).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    if (naoClassificados.length > 0) {
        logger.info(`⚠️  Itens não classificados:`);
        naoClassificados.forEach(item => {
            logger.info(`   - "${item.descricao}" (R$ ${item.valor.toFixed(2)})`);
        });
    }

    return resultados;
}

/**
 * Camada 1: classifica por regra regex.
 */
function classificarPorRegra(descricao, regrasCompiladas) {
    const descNorm = normalizarDescricao(descricao);

    for (const regra of regrasCompiladas) {
        if (regra.regex.test(descricao) || regra.regex.test(descNorm)) {
            return {
                categoria: regra.categoria,
                confianca: 'alta',
                regra_match: regra.padrao_original,
            };
        }
    }

    return { categoria: null, confianca: 'manual', regra_match: null };
}

/**
 * Camada 2: classifica por memória/mapeamentos aprendidos.
 * Tenta match exato, depois match parcial (fornecedor).
 */
function classificarPorMemoria(descricao, mappings) {
    const descNorm = normalizarDescricao(descricao);

    // Match exato
    if (mappings[descNorm]) {
        return {
            categoria: mappings[descNorm],
            confianca: 'alta',
            regra_match: `memória: "${descNorm}"`,
        };
    }

    // Match parcial — busca se a key está contida na descrição ou vice-versa
    for (const [key, cat] of Object.entries(mappings)) {
        if (descNorm.includes(key) || key.includes(descNorm)) {
            return {
                categoria: cat,
                confianca: 'media',
                regra_match: `memória parcial: "${key}"`,
            };
        }
    }

    return { categoria: null, confianca: 'manual', regra_match: null };
}

/**
 * Gera um resumo agrupado por categoria.
 */
function gerarResumo(itensClassificados) {
    const categorias = {};
    let total = 0;
    let totalNaoClassificado = 0;

    for (const item of itensClassificados) {
        if (!categorias[item.categoria]) {
            categorias[item.categoria] = { itens: [], subtotal: 0, quantidade: 0 };
        }

        categorias[item.categoria].itens.push(item);
        categorias[item.categoria].subtotal += item.valor;
        categorias[item.categoria].quantidade += 1;
        total += item.valor;

        if (item.confianca === 'manual') {
            totalNaoClassificado += item.valor;
        }
    }

    return {
        categorias,
        total,
        totalNaoClassificado,
        totalClassificado: total - totalNaoClassificado,
        percentualClassificado: total > 0
            ? ((total - totalNaoClassificado) / total * 100).toFixed(1)
            : '0',
    };
}

module.exports = {
    classificarItens,
    gerarResumo,
    salvarMapeamento,
    carregarMapeamentos,
    normalizarDescricao,
};
