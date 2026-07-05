const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const port = 32000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zoom-depo-test-"));
let server;

async function waitForServer() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            const response = await fetch(`${baseUrl}/health`);
            if (response.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Test sunucusu başlatılamadı.");
}

async function request(url, options = {}, cookie = "") {
    const response = await fetch(`${baseUrl}${url}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    return {
        response,
        data: text ? JSON.parse(text) : null,
        cookie: response.headers.get("set-cookie")?.split(";")[0] || ""
    };
}

async function login(username, password) {
    const result = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
    });
    assert.equal(result.response.status, 200);
    return result.cookie;
}

test.before(async () => {
    const seedDb = new DatabaseSync(path.join(dataDir, "locations.db"));
    seedDb.exec(`
        CREATE TABLE order_api_cache (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            signature TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    seedDb.prepare(`
        INSERT INTO order_api_cache (id, signature, payload_json)
        VALUES (1, ?, ?)
    `).run("cached-signature", JSON.stringify({
        code: 200,
        signature: "cached-signature",
        result: {
            total: 1,
            pageSize: 1,
            list: [{ order: { code: "CACHED-ORDER", platform: "Zoombutik" }, products: [] }]
        }
    }));
    seedDb.close();
    server = spawn(process.execPath, ["server.js"], {
        cwd: path.join(__dirname, ".."),
        env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            DATA_DIR: dataDir,
            APP_USERNAME: "testadmin",
            APP_PASSWORD: "TestPassword123!",
            PREPARATION_LOCK_MINUTES: "0.02",
            API_URL: "http://127.0.0.1:9",
            API_KEY: "test",
            API_SECRET: "test"
        },
        stdio: "ignore"
    });
    await waitForServer();
});

test("Qukasoft kesintisinde son başarılı sipariş önbelleği gösterilir", async () => {
    const adminCookie = await login("testadmin", "TestPassword123!");
    const orders = await request("/orders", {}, adminCookie);
    assert.equal(orders.response.status, 200);
    assert.equal(orders.data.stale, true);
    assert.equal(orders.data.result.list[0].order.code, "CACHED-ORDER");

    const location = await request("/locations/4422548804418", {
        method: "PUT",
        body: JSON.stringify({
            name: "Test Elbise",
            code: "TEST-01",
            color: "Siyah",
            size: "M",
            location: "23-B"
        })
    }, adminCookie);
    assert.equal(location.response.status, 200);

    const completed = await request("/preparations/complete", {
        method: "POST",
        body: JSON.stringify({
            orderCode: "CACHED-ORDER",
            customerName: "Test Müşteri",
            platform: "Zoombutik",
            orderSnapshot: {
                orderCode: "CACHED-ORDER",
                customerName: "Test Müşteri",
                platform: "Zoombutik",
                phone: "5551112233",
                delivery: { address: "Test Mahallesi 1", district: "Kadıköy", city: "İstanbul" },
                shipmentCode: "TEST-SHIPMENT-1",
                products: [{
                    barcode: "4422548804418",
                    name: "Test Elbise",
                    color: "Siyah",
                    size: "M",
                    quantity: 1
                }]
            },
            scans: []
        })
    }, adminCookie);
    assert.equal(completed.response.status, 200);

    const refreshedOrders = await request("/orders", {}, adminCookie);
    assert.equal(refreshedOrders.data.result.list[0].localPreparationStatus, "completed");

    const queue = await request("/admin/print-jobs", {}, adminCookie);
    assert.equal(queue.response.status, 200);
    assert.equal(queue.data.result[0].payload.products[0].name, "Test Elbise");
    assert.equal(queue.data.result[0].payload.delivery.city, "İstanbul");
    assert.equal(queue.data.result[0].payload.products[0].location, "23-B");

    const tokenResult = await request("/admin/print-agent/token", {
        method: "POST",
        body: "{}"
    }, adminCookie);
    assert.equal(tokenResult.response.status, 201);

    const agentHeaders = {
        Authorization: `Bearer ${tokenResult.data.token}`,
        "X-Agent-Name": "TEST-ZEBRA"
    };
    const nextJob = await request("/print-agent/jobs/next", { headers: agentHeaders });
    assert.equal(nextJob.response.status, 200);
    assert.equal(nextJob.data.result.orderCode, "CACHED-ORDER");

    const printed = await request(`/print-agent/jobs/${nextJob.data.result.id}/result`, {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({ success: true })
    });
    assert.equal(printed.response.status, 200);
    assert.equal(printed.data.status, "printed");

    const undone = await request("/admin/preparations/CACHED-ORDER/undo", {
        method: "POST"
    }, adminCookie);
    assert.equal(undone.response.status, 200);
    assert.equal(undone.data.result.preparationsDeleted, 1);
    assert.equal(undone.data.result.printJobsDeleted, 1);

    const reopenedOrders = await request("/orders", {}, adminCookie);
    assert.notEqual(reopenedOrders.data.result.list[0].localPreparationStatus, "completed");

    const refreshedQueue = await request("/admin/print-jobs", {}, adminCookie);
    assert.equal(refreshedQueue.data.result.some(item => item.orderCode === "CACHED-ORDER"), false);
});

