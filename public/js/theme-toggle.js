/* ═══════════════════════════════════════════════════════
   Theme Toggle — Dark / Light Mode
   ═══════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const STORAGE_KEY = 'calisul-theme';

    function getPreferredTheme() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return stored;
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEY, theme);

        // Update toggle label if present
        const label = document.querySelector('.theme-toggle-label');
        if (label) {
            label.textContent = theme === 'dark' ? 'Modo escuro' : 'Modo claro';
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    // Apply on load (before paint)
    applyTheme(getPreferredTheme());

    // Bind toggle buttons after DOM ready
    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('.theme-toggle').forEach(function (btn) {
            btn.addEventListener('click', toggleTheme);
        });
    });

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
        if (!localStorage.getItem(STORAGE_KEY)) {
            applyTheme(e.matches ? 'light' : 'dark');
        }
    });

    // Expose globally
    window.toggleTheme = toggleTheme;
})();
