/**
 * Notifications System — Global toast + badge polling
 * 
 * Include this script on every page to enable the notification system.
 * It polls /api/settings/notifications every 30s and shows toasts for new items.
 */

(function () {
    'use strict';

    const POLL_INTERVAL = 30000; // 30 seconds
    let lastKnownCount = 0;
    let notifContainer = null;
    let badgeEl = null;

    // ─── Init ─────────────────────────────────────

    function init() {
        createContainer();
        createBadge();
        pollNotifications();
        setInterval(pollNotifications, POLL_INTERVAL);
    }

    // ─── Container for toasts ─────────────────────

    function createContainer() {
        notifContainer = document.createElement('div');
        notifContainer.id = 'notif-container';
        notifContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-width: 380px;
            pointer-events: none;
        `;
        document.body.appendChild(notifContainer);
    }

    // ─── Badge on sidebar ─────────────────────────

    function createBadge() {
        // Find sidebar nav entries
        const sidebarLinks = document.querySelectorAll('.sidebar-link, .sidebar a');
        if (sidebarLinks.length === 0) return;

        // Add bell icon near top of sidebar
        const sidebar = document.querySelector('.sidebar, [class*="sidebar"]');
        if (!sidebar) return;

        const bellContainer = document.createElement('div');
        bellContainer.id = 'notif-bell';
        bellContainer.style.cssText = `
            position: absolute;
            top: 12px;
            right: 12px;
            cursor: pointer;
            padding: 6px;
            border-radius: 8px;
            transition: background 0.2s;
        `;
        bellContainer.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span id="notif-badge" style="
                position: absolute;
                top: 2px;
                right: 2px;
                background: #ef4444;
                color: white;
                font-size: 10px;
                font-weight: 700;
                min-width: 16px;
                height: 16px;
                border-radius: 8px;
                display: none;
                align-items: center;
                justify-content: center;
                line-height: 1;
                padding: 0 4px;
            ">0</span>
        `;

        bellContainer.addEventListener('mouseenter', () => {
            bellContainer.style.background = 'var(--surface-2, rgba(255,255,255,0.08))';
        });
        bellContainer.addEventListener('mouseleave', () => {
            bellContainer.style.background = 'transparent';
        });
        bellContainer.addEventListener('click', () => showNotificationPanel());

        sidebar.style.position = sidebar.style.position || 'relative';
        sidebar.appendChild(bellContainer);

        badgeEl = document.getElementById('notif-badge');
    }

    // ─── Poll ─────────────────────────────────────

    async function pollNotifications() {
        try {
            const resp = await fetch('/api/settings/notifications?limit=5');
            const data = await resp.json();
            if (!data.ok) return;

            const { unreadCount, notifications } = data;

            // Update badge
            if (badgeEl) {
                if (unreadCount > 0) {
                    badgeEl.style.display = 'flex';
                    badgeEl.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
                } else {
                    badgeEl.style.display = 'none';
                }
            }

            // Show toast for new notifications
            if (unreadCount > lastKnownCount && lastKnownCount >= 0) {
                const newOnes = notifications.filter(n => !n.read);
                newOnes.slice(0, 3).forEach(n => showToast(n));
            }
            lastKnownCount = unreadCount;
        } catch {
            // Silently fail — server might be restarting
        }
    }

    // ─── Toast ────────────────────────────────────

    function showToast(notification) {
        const toast = document.createElement('div');
        toast.className = 'notif-toast';

        const iconMap = {
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️',
        };

        const bgMap = {
            success: 'linear-gradient(135deg, #065f46, #064e3b)',
            warning: 'linear-gradient(135deg, #78350f, #713f12)',
            error: 'linear-gradient(135deg, #7f1d1d, #991b1b)',
            info: 'linear-gradient(135deg, #1e3a5f, #1e40af)',
        };

        toast.style.cssText = `
            background: ${bgMap[notification.type] || bgMap.info};
            color: white;
            padding: 12px 16px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            pointer-events: auto;
            cursor: pointer;
            transform: translateX(120%);
            transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s;
            opacity: 0;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        `;

        toast.innerHTML = `
            <div style="display:flex;align-items:flex-start;gap:10px;">
                <span style="font-size:18px;line-height:1;">${iconMap[notification.type] || '🔔'}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${escapeHtml(notification.title)}</div>
                    <div style="font-size:11px;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(notification.message)}</div>
                </div>
                <span class="notif-close" style="opacity:0.6;font-size:16px;cursor:pointer;line-height:1;">&times;</span>
            </div>
        `;

        notifContainer.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.transform = 'translateX(0)';
            toast.style.opacity = '1';
        });

        // Click to mark as read
        toast.addEventListener('click', async () => {
            await fetch(`/api/settings/notifications/${notification.id}/read`, { method: 'POST' });
            dismissToast(toast);
            pollNotifications();
        });

        // Auto dismiss
        setTimeout(() => dismissToast(toast), 6000);
    }

    function dismissToast(toast) {
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }

    // ─── Notification Panel (mini dropdown) ───────

    function showNotificationPanel() {
        // Remove existing panel
        const existing = document.getElementById('notif-panel');
        if (existing) { existing.remove(); return; }

        const panel = document.createElement('div');
        panel.id = 'notif-panel';
        panel.style.cssText = `
            position: fixed;
            top: 50px;
            right: 20px;
            width: 350px;
            max-height: 400px;
            background: var(--surface-1, #1a1f36);
            border: 1px solid var(--border, rgba(255,255,255,0.1));
            border-radius: 12px;
            box-shadow: 0 16px 48px rgba(0,0,0,0.4);
            z-index: 10001;
            overflow: hidden;
            color: var(--text-primary, #fff);
        `;

        panel.innerHTML = `
            <div style="padding:14px 16px;border-bottom:1px solid var(--border, rgba(255,255,255,0.1));display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;font-size:14px;">🔔 Notificações</span>
                <button id="notif-mark-all" style="background:none;border:none;color:var(--primary, #6366f1);cursor:pointer;font-size:12px;">Marcar todas</button>
            </div>
            <div id="notif-panel-list" style="max-height:320px;overflow-y:auto;padding:8px;"></div>
        `;

        document.body.appendChild(panel);

        // Load notifications
        loadPanelNotifications();

        // Mark all
        document.getElementById('notif-mark-all').addEventListener('click', async () => {
            await fetch('/api/settings/notifications/read-all', { method: 'POST' });
            pollNotifications();
            loadPanelNotifications();
        });

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', function closePanel(e) {
                if (!panel.contains(e.target) && !e.target.closest('#notif-bell')) {
                    panel.remove();
                    document.removeEventListener('click', closePanel);
                }
            });
        }, 100);
    }

    async function loadPanelNotifications() {
        const list = document.getElementById('notif-panel-list');
        if (!list) return;

        try {
            const resp = await fetch('/api/settings/notifications?limit=20');
            const data = await resp.json();

            if (!data.notifications || data.notifications.length === 0) {
                list.innerHTML = '<div style="text-align:center;padding:30px;opacity:0.5;font-size:13px;">Sem notificações</div>';
                return;
            }

            list.innerHTML = data.notifications.map(n => `
                <div class="notif-item" data-id="${n.id}" style="
                    padding: 10px 12px;
                    border-radius: 8px;
                    margin-bottom: 4px;
                    cursor: pointer;
                    background: ${n.read ? 'transparent' : 'rgba(99,102,241,0.08)'};
                    transition: background 0.2s;
                    border-left: 3px solid ${n.read ? 'transparent' : 'var(--primary, #6366f1)'};
                ">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:12px;font-weight:${n.read ? '400' : '600'};">${escapeHtml(n.title)}</span>
                        <span style="font-size:10px;opacity:0.5;">${timeAgo(n.created_at)}</span>
                    </div>
                    <div style="font-size:11px;opacity:0.7;margin-top:2px;">${escapeHtml(n.message)}</div>
                </div>
            `).join('');

            // Click to mark as read
            list.querySelectorAll('.notif-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    item.style.background = 'rgba(255,255,255,0.05)';
                });
                item.addEventListener('mouseleave', () => {
                    const n = data.notifications.find(n => String(n.id) === item.dataset.id);
                    item.style.background = (n && !n.read) ? 'rgba(99,102,241,0.08)' : 'transparent';
                });
                item.addEventListener('click', async () => {
                    await fetch(`/api/settings/notifications/${item.dataset.id}/read`, { method: 'POST' });
                    pollNotifications();
                    loadPanelNotifications();
                });
            });
        } catch {
            list.innerHTML = '<div style="text-align:center;padding:30px;opacity:0.5;">Erro ao carregar</div>';
        }
    }

    // ─── Utilities ────────────────────────────────

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function timeAgo(dateStr) {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'agora';
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d`;
    }

    // ─── Start ────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
