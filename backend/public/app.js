let siparisler = [];
let aktifListe = [];
let aktifSiparis = null;
let taramaDurumu = {};
let sonOkunanBarkod = "";
let sonOkumaZamani = 0;
let scanner = null;
let scannerAktif = false;
let aktifSekme = "orders";
let aktifTaramaModu = "order";
let apiUrunleri = null;
let apiUrunleriPromise = null;
let rafKayitListesi = [];
let rafKayitlariPromise = null;
let sevkiyatKayitlari = [];
const apiUrunDetayCache = new Map();

const HIZMET_BARKODLARI = ["HZMBDL"];
const OKUMA_BEKLEME_MS = 900;

const durumlar = {
    1: "Yeni Sipariş",
    2: "Hazırlanıyor",
    3: "Kargolandı",
    4: "Teslim Edildi",
    5: "İade",
    6: "İptal"
};

const searchInput = document.getElementById("search");
const result = document.getElementById("result");
const tabButtons = document.querySelectorAll("[data-tab]");

function temizle(deger) {
    return String(deger ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function alanOku(kaynak, alanlar, varsayilan = "-") {
    for (const alan of alanlar) {
        const deger = alan.split(".").reduce((nesne, parca) => {
            return nesne && nesne[parca] !== undefined ? nesne[parca] : undefined;
        }, kaynak);

        if (deger !== undefined && deger !== null && deger !== "") {
            return deger;
        }
    }

    return varsayilan;
}

function musteriAdi(item) {
    return alanOku(item, ["customer.name", "customer.fullName", "customerName"]);
}

function siparisKodu(item) {
    return alanOku(item, ["order.code", "code", "orderCode"]);
}

function platformAdi(item) {
    return alanOku(item, ["order.platform", "platform"]);
}

function siparisDurumu(item) {
    const durum = alanOku(item, ["order.status", "status"], "");
    return durumlar[durum] || durum || "-";
}

function toplamTutar(item) {
    const tutar = alanOku(item, [
        "order.total",
        "order.totalPrice",
        "order.grandTotal",
        "order.amount",
        "order.price",
        "total",
        "totalPrice",
        "grandTotal",
        "amount"
    ]);

    if (tutar === "-") {
        return tutar;
    }

    const sayi = Number(String(tutar).replace(",", "."));

    if (Number.isFinite(sayi)) {
        return new Intl.NumberFormat("tr-TR", {
            style: "currency",
            currency: "TRY"
        }).format(sayi);
    }

    return tutar;
}

function urunAdi(urun) {
    return alanOku(urun, [
        "name",
        "productName",
        "title",
        "product.name",
        "product.title",
        "stock.name",
        "parent.name",
        "parent.productName",
        "parent.title"
    ]);
}

function urunBarkodu(urun) {
    return alanOku(urun, [
        "barcode",
        "barCode"
    ]);
}

function urunRengi(urun) {
    const alanRengi = alanOku(urun, [
        "color",
        "colour",
        "variant.color",
        "product.color",
        "stock.color",
        "option.color",
        "colorName",
        "renk",
        "parent.color",
        "parent.colorName"
    ], "");

    return alanRengi || urunAdindanRenkParseEt(urunAdi(urun));
}

function urunAdindanRenkParseEt(ad) {
    const parcalar = String(ad || "").split(" - ");
    const renk = parcalar.length > 1 ? parcalar[parcalar.length - 1].trim() : "";

    return renk || "-";
}

function urunBedeni(urun) {
    const dogrudanBeden = alanOku(urun, [
        "size",
        "variant.size",
        "product.size",
        "stock.size",
        "option.size",
        "variantName",
        "optionName",
        "parent.size"
    ], "");

    if (dogrudanBeden) {
        return dogrudanBeden;
    }

    const varyantAlanlari = [
        ["variant1Name", "value1"],
        ["variant2Name", "value2"],
        ["variant3Name", "value3"]
    ];

    for (const [adAlani, degerAlani] of varyantAlanlari) {
        const varyantAdi = alanOku(urun, [adAlani, `parent.${adAlani}`], "");

        if (aramaNormalize(varyantAdi).includes("beden")) {
            const deger = alanOku(urun, [
                degerAlani,
                `variant.${degerAlani}`,
                `stock.${degerAlani}`
            ], "");

            if (deger) {
                return deger;
            }
        }
    }

    return "-";
}

function urunAdedi(urun) {
    const adet = alanOku(urun, [
        "quantity",
        "qty",
        "amount",
        "count",
        "piece",
        "pieceCount"
    ], 1);

    const sayi = Number(adet);
    return Number.isFinite(sayi) && sayi > 0 ? sayi : 1;
}

function barkodNormalize(barkod) {
    return String(barkod ?? "").trim();
}

function barkodKarsilastir(barkod) {
    return barkodNormalize(barkod).toUpperCase();
}

function aramaNormalize(deger) {
    return String(deger ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .replace(/[^a-z0-9]/g, "");
}

function depoYerKodu(urun) {
    const dogrudanDeger = alanOku(urun, [
        "warehouseCode",
        "depotCode",
        "warehouseLocation",
        "locationCode",
        "depoYerKodu",
        "depo_yer_kodu",
        "storageLocation",
        "storageCode",
        "shelfCode",
        "shelfLocation",
        "rafKodu",
        "raf",
        "location",
        "variant.warehouseCode",
        "variant.depotCode",
        "variant.warehouseLocation",
        "variant.locationCode",
        "variant.depoYerKodu",
        "variant.storageLocation",
        "product.warehouseCode",
        "product.depotCode",
        "product.warehouseLocation",
        "product.locationCode",
        "product.depoYerKodu",
        "product.storageLocation",
        "stock.warehouseCode",
        "stock.depotCode",
        "stock.warehouseLocation",
        "stock.locationCode",
        "stock.depoYerKodu",
        "stock.storageLocation",
        "parent.warehouseCode",
        "parent.depotCode",
        "parent.warehouseLocation",
        "parent.locationCode",
        "parent.depoYerKodu",
        "parent.storageLocation",
        "warehouseShelf",
        "stockLocation",
        "specialCode1",
        "specialCode2",
        "specialCode3",
        "customFields.warehouseCode",
        "customFields.depotCode",
        "customFields.warehouseLocation",
        "customFields.locationCode",
        "customFields.depoYerKodu",
        "customFields.storageLocation",
        "details.warehouseCode",
        "details.depotCode",
        "details.warehouseLocation",
        "details.locationCode",
        "details.depoYerKodu",
        "details.storageLocation",
        "other.warehouseCode",
        "other.depotCode",
        "other.warehouseLocation",
        "other.locationCode",
        "other.depoYerKodu",
        "other.storageLocation"
    ], "");

    if (dogrudanDeger) {
        return dogrudanDeger;
    }

    return recursiveDepoYerKoduBul(urun) || "";
}

function recursiveDepoYerKoduBul(kaynak) {
    const hedefAnahtarlar = [
        "depoyerkodu",
        "warehousecode",
        "depotcode",
        "warehouselocation",
        "locationcode",
        "storagelocation",
        "shelfcode",
        "warehouseshelf",
        "stocklocation",
        "rafkodu",
        "raf"
    ];

    return recursiveAnahtarDegeriBul(kaynak, hedefAnahtarlar);
}

function recursiveAnahtarDegeriBul(kaynak, hedefAnahtarlar) {
    if (!kaynak || typeof kaynak !== "object") {
        return "";
    }

    if (Array.isArray(kaynak)) {
        for (const item of kaynak) {
            const deger = recursiveAnahtarDegeriBul(item, hedefAnahtarlar);

            if (deger) {
                return deger;
            }
        }

        return "";
    }

    const adAlanlari = ["name", "key", "code", "title", "attributeName", "field", "label"];
    const degerAlanlari = ["value", "val", "text", "attributeValue", "fieldValue", "data"];
    const olasiAd = adAlanlari.map(alan => kaynak[alan]).find(Boolean);
    const olasiDeger = degerAlanlari.map(alan => kaynak[alan]).find(Boolean);

    if (olasiAd && olasiDeger) {
        const normalizeAd = aramaNormalize(olasiAd);

        if (hedefAnahtarlar.some(anahtar => normalizeAd.includes(anahtar))) {
            return olasiDeger;
        }
    }

    for (const [anahtar, deger] of Object.entries(kaynak)) {
        const normalizeAnahtar = aramaNormalize(anahtar);

        if (deger !== undefined && deger !== null && deger !== "" && hedefAnahtarlar.some(hedef => normalizeAnahtar.includes(hedef))) {
            if (typeof deger !== "object") {
                return deger;
            }
        }

        const altDeger = recursiveAnahtarDegeriBul(deger, hedefAnahtarlar);

        if (altDeger) {
            return altDeger;
        }
    }

    return "";
}

function hizmetUrunuMu(urun) {
    return HIZMET_BARKODLARI.includes(barkodKarsilastir(urunBarkodu(urun)));
}

function gercekUrunler() {
    return (aktifSiparis?.products || []).filter(urun => !hizmetUrunuMu(urun));
}

function taramaDurumuHazirla(siparis) {
    taramaDurumu = {};
    (siparis.products || []).forEach((urun, index) => {
        taramaDurumu[index] = 0;
    });
}

function okutulanAdet(index) {
    return taramaDurumu[index] || 0;
}

function urunTamamlandiMi(urun, index) {
    if (hizmetUrunuMu(urun)) {
        return true;
    }

    return okutulanAdet(index) >= urunAdedi(urun);
}

function tamamlananGercekUrunSayisi() {
    const urunler = aktifSiparis?.products || [];
    return urunler.filter((urun, index) => !hizmetUrunuMu(urun) && urunTamamlandiMi(urun, index)).length;
}

function gerekliToplamAdet() {
    return (aktifSiparis?.products || [])
        .filter(urun => !hizmetUrunuMu(urun))
        .reduce((toplam, urun) => toplam + urunAdedi(urun), 0);
}

function okutulanToplamAdet() {
    return (aktifSiparis?.products || [])
        .reduce((toplam, urun, index) => {
            if (hizmetUrunuMu(urun)) {
                return toplam;
            }

            return toplam + Math.min(okutulanAdet(index), urunAdedi(urun));
        }, 0);
}

function tumGercekUrunlerTamamlandiMi() {
    const urunler = aktifSiparis?.products || [];
    const gercekUrunVar = urunler.some(urun => !hizmetUrunuMu(urun));

    return gercekUrunVar && urunler.every((urun, index) => {
        return hizmetUrunuMu(urun) || urunTamamlandiMi(urun, index);
    });
}

function scannerDurdur() {
    if (scanner) {
        scanner.reset();
    }

    scannerAktif = false;
}

function bildirimSesi(tur) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;

        if (!AudioContext) {
            return;
        }

        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = tur === "success" ? 880 : 180;
        gain.gain.setValueAtTime(0.08, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
    } catch (err) {
        console.warn(err);
    }
}

function ekranVurgula(tur) {
    const detail = document.querySelector(".detail");

    if (!detail) {
        return;
    }

    detail.classList.remove("flashSuccess", "flashError");
    void detail.offsetWidth;
    detail.classList.add(tur === "success" ? "flashSuccess" : "flashError");
}

function mesajGoster(tur, baslik, detay = "") {
    const mesaj = document.getElementById("scanMessage");

    if (!mesaj) {
        return;
    }

    mesaj.className = `scanMessage ${tur}`;
    mesaj.innerHTML = `
        <strong>${temizle(baslik)}</strong>
        ${detay ? `<span>${temizle(detay)}</span>` : ""}
    `;
}

async function scannerBaslat(mod = "order") {
    if (scannerAktif) {
        return;
    }

    aktifTaramaModu = mod;

    if (!window.ZXing) {
        mesajGoster("error", "ZXing kütüphanesi yüklenemedi", "İnternet bağlantısını kontrol edin.");
        return;
    }

    const video = document.getElementById("scannerVideo");
    const panel = document.getElementById("scannerPanel");

    if (!video || !panel) {
        return;
    }

    panel.hidden = false;
    mesajGoster("info", "Kamera açılıyor", "Telefon kamerasını barkoda doğru tutun.");

    try {
        scanner = new ZXing.BrowserMultiFormatReader();
        scannerAktif = true;

        await scanner.decodeFromVideoDevice(null, video, (okunan, hata) => {
            if (okunan) {
                if (aktifTaramaModu === "location") {
                    rafBarkodIsle(okunan.getText());
                } else if (aktifTaramaModu === "shipment") {
                    sevkiyatBarkoduIsle(okunan.getText());
                } else {
                    barkodIsle(okunan.getText());
                }
            }

            if (hata && hata.name && hata.name !== "NotFoundException") {
                console.warn(hata);
            }
        });

        mesajGoster("info", "Barkod bekleniyor", mod === "shipment"
            ? "Sipariş sevkiyat barkodunu kamera alanına hizalayın."
            : "Ürün barkodunu kamera alanına hizalayın.");
    } catch (err) {
        scannerAktif = false;
        mesajGoster("error", "Kamera açılamadı", "Tarayıcı kamera iznini ve güvenli bağlantıyı kontrol edin.");
        console.error(err);
    }
}

function barkodIsle(okunanBarkod) {
    const barkod = barkodNormalize(okunanBarkod);
    const barkodKey = barkodKarsilastir(barkod);
    const simdi = Date.now();

    if (!barkod) {
        return;
    }

    if (simdi - sonOkumaZamani < OKUMA_BEKLEME_MS) {
        return;
    }

    sonOkunanBarkod = barkod;
    sonOkumaZamani = simdi;

    if (HIZMET_BARKODLARI.includes(barkodKey)) {
        mesajGoster("warning", "Bu ürün doğrulamaya dahil değil", `Okunan barkod: ${barkod}`);
        ekranVurgula("error");
        return;
    }

    const urunler = aktifSiparis?.products || [];
    const eslesenIndexler = urunler
        .map((urun, index) => ({ urun, index }))
        .filter(item => !hizmetUrunuMu(item.urun) && barkodKarsilastir(urunBarkodu(item.urun)) === barkodKey);

    if (eslesenIndexler.length === 0) {
        mesajGoster("error", "❌ Yanlış ürün okutuldu", `Okunan barkod: ${barkod}`);
        bildirimSesi("error");
        ekranVurgula("error");
        return;
    }

    const eksikUrun = eslesenIndexler.find(item => !urunTamamlandiMi(item.urun, item.index));

    if (!eksikUrun) {
        mesajGoster("warning", "Bu barkod için gerekli adet tamamlandı", `Okunan barkod: ${barkod}`);
        return;
    }

    taramaDurumu[eksikUrun.index] = okutulanAdet(eksikUrun.index) + 1;
    mesajGoster("success", "✅ Doğru ürün okutuldu", urunAdi(eksikUrun.urun));
    bildirimSesi("success");
    ekranVurgula("success");
    urunListesiGuncelle();

    if (tumGercekUrunlerTamamlandiMi()) {
        scannerDurdur();
        siparisHazirEkraniGoster();
    }
}

async function yukle() {
    try {
        const response = await fetch("/orders");
        const data = await response.json();

        siparisler = data.result.list;
        aktifListe = siparisler;

        if (aktifSekme === "orders") {
            listeGoster(aktifListe);
        }
    } catch (err) {
        result.innerHTML = `
            <div class="notfound">
                Siparişler yüklenemedi.
            </div>
        `;

        console.error(err);
    }
}

function listeGoster(liste) {
    scannerDurdur();
    aktifSiparis = null;
    aktifSekme = "orders";
    aktifListe = liste;
    searchInput.disabled = false;
    document.body.classList.remove("detailMode");
    document.body.classList.remove("locationMode");
    document.body.classList.remove("shipmentMode");
    sekmeDurumuGuncelle();

    result.innerHTML = "";

    if (liste.length === 0) {
        result.innerHTML = `
            <div class="notfound">
                Sipariş bulunamadı.
            </div>
        `;

        return;
    }

    liste.forEach(item => {
        const kod = siparisKodu(item);
        const urunSayisi = (item.products || []).length;

        result.innerHTML += `
            <article class="orderCard">
                <div class="cardTop">
                    <div>
                        <h2>${temizle(musteriAdi(item))}</h2>
                        <p>Sipariş No: <strong>${temizle(kod)}</strong></p>
                    </div>
                    <span class="cardStatus">${temizle(siparisDurumu(item))}</span>
                </div>

                <div class="cardMeta">
                    <span><b>Platform</b>${temizle(platformAdi(item))}</span>
                    <span><b>Ürün Sayısı</b>${temizle(urunSayisi)}</span>
                </div>

                <button class="openOrderButton" type="button" data-order-code="${temizle(kod)}">
                    📦 Siparişi Aç
                </button>
            </article>
        `;
    });
}

function sekmeDurumuGuncelle() {
    tabButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.tab === aktifSekme);
    });
}

