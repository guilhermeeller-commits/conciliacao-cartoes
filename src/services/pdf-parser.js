const pdfParse = require('pdf-parse');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * Parseia um PDF de fatura de cartão de crédito.
 * Extrai transações com: data, descrição, valor, parcela.
 *
 * @param {Buffer|string} input - Buffer do PDF ou caminho do arquivo
 * @returns {Promise<{ banco, transacoes, metadados }>}
 */
async function parsePdfFatura(input) {
    const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
    const pdf = await pdfParse(buffer);
    const texto = pdf.text;

    logger.info(`📄 PDF parseado: ${pdf.numpages} páginas, ${texto.length} caracteres`);

    // Tenta detectar o banco pelo conteúdo
    const banco = detectarBanco(texto);
    logger.info(`🏦 Banco detectado: ${banco}`);

    // Extrai metadados (vencimento, emissão)
    const metadados = extrairMetadados(texto);
    if (metadados.vencimento) {
        logger.info(`📅 Vencimento detectado: ${metadados.vencimento}`);
    }

    let transacoes;
    switch (banco) {
        case 'mercadopago':
            transacoes = parseMercadoPago(texto, metadados);
            break;
        case 'caixa':
            transacoes = parseCaixaEconomica(texto, metadados);
            break;
        case 'cresol':
            transacoes = parseCresol(texto, metadados);
            break;
        case 'santander':
            transacoes = parseSantander(texto);
            break;
        default:
            transacoes = parseGenerico(texto);
    }

    // Normalize all dates to ISO YYYY-MM-DD format
    if (metadados.vencimento) {
        metadados.vencimento = convertDateToISO(metadados.vencimento);
    }
    if (metadados.emissao) {
        metadados.emissao = convertDateToISO(metadados.emissao);
    }

    // Normalize transaction dates too
    for (const t of transacoes) {
        if (t.data) {
            t.data = convertDateToISO(t.data);
        }
    }

    logger.info(`✅ ${transacoes.length} transações extraídas`);
    return { banco, transacoes, metadados };
}

/**
 * Converts DD/MM/YYYY to YYYY-MM-DD (ISO format).
 * If already in ISO format or unrecognized, returns as-is.
 */
function convertDateToISO(dateStr) {
    if (!dateStr) return dateStr;
    // Already ISO? (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // DD/MM/YYYY
    const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return dateStr;
}

/**
 * Extrai metadados da fatura: vencimento, emissão, etc.
 * Busca padrões comuns nos textos de fatura.
 */
