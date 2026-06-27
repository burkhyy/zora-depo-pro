require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
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

function sabitZamanliEsit(a, b) {
    const aBuffer = Buffer.from(String(a));
    const bBuffer = Buffer.from(String(b));

    if (aBuffer.length !== bBuffer.length) {
        return false;
    }

    return require("crypto").timingSafeEqual(aBuffer, bBuffer);
}

function uygulamaKimlikDogrulama(req, res, next) {
    if (!appUsername || !appPassword) {
        return next();
    }

    const authorization = req.headers.authorization || "";
    const encoded = authorization.startsWith("Basic ") ? authorization.slice(6) : "";
    let username = "";
    let password = "";

    try {
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        const separator = decoded.indexOf(":");
        username = separator >= 0 ? decoded.slice(0, separator) : "";
        password = separator >= 0 ? decoded.slice(separator + 1) : "";
    } catch {
        // Invalid credentials fall through to the challenge.
    }

    if (sabitZamanliEsit(username, appUsername) && sabitZamanliEsit(password, appPassword)) {
        return next();
    }

    res.set("WWW-Authenticate", 'Basic realm="Zora Depo Pro", charset="UTF-8"');
    return res.status(401).send("Yetkilendirme gerekli.");
}

app.use(uygulamaKimlikDogrulama);
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