function rafKayitlari() {
    return rafKayitListesi;
}

async function rafKayitlariniGetir(force = false) {
    if (force) {
        rafKayitlariPromise = null;
    }

    if (!rafKayitlariPromise) {
        rafKayitlariPromise = fetch("/locations")
            .then(response => {
                if (!response.ok) {
                    throw new Error("Raf kayitlari alinamadi.");
                }
                return response.json();
            })
            .then(data => {
                rafKayitListesi = Array.isArray(data.result) ? data.result : [];
                return rafKayitListesi;
            })
            .catch(err => {
                rafKayitlariPromise = null;
                throw err;
            });
    }

    return rafKayitlariPromise;
}

function listeyiAyikla(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.result?.list)) return data.result.list;
    if (Array.isArray(data?.result)) return data.result;
    if (Array.isArray(data?.list)) return data.list;
    if (Array.isArray(data?.products)) return data.products;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.data?.list)) return data.data.list;
    return [];
}

function varyantlariAyikla(urun) {
    const varyantAlanlari = ["variants", "variant", "stocks", "stock", "productVariants", "items"];

    for (const alan of varyantAlanlari) {
        const deger = urun?.[alan];

        if (Array.isArray(deger) && deger.length) {
            return deger.map(varyant => ({
                ...urun,
                ...varyant,
                parent: urun,
                variant: varyant,
                productId: urun.id || urun.productId
            }));
        }
    }

    return [{
        ...urun,
        productId: urun.id || urun.productId
    }];
}

