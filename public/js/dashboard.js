// ═══════════════════════════════════════════════════════
// Dashboard Pro — JavaScript
// ═══════════════════════════════════════════════════════

const CHART_COLORS = [
    '#005efc', '#10B981', '#F59E0B', '#EF4444',
    '#8B5CF6', '#06B6D4', '#F97316', '#EC4899',
];

let chartInstances = {};

document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.classList.add('spinning');
            loadDashboard().finally(() => {
                setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
            });
        });
    }

    // Period selector
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Period filtering can be extended later
        });
    });
});

async function loadDashboard() {
    try {
        const res = await fetch('/api/dashboard/stats');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        renderKPIs(data.kpis);
        renderERPKPIs(data.erp, data.kpis);
        renderAlerts(data.alerts);
        renderChartTrend(data.charts.trend);
        renderChartDonut(data.charts.byCard);
        renderChartMonthly(data.charts.monthly);
        renderTopCategories(data.charts.topCategories);
        renderRecent(data.recent);
        renderCardProgress(data.cardProgress);
        renderSyncInfo(data.kpis.last_olist_sync);
        renderTopFornecedores(data.erp?.topFornecedores);
    } catch (e) {
        console.error('Erro ao carregar dashboard:', e);
    }
}

// ─── KPIs ─────────────────────────────────────
function renderKPIs(kpis) {
    animateValue('kpiFaturas', kpis.total_statements);
    document.getElementById('kpiFaturasSub').textContent =
        kpis.total_statements === 0 ? 'nenhuma fatura' : `de ${kpis.distinct_cards} cartões`;

    animateValue('kpiCategorizadas', kpis.total_categorized, true);
    const pctEl = document.getElementById('kpiCategorizadasPct');
    pctEl.textContent = `${kpis.pct_categorized}%`;
    pctEl.className = 'kpi-badge ' +
        (kpis.pct_categorized >= 80 ? 'good' : kpis.pct_categorized >= 50 ? 'warn' : 'bad');
    document.getElementById('kpiCategorizadasSub').textContent =
        `de ${kpis.total_transactions.toLocaleString('pt-BR')} transações`;

    animateValue('kpiPendentes', kpis.total_pending);
    document.getElementById('kpiPendentesSub').textContent =
        kpis.total_pending === 0 ? 'tudo categorizado! 🎉' : 'aguardando classificação';

    document.getElementById('kpiValor').textContent =
        `R$ ${kpis.total_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpiValorSub').textContent = 'soma de todas as faturas';

    // Trend indicator
    const trendEl = document.getElementById('kpiValorTrend');
    if (trendEl && kpis.trends) {
        const t = kpis.trends.amount;
        if (t > 0) {
            trendEl.className = 'kpi-trend up';
            trendEl.textContent = `▲ ${t}%`;
        } else if (t < 0) {
            trendEl.className = 'kpi-trend down';
            trendEl.textContent = `▼ ${Math.abs(t)}%`;
        } else {
            trendEl.className = 'kpi-trend neutral';
            trendEl.textContent = '— 0%';
        }
    }

    // Sparkline
    if (kpis.sparkline && kpis.sparkline.length > 1) {
        renderSparkline('sparkFaturas', kpis.sparkline);
    }
}

// ─── ERP KPIs ─────────────────────────────────
function renderERPKPIs(erp, kpis) {
    if (!erp || (!erp.contasPagar?.total && !erp.contasReceber?.total)) {
        document.getElementById('kpiErpRow').style.display = 'none';
        return;
    }
    document.getElementById('kpiErpRow').style.display = '';

    const cp = erp.contasPagar || {};
    document.getElementById('kpiCP').textContent =
        `R$ ${(cp.saldo_aberto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpiCPSub').textContent =
        `${cp.em_aberto || 0} em aberto${cp.vencidas ? ` · ${cp.vencidas} vencidas` : ''}`;

    const cr = erp.contasReceber || {};
    document.getElementById('kpiCR').textContent =
        `R$ ${(cr.saldo_aberto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpiCRSub').textContent = `${cr.em_aberto || 0} em aberto`;

    document.getElementById('kpiRec').textContent = `${kpis.pct_reconciled || 0}%`;
    document.getElementById('kpiRecSub').textContent =
        `${kpis.reconciled_count || 0} de ${kpis.total_transactions} transações`;
}

// ─── Sync Info ────────────────────────────────
function renderSyncInfo(lastSync) {
    const el = document.getElementById('syncInfo');
    if (!lastSync) {
        el.innerHTML = '<span>Olist: <span class="sync-time">nunca sincronizado</span></span>';
        return;
    }
    const date = new Date(lastSync);
    const formatted = date.toLocaleDateString('pt-BR') + ' ' +
        date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<span>Última sync Olist:<br><span class="sync-time">${formatted}</span></span>`;
}

// ─── Alerts ───────────────────────────────────
function renderAlerts(alerts) {
    const container = document.getElementById('alertsList');
    const badge = document.getElementById('alertCount');

    if (!alerts || alerts.length === 0) {
        badge.textContent = '0';
        container.innerHTML = `<div class="no-alerts"><div class="icon">✅</div><p>Nenhuma fatura pendente de categorização</p></div>`;
        return;
    }

    badge.textContent = alerts.length;
    container.innerHTML = alerts.map(a => {
        const pct = a.total_transactions > 0 ? Math.round((a.categorized_count / a.total_transactions) * 100) : 0;
        return `<a class="alert-item" href="/extrato-detalhe.html?id=${a.id}">
            <div class="alert-icon">⚠️</div>
            <div class="alert-info">
                <h4>${escapeHtml(a.filename)}</h4>
                <p>${a.pending_count} transações sem categoria · ${pct}% categorizado</p>
            </div>
            <div class="alert-action">Categorizar →</div>
        </a>`;
    }).join('');
}

// ─── Chart: Trend Line ────────────────────────
function renderChartTrend(trend) {
    const ctx = document.getElementById('chartTrend');
    if (!trend || !trend.labels || trend.labels.length === 0) {
        ctx.parentElement.innerHTML = '<div class="empty-state">Sem dados para o gráfico de tendência</div>';
        return;
    }
    if (chartInstances.trend) chartInstances.trend.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const textColor = isDark ? '#8b949e' : '#656d76';

    chartInstances.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trend.labels,
            datasets: [{
                label: 'Valor Total',
                data: trend.amounts,
                borderColor: '#005efc',
                backgroundColor: 'rgba(0, 94, 252, 0.08)',
                fill: true,
                tension: 0.4,
                borderWidth: 2.5,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBackgroundColor: '#005efc',
                pointBorderColor: isDark ? '#132035' : '#fff',
                pointBorderWidth: 2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1a2840' : '#fff',
                    titleColor: isDark ? '#F0F2F8' : '#101820',
                    bodyColor: isDark ? '#8891AB' : '#5A6478',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: (c) => `R$ ${c.raw.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    },
                },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
                y: {
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor, font: { size: 11 },
                        callback: (v) => `R$ ${(v / 1000).toFixed(0)}k`,
                    },
                },
            },
        },
    });
}

// ─── Chart: Donut ─────────────────────────────
function renderChartDonut(byCard) {
    const ctx = document.getElementById('chartDonut');
    if (!byCard || !byCard.labels || byCard.labels.length === 0) {
        ctx.parentElement.innerHTML = '<div class="empty-state">Sem dados para o gráfico</div>';
        return;
    }
    if (chartInstances.donut) chartInstances.donut.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#8b949e' : '#656d76';

    chartInstances.donut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: byCard.labels,
            datasets: [{ data: byCard.data, backgroundColor: CHART_COLORS.slice(0, byCard.labels.length), borderWidth: 0, hoverOffset: 8 }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor, font: { size: 11 }, boxWidth: 12, padding: 14 } },
                tooltip: {
                    callbacks: {
                        label: (c) => {
                            const total = c.dataset.data.reduce((s, v) => s + v, 0);
                            const pct = total > 0 ? Math.round((c.raw / total) * 100) : 0;
                            return `${c.label}: R$ ${c.raw.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${pct}%)`;
                        },
                    },
                },
            },
        },
    });
}

// ─── Chart: Monthly Bars ──────────────────────
function renderChartMonthly(monthly) {
    const ctx = document.getElementById('chartMonthly');
    if (!monthly || !monthly.labels || monthly.labels.length === 0) {
        ctx.parentElement.innerHTML = '<div class="empty-state">Sem dados de transações categorizadas</div>';
        return;
    }
    if (chartInstances.monthly) chartInstances.monthly.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const textColor = isDark ? '#8b949e' : '#656d76';

    chartInstances.monthly = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthly.labels,
            datasets: monthly.datasets.map((ds, i) => ({
                label: ds.label,
                data: ds.data,
                backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + 'cc',
                borderRadius: 4,
                borderSkipped: false,
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor, font: { size: 11 }, boxWidth: 12, padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: (c) => `${c.dataset.label}: R$ ${c.raw.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    },
                },
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
                y: {
                    stacked: true, grid: { color: gridColor },
                    ticks: { color: textColor, font: { size: 11 }, callback: (v) => `R$ ${(v / 1000).toFixed(0)}k` },
                },
            },
        },
    });
}