function extrairMetadados(texto) {
    const metadados = { vencimento: null, emissao: null, valor_total: null };
    const linhas = texto.split('\n');

    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i].trim();

        // "Vence em\n14/01/2026" (Mercado Pago)
        if (/vence\s*em/i.test(linha) && i + 1 < linhas.length) {
            const proxima = linhas[i + 1].trim();
            const matchData = proxima.match(/^(\d{2}\/\d{2}\/\d{4})$/);
            if (matchData) metadados.vencimento = matchData[1];
        }

        // "VENCIMENTO\n12/01/2026" (Caixa — linha isolada)
        if (/^VENCIMENTO$/i.test(linha) && i + 1 < linhas.length) {
            const proxima = linhas[i + 1].trim();
            const matchData = proxima.match(/^(\d{2}\/\d{2}\/\d{4})$/);
            if (matchData && !metadados.vencimento) metadados.vencimento = matchData[1];
        }

        // "Data de Vencimento:\n20/12/2025" (Santander — label + próxima linha)
        if (/data de vencimento/i.test(linha) && i + 1 < linhas.length) {
            const proxima = linhas[i + 1].trim();
            const matchData = proxima.match(/^(\d{2}\/\d{2}\/\d{4})$/);
            if (matchData && !metadados.vencimento) metadados.vencimento = matchData[1];
        }

        // "Vencimento: DD/MM/YYYY" (formato inline)
        const matchVenc = linha.match(/vencimento[:\s]+(\d{2}\/\d{2}\/\d{4})/i);
        if (matchVenc && !metadados.vencimento) metadados.vencimento = matchVenc[1];

        // Valor total: "R$ 13.850,22" após "VALOR TOTAL DESTA FATURA" ou "Total\nR$ X"
        if (/valor total desta fatura|^= *$|^Total$/i.test(linha) && i + 1 < linhas.length) {
            const proxima = linhas[i + 1].trim();
            const matchValor = proxima.match(/R\$\s*([\d.,]+)/);
            if (matchValor && !metadados.valor_total) {
                metadados.valor_total = parseValorBR(matchValor[1]);
            }
        }

        // Cresol: "no valor total de R$ 7.716,95."
        const matchCresolTotal = linha.match(/no valor total de R\$\s*([\d.,]+)/i);
        if (matchCresolTotal && !metadados.valor_total) {
            metadados.valor_total = parseValorBR(matchCresolTotal[1]);
        }

        // Vencimento Cresol: " 11 JAN 2026" após "VENCIMENTO"
        if (/^VENCIMENTO$/i.test(linha) && i + 1 < linhas.length) {
            const proxima = linhas[i + 1].trim();
            const matchCresolData = proxima.match(/^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})$/i);
            if (matchCresolData && !metadados.vencimento) {
                const MESES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
                const m = MESES[matchCresolData[2].toUpperCase()];
                metadados.vencimento = `${String(matchCresolData[1]).padStart(2, '0')}/${m}/${matchCresolData[3]}`;
            }
        }

        // "Emitido em: DD/MM/YYYY"
        const matchEmissao = linha.match(/emitido\s*em[:\s]+(\d{2}\/\d{2}\/\d{4})/i);
        if (matchEmissao) metadados.emissao = matchEmissao[1];
    }

    return metadados;
}


/**
 * Detecta o banco pelo conteúdo do PDF.
 */
function detectarBanco(texto) {
    const t = texto.toLowerCase();
    if (t.includes('mercado pago') || t.includes('mercadopago') || t.includes('mercadolivre')) return 'mercadopago';
    if (t.includes('cresol') || t.includes('sicoob cresol')) return 'cresol';
    // Caixa: detecta pelo telefone de atendimento ou texto característico
    if (t.includes('cartões caixa') || t.includes('cartao caixa') || t.includes('40040104') || t.includes('caixa econômica') || t.includes('caixa economica')) return 'caixa';
    // Santander: o PDF não contém a palavra 'santander', detecta pelo número de cartão ou cabeçalho
    if (t.includes('santander') || t.includes('5546 xxxx xxxx') || (t.includes('empresas mastercard platinum') && t.includes('fatura mensal'))) return 'santander';
    return 'generico';
}

/**
 * Parser para faturas do Mercado Pago.
 * O texto extraído do PDF concatena colunas sem espaços:
 *   "24/08MERCADOLIVRE*CDASILVAMACHParcela 5 de 18R$ 112,88"
 *   "19/12ADOBER$ 114,00"
 *   "31/12MERCADOLIVRE*MERCADOLIVRER$ 4.599,00"
 */
