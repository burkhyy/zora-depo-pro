require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

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

const database = new DatabaseSync(path.join(dataDirectory, "locations.db"));
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
        product_index INTEGER NOT NULL,
        product_name TEXT NOT NULL DEFAULT '',
        barcode TEXT NOT NULL DEFAULT '',
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
`);

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
        `).run(appUsername, "Zora Yönetici", password.hash, password.salt);
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
    const token = cookieDegeriniOku(req, "zora_session");

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
        `zora_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`
    );
    res.json({ user: kullaniciyiDonustur(user) });
});

app.post("/auth/logout", (req, res) => {
    const token = cookieDegeriniOku(req, "zora_session");

    if (token) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        database.prepare(`DELETE FROM app_sessions WHERE token_hash = ?`).run(tokenHash);
    }

    res.setHeader("Set-Cookie", "zora_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    res.status(204).end();
});

app.get("/auth/me", oturumGerekli, (req, res) => {
    res.json({ user: kullaniciyiDonustur(req.user) });
});

app.use((req, res, next) => {
    if (req.path === "/" || req.path.includes(".")) {
        return next();
    }

    oturumGerekli(req, res, next);
});

const API = axios.create({
    baseURL: process.env.API_URL,
    headers: {
        apikey: process.env.API_KEY,
        apisecret: process.env.API_SECRET
    }
});

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

async function urunListesiniGetir() {
    const pageSize = Number(process.env.PRODUCT_PAGE_SIZE || 500);
    const endpoints = [
        `/product/lists?pageStart=0&pageSize=${pageSize}&orderBy=id&sort=desc`,
        `/product/listsV2?pageStart=0&pageSize=${pageSize}&orderBy=id&sort=desc`,
        `/product/list?pageStart=0&pageSize=${pageSize}&orderBy=id&sort=desc`
    ];

    let sonHata = null;

    for (const endpoint of endpoints) {
        try {
            const response = await API.get(endpoint);
            const list = listeyiBul(response.data);

            return {
                source: endpoint,
                count: list.length,
                result: { list },
                raw: response.data
            };
        } catch (err) {
            sonHata = err;

            if (!err.response || ![404, 405].includes(err.response.status)) {
                throw err;
            }
        }
    }

    throw sonHata;
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
        const response = await API.get(
            "/order/listsV2?pageStart=0&pageSize=200&orderBy=id&sort=desc"
        );

        res.json(response.data);
    } catch (err) {
        apiHatasiGonder(err, res);
    }
});

app.get("/order/:code", async (req, res) => {
    try {
        const response = await API.get(
            "/order/listsV2?pageStart=0&pageSize=200&orderBy=id&sort=desc"
        );

        const siparis = response.data.result.list.find(
            item => item.order.code === req.params.code
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
        res.status(201).json({ result: kullaniciyiDonustur(user) });
    } catch (err) {
        if (String(err.message).includes("UNIQUE")) {
            return res.status(409).json({ error: "Bu kullanıcı adı zaten kullanılıyor." });
        }
        throw err;
    }
});

app.get("/admin/preparations", yoneticiGerekli, (req, res) => {
    const rows = database.prepare(`
        SELECT
            preparations.id,
            preparations.order_code,
            preparations.customer_name,
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

    res.json({
        result: rows.map(row => ({
            id: row.id,
            orderCode: row.order_code,
            customerName: row.customer_name,
            status: row.status,
            startedBy: row.started_by,
            startedByUserId: row.started_by_user_id,
            completedBy: row.completed_by || "",
            completedByUserId: row.completed_by_user_id,
            startedAt: row.started_at,
            completedAt: row.completed_at
        }))
    });
});

function sorunKaydiniDonustur(row) {
    return {
        id: row.id,
        orderCode: row.order_code,
        customerName: row.customer_name,
        productIndex: row.product_index,
        productName: row.product_name,
        barcode: row.barcode,
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
    const productIndex = Number(req.body.productIndex);
    const productName = String(req.body.productName || "").trim().slice(0, 500);
    const barcode = String(req.body.barcode || "").trim().slice(0, 120);
    const issueType = String(req.body.issueType || "").trim();
    const note = String(req.body.note || "").trim().slice(0, 1000);

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
            order_code, customer_name, product_index, product_name, barcode,
            issue_type, note, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderCode, customerName, productIndex, productName, barcode, issueType, note, req.user.id);

    const row = database.prepare(`
        SELECT issues.*, creator.display_name AS created_by, NULL AS resolved_by
        FROM order_product_issues issues
        JOIN app_users creator ON creator.id = issues.created_by_user_id
        WHERE issues.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ result: sorunKaydiniDonustur(row) });
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

    res.json({ result: sorunKaydiniDonustur(row) });
});

app.post("/preparations/start", (req, res) => {
    const orderCode = String(req.body.orderCode || "").trim();
    const customerName = String(req.body.customerName || "").trim().slice(0, 300);

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
                order_code, customer_name, started_by_user_id
            ) VALUES (?, ?, ?)
        `).run(orderCode, customerName, req.user.id);
        preparation = database.prepare(`SELECT * FROM order_preparations WHERE id = ?`).get(result.lastInsertRowid);
    }

    res.json({ result: preparation });
});

app.post("/preparations/complete", (req, res) => {
    const orderCode = String(req.body.orderCode || "").trim();
    const customerName = String(req.body.customerName || "").trim().slice(0, 300);

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
                order_code, customer_name, started_by_user_id
            ) VALUES (?, ?, ?)
        `).run(orderCode, customerName, req.user.id);
        preparation = { id: result.lastInsertRowid };
    }

    database.prepare(`
        UPDATE order_preparations
        SET status = 'completed',
            completed_by_user_id = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(req.user.id, preparation.id);

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

    res.json({ result: rafKaydiniDonustur(row) });
});

app.delete("/locations/:barcode", (req, res) => {
    const barcode = String(req.params.barcode || "").trim();
    const result = database.prepare(`
        DELETE FROM product_locations WHERE barcode = ? COLLATE NOCASE
    `).run(barcode);

    if (!result.changes) {
        return res.status(404).json({ error: "Raf kaydi bulunamadi." });
    }

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
                WHEN excluded.status = 'pending' THEN NULL
                ELSE order_shipments.shipped_at
            END,
            updated_at = CURRENT_TIMESTAMP
    `).run(orderCode, customerName, platform, status, status, status);

    const row = database.prepare(`
        SELECT * FROM order_shipments WHERE order_code = ? COLLATE NOCASE
    `).get(orderCode);
    res.json({ result: sevkiyatKaydiniDonustur(row) });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Zora Depo Pro calisiyor: http://0.0.0.0:${port}`);
});
