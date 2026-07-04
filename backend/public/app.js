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
let sonRafAramaKayitlari = [];
let rafKayitlariPromise = null;
let sevkiyatKayitlari = [];
let aktifKullanici = null;
let yonetimHazirlamaKayitlari = [];
let aktifSiparisSorunlari = [];
let acikSorunKayitlari = [];
let aktifSevkiyatListesi = "pending";
let sevkiyatAramaMetni = "";
let aktifSiparisPlatformu = "trendyol";
let aktifSiparisSiralama = "newest";
let aktifSiparisDurumFiltresi = "";
let aktifSiparisGorunumu = "single";
let aktifTopluGruplar = [];
let aktifTopluSiparisler = [];
let aktifTopluSiparisIndex = 0;
const secilenSiparisKodlari = new Set();
let etiketBaskiKayitlari = {};
let siparisSayfaBoyutu = 10;
let aktifSiparisSayfasi = 1;
let aktifEksikPlatformu = "trendyol";
let aktifSevkiyatPlatformu = "trendyol";
let aktifGecmisPlatformu = "trendyol";
let bildirimler = [];
let bildirimZamanlayici = null;
let apiDurumZamanlayici = null;
let siparisYenilemeZamanlayici = null;
let siparisYenileniyor = false;
let urunGorselleri = {};
let urunGorselleriPromise = null;
let denetimAramaZamanlayici = null;
let rafAramaZamanlayici = null;
let rafAramaIstekNo = 0;
let aktifTaramaKaniti = [];
const apiUrunDetayCache = new Map();

const HIZMET_BARKODLARI = ["HZMBDL"];
const OKUMA_BEKLEME_MS = 450;
const TARAYICI_KARE_ARALIGI_MS = 90;

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
const apiStatusBanner = document.getElementById("apiStatusBanner");

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

function platformAnahtari(deger) {
    const metin = aramaNormalize(deger);
    return metin.includes("trendyol") ? "trendyol" : "zoombutik";
}

function platformSekmeleriHtml(scope, aktif, kayitlar, platformOkuyucu) {
    const trendyolSayisi = kayitlar.filter(item => platformAnahtari(platformOkuyucu(item)) === "trendyol").length;
    const zoombutikSayisi = kayitlar.filter(item => platformAnahtari(platformOkuyucu(item)) === "zoombutik").length;

    return `
        <div class="platformTabs" role="tablist" aria-label="Platform seçimi">
            <button type="button" role="tab" data-platform-scope="${temizle(scope)}" data-platform-value="trendyol" aria-selected="${aktif === "trendyol"}" class="${aktif === "trendyol" ? "active" : ""}">
                Trendyol <span>${temizle(trendyolSayisi)}</span>
            </button>
            <button type="button" role="tab" data-platform-scope="${temizle(scope)}" data-platform-value="zoombutik" aria-selected="${aktif === "zoombutik"}" class="${aktif === "zoombutik" ? "active" : ""}">
                Zoombutik <span>${temizle(zoombutikSayisi)}</span>
            </button>
        </div>
    `;
}

function siparisDurumu(item) {
    const durum = alanOku(item, ["order.status", "status"], "");
    return durumlar[durum] || durum || "-";
}

function yereldeHazirlanmisMi(item) {
    return item?.localPreparationStatus === "completed";
}

function siparisiYereldeHazirIsaretle(siparis) {
    const code = siparisKodu(siparis).toUpperCase();
    siparis.localPreparationStatus = "completed";
    siparisler.forEach(item => {
        if (siparisKodu(item).toUpperCase() === code) item.localPreparationStatus = "completed";
    });
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

function toplamTutarSayisi(item) {
    const deger = alanOku(item, [
        "order.total",
        "order.totalPrice",
        "order.grandTotal",
        "order.amount",
        "order.price",
        "total",
        "totalPrice",
        "grandTotal",
        "amount"
    ], 0);
    if (typeof deger === "number") return deger;
    const metin = String(deger).trim().replace(/[^\d,.-]/g, "");
    const normalize = metin.includes(",")
        ? metin.replaceAll(".", "").replace(",", ".")
        : metin;
    const sayi = Number(normalize);
    return Number.isFinite(sayi) ? sayi : 0;
}

function siparisToplamAdedi(item) {
    return (item.products || [])
        .filter(urun => !hizmetUrunuMu(urun))
        .reduce((toplam, urun) => toplam + urunAdedi(urun), 0);
}

function siparisSiralamaUygula(liste) {
    const sirali = [...liste];
    if (aktifSiparisSiralama === "amount") {
        return sirali.sort((a, b) => toplamTutarSayisi(b) - toplamTutarSayisi(a));
    }
    if (aktifSiparisSiralama === "quantity") {
        return sirali.sort((a, b) => siparisToplamAdedi(b) - siparisToplamAdedi(a));
    }
    if (aktifSiparisSiralama === "customer") {
        return sirali.sort((a, b) => musteriAdi(a).localeCompare(musteriAdi(b), "tr"));
    }
    return sirali;
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

function urunKodu(urun) {
    return alanOku(urun, [
        "code",
        "productCode",
        "product.code",
        "product.productCode",
        "sku",
        "modelCode",
        "stockCode",
        "variant.code",
        "parent.code",
        "parent.productCode"
    ], "");
}

function urunBarkodu(urun) {
    return alanOku(urun, [
        "barcode",
        "barCode"
    ]);
}

function urunProductId(urun) {
    return alanOku(urun, ["productId", "product.id", "id"], "");
}

function urunGorseli(urun) {
    const dogrudanDeger = alanOku(urun, [
        "imageUrl",
        "image",
        "images.0.imagesUrl",
        "images.0.imageUrl",
        "images.0.url"
    ], "");
    const dogrudan = typeof dogrudanDeger === "string" ? dogrudanDeger : "";

    const productId = urunProductId(urun);
    const resolved = dogrudan || urunGorselleri[String(productId)] || "";
    return resolved && productId ? `/product-image/${encodeURIComponent(productId)}` : resolved;
}

async function urunGorselleriniYukle() {
    if (urunGorselleriPromise) {
        return urunGorselleriPromise;
    }

    const ids = [...new Set(
        siparisler.flatMap(siparis => siparis.products || []).map(urunProductId).filter(Boolean)
    )];

    if (!ids.length) {
        return {};
    }

    const batches = [];
    for (let index = 0; index < ids.length; index += 100) {
        batches.push(ids.slice(index, index + 100));
    }

    urunGorselleriPromise = Promise.all(batches.map(batch => fetch("/product-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch })
    }).then(response => response.ok ? response.json() : Promise.reject(new Error("Ürün görselleri alınamadı.")))))
        .then(responses => {
            responses.forEach(data => {
                urunGorselleri = { ...urunGorselleri, ...data.result };
            });

            if (aktifSekme === "orders" && !aktifSiparis) {
                listeGoster(aktifListe);
            } else if (aktifSiparis) {
                urunListesiGuncelle();
            }

            return urunGorselleri;
        })
        .catch(err => {
            console.error(err);
            return urunGorselleri;
        })
        .finally(() => {
            urunGorselleriPromise = null;
        });

    return urunGorselleriPromise;
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

    const variants = Array.isArray(urun?.variants) ? urun.variants : [];
    const bedenVaryanti = variants.find(item =>
        aramaNormalize(item?.name || item?.key || item?.title).includes("beden")
    );
    if (bedenVaryanti) {
        const value = bedenVaryanti.value ?? bedenVaryanti.nameValue ?? bedenVaryanti.optionValue;
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
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

function urunRafKodu(urun) {
    return String(urun.__location || "").trim() || "-";
}

async function siparisRafRotasiniUygula(siparis) {
    await rafKayitlariniGetir().catch(() => []);
    const locations = new Map(rafKayitListesi.map(item => [barkodKarsilastir(item.barcode), item.location]));
    (siparis.products || []).forEach(urun => {
        urun.__location = locations.get(barkodKarsilastir(urunBarkodu(urun))) || "";
    });
    siparis.products = [...(siparis.products || [])].sort((a, b) => {
        const locationA = urunRafKodu(a) === "-" ? "ZZZZZZ" : urunRafKodu(a);
        const locationB = urunRafKodu(b) === "-" ? "ZZZZZZ" : urunRafKodu(b);
        return locationA.localeCompare(locationB, "tr", { numeric: true })
            || urunAdi(a).localeCompare(urunAdi(b), "tr");
    });
    return siparis;
}

function siparisUrunImzasi(siparis) {
    return (siparis.products || [])
        .filter(urun => !hizmetUrunuMu(urun))
        .map(urun => `${barkodKarsilastir(urunBarkodu(urun))}|${urunAdedi(urun)}`)
        .sort()
        .join(";");
}

function ayniUrunluSiparisGruplari(liste) {
    const groups = new Map();
    liste.forEach(siparis => {
        const signature = siparisUrunImzasi(siparis);
        if (!signature) return;
        if (!groups.has(signature)) groups.set(signature, []);
        groups.get(signature).push(siparis);
    });
    return [...groups.entries()]
        .filter(([, orders]) => orders.length > 1)
        .map(([signature, orders]) => ({ signature, orders }))
        .sort((a, b) => b.orders.length - a.orders.length);
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

async function kameraNetliginiArtir(video) {
    const track = video.srcObject?.getVideoTracks?.()[0];
    if (!track?.applyConstraints || !track.getCapabilities) return;

    try {
        const capabilities = track.getCapabilities();
        const advanced = {};

        if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
            advanced.focusMode = "continuous";
        }
        if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("continuous")) {
            advanced.exposureMode = "continuous";
        }
        if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes("continuous")) {
            advanced.whiteBalanceMode = "continuous";
        }

        if (Object.keys(advanced).length) {
            await track.applyConstraints({ advanced: [advanced] });
        }
    } catch (err) {
        console.warn("Kamera netlik ayarı uygulanamadı.", err);
    }
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
        const hints = new Map();
        const formats = mod === "shipment"
            ? [ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39]
            : [
                ZXing.BarcodeFormat.EAN_13,
                ZXing.BarcodeFormat.EAN_8,
                ZXing.BarcodeFormat.UPC_A,
                ZXing.BarcodeFormat.UPC_E,
                ZXing.BarcodeFormat.CODE_128,
                ZXing.BarcodeFormat.CODE_39,
                ZXing.BarcodeFormat.ITF
            ];
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
        scanner = new ZXing.BrowserMultiFormatReader(hints, TARAYICI_KARE_ARALIGI_MS);
        scannerAktif = true;

        const okumaSonucu = (okunan, hata) => {
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
        };
        const videoConstraints = {
            audio: false,
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30, min: 20 }
            }
        };

        if (typeof scanner.decodeFromConstraints === "function") {
            await scanner.decodeFromConstraints(videoConstraints, video, okumaSonucu);
        } else {
            await scanner.decodeFromVideoDevice(null, video, okumaSonucu);
        }
        await kameraNetliginiArtir(video);

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
    aktifTaramaKaniti.push({
        barcode: barkod,
        productName: urunAdi(eksikUrun.urun),
        quantityIndex: taramaDurumu[eksikUrun.index],
        scannedAt: new Date().toISOString()
    });
    hazirlamaKilitleriniYenile().catch(() =>
        mesajGoster("warning", "Bağlantı kesildi", "Hazırlama kilidi yenilenemedi.")
    );
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
        siparisiTamamla();
    }
}

async function hazirlamaKilitleriniYenile() {
    const orders = aktifTopluSiparisler.length
        ? aktifTopluSiparisler.slice(aktifTopluSiparisIndex)
        : [aktifSiparis];
    const responses = await Promise.all(orders.map(order => fetch("/preparations/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCode: siparisKodu(order) })
    })));
    const failed = responses.find(response => !response.ok);
    if (failed) {
        const data = await failed.json().catch(() => ({}));
        mesajGoster("error", "Hazırlama kilidi yenilenemedi", data.error || "Bağlantıyı kontrol edin.");
    }
}

function girisEkraniGoster(hata = "") {
    scannerDurdur();
    if (bildirimZamanlayici) {
        clearInterval(bildirimZamanlayici);
        bildirimZamanlayici = null;
    }
    if (apiDurumZamanlayici) {
        clearInterval(apiDurumZamanlayici);
        apiDurumZamanlayici = null;
    }
    if (siparisYenilemeZamanlayici) {
        clearInterval(siparisYenilemeZamanlayici);
        siparisYenilemeZamanlayici = null;
    }
    apiStatusBanner.hidden = true;
    aktifKullanici = null;
    document.body.className = "loginMode";
    document.querySelector(".topTabs").hidden = true;
    document.querySelector(".searchBox").hidden = true;
    userBar.hidden = true;
    result.innerHTML = `
        <section class="loginPanel">
            <div class="loginIcon">Z</div>
            <p class="eyebrow">Zoom Depo Pro</p>
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
        <div class="notificationShell">
            <button class="notificationButton" type="button" id="notificationButton" aria-label="Bildirimler">
                🔔 <span id="notificationCount" hidden>0</span>
            </button>
            <div class="notificationPanel" id="notificationPanel" hidden></div>
        </div>
        <button type="button" id="logoutButton">Çıkış</button>
    `;
    bildirimleriGetir();
    apiDurumunuGetir();

    if (!bildirimZamanlayici) {
        bildirimZamanlayici = window.setInterval(bildirimleriGetir, 60000);
    }
    if (!apiDurumZamanlayici) {
        apiDurumZamanlayici = window.setInterval(apiDurumunuGetir, 60000);
    }
    if (!siparisYenilemeZamanlayici) {
        siparisYenilemeZamanlayici = window.setInterval(siparisleriSessizYenile, 15000);
    }
}