function apiUrunKayitlariOlustur(urunler) {
    return urunler
        .flatMap(varyantlariAyikla)
        .filter(urun => barkodNormalize(urunBarkodu(urun)) !== "")
        .map(urun => ({
            productId: urun.productId || urun.id,
            barcode: urunBarkodu(urun),
            name: urunAdi(urun),
            color: urunRengi(urun),
            size: urunBedeni(urun),
            location: "",
            hasLocation: false,
            source: "api",
            rawProduct: urun.parent || urun,
            rawVariant: urun.variant || urun,
            rawListItem: urun.parent || urun,
            rawListVariant: urun.variant || urun,
            rawDetailItem: null
        }));
}

async function apiUrunleriniGetir() {
    if (apiUrunleri) {
        return apiUrunleri;
    }

    if (!apiUrunleriPromise) {
        apiUrunleriPromise = fetch("/products")
            .then(response => {
                if (!response.ok) {
                    throw new Error("Ürün listesi alınamadı.");
                }
                return response.json();
            })
            .then(data => apiUrunKayitlariOlustur(listeyiAyikla(data)));
    }

    apiUrunleri = await apiUrunleriPromise;
    return apiUrunleri;
}

async function apiUrunDetayiniGetir(productId) {
    if (!productId) {
        return null;
    }

    if (apiUrunDetayCache.has(productId)) {
        return apiUrunDetayCache.get(productId);
    }

    const promise = fetch(`/products/${encodeURIComponent(productId)}`)
        .then(response => {
            if (!response.ok) {
                throw new Error("Ürün detayı alınamadı.");
            }
            return response.json();
        })
        .then(data => data.result || data.raw?.result || data.raw?.data || data.raw || data);

    apiUrunDetayCache.set(productId, promise);
    return promise;
}

