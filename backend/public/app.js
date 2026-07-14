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
let aktifSiparisPlatformu = "zoombutik";
let aktifSiparisSiralama = "newest";
let aktifSiparisDurumFiltresi = "";
let aktifSiparisRafGrubu = "";
let aktifSiparisGorunumu = "single";
let aktifSiparisKuyrugu = "new";
let aktifTopluGruplar = [];
let aktifTopluSiparisler = [];
let aktifTopluSiparisIndex = 0;
const secilenSiparisKodlari = new Set();
let etiketBaskiKayitlari = {};
let siparisFisiBaskiKayitlari = {};
let siparisSayfaBoyutu = 10;
let aktifSiparisSayfasi = 1;
let aktifEksikPlatformu = "zoombutik";
let aktifSevkiyatPlatformu = "zoombutik";
let aktifGecmisPlatformu = "zoombutik";
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
let etiketKuyrukVerisi = { agent: {}, result: [] };
let aktifEtiketKuyrukPersoneli = "";
let sonPaketKodu = "";
const apiUrunDetayCache = new Map();

const HIZMET_BARKODLARI = ["HZMBDL"];
const OKUMA_BEKLEME_MS = 450;
const TARAYICI_KARE_ARALIGI_MS = 90;
const SIPARIS_RAF_GRUPLARI = {
    bolge1: [[16, 23], [44, 51]],
    bolge2: [[1, 15], [52, 72]],
    bolge3: [[23, 36], [36, 43]]
};

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

function sadeceZoomSiparisleri(liste) {
    return Array.isArray(liste) ? liste : [];
}

