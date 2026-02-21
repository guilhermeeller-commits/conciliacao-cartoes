const axios = require('axios');
const logger = require('../utils/logger');

// ─── Olist/Tiny API V2 ────────────────────────
const TINY_API_BASE = 'https://api.tiny.com.br/api2';

// Rate limiting: Tiny API permite ~30 requests/minuto
const RATE_LIMIT_MS = 2100; // ~2.1s entre chamadas para ficar seguro

// ─── Helpers: padronização ────────────────────

function formatNroDocumento(vencimento, fornecedor) {
    if (!vencimento) return '';
    const parts = vencimento.split('/');
    if (parts.length !== 3) return '';
    const mm = parts[1].padStart(2, '0');
    const yy = parts[2].slice(-2);
    return `${mm}/${yy} - Cartão - ${fornecedor}`;
}

function sanitizeText(text) {
    if (!text) return '';
    return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Inclui uma conta a pagar no Olist Tiny ERP.
 *
 * @param {object} dados - Dados da conta a pagar
 * @param {string} dados.vencimento - Data de vencimento (DD/MM/YYYY)
 * @param {number} dados.valor - Valor da despesa
 * @param {string} dados.categoria - Categoria do plano de contas
 * @param {string} dados.descricao - Descrição/histórico da despesa
 * @param {string} [dados.nro_documento] - Número do documento
 * @param {string} [dados.data_emissao] - Data de emissão (DD/MM/YYYY)
 * @param {string} [dados.competencia] - Competência (MM/YYYY)
 * @param {string} [dados.fornecedor] - Nome do fornecedor
 * @returns {{ sucesso: boolean, id: string|null, erro: string|null }}
 */
async function incluirContaPagar(dados) {
    const token = process.env.TINY_API_TOKEN;
    if (!token) {
        throw new Error('TINY_API_TOKEN não configurado no .env');
    }

    const conta = {
        data: dados.data_emissao || dados.vencimento,
        vencimento: dados.vencimento,
        valor: dados.valor.toFixed(2),
        categoria: dados.categoria || '',
        historico: dados.descricao || '',
        nro_documento: dados.nro_documento || '',
        competencia: dados.competencia || '',
        forma_pagamento: dados.forma_pagamento || '',
        cliente: {
            nome: dados.fornecedor || '',
        },
    };

    try {
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('formato', 'json');
        params.append('conta', JSON.stringify({ conta }));

        logger.info(`📋 Payload conta.pagar.incluir: ${JSON.stringify(conta)}`);

        const { data: resposta } = await axios.post(
            `${TINY_API_BASE}/conta.pagar.incluir.php`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
            }
        );

        logger.info(`📋 Resposta conta.pagar.incluir: ${JSON.stringify(resposta)}`);

        // Analisa resposta
        if (resposta.retorno?.status === 'OK') {
            const id = resposta.retorno?.registros?.[0]?.registro?.id
                || resposta.retorno?.id
                || null;

            logger.info(`✅ Conta incluída: "${dados.descricao}" — R$ ${dados.valor.toFixed(2)} → ${dados.categoria} (ID: ${id})`);
            return { sucesso: true, id, erro: null };
        }

        // Erros
        const erros = resposta.retorno?.erros || [];
        const msgErro = Array.isArray(erros)
            ? erros.map(e => e.erro || e).join('; ')
            : JSON.stringify(erros);

        logger.warn(`⚠️  Erro ao incluir conta "${dados.descricao}": ${msgErro}`);
        return { sucesso: false, id: null, erro: msgErro };

    } catch (error) {
        logger.error(`❌ Erro HTTP ao incluir conta: ${error.message}`);
        return { sucesso: false, id: null, erro: error.message };
    }
}

/**
 * Baixa (liquida) uma conta a pagar no Olist Tiny ERP,
 * vinculando o pagamento a uma conta bancária (Caixa e Bancos).
 *
 * @param {object} dados
 * @param {string} dados.id - ID da conta a pagar retornado por incluirContaPagar
 * @param {string} dados.contaOrigem - Nome da conta bancária no Olist (ex: '3.4. Cartão Mercado Pago')
 * @param {string} dados.data - Data da baixa (DD/MM/YYYY)
 * @param {number} dados.valor - Valor pago
 * @returns {{ sucesso: boolean, erro: string|null }}
 */
