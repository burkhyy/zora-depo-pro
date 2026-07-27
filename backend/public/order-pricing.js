(function fiyatModulu(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.ZoomOrderPricing = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function fiyatKurallari() {
    function alanOku(source, paths) {
        for (const path of paths) {
            const value = String(path).split(".").reduce(
                (current, key) => current == null ? undefined : current[key],
                source
            );
            if (value !== undefined && value !== null && value !== "") return value;
        }
        return null;
    }

    function sayiyaCevir(value) {
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        const text = String(value ?? "").trim();
        if (!text || text === "-") return null;
        const cleaned = text.replace(/[^\d,.-]/g, "");
        const normalized = cleaned.includes(",")
            ? cleaned.replaceAll(".", "").replace(",", ".")
            : cleaned;
        const number = Number(normalized);
        return Number.isFinite(number) ? number : null;
    }

    function adet(product) {
        const value = alanOku(product, [
            "quantity",
            "qty",
            "amount",
            "count",
            "piece",
            "pieceCount"
        ]);
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : 1;
    }

    function musteriBirimFiyati(product) {
        const grossUnit = sayiyaCevir(alanOku(product, [
            "cartPrice",
            "unitPriceIncVat",
            "unit_price_inc_vat",
            "priceIncVat",
            "salePriceIncVat",
            "discountedPriceIncVat",
            "sellingPriceIncVat",
            "details.cartPrice",
            "details.unitPriceIncVat",
            "details.priceIncVat",
            "details.salePriceIncVat"
        ]));
        if (grossUnit !== null) return grossUnit;

        const grossTotal = sayiyaCevir(alanOku(product, [
            "totalPriceIncVat",
            "lineTotalIncVat",
            "totalIncVat",
            "details.totalPriceIncVat",
            "details.lineTotalIncVat",
            "details.totalIncVat"
        ]));
        if (grossTotal !== null) return grossTotal / adet(product);

        const fallbackUnit = sayiyaCevir(alanOku(product, [
            "unitPrice",
            "unit_price",
            "salePrice",
            "sellingPrice",
            "discountedPrice",
            "productPrice",
            "price",
            "details.unitPrice",
            "details.salePrice",
            "details.sellingPrice",
            "details.price"
        ]));
        if (fallbackUnit !== null) return fallbackUnit;

        const fallbackTotal = sayiyaCevir(alanOku(product, [
            "totalPrice",
            "lineTotal",
            "total",
            "productTotal",
            "details.totalPrice",
            "details.lineTotal",
            "details.total"
        ]));
        return fallbackTotal === null ? null : fallbackTotal / adet(product);
    }

    return {
        customerUnitPrice: musteriBirimFiyati,
        quantity: adet,
        toNumber: sayiyaCevir
    };
}));
