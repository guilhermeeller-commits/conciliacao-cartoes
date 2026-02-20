/* ═══════════════════════════════════════════════════════
   Sidebar — Shared component across all pages
   Injects sidebar HTML, sets active nav item, handles mobile
   ═══════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const NAV_ITEMS = [
        { href: '/', label: 'Dashboard', icon: '📊', matchPaths: ['/', '/dashboard.html'] },
        { href: '/extratos-cartao.html', label: 'Extratos de Cartão', icon: '💳', matchPaths: ['/extratos-cartao.html', '/extrato-detalhe.html'] },
        { href: '/conciliacoes.html', label: 'Conciliações', icon: '🔄', matchPaths: ['/conciliacoes.html', '/conciliacao.html'] },
    ];

    function getCurrentPath() {
        return window.location.pathname;
    }

    function isActive(item) {
        const path = getCurrentPath();
        return item.matchPaths.some(p => p === path);
    }

    const REPO_ITEM = { href: '/repositorio.html', label: 'Repositório', icon: '🧠', matchPaths: ['/repositorio.html'] };
    const CAT_ITEM = { href: '/categorizacao.html', label: 'Categorização', icon: '🏷️', matchPaths: ['/categorizacao.html'] };

    function buildSidebarHTML() {
        const navItemsHTML = NAV_ITEMS.map(item => {
            const activeClass = isActive(item) ? ' active' : '';
            return `<a class="nav-item${activeClass}" href="${item.href}">
                        <span class="icon">${item.icon}</span> ${item.label}
                    </a>`;
        }).join('\n                    ');

        const repoActive = isActive(REPO_ITEM) ? ' active' : '';
        const repoItemHTML = `<a class="nav-item${repoActive}" href="${REPO_ITEM.href}">
                        <span class="icon">${REPO_ITEM.icon}</span> ${REPO_ITEM.label}
                    </a>`;

        const catActive = isActive(CAT_ITEM) ? ' active' : '';
        const catItemHTML = `<a class="nav-item${catActive}" href="${CAT_ITEM.href}">
                        <span class="icon">${CAT_ITEM.icon}</span> ${CAT_ITEM.label}
                    </a>`;

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
                <div class="nav-group">
                    <div class="nav-group-label">Cartões</div>
                    ${navItemsHTML}
                </div>
                <div class="nav-group">
                    <div class="nav-group-label">Inteligência</div>
                    ${repoItemHTML}
                    ${catItemHTML}
                </div>
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