async function baixarContaPagar(dados) {
    const token = process.env.TINY_API_TOKEN;
    if (!token) throw new Error('TINY_API_TOKEN não configurado');

    const baixa = {
        id: dados.id,
        contaOrigem: dados.contaOrigem,
        data: dados.data,
        valorPago: dados.valor.toFixed(2),
    };

    try {
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('formato', 'json');
        params.append('conta', JSON.stringify({ conta: baixa }));

        const { data: resposta } = await axios.post(
            `${TINY_API_BASE}/conta.pagar.baixar.php`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
            }
        );

        if (resposta.retorno?.status === 'OK') {
            logger.info(`   💰 Baixa realizada → ${dados.contaOrigem}`);
            return { sucesso: true, erro: null };
        }

        const erros = resposta.retorno?.erros || [];
        const msgErro = Array.isArray(erros)
            ? erros.map(e => e.erro || e).join('; ')
            : JSON.stringify(erros);

        logger.warn(`   ⚠️ Erro na baixa: ${msgErro}`);
        return { sucesso: false, erro: msgErro };

    } catch (error) {
        logger.error(`   ❌ Erro HTTP na baixa: ${error.message}`);
        return { sucesso: false, erro: error.message };
    }
}

/**
 * Envia múltiplos itens como contas a pagar no Olist E baixa automaticamente
 * na conta bancária do cartão (Caixa e Bancos).
 *
 * @param {Array} itensClassificados - Itens classificados pelo expense-classifier
 * @param {object} opcoes - Configurações do cartão
 * @param {string} opcoes.vencimento - Data de vencimento da fatura (DD/MM/YYYY)
 * @param {string} opcoes.fornecedor - Nome do fornecedor/bandeira do cartão
 * @param {string} opcoes.competencia - Competência (MM/YYYY)
 * @param {string} opcoes.nro_documento - Número do documento da fatura
 * @param {string} opcoes.contaOrigem - Nome da conta bancária no Olist (ex: '3.4. Cartão Mercado Pago')
 * @returns {{ enviados: number, erros: number, detalhes: Array }}
 */
async function enviarLoteFatura(itensClassificados, opcoes) {
    const resultados = {
        enviados: 0,
        baixados: 0,
        erros: 0,
        total: itensClassificados.length,
        detalhes: [],
    };

    logger.info(`📤 Iniciando envio de ${itensClassificados.length} lançamentos para o Olist ERP...`);
    logger.info(`   Fornecedor: ${opcoes.fornecedor}`);
    logger.info(`   Vencimento: ${opcoes.vencimento}`);
    logger.info(`   Conta bancária: ${opcoes.contaOrigem || 'N/A (sem baixa automática)'}`);
    logger.info(`   Competência: ${opcoes.competencia || 'N/A'}`);
    logger.info('');

    for (let i = 0; i < itensClassificados.length; i++) {
        const item = itensClassificados[i];

        // Pula itens não classificados
        if (item.confianca === 'manual') {
            logger.warn(`⏭️  Pulando item não classificado: "${item.descricao}" — R$ ${item.valor.toFixed(2)}`);
            resultados.detalhes.push({
                ...item,
                status: 'pulado',
                motivo: 'Não classificado',
            });
            continue;
        }

        const progresso = `[${i + 1}/${itensClassificados.length}]`;
        logger.info(`${progresso} Enviando: "${item.descricao}" — R$ ${item.valor.toFixed(2)} → ${item.categoria}`);

        // Padroniza nro_documento: MM/YY - Cartão - {Fornecedor}
        const nroDoc = formatNroDocumento(opcoes.vencimento, opcoes.fornecedor);
        const desc = sanitizeText(`${opcoes.fornecedor} | ${item.descricao}${item.parcela ? ` (${item.parcela})` : ''}`);

        const resultado = await incluirContaPagar({
            vencimento: opcoes.vencimento,
            valor: item.valor,
            categoria: item.categoria,
            descricao: desc,
            nro_documento: nroDoc,
            data_emissao: item.data,
            competencia: opcoes.competencia || '',
            fornecedor: opcoes.fornecedor,
        });

        if (resultado.sucesso) {
            resultados.enviados++;
            const detalhe = { ...item, status: 'ok', id_olist: resultado.id };

            // Auto-baixa na conta bancária do cartão
            if (opcoes.contaOrigem && resultado.id) {
                await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
                const baixa = await baixarContaPagar({
                    id: resultado.id,
                    contaOrigem: opcoes.contaOrigem,
                    data: opcoes.vencimento,
                    valor: item.valor,
                });
                if (baixa.sucesso) {
                    resultados.baixados++;
                    detalhe.baixa = 'ok';
                } else {
                    detalhe.baixa = 'erro';
                    detalhe.baixa_erro = baixa.erro;
                }
            }

            resultados.detalhes.push(detalhe);
        } else {
            resultados.erros++;
            resultados.detalhes.push({ ...item, status: 'erro', erro: resultado.erro });
        }

        // Rate limiting — aguarda entre chamadas
        if (i < itensClassificados.length - 1) {
            await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
        }
    }

    // Resumo final
    logger.info('');
    logger.info('═══════════════════════════════════════════');
    logger.info(`📊 RESULTADO DO ENVIO`);
    logger.info(`   ✅ Enviados com sucesso: ${resultados.enviados}`);
    logger.info(`   ❌ Erros: ${resultados.erros}`);
    logger.info(`   ⏭️  Pulados: ${resultados.total - resultados.enviados - resultados.erros}`);
    logger.info(`   📋 Total: ${resultados.total}`);
    logger.info('═══════════════════════════════════════════');

    return resultados;
}

