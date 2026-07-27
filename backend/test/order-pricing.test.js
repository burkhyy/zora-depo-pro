const test = require("node:test");
const assert = require("node:assert/strict");
const pricing = require("../public/order-pricing.js");

test("Quka siparis fisinde KDV dahil musteri fiyati kullanilir", () => {
    const product = {
        quantity: 1,
        price: 881.81,
        totalPrice: 881.81,
        priceIncVat: 969.99,
        totalPriceIncVat: 969.99,
        cartPrice: 969.99
    };

    assert.equal(pricing.customerUnitPrice(product), 969.99);
});

test("sepette indirim varsa musteriye uygulanan sepet fiyati onceliklidir", () => {
    const product = {
        quantity: 1,
        priceIncVat: 999.99,
        totalPriceIncVat: 999.99,
        cartPrice: 899.99
    };

    assert.equal(pricing.customerUnitPrice(product), 899.99);
});

test("yalnizca KDV dahil satir toplami varsa adet basina fiyat hesaplanir", () => {
    const product = {
        quantity: 2,
        price: 800,
        totalPriceIncVat: 1760
    };

    assert.equal(pricing.customerUnitPrice(product), 880);
});