async function apiDurumunuGetir() {
    if (!aktifKullanici) {
        return;
    }

    try {
        const response = await fetch("/api-status");
        const data = await response.json();

        if (!response.ok || data.healthy !== false) {
            apiStatusBanner.hidden = true;
            return;
        }

        const zaman = data.lastErrorAt ? tarihSaatGoster(data.lastErrorAt) : "";
        apiStatusBanner.innerHTML = `
            <strong>Qukasoft API bağlantısı kesildi.</strong>
            <span>${siparisler.length
                ? "Son başarılı sipariş listesi gösteriliyor; yeni siparişler bağlantı gelince otomatik eklenecek."
                : "Siparişler şu anda alınamıyor."}${zaman ? ` Son hata: ${temizle(zaman)}` : ""}</span>
        `;
        apiStatusBanner.hidden = false;
    } catch (err) {
        apiStatusBanner.hidden = true;
    }
}

async function bildirimleriGetir() {
    if (!aktifKullanici) {
        return;
    }

    try {
        const response = await fetch("/notifications");
        const data = await response.json();

        if (!response.ok) {
            return;
        }

        bildirimler = data.result;
        bildirimPaneliniGuncelle();
    } catch (err) {
        console.error(err);
    }
}

function bildirimPaneliniGuncelle() {
    const panel = document.getElementById("notificationPanel");
    const sayac = document.getElementById("notificationCount");
    const okunmamis = bildirimler.filter(item => !item.read).length;

    if (sayac) {
        sayac.textContent = okunmamis > 99 ? "99+" : okunmamis;
        sayac.hidden = okunmamis === 0;
    }

    if (!panel) {
        return;
    }

    panel.innerHTML = `
        <div class="notificationHeader">
            <strong>Bildirimler</strong>
            <span>${okunmamis} okunmamış</span>
        </div>
        <div class="notificationList">
            ${bildirimler.length ? bildirimler.map(item => `
                <button type="button" class="notificationItem${item.read ? "" : " unread"}" data-notification-order="${temizle(item.orderCode)}">
                    <strong>${temizle(item.title)}</strong>
                    <span>${temizle(item.message)}</span>
                    <small>${temizle(tarihSaatGoster(item.createdAt))}</small>
                </button>
            `).join("") : `<div class="notificationEmpty">Henüz bildirim yok.</div>`}
        </div>
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
        const [response] = await Promise.all([
            fetch("/orders"),
            etiketBaskiKayitlariniGetir()
        ]);
        const data = await response.json();

        siparisler = data.result.list;
        aktifListe = siparisler;
        urunGorselleriniYukle();

        if (aktifSekme === "orders") {
            listeGoster(aktifListe);
            if (data.stale) {
                result.insertAdjacentHTML("afterbegin", `
                    <div class="staleOrdersNotice">
                        <strong>Çevrimdışı sipariş listesi</strong>
                        <span>${temizle(data.warning || "Son başarılı kayıtlar gösteriliyor.")}</span>
                    </div>
                `);
            }
        } else if (aktifSekme === "shipments") {
            sevkiyatListeleriniGoster();
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

async function siparisleriSessizYenile() {
    if (!aktifKullanici || siparisYenileniyor || document.hidden) return;
    siparisYenileniyor = true;

    try {
        const response = await fetch("/orders", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Siparişler yenilenemedi.");

        const yeniListe = Array.isArray(data?.result?.list) ? data.result.list : [];
        const eskiKodlar = new Set(siparisler.map(siparisKodu));
        const yeniSiparisSayisi = yeniListe.filter(item => !eskiKodlar.has(siparisKodu(item))).length;
        siparisler = yeniListe;
        aktifListe = yeniListe;

        if (aktifSekme === "orders" && !document.body.classList.contains("detailMode")) {
            searchInput.dispatchEvent(new Event("keyup"));
        } else if (aktifSekme === "shipments") {
            sevkiyatListeleriniGoster();
        }

        if (yeniSiparisSayisi > 0 && aktifSekme === "orders" && !document.body.classList.contains("detailMode")) {
            const platformAlani = document.querySelector(".platformTabs");
            platformAlani?.insertAdjacentHTML(
                "afterend",
                `<div class="newOrdersNotice">${temizle(yeniSiparisSayisi)} yeni sipariş otomatik eklendi.</div>`
            );
        }
    } catch (err) {
        console.error(err);
    } finally {
        siparisYenileniyor = false;
    }
}

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) siparisleriSessizYenile();
});

function listeGoster(liste) {
    scannerDurdur();
    const activeCodes = new Set(siparisler.map(siparisKodu));
    [...secilenSiparisKodlari].forEach(code => {
        if (!activeCodes.has(code)) secilenSiparisKodlari.delete(code);
    });
    aktifSiparis = null;
    aktifTopluSiparisler = [];
    aktifTopluSiparisIndex = 0;
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

    const hazirlanacakListe = liste.filter(item => !yereldeHazirlanmisMi(item));
    const platformListesi = siparisSiralamaUygula(hazirlanacakListe.filter(item =>
        platformAnahtari(platformAdi(item)) === aktifSiparisPlatformu
        && (!aktifSiparisDurumFiltresi || String(alanOku(item, ["order.status", "status"], "")) === aktifSiparisDurumFiltresi)
    ));
    const toplamSayfa = Math.max(1, Math.ceil(platformListesi.length / siparisSayfaBoyutu));
    aktifSiparisSayfasi = Math.min(Math.max(1, aktifSiparisSayfasi), toplamSayfa);
    const sayfaBaslangici = (aktifSiparisSayfasi - 1) * siparisSayfaBoyutu;
    const sayfadakiSiparisler = platformListesi.slice(sayfaBaslangici, sayfaBaslangici + siparisSayfaBoyutu);
    result.innerHTML = `
        ${platformSekmeleriHtml("orders", aktifSiparisPlatformu, hazirlanacakListe, platformAdi)}
        <div class="orderListControls">
            <label>
                <span>Sıralama</span>
                <select id="orderSort">
                    <option value="newest" ${aktifSiparisSiralama === "newest" ? "selected" : ""}>En Yeni Siparişler</option>
                    <option value="amount" ${aktifSiparisSiralama === "amount" ? "selected" : ""}>En Yüksek Tutar</option>
                    <option value="quantity" ${aktifSiparisSiralama === "quantity" ? "selected" : ""}>En Çok Adet</option>
                    <option value="customer" ${aktifSiparisSiralama === "customer" ? "selected" : ""}>Müşteri A-Z</option>
                </select>
            </label>
            <label>
                <span>Durum</span>
                <select id="orderStatusFilter">
                    <option value="" ${aktifSiparisDurumFiltresi === "" ? "selected" : ""}>Tüm Aktif Siparişler</option>
                    <option value="1" ${aktifSiparisDurumFiltresi === "1" ? "selected" : ""}>Yeni Sipariş</option>
                    <option value="2" ${aktifSiparisDurumFiltresi === "2" ? "selected" : ""}>Hazırlanıyor</option>
                </select>
            </label>
            <label>
                <span>Hazırlama şekli</span>
                <select id="orderViewMode">
                    <option value="single" ${aktifSiparisGorunumu === "single" ? "selected" : ""}>Tek Siparişler</option>
                    <option value="batch" ${aktifSiparisGorunumu === "batch" ? "selected" : ""}>Aynı Ürünlü Gruplar</option>
                </select>
            </label>
            <label>
                <span>Sayfa boyutu</span>
                <select id="orderPageSize">
                    ${[10, 30, 50].map(size => `<option value="${size}" ${siparisSayfaBoyutu === size ? "selected" : ""}>${size} sipariş</option>`).join("")}
                </select>
            </label>
            <div class="orderResultCount">
                <span>Gösterilen</span>
                <strong>${temizle(sayfadakiSiparisler.length)} / ${temizle(platformListesi.length)} sipariş</strong>
            </div>
        </div>
        <div class="bulkLabelControls" ${aktifSiparisGorunumu === "single" ? "" : "hidden"}>
            <div>
                <strong>Kargo etiketi seçimi</strong>
                <span id="selectedOrderCount">${temizle(secilenSiparisKodlari.size)} sipariş seçildi</span>
            </div>
            <button type="button" data-select-all-orders>Tümünü Seç</button>
            <button type="button" data-clear-order-selection>Seçimi Kaldır</button>
            <button class="cargoLabelButton" type="button" data-print-selected-orders ${secilenSiparisKodlari.size ? "" : "disabled"}>
                Seçilen Kargo Etiketlerini Yazdır
            </button>
        </div>
        <div class="orderPagination" ${platformListesi.length > siparisSayfaBoyutu ? "" : "hidden"}>
            <button type="button" data-order-page="${aktifSiparisSayfasi - 1}" ${aktifSiparisSayfasi <= 1 ? "disabled" : ""}>← Önceki</button>
            <strong>Sayfa ${temizle(aktifSiparisSayfasi)} / ${temizle(toplamSayfa)}</strong>
            <button type="button" data-order-page="${aktifSiparisSayfasi + 1}" ${aktifSiparisSayfasi >= toplamSayfa ? "disabled" : ""}>Sonraki →</button>
        </div>
    `;

    if (aktifSiparisGorunumu === "batch") {
        aktifTopluGruplar = ayniUrunluSiparisGruplari(platformListesi);
        if (!aktifTopluGruplar.length) {
            result.innerHTML += `<div class="notfound">Bu listede ürün ve adetleri tamamen aynı olan sipariş grubu yok.</div>`;
            return;
        }
        result.innerHTML += `<div class="batchOrderGrid">${aktifTopluGruplar.map((group, index) => {
            const sampleProducts = group.orders[0].products.filter(urun => !hizmetUrunuMu(urun));
            return `
                <article class="orderCard batchOrderCard">
                    <div class="cardTop"><div><h2>${temizle(group.orders.length)} Aynı Sipariş</h2>
                    <p>${temizle(sampleProducts.length)} farklı ürün · toplam ${temizle(siparisToplamAdedi(group.orders[0]) * group.orders.length)} adet</p></div>
                    <span class="cardStatus">Toplu</span></div>
                    <div class="batchProductPreview">${sampleProducts.map(urun => `
                        <span>${temizle(urunAdi(urun))} · ${temizle(urunRengi(urun))} · ${temizle(urunBedeni(urun))} · ${temizle(urunAdedi(urun))} adet</span>
                    `).join("")}</div>
                    <div class="batchOrderCodes">${group.orders.map(order => `<small>${temizle(siparisKodu(order))}</small>`).join("")}</div>
                    <p class="batchHint">Siparişler sırayla açılır; her sipariş için barkodlar ayrı okutulur.</p>
                    <button class="openOrderButton" type="button" data-batch-index="${index}">Toplu Hazırlamayı Aç</button>
                </article>
            `;
        }).join("")}</div>`;
        return;
    }

    if (platformListesi.length === 0) {
        result.innerHTML += `
            <div class="notfound">
                Bu platformda sipariş bulunamadı.
            </div>
        `;

        return;
    }

    sayfadakiSiparisler.forEach(item => {
        const kod = siparisKodu(item);
        const urunSayisi = (item.products || []).length;

        result.innerHTML += `
            <article class="orderCard">
                <div class="cardTop">
                    <label class="orderSelect">
                        <input type="checkbox" data-select-order="${temizle(kod)}"
                            ${secilenSiparisKodlari.has(kod) ? "checked" : ""}
                            ${kargoEtiketiBarkodu(item) ? "" : "disabled"}>
                        <span>Etiket için seç</span>
                    </label>
                    <div class="orderCardIdentity">
                        <h2>${temizle(musteriAdi(item))}</h2>
                        <p>Sipariş No: <strong>${temizle(kod)}</strong></p>
                        ${etiketBaskiKaydi(item) ? `
                            <span class="printedLabelBadge" title="${temizle(etiketBaskiKaydi(item).lastPrintedBy)} · ${temizle(tarihSaatGoster(etiketBaskiKaydi(item).lastPrintedAt))}">
                                ✓ Yazdırıldı · ${temizle(etiketBaskiKaydi(item).printCount)} kez
                            </span>
                        ` : ""}
                    </div>
                    <span class="cardStatus">${temizle(siparisDurumu(item))}</span>
                </div>

                <div class="cardMeta">
                    <span><b>Platform</b>${temizle(platformAdi(item))}</span>
                    <span><b>Ürün Sayısı</b>${temizle(urunSayisi)}</span>
                </div>

                <div class="orderCardActions">
                    <button class="cargoLabelButton" type="button" data-print-cargo-order="${temizle(kod)}">
                        100×100 Kargo Etiketi
                    </button>
                    <button class="openOrderButton" type="button" data-order-code="${temizle(kod)}">
                        📦 Siparişi Aç
                    </button>
                </div>
            </article>
        `;
    });
}

function sekmeDurumuGuncelle() {
    tabButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.tab === aktifSekme);
    });
}

function secimKontrolleriniGuncelle() {
    const count = document.getElementById("selectedOrderCount");
    const printButton = document.querySelector("[data-print-selected-orders]");
    if (count) count.textContent = `${secilenSiparisKodlari.size} sipariş seçildi`;
    if (printButton) printButton.disabled = secilenSiparisKodlari.size === 0;
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
            code: urunKodu(urun),
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

async function apiUrunAraSunucuda(query = "", barcode = "") {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (barcode) params.set("barcode", barcode);
    const response = await fetch(`/products/search?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.error || "Ürün araması yapılamadı.");
        error.code = data.code;
        throw error;
    }
    return (Array.isArray(data.result) ? data.result : []).map(item => ({
        ...item,
        rawProduct: item,
        rawVariant: item,
        rawListItem: item,
        rawListVariant: item,
        rawDetailItem: null
    }));
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
            urun.code,
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
    const gorselUrl = kayit.imageUrl || (kayit.productId ? `/product-image/${encodeURIComponent(kayit.productId)}` : "");

    return `
        <article class="locationResultCard${kartClass}">
            <div class="locationProductHeader">
                <div class="locationProductImage">
                    ${gorselUrl
                        ? `<img src="${temizle(gorselUrl)}" alt="${temizle(kayit.name)}" loading="lazy">`
                        : `<span>Görsel yok</span>`}
                </div>
                <div>
                    <p class="eyebrow">${kayit.hasLocation ? "Raf Konumu" : "Ürün Bulundu"}</p>
                    <h3>${temizle(kayit.name)}</h3>
                    <span class="locationProductCode">Ürün Kodu: ${temizle(kayit.code || "Tanımlı değil")}</span>
                </div>
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
                <div>
                    <dt>Ürün Kodu</dt>
                    <dd>${temizle(kayit.code || "-")}</dd>
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

function barkodYazdirmaFormati(barkod) {
    const deger = String(barkod || "").trim();
    if (!/^\d{13}$/.test(deger)) return "CODE128";

    const toplam = deger
        .slice(0, 12)
        .split("")
        .reduce((sum, rakam, index) => sum + Number(rakam) * (index % 2 === 0 ? 1 : 3), 0);
    const kontrolBasamagi = (10 - (toplam % 10)) % 10;
    return kontrolBasamagi === Number(deger[12]) ? "EAN13" : "CODE128";
}

function urunEtiketiYazdir(etiket, tamamlandi) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.left = "-10000px";
    frame.style.top = "0";
    frame.style.width = "50mm";
    frame.style.height = "30mm";
    frame.style.border = "0";

    const temizle = () => {
        frame.remove();
        tamamlandi();
    };

    frame.addEventListener("load", () => {
        const printWindow = frame.contentWindow;
        if (!printWindow) {
            temizle();
            mesajGoster("error", "Yazdırma penceresi açılamadı", "Tarayıcının yazdırma iznini kontrol edin.");
            return;
        }

        printWindow.addEventListener("afterprint", temizle, { once: true });
        printWindow.requestAnimationFrame(() => {
            printWindow.requestAnimationFrame(() => {
                window.setTimeout(() => {
                    try {
                        printWindow.focus();
                        printWindow.print();
                    } catch {
                        temizle();
                        mesajGoster("error", "Yazdırma penceresi açılamadı", "Tarayıcının yazdırma iznini kontrol edin.");
                    }
                }, 250);
            });
        });
    }, { once: true });

    frame.srcdoc = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>50x30 Ürün Barkodu</title>
            <style>
                @page { size: 50mm 30mm; margin: 0; }
                * { box-sizing: border-box; }
                html, body {
                    width: 50mm;
                    height: 30mm;
                    margin: 0;
                    padding: 0;
                    overflow: hidden;
                    background: #fff;
                }
                .barcodeLabel {
                    display: grid;
                    grid-template-rows: 3mm 3mm 3mm minmax(0, 1fr);
                    align-items: center;
                    width: 50mm;
                    height: 30mm;
                    margin: 0;
                    padding: 1.2mm;
                    overflow: hidden;
                    background: #fff;
                    color: #000;
                    font-family: Arial, sans-serif;
                }
                .barcodeLabelName {
                    display: block;
                    overflow: hidden;
                    font-size: 8pt;
                    line-height: 3mm;
                    text-align: center;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .barcodeLabelCode {
                    display: block;
                    overflow: hidden;
                    min-width: 0;
                    font-size: 6.5pt;
                    font-weight: 700;
                    line-height: 3mm;
                    text-align: center;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .barcodeLabelVariant {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 3mm;
                    min-width: 0;
                    font-size: 7.5pt;
                    font-weight: 800;
                    line-height: 3mm;
                }
                svg {
                    display: block;
                    width: 100%;
                    height: 100%;
                    min-height: 0;
                }
            </style>
        </head>
        <body>${etiket.outerHTML}</body>
        </html>
    `;
    document.body.appendChild(frame);
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
                <span class="barcodeLabelCode">${kayit.code ? `Ürün Kodu: ${temizle(kayit.code)}` : "&nbsp;"}</span>
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
        format: barkodYazdirmaFormati(kayit.barcode),
        width: 2.5,
        height: 62,
        displayValue: true,
        fontSize: 15,
        textMargin: 2,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 12,
        marginRight: 12
    });

    modal.querySelectorAll(".closePrintModal").forEach(button => {
        button.addEventListener("click", () => modal.remove());
    });

    const yazdirButonu = modal.querySelector("#printBarcodeNow");
    yazdirButonu.addEventListener("click", () => {
        yazdirButonu.disabled = true;
        yazdirButonu.textContent = "Yazdırılıyor...";
        const etiket = modal.querySelector("#barcodeLabel");
        urunEtiketiYazdir(etiket, () => {
            yazdirButonu.disabled = false;
            yazdirButonu.textContent = "Yazdır";
        });
    });
}

