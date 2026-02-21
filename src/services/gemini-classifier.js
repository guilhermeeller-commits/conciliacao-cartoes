/**
 * gemini-classifier.js
 * 
 * Classifica transações de cartão de crédito usando Gemini Flash.
 * Envia transações em batch com a lista de categorias válidas.
 * Retorna categoria + confiança para cada item.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// ─── Carrega categorias válidas ───────────────
const configPath = path.join(__dirname, '../../config/card-rules.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const CATEGORIAS = config.categorias || [];

// ─── Inicializa Gemini ────────────────────────
let genAI = null;
let model = null;

function getModel() {
    if (!model) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY não configurada no .env');
        }
        genAI = new GoogleGenerativeAI(apiKey);
        model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }
    return model;
}

/**
 * Classifica transações pendentes usando Gemini Flash.
 * 
 * @param {Array<{ descricao: string, valor: number }>} itens - Transações a classificar
 * @returns {Promise<Array<{ descricao: string, categoria: string, confianca: number }>>}
 */
async function classificarComIA(itens) {
    if (!itens || itens.length === 0) return [];

    const gemini = getModel();

    const listaItens = itens
        .map((item, i) => `${i + 1}. "${item.descricao}" — R$ ${item.valor.toFixed(2)}`)
        .join('\n');

    const listaCategorias = CATEGORIAS.map(c => `- ${c}`).join('\n');

    const prompt = `Você é um classificador financeiro especializado em despesas empresariais de uma transportadora brasileira chamada Calisul.

Classifique cada transação de cartão de crédito na categoria mais adequada.

## Categorias válidas:
${listaCategorias}

## Transações para classificar:
${listaItens}

## Instruções:
- Responda APENAS em JSON válido, sem markdown, sem backticks
- Use EXATAMENTE o nome da categoria como aparece na lista acima
- Para cada item, retorne a confiança de 0 a 100
- Se não souber com certeza, use a categoria "000020. Dúvida na categorizaçao/origem"
- Considere que:
  - Postos de combustível, petrolages = Combustível
  - Supermercados, atacadões = Mercado em Geral
  - Restaurantes, lanchonetes, padarias, cafeterias = Alimentação
  - Hotéis, pousadas, passagens, Decolar = Passagem/Hospedagem
  - Lojas online genéricas (Havan, Shopee, Magazine) = "000020. Dúvida na categorizaçao/origem"

## Formato de resposta (JSON):
[
  { "index": 1, "categoria": "3.3.1. Combustível", "confianca": 95 },
  { "index": 2, "categoria": "3.9.2. Alimentação", "confianca": 85 }
]`;

    try {
        logger.info(`🤖 Enviando ${itens.length} transações ao Gemini Flash...`);

        const result = await gemini.generateContent(prompt);
        const response = result.response;
        const text = response.text().trim();

        // Parse JSON response (remove possible markdown wrapping)
        const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const classifications = JSON.parse(jsonStr);

        if (!Array.isArray(classifications)) {
            throw new Error('Resposta do Gemini não é um array');
        }

        // Map results back to items
        const resultados = itens.map((item, i) => {
            const match = classifications.find(c => c.index === i + 1);
            if (match && CATEGORIAS.includes(match.categoria)) {
                return {
                    descricao: item.descricao,
                    categoria: match.categoria,
                    confianca: match.confianca || 0,
                };
            }
            return {
                descricao: item.descricao,
                categoria: null,
                confianca: 0,
            };
        });

        const classified = resultados.filter(r => r.categoria !== null);
        logger.info(`🤖 Gemini classificou ${classified.length}/${itens.length} transações`);

        return resultados;
    } catch (error) {
        logger.error(`❌ Erro Gemini: ${error.message}`);
        // Return empty results on error — don't block the flow
        return itens.map(item => ({
            descricao: item.descricao,
            categoria: null,
            confianca: 0,
        }));
    }
}

/**
 * Verifica se a API do Gemini está configurada e funcional.
 */
async function testarConexao() {
    try {
        const gemini = getModel();
        const result = await gemini.generateContent('Responda apenas "ok"');
        return { ok: true, response: result.response.text().trim() };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

module.exports = {
    classificarComIA,
    testarConexao,
};