async function depoYerKodunuDetaydanTamamla(kayit) {
    const rafKaydi = rafKaydiBarkodlaBul(kayit.barcode);

    return rafKaydi
        ? {
            ...kayit,
            ...rafKaydi,
            productId: kayit.productId || rafKaydi.productId,
            size: rafKaydi.size && rafKaydi.size !== "-" ? rafKaydi.size : kayit.size,
            rawProduct: kayit.rawProduct,
            rawVariant: kayit.rawVariant,
            rawListItem: kayit.rawListItem,
            rawListVariant: kayit.rawListVariant
        }
        : { ...kayit, location: "", hasLocation: false };
}

async function kayitlariDetaylaZenginlestir(kayitlar) {
    return Promise.all(kayitlar.map(depoYerKodunuDetaydanTamamla));
}

function rafKaydiBarkodlaBul(barkod) {
    const barkodKey = barkodKarsilastir(barkod);
    const kayit = rafKayitlari().find(item => barkodKarsilastir(item.barcode) === barkodKey);
    return kayit ? { ...kayit, hasLocation: true, source: "location" } : null;
}

function rafKaydiAra(metin) {
    const aranan = String(metin || "").toLowerCase().trim();

    if (!aranan) {
        return [];
    }

    return rafKayitlari().filter(kayit => {
        return [
            kayit.name,
            kayit.barcode,
            kayit.color,
            kayit.size,
            kayit.location
        ].some(deger => String(deger || "").toLowerCase().includes(aranan));
    }).map(kayit => ({ ...kayit, hasLocation: true, source: "location" }));
}

function apiUrunBarkodlaBul(urunler, barkod) {
    const barkodKey = barkodKarsilastir(barkod);
    return urunler.find(urun => barkodKarsilastir(urun.barcode) === barkodKey);
}

function apiUrunAra(urunler, metin) {
    const aranan = String(metin || "").toLowerCase().trim();

    if (!aranan) {
        return [];
    }

    return urunler.filter(urun => {
        return [
            urun.name,
            urun.barcode,
            urun.color,
            urun.size
        ].some(deger => String(deger || "").toLowerCase().includes(aranan));
    });
}

function rafSonucKarti(kayit) {
    const raf = kayit.hasLocation ? kayit.location : "Raf atanmadı";
    const kartClass = kayit.hasLocation ? "" : " unassigned";
    const debugHtml = debugUrunVerisiHtml(kayit);
    const debugId = `debug-${barkodKarsilastir(kayit.barcode).replace(/[^A-Z0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;

    return `
        <article class="locationResultCard${kartClass}">
            <div>
                <p class="eyebrow">${kayit.hasLocation ? "Raf Konumu" : "Ürün Bulundu"}</p>
                <h3>${temizle(kayit.name)}</h3>
            </div>
            <strong class="locationCode">${temizle(raf)}</strong>
            <dl class="locationFacts">
                <div>
                    <dt>Barkod</dt>
                    <dd>${temizle(kayit.barcode)}</dd>
                </div>
                <div>
                    <dt>Renk</dt>
                    <dd>${temizle(kayit.color)}</dd>
                </div>
                <div>
                    <dt>Beden</dt>
                    <dd>${temizle(kayit.size)}</dd>
                </div>
            </dl>
            <form class="locationAssignment" data-location-form="${temizle(kayit.barcode)}">
                <label>
                    <span>Raf / Depo Yer Kodu</span>
                    <input
                        type="text"
                        name="location"
                        value="${temizle(kayit.hasLocation ? kayit.location : "")}"
                        placeholder="Ornek: 36-B"
                        maxlength="64"
                        autocomplete="off"
                        required
                    >
                </label>
                <button class="saveLocationButton" type="submit">
                    ${kayit.hasLocation ? "Rafi Guncelle" : "Raf Ata"}
                </button>
                ${kayit.hasLocation ? `
                    <button class="removeLocationButton" type="button" data-remove-location="${temizle(kayit.barcode)}">
                        Atamayi Sil
                    </button>
                ` : ""}
            </form>
            <button class="printBarcodeButton" type="button" data-print-barcode="${temizle(kayit.barcode)}">
                Barkod Yazdır
            </button>
            <button class="debugButton" type="button" data-debug-target="${temizle(debugId)}">Debug</button>
            <div class="debugProductData" id="${temizle(debugId)}" hidden>
                ${debugHtml}
            </div>
        </article>
    `;
}

function barkodEtiketiGoster(kayit) {
    document.getElementById("barcodePrintModal")?.remove();

    const modal = document.createElement("div");
    modal.id = "barcodePrintModal";
    modal.className = "barcodePrintModal";
    modal.innerHTML = `
        <div class="barcodePrintDialog" role="dialog" aria-modal="true" aria-labelledby="barcodePrintTitle">
            <div class="barcodePrintHeader">
                <div>
                    <p class="eyebrow">50 x 30 mm Zebra Etiketi</p>
                    <h2 id="barcodePrintTitle">Barkod Önizleme</h2>
                </div>
                <button class="closePrintModal" type="button" aria-label="Kapat">&times;</button>
            </div>
            <div class="barcodeLabel" id="barcodeLabel">
                <strong class="barcodeLabelName">${temizle(kayit.name)}</strong>
                <div class="barcodeLabelVariant">
                    <span>${temizle(kayit.color)}</span>
                    <span>${kayit.labelType === "shipment" ? "Sipariş" : "Beden"}: ${temizle(kayit.size)}</span>
                </div>
                <svg id="barcodeLabelSvg" aria-label="${temizle(kayit.barcode)}"></svg>
            </div>
            <div class="barcodePrintActions">
                <button class="removeLocationButton closePrintModal" type="button">İptal</button>
                <button class="saveLocationButton" id="printBarcodeNow" type="button">Yazdır</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    if (typeof JsBarcode !== "function") {
        modal.remove();
        mesajGoster("error", "Barkod oluşturulamadı", "Barkod kütüphanesi yüklenemedi.");
        return;
    }

    JsBarcode("#barcodeLabelSvg", kayit.barcode, {
        format: "CODE128",
        width: 2,
        height: 58,
        displayValue: true,
        fontSize: 16,
        margin: 0
    });
}

function urunKaydiniBarkodlaBul(barkod) {
    const key = barkodKarsilastir(barkod);
    return apiUrunleri?.find(item => barkodKarsilastir(item.barcode) === key)
        || rafKayitListesi.find(item => barkodKarsilastir(item.barcode) === key)
        || null;
}