function parseMercadoPago(texto, metadados) {
    const transacoes = [];
    const linhas = texto.split('\n');

    // Regex principal: DD/MM + descrição + (opcional Parcela X de Y) + R$ valor
    const regexPrincipal = /^(\d{2}\/\d{2})(.+?)(?:Parcela\s+(\d+)\s+de\s+(\d+))?R\$\s*([\d.,]+)\s*$/;

    // Infer statement year/month from metadados
    let stmtYear = new Date().getFullYear();
    let stmtMonth = new Date().getMonth() + 1;
    if (metadados && metadados.vencimento) {
        const venc = metadados.vencimento;
        if (venc.includes('-')) {
            const [y, m] = venc.split('-');
            stmtYear = parseInt(y, 10); stmtMonth = parseInt(m, 10);
        } else if (venc.includes('/')) {
            const parts = venc.split('/');
            if (parts.length === 3) { stmtMonth = parseInt(parts[1], 10); stmtYear = parseInt(parts[2], 10); }
        }
    }

    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i].trim();
        if (!linha) continue;

        const match = linha.match(regexPrincipal);
        if (!match) continue;

        const [, dataCurta, descricaoRaw, parcelaAtual, parcelaTotal, valorRaw] = match;

        // Ignora linhas de metadados
        const descTrim = descricaoRaw.trim();
        if (!descTrim) continue;
        if (descTrim.match(/^(Pagamento|Crédito|Tarifa|Total|Saldo)/i)) continue;

        const valor = parseValorBR(valorRaw);
        if (isNaN(valor) || valor <= 0) continue;

        const parcela = parcelaAtual && parcelaTotal ? `${parcelaAtual}/${parcelaTotal}` : null;

        const [dia, mes] = dataCurta.split('/');
        const txMonth = parseInt(mes, 10);
        const txYear = txMonth > stmtMonth ? stmtYear - 1 : stmtYear;
        const data = `${dia}/${mes}/${txYear}`;

        transacoes.push({
            data,
            descricao: descTrim.toUpperCase(),
            valor,
            parcela,
        });
    }

    return transacoes;
}


/**
 * Parser para faturas da Caixa Econômica Federal.
 * Formato real: "02/12STOK CENTER 30LAGES341,76D"
 * — Data DD/MM colada na descrição, cidade colada no valor, D ou C no final.
 */
function parseCaixaEconomica(texto, metadados) {
    const transacoes = [];
    const linhas = texto.split('\n');

    // Infer statement year/month from metadados
    let stmtYear = new Date().getFullYear();
    let stmtMonth = new Date().getMonth() + 1;
    if (metadados && metadados.vencimento) {
        const venc = metadados.vencimento;
        if (venc.includes('-')) {
            const [y, m] = venc.split('-');
            stmtYear = parseInt(y, 10); stmtMonth = parseInt(m, 10);
        } else if (venc.includes('/')) {
            const parts = venc.split('/');
            if (parts.length === 3) { stmtMonth = parseInt(parts[1], 10); stmtYear = parseInt(parts[2], 10); }
        }
    }

    // Caixa formato real: "02/12STOK CENTER 30LAGES341,76D"
    // Parcelada: "29/08PLASNOX                   05 DE 18GASPAR6.389,04D"
    // IMPORTANTE: o valor deve ser <= 99.999,99 (valores gigantes são IDs de beneficiário)
    // Regex: começa com DD/MM, termina com valor decimal + D ou C no final
    // O valor DEVE ter vírgula decimal - ex: 341,76 ou 1.322,06
    const regexLinha = /^(\d{2}\/\d{2})(.+?)((?:(?:\d{1,3}\.)?\d{1,3},\d{2}))\s*([DC])\s*$/;

    // Filtros de linhas a ignorar
    const ignorar = /^(TOTAL|Cr[eé]dito|Pagamento|Ajuste|DataDescri|ANUIDADE|Saldo)/i;

    for (const linha of linhas) {
        const trimmed = linha.trim();
        if (!trimmed || trimmed.length < 10) continue;

        const match = trimmed.match(regexLinha);
        if (!match) continue;

        const [, dataRaw, restoBruto, valorRaw, tipo] = match;

        // Ignora créditos (pagamentos, ajustes)
        if (tipo !== 'D') continue;

        const valor = parseValorBR(valorRaw);
        if (isNaN(valor) || valor <= 0 || valor > 99999) continue; // valor max sanidade

        let descricao = restoBruto.trim();

        if (ignorar.test(descricao)) continue;

        // Parcela no formato "05 DE 18" — entre descrição e cidade
        let parcela = null;
        const mParcela = descricao.match(/^(.+?)\s+(\d{2})\s+DE\s+(\d{2,3})\s+(.*)$/);
        if (mParcela) {
            descricao = mParcela[1].trim();
            parcela = `${parseInt(mParcela[2])}/${parseInt(mParcela[3])}`;
            // mParcela[4] é a cidade — descarta
        } else {
            // Remove cidade do final: sequência final de maiúsculas (cidade colada)
            // Ex: "STOK CENTER 30LAGES" → "STOK CENTER 30" (remove "LAGES")
            descricao = descricao.replace(/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}(\s[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}){0,2}$/, '').trim();
            // Se ainda terminar com caps colados no meio de outra palavra, remove
            descricao = descricao.replace(/[a-z0-9\s][A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}$/, (m) => m[0]).trim();
        }

        if (!descricao || descricao.length < 2) continue;
        if (ignorar.test(descricao)) continue;

        const [, diaRaw, mesRaw] = dataRaw.split('/');
        const txMonth = parseInt(mesRaw, 10);
        const txYear = txMonth > stmtMonth ? stmtYear - 1 : stmtYear;
        const data = `${dataRaw}/${txYear}`;

        transacoes.push({
            data,
            descricao: descricao.toUpperCase().trim(),
            valor,
            parcela,
        });
    }

    return transacoes;
}

