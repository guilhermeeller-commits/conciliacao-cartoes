/**
 * Migration 008 — Notifications table
 */

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT DEFAULT 'info',
            title TEXT NOT NULL,
            message TEXT DEFAULT '',
            read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
    `);
}

module.exports = { up };