test("sipariş yalnızca yerel kargo çıkışından sonra aktif listeden kalkar", async () => {
    const adminCookie = await login("testadmin", "TestPassword123!");
    const completed = await request("/preparations/complete", {
        method: "POST",
        body: JSON.stringify({
            orderCode: "CACHED-ORDER",
            customerName: "Test Müşteri",
            platform: "Zoombutik",
            orderSnapshot: { orderCode: "CACHED-ORDER", products: [] },
            scans: []
        })
    }, adminCookie);
    assert.equal(completed.response.status, 200);

    const ready = await request("/shipments/CACHED-ORDER", {
        method: "PUT",
        body: JSON.stringify({
            status: "ready",
            customerName: "Test Müşteri",
            platform: "Zoombutik"
        })
    }, adminCookie);
    assert.equal(ready.response.status, 200);

    const beforeShipmentScan = await request("/orders", {}, adminCookie);
    assert.equal(beforeShipmentScan.data.result.list.some(item => item.order.code === "CACHED-ORDER"), true);

    const shipped = await request("/shipments/CACHED-ORDER", {
        method: "PUT",
        body: JSON.stringify({
            status: "shipped",
            customerName: "Test Müşteri",
            platform: "Zoombutik"
        })
    }, adminCookie);
    assert.equal(shipped.response.status, 200);

    const afterShipmentScan = await request("/orders", {}, adminCookie);
    assert.equal(afterShipmentScan.data.result.list.some(item => item.order.code === "CACHED-ORDER"), false);
});

test.after(async () => {
    if (server && server.exitCode === null) {
        const exited = new Promise(resolve => server.once("exit", resolve));
        server.kill();
        await exited;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            fs.rmSync(dataDir, { recursive: true, force: true });
            break;
        } catch (err) {
            if (attempt === 4) throw err;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
});

test("sipariş kilidi başka personeli engeller ve yönetici kaldırabilir", async () => {
    const adminCookie = await login("testadmin", "TestPassword123!");
    const createWorker = await request("/admin/users", {
        method: "POST",
        body: JSON.stringify({
            username: "worker1",
            displayName: "Test Personel",
            password: "WorkerPassword123!",
            role: "worker"
        })
    }, adminCookie);
    assert.equal(createWorker.response.status, 201);
    const workerCookie = await login("worker1", "WorkerPassword123!");
    const payload = {
        orderCode: "LOCK-100",
        customerName: "Test Müşteri",
        platform: "Zoombutik",
        orderSnapshot: { products: [{ barcode: "123", quantity: 1 }] }
    };

    const started = await request("/preparations/start", {
        method: "POST",
        body: JSON.stringify(payload)
    }, adminCookie);
    assert.equal(started.response.status, 200);

    const blocked = await request("/preparations/start", {
        method: "POST",
        body: JSON.stringify(payload)
    }, workerCookie);
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.data.code, "ORDER_LOCKED");

    const unlocked = await request("/preparations/LOCK-100/lock", { method: "DELETE" }, adminCookie);
    assert.equal(unlocked.response.status, 204);

    const workerStarted = await request("/preparations/start", {
        method: "POST",
        body: JSON.stringify(payload)
    }, workerCookie);
    assert.equal(workerStarted.response.status, 200);
    assert.equal(workerStarted.data.result.lockedByCurrentUser, true);
});