/**
 * Gera um relatório de auditoria em JSON com timestamp.
 */
function gerarRelatorioAuditoria(resultados, opcoes) {
    return {
        timestamp: new Date().toISOString(),
        cartao: opcoes.cartao || 'N/A',
        fornecedor: opcoes.fornecedor,
        vencimento: opcoes.vencimento,
        competencia: opcoes.competencia || '',
        nro_documento: opcoes.nro_documento || '',
        estatisticas: {
            total: resultados.total,
            enviados: resultados.enviados,
            erros: resultados.erros,
            pulados: resultados.total - resultados.enviados - resultados.erros,
        },
        detalhes: resultados.detalhes,
    };
}

/**
 * Pesquisa contas a pagar no Tiny ERP.
 * Filtros possíveis: fornecedor, dataInicial, dataFinal, situacao
 */
async function pesquisarContasPagar(filtros = {}) {
    const token = process.env.TINY_API_TOKEN;
    if (!token) throw new Error('TINY_API_TOKEN não configurado');

    try {
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('formato', 'json');
        if (filtros.fornecedor) params.append('nome_cliente', filtros.fornecedor);
        if (filtros.dataInicial) params.append('dataIni', filtros.dataInicial);
        if (filtros.dataFinal) params.append('dataFim', filtros.dataFinal);
        if (filtros.situacao) params.append('situacao', filtros.situacao);
        if (filtros.pagina) params.append('pagina', filtros.pagina);

        logger.info(`🔍 Pesquisando contas a pagar: ${JSON.stringify(filtros)}`);

        const { data: resposta } = await axios.post(
            `${TINY_API_BASE}/contas.pagar.pesquisa.php`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
            }
        );

        if (resposta.retorno?.status === 'OK') {
            const contas = resposta.retorno?.contas || [];
            const parsed = contas.map(c => {
                const ct = c.conta || c;
                return {
                    id: ct.id,
                    nome_cliente: ct.nome_cliente || ct.cliente || '',
                    historico: ct.historico || '',
                    data_vencimento: ct.data_vencimento || ct.vencimento || '',
                    data_emissao: ct.data_emissao || '',
                    valor: parseFloat(ct.valor) || 0,
                    saldo: parseFloat(ct.saldo) || 0,
                    situacao: ct.situacao || '',
                    nro_documento: ct.nro_documento || '',
                };
            });

            const nroPaginas = resposta.retorno?.numero_paginas || 1;
            logger.info(`✅ Encontradas ${parsed.length} contas (página ${filtros.pagina || 1}/${nroPaginas})`);
            return { sucesso: true, contas: parsed, paginas: nroPaginas };
        }

        const erros = resposta.retorno?.erros || [];
        const msgErro = Array.isArray(erros)
            ? erros.map(e => e.erro || e).join('; ')
            : JSON.stringify(erros);

        // Various "no records" messages from Tiny API are not errors, just empty results
        if (msgErro.includes('Nenhum registro') || msgErro.includes('não retornou registros') || msgErro.includes('nao retornou registros')) {
            return { sucesso: true, contas: [], paginas: 0 };
        }

        logger.warn(`⚠️ Erro ao pesquisar contas: ${msgErro}`);
        return { sucesso: false, contas: [], erro: msgErro };

    } catch (error) {
        logger.error(`❌ Erro HTTP ao pesquisar contas: ${error.message}`);
        return { sucesso: false, contas: [], erro: error.message };
    }
}

