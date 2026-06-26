require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();

app.use(express.static(path.join(__dirname, "public")));

const API = axios.create({
    baseURL: process.env.API_URL,
    headers: {
        apikey: process.env.API_KEY,
        apisecret: process.env.API_SECRET
    }
});

// Ana sayfa
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API Test
app.get("/test", async (req, res) => {

    try {

        const response = await API.get("/auth");

        res.json(response.data);

    } catch (err) {

        if (err.response) {
            res.status(err.response.status).json(err.response.data);
        } else {
            res.status(500).json({ error: err.message });
        }

    }

});

// Son 200 siparişi getir
app.get("/orders", async (req, res) => {

    try {

        const response = await API.get(
            "/order/listsV2?pageStart=0&pageSize=200&orderBy=id&sort=desc"
        );

        res.json(response.data);

    } catch (err) {

        if (err.response) {
            res.status(err.response.status).json(err.response.data);
        } else {
            res.status(500).json({ error: err.message });
        }

    }

});

// Sipariş koduna göre getir
app.get("/order/:code", async (req, res) => {

    try {

        const response = await API.get(
            "/order/listsV2?pageStart=0&pageSize=200&orderBy=id&sort=desc"
        );

        const siparis = response.data.result.list.find(
            item => item.order.code === req.params.code
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
            res.status(500).json({ error: err.message });
        }

    }

});

app.listen(3000, () => {
    console.log("🚀 Zora Depo Pro çalışıyor : http://localhost:3000");
});