function urunKaydiniBarkodlaBul(barkod) {
    const key = barkodKarsilastir(barkod);
    return sonRafAramaKayitlari.find(item => barkodKarsilastir(item.barcode) === key)
        || apiUrunleri?.find(item => barkodKarsilastir(item.barcode) === key)
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
            code: kayit.code || "",
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
    sonRafAramaKayitlari = [kayit];

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
        mesajGoster("info", "Raf kaydı bulunamadı", "Ürün kataloğunda aranıyor...");
        const urunler = await apiUrunAraSunucuda("", barkod);
        const apiUrun = urunler[0];

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
        const istekNo = ++rafAramaIstekNo;
        mesajGoster("info", "Ürünler aranıyor", "Hızlı ürün kataloğu kontrol ediliyor...");
        const apiSonuclar = await apiUrunAraSunucuda(arama.value);
        if (istekNo !== rafAramaIstekNo) return;
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
        sonRafAramaKayitlari = zenginSonuclar;

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
                <span>Ürünü bulun, raf kodunu girin ve Zoom Depo'ya kaydedin.</span>
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
    return `ZOOM-ORDER-${siparisKodu(siparis)}`;
}

function kargoGonderiKodu(siparis) {
    return String(alanOku(siparis, [
        "order.shipmentCode",
        "order.shipmentCode2",
        "shipmentCode",
        "cargoCode",
        "trackingNumber"
    ], "")).trim();
}

function kargoEtiketiBarkodu(siparis) {
    return kargoGonderiKodu(siparis) || sevkiyatBarkodu(siparis);
}

function kargoFirmaEtiketi(siparis) {
    const firma = String(alanOku(siparis, ["order.shipmentFirmName", "shipmentFirmName"], "Kargo")).trim();
    return aramaNormalize(firma).includes("surat") ? "Sürat Kargo" : firma;
}

function teslimatAdresi(siparis) {
    const address = alanOku(siparis, ["customer.delivery.address", "delivery.address", "shippingAddress.address"], "");
    const district = alanOku(siparis, ["customer.delivery.district", "delivery.district", "shippingAddress.district"], "");
    const city = alanOku(siparis, ["customer.delivery.city", "delivery.city", "shippingAddress.city"], "");
    return {
        address: String(address || "").trim(),
        district: String(district || "").trim(),
        city: String(city || "").trim()
    };
}

async function etiketBaskiKayitlariniGetir() {
    try {
        const response = await fetch("/label-prints", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Etiket geçmişi alınamadı.");
        etiketBaskiKayitlari = Object.fromEntries(
            (data.result || []).map(item => [String(item.orderCode).toUpperCase(), item])
        );
    } catch (err) {
        console.error(err);
    }
}

function etiketBaskiKaydi(order) {
    return etiketBaskiKayitlari[siparisKodu(order).toUpperCase()] || null;
}

async function etiketBaskisiniKaydet(orders) {
    const orderCodes = orders.map(siparisKodu).filter(Boolean);
    const response = await fetch("/label-prints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCodes })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Etiket baskısı kaydedilemedi.");
    await etiketBaskiKayitlariniGetir();
}

function kargoCikisEtiketiGoster(siparis) {
    const shipmentCode = kargoEtiketiBarkodu(siparis);
    if (!shipmentCode) {
        alert("Sipariş barkodu oluşturulamadı.");
        return;
    }
    const dahiliBarkod = !kargoGonderiKodu(siparis);
    const previousPrint = etiketBaskiKaydi(siparis);
    if (previousPrint && !confirm(
        `Bu siparişin etiketi daha önce ${previousPrint.printCount} kez yazdırıldı.\n`
        + `Son baskı: ${previousPrint.lastPrintedBy} · ${tarihSaatGoster(previousPrint.lastPrintedAt)}\n\nTekrar yazdırılsın mı?`
    )) return;

    document.getElementById("barcodePrintModal")?.remove();
    const delivery = teslimatAdresi(siparis);
    const carrier = kargoFirmaEtiketi(siparis);
    const phone = alanOku(siparis, ["customer.phone", "phone"], "");
    const modal = document.createElement("div");
    modal.id = "barcodePrintModal";
    modal.className = "barcodePrintModal cargoPrintModal";
    modal.innerHTML = `
        <div class="barcodePrintDialog" role="dialog" aria-modal="true" aria-labelledby="cargoPrintTitle">
            <div class="barcodePrintHeader">
                <div><p class="eyebrow">100 x 100 mm Zebra Etiketi</p><h2 id="cargoPrintTitle">Kargo Çıkış Etiketi</h2></div>
                <button class="closePrintModal" type="button" aria-label="Kapat">&times;</button>
            </div>
            <div class="barcodeLabel cargoShippingLabel">
                <div class="cargoLabelTop">
                    <strong>${temizle(carrier)}</strong>
                    <span>${temizle(platformAdi(siparis))}</span>
                </div>
                <div class="cargoCustomer">
                    <strong>${temizle(musteriAdi(siparis))}</strong>
                    ${phone ? `<span>${temizle(phone)}</span>` : ""}
                </div>
                <p class="cargoAddress">${temizle(delivery.address || "Adres bilgisi yok")}</p>
                <strong class="cargoCity">${temizle([delivery.district, delivery.city].filter(Boolean).join(" / ") || "-")}</strong>
                <div class="cargoBarcodeArea">
                    <svg id="cargoBarcodeSvg" aria-label="${temizle(shipmentCode)}"></svg>
                    <span>${dahiliBarkod ? "Dahili barkod" : "Kargo barkodu"} · Sipariş: ${temizle(siparisKodu(siparis))}</span>
                </div>
            </div>
            <div class="barcodePrintActions">
                <button class="removeLocationButton closePrintModal" type="button">İptal</button>
                <button class="saveLocationButton" id="printCargoNow" type="button">Zebra'ya Yazdır</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    if (typeof JsBarcode !== "function") {
        modal.remove();
        mesajGoster("error", "Barkod oluşturulamadı", "Barkod kütüphanesi yüklenemedi.");
        return;
    }
    JsBarcode("#cargoBarcodeSvg", shipmentCode, {
        format: "CODE128",
        width: 2.2,
        height: 55,
        displayValue: true,
        fontSize: 15,
        margin: 0
    });
    modal.querySelectorAll(".closePrintModal").forEach(button =>
        button.addEventListener("click", () => modal.remove())
    );
    modal.querySelector("#printCargoNow").addEventListener("click", async () => {
        try {
            await etiketBaskisiniKaydet([siparis]);
        } catch (err) {
            mesajGoster("error", "Baskı kaydı oluşturulamadı", err.message);
            return;
        }
        const pageStyle = document.createElement("style");
        pageStyle.textContent = "@page{size:100mm 100mm;margin:0}";
        document.head.appendChild(pageStyle);
        window.print();
        window.setTimeout(() => pageStyle.remove(), 500);
    });
}

function topluKargoEtiketleriGoster(orders) {
    const printable = orders.filter(order => kargoEtiketiBarkodu(order));
    if (!printable.length) {
        mesajGoster("warning", "Yazdırılabilir etiket yok", "Seçilen siparişlerin kargo kodu henüz oluşmamış.");
        return;
    }
    const previouslyPrinted = printable.filter(order => etiketBaskiKaydi(order));
    if (previouslyPrinted.length && !confirm(
        `${previouslyPrinted.length} sipariş etiketi daha önce yazdırılmış.\n`
        + `Toplam ${printable.length} etiket tekrar yazdırılsın mı?`
    )) return;

    document.getElementById("barcodePrintModal")?.remove();
    const modal = document.createElement("div");
    modal.id = "barcodePrintModal";
    modal.className = "barcodePrintModal cargoPrintModal bulkCargoPrintModal";
    modal.innerHTML = `
        <div class="barcodePrintDialog" role="dialog" aria-modal="true" aria-labelledby="bulkCargoPrintTitle">
            <div class="barcodePrintHeader">
                <div><p class="eyebrow">100 x 100 mm Zebra Etiketleri</p>
                <h2 id="bulkCargoPrintTitle">${temizle(printable.length)} Kargo Etiketi</h2></div>
                <button class="closePrintModal" type="button" aria-label="Kapat">&times;</button>
            </div>
            <div class="bulkCargoLabels">
                ${printable.map((order, index) => {
                    const delivery = teslimatAdresi(order);
                    const carrier = kargoFirmaEtiketi(order);
                    const phone = alanOku(order, ["customer.phone", "phone"], "");
                    return `
                        <div class="barcodeLabel cargoShippingLabel">
                            <div class="cargoLabelTop"><strong>${temizle(carrier)}</strong><span>${temizle(platformAdi(order))}</span></div>
                            <div class="cargoCustomer"><strong>${temizle(musteriAdi(order))}</strong>${phone ? `<span>${temizle(phone)}</span>` : ""}</div>
                            <p class="cargoAddress">${temizle(delivery.address || "Adres bilgisi yok")}</p>
                            <strong class="cargoCity">${temizle([delivery.district, delivery.city].filter(Boolean).join(" / ") || "-")}</strong>
                            <div class="cargoBarcodeArea">
                                <svg id="bulkCargoBarcode${index}" aria-label="${temizle(kargoEtiketiBarkodu(order))}"></svg>
                                <span>${kargoGonderiKodu(order) ? "Kargo barkodu" : "Dahili barkod"} · Sipariş: ${temizle(siparisKodu(order))}</span>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
            <div class="barcodePrintActions">
                <button class="removeLocationButton closePrintModal" type="button">İptal</button>
                <button class="saveLocationButton" id="printBulkCargoNow" type="button">${temizle(printable.length)} Etiketi Yazdır</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    if (typeof JsBarcode !== "function") {
        modal.remove();
        mesajGoster("error", "Barkod oluşturulamadı", "Barkod kütüphanesi yüklenemedi.");
        return;
    }
    printable.forEach((order, index) => {
        JsBarcode(`#bulkCargoBarcode${index}`, kargoEtiketiBarkodu(order), {
            format: "CODE128",
            width: 2.2,
            height: 55,
            displayValue: true,
            fontSize: 15,
            margin: 0
        });
    });
    modal.querySelectorAll(".closePrintModal").forEach(button =>
        button.addEventListener("click", () => modal.remove())
    );
    modal.querySelector("#printBulkCargoNow").addEventListener("click", async () => {
        try {
            await etiketBaskisiniKaydet(printable);
        } catch (err) {
            mesajGoster("error", "Baskı kayıtları oluşturulamadı", err.message);
            return;
        }
        const pageStyle = document.createElement("style");
        pageStyle.textContent = "@page{size:100mm 100mm;margin:0}";
        document.head.appendChild(pageStyle);
        window.print();
        window.setTimeout(() => pageStyle.remove(), 500);
    });
}