/**
 * Obtém detalhes de uma conta a pagar específica.
 */
async function obterContaPagar(id) {
    const token = process.env.TINY_API_TOKEN;
    if (!token) throw new Error('TINY_API_TOKEN não configurado');

    try {
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('formato', 'json');
        params.append('id', id);

        const { data: resposta } = await axios.post(
            `${TINY_API_BASE}/conta.pagar.obter.php`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
            }
        );

        if (resposta.retorno?.status === 'OK') {
            const conta = resposta.retorno?.conta || {};
            return { sucesso: true, conta };
        }

        const erros = resposta.retorno?.erros || [];
        const msgErro = Array.isArray(erros)
            ? erros.map(e => e.erro || e).join('; ')
            : JSON.stringify(erros);
        return { sucesso: false, erro: msgErro };

    } catch (error) {
        return { sucesso: false, erro: error.message };
    }
}

/**
 * Tenta excluir uma conta a pagar no Tiny.
 * Somente funciona se a conta estiver em status "aberto" ou "cancelada".
 * Para contas "pagas", é preciso primeiro estornar a baixa.
 */
async function excluirContaPagar(id) {
    const token = process.env.TINY_API_TOKEN;
    if (!token) throw new Error('TINY_API_TOKEN não configurado');

    try {
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('formato', 'json');
        params.append('id', id);

        logger.info(`🗑️ Tentando excluir conta ID: ${id}`);

        const { data: resposta } = await axios.post(
            `${TINY_API_BASE}/conta.pagar.excluir.php`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
            }
        );

        logger.info(`📋 Resposta excluir: ${JSON.stringify(resposta)}`);

        if (resposta.retorno?.status === 'OK') {
            logger.info(`✅ Conta ${id} excluída com sucesso`);
            return { sucesso: true };
        }

        const erros = resposta.retorno?.erros || [];
        const msgErro = Array.isArray(erros)
            ? erros.map(e => e.erro || e).join('; ')
            : JSON.stringify(erros);
        logger.warn(`⚠️ Erro ao excluir conta ${id}: ${msgErro}`);
        return { sucesso: false, erro: msgErro };

    } catch (error) {
        logger.error(`❌ Erro HTTP ao excluir conta: ${error.message}`);
        return { sucesso: false, erro: error.message };
    }
}

/**
 * Tenta estornar a baixa de uma conta a pagar.
 * Isso reverte o status de "pago" para "aberto", permitindo a exclusão.
 */
async function estornarBaixa(id) {
    const token = process.env.TINY_API_TOKEN;
    if (!token) throw new Error('TINY_API_TOKEN não configurado');

    try {
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('formato', 'json');
        params.append('id', id);

        logger.info(`↩️ Tentando estornar baixa da conta ID: ${id}`);

        const { data: resposta } = await axios.post(
            `${TINY_API_BASE}/conta.pagar.estornar.php`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
            }
        );

        logger.info(`📋 Resposta estornar: ${JSON.stringify(resposta)}`);

        if (resposta.retorno?.status === 'OK') {
            logger.info(`✅ Baixa da conta ${id} estornada`);
            return { sucesso: true };
        }

        const erros = resposta.retorno?.erros || [];
        const msgErro = Array.isArray(erros)
            ? erros.map(e => e.erro || e).join('; ')
            : JSON.stringify(erros);
        logger.warn(`⚠️ Erro ao estornar baixa ${id}: ${msgErro}`);
        return { sucesso: false, erro: msgErro };

    } catch (error) {
        logger.error(`❌ Erro HTTP ao estornar: ${error.message}`);
        return { sucesso: false, erro: error.message };
    }
}

module.exports = {
    incluirContaPagar,
    baixarContaPagar,
    enviarLoteFatura,
    gerarRelatorioAuditoria,
    pesquisarContasPagar,
    obterContaPagar,
    excluirContaPagar,
    estornarBaixa,
};
