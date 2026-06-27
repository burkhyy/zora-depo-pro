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
let aktifKullanici = null;
let yonetimHazirlamaKayitlari = [];
let aktifSiparisSorunlari = [];
let acikSorunKayitlari = [];
let aktifSevkiyatListesi = "pending";
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
const userBar = document.getElementById("userBar");

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
        if (aktifSiparisSorunlari.some(item => item.status === "open")) {
            mesajGoster("warning", "Sipariş beklemeye alındı", "Açık ürün sorunu çözülmeden sipariş tamamlanamaz.");
            return;
        }

        scannerDurdur();
        siparisHazirEkraniGoster();
    }
}

function girisEkraniGoster(hata = "") {
    scannerDurdur();
    aktifKullanici = null;
    document.body.className = "loginMode";
    document.querySelector(".topTabs").hidden = true;
    document.querySelector(".searchBox").hidden = true;
    userBar.hidden = true;
    result.innerHTML = `
        <section class="loginPanel">
            <div class="loginIcon">Z</div>
            <p class="eyebrow">Zora Depo Pro</p>
            <h2>Oturum açın</h2>
            <p class="loginIntro">Sipariş hazırlamaya devam etmek için kullanıcı hesabınızı kullanın.</p>
            ${hata ? `<div class="loginError">${temizle(hata)}</div>` : ""}
            <form id="loginForm">
                <label>
                    <span>Kullanıcı adı</span>
                    <input name="username" autocomplete="username" required>
                </label>
                <label>
                    <span>Parola</span>
                    <input name="password" type="password" autocomplete="current-password" required>
                </label>
                <button class="openOrderButton" type="submit">Giriş Yap</button>
            </form>
        </section>
    `;
}

function kullaniciArayuzunuGuncelle() {
    const adminMi = aktifKullanici?.role === "admin";
    const usersTab = document.querySelector('[data-tab="users"]');
    usersTab.hidden = !adminMi;
    document.querySelector(".topTabs").classList.toggle("adminTabs", adminMi);
    document.querySelector(".topTabs").hidden = false;
    document.querySelector(".searchBox").hidden = false;
    userBar.hidden = false;
    userBar.innerHTML = `
        <div>
            <strong>${temizle(aktifKullanici.displayName)}</strong>
            <span>${adminMi ? "Yönetici" : "Depo Personeli"}</span>
        </div>
        <button type="button" id="logoutButton">Çıkış</button>
    `;
}