test("heartbeat kilidi uzatır, okutma kanıtı tamamlamada saklanır", async () => {
    const workerCookie = await login("worker1", "WorkerPassword123!");
    const heartbeat = await request("/preparations/heartbeat", {
        method: "POST",
        body: JSON.stringify({ orderCode: "LOCK-100" })
    }, workerCookie);
    assert.equal(heartbeat.response.status, 200);
    assert.ok(heartbeat.data.result.lockExpiresAt);

    const complete = await request("/preparations/complete", {
        method: "POST",
        body: JSON.stringify({
            orderCode: "LOCK-100",
            customerName: "Test Müşteri",
            platform: "Zoombutik",
            orderSnapshot: { products: [{ barcode: "123", quantity: 1 }] },
            scans: [{ barcode: "123", productName: "Test Ürün", quantityIndex: 1, source: "manual" }]
        })
    }, workerCookie);
    assert.equal(complete.response.status, 200);

    const evidence = await request(`/preparations/${complete.data.result.id}/evidence`, {}, workerCookie);
    assert.equal(evidence.response.status, 200);
    assert.equal(evidence.data.result.scans.length, 1);
    assert.equal(evidence.data.result.scans[0].barcode, "123");
    assert.equal(evidence.data.result.scans[0].source, "manual");
});

test("süresi dolan hazırlama kilidi otomatik kaldırılır", async () => {
    const adminCookie = await login("testadmin", "TestPassword123!");
    const workerCookie = await login("worker1", "WorkerPassword123!");
    const payload = {
        orderCode: "TIMEOUT-100",
        customerName: "Zaman Aşımı",
        platform: "Zoombutik",
        orderSnapshot: { products: [] }
    };
    const started = await request("/preparations/start", {
        method: "POST",
        body: JSON.stringify(payload)
    }, adminCookie);
    assert.equal(started.response.status, 200);
    await new Promise(resolve => setTimeout(resolve, 1400));
    const reopened = await request("/preparations/start", {
        method: "POST",
        body: JSON.stringify(payload)
    }, workerCookie);
    assert.equal(reopened.response.status, 200);
    assert.equal(reopened.data.result.lockedByCurrentUser, true);
});

test("yapılandırılmamış harici depoya fotoğraf yazılmaz", async () => {
    const adminCookie = await login("testadmin", "TestPassword123!");
    const payload = {
        orderCode: "PHOTO-100",
        customerName: "Foto Test",
        platform: "Trendyol",
        orderSnapshot: { products: [] }
    };
    await request("/preparations/start", {
        method: "POST",
        body: JSON.stringify(payload)
    }, adminCookie);
    const complete = await request("/preparations/complete", {
        method: "POST",
        body: JSON.stringify({
            ...payload,
            proofImage: "data:image/png;base64,aGVsbG8="
        })
    }, adminCookie);
    assert.equal(complete.response.status, 503);
});

test("geçmiş temizleme tamamlanan kayıtları siler, açık kilitleri korur", async () => {
    const adminCookie = await login("testadmin", "TestPassword123!");
    const activePayload = {
        orderCode: "KEEP-100",
        customerName: "Açık Kayıt",
        platform: "Trendyol",
        orderSnapshot: { products: [] }
    };
    const active = await request("/preparations/start", {
        method: "POST",
        body: JSON.stringify(activePayload)
    }, adminCookie);
    assert.equal(active.response.status, 200);
    const cleared = await request("/admin/history", {
        method: "DELETE",
        body: JSON.stringify({ mode: "preparations", confirmation: "TEMIZLE" })
    }, adminCookie);
    assert.equal(cleared.response.status, 200);
    assert.ok(cleared.data.result.preparationsDeleted >= 1);

    const board = await request("/operations/board", {}, adminCookie);
    assert.equal(board.response.status, 200);
    assert.ok(board.data.result.active.some(item => item.orderCode === "KEEP-100"));
});

test("kargo etiketi baskı adedi ve personeli kalıcı kaydedilir", async () => {
    const adminCookie = await login("testadmin", "TestPassword123!");
    for (let index = 0; index < 2; index += 1) {
        const saved = await request("/label-prints", {
            method: "POST",
            body: JSON.stringify({ orderCodes: ["LABEL-100"] })
        }, adminCookie);
        assert.equal(saved.response.status, 200);
    }
    const history = await request("/label-prints", {}, adminCookie);
    assert.equal(history.response.status, 200);
    const record = history.data.result.find(item => item.orderCode === "LABEL-100");
    assert.equal(record.printCount, 2);
    assert.equal(record.lastPrintedBy, "Zoom Yönetici");
});

