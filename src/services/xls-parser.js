/**
 * XLS/XLSX Parser — Exportações ERP
 *
 * Lê e normaliza os arquivos XLS/XLSX exportados do Tiny ERP,
 * convertendo em objetos JSON padronizados para importação no SQLite.
 *
 * Tipos suportados:
 *   - Contas a Pagar
 *   - Contas a Receber
 *   - Fornecedores (.xlsx)
 *   - Plano de Contas
 *   - Extratos Bancários (por banco)
 *   - Investimentos
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// ─── Helpers ─────────────────────────────────────────────

/**
 * Lê um arquivo XLS/XLSX e retorna array de objetos (header → value).
 */
function readSheet(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
    }
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

/**
 * Normaliza valor monetário: "1.234,56" → 1234.56
 */
function parseValor(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    return parseFloat(
        String(val)
            .replace(/\./g, '')
            .replace(',', '.')
    ) || 0;
}

/**
 * Normaliza data DD/MM/YYYY → YYYY-MM-DD (ISO).
 */
function parseDate(val) {
    if (!val) return '';
    const str = String(val).trim();
    // Já ISO?
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    // DD/MM/YYYY
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return str;
}

/**
 * Limpa strings: remove espaços extras e trim.
 */
function clean(val) {
    if (!val) return '';
    return String(val).replace(/\s+/g, ' ').trim();
}

// ─── Parsers por tipo ────────────────────────────────────

/**
 * Parse Contas a Pagar
 * Headers: ID, Fornecedor, Data Emissão, Data Vencimento, Data Liquidação,
 *          Valor documento, Saldo, Situação, Número documento, Categoria,
 *          Histórico, Pago, Competência, Forma Pagamento, Chave PIX/Código boleto
 */
function parseContasPagar(filePath) {
    const rows = readSheet(filePath);
    logger.info(`📄 Contas a Pagar: ${rows.length} registros em ${path.basename(filePath)}`);

    return rows.map(r => ({
        olist_id: clean(r['ID']),
        fornecedor: clean(r['Fornecedor']),
        data_emissao: parseDate(r['Data Emissão']),
        data_vencimento: parseDate(r['Data Vencimento']),
        data_liquidacao: parseDate(r['Data Liquidação']),
        valor: parseValor(r['Valor documento']),
        saldo: parseValor(r['Saldo']),
        situacao: clean(r['Situação']),
        nro_documento: clean(r['Número documento']),
        categoria: clean(r['Categoria']),
        historico: clean(r['Histórico']),
        valor_pago: parseValor(r['Pago']),
        competencia: clean(r['Competência']),
        forma_pagamento: clean(r['Forma Pagamento']),
    }));
}

/**
 * Parse Contas a Receber
 * Headers: ID, Cliente, Data Emissão, Data Vencimento, Data Liquidação,
 *          Valor documento, Saldo, Situação, Número documento, Número no banco,
 *          Categoria, Histórico, Forma de recebimento, Meio de recebimento,
 *          Taxas, Competência, Recebimento, Recebido
 */
function parseContasReceber(filePath) {
    const rows = readSheet(filePath);
    logger.info(`📄 Contas a Receber: ${rows.length} registros em ${path.basename(filePath)}`);

    return rows.map(r => ({
        olist_id: clean(r['ID']),
        cliente: clean(r['Cliente']),
        data_emissao: parseDate(r['Data Emissão']),
        data_vencimento: parseDate(r['Data Vencimento']),
        data_liquidacao: parseDate(r['Data Liquidação']),
        valor: parseValor(r['Valor documento']),
        saldo: parseValor(r['Saldo']),
        situacao: clean(r['Situação']),
        nro_documento: clean(r['Número documento']),
        nro_banco: clean(r['Número no banco']),
        categoria: clean(r['Categoria']),
        historico: clean(r['Histórico']),
        forma_recebimento: clean(r['Forma de recebimento']),
        meio_recebimento: clean(r['Meio de recebimento']),
        taxas: parseValor(r['Taxas']),
        competencia: clean(r['Competência']),
        data_recebimento: parseDate(r['Recebimento']),
        valor_recebido: parseValor(r['Recebido']),
    }));
}

/**
 * Parse Fornecedores (.xlsx)
 * Headers: ID, Código, Nome, Fantasia, Endereço, Número, Complemento,
 *          Bairro, CEP, Cidade, Estado, ..., Tipo pessoa, CNPJ / CPF, ...
 */
function parseFornecedores(filePath) {
    const rows = readSheet(filePath);
    logger.info(`📄 Fornecedores: ${rows.length} registros em ${path.basename(filePath)}`);

    return rows.map(r => ({
        olist_id: clean(r['ID']),
        codigo: clean(r['Código']),
        nome: clean(r['Nome']),
        fantasia: clean(r['Fantasia']),
        endereco: clean(r['Endereço']),
        numero: clean(r['Número']),
        complemento: clean(r['Complemento']),
        bairro: clean(r['Bairro']),
        cep: clean(r['CEP']),
        cidade: clean(r['Cidade']),
        estado: clean(r['Estado']),
        telefone: clean(r['Fone']),
        celular: clean(r['Celular']),
        email: clean(r['E-mail']),
        tipo_pessoa: clean(r['Tipo pessoa']),
        cpf_cnpj: clean(r['CNPJ / CPF']),
        ie_rg: clean(r['IE / RG']),
        situacao: clean(r['Situação']),
        tipo_contato: clean(r['Tipos de Contatos']),
    }));
}

/**
 * Parse Plano de Contas
 * Headers: ID, Descrição, Grupo, Considera no DRE, Competência Padrão
 */
