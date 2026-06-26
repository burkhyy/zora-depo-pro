require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();

// Public klasörünü yayınla
app.use(express.static(path.join(__dirname, "public")));

// Ana sayfa
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API bağlantı testi
app.get("/test", async (req, res) => {

    try {

        const response = await axios.get(
            process.env.API_URL + "/auth",
            {
                headers: {
                    apikey: process.env.API_KEY,
                    apisecret: process.env.API_SECRET
                }
            }
        );

        res.json(response.data);

    } catch (err) {

        if (err.response) {
            res.json(err.response.data);
        } else {
            res.json({ error: err.message });
        }

    }

});

// Son siparişları getir
app.get("/orders", async (req, res) => {

    try {

        const response = await axios.get(
            process.env.API_URL + "/order/listsV2?pageStart=0&pageSize=100&orderBy=id&sort=desc",
            {
                headers: {
                    apikey: process.env.API_KEY,
                    apisecret: process.env.API_SECRET
                }
            }
        );

        res.json(response.data);

    } catch (err) {

        if (err.response) {
            res.json(err.response.data);
        } else {
            res.json({ error: err.message });
        }

    }

});

// Tek siparişi getir
app.get("/order/:code", async (req, res) => {

    try {

        const response = await axios.get(
            process.env.API_URL + "/order/listsV2?pageStart=0&pageSize=100&orderBy=id&sort=desc",
            {
                headers: {
                    apikey: process.env.API_KEY,
                    apisecret: process.env.API_SECRET
                }
            }
        );

        const siparis = response.data.result.list.find(
            x => x.order.code == req.params.code
        );

        if (!siparis) {

            return res.status(404).json({
                error: "Sipariş bulunamadı."
            });

        }

        res.json(siparis);

    } catch (err) {

        if (err.response) {

            res.status(err.response.status).json(err.response.data);

        } else {

            res.status(500).json({
                error: err.message
            });

        }

    }

});

// Sunucu
app.listen(3000, () => {
    console.log("🚀 Sunucu 3000 portunda çalışıyor.");
});