function platformSekmeleriHtml(scope, aktif, kayitlar, platformOkuyucu) {
    const kaynak = Array.isArray(kayitlar) ? kayitlar : [];
    const sayilar = kaynak.reduce((toplam, item) => {
        const key = platformAnahtari(platformOkuyucu(item));
        toplam[key] = (toplam[key] || 0) + 1;
        return toplam;
    }, { trendyol: 0, zoombutik: 0 });
    const sekmeler = [
        ["trendyol", "Trendyol"],
        ["zoombutik", "Zoombutik"]
    ];
    return `
        <div class="platformTabs" role="tablist" aria-label="Platform filtreleri">
            ${sekmeler.map(([key, label]) => `
                <button type="button"
                    data-platform-scope="${temizle(scope)}"
                    data-platform-value="${key}"
                    class="${aktif === key ? "active" : ""}"
                    aria-selected="${aktif === key}">
                    ${label} <span>${temizle(sayilar[key] || 0)}</span>
                </button>
            `).join("")}
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

function yereldeKargolanmisMi(item) {
    return item?.localShipmentStatus === "shipped" || Boolean(item?.localShipmentCarrierAcceptedAt || item?.localShipmentShippedAt);
}

function siparisListeDurumuEtiketi(item) {
    if (yereldeKargolanmisMi(item)) return "Kargolandı";
    if (yereldeHazirlanmisMi(item)) return "Hazırlandı";
    return siparisDurumu(item);
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
        "summary.overall",
        "summary.total",
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
        "summary.overall",
        "summary.total",
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

function odemeYontemi(item) {
    const value = alanOku(item, [
        "order.paymentMethod",
        "order.paymentMethodName",
        "order.paymentType",
        "order.paymentTypeName",
        "paymentMethod",
        "paymentMethodName",
        "paymentType",
        "paymentTypeName"
    ], "");
    if (value && typeof value === "object") {
        return value.name || value.title || value.value || value.type || "Belirtilmemiş";
    }
    return value || "Belirtilmemiş";
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

function rafSiraNumarasi(urun) {
    const eslesme = urunRafKodu(urun).match(/^\s*(\d+)/);
    return eslesme ? Number(eslesme[1]) : null;
}

function siparisRafGrubunaUyuyor(siparis, grup) {
    if (!grup) return true;
    const araliklar = SIPARIS_RAF_GRUPLARI[grup] || [];
    return (siparis.products || []).some(urun => {
        if (hizmetUrunuMu(urun)) return false;
        const raf = rafSiraNumarasi(urun);
        return raf !== null && araliklar.some(([baslangic, bitis]) =>
            raf >= baslangic && raf <= bitis
        );
    });
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

function fiyatSayiyaCevir(deger) {
    if (typeof deger === "number") return Number.isFinite(deger) ? deger : null;
    const metin = String(deger ?? "").trim();
    if (!metin || metin === "-") return null;
    const temiz = metin.replace(/[^\d,.-]/g, "");
    const normalize = temiz.includes(",")
        ? temiz.replaceAll(".", "").replace(",", ".")
        : temiz;
    const sayi = Number(normalize);
    return Number.isFinite(sayi) ? sayi : null;
}

function fiyatYaz(sayi) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2
    }).format(sayi);
}

function urunFiyati(urun) {
    const tekilFiyat = alanOku(urun, [
        "unitPrice",
        "unit_price",
        "salePrice",
        "sellingPrice",
        "discountedPrice",
        "productPrice",
        "price",
        "amountPerUnit",
        "details.unitPrice",
        "details.salePrice",
        "details.sellingPrice",
        "details.price"
    ], "");
    const tekilSayi = fiyatSayiyaCevir(tekilFiyat);
    if (tekilSayi !== null) return fiyatYaz(tekilSayi);

    const toplamFiyat = alanOku(urun, [
        "totalPrice",
        "lineTotal",
        "total",
        "amount",
        "productTotal",
        "details.totalPrice",
        "details.lineTotal",
        "details.total",
        "details.amount"
    ], "");
    const toplamSayi = fiyatSayiyaCevir(toplamFiyat);
    if (toplamSayi !== null) return fiyatYaz(toplamSayi / urunAdedi(urun));

    return "-";
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
    const barcode = barkodKarsilastir(urunBarkodu(urun));
    const code = barkodKarsilastir(urunKodu(urun));
    const name = aramaNormalize(urunAdi(urun));
    return HIZMET_BARKODLARI.includes(barcode)
        || HIZMET_BARKODLARI.includes(code)
        || [
            "kargo ve hizmet bedeli",
            "kargo bedeli",
            "hizmet bedeli",
            "shipping fee",
            "service fee"
        ].some(term => name.includes(term));
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
        source: "barcode",
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
        siparisYenilemeZamanlayici = window.setInterval(siparisleriSessizYenile, 10000);
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
        const detay = data.message ? ` Detay: ${temizle(data.message)}` : "";
        apiStatusBanner.innerHTML = `
            <strong>Qukasoft API bağlantısı kesildi.</strong>
            <span>${siparisler.length
                ? "Son başarılı sipariş listesi gösteriliyor; yeni siparişler bağlantı gelince otomatik eklenecek."
                : "Siparişler şu anda alınamıyor."}${zaman ? ` Son hata: ${temizle(zaman)}` : ""}</span>
            ${detay ? `<small>${detay}</small>` : ""}
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
            etiketBaskiKayitlariniGetir(),
            siparisFisiBaskiKayitlariniGetir()
        ]);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Siparişler yüklenemedi.");

        siparisler = sadeceZoomSiparisleri(data?.result?.list);
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

        const qukaListesi = sadeceZoomSiparisleri(data?.result?.list);
        const eskiKodlar = new Set(siparisler.map(siparisKodu));
        const yeniGelenler = qukaListesi.filter(item => !eskiKodlar.has(siparisKodu(item)));
        const yeniListe = [
            ...yeniGelenler,
            ...qukaListesi.filter(item => eskiKodlar.has(siparisKodu(item)))
        ];
        const yeniSiparisSayisi = yeniGelenler.length;
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

    const kargolananListe = liste.filter(item => yereldeKargolanmisMi(item));
    const hazirlanacakListe = liste.filter(item => !yereldeHazirlanmisMi(item) && !item?.hasOpenIssue && !yereldeKargolanmisMi(item));
    const kuyrukListesi = aktifSiparisKuyrugu === "shipped"
        ? kargolananListe
        : hazirlanacakListe.filter(item => (item.localWorkflowStage || "new") === aktifSiparisKuyrugu);
    const kargolananGorunumu = aktifSiparisKuyrugu === "shipped";
    const islemKuyruguGorunumu = !kargolananGorunumu;
    const platformListesi = siparisSiralamaUygula(kuyrukListesi.filter(item =>
        platformAnahtari(platformAdi(item)) === aktifSiparisPlatformu
        && (kargolananGorunumu || !aktifSiparisDurumFiltresi || String(alanOku(item, ["order.status", "status"], "")) === aktifSiparisDurumFiltresi)
        && siparisRafGrubunaUyuyor(item, aktifSiparisRafGrubu)
    ));
    const toplamSayfa = Math.max(1, Math.ceil(platformListesi.length / siparisSayfaBoyutu));
    aktifSiparisSayfasi = Math.min(Math.max(1, aktifSiparisSayfasi), toplamSayfa);
    const sayfaBaslangici = (aktifSiparisSayfasi - 1) * siparisSayfaBoyutu;
    const sayfadakiSiparisler = platformListesi.slice(sayfaBaslangici, sayfaBaslangici + siparisSayfaBoyutu);
    result.innerHTML = `
        <div class="platformTabs orderQueueTabs" role="tablist" aria-label="Sipariş kuyruğu">
            <button type="button" data-order-queue="new" class="${aktifSiparisKuyrugu === "new" ? "active" : ""}">
                Yeni Siparişler <span>${temizle(hazirlanacakListe.filter(item => (item.localWorkflowStage || "new") === "new").length)}</span>
            </button>
            <button type="button" data-order-queue="preparing" class="${aktifSiparisKuyrugu === "preparing" ? "active" : ""}">
                Hazırlanan Siparişler <span>${temizle(hazirlanacakListe.filter(item => item.localWorkflowStage === "preparing").length)}</span>
            </button>
            <button type="button" data-order-queue="shipped" class="${aktifSiparisKuyrugu === "shipped" ? "active" : ""}">
                Kargolanan Siparisler <span>${temizle(kargolananListe.length)}</span>
            </button>
        </div>
        ${platformSekmeleriHtml("orders", aktifSiparisPlatformu, kuyrukListesi, platformAdi)}
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
                <select id="orderStatusFilter" ${islemKuyruguGorunumu ? "" : "disabled"}>
                    <option value="" ${aktifSiparisDurumFiltresi === "" ? "selected" : ""}>Tüm Aktif Siparişler</option>
                    <option value="1" ${aktifSiparisDurumFiltresi === "1" ? "selected" : ""}>Yeni Sipariş</option>
                    <option value="2" ${aktifSiparisDurumFiltresi === "2" ? "selected" : ""}>Hazırlanıyor</option>
                </select>
            </label>
            <label>
                <span>Hazırlama şekli</span>
                <select id="orderViewMode" ${islemKuyruguGorunumu ? "" : "disabled"}>
                    <option value="single" ${aktifSiparisGorunumu === "single" ? "selected" : ""}>Tek Siparişler</option>
                    <option value="batch" ${aktifSiparisGorunumu === "batch" ? "selected" : ""}>Aynı Ürünlü Gruplar</option>
                </select>
            </label>
            <label>
                <span>Raf bölgesi</span>
                <select id="orderShelfGroup">
                    <option value="" ${aktifSiparisRafGrubu === "" ? "selected" : ""}>Tüm Raflar</option>
                    <option value="bolge1" ${aktifSiparisRafGrubu === "bolge1" ? "selected" : ""}>16–23 / 44–51</option>
                    <option value="bolge2" ${aktifSiparisRafGrubu === "bolge2" ? "selected" : ""}>1–15 / 52–72</option>
                    <option value="bolge3" ${aktifSiparisRafGrubu === "bolge3" ? "selected" : ""}>23–36 / 36–43</option>
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
        <div class="bulkLabelControls" ${islemKuyruguGorunumu && aktifSiparisGorunumu !== "batch" ? "" : "hidden"}>
            <div>
                <strong>Toplu yazdırma seçimi</strong>
                <span id="selectedOrderCount">${temizle(secilenSiparisKodlari.size)} sipariş seçildi</span>
            </div>
            <button type="button" data-select-all-orders>Tümünü Seç</button>
            <button type="button" data-clear-order-selection>Seçimi Kaldır</button>
            ${aktifSiparisKuyrugu === "new" ? `
                <button class="cargoLabelButton" type="button" data-move-selected-to-preparing ${secilenSiparisKodlari.size ? "" : "disabled"}>
                    Seçilenleri Hazırlananlara Al
                </button>
            ` : `
                <button class="cargoLabelButton" type="button" data-manual-ready-selected ${secilenSiparisKodlari.size ? "" : "disabled"}>
                    Seçilenleri Kargolanan Siparislere Al
                </button>
            `}
            <button class="cargoLabelButton" type="button" data-print-selected-slips ${secilenSiparisKodlari.size ? "" : "disabled"}>
                Seçilen A4 Sipariş Fişlerini Yazdır
            </button>
            <button class="cargoLabelButton" type="button" data-print-selected-cargo-barcodes ${secilenSiparisKodlari.size ? "" : "disabled"}>
                Seçilen 100×100 Kargo Barkodlarını Yazdır
            </button>
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

    if (islemKuyruguGorunumu && aktifSiparisGorunumu === "batch") {
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
        const urunSayisi = (item.products || []).filter(urun => !hizmetUrunuMu(urun)).length;
        result.innerHTML += `
            <article class="orderCard">
                <div class="cardTop">
                    <label class="orderSelect" ${islemKuyruguGorunumu ? "" : "hidden"}>
                        <input type="checkbox" data-select-order="${temizle(kod)}"
                            ${secilenSiparisKodlari.has(kod) ? "checked" : ""}>
                        <span>Yazdırmak için seç</span>
                    </label>
                    <div class="orderCardIdentity">
                        <h2>${temizle(musteriAdi(item))}</h2>
                        <p>Sipariş No: <strong>${temizle(kod)}</strong></p>
                        ${etiketBaskiKaydi(item) ? `
                            <span class="printedLabelBadge" title="${temizle(etiketBaskiKaydi(item).lastPrintedBy)} · ${temizle(tarihSaatGoster(etiketBaskiKaydi(item).lastPrintedAt))}">
                                ✓ Yazdırıldı · ${temizle(etiketBaskiKaydi(item).printCount)} kez
                            </span>
                        ` : ""}
                        ${siparisFisiBaskiKaydi(item) ? `
                            <span class="printedLabelBadge" title="${temizle(siparisFisiBaskiKaydi(item).lastPrintedBy)} · ${temizle(tarihSaatGoster(siparisFisiBaskiKaydi(item).lastPrintedAt))}">
                                ✓ A4 Fiş Yazdırıldı · ${temizle(siparisFisiBaskiKaydi(item).printCount)} kez
                            </span>
                        ` : ""}
                    </div>
                    <span class="cardStatus">${temizle(siparisListeDurumuEtiketi(item))}</span>
                </div>

                <div class="cardMeta">
                    <span><b>Platform</b>${temizle(platformAdi(item))}</span>
                    <span><b>Ürün Sayısı</b>${temizle(urunSayisi)}</span>
                    <span><b>Ödeme</b>${temizle(odemeYontemi(item))}</span>
                    <span><b>Tutar</b>${temizle(toplamTutar(item))}</span>
                </div>

                <div class="orderCardActions">
                    <button class="cargoLabelButton" type="button" data-print-order-slip="${temizle(kod)}">
                        ${temizle(siparisFisiButonMetni(item))}
                    </button>
                    <button class="cargoLabelButton" type="button" data-print-cargo-barcode="${temizle(kod)}">
                        100×100 Kargo Barkodu
                    </button>
                    ${aktifSiparisKuyrugu === "new" ? `
                        <button class="cargoLabelButton" type="button" data-move-to-preparing="${temizle(kod)}">Hazırlananlara Al</button>
                    ` : aktifSiparisKuyrugu === "preparing" ? `
                        <button class="cargoLabelButton" type="button" data-manual-ready-order="${temizle(kod)}">Kargolanan Siparislere Al</button>
                        <button class="openOrderButton" type="button" data-order-code="${temizle(kod)}">Siparişi Aç</button>
                    ` : ""}
                </div>
            </article>
        `;
    });
    kargoBarkoduButonlariniGuncelle(sayfadakiSiparisler);
}

function sekmeDurumuGuncelle() {
    tabButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.tab === aktifSekme);
    });
}

function secimKontrolleriniGuncelle() {
    const count = document.getElementById("selectedOrderCount");
    const printButtons = document.querySelectorAll(
        "[data-print-selected-orders], [data-print-selected-slips], [data-print-selected-cargo-barcodes], [data-move-selected-to-preparing], [data-manual-ready-selected]"
    );
    if (count) count.textContent = `${secilenSiparisKodlari.size} sipariş seçildi`;
    printButtons.forEach(button => {
        button.disabled = secilenSiparisKodlari.size === 0;
    });
}

async function siparisAsamasiniGuncelle(orders, stage) {
    const response = await fetch("/order-workflow/stage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            orderCodes: orders.map(siparisKodu).filter(Boolean),
            stage
        })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Sipariş aşaması güncellenemedi.");
    orders.forEach(order => {
        order.localWorkflowStage = stage;
    });
    secilenSiparisKodlari.clear();
    listeGoster(aktifListe);
    return data.result;
}

async function siparisleriKargolananlaraAl(orders) {
    let tamamlanan = 0;
    for (const order of orders) {
        if (order.hasOpenIssue) {
            throw new Error(`${siparisKodu(order)} siparişinde açık eksik/sorun kaydı var.`);
        }
        await hazirlamaKaydiGonder("complete", order, {
            scans: [],
            orderSnapshot: siparisOzeti(order)
        });
        const shipment = await sevkiyatDurumuKaydet(order, "shipped");
        siparisiYereldeHazirIsaretle(order);
        order.localShipmentStatus = "shipped";
        order.localShipmentShippedAt = shipment.shippedAt || new Date().toISOString();
        order.localShipmentUpdatedAt = shipment.updatedAt || order.localShipmentShippedAt;
        siparisler.forEach(item => {
            if (siparisKodu(item).toUpperCase() === siparisKodu(order).toUpperCase()) {
                item.localPreparationStatus = "completed";
                item.localShipmentStatus = "shipped";
                item.localShipmentShippedAt = order.localShipmentShippedAt;
                item.localShipmentUpdatedAt = order.localShipmentUpdatedAt;
            }
        });
        tamamlanan += 1;
    }
    secilenSiparisKodlari.clear();
    listeGoster(aktifListe);
    return tamamlanan;
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
            ${aktifKullanici?.role === "admin" ? `
                <form class="barcodeOverrideForm" data-barcode-override="${temizle(kayit.originalBarcode || kayit.barcode)}">
                    <label>
                        <span>Beden Barkodu${kayit.originalBarcode && kayit.originalBarcode !== kayit.barcode
                            ? ` · Eski: ${temizle(kayit.originalBarcode)}`
                            : ""}</span>
                        <input name="barcode" value="${temizle(kayit.barcode)}" maxlength="128" required>
                    </label>
                    <button type="submit">Barkodu Değiştir</button>
                </form>
            ` : ""}
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
    frame.style.width = "48mm";
    frame.style.height = "28mm";
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
                @page { size: 48mm 28mm; margin: 0; }
                * { box-sizing: border-box; }
                html, body {
                    width: 48mm !important;
                    min-width: 48mm !important;
                    max-width: 48mm !important;
                    height: 28mm !important;
                    min-height: 28mm !important;
                    max-height: 28mm !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: hidden !important;
                    background: #fff !important;
                }
                body {
                    display: block !important;
                    position: relative !important;
                }
                .barcodeLabel {
                    display: grid;
                    grid-template-rows: 3.5mm 3.2mm 3.2mm minmax(0, 1fr);
                    align-items: center;
                    position: absolute !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 47mm !important;
                    min-width: 47mm !important;
                    max-width: 47mm !important;
                    height: 27mm !important;
                    min-height: 27mm !important;
                    max-height: 27mm !important;
                    margin: 0 !important;
                    padding: .7mm 1mm;
                    overflow: hidden;
                    background: #fff;
                    color: #000;
                    font-family: Arial, sans-serif;
                }
                .barcodeLabelName {
                    display: block;
                    overflow: hidden;
                    font-size: 5pt;
                    line-height: 3.5mm;
                    text-align: center;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .barcodeLabelCode {
                    display: block;
                    overflow: hidden;
                    min-width: 0;
                    font-size: 4.3pt;
                    font-weight: 700;
                    line-height: 3.2mm;
                    text-align: center;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .barcodeLabelVariant {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 1mm;
                    min-width: 0;
                    font-size: 4.5pt;
                    font-weight: 800;
                    line-height: 3.2mm;
                }
                .barcodeLabelVariant span {
                    display: block;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                svg {
                    display: block;
                    width: 45mm !important;
                    height: 15mm !important;
                    min-height: 0;
                }
            </style>
        </head>
        <body>${etiket.outerHTML}</body>
        </html>
    `;
    document.body.appendChild(frame);
}