async function rafAta(kayit, location) {
    const response = await fetch(`/locations/${encodeURIComponent(kayit.barcode)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            productId: kayit.productId,
            name: kayit.name,
            color: kayit.color,
            size: kayit.size,
            location
        })
    });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Raf atamasi kaydedilemedi.");
    }

    const key = barkodKarsilastir(data.result.barcode);
    rafKayitListesi = rafKayitListesi.filter(item => barkodKarsilastir(item.barcode) !== key);
    rafKayitListesi.push(data.result);
    return { ...kayit, ...data.result, hasLocation: true, source: "database" };
}

async function rafAtamasiniSil(barkod) {
    const response = await fetch(`/locations/${encodeURIComponent(barkod)}`, {
        method: "DELETE"
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Raf atamasi silinemedi.");
    }

    const key = barkodKarsilastir(barkod);
    rafKayitListesi = rafKayitListesi.filter(item => barkodKarsilastir(item.barcode) !== key);
}

function tumFieldIsimleri(obj, prefix = "", alanlar = new Set()) {
    if (!obj || typeof obj !== "object") {
        return alanlar;
    }

    if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
            tumFieldIsimleri(item, `${prefix}[${index}]`, alanlar);
        });
        return alanlar;
    }

    Object.keys(obj).forEach(key => {
        const path = prefix ? `${prefix}.${key}` : key;
        alanlar.add(path);
        tumFieldIsimleri(obj[key], path, alanlar);
    });

    return alanlar;
}

function ozelAlanlariTopla(obj) {
    if (!obj || typeof obj !== "object") {
        return {};
    }

    const alanlar = [
        "variants",
        "variant",
        "properties",
        "attributes",
        "options",
        "stockList",
        "variantList",
        "stocks",
        "stock",
        "productVariants",
        "items",
        "customFields",
        "details",
        "detail",
        "other",
        "features",
        "specs"
    ];

    return alanlar.reduce((sonuc, alan) => {
        if (obj[alan] !== undefined) {
            sonuc[alan] = obj[alan];
        }
        return sonuc;
    }, {});
}

function debugUrunVerisiHtml(kayit) {
    const debugData = {
        listApiProductData: kayit.rawListItem || kayit.rawProduct || null,
        detailApiProductData: kayit.rawDetailItem || null,
        fieldNames: {
            listApiProductData: Array.from(tumFieldIsimleri(kayit.rawListItem || kayit.rawProduct || null)).sort(),
            listVariantData: Array.from(tumFieldIsimleri(kayit.rawListVariant || kayit.rawVariant || null)).sort(),
            detailApiProductData: Array.from(tumFieldIsimleri(kayit.rawDetailItem || null)).sort(),
            detailVariantData: Array.from(tumFieldIsimleri(kayit.rawDetailVariant || null)).sort()
        },
        importantContainers: {
            listApiProductData: ozelAlanlariTopla(kayit.rawListItem || kayit.rawProduct || null),
            listVariantData: ozelAlanlariTopla(kayit.rawListVariant || kayit.rawVariant || null),
            detailApiProductData: ozelAlanlariTopla(kayit.rawDetailItem || null),
            detailVariantData: ozelAlanlariTopla(kayit.rawDetailVariant || null)
        }
    };

    return `
        <div class="debugTitle">Debug Ürün Verisi</div>
        <pre>${temizle(JSON.stringify(debugData, null, 2))}</pre>
    `;
}

function rafSonucGoster(kayit, kaynak = "scan") {
    const sonuc = document.getElementById("locationResult");

    if (!sonuc) {
        return;
    }

    if (kayit.hasLocation) {
        mesajGoster("success", "Ürün raf kaydı bulundu", kaynak === "scan" ? `Okunan barkod: ${kayit.barcode}` : "Manuel arama sonucu");
        bildirimSesi("success");
    } else {
        mesajGoster("warning", "Ürün bulundu ama raf konumu tanımlanmamış", `Barkod: ${kayit.barcode}`);
    }

    sonuc.innerHTML = rafSonucKarti(kayit);
}

function rafBulunamadiGoster(barkod) {
    const sonuc = document.getElementById("locationResult");

    if (!sonuc) {
        return;
    }

    mesajGoster("error", "Bu ürün için raf kaydı bulunamadı", barkod ? `Okunan barkod: ${barkod}` : "Ürün adı veya barkod ile tekrar arayın.");
    bildirimSesi("error");
    sonuc.innerHTML = "";
}

async function rafBarkodIsle(okunanBarkod) {
    const barkod = barkodNormalize(okunanBarkod);
    const simdi = Date.now();

    if (!barkod || simdi - sonOkumaZamani < OKUMA_BEKLEME_MS) {
        return;
    }

    sonOkunanBarkod = barkod;
    sonOkumaZamani = simdi;

    await rafKayitlariniGetir();
    const kayit = rafKaydiBarkodlaBul(barkod);

    if (kayit) {
        rafSonucGoster(kayit, "scan");
        return;
    }

    try {
        mesajGoster("info", "Raf kaydı bulunamadı", "Ürün API listesinde aranıyor...");
        const urunler = await apiUrunleriniGetir();
        const apiUrun = apiUrunBarkodlaBul(urunler, barkod);

        if (apiUrun) {
            const zenginKayit = await depoYerKodunuDetaydanTamamla(apiUrun);
            rafSonucGoster(zenginKayit, "scan");
            return;
        }

        rafBulunamadiGoster(barkod);
    } catch (err) {
        mesajGoster("error", "Ürün listesi alınamadı", err.message);
        console.error(err);
    }
}

async function rafAramaSonuclariGoster(sonuclar) {
    const sonuc = document.getElementById("locationResult");

    if (!sonuc) {
        return;
    }

    await rafKayitlariniGetir();
    const arama = document.getElementById("locationSearch");

    if (arama && !arama.value.trim()) {
        sonuc.innerHTML = `
            <div class="emptyLocation">
                Raf sonucu burada görünecek.
            </div>
        `;
        return;
    }

    try {
        mesajGoster("info", "Ürünler aranıyor", "Raf kayıtları ve ürün listesi kontrol ediliyor...");
        const urunler = await apiUrunleriniGetir();
        const apiSonuclar = apiUrunAra(urunler, arama.value);
        const birlesik = new Map();

        [...apiSonuclar, ...sonuclar].forEach(kayit => {
            const key = barkodKarsilastir(kayit.barcode);
            const mevcut = birlesik.get(key);
            birlesik.set(key, mevcut ? {
                ...mevcut,
                ...kayit,
                size: kayit.size && kayit.size !== "-" ? kayit.size : mevcut.size
            } : kayit);
        });

        const zenginSonuclar = await kayitlariDetaylaZenginlestir(Array.from(birlesik.values()));

        if (!zenginSonuclar.length) {
            rafBulunamadiGoster("");
            return;
        }

        const rafliSonucSayisi = zenginSonuclar.filter(kayit => kayit.hasLocation).length;
        mesajGoster(
            rafliSonucSayisi ? "success" : "warning",
            rafliSonucSayisi ? "Ürünler bulundu" : "Ürünler bulundu, raf ataması yok",
            `${zenginSonuclar.length} ürün listelendi.`
        );
        sonuc.innerHTML = zenginSonuclar.map(rafSonucKarti).join("");
    } catch (err) {
        mesajGoster("error", "Ürün listesi alınamadı", err.message);
        console.error(err);
    }
}

function rafEkraniGoster() {
    scannerDurdur();
    aktifSekme = "locations";
    aktifSiparis = null;
    searchInput.disabled = true;
    document.body.classList.remove("detailMode");
    document.body.classList.remove("shipmentMode");
    document.body.classList.add("locationMode");
    sekmeDurumuGuncelle();

    result.innerHTML = `
        <section class="locationTool">
            <div class="locationHeader">
                <div>
                    <p class="eyebrow">Raf Bul / İade Yerleştir</p>
                    <h2>Ürün barkodundan raf konumu bul</h2>
                </div>
                <button class="scanButton" type="button" id="startLocationScanner">📷 Barkodu Okut</button>
            </div>

            <div class="scannerPanel" id="scannerPanel" hidden>
                <video id="scannerVideo" muted playsinline></video>
                <div class="scanFrame"></div>
            </div>

            <div class="scanMessage info" id="scanMessage">
                <strong>Barkod okutun veya ürün adıyla manuel arama yapın.</strong>
                <span>Ürünü bulun, raf kodunu girin ve Zora Depo'ya kaydedin.</span>
            </div>

            <label class="manualSearch">
                <span>Manuel ürün arama</span>
                <input id="locationSearch" type="text" placeholder="Ürün adı, barkod, renk, beden veya raf..." autocomplete="off">
            </label>

            <div class="locationResult" id="locationResult">
                <div class="emptyLocation">
                    Raf sonucu burada görünecek.
                </div>
            </div>
        </section>
    `;

    rafKayitlariniGetir().catch(err => {
        mesajGoster("error", "Raf kayitlari alinamadi", err.message);
    });
}

function sevkiyatBarkodu(siparis) {
    return `ZORA-ORDER-${siparisKodu(siparis)}`;
}

function sevkiyatKodunuAyikla(barkod) {
    const deger = barkodNormalize(barkod);
    return deger.toUpperCase().startsWith("ZORA-ORDER-")
        ? deger.slice("ZORA-ORDER-".length)
        : deger;
}

async function sevkiyatKayitlariniGetir() {
    const response = await fetch("/shipments");
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Sevkiyat kayıtları alınamadı.");
    }

    sevkiyatKayitlari = Array.isArray(data.result) ? data.result : [];
    return sevkiyatKayitlari;
}

async function sevkiyatDurumuKaydet(siparis, status) {
    const code = siparisKodu(siparis);
    const response = await fetch(`/shipments/${encodeURIComponent(code)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            status,
            customerName: musteriAdi(siparis),
            platform: platformAdi(siparis)
        })
    });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Sevkiyat durumu kaydedilemedi.");
    }

    const key = code.toUpperCase();
    sevkiyatKayitlari = sevkiyatKayitlari.filter(item => item.orderCode.toUpperCase() !== key);
    sevkiyatKayitlari.push(data.result);
    return data.result;
}