function parsePlanoContas(filePath) {
    const rows = readSheet(filePath);
    logger.info(`📄 Plano de Contas: ${rows.length} registros em ${path.basename(filePath)}`);

    return rows.map(r => ({
        olist_id: clean(r['ID']),
        descricao: clean(r['Descrição']),
        grupo: clean(r['Grupo']),
        considera_dre: clean(r['Considera no DRE']),
        competencia_padrao: clean(r['Competência Padrão']),
    }));
}

/**
 * Parse Extratos Bancários (Caixa e Bancos)
 * Headers: Data, Categoria, Histórico, Tipo, Valor, Id, Contato, CNPJ,
 *          Marcadores, Conta, Nº do documento
 */
function parseExtratoBanco(filePath, bancoNome) {
    const rows = readSheet(filePath);
    logger.info(`📄 Extrato ${bancoNome}: ${rows.length} registros em ${path.basename(filePath)}`);

    return rows.map(r => ({
        olist_id: clean(r['Id']),
        data: parseDate(r['Data']),
        categoria: clean(r['Categoria']),
        historico: clean(r['Histórico']),
        tipo: clean(r['Tipo']), // C = crédito, D = débito
        valor: parseValor(r['Valor']),
        contato: clean(r['Contato']),
        cnpj: clean(r['CNPJ']),
        marcadores: clean(r['Marcadores']),
        conta: clean(r['Conta']),
        nro_documento: clean(r['Nº do documento']),
        banco: bancoNome,
    }));
}

/**
 * Parse Investimentos (mesma estrutura de Extratos)
 */
function parseInvestimentos(filePath, contaNome) {
    return parseExtratoBanco(filePath, contaNome);
}

// ─── Bulk parsers (todos os arquivos de uma pasta) ───────

/**
 * Importa TODOS os XLS de uma pasta, concatenando resultados.
 */
function parseAllInFolder(folderPath, parserFn, ...extra) {
    if (!fs.existsSync(folderPath)) {
        logger.warn(`⚠️ Pasta não encontrada: ${folderPath}`);
        return [];
    }

    const files = fs.readdirSync(folderPath)
        .filter(f => /\.(xls|xlsx)$/i.test(f))
        .sort();

    let all = [];
    for (const file of files) {
        const fullPath = path.join(folderPath, file);
        const result = parserFn(fullPath, ...extra);
        all = all.concat(result);
    }

    // Deduplicação por olist_id (se houver)
    if (all.length > 0 && all[0].olist_id) {
        const seen = new Set();
        all = all.filter(item => {
            if (!item.olist_id || seen.has(item.olist_id)) return false;
            seen.add(item.olist_id);
            return true;
        });
    }

    logger.info(`✅ Total após dedup: ${all.length} registros de ${folderPath}`);
    return all;
}

/**
 * Importa todos os dados de todas as pastas de exportação ERP.
 * Retorna um objeto com todas as entidades.
 */
function parseAllExports(basePath) {
    const base = basePath || path.join(__dirname, '../../dados-financeiros/exportacoes-erp');

    logger.info('🔄 Iniciando parse de todas as exportações ERP...');

    const result = {
        contasPagar: parseAllInFolder(
            path.join(base, 'Contas a Pagar'),
            parseContasPagar
        ),
        contasReceber: parseAllInFolder(
            path.join(base, 'Contas a Receber'),
            parseContasReceber
        ),
        fornecedores: parseAllInFolder(
            path.join(base, 'Fornecedores'),
            parseFornecedores
        ),
        planoContas: parseAllInFolder(
            path.join(base, 'Plano de Contas'),
            parsePlanoContas
        ),
        extratosBanco: {},
        investimentos: {},
    };

    // Extratos por banco
    const bancosPath = path.join(base, 'Bancos Olist (Extrato Completo)');
    if (fs.existsSync(bancosPath)) {
        const bancos = fs.readdirSync(bancosPath).filter(f =>
            fs.statSync(path.join(bancosPath, f)).isDirectory() && !f.startsWith('.')
        );
        for (const banco of bancos) {
            result.extratosBanco[banco] = parseAllInFolder(
                path.join(bancosPath, banco),
                parseExtratoBanco,
                banco
            );
        }
    }

    // Investimentos por conta
    const investPath = path.join(base, 'Contas Investimentos (Extratos Completos)');
    if (fs.existsSync(investPath)) {
        const contas = fs.readdirSync(investPath).filter(f =>
            fs.statSync(path.join(investPath, f)).isDirectory() && !f.startsWith('.')
        );
        for (const conta of contas) {
            result.investimentos[conta] = parseAllInFolder(
                path.join(investPath, conta),
                parseInvestimentos,
                conta
            );
        }
    }

    // Resumo
    const totalExtratos = Object.values(result.extratosBanco).reduce((s, a) => s + a.length, 0);
    const totalInvest = Object.values(result.investimentos).reduce((s, a) => s + a.length, 0);

    logger.info(`📊 Resumo do parse:`);
    logger.info(`   Contas a Pagar:  ${result.contasPagar.length}`);
    logger.info(`   Contas a Receber: ${result.contasReceber.length}`);
    logger.info(`   Fornecedores:    ${result.fornecedores.length}`);
    logger.info(`   Plano de Contas: ${result.planoContas.length}`);
    logger.info(`   Extratos Banco:  ${totalExtratos} (${Object.keys(result.extratosBanco).length} bancos)`);
    logger.info(`   Investimentos:   ${totalInvest} (${Object.keys(result.investimentos).length} contas)`);

    return result;
}

module.exports = {
    // Parsers individuais
    parseContasPagar,
    parseContasReceber,
    parseFornecedores,
    parsePlanoContas,
    parseExtratoBanco,
    parseInvestimentos,
    // Bulk
    parseAllInFolder,
    parseAllExports,
    // Helpers (expostos para testes)
    parseValor,
    parseDate,
    clean,
};