/**
 * Parser para faturas do Cresol.
 * Formato real observado:
 *   " 04 DEZPETROLAGES COMERCIOLAGESR$ 1.220,00"
 *   " 17 DEZHOSTGATORFLORIANOPOLISR$ 113,89"
 * Cabeçalho de seção: " DATADESCRIÇÃOCIDADEVALOR EM R$"
 */
function parseCresol(texto, metadados) {
    const transacoes = [];
    const linhas = texto.split('\n');

    // Infer statement year/month from metadados
    let stmtYear = new Date().getFullYear();
    let stmtMonth = new Date().getMonth() + 1;
    if (metadados && metadados.vencimento) {
        const venc = metadados.vencimento;
        if (venc.includes('-')) {
            const [y, m] = venc.split('-');
            stmtYear = parseInt(y, 10); stmtMonth = parseInt(m, 10);
        } else if (venc.includes('/')) {
            const parts = venc.split('/');
            if (parts.length === 3) { stmtMonth = parseInt(parts[1], 10); stmtYear = parseInt(parts[2], 10); }
        }
    }

    const MESES_PT = {
        JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06',
        JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12',
    };

    // Formato observado no PDF real:
    // " 04 DEZPETROLAGES COMERCIOLAGESR$ 1.220,00"
    // " 05 DEZPOSTO 101 JAGUARUNAJAGUARUNAR$ 139,48"
    // Estrutura: espaço + DD + espaço + MES(3) + DESCRICAO_E_CIDADE_COLADOS + R$ + VALOR
    const regexLinha = /^\s*(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(.+?)R\$\s*([\d.,]+)\s*(-?)\s*$/i;

    // Linhas a ignorar
    const ignorar = /^(SALDO ANTERIOR|TOTAL DE |TOTAL R\$|Prote[çc][aã]o|ANUIDADE|DESC ANUIDADE|PAGAMENTO DA FATURA|mdte|ENCARGO)/i;

    for (const linha of linhas) {
        // Testa sem trim para preservar espaços iniciais (o espaço faz parte do formato)
        const match = linha.match(regexLinha);
        if (!match) continue;

        const [, dia, mesAbrev, restoBruto, valorRaw, sinal] = match;
        const mes = MESES_PT[mesAbrev.toUpperCase()];
        if (!mes) continue;

        // Ignora créditos (valor negativo)
        if (sinal === '-') continue;

        const valor = parseValorBR(valorRaw);
        if (isNaN(valor) || valor <= 0) continue;

        // restoBruto = descrição + cidade colados
        // Estratégia: a cidade Cresol fica colada NO FINAL antes do R$.
        // Heurística mais segura: encontra a última sequência de letras maiúsculas
        // SEM espaço entre elas (cidade colada) e remove.
        // Ex: "PETROLAGES COMERCIOLAGES" → remove "LAGES" (colado)
        // Ex: "POSTO 101 JAGUARUNAJAGUARUNA" → remove "JAGUARUNA" (colado)
        // Ex: "OBVIO BRASILSAO PAULO" → remove "SAO PAULO" (tem espaço masé cidade)
        let descricao = restoBruto.trim();

        // Remove sequência final de maiúsculas+espaços que não contém dígitos
        // (inclui cidades como "SAO PAULO", "FLORIANOPOLIS", "LAGES")
        descricao = descricao.replace(/\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,}(\s[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,}){0,2}$/, '').trim();

        // Se ainda termina com letras em caps coladas (sem espaço antes),
        // remove a última "palavra" colada no final
        // Ex: "PETROLAGES COMERCIOLAGES" → "PETROLAGES COMERCIO"
        descricao = descricao.replace(/[a-z0-9][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,}$/, (m) => m[0]).trim();

        if (!descricao) continue;
        if (ignorar.test(descricao)) continue;
        if (/^mdte/i.test(descricao)) continue;

        // Infer year: if transaction month > statement month → previous year
        const txMonth = parseInt(mes, 10);
        const txYear = txMonth > stmtMonth ? stmtYear - 1 : stmtYear;

        const data = `${String(dia).padStart(2, '0')}/${mes}/${txYear}`;

        transacoes.push({
            data,
            descricao: descricao.toUpperCase().trim(),
            valor,
            parcela: null,
        });
    }

    return transacoes;
}

