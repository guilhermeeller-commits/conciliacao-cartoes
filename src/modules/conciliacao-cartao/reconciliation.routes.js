const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { parsePdfFatura } = require('../../services/pdf-parser');
const { classificarItens, gerarResumo, salvarMapeamento } = require('../../services/expense-classifier');
const { incluirContaPagar, baixarContaPagar, pesquisarContasPagar, obterContaPagar, excluirContaPagar, estornarBaixa } = require('../../services/olist-financial');
const { pesquisarNotasEntrada, obterNotaFiscal, inferirCategoriaPorItens, cruzarTransacaoComNotas } = require('../../services/olist-notas');
const logger = require('../../utils/logger');
const { safePath, validators, SafePathError } = require('../../utils/safe-path');

// Base directory for Banco de Dados files
const BANCO_DADOS_BASE = path.join(__dirname, '../../../data/banco-dados');

// Config
const configPath = path.join(__dirname, '../../../config/financial-rules.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Multer — upload de PDF para memória
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF são aceitos'), false);
        }
    },
});

// ─── Helpers: padronização de dados para o Olist ────

/**
 * Gera nro_documento padronizado: MM/YY - Cartão - {Fornecedor}
 * Aceita tanto DD/MM/YYYY quanto YYYY-MM-DD (ISO).
 * Ex: "15/02/2026" ou "2026-02-15" → "02/26 - Cartão - Caixa Econômica Federal"
 */
function formatNroDocumento(vencimento, fornecedor) {
    if (!vencimento) return '';
    let mm, yy;
    if (vencimento.includes('-')) {
        // ISO: YYYY-MM-DD
        const parts = vencimento.split('-');
        if (parts.length < 2) return '';
        mm = parts[1].padStart(2, '0');
        yy = parts[0].slice(-2);
    } else {
        // legado: DD/MM/YYYY
        const parts = vencimento.split('/');
        if (parts.length !== 3) return '';
        mm = parts[1].padStart(2, '0');
        yy = parts[2].slice(-2);
    }
    return `${mm}/${yy} - Cartão - ${fornecedor}`;
}

/**
 * Remove quebras de linha e espaços extras de qualquer texto
 * enviado ao Olist para manter consistência.
 */