function sevkiyatKodunuAyikla(barkod) {
    const deger = barkodNormalize(barkod);
    const upper = deger.toUpperCase();
    const prefixes = ["ZOOM-ORDER-", ["Z", "O", "R", "A"].join("") + "-ORDER-"];
    const prefix = prefixes.find(item => upper.startsWith(item));
    return prefix ? deger.slice(prefix.length) : deger;
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

async function sevkiyatDurumuKaydet(siparis, status, extra = {}) {
    const code = siparisKodu(siparis);
    const response = await fetch(`/shipments/${encodeURIComponent(code)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            status,
            customerName: musteriAdi(siparis),
            platform: platformAdi(siparis),
            ...extra
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
    const hazirMi = kayit?.status === "ready";
    const status = shipped
        ? "Kargoya Verildi"
        : hazirMi
            ? "Kargoya Hazır"
            : kayit?.status === "pending" ? "Eksikte Bekliyor" : "Hazırlanmadı";

    return `
        <article class="shipmentCard ${shipped ? "shipped" : "pending"}">
            <div>
                <span class="shipmentStatus">${temizle(status)}</span>
                <h3>${temizle(musteriAdi(siparis))}</h3>
                <p>${temizle(code)} · ${temizle(platformAdi(siparis))}</p>
                ${kayit?.trackingNumber ? `<p><strong>${temizle(kayit.carrier || "Kargo")}</strong> · ${temizle(kayit.trackingNumber)}
                    ${kayit.trackingUrl ? ` · <a href="${temizle(kayit.trackingUrl)}" target="_blank" rel="noopener">Takibi Aç</a>` : ""}</p>` : ""}
            </div>
            <div class="shipmentActions">
                <button type="button" class="printShipmentButton" data-print-shipment="${temizle(code)}">
                    Sevkiyat Barkodu
                </button>
                <button type="button" class="printShipmentButton" data-print-cargo-order="${temizle(code)}">
                    100×100 Kargo Etiketi
                </button>
                <button type="button" class="printShipmentButton" data-tracking-order="${temizle(code)}">
                    Takip Bilgisi
                </button>
                ${shipped ? `
                    <button type="button" class="undoShippedButton" data-undo-shipped="${temizle(code)}">
                        Geri Al
                    </button>
                ` : `
                    <button type="button" class="markShippedButton${hazirMi ? "" : " blocked"}" data-mark-shipped="${temizle(code)}" ${hazirMi ? "" : "disabled"} title="${hazirMi ? "Siparişi kargoya verilenlere taşı" : "Önce siparişteki tüm ürünler hazırlanmalıdır"}">
                        ${hazirMi ? "Kargoya Verildi" : "Önce Hazırla"}
                    </button>
                `}
            </div>
        </article>
    `;
}

function kargoTakipFormuGoster(code) {
    const kayit = sevkiyatKayitlari.find(item => item.orderCode === code) || {};
    result.insertAdjacentHTML("beforeend", `
        <div class="issueDialog" id="trackingDialog" role="dialog" aria-modal="true">
            <form id="trackingForm" data-order-code="${temizle(code)}">
                <h3>Kargo Takip Bilgisi</h3>
                <label><span>Kargo firması</span><input name="carrier" value="${temizle(kayit.carrier || "")}" required></label>
                <label><span>Takip numarası</span><input name="trackingNumber" value="${temizle(kayit.trackingNumber || "")}" required></label>
                <label><span>Takip bağlantısı</span><input name="trackingUrl" type="url" placeholder="https://..." value="${temizle(kayit.trackingUrl || "")}"></label>
                <div class="dialogActions"><button type="button" data-close-dialog>İptal</button><button type="submit">Kaydet</button></div>
            </form>
        </div>
    `);
}

function sevkiyatListeleriniGoster() {
    const bekleyenAlan = document.getElementById("pendingShipments");
    const verilenAlan = document.getElementById("shippedShipments");

    if (!bekleyenAlan || !verilenAlan) {
        return;
    }

    const kayitMap = new Map(sevkiyatKayitlari.map(item => [item.orderCode.toUpperCase(), item]));
    const kapanmisDurumlar = ["Kargolandı", "Teslim Edildi", "İade", "İptal"];
    const bekleyenTum = siparisler.filter(item => {
        const kayit = kayitMap.get(siparisKodu(item).toUpperCase());
        return kayit?.status !== "shipped" && !kapanmisDurumlar.includes(siparisDurumu(item));
    });
    const verilenTum = sevkiyatKayitlari
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
    const arama = aramaMetni(sevkiyatAramaMetni);
    const siparisAramayaUyuyor = siparis => !arama || aramaMetni([
        musteriAdi(siparis),
        siparisKodu(siparis),
        platformAdi(siparis)
    ].join(" ")).includes(arama);
    const platformaUyuyor = siparis => platformAnahtari(platformAdi(siparis)) === aktifSevkiyatPlatformu;
    const bekleyen = bekleyenTum.filter(platformaUyuyor).filter(siparisAramayaUyuyor);
    const verilen = verilenTum.filter(item => platformaUyuyor(item.siparis)).filter(item => siparisAramayaUyuyor(item.siparis));
    const platformAlani = document.getElementById("shipmentPlatformTabs");

    if (platformAlani) {
        platformAlani.innerHTML = platformSekmeleriHtml(
            "shipments",
            aktifSevkiyatPlatformu,
            [...bekleyenTum, ...verilenTum.map(item => item.siparis)],
            platformAdi
        );
    }

    bekleyenAlan.innerHTML = bekleyen.length
        ? bekleyen.map(item => sevkiyatKarti(item, kayitMap.get(siparisKodu(item).toUpperCase()))).join("")
        : `<div class="emptyLocation">Bekleyen sipariş yok.</div>`;
    verilenAlan.innerHTML = verilen.length
        ? verilen.map(item => sevkiyatKarti(item.siparis, item.kayit, true)).join("")
        : `<div class="emptyLocation">Henüz kargoya verilen sipariş yok.</div>`;

    document.getElementById("pendingShipmentCount").textContent = bekleyen.length;
    document.getElementById("shippedShipmentCount").textContent = verilen.length;
    const toplamBilgisi = document.getElementById("shipmentSearchSummary");

    if (toplamBilgisi) {
        toplamBilgisi.textContent = arama
            ? `${bekleyen.length + verilen.length} eşleşme bulundu`
            : "Müşteri adı, sipariş no veya platform ile arayın.";
    }
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
    sevkiyatAramaMetni = "";
    aktifSevkiyatPlatformu = "trendyol";
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
            <div id="shipmentPlatformTabs">
                ${platformSekmeleriHtml("shipments", aktifSevkiyatPlatformu, [], platformAdi)}
            </div>
            <label class="shipmentSearch">
                <span>Sevkiyatta Ara</span>
                <input id="shipmentSearch" type="search" placeholder="Müşteri adı, sipariş no veya platform..." autocomplete="off">
                <small id="shipmentSearchSummary">Müşteri adı, sipariş no veya platform ile arayın.</small>
            </label>
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
        scannerDurdur();
        mesajGoster("error", "Kargo çıkışı engellendi", err.message);
        bildirimSesi("error");
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

    const metin = String(deger);
    const tarih = new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(metin)
        ? metin
        : `${metin.replace(" ", "T")}Z`);
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

function hazirlamaGecmisiSatirlari(kayitlar, geriAlmaGoster = false) {
    if (!kayitlar.length) {
        return `<tr><td colspan="${geriAlmaGoster ? 9 : 8}" class="emptyActivity">Arama ölçütlerine uygun hazırlama kaydı bulunamadı.</td></tr>`;
    }

    return kayitlar.map(item => `
        <tr>
            <td><strong>${temizle(item.orderCode)}</strong></td>
            <td>${temizle(item.customerName)}</td>
            <td><span class="platformBadge ${platformAnahtari(item.platform)}">${temizle(item.platform || "-")}</span></td>
            <td>${temizle(item.startedBy)}</td>
            <td>${temizle(tarihSaatGoster(item.startedAt))}</td>
            <td>${temizle(item.completedBy || "-")}</td>
            <td>${temizle(tarihSaatGoster(item.completedAt))}</td>
            <td><span class="activityStatus ${item.status === "completed" ? "completed" : "started"}">${item.status === "completed" ? "Tamamlandı" : "Hazırlanıyor"}</span></td>
            ${geriAlmaGoster ? `<td>${item.status === "completed"
                ? `<button class="undoPreparationButton" type="button" data-undo-preparation="${temizle(item.orderCode)}">Geri Al</button>`
                : "-"}</td>` : ""}
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
            item.platform,
            item.startedBy,
            item.completedBy
        ].join(" "));
        const kayitTarihi = yerelTarihAnahtari(item.startedAt);
        const personelUyuyor = !personel
            || String(item.startedByUserId) === personel
            || String(item.completedByUserId) === personel;

        return (!arama || ortakMetin.includes(arama))
            && platformAnahtari(item.platform) === aktifGecmisPlatformu
            && personelUyuyor
            && (!durum || item.status === durum)
            && (!baslangic || kayitTarihi >= baslangic)
            && (!bitis || kayitTarihi <= bitis);
    });

    const govde = document.getElementById("activityTableBody");
    const sayac = document.getElementById("activityResultCount");

    if (govde) {
        govde.innerHTML = hazirlamaGecmisiSatirlari(
            filtrelenen,
            Boolean(document.querySelector(".adminTool #activityTableBody"))
        );
    }

    if (sayac) {
        sayac.textContent = `${filtrelenen.length} / ${yonetimHazirlamaKayitlari.length} kayıt`;
    }

    raporLinkleriniGuncelle();
}

function raporLinkleriniGuncelle() {
    const params = new URLSearchParams({
        platform: aktifGecmisPlatformu === "trendyol" ? "Trendyol" : "Zoombutik"
    });
    const baslangic = document.getElementById("activityDateFrom")?.value;
    const bitis = document.getElementById("activityDateTo")?.value;

    if (baslangic) params.set("dateFrom", baslangic);
    if (bitis) params.set("dateTo", bitis);

    document.getElementById("excelReportLink")?.setAttribute("href", `/reports/preparations.xlsx?${params}`);
    document.getElementById("pdfReportLink")?.setAttribute("href", `/reports/preparations.pdf?${params}`);
}