/**
 * Parser para faturas do Santander.
 * Formato real observado — data e valor em linhas SEPARADAS:
 *   "17-11-2025POSTO PETROLAGESLAGES\\ "
 *   " "
 *   "248,02"
 *   " "
 * Também: "18-11-2025COMERCIAL CNPARC 01/03 LAGES\\ "
 */
function parseSantander(texto) {
    const transacoes = [];
    const linhas = texto.split('\n');

    // Regex para linha de transação Santander: "DD-MM-YYYYDESCRICAOCIDADE\\"
    const regexData = /^(\d{2}-\d{2}-\d{4})(.+?)(?:\\\\|\\)?\s*$/;
    // Regex para valor isolado numa linha
    const regexValor = /^-?([\d.,]+)\s*$/;
    // Regex para parcela: "PARC(ELA)? 01/03" ou "01/03" no meio da descrição
    const regexParcela = /PARC(?:ELA)?\s+(\d+)[\/DE ]+(\d+)|\s(\d{2})\/(\d{2,3})(?:\s|$)/i;

    let i = 0;
    let emSecaoTransacoes = false;

    while (i < linhas.length) {
        const linha = linhas[i];
        const trimmed = linha.trim();

        // Detecta início da seção de transações
        if (/Transa[çc][oõ]es Nacionais|Demonstrativo de Transa[çc][oõ]es|Transações Internacionais/i.test(trimmed)) {
            emSecaoTransacoes = true;
            i++;
            continue;
        }
        // Sai em totais ou nova seção
        if (/^Total\s+em|^LimitesParcelas|^Custo Efetivo/i.test(trimmed)) {
            emSecaoTransacoes = false;
            i++;
            continue;
        }

        if (!emSecaoTransacoes) { i++; continue; }

        const matchData = trimmed.match(regexData);
        if (matchData) {
            const [, dataRaw, restoBruto] = matchData;

            // Converte DD-MM-YYYY → DD/MM/YYYY
            const data = dataRaw.replace(/-/g, '/');

            // Procura o valor nas próximas linhas (normalmente 2 linhas à frente)
            let valor = NaN;
            let linhasAfrente = 0;
            for (let j = i + 1; j < Math.min(i + 5, linhas.length); j++) {
                const prox = linhas[j].trim();
                const mValor = prox.match(regexValor);
                if (mValor) {
                    const v = parseValorBR(mValor[1]);
                    if (!isNaN(v) && v > 0) {
                        valor = v;
                        linhasAfrente = j - i;
                        break;
                    }
                }
            }

            if (isNaN(valor) || valor <= 0) { i++; continue; }

            // Processa descrição — mantém como está (cidades coladas não afetam conciliação)
            let descricao = restoBruto.trim();

            // Remove o backslash residual caso tenha ficado
            descricao = descricao.replace(/\\+\s*$/, '').trim();

            // Extrai parcela se inline ("PARC 01/03")
            let parcela = null;
            const mParc = descricao.match(/(.+?)\s+PARC(?:ELA)?\s+(\d+)[\/](\d+)\s*(.*)/i);
            if (mParc) {
                descricao = (mParc[1] + (mParc[4] ? ' ' + mParc[4] : '')).trim();
                parcela = `${parseInt(mParc[2])}/${parseInt(mParc[3])}`;
            }

            // Ignora pagamentos, créditos
            if (/^(Pagamento|Crédito|DEB\s+AUTOM|Fatura anterior)/i.test(descricao.trim())) {
                i++; continue;
            }
            if (valor < 0) { i++; continue; }

            transacoes.push({
                data,
                descricao: descricao.toUpperCase().trim(),
                valor,
                parcela,
            });

            i += linhasAfrente + 1;
            continue;
        }

        i++;
    }

    return transacoes;
}

