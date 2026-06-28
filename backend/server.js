require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { DatabaseSync, backup } = require("node:sqlite");

const app = express();
const port = Number(process.env.PORT || 3000);
const dataDirectory = process.env.DATA_DIR
    || process.env.RAILWAY_VOLUME_MOUNT_PATH
    || path.join(__dirname, "data");
const appUsername = process.env.APP_USERNAME || "";
const appPassword = process.env.APP_PASSWORD || "";

if (process.env.RAILWAY_ENVIRONMENT && (!appUsername || !appPassword)) {
    throw new Error("Railway ortaminda APP_USERNAME ve APP_PASSWORD zorunludur.");
}

fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = path.join(dataDirectory, "locations.db");
const backupDirectory = path.join(dataDirectory, "backups");
const database = new DatabaseSync(databasePath);
fs.mkdirSync(backupDirectory, { recursive: true });
fs.readdirSync(backupDirectory)
    .filter(name => /^zora-depo-\d{8}-\d{6}(?:-[a-z]+)?\.db$/i.test(name))
    .forEach(name => {
        const nextName = name.replace(/^zora-depo-/i, "zoom-depo-");
        const source = path.join(backupDirectory, name);
        const target = path.join(backupDirectory, nextName);
        if (!fs.existsSync(target)) fs.renameSync(source, target);
    });
database.exec(`
    CREATE TABLE IF NOT EXISTS product_locations (
        barcode TEXT PRIMARY KEY COLLATE NOCASE,
        product_id TEXT,
        name TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        size TEXT NOT NULL DEFAULT '',
        location_code TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`);
database.exec(`
    CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'worker')),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_preparations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT NOT NULL COLLATE NOCASE,
        customer_name TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        started_by_user_id INTEGER NOT NULL,
        completed_by_user_id INTEGER,
        status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed')),
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (started_by_user_id) REFERENCES app_users(id),
        FOREIGN KEY (completed_by_user_id) REFERENCES app_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_preparations_order_code
        ON order_preparations(order_code);

    CREATE TABLE IF NOT EXISTS order_product_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT NOT NULL COLLATE NOCASE,
        customer_name TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        product_index INTEGER NOT NULL,
        product_id TEXT NOT NULL DEFAULT '',
        product_name TEXT NOT NULL DEFAULT '',
        barcode TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        product_color TEXT NOT NULL DEFAULT '',
        product_size TEXT NOT NULL DEFAULT '',
        missing_quantity INTEGER NOT NULL DEFAULT 1,
        issue_type TEXT NOT NULL CHECK (issue_type IN ('missing', 'damaged', 'stock_mismatch')),
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        created_by_user_id INTEGER NOT NULL,
        resolved_by_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
        FOREIGN KEY (resolved_by_user_id) REFERENCES app_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_product_issues_order_status
        ON order_product_issues(order_code, status);

    CREATE TABLE IF NOT EXISTS app_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        order_code TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'admin')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (notification_id, user_id),
        FOREIGN KEY (notification_id) REFERENCES app_notifications(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_image_cache (
        product_id TEXT PRIMARY KEY,
        image_url TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER,
        actor_name TEXT NOT NULL DEFAULT 'Sistem',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_user_id) REFERENCES app_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
        ON audit_logs(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
        ON audit_logs(entity_type, entity_id);

    CREATE TABLE IF NOT EXISTS operation_alert_keys (
        alert_key TEXT PRIMARY KEY,
        last_notified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`);

const issueColumns = new Set(
    database.prepare(`PRAGMA table_info(order_product_issues)`).all().map(column => column.name)
);

const preparationColumns = new Set(
    database.prepare(`PRAGMA table_info(order_preparations)`).all().map(column => column.name)
);

if (!preparationColumns.has("platform")) {
    database.exec(`ALTER TABLE order_preparations ADD COLUMN platform TEXT NOT NULL DEFAULT ''`);
}

if (!issueColumns.has("platform")) {
    database.exec(`ALTER TABLE order_product_issues ADD COLUMN platform TEXT NOT NULL DEFAULT ''`);
}

if (!issueColumns.has("product_id")) {
    database.exec(`ALTER TABLE order_product_issues ADD COLUMN product_id TEXT NOT NULL DEFAULT ''`);
}

if (!issueColumns.has("image_url")) {
    database.exec(`ALTER TABLE order_product_issues ADD COLUMN image_url TEXT NOT NULL DEFAULT ''`);
}

if (!issueColumns.has("product_color")) {
    database.exec(`ALTER TABLE order_product_issues ADD COLUMN product_color TEXT NOT NULL DEFAULT ''`);
}

if (!issueColumns.has("product_size")) {
    database.exec(`ALTER TABLE order_product_issues ADD COLUMN product_size TEXT NOT NULL DEFAULT ''`);
}

if (!issueColumns.has("missing_quantity")) {
    database.exec(`ALTER TABLE order_product_issues ADD COLUMN missing_quantity INTEGER NOT NULL DEFAULT 1`);
}

function eskiBildirimleriTemizle() {
    database.exec(`
        DELETE FROM notification_reads
        WHERE notification_id IN (
            SELECT id FROM app_notifications WHERE created_at < datetime('now', '-30 days')
        );
        DELETE FROM app_notifications WHERE created_at < datetime('now', '-30 days');
    `);
}

database.exec(`
    UPDATE order_preparations
    SET platform = CASE WHEN UPPER(order_code) LIKE 'TY%' THEN 'Trendyol' ELSE 'Zorabutik' END
    WHERE platform = '';

    UPDATE order_product_issues
    SET platform = CASE WHEN UPPER(order_code) LIKE 'TY%' THEN 'Trendyol' ELSE 'Zorabutik' END
    WHERE platform = '';

    UPDATE order_preparations SET platform = 'Zoombutik' WHERE platform = 'Zorabutik';
    UPDATE order_product_issues SET platform = 'Zoombutik' WHERE platform = 'Zorabutik';
    UPDATE app_users SET display_name = 'Zoom Yönetici' WHERE display_name = 'Zora Yönetici';

`);
eskiBildirimleriTemizle();
setInterval(eskiBildirimleriTemizle, 24 * 60 * 60 * 1000).unref();

if (appUsername.toLocaleLowerCase("tr-TR") === "zoom") {
    const zoomAdmin = database.prepare(`SELECT id FROM app_users WHERE username = 'zoom' COLLATE NOCASE`).get();
    if (!zoomAdmin) {
        database.prepare(`
            UPDATE app_users
            SET username = 'zoom', display_name = 'Zoom Yönetici'
            WHERE username = 'zora' COLLATE NOCASE
        `).run();
    }
}

function sifreHashle(password, salt = crypto.randomBytes(16).toString("hex")) {
    return {
        salt,
        hash: crypto.scryptSync(password, salt, 64).toString("hex")
    };
}

function sifreDogrula(password, salt, expectedHash) {
    const actual = Buffer.from(sifreHashle(password, salt).hash, "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function yoneticiHesabiniHazirla() {
    if (!appUsername || !appPassword) {
        return;
    }

    const existing = database.prepare(`
        SELECT id FROM app_users WHERE username = ? COLLATE NOCASE
    `).get(appUsername);

    if (!existing) {
        const password = sifreHashle(appPassword);
        database.prepare(`
            INSERT INTO app_users (
                username, display_name, role, password_hash, password_salt
            ) VALUES (?, ?, 'admin', ?, ?)
        `).run(appUsername, "Zoom Yönetici", password.hash, password.salt);
    }
}

yoneticiHesabiniHazirla();
database.exec(`
    CREATE TABLE IF NOT EXISTS order_shipments (
        order_code TEXT PRIMARY KEY COLLATE NOCASE,
        customer_name TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        ready_at TEXT,
        shipped_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    ;
    UPDATE order_shipments SET platform = 'Zoombutik' WHERE platform = 'Zorabutik';
`);

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(self)"
    });
    next();
});
app.use(express.static(path.join(__dirname, "public")));

