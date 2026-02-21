/* ═══════════════════════════════════════════════════════
   Sidebar — Google Drive–inspired design
   Injects sidebar HTML, sets active nav item, handles mobile
   ═══════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── SVG Icon library (inline, Lucide-style) ── */
    const ICONS = {
        dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
        creditCard: '<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
        refresh: '<svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
        settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        plus: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        chevronRight: '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>',
        fileText: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        database: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    };

    /* ── Navigation structure ── */
    const NAV_GROUPS = [
        {
            items: [
                {
                    href: '/',
                    label: 'Dashboard',
                    icon: 'dashboard',
                    matchPaths: ['/', '/dashboard.html']
                },
            ]
        },
        {
            items: [
                {
                    href: '/faturas.html',
                    label: 'Faturas de Cartão',
                    icon: 'creditCard',
                    matchPaths: ['/faturas.html', '/extratos-cartao.html', '/extrato-detalhe.html', '/conciliacoes.html']
                },
                {
                    href: '/repositorio.html',
                    label: 'Repositório Olist',
                    icon: 'database',
                    matchPaths: ['/repositorio.html']
                },
            ]
        },
        {
            items: [
                {
                    href: '/configuracoes.html',
                    label: 'Configurações',
                    icon: 'settings',
                    matchPaths: ['/configuracoes.html']
                },
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

    function getIcon(name) {
        return ICONS[name] || '';
    }

    function buildNavItemHTML(item) {
        const activeClass = isActive(item) ? ' active' : '';
        const disabledClass = item.disabled ? ' disabled' : '';
        const href = item.disabled ? '#' : item.href;
        const title = item.disabled ? ' title="Em breve"' : '';
        const hasChildren = item.children && item.children.length > 0;

        let html = `<a class="nav-item${activeClass}${disabledClass}" href="${hasChildren ? '#' : href}"${title}${hasChildren ? ' data-expandable="true"' : ''}>
                        <span class="nav-icon">${getIcon(item.icon)}</span>
                        <span class="nav-label">${item.label}</span>`;

        if (hasChildren) {
            html += `<span class="expand-arrow">${getIcon('chevronRight')}</span>`;
        }

        html += '</a>';

        if (hasChildren) {
            const childActive = item.children.some(c => isActive(c));
            html += `<div class="nav-sub-items${childActive ? ' open' : ''}">`;
            item.children.forEach(child => {
                const childActiveClass = isActive(child) ? ' active' : '';
                html += `<a class="nav-item${childActiveClass}" href="${child.href}">
                            <span class="nav-icon">${getIcon(child.icon || 'fileText')}</span>
                            <span class="nav-label">${child.label}</span>
                         </a>`;
            });
            html += '</div>';
        }

        return html;
    }

    function buildSidebarHTML() {
        const groupsHTML = NAV_GROUPS.map(group => {
            const itemsHTML = group.items.map(buildNavItemHTML).join('\n');
            return `<div class="nav-group">
                    ${itemsHTML}
                </div>`;
        }).join('\n                ');

        return `
        <aside class="erp-sidebar" id="sidebar">
            <div class="sidebar-brand">
                <img src="/img/logo-calisul.svg" alt="Calisul" class="sidebar-logo">
            </div>
            <a class="sidebar-action-btn" href="/faturas.html">
                <span class="action-icon">${getIcon('plus')}</span>
                Importar
            </a>
            <nav class="sidebar-nav">
                ${groupsHTML}
            </nav>
            <div class="sidebar-footer" style="display: flex; flex-direction: column; gap: 12px;">
                <div id="sidebarUserProfile" style="display: none; align-items: center; gap: 12px; padding: 10px 12px; background: var(--bg-hover); border-radius: var(--radius-pill); border: 1px solid var(--border-muted);">
                    <img id="sidebarUserPhoto" src="" alt="User" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;">
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

    function setupExpandables() {
        document.querySelectorAll('[data-expandable="true"]').forEach(item => {
            const subItems = item.nextElementSibling;
            if (!subItems || !subItems.classList.contains('nav-sub-items')) return;

            // If a child is active, mark parent as expanded
            if (subItems.classList.contains('open')) {
                item.classList.add('expanded');
            }

            item.addEventListener('click', (e) => {
                e.preventDefault();
                item.classList.toggle('expanded');
                subItems.classList.toggle('open');
            });
        });
    }

    async function injectSidebar() {
        const layout = document.querySelector('.erp-layout');
        if (!layout) return;

        // Insert sidebar at the beginning of .erp-layout
        layout.insertAdjacentHTML('afterbegin', buildSidebarHTML());

        // Setup expandable items
        setupExpandables();

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
