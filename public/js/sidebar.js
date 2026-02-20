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
                <img src="/img/logo-calisul.svg" alt="Calisul" class="sidebar-logo">
                <div class="brand-sub">Central Financeira</div>
            </div>
            <nav class="sidebar-nav">
                ${groupsHTML}
            </nav>
            <div class="sidebar-footer" style="display: flex; flex-direction: column; gap: 16px;">
                <div id="sidebarUserProfile" style="display: none; align-items: center; gap: 12px; padding: 12px; background: var(--bg-hover); border-radius: var(--radius-md); border: 1px solid var(--border-muted);">
                    <img id="sidebarUserPhoto" src="" alt="User" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
                    <div style="flex: 1; min-width: 0;">
                        <div id="sidebarUserName" style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Carregando...</div>
                        <div id="sidebarUserEmail" style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></div>
                    </div>
                    <a href="/logout" title="Sair" style="color: var(--text-muted); display: flex; align-items: center; justify-content: center; padding: 4px; transition: color var(--transition-fast);">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                            <polyline points="16 17 21 12 16 7"></polyline>
                            <line x1="21" y1="12" x2="9" y2="12"></line>
                        </svg>
                    </a>
                </div>
                <div class="theme-toggle">
                    <div class="theme-toggle-track"></div>
                    <span class="theme-toggle-label">Modo escuro</span>
                </div>
            </div>
        </aside>
        <div class="sidebar-overlay" id="sidebarOverlay"></div>`;
    }

    async function injectSidebar() {
        const layout = document.querySelector('.erp-layout');
        if (!layout) return;

        // Insert sidebar at the beginning of .erp-layout
        layout.insertAdjacentHTML('afterbegin', buildSidebarHTML());

        // Setup mobile toggle
        setupMobile();

        // Fetch User Info
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                const user = data.user;
                if (user) {
                    const profileEl = document.getElementById('sidebarUserProfile');
                    document.getElementById('sidebarUserName').textContent = user.displayName;
                    document.getElementById('sidebarUserEmail').textContent = user.email;
                    document.getElementById('sidebarUserPhoto').src = user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=005EFC&color=fff`;
                    profileEl.style.display = 'flex';
                }
            } else if (res.status === 401) {
                window.location.href = '/login.html';
            }
        } catch (err) {
            console.error('Failed to load user profile:', err);
        }
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
