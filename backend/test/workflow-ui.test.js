const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function section(from, to) { return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from))); }
function setup(count, fetch) {
    const orders = Array.from({ length: count }, (_, i) => ({ code: `TEST-${i}`, localWorkflowStage: 'new' }));
    const context = vm.createContext({
        siparisler: orders, aktifListe: orders, aktifSiparis: { ...orders[0] }, aktifTopluSiparisler: [],
        secilenSiparisKodlari: new Set(orders.map(o => o.code)), siparisAsamasiDegisiyor: false,
        siparisAsamasiSurumu: 0, siparisYenileniyor: false, aktifKullanici: {}, aktifSekme: 'orders',
        siparisKodu: o => o.code, siparisKodunuNormalizeEt: c => String(c || '').trim().toUpperCase(),
        listeGoster: () => {}, document: { hidden: false, body: { classList: { contains: () => false } } },
        sadeceZoomSiparisleri: list => list, searchInput: { dispatchEvent() {} }, Event: class {},
        console, fetch
    });
    vm.runInContext(section('async function siparisAsamasiniGuncelle(', 'async function siparisleriKargolananlaraAl(')
        + section('async function siparisleriSessizYenile()', 'document.addEventListener("visibilitychange"'), context);
    return context;
}
const ok = body => ({ ok: true, json: async () => ({ result: { orderCodes: body.orderCodes, stage: body.stage } }) });

test('Toplu tasima 250 siparisin tamamini sunucu limitine uygun kaydeder', async () => {
    const batches = [];
    const c = setup(250, async (_, options) => { const body = JSON.parse(options.body); batches.push(body.orderCodes.length); return ok(body); });
    await c.siparisAsamasiniGuncelle([c.aktifSiparis, ...c.siparisler.slice(1)], 'preparing');
    assert.deepEqual(batches, [100, 100, 50]);
    assert.ok(c.siparisler.every(o => o.localWorkflowStage === 'preparing'));
    assert.equal(c.secilenSiparisKodlari.size, 0);
});

test('Kismi hata kalan secimleri korur ve kaydedilmeyenleri tasinmis gostermez', async () => {
    let calls = 0;
    const c = setup(150, async (_, options) => ++calls === 1 ? ok(JSON.parse(options.body))
        : { ok: false, json: async () => ({ error: 'Baglanti hatasi' }) });
    await assert.rejects(c.siparisAsamasiniGuncelle(c.siparisler, 'preparing'), /100 \/ 150/);
    assert.equal(c.secilenSiparisKodlari.size, 50);
    assert.equal(c.siparisler.filter(o => o.localWorkflowStage === 'preparing').length, 100);
    assert.equal(c.siparisAsamasiDegisiyor, false);
});

test('Tasima oncesi baslayan gecikmis yenileme kaydedilen asamayi geri alamaz', async () => {
    let release;
    const c = setup(1, async (url, options) => url === '/orders' ? new Promise(resolve => { release = resolve; }) : ok(JSON.parse(options.body)));
    const refresh = c.siparisleriSessizYenile();
    await c.siparisAsamasiniGuncelle([c.aktifSiparis], 'preparing');
    release({ ok: true, json: async () => ({ result: { list: [{ code: 'TEST-0', localWorkflowStage: 'new' }] } }) });
    await refresh;
    assert.equal(c.siparisler[0].localWorkflowStage, 'preparing');
    assert.equal(c.siparisYenileniyor, false);
});