function urunEtiketiPenceredeYazdir(etiket, tamamlandi) {
    const printWindow = window.open("", "zoomProductBarcodePrint", "popup,width=420,height=320");
    if (!printWindow) {
        tamamlandi();
        mesajGoster("error", "Yazdırma penceresi açılamadı", "Tarayıcının açılır pencere iznini kontrol edin.");
        return;
    }

    const temizle = () => {
        window.setTimeout(() => {
            try { printWindow.close(); } catch {}
        }, 300);
        tamamlandi();
    };

    printWindow.document.open();
    printWindow.document.write(`
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>50x30 Ürün Barkodu</title>
            <style>
                @page { size: 50mm 30mm; margin: 0; }
                * { box-sizing: border-box; }
                html, body {
                    width: 50mm !important;
                    min-width: 50mm !important;
                    max-width: 50mm !important;
                    height: 30mm !important;
                    min-height: 30mm !important;
                    max-height: 30mm !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: hidden !important;
                    background: #fff !important;
                }
                body {
                    display: flex !important;
                    align-items: flex-start !important;
                    justify-content: center !important;
                }
                .barcodeLabel {
                    display: grid;
                    grid-template-rows: 3.6mm 3.2mm 3.2mm minmax(0, 1fr);
                    align-items: center;
                    width: 46mm !important;
                    min-width: 46mm !important;
                    max-width: 46mm !important;
                    height: 26mm !important;
                    min-height: 26mm !important;
                    max-height: 26mm !important;
                    margin: 0 !important;
                    padding: .5mm .8mm;
                    overflow: hidden;
                    background: #fff;
                    color: #000;
                    font-family: "Arial Black", Arial, sans-serif;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .barcodeLabelName {
                    display: block;
                    overflow: hidden;
                    font-size: 5.8pt;
                    font-weight: 900;
                    letter-spacing: .02mm;
                    line-height: 3.6mm;
                    text-align: center;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .barcodeLabelCode {
                    display: block;
                    overflow: hidden;
                    min-width: 0;
                    font-size: 5pt;
                    font-weight: 900;
                    letter-spacing: .01mm;
                    line-height: 3.2mm;
                    text-align: center;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .barcodeLabelVariant {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 1mm;
                    min-width: 0;
                    font-size: 5.1pt;
                    font-weight: 900;
                    letter-spacing: .01mm;
                    line-height: 3.2mm;
                }
                .barcodeLabelVariant span {
                    display: block;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                svg {
                    display: block;
                    width: 44mm !important;
                    height: 14mm !important;
                    min-height: 0;
                }
            </style>
        </head>
        <body>${etiket.outerHTML}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.addEventListener("afterprint", temizle, { once: true });
    printWindow.setTimeout(() => {
        try {
            printWindow.focus();
            printWindow.print();
        } catch {
            temizle();
            mesajGoster("error", "Yazdırma penceresi açılamadı", "Tarayıcının yazdırma iznini kontrol edin.");
        }
    }, 300);
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
                    <span>Raf: ${temizle(kayit.location || "-")}</span>
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
        width: 1.35,
        height: 29,
        displayValue: true,
        fontSize: 8,
        textMargin: 1,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 4,
        marginRight: 4
    });

    modal.querySelectorAll(".closePrintModal").forEach(button => {
        button.addEventListener("click", () => modal.remove());
    });

    const yazdirButonu = modal.querySelector("#printBarcodeNow");
    yazdirButonu.addEventListener("click", () => {
        yazdirButonu.disabled = true;
        yazdirButonu.textContent = "Yazdırılıyor...";
        const etiket = modal.querySelector("#barcodeLabel");
        urunEtiketiPenceredeYazdir(etiket, () => {
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

function rafSonucListesindeGuncelle(kayit) {
    const sonuc = document.getElementById("locationResult");
    if (!sonuc) return;

    const key = barkodKarsilastir(kayit.barcode);
    let bulundu = false;
    sonRafAramaKayitlari = sonRafAramaKayitlari.map(item => {
        if (barkodKarsilastir(item.barcode) !== key) return item;
        bulundu = true;
        return { ...item, ...kayit };
    });
    if (!bulundu) {
        sonRafAramaKayitlari.push(kayit);
    }
    sonuc.innerHTML = sonRafAramaKayitlari.map(rafSonucKarti).join("");
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
                <div class="locationHeaderActions">
                    ${aktifKullanici?.role === "admin"
                        ? `<button class="syncCatalogButton" type="button" id="syncProductCatalog">Barkodları Güncelle</button>`
                        : ""}
                    <button class="scanButton" type="button" id="startLocationScanner">📷 Barkodu Okut</button>
                </div>
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
        "order.cargoBarcode",
        "order.shipmentBarcode",
        "order.shippingBarcode",
        "order.shipmentCode",
        "order.shipmentCode2",
        "order.cargoTrackingNumber",
        "order.cargoTrackingCode",
        "order.trackingNumber",
        "order.trackingCode",
        "order.barcode",
        "cargoBarcode",
        "shipmentBarcode",
        "shippingBarcode",
        "shipmentCode",
        "cargoCode",
        "cargoTrackingNumber",
        "cargoTrackingCode",
        "trackingNumber",
        "trackingCode",
        "barcode"
    ], "")).trim();
}

function ean13KontrolHanesi(base12) {
    const toplam = [...base12].reduce((sum, digit, index) =>
        sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0
    );
    return String((10 - (toplam % 10)) % 10);
}

function qukaFisKargoBarkodu(siparis) {
    const orderCode = String(siparisKodu(siparis)).trim();
    if (platformAnahtari(platformAdi(siparis)) !== "zoombutik" || !/^\d{9}$/.test(orderCode)) {
        return "";
    }
    const base12 = `100${orderCode}`;
    return `${base12}${ean13KontrolHanesi(base12)}`;
}

function kargoEtiketiBarkodu(siparis) {
    return kargoGonderiKodu(siparis) || qukaFisKargoBarkodu(siparis);
}

function qukaFisBarkoduKullaniliyor(siparis) {
    return !kargoGonderiKodu(siparis) && Boolean(qukaFisKargoBarkodu(siparis));
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

function kargoEtiketiSiparisOzeti(siparis) {
    const products = (siparis.products || []).filter(urun => !hizmetUrunuMu(urun));
    const visible = products.slice(0, 4).map(urun =>
        `<span><b>${temizle(urunAdedi(urun))}x</b> ${temizle(urunAdi(urun))} · ${temizle(urunRengi(urun))} / ${temizle(urunBedeni(urun))}</span>`
    ).join("");
    const remaining = products.length - 4;
    const queueJob = etiketKuyrukVerisi.result.find(job =>
        String(job.orderCode).toUpperCase() === siparisKodu(siparis).toUpperCase()
    );
    return `
        <div class="cargoOrderInfo">
            <strong>${temizle(odemeYontemi(siparis))} · ${temizle(toplamTutar(siparis))}</strong>
            ${queueJob ? `<strong>Hazırlayan: ${temizle(queueJob.preparedByName)} · Paket: ${temizle(queueJob.packageCode)}</strong>` : ""}
            ${visible}
            ${remaining > 0 ? `<span>+ ${temizle(remaining)} ürün daha</span>` : ""}
        </div>
    `;
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

function kargoBarkoduButonMetni(order) {
    return etiketBaskiKaydi(order) ? "✓ Yazdırıldı · Tekrar Yazdır" : "100×100 Kargo Barkodu";
}

function kargoBarkoduButonlariniGuncelle(kaynakListe = []) {
    document.querySelectorAll("[data-print-cargo-barcode]").forEach(button => {
        const kod = String(button.dataset.printCargoBarcode || "").toUpperCase();
        const order = [aktifSiparis, ...aktifTopluSiparisler, ...kaynakListe, ...siparisler]
            .find(item => item && siparisKodu(item).toUpperCase() === kod);
        if (order) button.textContent = kargoBarkoduButonMetni(order);
    });
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

async function siparisFisiBaskiKayitlariniGetir() {
    const response = await fetch("/order-slip-prints", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "A4 fiş geçmişi alınamadı.");
    siparisFisiBaskiKayitlari = Object.fromEntries(
        (data.result || []).map(item => [String(item.orderCode).toUpperCase(), item])
    );
}

function siparisFisiBaskiKaydi(order) {
    return siparisFisiBaskiKayitlari[siparisKodu(order).toUpperCase()] || null;
}

function siparisFisiButonMetni(order, kisa = false) {
    if (siparisFisiBaskiKaydi(order)) return "✓ Yazdırıldı · Tekrar Yazdır";
    return kisa ? "A4 Sipariş Fişi" : "A4 Sipariş Fişi Yazdır";
}

async function siparisFisiBaskisiniKaydet(orders) {
    const response = await fetch("/order-slip-prints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCodes: orders.map(siparisKodu).filter(Boolean) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "A4 fiş baskısı kaydedilemedi.");
    await siparisFisiBaskiKayitlariniGetir();
    if (aktifSekme === "orders" && !document.body.classList.contains("detailMode")) {
        listeGoster(aktifListe);
    }
}

function manuelKargoEtiketleriniYazdir(etiketler) {
    const etiketHtml = etiketler.map(etiket => etiket.outerHTML).join("");
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.left = "-10000px";
    frame.style.top = "0";
    frame.style.width = "100mm";
    frame.style.height = "100mm";
    frame.style.border = "0";

    const temizleFrame = () => frame.remove();
    frame.addEventListener("load", () => {
        const printWindow = frame.contentWindow;
        if (!printWindow) {
            temizleFrame();
            mesajGoster("error", "Yazdırma penceresi açılamadı", "Tarayıcının yazdırma iznini kontrol edin.");
            return;
        }

        printWindow.addEventListener("afterprint", temizleFrame, { once: true });
        printWindow.requestAnimationFrame(() => {
            printWindow.requestAnimationFrame(() => {
                window.setTimeout(() => {
                    try {
                        printWindow.focus();
                        printWindow.print();
                    } catch {
                        temizleFrame();
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
            <title>100x100 Kargo Etiketi</title>
            <link rel="stylesheet" href="/style.css?v=3.10.6">
            <style>
                @page { size: 100mm 100mm; margin: 0; }
                * { box-sizing: border-box; }
                html, body {
                    width: 100mm !important;
                    min-width: 100mm !important;
                    height: auto !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: visible !important;
                    background: #fff !important;
                }
                body > .cargoShippingLabel {
                    display: grid !important;
                    width: 100mm !important;
                    min-width: 100mm !important;
                    max-width: 100mm !important;
                    height: 100mm !important;
                    min-height: 100mm !important;
                    max-height: 100mm !important;
                    margin: 0 !important;
                    padding: 4mm !important;
                    border: 0 !important;
                    overflow: hidden !important;
                    break-after: page;
                    page-break-after: always;
                }
                body > .cargoShippingLabel:last-child {
                    break-after: auto;
                    page-break-after: auto;
                }
                .cargoBarcodeArea svg {
                    width: 100% !important;
                    max-width: none !important;
                }
            </style>
        </head>
        <body>${etiketHtml}</body>
        </html>
    `;
    document.body.appendChild(frame);
}

async function siparisFisiYazdir(siparisVeyaListe) {
    const fisSiparisleri = (Array.isArray(siparisVeyaListe) ? siparisVeyaListe : [siparisVeyaListe]).filter(Boolean);
    if (!fisSiparisleri.length) return;
    siparisFisiBaskisiniKaydet(fisSiparisleri).catch(err => {
        mesajGoster("error", "A4 fiş baskısı işaretlenemedi", err.message);
    });
    const fisBarkodlari = new Map(fisSiparisleri.map(siparis => {
        const barkod = kargoEtiketiBarkodu(siparis);
        if (!barkod || typeof JsBarcode !== "function") return [siparis, ""];
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        JsBarcode(svg, barkod, {
            format: "CODE128",
            width: 1.5,
            height: 42,
            displayValue: true,
            fontSize: 12,
            margin: 0
        });
        return [siparis, svg.outerHTML];
    }));
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.left = "-10000px";
    frame.style.top = "0";
    frame.style.width = "210mm";
    frame.style.height = "297mm";
    frame.style.border = "0";

    const temizleFrame = () => frame.remove();
    frame.addEventListener("load", () => {
        const printWindow = frame.contentWindow;
        if (!printWindow) {
            temizleFrame();
            mesajGoster("error", "Sipariş fişi açılamadı", "Tarayıcının yazdırma iznini kontrol edin.");
            return;
        }
        printWindow.addEventListener("afterprint", temizleFrame, { once: true });
        window.setTimeout(() => {
            try {
                printWindow.focus();
                printWindow.print();
            } catch {
                temizleFrame();
                mesajGoster("error", "Sipariş fişi yazdırılamadı", "Tarayıcının yazdırma iznini kontrol edin.");
            }
        }, 50);
    }, { once: true });

    frame.srcdoc = `
        <!doctype html>
        <html lang="tr">
        <head>
            <meta charset="utf-8">
            <title>Sipariş Fişi · ${temizle(fisSiparisleri.length === 1 ? siparisKodu(fisSiparisleri[0]) : `${fisSiparisleri.length} sipariş`)}</title>
            <style>
                @page { size: A4 portrait; margin: 10mm; }
                * { box-sizing: border-box; }
                html, body { margin: 0; padding: 0; color: #101828; background: #fff; font-family: Arial, sans-serif; }
                body { width: 190mm; font-size: 10pt; }
                .slipPage { width: 190mm; min-height: 277mm; break-after: page; page-break-after: always; }
                .slipPage:last-child { break-after: auto; page-break-after: auto; }
                header { display: flex; justify-content: space-between; gap: 10mm; padding-bottom: 5mm; border-bottom: 2px solid #101828; }
                h1 { margin: 0 0 2mm; font-size: 22pt; }
                .brand { font-size: 12pt; font-weight: 900; letter-spacing: .08em; }
                .orderCode { display: grid; justify-items: center; width: 68mm; padding: 2mm 3mm; border: 2px solid #101828; border-radius: 2mm; font-size: 15pt; font-weight: 900; text-align: center; }
                .orderCode svg { display: block; width: 62mm; height: 17mm; }
                .orderCode small { margin-top: 1mm; font-size: 7pt; font-weight: 700; }
                .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin: 4mm 0; }
                .meta div { min-height: 16mm; padding: 2.5mm; border: 1px solid #d0d5dd; border-radius: 2mm; }
                .meta span { display: block; margin-bottom: 1mm; color: #667085; font-size: 8pt; font-weight: 700; text-transform: uppercase; }
                .meta strong { font-size: 10pt; overflow-wrap: anywhere; }
                .address { margin-bottom: 4mm; padding: 3mm; border: 1px solid #d0d5dd; border-radius: 2mm; line-height: 1.35; }
                .address strong { display: block; margin-bottom: 1mm; }
                .summary { display: flex; justify-content: space-between; margin: 3mm 0 2mm; font-weight: 900; }
                .product { display: grid; grid-template-columns: 24mm 20mm minmax(0, 1fr) 18mm; gap: 3mm; align-items: center; min-height: 30mm; padding: 2.5mm 0; border-top: 1px solid #d0d5dd; break-inside: avoid; page-break-inside: avoid; }
                .photo { display: flex; align-items: center; justify-content: center; width: 24mm; height: 24mm; overflow: hidden; border: 1px solid #d0d5dd; border-radius: 2mm; color: #98a2b3; font-size: 7pt; text-align: center; }
                .photo img { width: 100%; height: 100%; object-fit: contain; }
                .shelf { display: flex; align-items: center; justify-content: center; min-height: 18mm; padding: 1mm; border: 2px solid #101828; border-radius: 2mm; font-size: 14pt; font-weight: 900; text-align: center; }
                .product h2 { margin: 0 0 1mm; font-size: 11pt; }
                .details { display: grid; grid-template-columns: minmax(0, 1fr) 25mm; grid-template-rows: auto auto; gap: 1mm 4mm; align-items: center; color: #344054; font-size: 8.5pt; }
                .details b { color: #101828; }
                .sizeBadge { grid-column: 2; grid-row: 1 / span 2; display: grid; align-content: center; justify-items: center; min-height: 18mm; padding: 1mm; border: 2px solid #101828; border-radius: 2mm; color: #101828; text-align: center; }
                .sizeBadge em { font-style: normal; font-size: 7pt; font-weight: 900; text-transform: uppercase; }
                .sizeBadge b { display: block; font-size: 26pt; line-height: .9; font-weight: 900; }
                .sizeBadge strong { display: block; margin-top: 1mm; font-size: 10pt; line-height: 1; font-weight: 900; }
                .quantity { font-size: 18pt; font-weight: 900; text-align: center; }
            </style>
        </head>
        <body>${fisSiparisleri.map(siparis => {
            const urunler = (siparis.products || []).filter(urun => !hizmetUrunuMu(urun));
            const teslimat = teslimatAdresi(siparis);
            const telefon = alanOku(siparis, [
                "customer.phone",
                "customer.mobilePhone",
                "customer.delivery.phone",
                "delivery.phone",
                "shippingAddress.phone",
                "phone"
            ], "");
            const adresBasligi = [
                [teslimat.district, teslimat.city].filter(Boolean).join(" / "),
                telefon ? `Tel: ${telefon}` : ""
            ].filter(Boolean).join(" · ");
            return `<section class="slipPage">
            <header>
                <div>
                    <div class="brand">ZOOM DEPO</div>
                    <h1>Sipariş Toplama Fişi</h1>
                    <span>${temizle(new Date().toLocaleString("tr-TR"))}</span>
                </div>
                <div class="orderCode">
                    ${fisBarkodlari.get(siparis) || temizle(siparisKodu(siparis))}
                    ${fisBarkodlari.get(siparis) ? `<small>Sipariş: ${temizle(siparisKodu(siparis))}</small>` : ""}
                </div>
            </header>
            <section class="meta">
                <div><span>Müşteri</span><strong>${temizle(musteriAdi(siparis))}</strong></div>
                <div><span>Platform</span><strong>${temizle(platformAdi(siparis))}</strong></div>
                <div><span>Ödeme</span><strong>${temizle(odemeYontemi(siparis))}</strong></div>
                <div><span>Toplam</span><strong>${temizle(toplamTutar(siparis))}</strong></div>
            </section>
            <section class="address">
                <strong>Teslimat Adresi · ${temizle(adresBasligi || "-")}</strong>
                ${temizle(teslimat.address || "Adres bilgisi yok")}
            </section>
            <div class="summary">
                <span>Ürünler · Raf sırasına göre</span>
                <span>${temizle(urunler.length)} çeşit · ${temizle(urunler.reduce((toplam, urun) => toplam + urunAdedi(urun), 0))} adet</span>
            </div>
            <main>
                ${urunler.map(urun => {
                    const productId = urunProductId(urun);
                    const gorsel = productId
                        ? `/product-image/${encodeURIComponent(productId)}`
                        : urunGorseli(urun);
                    return `
                        <article class="product">
                            <div class="photo">${gorsel
                                ? `<img src="${temizle(gorsel)}" alt="${temizle(urunAdi(urun))}">`
                                : "Görsel yok"}</div>
                            <div class="shelf">${temizle(urunRafKodu(urun))}</div>
                            <div>
                                <h2>${temizle(urunAdi(urun))}</h2>
                                <div class="details">
                                    <span>Ürün Kodu: <b>${temizle(urunKodu(urun) || "-")}</b></span>
                                    <span class="sizeBadge"><em>Beden</em><b>${temizle(urunBedeni(urun))}</b><strong>${temizle(urunFiyati(urun))}</strong></span>
                                    <span>Renk: <b>${temizle(urunRengi(urun))}</b></span>
                                </div>
                            </div>
                            <div class="quantity">${temizle(urunAdedi(urun))}×</div>
                        </article>
                    `;
                }).join("")}
            </main>
            </section>`;
        }).join("")}</body>
        </html>
    `;
    document.body.appendChild(frame);
}

async function kargoBarkodEtiketleriniYazdir(siparisVeyaListe) {
    const orders = (Array.isArray(siparisVeyaListe) ? siparisVeyaListe : [siparisVeyaListe]).filter(Boolean);
    if (!orders.length) return;
    const printable = orders.filter(order => kargoEtiketiBarkodu(order));
    if (!printable.length) {
        mesajGoster("warning", "Kargo barkodu yok", "Seçilen siparişlerin kargo şirketi barkodu henüz oluşmamış.");
        return;
    }

    if (typeof JsBarcode !== "function") {
        mesajGoster("error", "Barkod oluÅŸturulamadÄ±", "Barkod kÃ¼tÃ¼phanesi yÃ¼klenemedi.");
        return;
    }

    const previouslyPrinted = printable.filter(order => etiketBaskiKaydi(order));
    if (previouslyPrinted.length && !confirm(
        `${previouslyPrinted.length} kargo barkodu daha önce yazdırılmış.\n`
        + `Toplam ${printable.length} barkod tekrar yazdırılsın mı?`
    )) return;

    try {
        await etiketBaskisiniKaydet(printable);
        kargoBarkoduButonlariniGuncelle(printable);
    } catch (err) {
        mesajGoster("error", "Baskı kaydı oluşturulamadı", err.message);
        return;
    }

    if (typeof JsBarcode !== "function") {
        mesajGoster("error", "Barkod oluşturulamadı", "Barkod kütüphanesi yüklenemedi.");
        return;
    }

    const etiketler = printable.map(order => {
        const code = kargoEtiketiBarkodu(order);
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        JsBarcode(svg, code, {
            format: "CODE128",
            width: 1.85,
            height: 36,
            displayValue: true,
            fontSize: 12,
            margin: 0
        });
        const urunler = (order.products || [])
            .filter(urun => !hizmetUrunuMu(urun))
            .slice(0, 3)
            .map(urun => {
                const productId = urunProductId(urun);
                return {
                    name: urunAdi(urun),
                    size: urunBedeni(urun),
                    color: urunRengi(urun),
                    quantity: urunAdedi(urun),
                    shelf: urunRafKodu(urun),
                    image: productId ? `/product-image/${encodeURIComponent(productId)}` : urunGorseli(urun)
                };
            });
        const toplamAdet = (order.products || [])
            .filter(urun => !hizmetUrunuMu(urun))
            .reduce((toplam, urun) => toplam + urunAdedi(urun), 0);
        return { order, code, barcode: svg.outerHTML, urunler, toplamAdet };
    });

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.left = "-10000px";
    frame.style.top = "0";
    frame.style.width = "100mm";
    frame.style.height = "100mm";
    frame.style.border = "0";

    const temizleFrame = () => frame.remove();
    frame.addEventListener("load", () => {
        const printWindow = frame.contentWindow;
        if (!printWindow) {
            temizleFrame();
            mesajGoster("error", "Kargo barkodu açılamadı", "Tarayıcının yazdırma iznini kontrol edin.");
            return;
        }

        printWindow.addEventListener("afterprint", temizleFrame, { once: true });
        printWindow.requestAnimationFrame(() => {
            printWindow.requestAnimationFrame(() => {
                window.setTimeout(() => {
                    try {
                        printWindow.focus();
                        printWindow.print();
                    } catch {
                        temizleFrame();
                        mesajGoster("error", "Kargo barkodu yazdırılamadı", "Tarayıcının yazdırma iznini kontrol edin.");
                    }
                }, 150);
            });
        });
    }, { once: true });

    frame.srcdoc = `
        <!doctype html>
        <html lang="tr">
        <head>
            <meta charset="utf-8">
            <title>100x100 Kargo Barkodu</title>
            <style>
                @page { size: 100mm 100mm; margin: 0; }
                * { box-sizing: border-box; }
                html, body {
                    width: 100mm !important;
                    min-width: 100mm !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    background: #fff !important;
                    color: #101828;
                    font-family: Arial, sans-serif;
                    break-after: auto !important;
                    page-break-after: auto !important;
                }
                .cargoBarcodeOnlyLabel {
                    display: grid;
                    grid-template-rows: 17mm 11mm 35mm 1fr 7mm;
                    align-items: stretch;
                    width: 100mm;
                    min-width: 100mm;
                    max-width: 100mm;
                    height: 100mm;
                    min-height: 100mm;
                    max-height: 100mm;
                    padding: 5mm;
                    overflow: hidden;
                    page-break-after: always;
                    break-after: page;
                    border: 0;
                }
                .cargoBarcodeOnlyLabel:last-child {
                    page-break-after: auto;
                    break-after: auto;
                }
                .customerName {
                    display: flex;
                    align-items: flex-start;
                    justify-content: center;
                    font-size: 20pt;
                    font-weight: 900;
                    line-height: .98;
                    text-align: center;
                    overflow-wrap: anywhere;
                    text-transform: uppercase;
                }
                .orderCodeText {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-top: 1mm;
                    font-size: 12pt;
                    font-weight: 900;
                    text-align: center;
                }
                .pickProducts {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 2mm;
                    min-height: 32mm;
                    margin: 1mm 0;
                    overflow: hidden;
                }
                .pickProduct {
                    display: grid;
                    grid-template-rows: 18mm 1fr;
                    min-width: 0;
                    border: 1px solid #101828;
                    border-radius: 1.5mm;
                    overflow: hidden;
                }
                .pickPhoto {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #fff;
                    border-bottom: 1px solid #101828;
                    color: #667085;
                    font-size: 6pt;
                    font-weight: 800;
                    text-align: center;
                }
                .pickPhoto img {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                }
                .pickInfo {
                    display: grid;
                    gap: .4mm;
                    padding: 1mm;
                    font-size: 6.6pt;
                    font-weight: 800;
                    line-height: 1.05;
                    overflow: hidden;
                }
                .pickInfo strong {
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                    font-size: 6.4pt;
                }
                .pickMeta {
                    display: flex;
                    justify-content: space-between;
                    gap: 1mm;
                    font-size: 7.4pt;
                    font-weight: 900;
                }
                .barcodeBox {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    min-height: 24mm;
                }
                .barcodeBox svg {
                    width: 88mm !important;
                    height: 25mm !important;
                    max-width: 88mm !important;
                }
                .platformLine {
                    display: flex;
                    justify-content: space-between;
                    gap: 3mm;
                    font-size: 8.5pt;
                    font-weight: 800;
                    border-top: 1px solid #101828;
                    padding-top: 1.5mm;
                }
            </style>
        </head>
        <body>
            ${etiketler.map(({ order, barcode, urunler, toplamAdet }) => `
                <section class="cargoBarcodeOnlyLabel">
                    <div class="customerName">${temizle(musteriAdi(order))}</div>
                    <div class="orderCodeText">Sipariş No: ${temizle(siparisKodu(order))}</div>
                    <div class="pickProducts">
                        ${urunler.map(urun => `
                            <article class="pickProduct">
                                <div class="pickPhoto">${urun.image
                                    ? `<img src="${temizle(urun.image)}" alt="${temizle(urun.name)}">`
                                    : "Görsel yok"}</div>
                                <div class="pickInfo">
                                    <strong>${temizle(urun.name)}</strong>
                                    <div class="pickMeta"><span>${temizle(urun.size)}</span><span>${temizle(urun.quantity)}×</span></div>
                                    <div class="pickMeta"><span>${temizle(urun.color)}</span><span>${temizle(urun.shelf)}</span></div>
                                </div>
                            </article>
                        `).join("")}
                    </div>
                    <div class="barcodeBox">${barcode}</div>
                    <div class="platformLine">
                        <span>${temizle(kargoFirmaEtiketi(order))}</span>
                        <span>${temizle(urunler.length)} çeşit · ${temizle(toplamAdet)} adet</span>
                    </div>
                </section>
            `).join("")}
        </body>
        </html>
    `;
    document.body.appendChild(frame);
}

function kargoCikisEtiketiGoster(siparis) {
    const shipmentCode = kargoEtiketiBarkodu(siparis);
    if (!shipmentCode) {
        alert("Kargo şirketinin kullanacağı gerçek kargo barkodu henüz Quka tarafından oluşturulmadı.");
        return;
    }
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
                ${kargoEtiketiSiparisOzeti(siparis)}
                <div class="cargoBarcodeArea">
                    <svg id="cargoBarcodeSvg" aria-label="${temizle(shipmentCode)}"></svg>
                    <span>${qukaFisBarkoduKullaniliyor(siparis) ? "Quka FİŞ kargo barkodu" : "Kargo barkodu"} · Sipariş: ${temizle(siparisKodu(siparis))}</span>
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
        manuelKargoEtiketleriniYazdir([
            modal.querySelector(".cargoShippingLabel")
        ]);
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
                            ${kargoEtiketiSiparisOzeti(order)}
                            <div class="cargoBarcodeArea">
                                <svg id="bulkCargoBarcode${index}" aria-label="${temizle(kargoEtiketiBarkodu(order))}"></svg>
                                <span>${qukaFisBarkoduKullaniliyor(order) ? "Quka FİŞ kargo barkodu" : "Kargo barkodu"} · Sipariş: ${temizle(siparisKodu(order))}</span>
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
        manuelKargoEtiketleriniYazdir(
            [...modal.querySelectorAll(".cargoShippingLabel")]
        );
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

async function etiketKuyruklariniGetir() {
    const response = await fetch("/print-queues", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Etiket kuyrukları alınamadı.");
    etiketKuyrukVerisi = data;
    return data;
}

function personelEtiketKuyruklariniGoster() {
    const container = document.getElementById("staffPrintQueues");
    if (!container) return;
    const jobs = etiketKuyrukVerisi.result || [];
    const groups = new Map();
    jobs.forEach(job => {
        const key = String(job.preparedByUserId || "unassigned");
        if (!groups.has(key)) groups.set(key, {
            userId: job.preparedByUserId,
            name: job.preparedByName || "Atanmamış",
            jobs: []
        });
        groups.get(key).jobs.push(job);
    });
    if (!groups.size && aktifKullanici) {
        groups.set(String(aktifKullanici.id), {
            userId: aktifKullanici.id,
            name: aktifKullanici.displayName,
            jobs: []
        });
    }
    const groupList = [...groups.values()];
    if (!aktifEtiketKuyrukPersoneli || !groups.has(String(aktifEtiketKuyrukPersoneli))) {
        aktifEtiketKuyrukPersoneli = String(
            aktifKullanici?.role === "admin"
                ? (groupList.find(group => group.jobs.some(job => job.status !== "printed"))?.userId || groupList[0]?.userId || "")
                : aktifKullanici?.id || ""
        );
    }
    const selected = groups.get(String(aktifEtiketKuyrukPersoneli)) || groupList[0];
    const waiting = (selected?.jobs || []).filter(job => job.status !== "printed");
    const held = waiting.filter(job => !job.releasedAt);
    const history = (selected?.jobs || []).filter(job => job.status === "printed").slice(-20).reverse();
    const statusText = job => job.status === "failed"
        ? "Yazdırma hatası"
        : job.releasedAt ? (job.status === "processing" ? "Yazdırılıyor" : "Zebra'ya gönderildi") : "Bekliyor";

    container.innerHTML = `
        <section class="staffPrintQueue">
            <div class="staffQueueHeader">
                <div>
                    <p class="eyebrow">Personel Etiket Kuyruğu</p>
                    <h3>${temizle(selected?.name || aktifKullanici?.displayName || "Etiketler")} Etiketleri</h3>
                    <span>${etiketKuyrukVerisi.agent?.online
                        ? `${temizle(etiketKuyrukVerisi.agent.name || "Zebra bilgisayarı")} bağlı`
                        : "Zebra yazdırma ajanı çevrimdışı"}</span>
                </div>
                ${aktifKullanici?.role === "admin" && groupList.length ? `
                    <label>
                        <span>Personel</span>
                        <select id="printQueueUserFilter">
                            ${groupList.map(group => `<option value="${temizle(group.userId)}" ${String(group.userId) === String(selected?.userId) ? "selected" : ""}>
                                ${temizle(group.name)} · ${temizle(group.jobs.filter(job => job.status !== "printed").length)}
                            </option>`).join("")}
                        </select>
                    </label>
                ` : ""}
            </div>
            <div class="staffQueueActions">
                <strong>${temizle(held.length)} etiket gönderilmeyi bekliyor</strong>
                <button type="button" data-release-print-queue="${temizle(selected?.userId || "")}" ${held.length ? "" : "disabled"}>
                    ${temizle(held.length)} Etiketi Zebra'ya Gönder
                </button>
            </div>
            <div class="staffQueueList">
                ${waiting.length ? waiting.map(job => `
                    <article class="staffQueueItem ${temizle(job.status)}">
                        <b>${temizle(job.packageCode || "Paket")}</b>
                        <div>
                            <strong>${temizle(job.payload.customerName || "Müşteri")}</strong>
                            <span>${temizle(job.orderCode)} · ${temizle(statusText(job))}</span>
                            ${job.errorMessage ? `<small>${temizle(job.errorMessage)}</small>` : ""}
                        </div>
                    </article>
                `).join("") : `<div class="emptyActivity">Bu personelin bekleyen etiketi yok.</div>`}
            </div>
            <details class="staffQueueHistory">
                <summary>Yazdırma Geçmişi · ${temizle(history.length)}</summary>
                ${history.length ? history.map(job => `
                    <div>
                        <span><b>${temizle(job.packageCode)}</b> · ${temizle(job.orderCode)} · ${temizle(tarihSaatGoster(job.printedAt))}</span>
                        <button type="button" data-reprint-personal-job="${temizle(job.id)}">Tekrar Yazdır</button>
                    </div>
                `).join("") : `<p>Henüz yazdırılmış etiket yok.</p>`}
            </details>
        </section>
    `;
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
    const kargoBarkoduHazir = Boolean(kargoGonderiKodu(siparis));
    const tasiyiciBilgisi = kayit?.carrierAcceptedAt
        ? "Sürat Kargo kabul etti"
        : (kayit?.carrierLastMovement || kayit?.carrierStatus || "Sürat Kargo kabulü bekleniyor");

    return `
        <article class="shipmentCard pending">
            <div>
                <span class="shipmentStatus">Kargoya Hazır</span>
                <h3>${temizle(musteriAdi(siparis))}</h3>
                <p>${temizle(code)} · ${temizle(platformAdi(siparis))}</p>
                <p>${kargoBarkoduHazir ? "Gerçek kargo barkodu hazır" : "Quka kargo barkodu bekleniyor"}</p>
                <p>${temizle(tasiyiciBilgisi)}</p>
            </div>
            <div class="shipmentActions">
                <button type="button" class="printShipmentButton" data-print-cargo-order="${temizle(code)}" ${kargoBarkoduHazir ? "" : "disabled"}>
                    100×100 Kargo Etiketi
                </button>
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
    const bekleyenTum = siparisler.filter(item => {
        const kayit = kayitMap.get(siparisKodu(item).toUpperCase());
        return kayit?.status === "ready";
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
    aktifSevkiyatPlatformu = "zoombutik";
    sekmeDurumuGuncelle();

    result.innerHTML = `
        <section class="shipmentTool">
            <div class="locationHeader">
                <div>
                    <p class="eyebrow">Kargoya Hazır</p>
                    <h2>100×100 kargo etiketleri</h2>
                </div>
            </div>
            <div class="scanMessage info" id="scanMessage">
                <strong>Depoda ikinci bir sevkiyat okutması yapılmaz.</strong>
                <span>Kargo firması 100×100 etiketi okuttuğunda Quka durumu güncellenir ve sipariş bu listeden otomatik çıkar.</span>
            </div>
            <div id="staffPrintQueues"><div class="loading">Personel etiket kuyruğu yükleniyor...</div></div>
            <div id="shipmentPlatformTabs">
                ${platformSekmeleriHtml("shipments", aktifSevkiyatPlatformu, [], platformAdi)}
            </div>
            <label class="shipmentSearch">
                <span>Sevkiyatta Ara</span>
                <input id="shipmentSearch" type="search" placeholder="Müşteri adı, sipariş no veya platform..." autocomplete="off">
                <small id="shipmentSearchSummary">Müşteri adı, sipariş no veya platform ile arayın.</small>
            </label>
            <div class="shipmentPanels">
                <section id="pendingShipmentPanel" role="tabpanel">
                    <div class="sectionTitle">
                        <h3>Etiket Bekleyen Hazır Paketler</h3>
                        <span><b id="pendingShipmentCount">0</b> sipariş</span>
                    </div>
                    <div class="shipmentList" id="pendingShipments"></div>
                </section>
                <div id="shippedShipmentPanel" hidden><div id="shippedShipments"></div><span id="shippedShipmentCount">0</span></div>
            </div>
        </section>
    `;

    try {
        await Promise.all([sevkiyatKayitlariniGetir(), etiketKuyruklariniGetir()]);
        personelEtiketKuyruklariniGoster();
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
    "products.sync": "Ürün kataloğu güncelleme",
    "product.barcode_update": "Beden barkodu değiştirme"
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
                                    ? `<button type="button" data-retry-print-job="${temizle(job.id)}" data-print-job-status="${temizle(job.status)}">${job.status === "printed" ? "Tekrar Yazdır" : "Yeniden Dene"}</button>`
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
    kargoBarkoduButonlariniGuncelle([siparis]);
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
        if (hizmet) return "";
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

function manuelHazirlamaPaneliGoster() {
    document.getElementById("manualPreparationDialog")?.remove();
    const urunler = aktifSiparis?.products || [];
    const satirlar = urunler.map((urun, index) => {
        if (hizmetUrunuMu(urun)) return "";
        const gereken = urunAdedi(urun);
        const okutulan = okutulanAdet(index);
        const kalan = Math.max(0, gereken - okutulan);
        const sorun = urununAcikSorunu(index);
        return `
            <div class="manualPreparationRow${kalan === 0 ? " completed" : ""}">
                <div>
                    <strong>${temizle(urunAdi(urun))}</strong>
                    <span>${temizle(urunRengi(urun))} · ${temizle(urunBedeni(urun))} · ${temizle(urunBarkodu(urun))}</span>
                </div>
                <b>${temizle(okutulan)} / ${temizle(gereken)}</b>
                <button type="button" data-manual-verify="${index}" ${kalan === 0 || sorun ? "disabled" : ""}>
                    ${sorun ? "Sorun Kaydı Açık" : kalan === 0 ? "Tamamlandı" : "+1 Doğrula"}
                </button>
            </div>
        `;
    }).join("");

    result.insertAdjacentHTML("beforeend", `
        <div class="issueDialog manualPreparationDialog" id="manualPreparationDialog" role="dialog" aria-modal="true" aria-labelledby="manualPreparationTitle">
            <div class="issueDialogCard manualPreparationCard">
                <div class="issueDialogHeader">
                    <div>
                        <p class="eyebrow">Kamerasız Hazırlama</p>
                        <h3 id="manualPreparationTitle">Ürünleri fiziksel olarak doğrula</h3>
                        <span>Renk, beden ve ürünü kontrol ettikten sonra her adet için bir kez doğrulayın.</span>
                    </div>
                    <button type="button" class="issueCloseButton" data-close-manual aria-label="Kapat">×</button>
                </div>
                <div class="manualPreparationWarning">Manuel doğrulamalar personel adıyla işlem geçmişine kaydedilir.</div>
                <div class="manualPreparationList">${satirlar}</div>
            </div>
        </div>
    `);
}

async function urunuManuelDogrula(index) {
    const urun = aktifSiparis?.products?.[index];
    if (!urun || hizmetUrunuMu(urun) || urunTamamlandiMi(urun, index) || urununAcikSorunu(index)) return;

    taramaDurumu[index] = okutulanAdet(index) + 1;
    aktifTaramaKaniti.push({
        barcode: urunBarkodu(urun),
        productName: urunAdi(urun),
        quantityIndex: taramaDurumu[index],
        source: "manual",
        scannedAt: new Date().toISOString()
    });
    await hazirlamaKilitleriniYenile().catch(() => {});
    urunListesiGuncelle();
    mesajGoster("success", "Manuel doğrulama kaydedildi", `${urunAdi(urun)} · ${taramaDurumu[index]} / ${urunAdedi(urun)}`);

    if (tumGercekUrunlerTamamlandiMi()) {
        if (aktifSiparisSorunlari.some(item => item.status === "open")) {
            document.getElementById("manualPreparationDialog")?.remove();
            mesajGoster("warning", "Sipariş beklemeye alındı", "Açık ürün sorunu çözülmeden sipariş tamamlanamaz.");
            return;
        }
        document.getElementById("manualPreparationDialog")?.remove();
        scannerDurdur();
        await siparisiTamamla();
        return;
    }

    manuelHazirlamaPaneliGoster();
}

function siparisDetayGoster(siparis) {
    scannerDurdur();
    aktifSiparis = siparis;
    taramaDurumuHazirla(siparis);
    sonOkunanBarkod = "";
    sonOkumaZamani = 0;
    aktifTaramaKaniti = [];
    sonPaketKodu = "";
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
                <div>
                    <span class="statusPill">${temizle(siparisDurumu(siparis))}</span>
                    <button class="cargoLabelButton" type="button" data-print-order-slip="${temizle(siparisKodu(siparis))}">${temizle(siparisFisiButonMetni(siparis))}</button>
                    <button class="cargoLabelButton" type="button" data-print-cargo-barcode="${temizle(siparisKodu(siparis))}">100×100 Kargo Barkodu</button>
                </div>
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
                <div>
                    <span>Ödeme Yöntemi</span>
                    <strong>${temizle(odemeYontemi(siparis))}</strong>
                </div>
            </div>

            <div class="scannerControls">
                <div>
                    <h3>Barkod Doğrulama</h3>
                    <p id="scanProgress">0 / ${temizle(toplamGerekliAdet)} adet doğrulandı</p>
                </div>
                <div class="scannerActionButtons">
                    <button class="manualPrepareButton" type="button" id="manualPrepare">Kamerasız Hazırla</button>
                    <button class="scanButton" type="button" id="startScanner">📷 Barkodu Okut</button>
                </div>
            </div>

            <div class="scannerPanel" id="scannerPanel" hidden>
                <video id="scannerVideo" muted playsinline></video>
                <div class="scanFrame"></div>
            </div>

            <div class="scanMessage info" id="scanMessage">
                <strong>Barkod okutmaya başlamak için kamerayı açın.</strong>
                <span>Hizmet bedeli ve kargo ücreti ürün/adet hesabına dahil edilmez.</span>
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
                <span>${temizle(urunler.filter(urun => !hizmetUrunuMu(urun)).length)} ürün · raf sırasına göre</span>
            </div>

            <div class="productList" id="productList">
                ${urunListesiHtml(urunler)}
            </div>
        </section>
    `;
    kargoBarkoduButonlariniGuncelle(batchCount ? aktifTopluSiparisler : [aktifSiparis]);
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
            ${!batchCount && sonPaketKodu ? `<p class="packageSequenceNotice">Paket sıra numarası: <strong>${temizle(sonPaketKodu)}</strong></p>` : ""}
            <div class="completeLabelActions">
                ${(batchCount ? aktifTopluSiparisler : [aktifSiparis]).map(order => `
                    <button class="cargoLabelButton" type="button" data-print-cargo-order="${temizle(siparisKodu(order))}">
                        ${batchCount ? `${temizle(siparisKodu(order))} · ` : ""}100×100 Kargo Etiketi
                    </button>
                    <button class="cargoLabelButton" type="button" data-print-order-slip="${temizle(siparisKodu(order))}">
                        ${batchCount ? `${temizle(siparisKodu(order))} · ` : ""}${temizle(siparisFisiButonMetni(order, true))}
                    </button>
                `).join("")}
            </div>
            <button class="openOrderButton" type="button" id="backToList">Yeni Sipariş Ara</button>
        </section>
    `;
}

function siparisOzeti(siparis) {
    const products = (siparis.products || []).filter(urun => !hizmetUrunuMu(urun)).map(urun => ({
        barcode: urunBarkodu(urun),
        name: urunAdi(urun),
        code: urunKodu(urun),
        quantity: urunAdedi(urun),
        color: urunRengi(urun),
        size: urunBedeni(urun),
        location: urunRafKodu(urun) === "-" ? "" : urunRafKodu(urun)
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
        shipmentCode: kargoEtiketiBarkodu(siparis),
        paymentMethod: odemeYontemi(siparis),
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
        const completion = await hazirlamaKaydiGonder("complete", aktifSiparis, {
            proofImage,
            scans: aktifTaramaKaniti,
            orderSnapshot: siparisOzeti(currentOrder)
        });
        sonPaketKodu = completion?.result?.printJob?.packageCode || "";
        await etiketKuyruklariniGetir().catch(() => {});
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
            await etiketKuyruklariniGetir().catch(() => {});
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
    const kuyrukButonu = event.target.closest("[data-order-queue]");
    if (kuyrukButonu) {
        aktifSiparisKuyrugu = kuyrukButonu.dataset.orderQueue;
        aktifSiparisSayfasi = 1;
        secilenSiparisKodlari.clear();
        listeGoster(aktifListe);
        return;
    }

    const hazirlananlaraAlButonu = event.target.closest("[data-move-to-preparing]");
    if (hazirlananlaraAlButonu) {
        const order = siparisler.find(item => siparisKodu(item) === hazirlananlaraAlButonu.dataset.moveToPreparing);
        if (!order) return;
        hazirlananlaraAlButonu.disabled = true;
        try {
            await siparisAsamasiniGuncelle([order], "preparing");
            mesajGoster("success", "Sipariş hazırlananlara alındı", siparisKodu(order));
        } catch (err) {
            hazirlananlaraAlButonu.disabled = false;
            mesajGoster("error", "Sipariş taşınamadı", err.message);
        }
        return;
    }

    if (event.target.closest("[data-move-selected-to-preparing]")) {
        const orders = siparisler.filter(order => secilenSiparisKodlari.has(siparisKodu(order)));
        if (!orders.length) return;
        try {
            await siparisAsamasiniGuncelle(orders, "preparing");
            mesajGoster("success", "Siparişler hazırlananlara alındı", `${orders.length} sipariş taşındı.`);
        } catch (err) {
            mesajGoster("error", "Siparişler taşınamadı", err.message);
        }
        return;
    }

    const manuelKargolaButonu = event.target.closest("[data-manual-ready-order]");
    if (manuelKargolaButonu) {
        const order = siparisler.find(item => siparisKodu(item) === manuelKargolaButonu.dataset.manualReadyOrder);
        if (!order || !confirm(`${siparisKodu(order)} siparişi Kargolanan Siparisler listesine alınsın mı?`)) return;
        manuelKargolaButonu.disabled = true;
        try {
            await siparisleriKargolananlaraAl([order]);
            mesajGoster("success", "Sipariş Kargolanan Siparislere alındı", siparisKodu(order));
        } catch (err) {
            manuelKargolaButonu.disabled = false;
            mesajGoster("error", "Kargolanan siparislere alma tamamlanamadı", err.message);
        }
        return;
    }

    if (event.target.closest("[data-manual-ready-selected]")) {
        const orders = siparisler.filter(order => secilenSiparisKodlari.has(siparisKodu(order)));
        if (!orders.length || !confirm(`${orders.length} sipariş Kargolanan Siparisler listesine alınsın mı?`)) return;
        try {
            const count = await siparisleriKargolananlaraAl(orders);
            mesajGoster("success", "Siparişler Kargolanan Siparislere alındı", `${count} sipariş tamamlandı.`);
        } catch (err) {
            mesajGoster("error", "Toplu kargolanan siparislere alma durdu", err.message);
        }
        return;
    }

    const siparisFisiButonu = event.target.closest("[data-print-order-slip]");
    if (siparisFisiButonu) {
        const kod = String(siparisFisiButonu.dataset.printOrderSlip || "").toUpperCase();
        const siparis = [aktifSiparis, ...aktifTopluSiparisler, ...siparisler]
            .find(item => item && siparisKodu(item).toUpperCase() === kod);
        if (!siparis) {
            mesajGoster("error", "Sipariş fişi hazırlanamadı", "Sipariş bilgisi bulunamadı.");
            return;
        }
        const oncekiBaski = siparisFisiBaskiKaydi(siparis);
        if (oncekiBaski && !confirm(
            `Bu siparişin A4 fişi daha önce ${oncekiBaski.printCount} kez yazdırıldı.\n`
            + `Son baskı: ${oncekiBaski.lastPrintedBy} · ${tarihSaatGoster(oncekiBaski.lastPrintedAt)}\n\nTekrar yazdırılsın mı?`
        )) return;
        siparisFisiButonu.disabled = true;
        try {
            await siparisFisiYazdir(siparis);
            siparisFisiButonu.textContent = "✓ Yazdırıldı · Tekrar Yazdır";
        } catch (err) {
            mesajGoster("error", "Sipariş fişi hazırlanamadı", err.message);
        } finally {
            siparisFisiButonu.disabled = false;
        }
        return;
    }

    const releaseQueueButton = event.target.closest("[data-release-print-queue]");
    if (releaseQueueButton) {
        releaseQueueButton.disabled = true;
        try {
            const response = await fetch("/print-queues/release", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: Number(releaseQueueButton.dataset.releasePrintQueue) })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Etiketler Zebra'ya gönderilemedi.");
            await etiketKuyruklariniGetir();
            personelEtiketKuyruklariniGoster();
            mesajGoster("success", "Etiketler Zebra'ya gönderildi", `${data.result.count} etiket sırayla yazdırılacak.`);
        } catch (err) {
            releaseQueueButton.disabled = false;
            mesajGoster("error", "Etiket kuyruğu gönderilemedi", err.message);
        }
        return;
    }

    const reprintButton = event.target.closest("[data-reprint-personal-job]");
    if (reprintButton) {
        if (!confirm("Bu etiket daha önce yazdırıldı. Aynı etiketi tekrar yazdırmak istediğinize emin misiniz?")) return;
        reprintButton.disabled = true;
        try {
            const response = await fetch(`/print-queues/${encodeURIComponent(reprintButton.dataset.reprintPersonalJob)}/reprint`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmReprint: true })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Etiket tekrar yazdırılamadı.");
            await etiketKuyruklariniGetir();
            personelEtiketKuyruklariniGoster();
            mesajGoster("warning", "Tekrar baskı kuyruğa alındı", "Etiket Zebra'dan yeniden çıkacak.");
        } catch (err) {
            reprintButton.disabled = false;
            mesajGoster("error", "Tekrar baskı başlatılamadı", err.message);
        }
        return;
    }

    const syncProductCatalogButton = event.target.closest("#syncProductCatalog");
    if (syncProductCatalogButton) {
        syncProductCatalogButton.disabled = true;
        syncProductCatalogButton.textContent = "Güncelleniyor...";
        try {
            const response = await fetch("/admin/products/sync", { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Barkod kataloğu güncellenemedi.");

            apiUrunleri = null;
            apiUrunleriPromise = null;
            apiUrunDetayCache.clear();
            const arama = document.getElementById("locationSearch");
            if (arama?.value.trim()) {
                await rafAramaSonuclariGoster(rafKaydiAra(arama.value));
            }
            mesajGoster(
                "success",
                "Barkodlar güncellendi",
                `${data.result.productCount} ürün · ${data.result.variantCount} varyant`
            );
            syncProductCatalogButton.textContent = "Barkodlar Güncel";
        } catch (err) {
            syncProductCatalogButton.disabled = false;
            syncProductCatalogButton.textContent = "Barkodları Güncelle";
            mesajGoster("error", "Barkodlar güncellenemedi", err.message);
        }
        return;
    }

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

    if (event.target.closest("[data-print-selected-slips]")) {
        const orders = siparisler.filter(order => secilenSiparisKodlari.has(siparisKodu(order)));
        const dahaOnceYazdirilanlar = orders.filter(siparisFisiBaskiKaydi);
        if (dahaOnceYazdirilanlar.length && !confirm(
            `Seçilen siparişlerden ${dahaOnceYazdirilanlar.length} tanesinin A4 fişi daha önce yazdırıldı.\n\nTümü tekrar yazdırılsın mı?`
        )) return;
        await siparisFisiYazdir(orders);
        return;
    }

    if (event.target.closest("[data-print-selected-cargo-barcodes]")) {
        const orders = siparisler.filter(order => secilenSiparisKodlari.has(siparisKodu(order)));
        await kargoBarkodEtiketleriniYazdir(orders);
        return;
    }

    const cargoBarcodeButton = event.target.closest("[data-print-cargo-barcode]");
    if (cargoBarcodeButton) {
        const code = cargoBarcodeButton.dataset.printCargoBarcode;
        const order = aktifTopluSiparisler.find(item => siparisKodu(item) === code)
            || siparisler.find(item => siparisKodu(item) === code)
            || (aktifSiparis && siparisKodu(aktifSiparis) === code ? aktifSiparis : null);
        if (!order) {
            mesajGoster("error", "Sipariş bulunamadı", code);
            return;
        }
        await kargoBarkodEtiketleriniYazdir(order);
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
        const tekrarBaski = retryPrintJobButton.dataset.printJobStatus === "printed";
        if (tekrarBaski && !confirm("Bu etiket daha önce yazdırıldı. Tekrar yazdırmak istediğinize emin misiniz?")) return;
        retryPrintJobButton.disabled = true;
        try {
            const response = await fetch(`/admin/print-jobs/${encodeURIComponent(retryPrintJobButton.dataset.retryPrintJob)}/retry`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmReprint: tekrarBaski })
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

    if (event.target.closest("#manualPrepare")) {
        scannerDurdur();
        manuelHazirlamaPaneliGoster();
        return;
    }

    if (event.target.closest("[data-close-manual]")) {
        document.getElementById("manualPreparationDialog")?.remove();
        return;
    }

    const manuelDogrulaButonu = event.target.closest("[data-manual-verify]");
    if (manuelDogrulaButonu) {
        manuelDogrulaButonu.disabled = true;
        await urunuManuelDogrula(Number(manuelDogrulaButonu.dataset.manualVerify));
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
            rafSonucListesindeGuncelle({ ...kayit, location: "", hasLocation: false });
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
    const barcodeOverrideForm = event.target.closest("[data-barcode-override]");
    if (barcodeOverrideForm) {
        event.preventDefault();
        const originalBarcode = barcodeOverrideForm.dataset.barcodeOverride;
        const newBarcode = barcodeOverrideForm.elements.barcode.value.trim();
        const button = barcodeOverrideForm.querySelector("button");
        if (!newBarcode) return;

        button.disabled = true;
        button.textContent = "Güncelleniyor...";
        try {
            const response = await fetch(`/admin/product-barcodes/${encodeURIComponent(originalBarcode)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ barcode: newBarcode })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Barkod değiştirilemedi.");

            rafKayitlariPromise = null;
            await rafKayitlariniGetir(true);
            apiUrunleri = null;
            apiUrunleriPromise = null;
            const arama = document.getElementById("locationSearch");
            if (arama?.value.trim()) {
                arama.value = newBarcode;
                await rafAramaSonuclariGoster(rafKaydiAra(newBarcode));
            }
            mesajGoster("success", "Beden barkodu değiştirildi", `${originalBarcode} → ${newBarcode}`);
        } catch (err) {
            button.disabled = false;
            button.textContent = "Barkodu Değiştir";
            mesajGoster("error", "Barkod değiştirilemedi", err.message);
        }
        return;
    }

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
        rafSonucListesindeGuncelle(kaydedilen);
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
    if (event.target.id === "printQueueUserFilter") {
        aktifEtiketKuyrukPersoneli = event.target.value;
        personelEtiketKuyruklariniGoster();
        return;
    }

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

    if (event.target.id === "orderShelfGroup") {
        aktifSiparisRafGrubu = event.target.value;
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
            aktifSiparisPlatformu = "zoombutik";
            searchInput.value = "";
            listeGoster(siparisler);
            return;
        }

        if (this.dataset.tab === "operations") {
            operasyonPanosuGoster();
        } else if (this.dataset.tab === "users") {
            aktifGecmisPlatformu = "zoombutik";
            yonetimEkraniGoster();
        } else if (this.dataset.tab === "history") {
            aktifGecmisPlatformu = "zoombutik";
            hazirlamaGecmisiEkraniGoster();
        } else if (this.dataset.tab === "issues") {
            aktifEksikPlatformu = "zoombutik";
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
