const axios = require('axios');
const logger = require('../utils/logger');
const { apiQueue } = require('./api-queue');

const TINY_API_BASE = 'https://api.tiny.com.br/api2';

/**
 * Pesquisa notas fiscais de entrada no Olist Tiny ERP.
 * 
 * @param {string} dataInicial - DD/MM/YYYY
 * @param {string} dataFinal - DD/MM/YYYY
 * @returns {Promise<Array<{ id, numero, cliente, valor, data_emissao }>>}
 */
async function pesquisarNotasEntrada(dataInicial, dataFinal) {
    const token = process.env.TINY_API_TOKEN;
    if (!token) throw new Error('TINY_API_TOKEN não configurado');

    const todasNotas = [];
    let pagina = 1;
    let temMais = true;
    const MAX_PAGES = 3; // Max 60 NFs to prevent long waits

    while (temMais) {
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('formato', 'json');
        params.append('tipo', 'E'); // Entrada
        params.append('dataInicial', dataInicial);
        params.append('dataFinal', dataFinal);
        params.append('pagina', pagina.toString());

        try {
            const { data: resposta } = await apiQueue.enqueue(({ signal }) => axios.post(
                `${TINY_API_BASE}/notas.fiscais.pesquisa.php`,
                params.toString(),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 30000,
                    signal,
                }
            ));

            if (resposta.retorno?.status !== 'OK') {
                const erros = resposta.retorno?.erros || [];
                // "Nenhum registro" não é erro
                if (JSON.stringify(erros).includes('Nenhum registro')) {
                    break;
                }
                logger.warn(`⚠️ Erro ao pesquisar NFs: ${JSON.stringify(erros)}`);
                break;
            }

            const notas = resposta.retorno?.notas_fiscais || [];
            for (const nf of notas) {
                const nota = nf.nota_fiscal || nf;
                todasNotas.push({
                    id: nota.id,
                    numero: nota.numero,
                    serie: nota.serie,
                    cliente: nota.nome_cliente || nota.cliente?.nome || '',
                    valor: parseFloat(nota.valor) || 0,
                    data_emissao: nota.data_emissao || '',
                    situacao: nota.situacao || '',
                });
            }

            // Paginação: Tiny retorna max 20 por página
            if (notas.length < 20) {
                temMais = false;
            } else if (pagina >= MAX_PAGES) {
                logger.info(`⚠️ Paginação limitada a ${MAX_PAGES} páginas (${todasNotas.length} NFs)`);
                temMais = false;
            } else {
                pagina++;
                // Rate limit controlado pela apiQueue — delay manual removido
            }
        } catch (error) {
            logger.error(`❌ Erro HTTP pesquisando NFs: ${error.message}`);
            break;
        }
    }

    logger.info(`📋 Encontradas ${todasNotas.length} notas de entrada entre ${dataInicial} e ${dataFinal}`);
    return todasNotas;
}

/**
 * Obtém detalhes de uma nota fiscal, incluindo itens.
 * 
 * @param {string|number} id - ID da nota fiscal no Tiny
 * @returns {Promise<{ id, numero, itens: Array<{ descricao, quantidade, valor_unitario }>, valor_total }>}
 */
async function obterNotaFiscal(id) {
    const token = process.env.TINY_API_TOKEN;
    if (!token) throw new Error('TINY_API_TOKEN não configurado');

    const params = new URLSearchParams();
    params.append('token', token);
    params.append('formato', 'json');
    params.append('id', id.toString());

    try {
        const { data: resposta } = await apiQueue.enqueue(({ signal }) => axios.post(
            `${TINY_API_BASE}/nota.fiscal.obter.php`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
                signal,
            }
        ));

        if (resposta.retorno?.status !== 'OK') {
            return null;
        }

        const nf = resposta.retorno?.nota_fiscal || {};
        const itens = (nf.itens || []).map(i => {
            const item = i.item || i;
            return {
                descricao: item.descricao || '',
                quantidade: parseFloat(item.quantidade) || 0,
                valor_unitario: parseFloat(item.valor_unitario) || 0,
                ncm: item.ncm || '',
                unidade: item.unidade || '',
            };
        });

        return {
            id: nf.id,
            numero: nf.numero,
            serie: nf.serie,
            cliente: nf.nome_emitente || nf.cliente?.nome || '',
            valor_total: parseFloat(nf.valor_nota) || 0,
            data_emissao: nf.data_emissao || '',
            itens,
        };
    } catch (error) {
        logger.error(`❌ Erro ao obter NF ${id}: ${error.message}`);
        return null;
    }
}

/**
 * Regras semânticas para inferir categoria pela descrição dos itens da NF.
 */
