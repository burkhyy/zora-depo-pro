const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
    server = spawn(process.execPath, ["server.js"], {
        cwd: path.join(__dirname, ".."),
        env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            DATA_DIR: dataDir,
            APP_USERNAME: "testadmin",
            APP_PASSWORD: "TestPassword123!",
            PREPARATION_LOCK_MINUTES: "0.02"
        },
        stdio: "ignore"
    });
    await waitForServer();
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
            scans: [{ barcode: "123", productName: "Test Ürün", quantityIndex: 1 }]
        })
    }, workerCookie);
    assert.equal(complete.response.status, 200);

    const evidence = await request(`/preparations/${complete.data.result.id}/evidence`, {}, workerCookie);
    assert.equal(evidence.response.status, 200);
    assert.equal(evidence.data.result.scans.length, 1);
    assert.equal(evidence.data.result.scans[0].barcode, "123");
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