test("ürün kataloğu isim ve barkodla hızlı aranır", async () => {
    const adminCookie = await login("testadmin", "TestPassword123!");
    const db = new DatabaseSync(path.join(dataDir, "locations.db"));
    db.prepare(`
        INSERT OR REPLACE INTO product_catalog_meta (id, product_count, variant_count)
        VALUES (1, 1, 1)
    `).run();
    db.prepare(`
        INSERT OR REPLACE INTO product_search_catalog
            (barcode, product_id, name, product_code, color, size, search_text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("4422548804418", "20091", "Boyun Bağlamalı Güpürlü Elbise - KAHVE", "MODEL-KORSE-01", "Kahve", "L",
        "boyun bağlamalı güpürlü elbise kahve 4422548804418 l");
    db.prepare(`
        INSERT OR REPLACE INTO product_search_catalog
            (barcode, product_id, name, product_code, color, size, search_text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("4422548804425", "20091", "Boyun Bağlamalı Güpürlü Elbise - KAHVE", "MODEL-KORSE-01", "Kahve", "M",
        "boyun bağlamalı güpürlü elbise kahve 4422548804425 m");
    db.prepare(`
        INSERT OR REPLACE INTO product_search_catalog
            (barcode, product_id, name, product_code, color, size, search_text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("4422548804432", "DIFFERENT-201", "Aynı Model Ayrı Ürün Kaydı", "MODEL-KORSE-01", "Siyah", "S",
        "aynı model ayrı ürün kaydı siyah 4422548804432 s");
    db.close();

    const byName = await request("/products/search?q=boyun%20bağlamalı", {}, adminCookie);
    assert.equal(byName.response.status, 200);
    assert.equal(byName.data.result[0].size, "L");
    assert.equal(byName.data.result[0].code, "MODEL-KORSE-01");
    assert.equal(byName.data.result[0].imageUrl, "/product-image/20091");

    const byBarcode = await request("/products/search?barcode=4422548804418", {}, adminCookie);
    assert.equal(byBarcode.response.status, 200);
    assert.equal(byBarcode.data.result[0].productId, "20091");

    const updatedBarcode = await request("/admin/product-barcodes/4422548804418", {
        method: "PUT",
        body: JSON.stringify({ barcode: "4422548804999" })
    }, adminCookie);
    assert.equal(updatedBarcode.response.status, 200);
    assert.equal(updatedBarcode.data.result.barcode, "4422548804999");

    const byUpdatedBarcode = await request("/products/search?barcode=4422548804999", {}, adminCookie);
    assert.equal(byUpdatedBarcode.response.status, 200);
    assert.equal(byUpdatedBarcode.data.result[0].originalBarcode, "4422548804418");
    assert.equal(byUpdatedBarcode.data.result[0].barcode, "4422548804999");

    const locations = await request("/locations", {}, adminCookie);
    assert.ok(locations.data.result.some(item =>
        item.barcode === "4422548804999" && item.location === "23-B"
    ));

    const sharedBarcode = await request("/admin/product-barcodes/4422548804425", {
        method: "PUT",
        body: JSON.stringify({ barcode: "4422548804999" })
    }, adminCookie);
    assert.equal(sharedBarcode.response.status, 200);

    const sharedResults = await request("/products/search?barcode=4422548804999", {}, adminCookie);
    assert.equal(sharedResults.response.status, 200);
    assert.equal(sharedResults.data.result.length, 2);
    assert.deepEqual(
        sharedResults.data.result.map(item => item.size).sort(),
        ["L", "M"]
    );

    const crossProductSharedBarcode = await request("/admin/product-barcodes/4422548804432", {
        method: "PUT",
        body: JSON.stringify({ barcode: "4422548804999" })
    }, adminCookie);
    assert.equal(crossProductSharedBarcode.response.status, 200);

    const crossProductResults = await request("/products/search?barcode=4422548804999", {}, adminCookie);
    assert.equal(crossProductResults.response.status, 200);
    assert.equal(crossProductResults.data.result.length, 3);
});
