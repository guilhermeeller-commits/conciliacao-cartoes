/* ═══════════════════════════════════════════════════════
   Sidebar — Shared component across all pages
   Injects sidebar HTML, sets active nav item, handles mobile
   ═══════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── Navigation structure ── */
    const NAV_GROUPS = [
        {
            label: 'Visão Geral',
            items: [
                { href: '/', label: 'Dashboard', icon: '📊', matchPaths: ['/', '/dashboard.html'] },
            ]
        },
        {
            label: 'Cartões',
            items: [
                { href: '/faturas.html', label: 'Faturas de Cartão', icon: '💳', matchPaths: ['/faturas.html', '/extratos-cartao.html', '/extrato-detalhe.html', '/conciliacoes.html'] },
            ]
        },
        {
            label: 'Bancário / ERP',
            items: [
                { href: '/repositorio.html', label: 'Repositório Olist', icon: '🔄', matchPaths: ['/repositorio.html'] },
            ]
        },
        {
            label: 'Sistema',
            items: [
                { href: '/configuracoes.html', label: 'Configurações', icon: '⚙️', matchPaths: ['/configuracoes.html'] },
            ]
        },
    ];

    function getCurrentPath() {
        return window.location.pathname;
    }

    function isActive(item) {
        const path = getCurrentPath();
        return item.matchPaths.some(p => p === path);
    }

    function buildNavItemHTML(item) {
        const activeClass = isActive(item) ? ' active' : '';
        const disabledClass = item.disabled ? ' disabled' : '';
        const href = item.disabled ? '#' : item.href;
        const title = item.disabled ? ' title="Em breve"' : '';
        return `<a class="nav-item${activeClass}${disabledClass}" href="${href}"${title}>
                        <span class="icon">${item.icon}</span> ${item.label}
                    </a>`;
    }

    function buildSidebarHTML() {
        const groupsHTML = NAV_GROUPS.map(group => {
            const itemsHTML = group.items.map(buildNavItemHTML).join('\n                    ');
            return `<div class="nav-group">
                    <div class="nav-group-label">${group.label}</div>
                    ${itemsHTML}
                </div>`;
        }).join('\n                ');

        return `
        <aside class="erp-sidebar" id="sidebar">
            <div class="sidebar-brand">
                <div class="logo">C</div>
                <div>
                    <div class="brand-text">Calisul</div>
                    <div class="brand-sub">Central Financeira</div>
                </div>
            </div>
            <nav class="sidebar-nav">
                ${groupsHTML}
            </nav>
            <div class="sidebar-footer">
                <div class="theme-toggle">
                    <div class="theme-toggle-track"></div>
                    <span class="theme-toggle-label">Modo escuro</span>
                </div>
            </div>
        </aside>
        <div class="sidebar-overlay" id="sidebarOverlay"></div>`;
    }

    function injectSidebar() {
        const layout = document.querySelector('.erp-layout');
        if (!layout) return;

        // Insert sidebar at the beginning of .erp-layout
        layout.insertAdjacentHTML('afterbegin', buildSidebarHTML());

        // Setup mobile toggle
        setupMobile();
    }

    function setupMobile() {
        const toggle = document.getElementById('mobileToggle');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (toggle) {
            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                overlay.classList.toggle('open');
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('open');
                overlay.classList.remove('open');
            });
        }
    }

    // Inject when DOM is ready, or immediately if already ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectSidebar);
    } else {
        injectSidebar();
    }
})();
