module.exports = function registerDayEndShortages(app, database) {
    // Kept separate from preparation, shipment and product verification records.
    database.exec(`
        CREATE TABLE IF NOT EXISTS day_end_shortages (
            id INTEGER PRIMARY KEY,
            order_code TEXT NOT NULL COLLATE NOCASE,
            platform TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            work_date TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
            created_by INTEGER NOT NULL REFERENCES app_users(id),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            resolved_by INTEGER REFERENCES app_users(id),
            resolved_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_day_end_shortages_open
            ON day_end_shortages(order_code, platform) WHERE status = 'open';
    `);

    app.get('/issues/day-end', (req, res) => {
        res.set('Cache-Control', 'no-store');
        const rows = database.prepare(`
            SELECT s.*, u.display_name AS created_by_name, r.display_name AS resolved_by_name
            FROM day_end_shortages s
            JOIN app_users u ON u.id = s.created_by
            LEFT JOIN app_users r ON r.id = s.resolved_by
            ORDER BY s.work_date DESC, s.id DESC
        `).all();
        res.json({ result: rows });
    });

    app.post('/issues/day-end', (req, res) => {
        const { orders, workDate } = req.body;
        const note = String(req.body.note || '').trim().slice(0, 1000);
        const parsed = new Date(`${workDate}T12:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate || '') || !Number.isFinite(parsed.getTime())
            || parsed.toISOString().slice(0, 10) !== workDate
            || !Array.isArray(orders) || !orders.length || orders.length > 200
            || orders.some(o => !o || typeof o.orderCode !== 'string' || !o.orderCode.trim()
                || o.orderCode.length > 120 || !['Trendyol', 'Zoombutik'].includes(o.platform))) {
            return res.status(400).json({ error: 'Geçerli tarih ve en fazla 200 sipariş seçin.' });
        }
        const insert = database.prepare(`
            INSERT INTO day_end_shortages(order_code, platform, customer_name, work_date, note, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_code, platform) WHERE status = 'open' DO NOTHING
        `);
        let added = 0;
        database.exec('BEGIN');
        try {
            for (const order of orders) {
                added += Number(insert.run(order.orderCode.trim(), order.platform,
                    String(order.customerName || '').slice(0, 300), workDate, note, req.user.id).changes);
            }
            database.exec('COMMIT');
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        }
        res.json({ added, skipped: orders.length - added });
    });

    app.patch('/issues/day-end/:id', (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1 || !['edit', 'resolve'].includes(req.body.action)) {
            return res.status(400).json({ error: 'Geçersiz işlem.' });
        }
        const updated = req.body.action === 'resolve'
            ? database.prepare(`UPDATE day_end_shortages SET status = 'resolved',
                resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ? AND status = 'open'`).run(req.user.id, id)
            : database.prepare(`UPDATE day_end_shortages SET note = ? WHERE id = ? AND status = 'open'`)
                .run(String(req.body.note || '').trim().slice(0, 1000), id);
        if (!updated.changes) return res.status(404).json({ error: 'Açık eksik kaydı bulunamadı. Listeyi yenileyin.' });
        res.json({ success: true });
    });
};