// ─── Top Categories ───────────────────────────
function renderTopCategories(cats) {
    const container = document.getElementById('topCategoriesList');
    if (!cats || cats.length === 0) {
        container.innerHTML = '<div class="empty-state">Sem categorias</div>';
        return;
    }
    const maxVal = cats[0].total;
    container.innerHTML = cats.map((c, i) => `
        <div class="top-item">
            <div class="top-rank">${i + 1}</div>
            <div class="top-info">
                <h4>${escapeHtml(c.category)}</h4>
                <p>${c.count} transações</p>
                <div class="top-bar-wrap"><div class="top-bar-fill" style="width: ${(c.total / maxVal * 100).toFixed(0)}%"></div></div>
            </div>
            <div class="top-value">R$ ${c.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
    `).join('');
}

// ─── Top Fornecedores ─────────────────────────
function renderTopFornecedores(fornecedores) {
    const section = document.getElementById('fornecedoresSection');
    const container = document.getElementById('topFornecedoresList');
    if (!fornecedores || fornecedores.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    const maxVal = fornecedores[0].total;
    container.innerHTML = fornecedores.map((f, i) => `
        <div class="top-item">
            <div class="top-rank">${i + 1}</div>
            <div class="top-info">
                <h4>${escapeHtml(f.nome)}</h4>
                <p>${f.count} contas</p>
                <div class="top-bar-wrap"><div class="top-bar-fill" style="width: ${(f.total / maxVal * 100).toFixed(0)}%"></div></div>
            </div>
            <div class="top-value">R$ ${f.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
    `).join('');
}

// ─── Recent ───────────────────────────────────
function renderRecent(recent) {
    const container = document.getElementById('recentList');
    if (!recent || recent.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>Nenhuma fatura importada ainda</p><a href="/faturas.html" class="btn btn-blue btn-sm">Importar primeira fatura</a></div>`;
        return;
    }
    container.innerHTML = recent.map(s => {
        const date = formatDate(s.statement_date);
        const pct = s.total_transactions > 0 ? Math.round((s.categorized_count / s.total_transactions) * 100) : 0;
        return `<a class="recent-item" href="/extrato-detalhe.html?id=${s.id}">
            <div class="recent-icon">💳</div>
            <div class="recent-info">
                <h4>${escapeHtml(s.filename)}</h4>
                <p>${escapeHtml(s.card_name || '—')} · ${escapeHtml(s.financial_account || '—')}</p>
            </div>
            <div class="recent-meta">
                <div class="date">${date}</div>
                <div class="progress-mini">
                    <div class="bar"><div class="fill" style="width: ${pct}%"></div></div>
                    <span class="label">${s.categorized_count}/${s.total_transactions}</span>
                </div>
            </div>
        </a>`;
    }).join('');
}

// ─── Card Progress ────────────────────────────
function renderCardProgress(progress) {
    const container = document.getElementById('cardProgress');
    if (!progress || progress.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum dado disponível</div>';
        return;
    }
    container.innerHTML = progress.map(c => {
        const pct = c.total_tx > 0 ? Math.round((c.categorized_tx / c.total_tx) * 100) : 0;
        const pctColor = pct === 100 ? 'var(--green)' : 'var(--text-primary)';
        return `<div class="card-progress-item">
            <div class="card-progress-icon">💳</div>
            <div class="card-progress-info">
                <h4>${escapeHtml(c.card_name)}</h4>
                <p>${c.statement_count} fatura${c.statement_count !== 1 ? 's' : ''} · R$ ${c.total_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div style="text-align: right;">
                <div class="card-progress-pct" style="color: ${pctColor}">${pct}%</div>
                <div class="card-progress-bar"><div class="fill" style="width: ${pct}%"></div></div>
            </div>
        </div>`;
    }).join('');
}

// ─── Sparkline (mini canvas) ──────────────────
function renderSparkline(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container || !data || data.length < 2) return;

    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 36;
    container.innerHTML = '';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const w = canvas.width;
    const h = canvas.height;
    const padding = 2;

    ctx.strokeStyle = '#005efc';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    data.forEach((v, i) => {
        const x = padding + (i / (data.length - 1)) * (w - padding * 2);
        const y = h - padding - ((v - min) / range) * (h - padding * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill
    const lastX = padding + ((data.length - 1) / (data.length - 1)) * (w - padding * 2);
    ctx.lineTo(lastX, h);
    ctx.lineTo(padding, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 94, 252, 0.08)';
    ctx.fill();
}

// ─── Helpers ──────────────────────────────────
function animateValue(id, value, useLocale) {
    const el = document.getElementById(id);
    if (!el) return;
    const target = typeof value === 'number' ? value : parseInt(value) || 0;
    const duration = 600;
    const start = performance.now();

    function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        const current = Math.round(eased * target);
        el.textContent = useLocale ? current.toLocaleString('pt-BR') : current;
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateStr;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