/**
 * Parser genérico — tenta extrair transações de qualquer PDF.
 * Busca padrões: DD/MM ou DD/MM/YYYY + texto + valor numérico
 */
function parseGenerico(texto) {
    const transacoes = [];
    const linhas = texto.split('\n');

    // Tenta vários formatos de linha
    const regexes = [
        // DD/MM/YYYY DESCRICAO VALOR
        /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d]+[.,][\d]{2})\s*$/,
        // DD/MM DESCRICAO VALOR
        /(\d{2}\/\d{2})\s+(.+?)\s+([\d]+[.,][\d]{2})\s*$/,
        // DESCRICAO DD/MM VALOR
        /(.+?)\s+(\d{2}\/\d{2}(?:\/\d{4})?)\s+([\d]+[.,][\d]{2})\s*$/,
    ];

    for (const linha of linhas) {
        const trimmed = linha.trim();
        if (!trimmed || trimmed.length < 10) continue;

        for (const regex of regexes) {
            const match = trimmed.match(regex);
            if (!match) continue;

            let data, descricao, valorRaw;

            // Check which regex matched (date-first vs desc-first)
            if (match[1].match(/^\d{2}\//)) {
                [, data, descricao, valorRaw] = match;
            } else {
                descricao = match[1];
                data = match[2];
                valorRaw = match[3];
            }

            if (descricao.match(/^(Total|Saldo|Limite|Data|Moviment|Pagamento|FATURA)/i)) continue;

            const valor = parseValorBR(valorRaw);
            if (isNaN(valor) || valor <= 0) continue;

            // Normaliza data
            if (data.split('/').length === 2) {
                data = `${data}/${new Date().getFullYear()}`;
            }

            // Extrai parcela
            let parcela = null;
            const matchParcela = descricao.match(/(.+?)\s*[-–]\s*[Pp]arcela\s+(\d+)[\/de]+\s*(\d+)/);
            if (matchParcela) {
                descricao = matchParcela[1].trim();
                parcela = `${matchParcela[2]}/${matchParcela[3]}`;
            }

            transacoes.push({
                data,
                descricao: descricao.toUpperCase().trim(),
                valor,
                parcela,
            });

            break; // Only match first regex
        }
    }

    return transacoes;
}

/**
 * Converte valor monetário brasileiro para float.
 * "1.234,56" → 1234.56
 * "89,99" → 89.99
 */
function parseValorBR(str) {
    if (!str) return NaN;
    let limpo = str.replace(/[R$\s]/g, '');

    const temVirgula = limpo.includes(',');
    const temPonto = limpo.includes('.');

    if (temVirgula && temPonto) {
        const posVirgula = limpo.lastIndexOf(',');
        const posPonto = limpo.lastIndexOf('.');
        if (posVirgula > posPonto) {
            limpo = limpo.replace(/\./g, '').replace(',', '.');
        } else {
            limpo = limpo.replace(/,/g, '');
        }
    } else if (temVirgula) {
        limpo = limpo.replace(',', '.');
    }

    return parseFloat(limpo);
}

module.exports = {
    parsePdfFatura,
    detectarBanco,
    parseValorBR,
};
