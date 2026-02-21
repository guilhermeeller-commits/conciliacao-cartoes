#!/usr/bin/env node
/**
 * seed-learned-mappings.js — Mineração de dados ERP para auto-classificação
 * 
 * Analisa olist_contas_pagar para extrair padrões fornecedor→categoria
 * e popula a tabela learned_mappings automaticamente.
 * 
 * Critério: fornecedor com ≥3 lançamentos e ≥80% na mesma categoria.
 * 
 * Uso: node scripts/seed-learned-mappings.js
 */

require('dotenv').config();
const { query, pool } = require('../src/database/connection');

// ═══════════════════════════════════════════
// Normalização (igual ao expense-classifier.js)
// ═══════════════════════════════════════════

function normalizarDescricao(desc) {
    return desc
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extrai palavras-chave relevantes de um nome de fornecedor.
 * Remove sufixos jurídicos (LTDA, EIRELI, S.A, etc.) e conectivos.
 */
function extrairPalavrasChave(nome) {
    const stopWords = new Set([
        'LTDA', 'EIRELI', 'ME', 'EPP', 'SA', 'S.A', 'S/A',
        'COMERCIO', 'INDUSTRIA', 'SERVICOS', 'TRANSPORTES',
        'E', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'EM', 'COM',
        'PARA', 'POR', 'NO', 'NA', 'NOS', 'NAS',
    ]);

    const normalizado = normalizarDescricao(nome);
    const palavras = normalizado.split(/[\s,.\-\/]+/).filter(p =>
        p.length >= 3 && !stopWords.has(p)
    );

    return palavras;
}

// ═══════════════════════════════════════════
// Mineração de padrões
// ═══════════════════════════════════════════

async function minerarPadroes() {
    console.log('\n🔍 Minerando padrões de fornecedor → categoria...\n');

    // Agrupar por fornecedor e categoria
    const { rows } = await query(`
        SELECT 
            fornecedor,
            categoria,
            COUNT(*) as qtd
        FROM olist_contas_pagar
        WHERE fornecedor != '' 
          AND categoria IS NOT NULL 
          AND categoria != ''
          AND categoria NOT LIKE '000%'
          AND categoria != '8.6.1. Transferência entre Contas'
        GROUP BY fornecedor, categoria
        ORDER BY fornecedor, qtd DESC
    `);

    // Agrupar por fornecedor → { categoria_principal, total, confiança }
    const fornecedores = {};
    for (const r of rows) {
        if (!fornecedores[r.fornecedor]) {
            fornecedores[r.fornecedor] = { cats: [], total: 0 };
        }
        fornecedores[r.fornecedor].cats.push({
            categoria: r.categoria,
            qtd: parseInt(r.qtd),
        });
        fornecedores[r.fornecedor].total += parseInt(r.qtd);
    }

    // Filtrar fornecedores com critérios de confiança
    const mapeamentos = [];

    for (const [nome, data] of Object.entries(fornecedores)) {
        if (data.total < 3) continue; // Mínimo 3 lançamentos

        // Categoria dominante
        const sorted = data.cats.sort((a, b) => b.qtd - a.qtd);
        const principal = sorted[0];
        const confianca = principal.qtd / data.total;

        if (confianca < 0.80) continue; // Mínimo 80% na mesma categoria

        // Gerar variantes de mapeamento
        const normalizado = normalizarDescricao(nome);
        const palavras = extrairPalavrasChave(nome);

        // Mapping 1: Nome completo normalizado
        mapeamentos.push({
            descricao: normalizado,
            categoria: principal.categoria,
            fonte: nome,
            confianca: (confianca * 100).toFixed(0),
            qtd: data.total,
        });

        // Mapping 2: Primeira(s) palavra(s) significativa(s) — "nome comercial"
        // Apenas se tem ≥2 palavras e a primeira palavra é suficientemente única (≥4 chars)
        if (palavras.length >= 1 && palavras[0].length >= 4) {
            // Nome curto: até 2 primeiras palavras significativas
            const nomeCurto = palavras.slice(0, 2).join(' ');
            if (nomeCurto !== normalizado && nomeCurto.length >= 4) {
                mapeamentos.push({
                    descricao: nomeCurto,
                    categoria: principal.categoria,
                    fonte: `${nome} (curto)`,
                    confianca: (confianca * 100).toFixed(0),
                    qtd: data.total,
                });
            }
        }
    }

    return mapeamentos;
}

// ═══════════════════════════════════════════
// Inserção
// ═══════════════════════════════════════════

async function inserirMapeamentos(mapeamentos) {
    let inseridos = 0;
    let atualizados = 0;
    let skipped = 0;

    for (const m of mapeamentos) {
        try {
            const result = await query(`
                INSERT INTO learned_mappings (descricao, categoria)
                VALUES ($1, $2)
                ON CONFLICT (descricao) DO UPDATE SET
                    categoria = EXCLUDED.categoria
                RETURNING (xmax = 0) AS inserted
            `, [m.descricao, m.categoria]);

            if (result.rows[0].inserted) {
                inseridos++;
            } else {
                atualizados++;
            }
        } catch (err) {
            skipped++;
        }
    }

    return { inseridos, atualizados, skipped };
}

// ═══════════════════════════════════════════
// Main
// ═══════════════════════════════════════════

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('🧠 SEED — Auto-população de Learned Mappings');
    console.log('═══════════════════════════════════════════');

    try {
        // Contagem antes
        const antes = await query('SELECT COUNT(*) as c FROM learned_mappings');
        console.log(`\n📊 Mapeamentos existentes: ${antes.rows[0].c}`);

        // Minerar padrões
        const mapeamentos = await minerarPadroes();

        // Exibir preview
        console.log(`\n📋 ${mapeamentos.length} mapeamentos identificados:\n`);

        // Agrupar por categoria para exibição
        const porCategoria = {};
        for (const m of mapeamentos) {
            if (!porCategoria[m.categoria]) porCategoria[m.categoria] = [];
            porCategoria[m.categoria].push(m);
        }

        for (const [cat, maps] of Object.entries(porCategoria).sort()) {
            console.log(`  📂 ${cat}`);
            for (const m of maps) {
                console.log(`     ${m.confianca.padStart(3)}% │ ${m.qtd.toString().padStart(3)}x │ "${m.descricao}"`);
            }
        }

        // Inserir
        console.log('\n💾 Inserindo mapeamentos...');
        const { inseridos, atualizados, skipped } = await inserirMapeamentos(mapeamentos);

        // Contagem depois
        const depois = await query('SELECT COUNT(*) as c FROM learned_mappings');

        console.log('\n═══════════════════════════════════════════');
        console.log('📊 RESULTADO');
        console.log(`   Novos:       ${inseridos}`);
        console.log(`   Atualizados: ${atualizados}`);
        console.log(`   Erros:       ${skipped}`);
        console.log(`   Total agora: ${depois.rows[0].c} mapeamentos`);
        console.log('═══════════════════════════════════════════');

    } catch (err) {
        console.error(`\n❌ ERRO: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }

    await pool.end();
    process.exit(0);
}

main();