const REGRAS_ITENS_NF = [
    { palavras: ['embalagem', 'sacola', 'saco', 'bobina', 'stretch', 'filme'], categoria: '8.1.1. Embalagens' },
    { palavras: ['ferramenta', 'parafuso', 'serra', 'broca', 'disco', 'lixa', 'porca', 'arruela'], categoria: '4.6.4. Peças de Manutenção/Reparos' },
    { palavras: ['equipamento', 'máquina', 'maquina', 'motor', 'bomba', 'compressor'], categoria: '8.2.1. Compra de Equip. Produção' },
    { palavras: ['computador', 'monitor', 'teclado', 'mouse', 'impressora', 'notebook', 'cabo hdmi', 'pendrive'], categoria: '8.2.2. Compra de Equip. Administrativo' },
    { palavras: ['escritório', 'escritorio', 'papel', 'caneta', 'grampeador', 'envelope', 'pasta'], categoria: '4.6.5. Material de Escritório' },
    { palavras: ['limpeza', 'detergente', 'desinfetante', 'luva', 'pano', 'agua sanitaria', 'álcool'], categoria: '4.6.2. Higiene e Limpeza' },
    { palavras: ['alimento', 'açúcar', 'acucar', 'café', 'cafe', 'copo', 'guardanapo'], categoria: '4.6.1. Copa e Cozinha' },
    { palavras: ['tinta', 'verniz', 'solvente', 'pintura', 'primer'], categoria: '8.1.2. Matéria Prima' },
    { palavras: ['eletrico', 'elétrico', 'fio', 'disjuntor', 'tomada', 'interruptor', 'lampada', 'lâmpada'], categoria: '4.6.4. Peças de Manutenção/Reparos' },
    { palavras: ['epi', 'proteção', 'protecao', 'capacete', 'óculos', 'oculos', 'bota'], categoria: '4.7.1. EPI - Equipamento de Proteção' },
];

/**
 * Infere a categoria pelo conteúdo dos itens de uma NF.
 * Analisa todas as descrições e retorna a categoria mais provável.
 * 
 * @param {Array<{ descricao }>} itens
 * @returns {{ categoria: string|null, confianca: string, motivo: string }}
 */
function inferirCategoriaPorItens(itens) {
    if (!itens || itens.length === 0) {
        return { categoria: null, confianca: 'manual', motivo: 'NF sem itens' };
    }

    // Concatena todas as descrições
    const textoItens = itens.map(i => i.descricao).join(' ').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Pontua cada categoria
    const pontuacao = {};
    for (const regra of REGRAS_ITENS_NF) {
        let hits = 0;
        for (const palavra of regra.palavras) {
            const normalizada = palavra.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (textoItens.includes(normalizada)) {
                hits++;
            }
        }
        if (hits > 0) {
            pontuacao[regra.categoria] = (pontuacao[regra.categoria] || 0) + hits;
        }
    }

    // Retorna a categoria com mais hits
    const sorted = Object.entries(pontuacao).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
        return {
            categoria: sorted[0][0],
            confianca: sorted[0][1] >= 2 ? 'alta' : 'media',
            motivo: `Inferido dos itens da NF (${sorted[0][1]} palavras-chave)`,
        };
    }

    return { categoria: null, confianca: 'manual', motivo: 'Nenhuma palavra-chave nos itens' };
}

/**
 * Tenta cruzar uma transação do cartão com as notas de entrada.
 * Match por valor (tolerância ±R$0.50) e data (±15 dias).
 * 
 * @param {{ data: string, valor: number, descricao: string }} transacao
 * @param {Array} notasEntrada - Lista de notas da pesquisa
 * @returns {Array<{ id, numero, valor, data_emissao, cliente }>} - Possíveis matches
 */
function cruzarTransacaoComNotas(transacao, notasEntrada) {
    const toleranciaValor = 0.50;
    const toleranciaDias = 15;

    // Parse data da transação — aceita DD/MM/YYYY, DD/MM ou YYYY-MM-DD (ISO)
    let dataTransacao;
    if (transacao.data && transacao.data.includes('-')) {
        // ISO: YYYY-MM-DD
        dataTransacao = new Date(transacao.data + 'T00:00:00');
    } else {
        const partsData = (transacao.data || '').split('/');
        if (partsData.length === 3) {
            dataTransacao = new Date(partsData[2], partsData[1] - 1, partsData[0]);
        } else if (partsData.length === 2) {
            // DD/MM — assume ano corrente
            const ano = new Date().getFullYear();
            dataTransacao = new Date(ano, parseInt(partsData[1]) - 1, parseInt(partsData[0]));
        } else {
            return [];
        }
    }

    const matches = [];
    for (const nota of notasEntrada) {
        // Match por valor
        if (Math.abs(nota.valor - transacao.valor) > toleranciaValor) continue;

        // Match por data
        const partsNF = nota.data_emissao.split('/');
        if (partsNF.length < 3) continue;
        const dataNF = new Date(partsNF[2], partsNF[1] - 1, partsNF[0]);
        const diffDias = Math.abs((dataTransacao - dataNF) / (1000 * 60 * 60 * 24));
        if (diffDias > toleranciaDias) continue;

        matches.push(nota);
    }

    return matches;
}

module.exports = {
    pesquisarNotasEntrada,
    obterNotaFiscal,
    inferirCategoriaPorItens,
    cruzarTransacaoComNotas,
    REGRAS_ITENS_NF,
};