function sevkiyatKarti(siparis, kayit, shipped = false) {
    const code = siparisKodu(siparis);
    const status = shipped ? "Kargoya Verildi" : kayit?.status === "ready" ? "Kargoya Hazır" : "Eksikte Bekliyor";

    return `
        <article class="shipmentCard ${shipped ? "shipped" : "pending"}">
            <div>
                <span class="shipmentStatus">${temizle(status)}</span>
                <h3>${temizle(musteriAdi(siparis))}</h3>
                <p>${temizle(code)} · ${temizle(platformAdi(siparis))}</p>
            </div>
            <div class="shipmentActions">
                <button type="button" class="printShipmentButton" data-print-shipment="${temizle(code)}">
                    Sevkiyat Barkodu
                </button>
                ${shipped ? "" : `
                    <button type="button" class="markShippedButton" data-mark-shipped="${temizle(code)}">
                        Kargoya Verildi
                    </button>
                `}
            </div>
        </article>
    `;
}

function sevkiyatListeleriniGoster() {
    const bekleyenAlan = document.getElementById("pendingShipments");
    const verilenAlan = document.getElementById("shippedShipments");

    if (!bekleyenAlan || !verilenAlan) {
        return;
    }

    const kayitMap = new Map(sevkiyatKayitlari.map(item => [item.orderCode.toUpperCase(), item]));
    const kapanmisDurumlar = ["Kargolandı", "Teslim Edildi", "İade", "İptal"];
    const bekleyen = siparisler.filter(item => {
        const kayit = kayitMap.get(siparisKodu(item).toUpperCase());
        return kayit?.status !== "shipped" && !kapanmisDurumlar.includes(siparisDurumu(item));
    });
    const verilen = sevkiyatKayitlari
        .filter(item => item.status === "shipped")
        .map(kayit => {
            const siparis = siparisler.find(item => siparisKodu(item).toUpperCase() === kayit.orderCode.toUpperCase());
            return {
                siparis: siparis || {
                    order: { code: kayit.orderCode, platform: kayit.platform },
                    customer: { name: kayit.customerName }
                },
                kayit
            };
        });

    bekleyenAlan.innerHTML = bekleyen.length
        ? bekleyen.map(item => sevkiyatKarti(item, kayitMap.get(siparisKodu(item).toUpperCase()))).join("")
        : `<div class="emptyLocation">Bekleyen sipariş yok.</div>`;
    verilenAlan.innerHTML = verilen.length
        ? verilen.map(item => sevkiyatKarti(item.siparis, item.kayit, true)).join("")
        : `<div class="emptyLocation">Henüz kargoya verilen sipariş yok.</div>`;

    document.getElementById("pendingShipmentCount").textContent = bekleyen.length;
    document.getElementById("shippedShipmentCount").textContent = verilen.length;
}

async function sevkiyatEkraniGoster() {
    scannerDurdur();
    aktifSekme = "shipments";
    aktifSiparis = null;
    searchInput.disabled = true;
    document.body.classList.remove("detailMode", "locationMode");
    document.body.classList.add("shipmentMode");
    sekmeDurumuGuncelle();

    result.innerHTML = `
        <section class="shipmentTool">
            <div class="locationHeader">
                <div>
                    <p class="eyebrow">Sevkiyat Takibi</p>
                    <h2>Kargo çıkış kontrolü</h2>
                </div>
                <button class="scanButton" type="button" id="startShipmentScanner">📷 Sipariş Barkodu Okut</button>
            </div>
            <div class="scannerPanel" id="scannerPanel" hidden>
                <video id="scannerVideo" muted playsinline></video>
                <div class="scanFrame"></div>
            </div>
            <div class="scanMessage info" id="scanMessage">
                <strong>Kargoya verilen siparişin sevkiyat barkodunu okutun.</strong>
                <span>Sipariş otomatik olarak Kargoya Verilenler listesine taşınır.</span>
            </div>
            <div class="shipmentColumns">
                <section>
                    <div class="sectionTitle">
                        <h3>Eksikte Bekleyenler</h3>
                        <span id="pendingShipmentCount">0</span>
                    </div>
                    <div class="shipmentList" id="pendingShipments"></div>
                </section>
                <section>
                    <div class="sectionTitle">
                        <h3>Kargoya Verilenler</h3>
                        <span id="shippedShipmentCount">0</span>
                    </div>
                    <div class="shipmentList" id="shippedShipments"></div>
                </section>
            </div>
        </section>
    `;

    try {
        await sevkiyatKayitlariniGetir();
        sevkiyatListeleriniGoster();
    } catch (err) {
        mesajGoster("error", "Sevkiyat kayıtları alınamadı", err.message);
    }
}