function sanitizeText(text) {
    if (!text) return '';
    return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * GET /api/reconciliation/categories
 */
router.get('/categories', (req, res) => {
    res.json({
        categorias: config.categorias || [],
        cartoes: config.cartoes || {},
    });
});

/**
 * POST /api/reconciliation/preview
 * Quick parse: extracts metadata (vencimento, valor total, competência) from PDF
 * without full classification or NF cross-referencing.
 */
router.post('/preview', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhum arquivo PDF enviado' });
        }

        logger.info(`🔍 Preview: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);

        const { banco, transacoes, metadados } = await parsePdfFatura(req.file.buffer);

        // Calculate total value from transactions
        const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);

        // Build competência from vencimento
        let competencia = null;
        if (metadados.vencimento) {
            const parts = metadados.vencimento.split('/');
            if (parts.length === 3) {
                competencia = parts[1] + '/' + parts[2];
            }
        }

        res.json({
            sucesso: true,
            banco_detectado: banco,
            vencimento: metadados.vencimento || null,
            competencia,
            valor_total: valorTotal,
            total_transacoes: transacoes.length,
        });
    } catch (error) {
        logger.error(`❌ Erro no preview: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/preview-from-bd
 * Preview a file that's already saved in Banco de Dados
 * Body: { year, month, banco, filename }
 */
router.post('/preview-from-bd', async (req, res) => {
    try {
        const { year, month, banco, filename } = req.body;

        // Validação e sanitização de path traversal
        let filePath;
        try {
            validators.year(year);
            validators.month(month);
            validators.banco(banco);
            validators.filename(filename);
            filePath = safePath(BANCO_DADOS_BASE, year, month, banco, filename);
        } catch (pathError) {
            logger.warn(`⚠️ Path traversal detectado em preview-from-bd: ${pathError.message}`);
            return res.status(400).json({ erro: 'Parâmetros de caminho inválidos' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ erro: 'Arquivo não encontrado no Banco de Dados' });
        }

        const buffer = fs.readFileSync(filePath);
        logger.info(`🔍 Preview BD: ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);

        const { banco: bancoDetectado, transacoes, metadados } = await parsePdfFatura(buffer);

        const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);

        let competencia = null;
        if (metadados.vencimento) {
            const parts = metadados.vencimento.split('/');
            if (parts.length === 3) {
                competencia = parts[1] + '/' + parts[2];
            }
        }

        res.json({
            sucesso: true,
            banco_detectado: bancoDetectado,
            vencimento: metadados.vencimento || null,
            competencia,
            valor_total: valorTotal,
            total_transacoes: transacoes.length,
        });
    } catch (error) {
        logger.error(`❌ Erro preview BD: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/upload-from-bd
 * Full process a file from Banco de Dados (parse + classify + NF cross-ref)
 * Body: { year, month, banco, filename, cartao }
 */
router.post('/upload-from-bd', async (req, res) => {
    try {
        const { year, month, banco, filename, cartao } = req.body;

        // Validação e sanitização de path traversal
        let filePath;
        try {
            validators.year(year);
            validators.month(month);
            validators.banco(banco);
            validators.filename(filename);
            filePath = safePath(BANCO_DADOS_BASE, year, month, banco, filename);
        } catch (pathError) {
            logger.warn(`⚠️ Path traversal detectado em upload-from-bd: ${pathError.message}`);
            return res.status(400).json({ erro: 'Parâmetros de caminho inválidos' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ erro: 'Arquivo não encontrado no Banco de Dados' });
        }

        const cartaoNome = cartao;
        if (!cartaoNome || !config.cartoes[cartaoNome]) {
            return res.status(400).json({ erro: `Cartão inválido: ${cartaoNome}` });
        }

        const buffer = fs.readFileSync(filePath);
        logger.info(`📄 Processando BD: ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);

        // 1. Parse
        const { banco: bancoDetectado, transacoes, metadados } = await parsePdfFatura(buffer);
        logger.info(`   → Banco detectado: ${bancoDetectado}, ${transacoes.length} transações`);

        // 2. Classify — Bug 1 fix: função era classificarTransacoes (inexistente). Bug 2: precisa de await
        const itensClassificados = await classificarItens(transacoes);
        logger.info(`   → ${itensClassificados.filter(t => t.confianca !== 'manual').length}/${itensClassificados.length} classificados automaticamente`);

        // 3. NF cross-reference (max 10s)
        let nfsCruzadas = 0;
        const naoClassificados = itensClassificados.filter(t => t.confianca === 'manual');

        if (naoClassificados.length > 0 && process.env.TINY_API_TOKEN) {
            const NF_TIMEOUT_MS = 10000;
            try {
                await Promise.race([
                    (async () => {
                        const { dataInicial, dataFinal } = calcularRangeBusca(transacoes, metadados);
                        logger.info(`🔍 Buscando NFs de entrada entre ${dataInicial} e ${dataFinal}...`);
                        const notasEntrada = await pesquisarNotasEntrada(dataInicial, dataFinal);
                        if (notasEntrada.length > 0) {
                            for (const item of naoClassificados) {
                                const matches = cruzarTransacaoComNotas(item, notasEntrada);
                                if (matches.length > 0) {
                                    const nfDetalhe = await obterNotaFiscal(matches[0].id);
                                    if (nfDetalhe && nfDetalhe.itens.length > 0) {
                                        const primeiroItem = nfDetalhe.itens[0];
                                        if (primeiroItem.categoria_produto) {
                                            const categoriaLimpa = primeiroItem.categoria_produto.replace(/^.*?>>\s*/, '');
                                            item.categoria = categoriaLimpa;
                                            item.confianca = 'nota_fiscal';
                                            item.fonte = 'NF-e';
                                            item.nf_numero = nfDetalhe.numero;
                                            item.nf_fornecedor = nfDetalhe.fornecedor;
                                            nfsCruzadas++;
                                        }
                                    }
                                    await new Promise(r => setTimeout(r, 2100));
                                }
                            }
                        }
                        if (nfsCruzadas > 0) {
                            logger.info(`✅ ${nfsCruzadas} transações cruzadas com notas de entrada`);
                        }
                    })(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('NF cross-reference timeout')), NF_TIMEOUT_MS)),
                ]);
            } catch (nfError) {
                logger.warn(`⚠️ Cruzamento NF interrompido (continuando sem): ${nfError.message}`);
            }
        }

        // 4. Summary
        const resumo = gerarResumo(itensClassificados);
        logger.info(`✅ ${itensClassificados.length} transações processadas, ${resumo.percentualClassificado}% classificadas`);

        res.json({
            transacoes: itensClassificados,
            banco_detectado: bancoDetectado,
            cartao: cartaoNome,
            metadados,
            nfs_cruzadas: nfsCruzadas,
            resumo: {
                total: resumo.total,
                totalNaoClassificado: resumo.totalNaoClassificado,
                percentualClassificado: resumo.percentualClassificado,
                quantidade: itensClassificados.length,
            },
        });
    } catch (error) {
        // Tratar violação de unicidade do PostgreSQL (upload duplicado)
        if (error.code === '23505' && error.constraint === 'uq_card_statements_card_date_file') {
            logger.warn(`⚠️ Upload duplicado detectado: ${error.detail}`);
            return res.status(409).json({
                erro: 'Esta fatura já foi processada anteriormente',
                duplicata: true,
                mensagem: 'Use a opção de reprocessar se deseja substituir os dados existentes',
            });
        }
        logger.error(`❌ Erro processamento BD: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/upload
 * Recebe PDF, parseia, classifica, e tenta cruzar com NFs do Olist.
 */
router.post('/upload', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhum arquivo PDF enviado' });
        }

        const cartaoNome = req.body.cartao;
        if (!cartaoNome || !config.cartoes[cartaoNome]) {
            return res.status(400).json({
                erro: `Cartão inválido: "${cartaoNome}"`,
                cartoes_disponiveis: Object.keys(config.cartoes),
            });
        }

        logger.info(`📤 Upload recebido: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB) — ${cartaoNome}`);

        // 1. Parse PDF
        const { banco, transacoes, metadados } = await parsePdfFatura(req.file.buffer);

        if (transacoes.length === 0) {
            return res.status(400).json({
                erro: 'Nenhuma transação encontrada no PDF.',
                banco_detectado: banco,
            });
        }

        // 2. Classifica (regras + memória) — Bug 2 fix: classificarItens é async, precisa de await
        const itensClassificados = await classificarItens(transacoes);

        // 3. Tenta cruzar itens não classificados com NFs do Olist (max 10s)
        let nfsCruzadas = 0;
        const naoClassificados = itensClassificados.filter(t => t.confianca === 'manual');

        if (naoClassificados.length > 0 && process.env.TINY_API_TOKEN) {
            const NF_TIMEOUT_MS = 10000; // 10 seconds max for NF cross-referencing
            try {
                await Promise.race([
                    (async () => {
                        // Calcula range de datas para busca
                        const { dataInicial, dataFinal } = calcularRangeBusca(transacoes, metadados);
                        logger.info(`🔍 Buscando NFs de entrada entre ${dataInicial} e ${dataFinal}...`);

                        const notasEntrada = await pesquisarNotasEntrada(dataInicial, dataFinal);

                        if (notasEntrada.length > 0) {
                            for (const item of naoClassificados) {
                                const matches = cruzarTransacaoComNotas(item, notasEntrada);

                                if (matches.length > 0) {
                                    const nfDetalhe = await obterNotaFiscal(matches[0].id);
                                    if (nfDetalhe && nfDetalhe.itens.length > 0) {
                                        const inferido = inferirCategoriaPorItens(nfDetalhe.itens);
                                        if (inferido.categoria) {
                                            item.categoria = inferido.categoria;
                                            item.confianca = inferido.confianca;
                                            item.fonte = 'nota_fiscal';
                                            item.nf_match = {
                                                numero: nfDetalhe.numero,
                                                cliente: nfDetalhe.cliente,
                                                itens: nfDetalhe.itens.map(i => i.descricao).slice(0, 5),
                                            };
                                            nfsCruzadas++;
                                            salvarMapeamento(item.descricao, inferido.categoria);
                                            logger.info(`🔗 Cruzado: "${item.descricao}" → NF ${nfDetalhe.numero} → ${inferido.categoria}`);
                                        }
                                    }
                                    await new Promise(r => setTimeout(r, 2100));
                                }
                            }
                        }

                        if (nfsCruzadas > 0) {
                            logger.info(`✅ ${nfsCruzadas} transações cruzadas com notas de entrada`);
                        }
                    })(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('NF cross-reference timeout')), NF_TIMEOUT_MS)),
                ]);
            } catch (nfError) {
                logger.warn(`⚠️ Cruzamento NF interrompido (continuando sem): ${nfError.message}`);
            }
        }

        // 4. Gera resumo
        const resumo = gerarResumo(itensClassificados);
        logger.info(`✅ ${itensClassificados.length} transações processadas, ${resumo.percentualClassificado}% classificadas`);

        res.json({
            sucesso: true,
            banco_detectado: banco,
            cartao: cartaoNome,
            config_cartao: config.cartoes[cartaoNome],
            metadados,
            transacoes: itensClassificados,
            nfs_cruzadas: nfsCruzadas,
            resumo: {
                total: resumo.total,
                totalClassificado: resumo.totalClassificado,
                totalNaoClassificado: resumo.totalNaoClassificado,
                percentualClassificado: resumo.percentualClassificado,
                quantidade: itensClassificados.length,
            },
        });
    } catch (error) {
        // Tratar violação de unicidade do PostgreSQL (upload duplicado)
        if (error.code === '23505' && error.constraint === 'uq_card_statements_card_date_file') {
            logger.warn(`⚠️ Upload duplicado detectado: ${error.detail}`);
            return res.status(409).json({
                erro: 'Esta fatura já foi processada anteriormente',
                duplicata: true,
                mensagem: 'Use a opção de reprocessar se deseja substituir os dados existentes',
            });
        }
        logger.error(`❌ Erro no upload: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/learn
 * Salva um mapeamento aprendido (quando o usuário corrige no UI).
 * Body: { descricao: string, categoria: string }
 */
router.post('/learn', (req, res) => {
    try {
        const { descricao, categoria } = req.body;
        if (!descricao || !categoria) {
            return res.status(400).json({ erro: 'descricao e categoria são obrigatórios' });
        }

        salvarMapeamento(descricao, categoria);
        res.json({ sucesso: true, descricao, categoria });
    } catch (error) {
        logger.error(`❌ Erro ao salvar mapeamento: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/send-item
 * Sends a SINGLE item to Olist ERP (incluir + baixar).
 * Used by frontend to send items one-by-one with real progress.
 */
router.post('/send-item', async (req, res) => {
    try {
        const { cartao, vencimento, competencia, documento, item } = req.body;

        if (!cartao || !config.cartoes[cartao]) {
            return res.status(400).json({ erro: `Cartão inválido: "${cartao}"` });
        }
        if (!vencimento) {
            return res.status(400).json({ erro: 'Vencimento é obrigatório' });
        }
        if (!item) {
            return res.status(400).json({ erro: 'Nenhum item fornecido' });
        }

        const cartaoConfig = config.cartoes[cartao];

        if (!item.categoria || item.categoria.includes('NÃO CLASSIFICADO')) {
            return res.json({ sucesso: true, status: 'pulado', motivo: 'Sem categoria' });
        }

        const nroDoc = formatNroDocumento(vencimento, cartaoConfig.fornecedor);
        const desc = sanitizeText(`${cartaoConfig.fornecedor} | ${item.descricao}${item.parcela ? ` (${item.parcela})` : ''}`);

        const resultado = await incluirContaPagar({
            vencimento,
            valor: item.valor,
            categoria: item.categoria,
            descricao: desc,
            nro_documento: nroDoc,
            data_emissao: item.data,
            competencia: competencia || '',
            fornecedor: cartaoConfig.fornecedor,
        });

        if (resultado.sucesso) {
            res.json({ sucesso: true, status: 'ok', id_olist: resultado.id });
        } else {
            res.json({ sucesso: false, status: 'erro', erro: resultado.erro });
        }
    } catch (error) {
        logger.error(`❌ Erro no send-item: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/send
 * (Legacy) Sends all items in one request.
 */
router.post('/send', async (req, res) => {
    try {
        const { cartao, vencimento, competencia, documento, itens } = req.body;

        if (!cartao || !config.cartoes[cartao]) {
            return res.status(400).json({ erro: `Cartão inválido: "${cartao}"` });
        }
        if (!vencimento) {
            return res.status(400).json({ erro: 'Vencimento é obrigatório' });
        }
        if (!itens || !Array.isArray(itens) || itens.length === 0) {
            return res.status(400).json({ erro: 'Nenhum item para enviar' });
        }

        const cartaoConfig = config.cartoes[cartao];
        logger.info(`📤 Iniciando envio de ${itens.length} lançamentos — ${cartao} (sem baixa)`);

        const resultados = [];
        let enviados = 0;
        let erros = 0;

        for (let i = 0; i < itens.length; i++) {
            const item = itens[i];

            if (!item.categoria || item.categoria.includes('NÃO CLASSIFICADO')) {
                resultados.push({ ...item, status: 'pulado', motivo: 'Sem categoria' });
                continue;
            }

            const nroDoc = formatNroDocumento(vencimento, cartaoConfig.fornecedor);
            const desc = sanitizeText(`${cartaoConfig.fornecedor} | ${item.descricao}${item.parcela ? ` (${item.parcela})` : ''}`);

            const resultado = await incluirContaPagar({
                vencimento,
                valor: item.valor,
                categoria: item.categoria,
                descricao: desc,
                nro_documento: nroDoc,
                data_emissao: item.data,
                competencia: competencia || '',
                fornecedor: cartaoConfig.fornecedor,
            });

            if (resultado.sucesso) {
                enviados++;
                resultados.push({ ...item, status: 'ok', id_olist: resultado.id });
            } else {
                erros++;
                resultados.push({ ...item, status: 'erro', erro: resultado.erro });
            }

            if (i < itens.length - 1) {
                await new Promise(r => setTimeout(r, 2100));
            }
        }

        logger.info(`📊 Envio finalizado: ${enviados} OK, ${erros} erros, ${resultados.length - enviados - erros} pulados`);

        res.json({
            sucesso: true,
            estatisticas: {
                total: itens.length,
                enviados,
                erros,
                pulados: resultados.length - enviados - erros,
            },
            resultados,
        });
    } catch (error) {
        logger.error(`❌ Erro no envio: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * Calcula range de datas para busca de NFs.
 * Usa as datas das transações + metadados para definir período.
 */
/**
 * Extrai mês e ano de uma string de data no formato DD/MM/YYYY ou YYYY-MM-DD.
 * Retorna { mes: number, ano: number } ou null se inválido.
 */
function parseDateParts(dateStr) {
    if (!dateStr) return null;
    if (dateStr.includes('-')) {
        // ISO: YYYY-MM-DD
        const parts = dateStr.split('-');
        if (parts.length < 2) return null;
        return { ano: parseInt(parts[0]), mes: parseInt(parts[1]) };
    }
    // legado: DD/MM/YYYY
    const parts = dateStr.split('/');
    if (parts.length < 2) return null;
    const mes = parseInt(parts[1]);
    const ano = parts.length === 3 ? parseInt(parts[2]) : new Date().getFullYear();
    return { ano, mes };
}

function calcularRangeBusca(transacoes, metadados) {
    // Bug 6 fix: aceitar datas ISO além de DD/MM/YYYY
    let ano = new Date().getFullYear();
    if (metadados?.vencimento) {
        const p = parseDateParts(metadados.vencimento);
        if (p) ano = p.ano;
    }

    // Pega mês mais antigo e mais recente das transações
    const meses = transacoes
        .map(t => {
            const p = parseDateParts(t.data);
            return p ? p.mes : null;
        })
        .filter(m => m !== null);

    if (meses.length === 0) {
        // Fallback: current month only
        const now = new Date();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        return { dataInicial: `01/${m}/${ano}`, dataFinal: `28/${m}/${ano}` };
    }

    const mesMin = Math.min(...meses);
    const mesMax = Math.max(...meses);

    // Tight range: only the months that appear in transactions
    const dataInicial = `01/${String(mesMin).padStart(2, '0')}/${ano}`;
    const ultimoDia = new Date(ano, mesMax, 0).getDate();
    const dataFinal = `${ultimoDia}/${String(mesMax).padStart(2, '0')}/${ano}`;

    return { dataInicial, dataFinal };
}

/**
 * GET /api/reconciliation/search-entries
 * Search Olist entries by fornecedor, date range, and status.
 * Query params: fornecedor, dataInicial, dataFinal, situacao, pagina
 * 
 * IMPORTANT: Only returns entries associated with card accounts (3.1, 3.2, 3.3, 3.4).
 * Entries from other financial accounts are filtered out.
 * Since the Tiny API does not support filtering by bank account directly,
 * we filter server-side by checking that the entry's historico matches the
 * pattern created by our card reconciliation system: "{fornecedor} | {descricao}".
 */
router.get('/search-entries', async (req, res) => {
    try {
        const { fornecedor, dataInicial, dataFinal, situacao, pagina } = req.query;

        if (!fornecedor) {
            return res.status(400).json({ erro: 'Fornecedor é obrigatório' });
        }

        // Build list of valid card fornecedor names from config
        const cardFornecedores = Object.values(config.cartoes).map(c => c.fornecedor);

        // Support __ALL__ to search all card accounts at once
        if (fornecedor === '__ALL__') {
            let todasContas = [];
            for (const cardKey of Object.keys(config.cartoes)) {
                const cardConfig = config.cartoes[cardKey];
                const resultado = await pesquisarContasPagar({
                    fornecedor: cardConfig.fornecedor,
                    dataInicial: dataInicial || '',
                    dataFinal: dataFinal || '',
                    situacao: situacao || '',
                    pagina: pagina || 1,
                });
                if (resultado.sucesso && resultado.contas.length > 0) {
                    // Filter to card entries only
                    const filtered = resultado.contas.filter(conta => {
                        const hist = (conta.historico || '').trim();
                        return cardFornecedores.some(f => hist.startsWith(`${f} |`));
                    });
                    // Tag each with the account name
                    filtered.forEach(c => c.conta_nome = cardConfig.conta_nome);
                    todasContas = todasContas.concat(filtered);
                    logger.info(`🔍 ${cardKey}: ${filtered.length} contas de cartão encontradas`);
                } else if (resultado.sucesso) {
                    logger.info(`🔍 ${cardKey}: nenhuma conta encontrada`);
                } else {
                    logger.warn(`⚠️ ${cardKey}: erro na busca - ${resultado.erro || 'desconhecido'}`);
                }
                // Rate limit between API calls
                await new Promise(r => setTimeout(r, 2100));
            }
            // Sort by date descending
            todasContas.sort((a, b) => {
                const da = (a.data_vencimento || '').split('/').reverse().join('');
                const db = (b.data_vencimento || '').split('/').reverse().join('');
                return db.localeCompare(da);
            });
            return res.json({ sucesso: true, contas: todasContas, paginas: 1 });
        }

        const resultado = await pesquisarContasPagar({
            fornecedor,
            dataInicial: dataInicial || '',
            dataFinal: dataFinal || '',
            situacao: situacao || '',
            pagina: pagina || 1,
        });

        if (resultado.sucesso && resultado.contas.length > 0) {
            const contasOriginais = resultado.contas.length;
            resultado.contas = resultado.contas.filter(conta => {
                const hist = (conta.historico || '').trim();
                return cardFornecedores.some(f => hist.startsWith(`${f} |`));
            });
            // Tag each with the account name
            const cartaoEntry = Object.values(config.cartoes).find(c => c.fornecedor === fornecedor);
            if (cartaoEntry) {
                resultado.contas.forEach(c => c.conta_nome = cartaoEntry.conta_nome);
            }

            if (contasOriginais !== resultado.contas.length) {
                logger.info(`🔍 Filtro de contas de cartão: ${contasOriginais} → ${resultado.contas.length} (${contasOriginais - resultado.contas.length} de outras contas removidas)`);
            }
        }

        res.json(resultado);
    } catch (error) {
        logger.error(`❌ Erro ao pesquisar entries: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/reverse-entry
 * Reverse (estornar) a single paid entry, then delete it.
 * Body: { id: string }
 */
router.post('/reverse-entry', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ erro: 'ID é obrigatório' });
        }

        // Step 1: Estornar a baixa (reverse the payment)
        const estorno = await estornarBaixa(id);

        if (!estorno.sucesso) {
            // If estornar fails, try to delete directly (maybe it's already open)
            logger.warn(`⚠️ Estorno falhou para ${id}: ${estorno.erro}. Tentando excluir diretamente...`);
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 2100));

        // Step 2: Excluir a conta
        const exclusao = await excluirContaPagar(id);

        res.json({
            sucesso: exclusao.sucesso,
            estorno: estorno.sucesso ? 'ok' : estorno.erro,
            exclusao: exclusao.sucesso ? 'ok' : exclusao.erro,
        });
    } catch (error) {
        logger.error(`❌ Erro ao reverter entry: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/delete-batch
 * Reverse and delete multiple entries.
 * Body: { ids: string[] }
 */
router.post('/delete-batch', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ erro: 'Nenhum ID fornecido' });
        }

        logger.info(`🗑️ Iniciando exclusão em lote de ${ids.length} contas...`);

        const resultados = [];
        let sucesso = 0;
        let erros = 0;

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];

            // Step 1: Estornar
            const estorno = await estornarBaixa(id);
            await new Promise(r => setTimeout(r, 2100));

            // Step 2: Excluir
            const exclusao = await excluirContaPagar(id);

            if (exclusao.sucesso) {
                sucesso++;
                resultados.push({ id, status: 'ok' });
            } else {
                erros++;
                resultados.push({ id, status: 'erro', erro: exclusao.erro, estorno: estorno.erro });
            }

            // Rate limit between operations
            if (i < ids.length - 1) {
                await new Promise(r => setTimeout(r, 2100));
            }
        }

        logger.info(`📊 Exclusão em lote: ${sucesso} removidas, ${erros} erros`);

        res.json({
            sucesso: true,
            estatisticas: { total: ids.length, sucesso, erros },
            resultados,
        });
    } catch (error) {
        logger.error(`❌ Erro na exclusão em lote: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/add-entry
 * Manually add a new entry to Olist ERP (incluir + baixar).
 * Body: { cartao, vencimento, valor, categoria, descricao, competencia }
 */
router.post('/add-entry', async (req, res) => {
    try {
        const { cartao, vencimento, valor, categoria, descricao, competencia } = req.body;

        if (!cartao || !config.cartoes[cartao]) {
            return res.status(400).json({ erro: `Cartão inválido: "${cartao}"` });
        }
        if (!vencimento) {
            return res.status(400).json({ erro: 'Vencimento é obrigatório' });
        }
        if (!valor || isNaN(parseFloat(valor)) || parseFloat(valor) <= 0) {
            return res.status(400).json({ erro: 'Valor inválido' });
        }
        if (!categoria) {
            return res.status(400).json({ erro: 'Categoria é obrigatória' });
        }

        const cartaoConfig = config.cartoes[cartao];
        const valorNum = parseFloat(valor);

        logger.info(`➕ Adicionando lançamento manual: ${descricao} — R$ ${valorNum.toFixed(2)} → ${categoria} (${cartao})`);

        const nroDoc = formatNroDocumento(vencimento, cartaoConfig.fornecedor);
        const desc = sanitizeText(`${cartaoConfig.fornecedor} | ${descricao || 'Lançamento manual'}`);

        const resultado = await incluirContaPagar({
            vencimento,
            valor: valorNum,
            categoria,
            descricao: desc,
            nro_documento: nroDoc,
            data_emissao: vencimento,
            competencia: competencia || '',
            fornecedor: cartaoConfig.fornecedor,
        });

        if (resultado.sucesso) {
            res.json({ sucesso: true, id: resultado.id });
        } else {
            res.json({ sucesso: false, erro: resultado.erro });
        }
    } catch (error) {
        logger.error(`❌ Erro no add-entry: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

/**
 * POST /api/reconciliation/pay-batch
 * Baixar (pagar) multiple entries — moves them from "contas a pagar" to "Caixa" of each bank.
 * Body: { entries: [{ id, valor, data_vencimento, fornecedor }] }
 * 
 * We detect the correct bank account (conta_nome) by matching fornecedor to card config.
 */
router.post('/pay-batch', async (req, res) => {
    try {
        const { entries } = req.body;
        if (!entries || !Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ erro: 'Nenhuma entrada fornecida' });
        }

        logger.info(`💰 Iniciando baixa de ${entries.length} contas a pagar...`);

        // Build a fornecedor → conta_nome map from config
        const fornecedorToContaNome = {};
        Object.entries(config.cartoes).forEach(([key, card]) => {
            fornecedorToContaNome[card.fornecedor.toLowerCase()] = card.conta_nome;
        });

        const resultados = [];
        let sucesso = 0;
        let erros = 0;

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            // Detect which card account to use
            let contaOrigem = null;
            const fornecedorLower = (entry.fornecedor || '').toLowerCase();
            for (const [key, nome] of Object.entries(fornecedorToContaNome)) {
                if (fornecedorLower.includes(key) || key.includes(fornecedorLower)) {
                    contaOrigem = nome;
                    break;
                }
            }

            if (!contaOrigem) {
                // Fallback: try to infer from entry description
                logger.warn(`⚠️ Não encontrou conta para fornecedor: ${entry.fornecedor}`);
                resultados.push({ id: entry.id, status: 'erro', erro: `Fornecedor não mapeado: ${entry.fornecedor}` });
                erros++;
                continue;
            }

            const valor = parseFloat(entry.valor) || 0;
            const dataBaixa = entry.data_vencimento || new Date().toLocaleDateString('pt-BR');

            try {
                const resultado = await baixarContaPagar({
                    id: entry.id,
                    contaOrigem,
                    data: dataBaixa,
                    valor,
                });

                if (resultado.sucesso) {
                    logger.info(`   ✅ Baixa ${i + 1}/${entries.length}: ID ${entry.id} → ${contaOrigem}`);
                    resultados.push({ id: entry.id, status: 'ok', conta: contaOrigem });
                    sucesso++;
                } else {
                    logger.warn(`   ❌ Baixa ${i + 1}/${entries.length}: ${resultado.erro}`);
                    resultados.push({ id: entry.id, status: 'erro', erro: resultado.erro });
                    erros++;
                }
            } catch (err) {
                logger.error(`   ❌ Erro na baixa ${i + 1}: ${err.message}`);
                resultados.push({ id: entry.id, status: 'erro', erro: err.message });
                erros++;
            }

            // Rate limit
            if (i < entries.length - 1) {
                await new Promise(r => setTimeout(r, 2100));
            }
        }

        logger.info(`📊 Baixa em lote concluída: ${sucesso} pagos, ${erros} erros`);

        res.json({
            sucesso: true,
            estatisticas: { total: entries.length, sucesso, erros },
            resultados,
        });
    } catch (error) {
        logger.error(`❌ Erro no pay-batch: ${error.message}`);
        res.status(500).json({ erro: error.message });
    }
});

module.exports = router;