async function oturumuBaslat() {
    try {
        const response = await fetch("/auth/me");

        if (!response.ok) {
            girisEkraniGoster();
            return;
        }

        const data = await response.json();
        aktifKullanici = data.user;
        document.body.classList.remove("loginMode");
        kullaniciArayuzunuGuncelle();
        await yukle();
    } catch (err) {
        girisEkraniGoster("Sunucuya bağlanılamadı.");
        console.error(err);
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
    document.body.classList.remove("adminMode");
    document.body.classList.remove("issueMode");
    document.body.classList.remove("historyMode");
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

    modal.querySelectorAll(".closePrintModal").forEach(button => {
        button.addEventListener("click", () => modal.remove());
    });

    const yazdirButonu = modal.querySelector("#printBarcodeNow");
    yazdirButonu.addEventListener("click", () => {
        yazdirButonu.disabled = true;
        yazdirButonu.textContent = "Yazdırılıyor...";

        requestAnimationFrame(() => {
            try {
                window.print();
            } finally {
                yazdirButonu.disabled = false;
                yazdirButonu.textContent = "Yazdır";
            }
        });
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
    document.body.classList.remove("adminMode");
    document.body.classList.remove("issueMode");
    document.body.classList.remove("historyMode");
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
    sevkiyatAltSekmesiniGoster(aktifSevkiyatListesi);
}

function sevkiyatAltSekmesiniGoster(sekme) {
    aktifSevkiyatListesi = sekme === "shipped" ? "shipped" : "pending";

    document.querySelectorAll("[data-shipment-view]").forEach(button => {
        const aktif = button.dataset.shipmentView === aktifSevkiyatListesi;
        button.classList.toggle("active", aktif);
        button.setAttribute("aria-selected", String(aktif));
    });

    const bekleyenPanel = document.getElementById("pendingShipmentPanel");
    const verilenPanel = document.getElementById("shippedShipmentPanel");

    if (bekleyenPanel) {
        bekleyenPanel.hidden = aktifSevkiyatListesi !== "pending";
    }

    if (verilenPanel) {
        verilenPanel.hidden = aktifSevkiyatListesi !== "shipped";
    }
}

async function sevkiyatEkraniGoster() {
    scannerDurdur();
    aktifSekme = "shipments";
    aktifSiparis = null;
    searchInput.disabled = true;
    document.body.classList.remove("detailMode", "locationMode", "adminMode", "issueMode", "historyMode");
    document.body.classList.add("shipmentMode");
    aktifSevkiyatListesi = "pending";
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
            <div class="shipmentViewTabs" role="tablist" aria-label="Sevkiyat listeleri">
                <button class="active" type="button" role="tab" aria-selected="true" data-shipment-view="pending">
                    Eksikte Bekleyenler <span id="pendingShipmentCount">0</span>
                </button>
                <button type="button" role="tab" aria-selected="false" data-shipment-view="shipped">
                    Kargoya Verilenler <span id="shippedShipmentCount">0</span>
                </button>
            </div>
            <div class="shipmentPanels">
                <section id="pendingShipmentPanel" role="tabpanel">
                    <div class="sectionTitle">
                        <h3>Eksikte Bekleyenler</h3>
                    </div>
                    <div class="shipmentList" id="pendingShipments"></div>
                </section>
                <section id="shippedShipmentPanel" role="tabpanel" hidden>
                    <div class="sectionTitle">
                        <h3>Kargoya Verilenler</h3>
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

function tarihSaatGoster(deger) {
    if (!deger) {
        return "-";
    }

    const tarih = new Date(`${deger.replace(" ", "T")}Z`);
    return Number.isNaN(tarih.getTime())
        ? deger
        : tarih.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

function aramaMetni(deger) {
    return String(deger ?? "").toLocaleLowerCase("tr-TR").trim();
}

function yerelTarihAnahtari(deger) {
    if (!deger) {
        return "";
    }

    const tarih = new Date(`${deger.replace(" ", "T")}Z`);

    if (Number.isNaN(tarih.getTime())) {
        return String(deger).slice(0, 10);
    }

    const yil = tarih.getFullYear();
    const ay = String(tarih.getMonth() + 1).padStart(2, "0");
    const gun = String(tarih.getDate()).padStart(2, "0");
    return `${yil}-${ay}-${gun}`;
}

function hazirlamaGecmisiSatirlari(kayitlar) {
    if (!kayitlar.length) {
        return `<tr><td colspan="7" class="emptyActivity">Arama ölçütlerine uygun hazırlama kaydı bulunamadı.</td></tr>`;
    }

    return kayitlar.map(item => `
        <tr>
            <td><strong>${temizle(item.orderCode)}</strong></td>
            <td>${temizle(item.customerName)}</td>
            <td>${temizle(item.startedBy)}</td>
            <td>${temizle(tarihSaatGoster(item.startedAt))}</td>
            <td>${temizle(item.completedBy || "-")}</td>
            <td>${temizle(tarihSaatGoster(item.completedAt))}</td>
            <td><span class="activityStatus ${item.status === "completed" ? "completed" : "started"}">${item.status === "completed" ? "Tamamlandı" : "Hazırlanıyor"}</span></td>
        </tr>
    `).join("");
}

function hazirlamaGecmisiniFiltrele() {
    const arama = aramaMetni(document.getElementById("activitySearch")?.value);
    const personel = document.getElementById("activityUserFilter")?.value || "";
    const durum = document.getElementById("activityStatusFilter")?.value || "";
    const baslangic = document.getElementById("activityDateFrom")?.value || "";
    const bitis = document.getElementById("activityDateTo")?.value || "";

    const filtrelenen = yonetimHazirlamaKayitlari.filter(item => {
        const ortakMetin = aramaMetni([
            item.orderCode,
            item.customerName,
            item.startedBy,
            item.completedBy
        ].join(" "));
        const kayitTarihi = yerelTarihAnahtari(item.startedAt);
        const personelUyuyor = !personel
            || String(item.startedByUserId) === personel
            || String(item.completedByUserId) === personel;

        return (!arama || ortakMetin.includes(arama))
            && personelUyuyor
            && (!durum || item.status === durum)
            && (!baslangic || kayitTarihi >= baslangic)
            && (!bitis || kayitTarihi <= bitis);
    });

    const govde = document.getElementById("activityTableBody");
    const sayac = document.getElementById("activityResultCount");

    if (govde) {
        govde.innerHTML = hazirlamaGecmisiSatirlari(filtrelenen);
    }

    if (sayac) {
        sayac.textContent = `${filtrelenen.length} / ${yonetimHazirlamaKayitlari.length} kayıt`;
    }
}

async function hazirlamaGecmisiEkraniGoster() {
    scannerDurdur();
    aktifSekme = "history";
    searchInput.disabled = true;
    document.body.classList.remove("detailMode", "locationMode", "shipmentMode", "issueMode", "adminMode");
    document.body.classList.add("historyMode");
    sekmeDurumuGuncelle();
    result.innerHTML = `<div class="loading">Hazırlama geçmişi yükleniyor...</div>`;

    try {
        const response = await fetch("/preparations");
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Hazırlama geçmişi alınamadı.");
        }

        yonetimHazirlamaKayitlari = data.result;
        result.innerHTML = `
            <section class="historyTool">
                <div class="locationHeader">
                    <div>
                        <p class="eyebrow">Operasyon Geçmişi</p>
                        <h2>Sipariş Hazırlama Geçmişi</h2>
                        <p>Hazırlanan siparişleri, personeli ve işlem saatlerini görüntüleyin.</p>
                    </div>
                </div>
                <div class="sectionTitle">
                    <h3>Hazırlama Kayıtları</h3>
                    <span id="activityResultCount">${temizle(data.result.length)} / ${temizle(data.result.length)} kayıt</span>
                </div>
                <div class="activityFilters">
                    <label class="activitySearchField">
                        <span>Arama</span>
                        <input id="activitySearch" type="search" placeholder="Sipariş no, müşteri veya personel">
                    </label>
                    <label>
                        <span>Personel</span>
                        <select id="activityUserFilter">
                            <option value="">Tüm personel</option>
                            ${data.users.map(user => `<option value="${temizle(user.id)}">${temizle(user.displayName)}</option>`).join("")}
                        </select>
                    </label>
                    <label>
                        <span>Durum</span>
                        <select id="activityStatusFilter">
                            <option value="">Tüm durumlar</option>
                            <option value="started">Hazırlanıyor</option>
                            <option value="completed">Tamamlandı</option>
                        </select>
                    </label>
                    <label>
                        <span>Başlangıç</span>
                        <input id="activityDateFrom" type="date">
                    </label>
                    <label>
                        <span>Bitiş</span>
                        <input id="activityDateTo" type="date">
                    </label>
                    <button id="clearActivityFilters" type="button">Filtreleri Temizle</button>
                </div>
                <div class="activityTableWrap">
                    <table class="activityTable">
                        <thead>
                            <tr>
                                <th>Sipariş</th>
                                <th>Müşteri</th>
                                <th>Başlatan</th>
                                <th>Başlangıç</th>
                                <th>Tamamlayan</th>
                                <th>Tamamlanma</th>
                                <th>Durum</th>
                            </tr>
                        </thead>
                        <tbody id="activityTableBody">
                            ${hazirlamaGecmisiSatirlari(data.result)}
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    } catch (err) {
        result.innerHTML = `<div class="notfound">${temizle(err.message)}</div>`;
    }
}

async function yonetimEkraniGoster() {
    if (aktifKullanici?.role !== "admin") {
        return;
    }

    scannerDurdur();
    aktifSekme = "users";
    searchInput.disabled = true;
    document.body.classList.remove("detailMode", "locationMode", "shipmentMode", "issueMode", "historyMode");
    document.body.classList.add("adminMode");
    sekmeDurumuGuncelle();
    result.innerHTML = `<div class="loading">Kullanıcılar ve işlem geçmişi yükleniyor...</div>`;

    try {
        const [usersResponse, historyResponse] = await Promise.all([
            fetch("/admin/users"),
            fetch("/admin/preparations")
        ]);
        const usersData = await usersResponse.json();
        const historyData = await historyResponse.json();

        if (!usersResponse.ok || !historyResponse.ok) {
            throw new Error(usersData.error || historyData.error || "Yönetim verileri alınamadı.");
        }

        yonetimHazirlamaKayitlari = historyData.result;

        result.innerHTML = `
            <section class="adminTool">
                <div class="locationHeader">
                    <div>
                        <p class="eyebrow">Yönetim</p>
                        <h2>Kullanıcılar ve hazırlama geçmişi</h2>
                    </div>
                </div>
                <div class="adminLayout">
                    <section class="userCreatePanel">
                        <div class="sectionTitle">
                            <h3>Yeni Kullanıcı</h3>
                        </div>
                        <form id="createUserForm">
                            <label><span>Ad Soyad</span><input name="displayName" required maxlength="100"></label>
                            <label><span>Kullanıcı Adı</span><input name="username" required minlength="3" maxlength="40"></label>
                            <label><span>Parola</span><input name="password" type="password" required minlength="8"></label>
                            <label>
                                <span>Rol</span>
                                <select name="role">
                                    <option value="worker">Depo Personeli</option>
                                    <option value="admin">Yönetici</option>
                                </select>
                            </label>
                            <button class="saveLocationButton" type="submit">Kullanıcı Oluştur</button>
                        </form>
                        <div class="userList">
                            ${usersData.result.map(user => `
                                <div>
                                    <strong>${temizle(user.displayName)}</strong>
                                    <span>@${temizle(user.username)} · ${user.role === "admin" ? "Yönetici" : "Personel"}</span>
                                </div>
                            `).join("")}
                        </div>
                    </section>
                    <section class="activityPanel">
                        <div class="sectionTitle">
                            <h3>Sipariş Hazırlama Geçmişi</h3>
                            <span id="activityResultCount">${temizle(historyData.result.length)} / ${temizle(historyData.result.length)} kayıt</span>
                        </div>
                        <div class="activityFilters">
                            <label class="activitySearchField">
                                <span>Arama</span>
                                <input id="activitySearch" type="search" placeholder="Sipariş no, müşteri veya personel">
                            </label>
                            <label>
                                <span>Personel</span>
                                <select id="activityUserFilter">
                                    <option value="">Tüm personel</option>
                                    ${usersData.result.map(user => `<option value="${temizle(user.id)}">${temizle(user.displayName)}</option>`).join("")}
                                </select>
                            </label>
                            <label>
                                <span>Durum</span>
                                <select id="activityStatusFilter">
                                    <option value="">Tüm durumlar</option>
                                    <option value="started">Hazırlanıyor</option>
                                    <option value="completed">Tamamlandı</option>
                                </select>
                            </label>
                            <label>
                                <span>Başlangıç</span>
                                <input id="activityDateFrom" type="date">
                            </label>
                            <label>
                                <span>Bitiş</span>
                                <input id="activityDateTo" type="date">
                            </label>
                            <button id="clearActivityFilters" type="button">Filtreleri Temizle</button>
                        </div>
                        <div class="activityTableWrap">
                            <table class="activityTable">
                                <thead>
                                    <tr>
                                        <th>Sipariş</th>
                                        <th>Müşteri</th>
                                        <th>Başlatan</th>
                                        <th>Başlangıç</th>
                                        <th>Tamamlayan</th>
                                        <th>Tamamlanma</th>
                                        <th>Durum</th>
                                    </tr>
                                </thead>
                                <tbody id="activityTableBody">
                                    ${hazirlamaGecmisiSatirlari(historyData.result)}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            </section>
        `;
    } catch (err) {
        result.innerHTML = `<div class="notfound">${temizle(err.message)}</div>`;
    }
}

const sorunTurleri = {
    missing: "Eksik",
    damaged: "Hasarlı",
    stock_mismatch: "Yanlış stok"
};

function urununAcikSorunu(index) {
    return aktifSiparisSorunlari.find(item => item.productIndex === index && item.status === "open");
}

async function siparisSorunlariniGetir(orderCode) {
    const response = await fetch(`/issues?orderCode=${encodeURIComponent(orderCode)}&status=open`);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Sipariş sorunları alınamadı.");
    }

    return data.result;
}

function sorunBildirmeFormuGoster(index) {
    const urun = aktifSiparis?.products?.[index];

    if (!urun) {
        return;
    }

    const mevcut = urununAcikSorunu(index);

    if (mevcut) {
        mesajGoster("warning", "Bu ürün beklemede", `${sorunTurleri[mevcut.issueType]} kaydı zaten açık.`);
        return;
    }

    const eksikAdet = Math.max(1, urunAdedi(urun) - okutulanAdet(index));

    document.getElementById("issueDialog")?.remove();
    result.insertAdjacentHTML("beforeend", `
        <div class="issueDialog" id="issueDialog" role="dialog" aria-modal="true" aria-labelledby="issueDialogTitle">
            <form class="issueDialogCard" id="issueForm" data-product-index="${temizle(index)}">
                <div class="issueDialogHeader">
                    <div>
                        <p class="eyebrow">Ürün Sorunu</p>
                        <h3 id="issueDialogTitle">${temizle(urunAdi(urun))}</h3>
                        <span>${temizle(urunBarkodu(urun))} · ${temizle(urunRengi(urun))} · ${temizle(urunBedeni(urun))}</span>
                    </div>
                    <button type="button" class="issueCloseButton" data-close-issue aria-label="Kapat">×</button>
                </div>
                <label>
                    <span>Sorun Türü</span>
                    <select name="issueType" required>
                        <option value="missing">Eksik</option>
                        <option value="damaged">Hasarlı</option>
                        <option value="stock_mismatch">Yanlış stok</option>
                    </select>
                </label>
                <label id="missingQuantityField">
                    <span>Eksik Adet</span>
                    <input name="missingQuantity" type="number" min="1" max="${temizle(urunAdedi(urun))}" value="${temizle(eksikAdet)}" required>
                </label>
                <label>
                    <span>Açıklama</span>
                    <textarea name="note" maxlength="1000" placeholder="İsteğe bağlı not"></textarea>
                </label>
                <div class="issueDialogActions">
                    <button type="button" class="issueCancelButton" data-close-issue>İptal</button>
                    <button type="submit" class="issueSaveButton">Sorunu Kaydet</button>
                </div>
            </form>
        </div>
    `);
}

async function sorunluSiparislerEkraniGoster() {
    scannerDurdur();
    aktifSekme = "issues";
    searchInput.disabled = true;
    document.body.classList.remove("detailMode", "locationMode", "shipmentMode", "adminMode", "historyMode");
    document.body.classList.add("issueMode");
    sekmeDurumuGuncelle();
    result.innerHTML = `<div class="loading">Sorunlu siparişler yükleniyor...</div>`;

    try {
        const response = await fetch("/issues?status=open");
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Sorunlu siparişler alınamadı.");
        }

        acikSorunKayitlari = data.result;
        const eksikUrunOzeti = Object.values(
            acikSorunKayitlari
                .filter(item => item.issueType === "missing")
                .reduce((ozet, item) => {
                    const anahtar = item.barcode || `${item.productName}|${item.color}|${item.size}`;

                    if (!ozet[anahtar]) {
                        ozet[anahtar] = {
                            productName: item.productName,
                            barcode: item.barcode,
                            color: item.color,
                            size: item.size,
                            missingQuantity: 0,
                            orderCodes: new Set()
                        };
                    }

                    ozet[anahtar].missingQuantity += Number(item.missingQuantity) || 1;
                    ozet[anahtar].orderCodes.add(item.orderCode);
                    return ozet;
                }, {})
        ).sort((a, b) => b.missingQuantity - a.missingQuantity);
        const siparisGruplari = Object.values(acikSorunKayitlari.reduce((gruplar, item) => {
            if (!gruplar[item.orderCode]) {
                gruplar[item.orderCode] = {
                    orderCode: item.orderCode,
                    customerName: item.customerName,
                    issues: []
                };
            }
            gruplar[item.orderCode].issues.push(item);
            return gruplar;
        }, {}));

        result.innerHTML = `
            <section class="issueTool">
                <div class="locationHeader">
                    <div>
                        <p class="eyebrow">Bekleyen İşler</p>
                        <h2>Eksik Siparişler</h2>
                        <p>${temizle(siparisGruplari.length)} sipariş · ${temizle(acikSorunKayitlari.length)} açık sorun</p>
                    </div>
                </div>
                <section class="shortageSummary">
                    <div class="sectionTitle">
                        <h3>Eksik Ürün Özeti</h3>
                        <span>${temizle(eksikUrunOzeti.reduce((toplam, item) => toplam + item.missingQuantity, 0))} adet eksik</span>
                    </div>
                    <div class="shortageGrid">
                        ${eksikUrunOzeti.length ? eksikUrunOzeti.map(item => `
                            <article class="shortageCard">
                                <div>
                                    <strong>${temizle(item.productName)}</strong>
                                    <span>${temizle(item.color || "-")} · ${temizle(item.size || "-")} · ${temizle(item.barcode || "Barkod yok")}</span>
                                    <small>${temizle(item.orderCodes.size)} siparişte eksik</small>
                                </div>
                                <b>${temizle(item.missingQuantity)} adet</b>
                            </article>
                        `).join("") : `
                            <div class="shortageEmpty">Eksik olarak işaretlenmiş ürün yok.</div>
                        `}
                    </div>
                </section>
                <div class="sectionTitle issueOrdersTitle">
                    <h3>Bekleyen Siparişler</h3>
                    <span>Eksik, hasarlı ve yanlış stok kayıtları</span>
                </div>
                <div class="issueOrderList">
                    ${siparisGruplari.length ? siparisGruplari.map(grup => `
                        <article class="issueOrderCard">
                            <div class="issueOrderHeader">
                                <div>
                                    <h3>${temizle(grup.customerName || "Müşteri")}</h3>
                                    <p>${temizle(grup.orderCode)}</p>
                                </div>
                                <button type="button" data-issue-order="${temizle(grup.orderCode)}">Siparişi Aç</button>
                            </div>
                            <div class="issueEntries">
                                ${grup.issues.map(item => `
                                    <div class="issueEntry">
                                        <div>
                                            <strong>${temizle(item.productName)}</strong>
                                            <span>${temizle(item.barcode || "-")} · ${temizle(sorunTurleri[item.issueType] || item.issueType)}${item.issueType === "missing" ? ` · ${temizle(item.missingQuantity)} adet` : ""}</span>
                                            ${item.note ? `<p>${temizle(item.note)}</p>` : ""}
                                            <small>${temizle(item.createdBy)} · ${temizle(tarihSaatGoster(item.createdAt))}</small>
                                        </div>
                                        <button type="button" data-resolve-issue="${temizle(item.id)}">Çözüldü</button>
                                    </div>
                                `).join("")}
                            </div>
                        </article>
                    `).join("") : `
                        <div class="issueEmpty">
                            <strong>Açık sorun kaydı yok</strong>
                            <span>Tüm siparişler hazırlama akışında devam edebilir.</span>
                        </div>
                    `}
                </div>
            </section>
        `;
    } catch (err) {
        result.innerHTML = `<div class="notfound">${temizle(err.message)}</div>`;
    }
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
        const acikSorun = urununAcikSorunu(index);
        const kismenOkutuldu = !hizmet && okutulan > 0 && !tamamlandi;
        const durumClass = acikSorun ? " issue" : hizmet ? " service" : tamamlandi ? " scanned" : kismenOkutuldu ? " partial" : "";
        const durumMetni = acikSorun
            ? `Beklemede · ${sorunTurleri[acikSorun.issueType]}`
            : hizmet ? "Doğrulama dışı"
                : tamamlandi ? "✅ Doğru ürün tamamlandı"
                    : okutulan > 0 ? "✅ Doğru ürün okutuldu" : "Bekliyor";
        const sira = acikSorun ? "!" : hizmet ? "H" : tamamlandi ? "✓" : index + 1;

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
                <div class="productActions">
                    <span class="productState">${temizle(durumMetni)}</span>
                    ${hizmet ? "" : `<button class="reportIssueButton${acikSorun ? " active" : ""}" type="button" data-report-issue="${index}">${acikSorun ? "Sorun Kaydı Açık" : "Sorun Bildir"}</button>`}
                </div>
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
    document.body.classList.remove("adminMode", "locationMode", "shipmentMode", "issueMode", "historyMode");
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
    hazirlamaKaydiGonder("complete", aktifSiparis).catch(err => console.error(err));
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

async function hazirlamaKaydiGonder(islem, siparis) {
    const response = await fetch(`/preparations/${islem}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            orderCode: siparisKodu(siparis),
            customerName: musteriAdi(siparis)
        })
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Hazırlama kaydı yazılamadı.");
    }
}

async function siparisSec(kod) {
    const siparis = siparisler.find(item => siparisKodu(item) === kod);

    if (!siparis) {
        result.innerHTML = `
            <div class="notfound">
                Sipariş bulunamadı.
            </div>
        `;
        return;
    }

    try {
        aktifSiparisSorunlari = await siparisSorunlariniGetir(kod);
    } catch (err) {
        aktifSiparisSorunlari = [];
        console.error(err);
    }

    hazirlamaKaydiGonder("start", siparis).catch(err => console.error(err));
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
    const sevkiyatSekmeButonu = event.target.closest("[data-shipment-view]");

    if (sevkiyatSekmeButonu) {
        sevkiyatAltSekmesiniGoster(sevkiyatSekmeButonu.dataset.shipmentView);
        return;
    }

    const sorunKapatButonu = event.target.closest("[data-close-issue]");

    if (sorunKapatButonu) {
        document.getElementById("issueDialog")?.remove();
        return;
    }

    const sorunBildirButonu = event.target.closest("[data-report-issue]");

    if (sorunBildirButonu) {
        sorunBildirmeFormuGoster(Number(sorunBildirButonu.dataset.reportIssue));
        return;
    }

    const sorunluSiparisButonu = event.target.closest("[data-issue-order]");

    if (sorunluSiparisButonu) {
        await siparisSec(sorunluSiparisButonu.dataset.issueOrder);
        return;
    }

    const sorunCozButonu = event.target.closest("[data-resolve-issue]");

    if (sorunCozButonu) {
        sorunCozButonu.disabled = true;

        try {
            const response = await fetch(`/issues/${encodeURIComponent(sorunCozButonu.dataset.resolveIssue)}/resolve`, {
                method: "PATCH"
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Sorun kaydı kapatılamadı.");
            }

            await sorunluSiparislerEkraniGoster();
        } catch (err) {
            sorunCozButonu.disabled = false;
            alert(err.message);
        }
        return;
    }

    const filtreTemizleButonu = event.target.closest("#clearActivityFilters");

    if (filtreTemizleButonu) {
        ["activitySearch", "activityUserFilter", "activityStatusFilter", "activityDateFrom", "activityDateTo"].forEach(id => {
            const alan = document.getElementById(id);

            if (alan) {
                alan.value = "";
            }
        });
        hazirlamaGecmisiniFiltrele();
        return;
    }

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
    const issueForm = event.target.closest("#issueForm");

    if (issueForm) {
        event.preventDefault();
        const index = Number(issueForm.dataset.productIndex);
        const urun = aktifSiparis?.products?.[index];
        const button = issueForm.querySelector(".issueSaveButton");

        if (!urun || !aktifSiparis) {
            return;
        }

        button.disabled = true;

        try {
            const response = await fetch("/issues", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    orderCode: siparisKodu(aktifSiparis),
                    customerName: musteriAdi(aktifSiparis),
                    productIndex: index,
                    productName: urunAdi(urun),
                    barcode: urunBarkodu(urun),
                    color: urunRengi(urun),
                    size: urunBedeni(urun),
                    missingQuantity: Number(issueForm.elements.missingQuantity.value),
                    issueType: issueForm.elements.issueType.value,
                    note: issueForm.elements.note.value
                })
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Sorun kaydı oluşturulamadı.");
            }

            aktifSiparisSorunlari.push(data.result);
            document.getElementById("issueDialog")?.remove();
            urunListesiGuncelle();
            mesajGoster("warning", "Sipariş beklemeye alındı", `${urunAdi(urun)} · ${sorunTurleri[data.result.issueType]}`);
        } catch (err) {
            button.disabled = false;
            alert(err.message);
        }
        return;
    }

    const loginForm = event.target.closest("#loginForm");

    if (loginForm) {
        event.preventDefault();
        const button = loginForm.querySelector("button");
        button.disabled = true;

        try {
            const response = await fetch("/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: loginForm.elements.username.value,
                    password: loginForm.elements.password.value
                })
            });
            const contentType = response.headers.get("content-type") || "";

            if (!contentType.includes("application/json")) {
                throw new Error("Sunucu gecici olarak hazir degil. Sayfayi yenileyip tekrar deneyin.");
            }

            const data = await response.json().catch(() => {
                throw new Error("Sunucudan gecersiz bir yanit alindi. Lutfen tekrar deneyin.");
            });

            if (!response.ok) {
                throw new Error(data.error || "Giriş yapılamadı.");
            }

            aktifKullanici = data.user;
            document.body.classList.remove("loginMode");
            kullaniciArayuzunuGuncelle();
            await yukle();
        } catch (err) {
            girisEkraniGoster(err.message);
        }
        return;
    }

    const createUserForm = event.target.closest("#createUserForm");

    if (createUserForm) {
        event.preventDefault();
        const button = createUserForm.querySelector("button");
        button.disabled = true;

        try {
            const response = await fetch("/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    displayName: createUserForm.elements.displayName.value,
                    username: createUserForm.elements.username.value,
                    password: createUserForm.elements.password.value,
                    role: createUserForm.elements.role.value
                })
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Kullanıcı oluşturulamadı.");
            }

            await yonetimEkraniGoster();
        } catch (err) {
            button.disabled = false;
            alert(err.message);
        }
        return;
    }

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
    if (event.target.id === "activitySearch") {
        hazirlamaGecmisiniFiltrele();
        return;
    }

    if (event.target.id !== "locationSearch") {
        return;
    }

    const sonuclar = rafKaydiAra(event.target.value);
    rafAramaSonuclariGoster(sonuclar);
});

result.addEventListener("change", function (event) {
    if (event.target.name === "issueType") {
        const alan = document.getElementById("missingQuantityField");
        const input = alan?.querySelector("input");
        const eksikMi = event.target.value === "missing";

        if (alan && input) {
            alan.hidden = !eksikMi;
            input.required = eksikMi;
        }
        return;
    }

    if (["activityUserFilter", "activityStatusFilter", "activityDateFrom", "activityDateTo"].includes(event.target.id)) {
        hazirlamaGecmisiniFiltrele();
    }
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

        if (this.dataset.tab === "users") {
            yonetimEkraniGoster();
        } else if (this.dataset.tab === "history") {
            hazirlamaGecmisiEkraniGoster();
        } else if (this.dataset.tab === "issues") {
            sorunluSiparislerEkraniGoster();
        } else if (this.dataset.tab === "shipments") {
            sevkiyatEkraniGoster();
        } else {
            rafEkraniGoster();
        }
    });
});

document.addEventListener("click", async event => {
    if (!event.target.closest("#logoutButton")) {
        return;
    }

    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    girisEkraniGoster();
});

window.addEventListener("beforeunload", scannerDurdur);

oturumuBaslat();