async function sevkiyatBarkoduIsle(okunan) {
    const simdi = Date.now();

    if (simdi - sonOkumaZamani < OKUMA_BEKLEME_MS) {
        return;
    }

    sonOkumaZamani = simdi;
    const code = sevkiyatKodunuAyikla(okunan);
    const siparis = siparisler.find(item => siparisKodu(item).toUpperCase() === code.toUpperCase());

    if (!siparis) {
        mesajGoster("error", "Sipariş bulunamadı", `Okunan barkod: ${okunan}`);
        bildirimSesi("error");
        return;
    }

    try {
        await sevkiyatDurumuKaydet(siparis, "shipped");
        scannerDurdur();
        sevkiyatListeleriniGoster();
        mesajGoster("success", "Sipariş kargoya verildi", `${musteriAdi(siparis)} · ${siparisKodu(siparis)}`);
        bildirimSesi("success");
    } catch (err) {
        mesajGoster("error", "Sevkiyat kaydedilemedi", err.message);
    }
}

function sevkiyatEtiketiGoster(siparis) {
    const kayit = {
        barcode: sevkiyatBarkodu(siparis),
        name: musteriAdi(siparis),
        color: "SEVKİYAT",
        size: siparisKodu(siparis),
        labelType: "shipment"
    };
    barkodEtiketiGoster(kayit);
}

function urunListesiHtml(urunler) {
    if (!urunler.length) {
        return `
            <div class="notfound compact">
                Bu siparişte ürün bulunamadı.
            </div>
        `;
    }

    return urunler.map((urun, index) => {
        const hizmet = hizmetUrunuMu(urun);
        const gereken = hizmet ? 0 : urunAdedi(urun);
        const okutulan = hizmet ? 0 : okutulanAdet(index);
        const tamamlandi = urunTamamlandiMi(urun, index);
        const kismenOkutuldu = !hizmet && okutulan > 0 && !tamamlandi;
        const durumClass = hizmet ? " service" : tamamlandi ? " scanned" : kismenOkutuldu ? " partial" : "";
        const durumMetni = hizmet ? "Doğrulama dışı" : tamamlandi ? "✅ Doğru ürün tamamlandı" : okutulan > 0 ? "✅ Doğru ürün okutuldu" : "Bekliyor";
        const sira = hizmet ? "H" : tamamlandi ? "✓" : index + 1;

        return `
            <article class="productRow${durumClass}" data-product-index="${index}">
                <div class="productMain">
                    <span class="productIndex">${temizle(sira)}</span>
                    <div>
                        <div class="productTitleLine">
                            <h3>${temizle(urunAdi(urun))}</h3>
                            <span>Renk: ${temizle(urunRengi(urun))}</span>
                            <span>Beden: ${temizle(urunBedeni(urun))}</span>
                            <span>Barkod: ${temizle(urunBarkodu(urun))}</span>
                        </div>
                        <dl class="productFacts">
                            <div>
                                <dt>Renk</dt>
                                <dd>${temizle(urunRengi(urun))}</dd>
                            </div>
                            <div>
                                <dt>Beden</dt>
                                <dd>${temizle(urunBedeni(urun))}</dd>
                            </div>
                            <div>
                                <dt>Barkod</dt>
                                <dd>${temizle(urunBarkodu(urun))}</dd>
                            </div>
                            <div>
                                <dt>Adet</dt>
                                <dd>${hizmet ? "-" : `${temizle(okutulan)} / ${temizle(gereken)}`}</dd>
                            </div>
                        </dl>
                    </div>
                </div>
                <span class="productState">${temizle(durumMetni)}</span>
            </article>
        `;
    }).join("");
}

function urunListesiGuncelle() {
    const urunListesi = document.getElementById("productList");

    if (!urunListesi || !aktifSiparis) {
        return;
    }

    urunListesi.innerHTML = urunListesiHtml(aktifSiparis.products || []);

    const ilerleme = document.getElementById("scanProgress");
    const toplam = gerekliToplamAdet();

    if (ilerleme) {
        ilerleme.textContent = `${okutulanToplamAdet()} / ${toplam} adet doğrulandı`;
    }
}

function siparisDetayGoster(siparis) {
    scannerDurdur();
    aktifSiparis = siparis;
    taramaDurumuHazirla(siparis);
    sonOkunanBarkod = "";
    sonOkumaZamani = 0;
    searchInput.disabled = true;
    document.body.classList.add("detailMode");

    const urunler = siparis.products || [];
    const toplamGerekliAdet = urunler
        .filter(urun => !hizmetUrunuMu(urun))
        .reduce((toplam, urun) => toplam + urunAdedi(urun), 0);

    result.innerHTML = `
        <section class="detail">
            <button class="backButton" type="button" id="backToList">← Geri</button>

            <div class="detailHeader">
                <div>
                    <p class="eyebrow">Sipariş Detayı</p>
                    <h2>${temizle(musteriAdi(siparis))}</h2>
                    <p class="detailCode">${temizle(siparisKodu(siparis))}</p>
                </div>
                <span class="statusPill">${temizle(siparisDurumu(siparis))}</span>
            </div>

            <div class="infoGrid">
                <div>
                    <span>Müşteri</span>
                    <strong>${temizle(musteriAdi(siparis))}</strong>
                </div>
                <div>
                    <span>Sipariş Numarası</span>
                    <strong>${temizle(siparisKodu(siparis))}</strong>
                </div>
                <div>
                    <span>Platform</span>
                    <strong>${temizle(platformAdi(siparis))}</strong>
                </div>
                <div>
                    <span>Toplam Tutar</span>
                    <strong>${temizle(toplamTutar(siparis))}</strong>
                </div>
            </div>

            <div class="scannerControls">
                <div>
                    <h3>Barkod Doğrulama</h3>
                    <p id="scanProgress">0 / ${temizle(toplamGerekliAdet)} adet doğrulandı</p>
                </div>
                <button class="scanButton" type="button" id="startScanner">📷 Barkodu Okut</button>
            </div>

            <div class="scannerPanel" id="scannerPanel" hidden>
                <video id="scannerVideo" muted playsinline></video>
                <div class="scanFrame"></div>
            </div>

            <div class="scanMessage info" id="scanMessage">
                <strong>Barkod okutmaya başlamak için kamerayı açın.</strong>
                <span>HZMBDL hizmet ürünleri doğrulamaya dahil edilmez.</span>
            </div>

            <div class="sectionTitle">
                <h3>Siparişteki Ürünler</h3>
                <span>${temizle(urunler.length)} ürün</span>
            </div>

            <div class="productList" id="productList">
                ${urunListesiHtml(urunler)}
            </div>
        </section>
    `;
}