async function performansOzetiniGetir() {
    const alan = document.getElementById("performanceSummary");
    const bugun = new Date();
    const varsayilanTarih = `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, "0")}-${String(bugun.getDate()).padStart(2, "0")}`;
    const tarih = document.getElementById("performanceDate")?.value || varsayilanTarih;

    if (!alan) return;
    alan.innerHTML = `<div class="loading">Günlük performans hesaplanıyor...</div>`;

    try {
        const params = new URLSearchParams({
            date: tarih,
            platform: aktifGecmisPlatformu === "trendyol" ? "Trendyol" : "Zoombutik"
        });
        const response = await fetch(`/preparations/summary?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Performans özeti alınamadı.");

        alan.innerHTML = data.result.length ? data.result.map(item => `
            <article class="performanceCard">
                <strong>${temizle(item.displayName)}</strong>
                <div><span>Hazırlanan</span><b>${temizle(item.completedCount)}</b></div>
                <div><span>Devam eden</span><b>${temizle(item.pendingCount)}</b></div>
                <div><span>Ort. süre</span><b>${item.averageMinutes == null ? "-" : `${temizle(item.averageMinutes)} dk`}</b></div>
            </article>
        `).join("") : `<div class="emptyActivity">Bu tarih için personel kaydı bulunmuyor.</div>`;
    } catch (err) {
        alan.innerHTML = `<div class="notfound">${temizle(err.message)}</div>`;
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
                ${platformSekmeleriHtml("history", aktifGecmisPlatformu, data.result, item => item.platform)}
                <div class="performanceHeader">
                    <div>
                        <h3>Günlük Hazırlama Performansı</h3>
                        <span>Personel bazında tamamlanan sipariş ve ortalama süre</span>
                    </div>
                    <label>
                        <span>Gün</span>
                        <input id="performanceDate" type="date">
                    </label>
                </div>
                <div class="performanceSummary" id="performanceSummary"></div>
                <div class="sectionTitle">
                    <h3>Hazırlama Kayıtları</h3>
                    <div class="reportActions">
                        <span id="activityResultCount">${temizle(data.result.length)} / ${temizle(data.result.length)} kayıt</span>
                        <a id="excelReportLink" class="reportDownloadButton" href="/reports/preparations.xlsx">Excel İndir</a>
                        <a id="pdfReportLink" class="reportDownloadButton secondary" href="/reports/preparations.pdf">PDF İndir</a>
                        ${aktifKullanici?.role === "admin" ? `
                            <button class="clearHistoryButton" type="button" data-clear-history="preparations">Hazırlama Geçmişini Temizle</button>
                            <button class="clearHistoryButton" type="button" data-clear-history="audit">Denetim Geçmişini Temizle</button>
                        ` : ""}
                    </div>
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
                                <th>Platform</th>
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
        const bugun = new Date();
        document.getElementById("performanceDate").value =
            `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, "0")}-${String(bugun.getDate()).padStart(2, "0")}`;
        hazirlamaGecmisiniFiltrele();
        performansOzetiniGetir();
    } catch (err) {
        result.innerHTML = `<div class="notfound">${temizle(err.message)}</div>`;
    }
}

function parolaDegistirmeFormuGoster(userId, displayName) {
    document.getElementById("userDialog")?.remove();
    result.insertAdjacentHTML("beforeend", `
        <div class="issueDialog" id="userDialog" role="dialog" aria-modal="true" aria-labelledby="passwordDialogTitle">
            <form class="issueDialogCard" id="resetPasswordForm" data-user-id="${temizle(userId)}">
                <div class="issueDialogHeader">
                    <div>
                        <p class="eyebrow">Kullanıcı Yönetimi</p>
                        <h3 id="passwordDialogTitle">Parola Değiştir</h3>
                        <span>${temizle(displayName)}</span>
                    </div>
                    <button type="button" class="issueCloseButton" data-close-user-dialog aria-label="Kapat">×</button>
                </div>
                <label>
                    <span>Yeni Parola</span>
                    <input name="password" type="password" minlength="8" autocomplete="new-password" required>
                </label>
                <label>
                    <span>Yeni Parola Tekrar</span>
                    <input name="passwordConfirm" type="password" minlength="8" autocomplete="new-password" required>
                </label>
                <div class="issueDialogActions">
                    <button type="button" class="issueCancelButton" data-close-user-dialog>İptal</button>
                    <button type="submit" class="issueSaveButton">Parolayı Kaydet</button>
                </div>
            </form>
        </div>
    `);
}

const denetimEtiketleri = {
    "user.login": "Oturum açma",
    "user.create": "Kullanıcı oluşturma",
    "user.enable": "Kullanıcı etkinleştirme",
    "user.disable": "Kullanıcı kapatma",
    "user.password_change": "Parola değiştirme",
    "preparation.start": "Hazırlama başlangıcı",
    "preparation.complete": "Sipariş hazırlandı",
    "preparation.undo": "Hazırlama geri alındı",
    "issue.create": "Sorun kaydı",
    "issue.update": "Sorun düzenleme",
    "issue.resolve": "Sorun çözme",
    "location.save": "Raf kaydetme",
    "location.delete": "Raf silme",
    "shipment.pending": "Eksikte bekletme",
    "shipment.ready": "Kargoya hazırlama",
    "shipment.shipped": "Kargoya verme",
    "shipment.undo": "Kargo geri alma",
    "backup.auto": "Otomatik yedek",
    "backup.manual": "Manuel yedek",
    "backup.download": "Yedek indirme",
    "alert.create": "Kritik uyarı",
    "alert.manual_check": "Uyarı kontrolü",
    "api.outage": "API kesintisi",
    "api.recovered": "API düzeldi",
    "history.clear": "Geçmiş temizleme",
    "label.print": "Kargo etiketi baskısı",
    "products.sync": "Ürün kataloğu güncelleme"
};

function dosyaBoyutuGoster(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function denetimKayitlariHtml(kayitlar) {
    if (!kayitlar.length) {
        return `<tr><td colspan="5" class="emptyActivity">Uygun işlem kaydı bulunamadı.</td></tr>`;
    }
    return kayitlar.map(item => `
        <tr>
            <td>${temizle(tarihSaatGoster(item.createdAt))}</td>
            <td><strong>${temizle(item.actorName)}</strong></td>
            <td><span class="auditAction">${temizle(denetimEtiketleri[item.action] || item.action)}</span></td>
            <td>${temizle(item.entityId || "-")}</td>
            <td>${temizle(item.summary)}</td>
        </tr>
    `).join("");
}

async function denetimKayitlariniFiltrele() {
    const body = document.getElementById("auditTableBody");
    if (!body) return;
    const params = new URLSearchParams();
    const search = document.getElementById("auditSearch")?.value || "";
    const action = document.getElementById("auditActionFilter")?.value || "";
    const dateFrom = document.getElementById("auditDateFrom")?.value || "";
    const dateTo = document.getElementById("auditDateTo")?.value || "";
    if (search) params.set("search", search);
    if (action) params.set("action", action);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    body.innerHTML = `<tr><td colspan="5" class="emptyActivity">Kayıtlar yükleniyor...</td></tr>`;
    try {
        const response = await fetch(`/admin/audit-logs?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Denetim kayıtları alınamadı.");
        body.innerHTML = denetimKayitlariHtml(data.result);
        const count = document.getElementById("auditResultCount");
        if (count) count.textContent = `${data.result.length} kayıt`;
    } catch (err) {
        body.innerHTML = `<tr><td colspan="5" class="emptyActivity">${temizle(err.message)}</td></tr>`;
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
        const [usersResponse, historyResponse, auditResponse, backupsResponse, operationsResponse, printJobsResponse] = await Promise.all([
            fetch("/admin/users"),
            fetch("/admin/preparations"),
            fetch("/admin/audit-logs"),
            fetch("/admin/backups"),
            fetch("/admin/operations/status"),
            fetch("/admin/print-jobs")
        ]);
        const usersData = await usersResponse.json();
        const historyData = await historyResponse.json();
        const auditData = await auditResponse.json();
        const backupsData = await backupsResponse.json();
        const operationsData = await operationsResponse.json();
        const printJobsData = await printJobsResponse.json();

        if (!usersResponse.ok || !historyResponse.ok || !auditResponse.ok || !backupsResponse.ok || !operationsResponse.ok || !printJobsResponse.ok) {
            throw new Error(usersData.error || historyData.error || auditData.error || backupsData.error || operationsData.error || printJobsData.error || "Yönetim verileri alınamadı.");
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
                                <div class="userListItem${user.active ? "" : " inactive"}">
                                    <div>
                                        <strong>${temizle(user.displayName)}</strong>
                                        <span>@${temizle(user.username)} · ${user.role === "admin" ? "Yönetici" : "Personel"} · ${user.active ? "Aktif" : "Devre dışı"}</span>
                                    </div>
                                    <div class="userActions">
                                        <button type="button" data-reset-user-password="${temizle(user.id)}" data-user-name="${temizle(user.displayName)}">Parola Değiştir</button>
                                        <button type="button" class="${user.active ? "danger" : "success"}" data-toggle-user="${temizle(user.id)}" data-user-active="${user.active}">
                                            ${user.active ? "Devre Dışı Bırak" : "Etkinleştir"}
                                        </button>
                                    </div>
                                </div>
                            `).join("")}
                        </div>
                    </section>
                    <section class="activityPanel">
                        ${platformSekmeleriHtml("history", aktifGecmisPlatformu, historyData.result, item => item.platform)}
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
                                        <th>Platform</th>
                                        <th>Başlatan</th>
                                        <th>Başlangıç</th>
                                        <th>Tamamlayan</th>
                                        <th>Tamamlanma</th>
                                        <th>Durum</th>
                                        <th>İşlem</th>
                                    </tr>
                                </thead>
                                <tbody id="activityTableBody">
                                    ${hazirlamaGecmisiSatirlari(historyData.result, true)}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
                <section class="printQueueAdminSection">
                    <div class="sectionTitle">
                        <div>
                            <p class="eyebrow">Otomatik Zebra Yazdırma</p>
                            <h3>100×100 mm etiket kuyruğu</h3>
                        </div>
                        <a class="reportDownloadButton" href="/downloads/zoom-print-agent.zip">Windows Ajanını İndir</a>
                    </div>
                    <div class="printAgentStatus ${printJobsData.agent.lastSeenAt ? "online" : ""}">
                        <strong>${printJobsData.agent.lastSeenAt ? "Yazdırma ajanı bağlı" : printJobsData.agent.configured ? "Ajan henüz bağlanmadı" : "Yazdırma ajanı kurulmadı"}</strong>
                        <span>${printJobsData.agent.lastSeenAt
                            ? `${temizle(printJobsData.agent.name || "Zebra bilgisayarı")} · Son bağlantı: ${temizle(tarihSaatGoster(printJobsData.agent.lastSeenAt))}`
                            : "Windows ajanını Zebra'nın bağlı olduğu bilgisayara kurun."}</span>
                    </div>
                    <div class="printQueueList">
                        ${printJobsData.result.length ? printJobsData.result.slice(0, 20).map(job => `
                            <div class="printQueueItem ${temizle(job.status)}">
                                <div>
                                    <strong>${temizle(job.orderCode)} · ${temizle(job.payload.customerName || "Müşteri")}</strong>
                                    <span>${job.status === "printed" ? "Yazdırıldı" : job.status === "processing" ? "Yazdırılıyor" : job.status === "failed" ? "Hata" : "Kuyrukta"} · ${temizle(tarihSaatGoster(job.updatedAt))}</span>
                                    ${job.errorMessage ? `<small>${temizle(job.errorMessage)}</small>` : ""}
                                </div>
                                ${job.status === "failed" || job.status === "printed"
                                    ? `<button type="button" data-retry-print-job="${temizle(job.id)}">${job.status === "printed" ? "Tekrar Yazdır" : "Yeniden Dene"}</button>`
                                    : ""}
                            </div>
                        `).join("") : `<div class="emptyActivity">Henüz otomatik etiket işi yok.</div>`}
                    </div>
                </section>
                <section class="operationsAdminSection">
                    <div class="sectionTitle">
                        <div>
                            <p class="eyebrow">Operasyon Sağlığı</p>
                            <h3>Kritik durumlar ve otomatik yedekleme</h3>
                        </div>
                        <button type="button" class="checkOperationsButton" id="checkOperationsButton">Şimdi Kontrol Et</button>
                    </div>
                    <div class="operationsSummary">
                        <div><span>Geciken hazırlama</span><strong>${temizle(operationsData.counts.delayedPreparations)}</strong><small>${temizle(operationsData.thresholds.preparationHours)} saat üzeri</small></div>
                        <div><span>Uzun süren eksik</span><strong>${temizle(operationsData.counts.delayedIssues)}</strong><small>${temizle(operationsData.thresholds.issueHours)} saat üzeri</small></div>
                        <div><span>Çıkmayan hazır paket</span><strong>${temizle(operationsData.counts.delayedShipments)}</strong><small>${temizle(operationsData.thresholds.shipmentHours)} saat üzeri</small></div>
                        <div><span>Stok uyuşmazlığı</span><strong>${temizle(operationsData.counts.stockMismatches)}</strong><small>Açık kritik kayıt</small></div>
                    </div>
                    <div class="backupHeader">
                        <div>
                            <h3>Veritabanı Yedekleri</h3>
                            <span>Her gün otomatik oluşturulur, ${temizle(backupsData.retentionDays)} gün saklanır.</span>
                        </div>
                        <button type="button" class="createBackupButton" id="createBackupButton">Şimdi Yedekle</button>
                    </div>
                    <div class="backupList">
                        ${backupsData.result.length ? backupsData.result.slice(0, 10).map(item => `
                            <div>
                                <span><strong>${temizle(item.name)}</strong><small>${temizle(tarihSaatGoster(item.createdAt))} · ${temizle(dosyaBoyutuGoster(item.size))}</small></span>
                                <a href="/admin/backups/${encodeURIComponent(item.name)}">İndir</a>
                            </div>
                        `).join("") : `<div class="emptyActivity">Henüz yedek oluşturulmadı.</div>`}
                    </div>
                </section>
                <section class="auditAdminSection">
                    <div class="sectionTitle">
                        <div>
                            <p class="eyebrow">Denetim Kaydı</p>
                            <h3>Kim, ne zaman, hangi işlemi yaptı?</h3>
                        </div>
                        <span id="auditResultCount">${temizle(auditData.result.length)} kayıt</span>
                    </div>
                    <div class="auditFilters">
                        <label><span>Arama</span><input id="auditSearch" type="search" placeholder="Personel, sipariş, ürün veya işlem"></label>
                        <label>
                            <span>İşlem</span>
                            <select id="auditActionFilter">
                                <option value="">Tüm işlemler</option>
                                ${Object.entries(denetimEtiketleri).map(([value, label]) => `<option value="${temizle(value)}">${temizle(label)}</option>`).join("")}
                            </select>
                        </label>
                        <label><span>Başlangıç</span><input id="auditDateFrom" type="date"></label>
                        <label><span>Bitiş</span><input id="auditDateTo" type="date"></label>
                    </div>
                    <div class="activityTableWrap">
                        <table class="activityTable auditTable">
                            <thead><tr><th>Zaman</th><th>Personel</th><th>İşlem</th><th>Kayıt</th><th>Açıklama</th></tr></thead>
                            <tbody id="auditTableBody">${denetimKayitlariHtml(auditData.result)}</tbody>
                        </table>
                    </div>
                </section>
            </section>
        `;
        hazirlamaGecmisiniFiltrele();
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

function eksikKalanUrunleriGetir() {
    return (aktifSiparis?.products || []).map((urun, index) => ({
        urun,
        index,
        eksikAdet: Math.max(0, urunAdedi(urun) - okutulanAdet(index))
    })).filter(item =>
        !hizmetUrunuMu(item.urun)
        && item.eksikAdet > 0
        && !urununAcikSorunu(item.index)
    );
}

function eksikteBekletmeFormuGoster() {
    const eksikUrunler = eksikKalanUrunleriGetir();

    if (!eksikUrunler.length) {
        mesajGoster("warning", "Eksik ürün bulunamadı", "Tüm ürünler okutulmuş veya daha önce sorun kaydı açılmış.");
        return;
    }

    document.getElementById("issueDialog")?.remove();
    result.insertAdjacentHTML("beforeend", `
        <div class="issueDialog" id="issueDialog" role="dialog" aria-modal="true" aria-labelledby="holdOrderDialogTitle">
            <form class="issueDialogCard holdOrderDialogCard" id="holdOrderForm">
                <div class="issueDialogHeader">
                    <div>
                        <p class="eyebrow">Eksik Sipariş</p>
                        <h3 id="holdOrderDialogTitle">Siparişi eksikte beklemeye al</h3>
                        <span>${temizle(musteriAdi(aktifSiparis))} · ${temizle(siparisKodu(aktifSiparis))}</span>
                    </div>
                    <button type="button" class="issueCloseButton" data-close-issue aria-label="Kapat">×</button>
                </div>
                <p class="holdOrderIntro">Aşağıdaki okutulmamış ürünler eksik olarak kaydedilecek:</p>
                <div class="holdOrderProducts">
                    ${eksikUrunler.map(item => `
                        <div>
                            <span>${temizle(urunAdi(item.urun))}</span>
                            <small>${temizle(urunRengi(item.urun))} · ${temizle(urunBedeni(item.urun))} · ${temizle(urunBarkodu(item.urun))}</small>
                            <strong>${temizle(item.eksikAdet)} adet eksik</strong>
                        </div>
                    `).join("")}
                </div>
                <label>
                    <span>Açıklama</span>
                    <textarea name="note" maxlength="1000" placeholder="İsteğe bağlı not"></textarea>
                </label>
                <div class="issueDialogActions">
                    <button type="button" class="issueCancelButton" data-close-issue>İptal</button>
                    <button type="submit" class="issueSaveButton">Eksikte Beklemeye Al</button>
                </div>
            </form>
        </div>
    `);
}

function eksigeAlindiEkraniGoster(eksikAdet) {
    scannerDurdur();
    result.innerHTML = `
        <section class="completeScreen holdCompleteScreen">
            <div class="holdCompleteIcon">!</div>
            <p class="eyebrow">Eksikte Bekliyor</p>
            <h2>${temizle(musteriAdi(aktifSiparis))}</h2>
            <p><strong>${temizle(eksikAdet)} adet</strong> eksik ürün kaydı oluşturuldu.</p>
            <div class="holdCompleteActions">
                <button class="openOrderButton" type="button" id="openIssueOrders">Eksik Siparişlere Git</button>
                <button class="secondaryOrderButton" type="button" id="backToList">Yeni Sipariş Ara</button>
            </div>
        </section>
    `;
}

function sorunDuzenlemeFormuGoster(issue) {
    document.getElementById("issueDialog")?.remove();
    result.insertAdjacentHTML("beforeend", `
        <div class="issueDialog" id="issueDialog" role="dialog" aria-modal="true" aria-labelledby="editIssueDialogTitle">
            <form class="issueDialogCard" id="editIssueForm" data-issue-id="${temizle(issue.id)}">
                <div class="issueDialogHeader">
                    <div>
                        <p class="eyebrow">Sorun Kaydını Düzenle</p>
                        <h3 id="editIssueDialogTitle">${temizle(issue.productName)}</h3>
                        <span>${temizle(issue.orderCode)} · ${temizle(issue.platform)}</span>
                    </div>
                    <button type="button" class="issueCloseButton" data-close-issue aria-label="Kapat">×</button>
                </div>
                <label>
                    <span>Sorun Türü</span>
                    <select name="issueType" required>
                        <option value="missing" ${issue.issueType === "missing" ? "selected" : ""}>Eksik</option>
                        <option value="damaged" ${issue.issueType === "damaged" ? "selected" : ""}>Hasarlı</option>
                        <option value="stock_mismatch" ${issue.issueType === "stock_mismatch" ? "selected" : ""}>Yanlış stok</option>
                    </select>
                </label>
                <label id="missingQuantityField" ${issue.issueType === "missing" ? "" : "hidden"}>
                    <span>Eksik Adet</span>
                    <input name="missingQuantity" type="number" min="1" max="999" value="${temizle(issue.missingQuantity || 1)}" ${issue.issueType === "missing" ? "required" : ""}>
                </label>
                <label>
                    <span>Açıklama</span>
                    <textarea name="note" maxlength="1000" placeholder="İsteğe bağlı not">${temizle(issue.note || "")}</textarea>
                </label>
                <div class="issueDialogActions">
                    <button type="button" class="issueCancelButton" data-close-issue>İptal</button>
                    <button type="submit" class="issueSaveButton">Değişiklikleri Kaydet</button>
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
        const platformSorunlari = acikSorunKayitlari.filter(item => platformAnahtari(item.platform) === aktifEksikPlatformu);
        const eksikUrunOzeti = Object.values(
            platformSorunlari
                .filter(item => item.issueType === "missing")
                .reduce((ozet, item) => {
                    const anahtar = item.barcode || `${item.productName}|${item.color}|${item.size}`;

                    if (!ozet[anahtar]) {
                        ozet[anahtar] = {
                            productName: item.productName,
                            productId: item.productId,
                            imageUrl: item.imageUrl,
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
        const siparisGruplari = Object.values(platformSorunlari.reduce((gruplar, item) => {
            if (!gruplar[item.orderCode]) {
                gruplar[item.orderCode] = {
                    orderCode: item.orderCode,
                    customerName: item.customerName,
                    platform: item.platform,
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
                        <p>${temizle(siparisGruplari.length)} sipariş · ${temizle(platformSorunlari.length)} açık sorun</p>
                    </div>
                </div>
                ${platformSekmeleriHtml("issues", aktifEksikPlatformu, acikSorunKayitlari, item => item.platform)}
                <section class="shortageSummary">
                    <div class="sectionTitle">
                        <h3>Eksik Ürün Özeti</h3>
                        <span>${temizle(eksikUrunOzeti.reduce((toplam, item) => toplam + item.missingQuantity, 0))} adet eksik</span>
                    </div>
                    <div class="shortageGrid">
                        ${eksikUrunOzeti.length ? eksikUrunOzeti.map(item => `
                            <article class="shortageCard">
                                <div class="shortageImage">
                                    ${item.imageUrl
                                        ? `<img src="${temizle(item.imageUrl)}" alt="${temizle(item.productName)}" loading="lazy">`
                                        : `<span>Görsel yok</span>`}
                                </div>
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
                                    <p>${temizle(grup.orderCode)} · ${temizle(grup.platform || "-")}</p>
                                </div>
                                <button type="button" data-issue-order="${temizle(grup.orderCode)}">Siparişi Aç</button>
                            </div>
                            <div class="issueEntries">
                                ${grup.issues.map(item => `
                                    <div class="issueEntry">
                                        <div class="issueProductImage">
                                            ${item.imageUrl
                                                ? `<img src="${temizle(item.imageUrl)}" alt="${temizle(item.productName)}" loading="lazy">`
                                                : `<span>Görsel yok</span>`}
                                        </div>
                                        <div>
                                            <strong>${temizle(item.productName)}</strong>
                                            <span>${temizle(item.barcode || "-")} · ${temizle(sorunTurleri[item.issueType] || item.issueType)}${item.issueType === "missing" ? ` · ${temizle(item.missingQuantity)} adet` : ""}</span>
                                            ${item.note ? `<p>${temizle(item.note)}</p>` : ""}
                                            <small>${temizle(item.createdBy)} · ${temizle(tarihSaatGoster(item.createdAt))}</small>
                                        </div>
                                        <div class="issueEntryActions">
                                            <button type="button" class="editIssueButton" data-edit-issue="${temizle(item.id)}">Düzenle</button>
                                            <button type="button" data-resolve-issue="${temizle(item.id)}">Çözüldü</button>
                                        </div>
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
        const gorselUrl = urunGorseli(urun);

        return `
            <article class="productRow${durumClass}" data-product-index="${index}">
                <div class="productMain">
                    <span class="productIndex">${temizle(sira)}</span>
                    <div class="productImageWrap">
                        ${hizmet
                            ? `<span>Hizmet</span>`
                            : gorselUrl
                            ? `<img src="${temizle(gorselUrl)}" alt="${temizle(urunAdi(urun))}" loading="lazy">`
                            : `<span>Görsel yok</span>`}
                    </div>
                    <div>
                        <div class="productTitleLine">
                            <h3>${temizle(urunAdi(urun))}</h3>
                            <span>Ürün Kodu: ${temizle(urunKodu(urun) || "-")}</span>
                            <span>Renk: ${temizle(urunRengi(urun))}</span>
                            <span>Beden: ${temizle(urunBedeni(urun))}</span>
                            <span>Barkod: ${temizle(urunBarkodu(urun))}</span>
                        </div>
                        <dl class="productFacts">
                            <div>
                                <dt>Ürün Kodu</dt>
                                <dd>${temizle(urunKodu(urun) || "-")}</dd>
                            </div>
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
                                <dt>Raf</dt>
                                <dd>${temizle(urunRafKodu(urun))}</dd>
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
                    ${hizmet ? "" : `<button class="reportIssueButton${acikSorun ? " active" : ""}" type="button" data-report-issue="${index}">${acikSorun ? "Sorun Kaydı Açık" : "Eksik / Sorun Bildir"}</button>`}
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
    aktifTaramaKaniti = [];
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
            ${aktifTopluSiparisler.length ? `
                <div class="batchProgress">
                    <strong>Toplu grup: ${temizle(aktifTopluSiparisIndex + 1)} / ${temizle(aktifTopluSiparisler.length)}. sipariş</strong>
                    <span>Bu siparişin barkodlarını ayrı okutun. Tamamlanınca sıradaki sipariş açılır.</span>
                </div>
            ` : ""}

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

            <label class="proofUpload">
                <span>Paket fotoğrafı (isteğe bağlı)</span>
                <input id="packageProof" type="file" accept="image/*" capture="environment">
                <small>Fotoğraf hazırlama kaydında kanıt olarak saklanır.</small>
            </label>

            <button class="holdOrderButton" type="button" id="holdOrderButton">
                <strong>Eksikte Beklemeye Al</strong>
                <span>Okutulmamış ürünleri eksik olarak kaydet</span>
            </button>

            <div class="sectionTitle">
                <h3>Siparişteki Ürünler · Raf Rotası</h3>
                <span>${temizle(urunler.length)} ürün · raf sırasına göre</span>
            </div>

            <div class="productList" id="productList">
                ${urunListesiHtml(urunler)}
            </div>
        </section>
    `;
}

function siparisHazirEkraniGoster() {
    const batchCount = aktifTopluSiparisler.length;
    result.innerHTML = `
        <section class="completeScreen">
            <div class="completeIcon">🎉</div>
            <p class="eyebrow">${batchCount ? "Toplu Hazırlama Tamamlandı" : "Sipariş Hazır"}</p>
            <h2>${batchCount ? `${temizle(batchCount)} sipariş hazır` : temizle(musteriAdi(aktifSiparis))}</h2>
            <p>${batchCount
                ? aktifTopluSiparisler.map(order => temizle(siparisKodu(order))).join(" · ")
                : `Sipariş No: <strong>${temizle(siparisKodu(aktifSiparis))}</strong>`}</p>
            <div class="completeLabelActions">
                ${(batchCount ? aktifTopluSiparisler : [aktifSiparis]).map(order => `
                    <button class="cargoLabelButton" type="button" data-print-cargo-order="${temizle(siparisKodu(order))}">
                        ${batchCount ? `${temizle(siparisKodu(order))} · ` : ""}100×100 Kargo Etiketi
                    </button>
                `).join("")}
            </div>
            <button class="openOrderButton" type="button" id="backToList">Yeni Sipariş Ara</button>
        </section>
    `;
}

function siparisOzeti(siparis) {
    const products = (siparis.products || []).map(urun => ({
        barcode: urunBarkodu(urun),
        name: urunAdi(urun),
        code: urunKodu(urun),
        quantity: urunAdedi(urun),
        color: urunRengi(urun),
        size: urunBedeni(urun)
    })).sort((a, b) =>
        barkodKarsilastir(a.barcode).localeCompare(barkodKarsilastir(b.barcode))
        || a.name.localeCompare(b.name, "tr")
    );
    return {
        orderCode: siparisKodu(siparis),
        platform: platformAdi(siparis),
        customerName: musteriAdi(siparis),
        phone: alanOku(siparis, [
            "customer.phone",
            "customer.mobilePhone",
            "customer.delivery.phone",
            "delivery.phone",
            "shippingAddress.phone"
        ], ""),
        delivery: teslimatAdresi(siparis),
        shipmentCode: kargoGonderiKodu(siparis) || sevkiyatBarkodu(siparis),
        total: toplamTutar(siparis),
        products
    };
}

async function dosyayiKucukVeriAdresineCevir(input) {
    const file = input?.files?.[0];
    if (!file) return "";
    if (file.size > 1000000) throw new Error("Paket fotoğrafı 1 MB'dan küçük olmalı.");
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Paket fotoğrafı okunamadı."));
        reader.readAsDataURL(file);
    });
}

async function siparisiTamamla() {
    if (aktifTopluSiparisler.length) {
        await topluAktifSiparisiTamamla();
        return;
    }
    try {
        scannerDurdur();
        const orderResponse = await fetch(`/order/${encodeURIComponent(siparisKodu(aktifSiparis))}`, { cache: "no-store" });
        const currentOrder = await orderResponse.json();
        if (!orderResponse.ok) {
            throw new Error(currentOrder.error || "Sipariş iptal edilmiş veya artık aktif değil.");
        }
        const proofImage = await dosyayiKucukVeriAdresineCevir(document.getElementById("packageProof"));
        await hazirlamaKaydiGonder("complete", aktifSiparis, {
            proofImage,
            scans: aktifTaramaKaniti,
            orderSnapshot: siparisOzeti(currentOrder)
        });
        siparisiYereldeHazirIsaretle(aktifSiparis);
        await sevkiyatDurumuKaydet(aktifSiparis, "ready");
        siparisHazirEkraniGoster();
    } catch (err) {
        mesajGoster("error", "Sipariş tamamlanamadı", err.message);
    }
}

async function topluAktifSiparisiTamamla() {
    try {
        scannerDurdur();
        const original = aktifTopluSiparisler[aktifTopluSiparisIndex];
        const response = await fetch(`/order/${encodeURIComponent(siparisKodu(original))}`, { cache: "no-store" });
        const current = await response.json();
        if (!response.ok) throw new Error(`${siparisKodu(original)} artık aktif değil.`);
        if (siparisUrunImzasi(current) !== siparisUrunImzasi(original)) {
            throw new Error(`${siparisKodu(original)} siparişinin ürünleri değişti.`);
        }

        const proofImage = await dosyayiKucukVeriAdresineCevir(document.getElementById("packageProof"));
        await hazirlamaKaydiGonder("complete", original, {
            proofImage,
            scans: aktifTaramaKaniti,
            orderSnapshot: siparisOzeti(current)
        });
        siparisiYereldeHazirIsaretle(original);
        await sevkiyatDurumuKaydet(original, "ready");

        aktifTopluSiparisIndex += 1;
        if (aktifTopluSiparisIndex >= aktifTopluSiparisler.length) {
            siparisHazirEkraniGoster();
            return;
        }

        const nextOrder = aktifTopluSiparisler[aktifTopluSiparisIndex];
        aktifSiparisSorunlari = await siparisSorunlariniGetir(siparisKodu(nextOrder)).catch(() => []);
        siparisDetayGoster(nextOrder);
    } catch (err) {
        mesajGoster("error", "Bu sipariş tamamlanamadı", err.message);
    }
}

async function hazirlamaKaydiGonder(islem, siparis, extra = {}) {
    const response = await fetch(`/preparations/${islem}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            orderCode: siparisKodu(siparis),
            customerName: musteriAdi(siparis),
            platform: platformAdi(siparis),
            orderSnapshot: siparisOzeti(siparis),
            ...extra
        })
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Hazırlama kaydı yazılamadı.");
    }
    return response.json();
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
        await siparisRafRotasiniUygula(siparis);
        aktifSiparisSorunlari = await siparisSorunlariniGetir(kod);
    } catch (err) {
        aktifSiparisSorunlari = [];
        console.error(err);
    }

    try {
        await hazirlamaKaydiGonder("start", siparis);
        siparisDetayGoster(siparis);
    } catch (err) {
        result.innerHTML = `
            <div class="notfound">
                <strong>Sipariş açılamadı</strong>
                <p>${temizle(err.message)}</p>
                <button class="backButton" type="button" id="backToList">← Listeye dön</button>
            </div>
        `;
    }
}

async function topluSiparisSec(index) {
    const group = aktifTopluGruplar[index];
    if (!group) return;
    const locked = [];
    try {
        for (const order of group.orders) {
            await siparisRafRotasiniUygula(order);
            await hazirlamaKaydiGonder("start", order);
            locked.push(order);
        }
        aktifSiparisSorunlari = [];
        aktifTopluSiparisler = group.orders;
        aktifTopluSiparisIndex = 0;
        aktifSiparisSorunlari = await siparisSorunlariniGetir(siparisKodu(group.orders[0])).catch(() => []);
        siparisDetayGoster(group.orders[0]);
    } catch (err) {
        await Promise.all(locked.map(order =>
            fetch(`/preparations/${encodeURIComponent(siparisKodu(order))}/lock`, { method: "DELETE" }).catch(() => {})
        ));
        result.innerHTML = `<div class="notfound"><strong>Toplu grup açılamadı</strong><p>${temizle(err.message)}</p></div>`;
    }
}

searchInput.addEventListener("keyup", function (event) {
    if (event.isTrusted) aktifSiparisSayfasi = 1;
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
    const pageButton = event.target.closest("[data-order-page]");
    if (pageButton && !pageButton.disabled) {
        aktifSiparisSayfasi = Number(pageButton.dataset.orderPage) || 1;
        listeGoster(aktifListe);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
    }

    if (event.target.closest("[data-select-all-orders]")) {
        result.querySelectorAll("[data-select-order]:not(:disabled)").forEach(input => {
            input.checked = true;
            secilenSiparisKodlari.add(input.dataset.selectOrder);
        });
        secimKontrolleriniGuncelle();
        return;
    }

    if (event.target.closest("[data-clear-order-selection]")) {
        secilenSiparisKodlari.clear();
        result.querySelectorAll("[data-select-order]").forEach(input => {
            input.checked = false;
        });
        secimKontrolleriniGuncelle();
        return;
    }

    if (event.target.closest("[data-print-selected-orders]")) {
        const orders = siparisler.filter(order => secilenSiparisKodlari.has(siparisKodu(order)));
        topluKargoEtiketleriGoster(orders);
        return;
    }

    const cargoPrintButton = event.target.closest("[data-print-cargo-order]");
    if (cargoPrintButton) {
        const code = cargoPrintButton.dataset.printCargoOrder;
        const order = aktifTopluSiparisler.find(item => siparisKodu(item) === code)
            || siparisler.find(item => siparisKodu(item) === code)
            || (aktifSiparis && siparisKodu(aktifSiparis) === code ? aktifSiparis : null);
        if (!order) {
            mesajGoster("error", "Sipariş bulunamadı", code);
            return;
        }
        kargoCikisEtiketiGoster(order);
        return;
    }

    const clearHistoryButton = event.target.closest("[data-clear-history]");
    if (clearHistoryButton) {
        const confirmation = prompt("Bu işlem geri alınamaz. Devam etmek için TEMIZLE yazın.");
        if (confirmation !== "TEMIZLE") return;
        const response = await fetch("/admin/history", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: clearHistoryButton.dataset.clearHistory, confirmation })
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Geçmiş temizlenemedi.");
            return;
        }
        alert(`${data.result.preparationsDeleted} hazırlama, ${data.result.auditDeleted} denetim kaydı temizlendi.`);
        hazirlamaGecmisiEkraniGoster();
        return;
    }

    const retryPrintJobButton = event.target.closest("[data-retry-print-job]");
    if (retryPrintJobButton) {
        retryPrintJobButton.disabled = true;
        try {
            const response = await fetch(`/admin/print-jobs/${encodeURIComponent(retryPrintJobButton.dataset.retryPrintJob)}/retry`, {
                method: "POST"
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Etiket kuyruğa alınamadı.");
            await yonetimEkraniGoster();
        } catch (err) {
            retryPrintJobButton.disabled = false;
            alert(err.message);
        }
        return;
    }

    const undoPreparationButton = event.target.closest("[data-undo-preparation]");
    if (undoPreparationButton) {
        const orderCode = undoPreparationButton.dataset.undoPreparation;
        if (!confirm(
            `${orderCode} siparişi yeniden hazırlanmak üzere geri alınsın mı?\n\n`
            + "Okutma kaydı, kargoya hazır durumu ve otomatik etiket kaydı sıfırlanacak."
        )) return;

        undoPreparationButton.disabled = true;
        try {
            const response = await fetch(`/admin/preparations/${encodeURIComponent(orderCode)}/undo`, {
                method: "POST"
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Sipariş geri alınamadı.");
            mesajGoster("success", "Sipariş geri alındı", `${orderCode} yeniden hazırlama listesine eklendi.`);
            await yonetimEkraniGoster();
        } catch (err) {
            undoPreparationButton.disabled = false;
            alert(err.message);
        }
        return;
    }

    const batchButton = event.target.closest("[data-batch-index]");
    if (batchButton) {
        await topluSiparisSec(Number(batchButton.dataset.batchIndex));
        return;
    }

    const unlockButton = event.target.closest("[data-unlock-order]");
    if (unlockButton) {
        if (!confirm(`${unlockButton.dataset.unlockOrder} siparişinin hazırlama kilidi kaldırılsın mı?`)) return;
        const response = await fetch(`/preparations/${encodeURIComponent(unlockButton.dataset.unlockOrder)}/lock`, { method: "DELETE" });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.error || "Kilit kaldırılamadı.");
            return;
        }
        operasyonPanosuGoster();
        return;
    }

    const trackingButton = event.target.closest("[data-tracking-order]");
    if (trackingButton) {
        kargoTakipFormuGoster(trackingButton.dataset.trackingOrder);
        return;
    }

    if (event.target.closest("[data-close-dialog]")) {
        event.target.closest(".issueDialog")?.remove();
        return;
    }

    const yedekleButonu = event.target.closest("#createBackupButton");

    if (yedekleButonu) {
        yedekleButonu.disabled = true;
        yedekleButonu.textContent = "Yedekleniyor...";
        try {
            const response = await fetch("/admin/backups", { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Yedek oluşturulamadı.");
            await yonetimEkraniGoster();
        } catch (err) {
            yedekleButonu.disabled = false;
            yedekleButonu.textContent = "Şimdi Yedekle";
            alert(err.message);
        }
        return;
    }

    const operasyonKontrolButonu = event.target.closest("#checkOperationsButton");

    if (operasyonKontrolButonu) {
        operasyonKontrolButonu.disabled = true;
        try {
            const response = await fetch("/admin/operations/check", { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Operasyon kontrolü çalıştırılamadı.");
            await bildirimleriGetir();
            await yonetimEkraniGoster();
        } catch (err) {
            operasyonKontrolButonu.disabled = false;
            alert(err.message);
        }
        return;
    }

    if (event.target.closest("[data-close-user-dialog]")) {
        document.getElementById("userDialog")?.remove();
        return;
    }

    const parolaButonu = event.target.closest("[data-reset-user-password]");

    if (parolaButonu) {
        parolaDegistirmeFormuGoster(parolaButonu.dataset.resetUserPassword, parolaButonu.dataset.userName);
        return;
    }

    const kullaniciDurumButonu = event.target.closest("[data-toggle-user]");

    if (kullaniciDurumButonu) {
        kullaniciDurumButonu.disabled = true;
        try {
            const active = kullaniciDurumButonu.dataset.userActive !== "true";
            const response = await fetch(`/admin/users/${encodeURIComponent(kullaniciDurumButonu.dataset.toggleUser)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active })
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Kullanıcı durumu güncellenemedi.");
            }

            await yonetimEkraniGoster();
        } catch (err) {
            kullaniciDurumButonu.disabled = false;
            alert(err.message);
        }
        return;
    }

    const platformButonu = event.target.closest("[data-platform-scope]");

    if (platformButonu) {
        const scope = platformButonu.dataset.platformScope;
        const platform = platformButonu.dataset.platformValue;

        if (scope === "orders") {
            aktifSiparisPlatformu = platform;
            aktifSiparisSayfasi = 1;
            listeGoster(aktifListe);
        } else if (scope === "issues") {
            aktifEksikPlatformu = platform;
            await sorunluSiparislerEkraniGoster();
        } else if (scope === "shipments") {
            aktifSevkiyatPlatformu = platform;
            sevkiyatListeleriniGoster();
        } else if (scope === "history") {
            aktifGecmisPlatformu = platform;
            document.querySelectorAll('[data-platform-scope="history"]').forEach(button => {
                const aktif = button.dataset.platformValue === platform;
                button.classList.toggle("active", aktif);
                button.setAttribute("aria-selected", String(aktif));
            });
            hazirlamaGecmisiniFiltrele();
            performansOzetiniGetir();
        }
        return;
    }

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

    const eksikteBekletButonu = event.target.closest("#holdOrderButton");

    if (eksikteBekletButonu) {
        eksikteBekletmeFormuGoster();
        return;
    }

    const eksikSiparislereGitButonu = event.target.closest("#openIssueOrders");

    if (eksikSiparislereGitButonu) {
        aktifEksikPlatformu = platformAnahtari(platformAdi(aktifSiparis));
        await sorunluSiparislerEkraniGoster();
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

    const sorunDuzenleButonu = event.target.closest("[data-edit-issue]");

    if (sorunDuzenleButonu) {
        const issue = acikSorunKayitlari.find(item => String(item.id) === sorunDuzenleButonu.dataset.editIssue);

        if (issue) {
            sorunDuzenlemeFormuGoster(issue);
        }
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

    const kargoyuGeriAlButonu = event.target.closest("[data-undo-shipped]");

    if (kargoyuGeriAlButonu) {
        const code = kargoyuGeriAlButonu.dataset.undoShipped;
        const kayit = sevkiyatKayitlari.find(item => item.orderCode === code);
        const siparis = siparisler.find(item => siparisKodu(item) === code) || (kayit && {
            order: { code: kayit.orderCode, platform: kayit.platform },
            customer: { name: kayit.customerName }
        });

        if (siparis) {
            kargoyuGeriAlButonu.disabled = true;
            try {
                await sevkiyatDurumuKaydet(siparis, "ready");
                aktifSevkiyatListesi = "pending";
                sevkiyatListeleriniGoster();
                mesajGoster("warning", "Sevkiyat geri alındı", `${musteriAdi(siparis)} · ${code}`);
            } catch (err) {
                kargoyuGeriAlButonu.disabled = false;
                mesajGoster("error", "Sevkiyat geri alınamadı", err.message);
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
            const code = kayit.code || urunKodu(kayit.rawVariant) || urunKodu(kayit.rawProduct);
            barkodEtiketiGoster({ ...kayit, code });

            if (!code && kayit.productId) {
                apiUrunDetayiniGetir(kayit.productId)
                    .then(detail => {
                        const detailCode = urunKodu(detail);
                        const etiket = document.getElementById("barcodeLabel");
                        const urunAdiAlani = etiket?.querySelector(".barcodeLabelName");
                        if (!detailCode || !etiket || !urunAdiAlani) return;
                        const kodAlani = etiket.querySelector(".barcodeLabelCode");
                        if (kodAlani) kodAlani.textContent = `Ürün Kodu: ${detailCode}`;
                    })
                    .catch(() => {});
            }
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
    if (event.target.id === "trackingForm") {
        event.preventDefault();
        const form = event.target;
        const code = form.dataset.orderCode;
        const kayit = sevkiyatKayitlari.find(item => item.orderCode === code);
        const siparis = siparisler.find(item => siparisKodu(item) === code) || {
            order: { code, platform: kayit?.platform || "" },
            customer: { name: kayit?.customerName || "" }
        };
        try {
            await sevkiyatDurumuKaydet(siparis, kayit?.status || "ready", {
                carrier: form.elements.carrier.value,
                trackingNumber: form.elements.trackingNumber.value,
                trackingUrl: form.elements.trackingUrl.value
            });
            form.closest(".issueDialog")?.remove();
            sevkiyatListeleriniGoster();
        } catch (err) {
            alert(err.message);
        }
        return;
    }

    const resetPasswordForm = event.target.closest("#resetPasswordForm");

    if (resetPasswordForm) {
        event.preventDefault();
        const password = resetPasswordForm.elements.password.value;
        const confirmation = resetPasswordForm.elements.passwordConfirm.value;

        if (password !== confirmation) {
            alert("Parolalar eşleşmiyor.");
            return;
        }

        const button = resetPasswordForm.querySelector(".issueSaveButton");
        button.disabled = true;
        try {
            const response = await fetch(`/admin/users/${encodeURIComponent(resetPasswordForm.dataset.userId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Parola değiştirilemedi.");
            }

            document.getElementById("userDialog")?.remove();
            alert("Parola başarıyla değiştirildi.");
        } catch (err) {
            button.disabled = false;
            alert(err.message);
        }
        return;
    }

    const editIssueForm = event.target.closest("#editIssueForm");

    if (editIssueForm) {
        event.preventDefault();
        const button = editIssueForm.querySelector(".issueSaveButton");
        button.disabled = true;

        try {
            const response = await fetch(`/issues/${encodeURIComponent(editIssueForm.dataset.issueId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    issueType: editIssueForm.elements.issueType.value,
                    missingQuantity: Number(editIssueForm.elements.missingQuantity.value || 1),
                    note: editIssueForm.elements.note.value
                })
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Sorun kaydı güncellenemedi.");
            }

            document.getElementById("issueDialog")?.remove();
            await sorunluSiparislerEkraniGoster();
        } catch (err) {
            button.disabled = false;
            alert(err.message);
        }
        return;
    }

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
                    platform: platformAdi(aktifSiparis),
                    productIndex: index,
                    productId: urunProductId(urun),
                    productName: urunAdi(urun),
                    barcode: urunBarkodu(urun),
                    imageUrl: urunGorseli(urun),
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

    const holdOrderForm = event.target.closest("#holdOrderForm");

    if (holdOrderForm) {
        event.preventDefault();
        const eksikUrunler = eksikKalanUrunleriGetir();
        const button = holdOrderForm.querySelector(".issueSaveButton");

        if (!aktifSiparis || !eksikUrunler.length) {
            document.getElementById("issueDialog")?.remove();
            mesajGoster("warning", "Eksik ürün bulunamadı", "Sipariş ürünlerini yeniden kontrol edin.");
            return;
        }

        button.disabled = true;
        button.textContent = "Kaydediliyor...";

        try {
            const olusturulanlar = [];

            for (const item of eksikUrunler) {
                const response = await fetch("/issues", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        orderCode: siparisKodu(aktifSiparis),
                        customerName: musteriAdi(aktifSiparis),
                        platform: platformAdi(aktifSiparis),
                        productIndex: item.index,
                        productId: urunProductId(item.urun),
                        productName: urunAdi(item.urun),
                        barcode: urunBarkodu(item.urun),
                        imageUrl: urunGorseli(item.urun),
                        color: urunRengi(item.urun),
                        size: urunBedeni(item.urun),
                        missingQuantity: item.eksikAdet,
                        issueType: "missing",
                        note: holdOrderForm.elements.note.value
                    })
                });
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `${urunAdi(item.urun)} kaydedilemedi.`);
                }

                olusturulanlar.push(data.result);
            }

            aktifSiparisSorunlari.push(...olusturulanlar);
            await sevkiyatDurumuKaydet(aktifSiparis, "pending");
            document.getElementById("issueDialog")?.remove();
            eksigeAlindiEkraniGoster(
                olusturulanlar.reduce((toplam, item) => toplam + Number(item.missingQuantity || 1), 0)
            );
        } catch (err) {
            aktifSiparisSorunlari = await siparisSorunlariniGetir(siparisKodu(aktifSiparis)).catch(() => aktifSiparisSorunlari);
            document.getElementById("issueDialog")?.remove();
            urunListesiGuncelle();
            alert(`Eksik kayıt işlemi tamamlanamadı: ${err.message}`);
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
    if (event.target.id === "shipmentSearch") {
        sevkiyatAramaMetni = event.target.value;
        sevkiyatListeleriniGoster();
        return;
    }

    if (event.target.id === "activitySearch") {
        hazirlamaGecmisiniFiltrele();
        return;
    }

    if (event.target.id === "auditSearch") {
        clearTimeout(denetimAramaZamanlayici);
        denetimAramaZamanlayici = setTimeout(denetimKayitlariniFiltrele, 250);
        return;
    }

    if (event.target.id !== "locationSearch") {
        return;
    }

    clearTimeout(rafAramaZamanlayici);
    const value = event.target.value;
    const sonuclar = rafKaydiAra(value);
    if (!value.trim()) {
        rafAramaSonuclariGoster([]);
        return;
    }
    rafAramaZamanlayici = setTimeout(() => rafAramaSonuclariGoster(sonuclar), 300);
});

result.addEventListener("change", function (event) {
    if (event.target.matches("[data-select-order]")) {
        if (event.target.checked) {
            secilenSiparisKodlari.add(event.target.dataset.selectOrder);
        } else {
            secilenSiparisKodlari.delete(event.target.dataset.selectOrder);
        }
        secimKontrolleriniGuncelle();
        return;
    }

    if (event.target.id === "orderSort") {
        aktifSiparisSiralama = event.target.value;
        aktifSiparisSayfasi = 1;
        listeGoster(aktifListe);
        return;
    }

    if (event.target.id === "orderStatusFilter") {
        aktifSiparisDurumFiltresi = event.target.value;
        aktifSiparisSayfasi = 1;
        listeGoster(aktifListe);
        return;
    }

    if (event.target.id === "orderViewMode") {
        aktifSiparisGorunumu = event.target.value;
        aktifSiparisSayfasi = 1;
        listeGoster(aktifListe);
        return;
    }

    if (event.target.id === "orderPageSize") {
        siparisSayfaBoyutu = Number(event.target.value) || 10;
        aktifSiparisSayfasi = 1;
        listeGoster(aktifListe);
        return;
    }

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
        return;
    }

    if (event.target.id === "performanceDate") {
        performansOzetiniGetir();
        return;
    }

    if (["auditActionFilter", "auditDateFrom", "auditDateTo"].includes(event.target.id)) {
        denetimKayitlariniFiltrele();
    }
});

async function operasyonPanosuGoster() {
    scannerDurdur();
    aktifSekme = "operations";
    searchInput.disabled = true;
    document.body.className = "operationsMode";
    sekmeDurumuGuncelle();
    result.innerHTML = `<div class="loading">Operasyon verileri yükleniyor...</div>`;
    try {
        const response = await fetch("/operations/board", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Operasyon panosu açılamadı.");
        const board = data.result;
        result.innerHTML = `
            <section class="operationsBoard">
                <div class="sectionTitle"><div><p class="eyebrow">CANLI OPERASYON</p><h2>Depo Durumu</h2></div>
                    <button class="backButton" type="button" id="refreshOperations">Yenile</button></div>
                <div class="operationsMetrics">
                    <div><span>Hazırlanıyor</span><strong>${temizle(board.counts.preparing)}</strong></div>
                    <div><span>Bugün Hazırlandı</span><strong>${temizle(board.counts.completedToday)}</strong></div>
                    <div><span>Eksik Sipariş</span><strong>${temizle(board.counts.missing)}</strong></div>
                    <div><span>Kargoya Hazır</span><strong>${temizle(board.counts.ready)}</strong></div>
                    <div><span>Bugün Kargolandı</span><strong>${temizle(board.counts.shippedToday)}</strong></div>
                </div>
                <div class="sectionTitle"><h3>Şu Anda Hazırlananlar</h3><span>${temizle(board.active.length)} sipariş</span></div>
                <div class="activePreparationList">
                    ${board.active.length ? board.active.map(item => `
                        <article><div><strong>${temizle(item.customerName || item.orderCode)}</strong>
                        <span>${temizle(item.orderCode)} · ${temizle(item.platform)}</span></div>
                        <div><b>${temizle(item.worker)}</b><span>${temizle(tarihSaatGoster(item.startedAt))}</span>
                        ${aktifKullanici?.role === "admin" ? `<button class="unlockOrderButton" type="button" data-unlock-order="${temizle(item.orderCode)}">Kilidi Kaldır</button>` : ""}</div></article>
                    `).join("") : `<div class="notfound compact">Şu anda açık hazırlama kaydı yok.</div>`}
                </div>
            </section>
        `;
    } catch (err) {
        result.innerHTML = `<div class="notfound">${temizle(err.message)}</div>`;
    }
}

tabButtons.forEach(button => {
    button.addEventListener("click", function () {
        if (this.dataset.tab === aktifSekme) {
            return;
        }

        if (this.dataset.tab === "orders") {
            aktifSiparisPlatformu = "trendyol";
            searchInput.value = "";
            listeGoster(siparisler);
            return;
        }

        if (this.dataset.tab === "operations") {
            operasyonPanosuGoster();
        } else if (this.dataset.tab === "users") {
            aktifGecmisPlatformu = "trendyol";
            yonetimEkraniGoster();
        } else if (this.dataset.tab === "history") {
            aktifGecmisPlatformu = "trendyol";
            hazirlamaGecmisiEkraniGoster();
        } else if (this.dataset.tab === "issues") {
            aktifEksikPlatformu = "trendyol";
            sorunluSiparislerEkraniGoster();
        } else if (this.dataset.tab === "shipments") {
            sevkiyatEkraniGoster();
        } else {
            rafEkraniGoster();
        }
    });
});

document.addEventListener("click", async event => {
    if (event.target.closest("#refreshOperations")) {
        operasyonPanosuGoster();
        return;
    }

    const bildirimButonu = event.target.closest("#notificationButton");
    const bildirimPaneli = document.getElementById("notificationPanel");

    if (bildirimButonu) {
        const aciliyor = bildirimPaneli?.hidden;

        if (bildirimPaneli) {
            bildirimPaneli.hidden = !aciliyor;
        }

        if (aciliyor && bildirimler.some(item => !item.read)) {
            bildirimler = bildirimler.map(item => ({ ...item, read: true }));
            bildirimPaneliniGuncelle();
            if (bildirimPaneli) {
                bildirimPaneli.hidden = false;
            }
            fetch("/notifications/read", { method: "POST" }).catch(() => {});
        }
        return;
    }

    const bildirimKaydi = event.target.closest("[data-notification-order]");

    if (bildirimKaydi) {
        const orderCode = bildirimKaydi.dataset.notificationOrder;

        if (bildirimPaneli) {
            bildirimPaneli.hidden = true;
        }

        if (orderCode && siparisler.some(item => siparisKodu(item) === orderCode)) {
            await siparisSec(orderCode);
        }
        return;
    }

    if (!event.target.closest(".notificationShell") && bildirimPaneli) {
        bildirimPaneli.hidden = true;
    }

    if (!event.target.closest("#logoutButton")) {
        return;
    }

    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    if (bildirimZamanlayici) {
        clearInterval(bildirimZamanlayici);
        bildirimZamanlayici = null;
    }
    if (apiDurumZamanlayici) {
        clearInterval(apiDurumZamanlayici);
        apiDurumZamanlayici = null;
    }
    if (siparisYenilemeZamanlayici) {
        clearInterval(siparisYenilemeZamanlayici);
        siparisYenilemeZamanlayici = null;
    }
    girisEkraniGoster();
});

window.addEventListener("beforeunload", scannerDurdur);

oturumuBaslat();