function cookieDegeriniOku(req, name) {
    const cookies = String(req.headers.cookie || "").split(";");

    for (const cookie of cookies) {
        const [key, ...value] = cookie.trim().split("=");

        if (key === name) {
            return decodeURIComponent(value.join("="));
        }
    }

    return "";
}

function oturumKullanicisiniBul(req) {
    const token = cookieDegeriniOku(req, "zoom_session");

    if (!token) {
        return null;
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    return database.prepare(`
        SELECT users.id, users.username, users.display_name, users.role
        FROM app_sessions sessions
        JOIN app_users users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
          AND sessions.expires_at > CURRENT_TIMESTAMP
          AND users.active = 1
    `).get(tokenHash) || null;
}

function oturumGerekli(req, res, next) {
    const user = oturumKullanicisiniBul(req);

    if (!user) {
        return res.status(401).json({ error: "Oturum gerekli." });
    }

    req.user = user;
    next();
}

function yoneticiGerekli(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: "Oturum gerekli." });
    }

    if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Yönetici yetkisi gerekli." });
    }

    next();
}

function kullaniciyiDonustur(user) {
    return {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        active: user.active === undefined ? true : Boolean(user.active),
        createdAt: user.created_at
    };
}

function denetimKaydiOlustur(req, action, entityType, entityId, summary, details = {}) {
    const actor = req?.user;
    database.prepare(`
        INSERT INTO audit_logs (
            actor_user_id, actor_name, action, entity_type, entity_id, summary, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        actor?.id || null,
        actor?.display_name || "Sistem",
        String(action).slice(0, 80),
        String(entityType).slice(0, 80),
        String(entityId || "").slice(0, 160),
        String(summary || "").slice(0, 500),
        JSON.stringify(details || {}).slice(0, 8000)
    );
}

function denetimKaydiniDonustur(row) {
    let details = {};
    try {
        details = JSON.parse(row.details_json || "{}");
    } catch {
        details = {};
    }
    return {
        id: row.id,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        details,
        createdAt: row.created_at
    };
}

app.post("/auth/login", (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const user = database.prepare(`
        SELECT * FROM app_users
        WHERE username = ? COLLATE NOCASE AND active = 1
    `).get(username);

    if (!user || !sifreDogrula(password, user.password_salt, user.password_hash)) {
        return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
    }

    database.prepare(`DELETE FROM app_sessions WHERE expires_at <= CURRENT_TIMESTAMP`).run();

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    database.prepare(`
        INSERT INTO app_sessions (token_hash, user_id, expires_at)
        VALUES (?, ?, datetime('now', '+30 days'))
    `).run(tokenHash, user.id);

    const secure = req.secure || Boolean(process.env.RAILWAY_ENVIRONMENT);
    res.setHeader(
        "Set-Cookie",
        `zoom_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`
    );
    denetimKaydiOlustur({ user }, "user.login", "user", user.id, `${user.display_name} oturum açtı`);
    res.json({ user: kullaniciyiDonustur(user) });
});

app.post("/auth/logout", (req, res) => {
    const token = cookieDegeriniOku(req, "zoom_session");

    if (token) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        database.prepare(`DELETE FROM app_sessions WHERE token_hash = ?`).run(tokenHash);
    }

    res.setHeader("Set-Cookie", "zoom_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    res.status(204).end();
});

app.get("/auth/me", oturumGerekli, (req, res) => {
    res.json({ user: kullaniciyiDonustur(req.user) });
});

app.use((req, res, next) => {
    if (req.path === "/") {
        return next();
    }

    oturumGerekli(req, res, next);
});

function bildirimOlustur(type, title, message, orderCode = "", audience = "all") {
    eskiBildirimleriTemizle();
    database.prepare(`
        INSERT INTO app_notifications (type, title, message, order_code, audience)
        VALUES (?, ?, ?, ?, ?)
    `).run(type, title, message, orderCode, audience);
}

app.get("/notifications", (req, res) => {
    const rows = database.prepare(`
        SELECT
            notifications.*,
            CASE WHEN reads.notification_id IS NULL THEN 0 ELSE 1 END AS is_read
        FROM app_notifications notifications
        LEFT JOIN notification_reads reads
            ON reads.notification_id = notifications.id AND reads.user_id = ?
        WHERE notifications.audience = 'all'
            OR (notifications.audience = 'admin' AND ? = 'admin')
        ORDER BY notifications.created_at DESC
        LIMIT 50
    `).all(req.user.id, req.user.role);

    res.json({
        result: rows.map(row => ({
            id: row.id,
            type: row.type,
            title: row.title,
            message: row.message,
            orderCode: row.order_code,
            createdAt: row.created_at,
            read: Boolean(row.is_read)
        }))
    });
});

app.post("/notifications/read", (req, res) => {
    const visibleIds = database.prepare(`
        SELECT id FROM app_notifications
        WHERE audience = 'all' OR (audience = 'admin' AND ? = 'admin')
    `).all(req.user.role);
    const insert = database.prepare(`
        INSERT OR IGNORE INTO notification_reads (notification_id, user_id)
        VALUES (?, ?)
    `);

    database.exec("BEGIN");
    try {
        visibleIds.forEach(item => insert.run(item.id, req.user.id));
        database.exec("COMMIT");
    } catch (err) {
        database.exec("ROLLBACK");
        throw err;
    }

    res.status(204).end();
});

const backupRetentionDays = Math.max(3, Number(process.env.BACKUP_RETENTION_DAYS || 14));
const preparationAlertHours = Math.max(1, Number(process.env.PREPARATION_ALERT_HOURS || 2));
const issueAlertHours = Math.max(1, Number(process.env.ISSUE_ALERT_HOURS || 24));
const shipmentAlertHours = Math.max(1, Number(process.env.SHIPMENT_ALERT_HOURS || 8));

function yedekDosyalariniListele() {
    return fs.readdirSync(backupDirectory)
        .filter(name => /^zoom-depo-\d{8}-\d{6}(?:-[a-z]+)?\.db$/i.test(name))
        .map(name => {
            const fullPath = path.join(backupDirectory, name);
            const stat = fs.statSync(fullPath);
            return {
                name,
                size: stat.size,
                createdAt: stat.mtime.toISOString()
            };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function eskiYedekleriTemizle() {
    const cutoff = Date.now() - backupRetentionDays * 24 * 60 * 60 * 1000;
    yedekDosyalariniListele().forEach(item => {
        if (new Date(item.createdAt).getTime() < cutoff) {
            fs.unlinkSync(path.join(backupDirectory, item.name));
        }
    });
}

async function yedekOlustur(kind = "auto") {
    const now = new Date();
    const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
    const fileName = `zoom-depo-${stamp.slice(0, 8)}-${stamp.slice(8)}-${kind}.db`;
    const target = path.join(backupDirectory, fileName);
    await backup(database, target);
    eskiYedekleriTemizle();
    return yedekDosyalariniListele().find(item => item.name === fileName);
}

async function gunlukYedegiKontrolEt() {
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const exists = yedekDosyalariniListele().some(item =>
        item.name.startsWith(`zoom-depo-${today}`) && item.name.endsWith("-auto.db")
    );
    if (!exists) {
        await yedekOlustur("auto");
        denetimKaydiOlustur(null, "backup.auto", "system", "", "Günlük otomatik yedek oluşturuldu");
    }
}

function kritikBildirimOlustur(alertKey, type, title, message, orderCode = "") {
    const recent = database.prepare(`
        SELECT alert_key FROM operation_alert_keys
        WHERE alert_key = ? AND last_notified_at > datetime('now', '-24 hours')
    `).get(alertKey);
    if (recent) return false;

    bildirimOlustur(type, title, message, orderCode, "admin");
    database.prepare(`
        INSERT INTO operation_alert_keys (alert_key, last_notified_at)
        VALUES (?, CURRENT_TIMESTAMP)
        ON CONFLICT(alert_key) DO UPDATE SET last_notified_at = CURRENT_TIMESTAMP
    `).run(alertKey);
    denetimKaydiOlustur(null, "alert.create", "order", orderCode, title, { alertKey, message });
    return true;
}

function kritikOperasyonlariKontrolEt() {
    let created = 0;
    const stalePreparations = database.prepare(`
        SELECT order_code, customer_name FROM order_preparations
        WHERE status = 'started' AND started_at <= datetime('now', ?)
        ORDER BY started_at ASC LIMIT 25
    `).all(`-${preparationAlertHours} hours`);
    stalePreparations.forEach(item => {
        created += Number(kritikBildirimOlustur(
            `preparation:${item.order_code}`,
            "preparation_delayed",
            "Hazırlama gecikti",
            `${item.customer_name || item.order_code} · ${preparationAlertHours} saati aştı`,
            item.order_code
        ));
    });

    const staleIssues = database.prepare(`
        SELECT order_code, customer_name, COUNT(*) AS issue_count
        FROM order_product_issues
        WHERE status = 'open' AND created_at <= datetime('now', ?)
        GROUP BY order_code, customer_name
        ORDER BY MIN(created_at) ASC LIMIT 25
    `).all(`-${issueAlertHours} hours`);
    staleIssues.forEach(item => {
        created += Number(kritikBildirimOlustur(
            `issue:${item.order_code}`,
            "issue_delayed",
            "Eksik sipariş uzun süredir bekliyor",
            `${item.customer_name || item.order_code} · ${item.issue_count} açık kayıt`,
            item.order_code
        ));
    });

    const staleShipments = database.prepare(`
        SELECT order_code, customer_name FROM order_shipments
        WHERE status = 'ready' AND ready_at <= datetime('now', ?)
        ORDER BY ready_at ASC LIMIT 25
    `).all(`-${shipmentAlertHours} hours`);
    staleShipments.forEach(item => {
        created += Number(kritikBildirimOlustur(
            `shipment:${item.order_code}`,
            "shipment_delayed",
            "Hazır paket kargoya çıkmadı",
            `${item.customer_name || item.order_code} · ${shipmentAlertHours} saati aştı`,
            item.order_code
        ));
    });

    const stockMismatches = database.prepare(`
        SELECT id, order_code, customer_name, product_name
        FROM order_product_issues
        WHERE status = 'open' AND issue_type = 'stock_mismatch'
        ORDER BY created_at ASC LIMIT 25
    `).all();
    stockMismatches.forEach(item => {
        created += Number(kritikBildirimOlustur(
            `stock:${item.id}`,
            "stock_mismatch_critical",
            "Kritik stok uyuşmazlığı",
            `${item.customer_name || item.order_code} · ${item.product_name}`,
            item.order_code
        ));
    });
    return created;
}

app.get("/admin/backups", yoneticiGerekli, (req, res) => {
    res.json({
        retentionDays: backupRetentionDays,
        result: yedekDosyalariniListele()
    });
});

app.post("/admin/backups", yoneticiGerekli, async (req, res, next) => {
    try {
        const item = await yedekOlustur("manual");
        denetimKaydiOlustur(req, "backup.manual", "system", item.name, "Manuel veritabanı yedeği oluşturuldu", {
            size: item.size
        });
        res.status(201).json({ result: item });
    } catch (err) {
        next(err);
    }
});

app.get("/admin/backups/:name", yoneticiGerekli, (req, res) => {
    const name = path.basename(String(req.params.name || ""));
    if (!yedekDosyalariniListele().some(item => item.name === name)) {
        return res.status(404).json({ error: "Yedek dosyası bulunamadı." });
    }
    denetimKaydiOlustur(req, "backup.download", "system", name, "Veritabanı yedeği indirildi");
    res.download(path.join(backupDirectory, name), name);
});

app.get("/admin/operations/status", yoneticiGerekli, (req, res) => {
    const latestBackup = yedekDosyalariniListele()[0] || null;
    const counts = {
        delayedPreparations: database.prepare(`
            SELECT COUNT(*) AS count FROM order_preparations
            WHERE status = 'started' AND started_at <= datetime('now', ?)
        `).get(`-${preparationAlertHours} hours`).count,
        delayedIssues: database.prepare(`
            SELECT COUNT(DISTINCT order_code) AS count FROM order_product_issues
            WHERE status = 'open' AND created_at <= datetime('now', ?)
        `).get(`-${issueAlertHours} hours`).count,
        delayedShipments: database.prepare(`
            SELECT COUNT(*) AS count FROM order_shipments
            WHERE status = 'ready' AND ready_at <= datetime('now', ?)
        `).get(`-${shipmentAlertHours} hours`).count,
        stockMismatches: database.prepare(`
            SELECT COUNT(*) AS count FROM order_product_issues
            WHERE status = 'open' AND issue_type = 'stock_mismatch'
        `).get().count
    };
    res.json({
        latestBackup,
        backupRetentionDays,
        thresholds: {
            preparationHours: preparationAlertHours,
            issueHours: issueAlertHours,
            shipmentHours: shipmentAlertHours
        },
        counts
    });
});

app.post("/admin/operations/check", yoneticiGerekli, (req, res) => {
    const created = kritikOperasyonlariKontrolEt();
    denetimKaydiOlustur(req, "alert.manual_check", "system", "", "Kritik operasyon kontrolü çalıştırıldı", { created });
    res.json({ created });
});

gunlukYedegiKontrolEt().catch(err => console.error("Otomatik yedek olusturulamadi:", err));
setInterval(() => gunlukYedegiKontrolEt().catch(err => console.error("Otomatik yedek olusturulamadi:", err)), 60 * 60 * 1000).unref();
setTimeout(() => kritikOperasyonlariKontrolEt(), 30 * 1000).unref();
setInterval(() => kritikOperasyonlariKontrolEt(), 15 * 60 * 1000).unref();

const API = axios.create({
    baseURL: process.env.API_URL,
    headers: {
        apikey: process.env.API_KEY,
        apisecret: process.env.API_SECRET
    }
});
const productImageCache = new Map(
    database.prepare(`SELECT product_id, image_url FROM product_image_cache`).all()
        .map(item => [Number(item.product_id), item.image_url])
);
const productPageCache = new Map();
let fullProductListCache = null;
let fullProductListPromise = null;
const productListCacheMs = Math.max(60, Number(process.env.PRODUCT_CACHE_SECONDS || 600)) * 1000;
const productImageSave = database.prepare(`
    INSERT INTO product_image_cache (product_id, image_url, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(product_id) DO UPDATE SET
        image_url = excluded.image_url,
        updated_at = CURRENT_TIMESTAMP
`);
const upstreamStatus = {
    healthy: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    message: "Henüz kontrol edilmedi."
};
const activeOrderStatuses = String(process.env.ACTIVE_ORDER_STATUSES || "1,2")
    .split(",")
    .map(value => Number(value.trim()))
    .filter(Number.isInteger);
const orderPageConcurrency = Math.max(2, Math.min(10, Number(process.env.ORDER_PAGE_CONCURRENCY || 6)));
const orderCheckMs = Math.max(5000, Number(process.env.ORDER_CHECK_SECONDS || 10) * 1000);
let activeOrderCache = null;
let activeOrderPromise = null;
let nextOrderCheckAt = 0;

function apiDurumunuGuncelle(healthy, message = "") {
    const previous = upstreamStatus.healthy;
    upstreamStatus.healthy = healthy;
    upstreamStatus.message = message || (healthy ? "Qukasoft API bağlantısı çalışıyor." : "Qukasoft API bağlantısı kurulamadı.");
    upstreamStatus[healthy ? "lastSuccessAt" : "lastErrorAt"] = new Date().toISOString();

    if (!healthy && previous !== false) {
        bildirimOlustur(
            "api_outage",
            "Qukasoft API bağlantısı kesildi",
            upstreamStatus.message,
            "",
            "admin"
        );
        denetimKaydiOlustur(null, "api.outage", "system", "qukasoft", "Qukasoft API bağlantısı kesildi", {
            message: upstreamStatus.message
        });
    } else if (healthy && previous === false) {
        bildirimOlustur(
            "api_recovered",
            "Qukasoft API bağlantısı düzeldi",
            "Trendyol ve Zoombutik siparişleri yeniden güncelleniyor.",
            "",
            "admin"
        );
        denetimKaydiOlustur(null, "api.recovered", "system", "qukasoft", "Qukasoft API bağlantısı yeniden kuruldu");
    }
}

function listeyiBul(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.result?.list)) return data.result.list;
    if (Array.isArray(data?.result)) return data.result;
    if (Array.isArray(data?.list)) return data.list;
    if (Array.isArray(data?.products)) return data.products;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.data?.list)) return data.data.list;
    return [];
}

function apiHatasiGonder(err, res) {
    if (err.response) {
        res.status(err.response.status).json(err.response.data);
    } else {
        res.status(500).json({ error: err.message });
    }
}

function siparisListesi(data) {
    return Array.isArray(data?.result?.list) ? data.result.list : [];
}

function siparisKimligi(item) {
    return String(item?.order?.code || item?.code || item?.orderCode || item?.order?.id || item?.id || "");
}

async function aktifSiparisleriGetir() {
    if (activeOrderCache && Date.now() < nextOrderCheckAt) {
        return activeOrderCache;
    }
    if (activeOrderPromise) {
        return activeOrderPromise;
    }

    activeOrderPromise = (async () => {
        const firstPages = await Promise.all(activeOrderStatuses.map(async status => {
            const url = `/order/listsV2?pageStart=0&pageSize=100&orderBy=id&sort=desc&status=${status}`;
            const response = await API.get(url);
            const list = siparisListesi(response.data);
            return {
                status,
                list,
                total: Number(response.data?.result?.total || list.length),
                pageSize: Number(response.data?.result?.pageSize || list.length || 30)
            };
        }));
        const signature = firstPages
            .map(page => `${page.status}:${page.total}:${siparisKimligi(page.list[0])}`)
            .join("|");

        if (activeOrderCache?.signature === signature) {
            nextOrderCheckAt = Date.now() + orderCheckMs;
            apiDurumunuGuncelle(true);
            return activeOrderCache;
        }

        const allPages = [];
        for (const first of firstPages) {
            allPages.push(first.list);
            const starts = [];
            for (let start = first.pageSize; start < first.total; start += first.pageSize) {
                starts.push(start);
            }
            for (let index = 0; index < starts.length; index += orderPageConcurrency) {
                const batch = starts.slice(index, index + orderPageConcurrency);
                const batchPages = await Promise.all(batch.map(async pageStart => {
                    const url = `/order/listsV2?pageStart=${pageStart}&pageSize=${first.pageSize}&orderBy=id&sort=desc&status=${first.status}`;
                    const response = await API.get(url);
                    return siparisListesi(response.data);
                }));
                allPages.push(...batchPages);
            }
        }

        const unique = new Map();
        allPages.flat().forEach(item => {
            const key = siparisKimligi(item);
            if (key && !unique.has(key)) unique.set(key, item);
        });
        const list = [...unique.values()].sort((a, b) =>
            Number(b?.order?.id || b?.id || 0) - Number(a?.order?.id || a?.id || 0)
        );
        activeOrderCache = {
            code: 200,
            signature,
            result: {
                total: list.length,
                pageSize: list.length,
                list
            }
        };
        nextOrderCheckAt = Date.now() + orderCheckMs;
        apiDurumunuGuncelle(true);
        return activeOrderCache;
    })();

    try {
        return await activeOrderPromise;
    } finally {
        activeOrderPromise = null;
    }
}

function urunGorselUrliniBul(product) {
    const images = Array.isArray(product?.images) ? product.images : [];
    const first = images[0];

    if (typeof first === "string") {
        return first;
    }

    return first?.imagesUrl || first?.imageUrl || first?.url || product?.imageUrl || product?.image || "";
}

async function urunSayfasiniGetir(pageStart) {
    if (!productPageCache.has(pageStart)) {
        productPageCache.set(pageStart, API.get(
            `/product/lists?pageStart=${pageStart}&pageSize=100&orderBy=id&sort=desc`
        ).then(response => listeyiBul(response.data)).catch(err => {
            productPageCache.delete(pageStart);
            throw err;
        }));
    }

    return productPageCache.get(pageStart);
}

async function urunGorselleriniGetir(productIds) {
    const ids = [...new Set(productIds.map(id => Number(id)).filter(Number.isFinite))];
    const missing = ids.filter(id => !productImageCache.has(id));

    if (missing.length) {
        const firstPage = await urunSayfasiniGetir(0);
        const highestId = Math.max(...firstPage.map(item => Number(item.id) || 0));
        const candidateStarts = new Set([0]);

        missing.forEach(id => {
            const estimated = Math.max(0, Math.floor(Math.max(0, highestId - id) / 100) * 100);
            candidateStarts.add(estimated);
            candidateStarts.add(Math.max(0, estimated - 100));
            candidateStarts.add(estimated + 100);
        });

        const pages = await Promise.all([...candidateStarts].map(urunSayfasiniGetir));
        pages.flat().forEach(product => {
            const id = Number(product.id);

            if (Number.isFinite(id)) {
                const imageUrl = urunGorselUrliniBul(product);
                productImageCache.set(id, imageUrl);

                if (imageUrl) {
                    productImageSave.run(String(id), imageUrl);
                }
            }
        });

        missing.forEach(id => {
            if (!productImageCache.has(id)) {
                productImageCache.set(id, "");
            }
        });
    }

    return Object.fromEntries(ids.map(id => [id, productImageCache.get(id) || ""]));
}

async function urunListesiniGetir() {
    if (fullProductListCache && fullProductListCache.expiresAt > Date.now()) {
        return fullProductListCache.data;
    }

    if (fullProductListPromise) {
        return fullProductListPromise;
    }

    fullProductListPromise = (async () => {
        const endpoints = ["/product/lists", "/product/listsV2", "/product/list"];
        const requestedPageSize = Math.max(50, Number(process.env.PRODUCT_PAGE_SIZE || 100));
        const concurrency = Math.max(2, Math.min(10, Number(process.env.PRODUCT_PAGE_CONCURRENCY || 6)));
        let sonHata = null;

        for (const endpoint of endpoints) {
            try {
                const firstUrl = `${endpoint}?pageStart=0&pageSize=${requestedPageSize}&orderBy=id&sort=desc`;
                const firstResponse = await API.get(firstUrl);
                const firstList = listeyiBul(firstResponse.data);
                const reportedPageSize = Number(
                    firstResponse.data?.result?.pageSize
                    || firstResponse.data?.pageSize
                    || firstList.length
                    || requestedPageSize
                );
                const total = Math.max(
                    firstList.length,
                    Number(firstResponse.data?.result?.total || firstResponse.data?.total || firstList.length)
                );
                const safeTotal = Math.min(total, 50000);
                const starts = [];

                for (let start = reportedPageSize; start < safeTotal; start += reportedPageSize) {
                    starts.push(start);
                }

                const pages = [firstList];
                for (let index = 0; index < starts.length; index += concurrency) {
                    const batch = starts.slice(index, index + concurrency);
                    const batchPages = await Promise.all(batch.map(async pageStart => {
                        const url = `${endpoint}?pageStart=${pageStart}&pageSize=${reportedPageSize}&orderBy=id&sort=desc`;
                        const response = await API.get(url);
                        return listeyiBul(response.data);
                    }));
                    pages.push(...batchPages);
                }

                const unique = new Map();
                pages.flat().forEach((product, index) => {
                    const key = String(
                        product?.id
                        ?? product?.productId
                        ?? product?.barcode
                        ?? product?.barCode
                        ?? `${index}:${JSON.stringify(product).slice(0, 200)}`
                    );
                    if (!unique.has(key)) unique.set(key, product);
                });
                const list = [...unique.values()];
                const data = {
                    source: endpoint,
                    count: list.length,
                    total,
                    pages: pages.length,
                    result: { list },
                    raw: firstResponse.data
                };
                fullProductListCache = {
                    expiresAt: Date.now() + productListCacheMs,
                    data
                };
                apiDurumunuGuncelle(true);
                return data;
            } catch (err) {
                sonHata = err;
                if (!err.response || ![404, 405].includes(err.response.status)) {
                    throw err;
                }
            }
        }

        throw sonHata;
    })();

    try {
        return await fullProductListPromise;
    } finally {
        fullProductListPromise = null;
    }
}

async function urunDetayiniGetir(id) {
    const encodedId = encodeURIComponent(id);
    const endpoints = [
        `/product/detail?id=${encodedId}`,
        `/product/detail?productId=${encodedId}`,
        `/product/details?id=${encodedId}`,
        `/product/details?productId=${encodedId}`,
        `/product/get?id=${encodedId}`,
        `/product/get?productId=${encodedId}`,
        `/product/read?id=${encodedId}`,
        `/product/info?id=${encodedId}`,
        `/product/detail/${encodedId}`,
        `/product/get/${encodedId}`
    ];

    let sonHata = null;

    for (const endpoint of endpoints) {
        try {
            const response = await API.get(endpoint);
            const result = response.data?.result || response.data?.data || response.data;

            if (Array.isArray(result) && result.length === 0) {
                sonHata = new Error(`Bos detay yaniti: ${endpoint}`);
                continue;
            }

            return { source: endpoint, result, raw: response.data };
        } catch (err) {
            sonHata = err;

            if (!err.response || ![404, 405].includes(err.response.status)) {
                throw err;
            }
        }
    }

    const liste = await urunListesiniGetir();
    const fallbackUrun = liste.result.list.find(item => String(item.id) === String(id) || String(item.productId) === String(id));

    if (fallbackUrun) {
        return {
            source: "product/lists fallback",
            result: fallbackUrun,
            raw: fallbackUrun
        };
    }

    throw sonHata;
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/test", async (req, res) => {
    try {
        const response = await API.get("/auth");
        res.json(response.data);
    } catch (err) {
        apiHatasiGonder(err, res);
    }
});

app.get("/orders", async (req, res) => {
    try {
        res.json(await aktifSiparisleriGetir());
    } catch (err) {
        apiDurumunuGuncelle(false, err.response?.data?.error || err.message);
        apiHatasiGonder(err, res);
    }
});

app.get("/api-status", (req, res) => {
    res.json({
        healthy: upstreamStatus.healthy,
        message: upstreamStatus.message,
        lastSuccessAt: upstreamStatus.lastSuccessAt,
        lastErrorAt: upstreamStatus.lastErrorAt,
        platforms: {
            trendyol: upstreamStatus.healthy,
            zoombutik: upstreamStatus.healthy
        }
    });
});

app.get("/order/:code", async (req, res) => {
    try {
        const data = await aktifSiparisleriGetir();
        const siparis = data.result.list.find(
            item => siparisKimligi(item).toUpperCase() === String(req.params.code).toUpperCase()
        );

        if (!siparis) {
            return res.status(404).json({
                error: "Siparis bulunamadi."
            });
        }

        res.json(siparis);
    } catch (err) {
        apiHatasiGonder(err, res);
    }
});

app.get("/products", async (req, res) => {
    try {
        const data = await urunListesiniGetir();
        res.json(data);
    } catch (err) {
        apiHatasiGonder(err, res);
    }
});

app.post("/product-images", async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 100) : [];
        const result = await urunGorselleriniGetir(ids);
        res.json({ result });
    } catch (err) {
        apiHatasiGonder(err, res);
    }
});

app.get("/products/:id", async (req, res) => {
    try {
        const data = await urunDetayiniGetir(req.params.id);
        res.json(data);
    } catch (err) {
        apiHatasiGonder(err, res);
    }
});

app.get("/admin/users", yoneticiGerekli, (req, res) => {
    const users = database.prepare(`
        SELECT id, username, display_name, role, active, created_at
        FROM app_users
        ORDER BY display_name, username
    `).all();
    res.json({ result: users.map(kullaniciyiDonustur) });
});

app.post("/admin/users", yoneticiGerekli, (req, res) => {
    const username = String(req.body.username || "").trim();
    const displayName = String(req.body.displayName || "").trim();
    const passwordText = String(req.body.password || "");
    const role = req.body.role === "admin" ? "admin" : "worker";

    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
        return res.status(400).json({ error: "Kullanıcı adı 3-40 karakter olmalı." });
    }

    if (!displayName || displayName.length > 100) {
        return res.status(400).json({ error: "Geçerli bir ad soyad gerekli." });
    }

    if (passwordText.length < 8) {
        return res.status(400).json({ error: "Parola en az 8 karakter olmalı." });
    }

    const password = sifreHashle(passwordText);

    try {
        const result = database.prepare(`
            INSERT INTO app_users (
                username, display_name, role, password_hash, password_salt
            ) VALUES (?, ?, ?, ?, ?)
        `).run(username, displayName, role, password.hash, password.salt);
        const user = database.prepare(`SELECT * FROM app_users WHERE id = ?`).get(result.lastInsertRowid);
        denetimKaydiOlustur(req, "user.create", "user", user.id, `${displayName} kullanıcısı oluşturuldu`, {
            username,
            role
        });
        res.status(201).json({ result: kullaniciyiDonustur(user) });
    } catch (err) {
        if (String(err.message).includes("UNIQUE")) {
            return res.status(409).json({ error: "Bu kullanıcı adı zaten kullanılıyor." });
        }
        throw err;
    }
});

app.patch("/admin/users/:id", yoneticiGerekli, (req, res) => {
    const id = Number(req.params.id);
    const user = database.prepare(`SELECT * FROM app_users WHERE id = ?`).get(id);

    if (!user) {
        return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    if (req.body.active !== undefined) {
        const active = req.body.active ? 1 : 0;

        if (id === req.user.id && !active) {
            return res.status(400).json({ error: "Kendi yönetici hesabınızı devre dışı bırakamazsınız." });
        }

        database.prepare(`UPDATE app_users SET active = ? WHERE id = ?`).run(active, id);

        if (!active) {
            database.prepare(`DELETE FROM app_sessions WHERE user_id = ?`).run(id);
        }
        denetimKaydiOlustur(
            req,
            active ? "user.enable" : "user.disable",
            "user",
            id,
            `${user.display_name} ${active ? "etkinleştirildi" : "devre dışı bırakıldı"}`
        );
    }

    if (req.body.password !== undefined) {
        const passwordText = String(req.body.password || "");

        if (passwordText.length < 8) {
            return res.status(400).json({ error: "Parola en az 8 karakter olmalı." });
        }

        const password = sifreHashle(passwordText);
        database.prepare(`
            UPDATE app_users SET password_hash = ?, password_salt = ? WHERE id = ?
        `).run(password.hash, password.salt, id);
        database.prepare(`DELETE FROM app_sessions WHERE user_id = ? AND user_id != ?`).run(id, req.user.id);
        denetimKaydiOlustur(req, "user.password_change", "user", id, `${user.display_name} parolası değiştirildi`);
    }

    const updated = database.prepare(`SELECT * FROM app_users WHERE id = ?`).get(id);
    res.json({ result: kullaniciyiDonustur(updated) });
});

app.get("/admin/audit-logs", yoneticiGerekli, (req, res) => {
    const search = String(req.query.search || "").trim().slice(0, 120);
    const action = String(req.query.action || "").trim().slice(0, 80);
    const dateFrom = String(req.query.dateFrom || "").trim();
    const dateTo = String(req.query.dateTo || "").trim();
    const conditions = [];
    const params = [];

    if (search) {
        conditions.push(`(
            actor_name LIKE ? COLLATE NOCASE
            OR entity_id LIKE ? COLLATE NOCASE
            OR summary LIKE ? COLLATE NOCASE
        )`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (action) {
        conditions.push("action = ?");
        params.push(action);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        conditions.push("date(created_at, '+3 hours') >= date(?)");
        params.push(dateFrom);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        conditions.push("date(created_at, '+3 hours') <= date(?)");
        params.push(dateTo);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = database.prepare(`
        SELECT * FROM audit_logs
        ${where}
        ORDER BY created_at DESC
        LIMIT 500
    `).all(...params);

    res.json({ result: rows.map(denetimKaydiniDonustur) });
});

function hazirlamaGecmisiGetir() {
    const rows = database.prepare(`
        SELECT
            preparations.id,
            preparations.order_code,
            preparations.customer_name,
            preparations.platform,
            preparations.status,
            preparations.started_at,
            preparations.completed_at,
            preparations.started_by_user_id,
            preparations.completed_by_user_id,
            starter.display_name AS started_by,
            completer.display_name AS completed_by
        FROM order_preparations preparations
        JOIN app_users starter ON starter.id = preparations.started_by_user_id
        LEFT JOIN app_users completer ON completer.id = preparations.completed_by_user_id
        ORDER BY preparations.started_at DESC
        LIMIT 500
    `).all();

    return rows.map(row => ({
        id: row.id,
        orderCode: row.order_code,
        customerName: row.customer_name,
        platform: row.platform,
        status: row.status,
        startedBy: row.started_by,
        startedByUserId: row.started_by_user_id,
        completedBy: row.completed_by || "",
        completedByUserId: row.completed_by_user_id,
        startedAt: row.started_at,
        completedAt: row.completed_at
    }));
}

app.get("/admin/preparations", yoneticiGerekli, (req, res) => {
    res.json({ result: hazirlamaGecmisiGetir() });
});

app.get("/preparations", (req, res) => {
    const users = database.prepare(`
        SELECT id, display_name
        FROM app_users
        WHERE active = 1
        ORDER BY display_name COLLATE NOCASE
    `).all();

    res.json({
        result: hazirlamaGecmisiGetir(),
        users: users.map(user => ({
            id: user.id,
            displayName: user.display_name
        }))
    });
});

function raporKayitlariniFiltrele(query) {
    const platform = String(query.platform || "").trim().toLocaleLowerCase("tr-TR");
    const dateFrom = String(query.dateFrom || "").trim();
    const dateTo = String(query.dateTo || "").trim();

    return hazirlamaGecmisiGetir().filter(item => {
        const itemPlatform = String(item.platform || "").toLocaleLowerCase("tr-TR");
        const startedAt = new Date(`${String(item.startedAt || "").replace(" ", "T")}Z`);
        const itemDate = Number.isNaN(startedAt.getTime())
            ? String(item.startedAt || "").slice(0, 10)
            : new Date(startedAt.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
        return (!platform || itemPlatform === platform)
            && (!dateFrom || itemDate >= dateFrom)
            && (!dateTo || itemDate <= dateTo);
    });
}

app.get("/preparations/summary", (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ""))
        ? String(req.query.date)
        : new Date().toISOString().slice(0, 10);
    const platform = String(req.query.platform || "").trim();
    const platformCondition = platform ? "AND preparations.platform = ? COLLATE NOCASE" : "";
    const params = platform ? [date, platform] : [date];
    const rows = database.prepare(`
        SELECT
            users.id,
            users.display_name,
            COUNT(preparations.id) AS total_count,
            SUM(CASE WHEN preparations.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
            AVG(CASE
                WHEN preparations.status = 'completed'
                THEN (julianday(preparations.completed_at) - julianday(preparations.started_at)) * 1440
                ELSE NULL
            END) AS average_minutes
        FROM app_users users
        LEFT JOIN order_preparations preparations
            ON (preparations.completed_by_user_id = users.id OR (
                preparations.completed_by_user_id IS NULL AND preparations.started_by_user_id = users.id
            ))
            AND date(preparations.started_at, '+3 hours') = date(?)
            ${platformCondition}
        WHERE users.active = 1
        GROUP BY users.id, users.display_name
        ORDER BY completed_count DESC, users.display_name COLLATE NOCASE
    `).all(...params);

    res.json({
        date,
        result: rows.map(row => ({
            userId: row.id,
            displayName: row.display_name,
            totalCount: row.total_count,
            completedCount: row.completed_count || 0,
            pendingCount: row.total_count - (row.completed_count || 0),
            averageMinutes: row.average_minutes === null ? null : Math.round(row.average_minutes * 10) / 10
        }))
    });
});

app.get("/reports/preparations.xlsx", async (req, res) => {
    const records = raporKayitlariniFiltrele(req.query);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Hazirlama Gecmisi");
    sheet.columns = [
        { header: "Siparis No", key: "orderCode", width: 22 },
        { header: "Musteri", key: "customerName", width: 28 },
        { header: "Platform", key: "platform", width: 14 },
        { header: "Baslatan", key: "startedBy", width: 22 },
        { header: "Baslangic", key: "startedAt", width: 20 },
        { header: "Tamamlayan", key: "completedBy", width: 22 },
        { header: "Tamamlanma", key: "completedAt", width: 20 },
        { header: "Durum", key: "status", width: 14 }
    ];
    records.forEach(item => sheet.addRow({
        ...item,
        completedBy: item.completedBy || "-",
        completedAt: item.completedAt || "-",
        status: item.status === "completed" ? "Tamamlandi" : "Hazirlaniyor"
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF175CD3" } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="hazirlama-gecmisi.xlsx"');
    res.send(Buffer.from(buffer));
});

app.get("/reports/preparations.pdf", (req, res) => {
    const records = raporKayitlariniFiltrele(req.query);
    const doc = new PDFDocument({ size: "A4", margin: 38 });
    const fontCandidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:\\Windows\\Fonts\\arial.ttf"
    ];
    const fontPath = fontCandidates.find(candidate => fs.existsSync(candidate));

    if (fontPath) {
        doc.font(fontPath);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="hazirlama-gecmisi.pdf"');
    doc.pipe(res);
    doc.fontSize(18).text("Zoom Depo Pro - Hazırlama Geçmişi");
    doc.moveDown(0.4).fontSize(9).fillColor("#667085").text(`Kayıt sayısı: ${records.length}`);
    doc.moveDown(0.8).fillColor("#111827");
    records.forEach((item, index) => {
        if (doc.y > 740) {
            doc.addPage();
        }
        doc.fontSize(10).text(`${index + 1}. ${item.orderCode} · ${item.platform} · ${item.customerName}`, { continued: false });
        doc.fontSize(8).fillColor("#475467").text(
            `${item.startedBy} | ${item.startedAt} | ${item.completedBy || "-"} | ${item.completedAt || "-"} | ${item.status === "completed" ? "Tamamlandı" : "Hazırlanıyor"}`
        );
        doc.moveDown(0.5).fillColor("#111827");
    });
    doc.end();
});

function sorunKaydiniDonustur(row) {
    return {
        id: row.id,
        orderCode: row.order_code,
        customerName: row.customer_name,
        platform: row.platform,
        productIndex: row.product_index,
        productId: row.product_id,
        productName: row.product_name,
        barcode: row.barcode,
        imageUrl: row.image_url,
        color: row.product_color,
        size: row.product_size,
        missingQuantity: row.missing_quantity,
        issueType: row.issue_type,
        note: row.note,
        status: row.status,
        createdBy: row.created_by,
        resolvedBy: row.resolved_by || "",
        createdAt: row.created_at,
        resolvedAt: row.resolved_at
    };
}

app.get("/issues", (req, res) => {
    const orderCode = String(req.query.orderCode || "").trim();
    const status = String(req.query.status || "open").trim();
    const conditions = [];
    const params = [];

    if (orderCode) {
        conditions.push("issues.order_code = ? COLLATE NOCASE");
        params.push(orderCode);
    }

    if (status === "open" || status === "resolved") {
        conditions.push("issues.status = ?");
        params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = database.prepare(`
        SELECT
            issues.*,
            creator.display_name AS created_by,
            resolver.display_name AS resolved_by
        FROM order_product_issues issues
        JOIN app_users creator ON creator.id = issues.created_by_user_id
        LEFT JOIN app_users resolver ON resolver.id = issues.resolved_by_user_id
        ${where}
        ORDER BY issues.created_at DESC
        LIMIT 500
    `).all(...params);

    res.json({ result: rows.map(sorunKaydiniDonustur) });
});

app.post("/issues", (req, res) => {
    const orderCode = String(req.body.orderCode || "").trim().slice(0, 120);
    const customerName = String(req.body.customerName || "").trim().slice(0, 300);
    const platform = String(req.body.platform || "").trim().slice(0, 100);
    const productIndex = Number(req.body.productIndex);
    const productId = String(req.body.productId || "").trim().slice(0, 120);
    const productName = String(req.body.productName || "").trim().slice(0, 500);
    const barcode = String(req.body.barcode || "").trim().slice(0, 120);
    const imageUrl = String(req.body.imageUrl || "").trim().slice(0, 2000);
    const productColor = String(req.body.color || "").trim().slice(0, 120);
    const productSize = String(req.body.size || "").trim().slice(0, 120);
    const issueType = String(req.body.issueType || "").trim();
    const note = String(req.body.note || "").trim().slice(0, 1000);
    const requestedMissingQuantity = Number(req.body.missingQuantity);
    const missingQuantity = issueType === "missing" && Number.isInteger(requestedMissingQuantity) && requestedMissingQuantity > 0
        ? Math.min(requestedMissingQuantity, 999)
        : 1;

    if (!orderCode || !Number.isInteger(productIndex) || productIndex < 0 || !["missing", "damaged", "stock_mismatch"].includes(issueType)) {
        return res.status(400).json({ error: "Sipariş, ürün ve sorun türü zorunludur." });
    }

    const existing = database.prepare(`
        SELECT id FROM order_product_issues
        WHERE order_code = ? COLLATE NOCASE AND product_index = ? AND status = 'open'
    `).get(orderCode, productIndex);

    if (existing) {
        return res.status(409).json({ error: "Bu ürün için zaten açık bir sorun kaydı var." });
    }

    const result = database.prepare(`
        INSERT INTO order_product_issues (
            order_code, customer_name, platform, product_index, product_id, product_name, barcode,
            image_url, product_color, product_size, missing_quantity, issue_type, note, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        orderCode, customerName, platform, productIndex, productId, productName, barcode,
        imageUrl, productColor, productSize, missingQuantity, issueType, note, req.user.id
    );

    const row = database.prepare(`
        SELECT issues.*, creator.display_name AS created_by, NULL AS resolved_by
        FROM order_product_issues issues
        JOIN app_users creator ON creator.id = issues.created_by_user_id
        WHERE issues.id = ?
    `).get(result.lastInsertRowid);

    const issueLabels = {
        missing: "Eksik ürün",
        damaged: "Hasarlı ürün",
        stock_mismatch: "Yanlış stok"
    };
    bildirimOlustur(
        "issue_opened",
        issueLabels[issueType],
        `${platform || "Platform yok"} · ${customerName || orderCode} · ${productName}${issueType === "missing" ? ` · ${missingQuantity} adet` : ""}`,
        orderCode,
        "admin"
    );
    denetimKaydiOlustur(req, "issue.create", "issue", result.lastInsertRowid, `${orderCode} için ${issueLabels[issueType]} kaydı açıldı`, {
        orderCode,
        productName,
        barcode,
        issueType,
        missingQuantity
    });

    res.status(201).json({ result: sorunKaydiniDonustur(row) });
});

app.patch("/issues/:id", (req, res) => {
    const id = Number(req.params.id);
    const issue = database.prepare(`SELECT * FROM order_product_issues WHERE id = ? AND status = 'open'`).get(id);

    if (!issue) {
        return res.status(404).json({ error: "Açık sorun kaydı bulunamadı." });
    }

    const issueType = String(req.body.issueType || issue.issue_type).trim();
    const note = String(req.body.note ?? issue.note).trim().slice(0, 1000);
    const requestedQuantity = Number(req.body.missingQuantity);
    const missingQuantity = issueType === "missing" && Number.isInteger(requestedQuantity) && requestedQuantity > 0
        ? Math.min(requestedQuantity, 999)
        : 1;

    if (!["missing", "damaged", "stock_mismatch"].includes(issueType)) {
        return res.status(400).json({ error: "Geçersiz sorun türü." });
    }

    database.prepare(`
        UPDATE order_product_issues
        SET issue_type = ?, note = ?, missing_quantity = ?
        WHERE id = ?
    `).run(issueType, note, missingQuantity, id);

    const row = database.prepare(`
        SELECT issues.*, creator.display_name AS created_by, resolver.display_name AS resolved_by
        FROM order_product_issues issues
        JOIN app_users creator ON creator.id = issues.created_by_user_id
        LEFT JOIN app_users resolver ON resolver.id = issues.resolved_by_user_id
        WHERE issues.id = ?
    `).get(id);

    bildirimOlustur(
        "issue_updated",
        "Ürün sorunu güncellendi",
        `${issue.platform || "Platform yok"} · ${issue.customer_name || issue.order_code} · ${issue.product_name}`,
        issue.order_code,
        "admin"
    );
    denetimKaydiOlustur(req, "issue.update", "issue", id, `${issue.order_code} sorun kaydı güncellendi`, {
        issueType,
        missingQuantity,
        note
    });
    res.json({ result: sorunKaydiniDonustur(row) });
});

app.patch("/issues/:id/resolve", (req, res) => {
    const id = Number(req.params.id);
    const issue = database.prepare(`SELECT * FROM order_product_issues WHERE id = ?`).get(id);

    if (!issue) {
        return res.status(404).json({ error: "Sorun kaydı bulunamadı." });
    }

    database.prepare(`
        UPDATE order_product_issues
        SET status = 'resolved', resolved_by_user_id = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(req.user.id, id);

    const row = database.prepare(`
        SELECT issues.*, creator.display_name AS created_by, resolver.display_name AS resolved_by
        FROM order_product_issues issues
        JOIN app_users creator ON creator.id = issues.created_by_user_id
        LEFT JOIN app_users resolver ON resolver.id = issues.resolved_by_user_id
        WHERE issues.id = ?
    `).get(id);

    bildirimOlustur(
        "issue_resolved",
        "Ürün sorunu çözüldü",
        `${issue.platform || "Platform yok"} · ${issue.customer_name || issue.order_code} · ${issue.product_name}`,
        issue.order_code,
        "all"
    );
    denetimKaydiOlustur(req, "issue.resolve", "issue", id, `${issue.order_code} sorun kaydı çözüldü`, {
        productName: issue.product_name
    });

    res.json({ result: sorunKaydiniDonustur(row) });
});

app.post("/preparations/start", (req, res) => {
    const orderCode = String(req.body.orderCode || "").trim();
    const customerName = String(req.body.customerName || "").trim().slice(0, 300);
    const platform = String(req.body.platform || "").trim().slice(0, 100);

    if (!orderCode) {
        return res.status(400).json({ error: "Sipariş kodu gerekli." });
    }

    let preparation = database.prepare(`
        SELECT * FROM order_preparations
        WHERE order_code = ? COLLATE NOCASE AND status = 'started'
        ORDER BY id DESC LIMIT 1
    `).get(orderCode);

    if (!preparation) {
        const result = database.prepare(`
            INSERT INTO order_preparations (
                order_code, customer_name, platform, started_by_user_id
            ) VALUES (?, ?, ?, ?)
        `).run(orderCode, customerName, platform, req.user.id);
        preparation = database.prepare(`SELECT * FROM order_preparations WHERE id = ?`).get(result.lastInsertRowid);
        denetimKaydiOlustur(req, "preparation.start", "order", orderCode, `${orderCode} hazırlanmaya başlandı`, {
            customerName,
            platform
        });
    } else if (!preparation.platform && platform) {
        database.prepare(`UPDATE order_preparations SET platform = ? WHERE id = ?`).run(platform, preparation.id);
        preparation.platform = platform;
    }

    res.json({ result: preparation });
});

app.post("/preparations/complete", (req, res) => {
    const orderCode = String(req.body.orderCode || "").trim();
    const customerName = String(req.body.customerName || "").trim().slice(0, 300);
    const platform = String(req.body.platform || "").trim().slice(0, 100);

    if (!orderCode) {
        return res.status(400).json({ error: "Sipariş kodu gerekli." });
    }

    let preparation = database.prepare(`
        SELECT * FROM order_preparations
        WHERE order_code = ? COLLATE NOCASE AND status = 'started'
        ORDER BY id DESC LIMIT 1
    `).get(orderCode);

    if (!preparation) {
        const result = database.prepare(`
            INSERT INTO order_preparations (
                order_code, customer_name, platform, started_by_user_id
            ) VALUES (?, ?, ?, ?)
        `).run(orderCode, customerName, platform, req.user.id);
        preparation = { id: result.lastInsertRowid };
    }

    database.prepare(`
        UPDATE order_preparations
        SET status = 'completed',
            platform = CASE WHEN platform = '' THEN ? ELSE platform END,
            completed_by_user_id = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(platform, req.user.id, preparation.id);

    bildirimOlustur(
        "order_completed",
        "Sipariş hazırlandı",
        `${platform || "Platform yok"} · ${customerName || orderCode} · ${req.user.display_name}`,
        orderCode,
        "admin"
    );
    denetimKaydiOlustur(req, "preparation.complete", "order", orderCode, `${orderCode} hazırlandı`, {
        customerName,
        platform
    });

    res.json({ result: { id: preparation.id, status: "completed" } });
});

function rafKaydiniDonustur(row) {
    return {
        productId: row.product_id || "",
        barcode: row.barcode,
        name: row.name,
        color: row.color,
        size: row.size,
        location: row.location_code,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

app.get("/locations", (req, res) => {
    const rows = database.prepare(`
        SELECT *
        FROM product_locations
        ORDER BY location_code, name, barcode
    `).all();

    res.json({ result: rows.map(rafKaydiniDonustur) });
});

app.put("/locations/:barcode", (req, res) => {
    const barcode = String(req.params.barcode || "").trim();
    const location = String(req.body.location || "").trim().toUpperCase();

    if (!barcode || barcode.length > 128) {
        return res.status(400).json({ error: "Gecerli bir barkod gerekli." });
    }

    if (!location || location.length > 64) {
        return res.status(400).json({ error: "Gecerli bir raf kodu gerekli." });
    }

    const productId = String(req.body.productId || "").trim().slice(0, 128);
    const name = String(req.body.name || "").trim().slice(0, 500);
    const color = String(req.body.color || "").trim().slice(0, 100);
    const size = String(req.body.size || "").trim().slice(0, 100);

    database.prepare(`
        INSERT INTO product_locations (
            barcode, product_id, name, color, size, location_code
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(barcode) DO UPDATE SET
            product_id = excluded.product_id,
            name = excluded.name,
            color = excluded.color,
            size = excluded.size,
            location_code = excluded.location_code,
            updated_at = CURRENT_TIMESTAMP
    `).run(barcode, productId, name, color, size, location);

    const row = database.prepare(`
        SELECT * FROM product_locations WHERE barcode = ? COLLATE NOCASE
    `).get(barcode);

    denetimKaydiOlustur(req, "location.save", "product", barcode, `${name || barcode} rafı ${location} olarak kaydedildi`, {
        productId,
        color,
        size,
        location
    });
    res.json({ result: rafKaydiniDonustur(row) });
});

app.delete("/locations/:barcode", (req, res) => {
    const barcode = String(req.params.barcode || "").trim();
    const previous = database.prepare(`
        SELECT * FROM product_locations WHERE barcode = ? COLLATE NOCASE
    `).get(barcode);
    const result = database.prepare(`
        DELETE FROM product_locations WHERE barcode = ? COLLATE NOCASE
    `).run(barcode);

    if (!result.changes) {
        return res.status(404).json({ error: "Raf kaydi bulunamadi." });
    }

    denetimKaydiOlustur(req, "location.delete", "product", barcode, `${previous?.name || barcode} raf ataması silindi`, {
        previousLocation: previous?.location_code || ""
    });
    res.status(204).end();
});

function sevkiyatKaydiniDonustur(row) {
    return {
        orderCode: row.order_code,
        customerName: row.customer_name,
        platform: row.platform,
        status: row.status,
        readyAt: row.ready_at,
        shippedAt: row.shipped_at,
        updatedAt: row.updated_at
    };
}

app.get("/shipments", (req, res) => {
    const rows = database.prepare(`
        SELECT * FROM order_shipments ORDER BY updated_at DESC
    `).all();
    res.json({ result: rows.map(sevkiyatKaydiniDonustur) });
});

app.put("/shipments/:orderCode", (req, res) => {
    const orderCode = String(req.params.orderCode || "").trim();
    const status = String(req.body.status || "").trim();

    if (!orderCode || orderCode.length > 128) {
        return res.status(400).json({ error: "Gecerli bir siparis kodu gerekli." });
    }

    if (!["pending", "ready", "shipped"].includes(status)) {
        return res.status(400).json({ error: "Gecersiz sevkiyat durumu." });
    }

    const previousShipment = database.prepare(`
        SELECT status FROM order_shipments WHERE order_code = ? COLLATE NOCASE
    `).get(orderCode);

    if (status === "shipped") {
        const existingShipment = database.prepare(`
            SELECT status FROM order_shipments
            WHERE order_code = ? COLLATE NOCASE
        `).get(orderCode);

        if (!existingShipment) {
            return res.status(409).json({
                error: "Bu siparis henuz hazirlanmamis. Once urun barkodlarini dogrulayin."
            });
        }

        if (existingShipment.status === "shipped") {
            return res.status(409).json({
                error: "Bu siparis daha once kargoya verildi."
            });
        }

        if (existingShipment.status !== "ready") {
            return res.status(409).json({
                error: "Siparis eksikte bekliyor. Eksik urunler tamamlanmadan kargoya verilemez."
            });
        }

        const openIssue = database.prepare(`
            SELECT id FROM order_product_issues
            WHERE order_code = ? COLLATE NOCASE AND status = 'open'
            LIMIT 1
        `).get(orderCode);

        if (openIssue) {
            return res.status(409).json({
                error: "Sipariste acik eksik veya sorun kaydi var. Sorun cozulmeden kargoya verilemez."
            });
        }
    }

    const customerName = String(req.body.customerName || "").trim().slice(0, 300);
    const platform = String(req.body.platform || "").trim().slice(0, 100);

    database.prepare(`
        INSERT INTO order_shipments (
            order_code, customer_name, platform, status, ready_at, shipped_at
        ) VALUES (
            ?, ?, ?, ?,
            CASE WHEN ? = 'ready' THEN CURRENT_TIMESTAMP ELSE NULL END,
            CASE WHEN ? = 'shipped' THEN CURRENT_TIMESTAMP ELSE NULL END
        )
        ON CONFLICT(order_code) DO UPDATE SET
            customer_name = excluded.customer_name,
            platform = excluded.platform,
            status = excluded.status,
            ready_at = CASE
                WHEN excluded.status = 'ready' THEN COALESCE(order_shipments.ready_at, CURRENT_TIMESTAMP)
                ELSE order_shipments.ready_at
            END,
            shipped_at = CASE
                WHEN excluded.status = 'shipped' THEN CURRENT_TIMESTAMP
                ELSE NULL
            END,
            updated_at = CURRENT_TIMESTAMP
    `).run(orderCode, customerName, platform, status, status, status);

    const row = database.prepare(`
        SELECT * FROM order_shipments WHERE order_code = ? COLLATE NOCASE
    `).get(orderCode);
    const shipmentActions = {
        pending: "shipment.pending",
        ready: previousShipment?.status === "shipped" ? "shipment.undo" : "shipment.ready",
        shipped: "shipment.shipped"
    };
    denetimKaydiOlustur(req, shipmentActions[status], "order", orderCode, `${orderCode} sevkiyat durumu ${status} olarak değiştirildi`, {
        previousStatus: previousShipment?.status || "",
        status,
        customerName,
        platform
    });
    res.json({ result: sevkiyatKaydiniDonustur(row) });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Zoom Depo Pro calisiyor: http://0.0.0.0:${port}`);
});