function siparisHazirEkraniGoster() {
    sevkiyatDurumuKaydet(aktifSiparis, "ready").catch(err => console.error(err));
    result.innerHTML = `
        <section class="completeScreen">
            <div class="completeIcon">🎉</div>
            <p class="eyebrow">Sipariş Hazır</p>
            <h2>${temizle(musteriAdi(aktifSiparis))}</h2>
            <p>Sipariş No: <strong>${temizle(siparisKodu(aktifSiparis))}</strong></p>
            <button class="openOrderButton" type="button" id="backToList">Yeni Sipariş Ara</button>
        </section>
    `;
}

function siparisSec(kod) {
    const siparis = siparisler.find(item => siparisKodu(item) === kod);

    if (!siparis) {
        result.innerHTML = `
            <div class="notfound">
                Sipariş bulunamadı.
            </div>
        `;
        return;
    }

    siparisDetayGoster(siparis);
}

searchInput.addEventListener("keyup", function () {
    const ara = this.value.toLowerCase().trim();

    const filtre = siparisler.filter(item => {
        return (
            musteriAdi(item).toLowerCase().includes(ara) ||
            siparisKodu(item).toLowerCase().includes(ara)
        );
    });

    listeGoster(filtre);
});

result.addEventListener("click", async function (event) {
    const geriButonu = event.target.closest("#backToList");

    if (geriButonu) {
        searchInput.value = "";
        listeGoster(siparisler);
        return;
    }

    const acButonu = event.target.closest("[data-order-code]");

    if (acButonu) {
        siparisSec(acButonu.dataset.orderCode);
        return;
    }

    const scannerButonu = event.target.closest("#startScanner");

    if (scannerButonu) {
        scannerBaslat("order");
        return;
    }

    const rafScannerButonu = event.target.closest("#startLocationScanner");

    if (rafScannerButonu) {
        scannerBaslat("location");
        return;
    }

    const sevkiyatScannerButonu = event.target.closest("#startShipmentScanner");

    if (sevkiyatScannerButonu) {
        scannerBaslat("shipment");
        return;
    }

    const sevkiyatYazdirButonu = event.target.closest("[data-print-shipment]");

    if (sevkiyatYazdirButonu) {
        const code = sevkiyatYazdirButonu.dataset.printShipment;
        const kayit = sevkiyatKayitlari.find(item => item.orderCode === code);
        const siparis = siparisler.find(item => siparisKodu(item) === code) || (kayit && {
            order: { code: kayit.orderCode, platform: kayit.platform },
            customer: { name: kayit.customerName }
        });

        if (siparis) {
            sevkiyatEtiketiGoster(siparis);
        }
        return;
    }

    const kargoyaVerButonu = event.target.closest("[data-mark-shipped]");

    if (kargoyaVerButonu) {
        const code = kargoyaVerButonu.dataset.markShipped;
        const siparis = siparisler.find(item => siparisKodu(item) === code);

        if (siparis) {
            try {
                await sevkiyatDurumuKaydet(siparis, "shipped");
                sevkiyatListeleriniGoster();
                mesajGoster("success", "Sipariş kargoya verildi", `${musteriAdi(siparis)} · ${code}`);
            } catch (err) {
                mesajGoster("error", "Sevkiyat kaydedilemedi", err.message);
            }
        }
        return;
    }

    const silButonu = event.target.closest("[data-remove-location]");

    if (silButonu) {
        silButonu.disabled = true;

        try {
            const barkod = silButonu.dataset.removeLocation;
            const kayit = urunKaydiniBarkodlaBul(barkod);
            await rafAtamasiniSil(barkod);
            rafSonucGoster({ ...kayit, location: "", hasLocation: false }, "manual");
            mesajGoster("success", "Raf atamasi silindi", `Barkod: ${barkod}`);
        } catch (err) {
            silButonu.disabled = false;
            mesajGoster("error", "Raf atamasi silinemedi", err.message);
        }
        return;
    }

    const barkodYazdirButonu = event.target.closest("[data-print-barcode]");

    if (barkodYazdirButonu) {
        const kayit = urunKaydiniBarkodlaBul(barkodYazdirButonu.dataset.printBarcode);

        if (kayit) {
            barkodEtiketiGoster(kayit);
        }
        return;
    }

    if (event.target.closest(".closePrintModal")) {
        document.getElementById("barcodePrintModal")?.remove();
        return;
    }

    if (event.target.closest("#printBarcodeNow")) {
        window.print();
        return;
    }

    const debugButonu = event.target.closest("[data-debug-target]");

    if (debugButonu) {
        const panel = document.getElementById(debugButonu.dataset.debugTarget);

        if (panel) {
            panel.hidden = !panel.hidden;
            debugButonu.textContent = panel.hidden ? "Debug" : "Debug Kapat";
        }
    }
});

result.addEventListener("submit", async function (event) {
    const form = event.target.closest("[data-location-form]");

    if (!form) {
        return;
    }

    event.preventDefault();
    const barkod = form.dataset.locationForm;
    const kayit = urunKaydiniBarkodlaBul(barkod);
    const location = form.elements.location.value.trim();
    const button = form.querySelector(".saveLocationButton");

    if (!kayit || !location) {
        mesajGoster("error", "Raf atamasi yapilamadi", "Urun ve raf kodu gerekli.");
        return;
    }

    button.disabled = true;

    try {
        const kaydedilen = await rafAta(kayit, location);
        rafSonucGoster(kaydedilen, "manual");
        mesajGoster("success", "Raf atamasi kaydedildi", `${kaydedilen.barcode}: ${kaydedilen.location}`);
    } catch (err) {
        button.disabled = false;
        mesajGoster("error", "Raf atamasi kaydedilemedi", err.message);
    }
});

result.addEventListener("input", function (event) {
    if (event.target.id !== "locationSearch") {
        return;
    }

    const sonuclar = rafKaydiAra(event.target.value);
    rafAramaSonuclariGoster(sonuclar);
});

tabButtons.forEach(button => {
    button.addEventListener("click", function () {
        if (this.dataset.tab === aktifSekme) {
            return;
        }

        if (this.dataset.tab === "orders") {
            searchInput.value = "";
            listeGoster(siparisler);
            return;
        }

        if (this.dataset.tab === "shipments") {
            sevkiyatEkraniGoster();
        } else {
            rafEkraniGoster();
        }
    });
});

window.addEventListener("beforeunload", scannerDurdur);

yukle();
