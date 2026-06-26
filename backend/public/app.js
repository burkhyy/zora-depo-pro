let siparisler = [];

const durumlar = {
    1: "🆕 Yeni Sipariş",
    2: "📦 Hazırlanıyor",
    3: "🚚 Kargolandı",
    4: "✅ Teslim Edildi",
    5: "↩️ İade",
    6: "❌ İptal"
};

async function yukle() {
    try {

        const response = await fetch("/orders");
        const data = await response.json();

        siparisler = data.result.list;

        goster(siparisler);

    } catch (err) {

        document.getElementById("result").innerHTML = `
            <div class="notfound">
                Siparişler yüklenemedi.
            </div>
        `;

        console.error(err);

    }
}

function goster(liste) {

    const result = document.getElementById("result");

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

        result.innerHTML += `
            <div class="card">

                <h2>${item.customer.name}</h2>

                <p><b>Sipariş No:</b> ${item.order.code}</p>

                <p><b>Platform:</b> ${item.order.platform}</p>

                <p><b>Ürün:</b> ${item.products.length}</p>

                <p><b>Durum:</b> ${durumlar[item.order.status] || item.order.status}</p>

            </div>
        `;

    });

}

document.getElementById("search").addEventListener("keyup", function () {

    const ara = this.value.toLowerCase().trim();

    const filtre = siparisler.filter(item => {

        return (
            item.customer.name.toLowerCase().includes(ara) ||
            item.order.code.toLowerCase().includes(ara)
        );

    });

    goster(filtre);

});

yukle();