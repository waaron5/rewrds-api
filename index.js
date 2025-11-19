// index.js — Unified REWRDS API
// This version supports full card retrieval, bulk comparison, and Neon DB

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

const app = express();

// 🚀 CORS setup (works with local + Vercel deployment)
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// 🟦 Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 🔥 Health check for Render
app.get("/", (req, res) => {
    res.json({ status: "REWRDS API is live", online: true });
});


// ======================================================
// 1️⃣ GET ALL CARDS
// ======================================================
app.get("/cards", async (req, res) => {
    try {
        const query = `SELECT * FROM cards ORDER BY name ASC`;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error("❌ /cards error:", err);
        res.status(500).json({ error: err.message });
    }
});


// ======================================================
// 2️⃣ GET SINGLE CARD BY ID
// ======================================================
app.get("/cards/:id", async (req, res) => {
    try {
        const query = `SELECT * FROM cards WHERE id = $1`;
        const { rows } = await pool.query(query, [req.params.id]);

        if (!rows.length) {
            return res.status(404).json({ error: "Card not found" });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error(`❌ /cards/${req.params.id} error:`, err);
        res.status(500).json({ error: err.message });
    }
});


// ======================================================
// 3️⃣ BULK CARD FETCH (COMPARE FEATURE)
// ======================================================
app.get("/cards/bulk", async (req, res) => {
    try {
        const raw = req.query.ids;
        if (!raw) return res.json([]);

        const ids = raw.split(",").map(s => s.trim());

        const query = `SELECT * FROM cards WHERE id = ANY($1)`;
        const { rows } = await pool.query(query, [ids]);

        res.json(rows);
    } catch (err) {
        console.error("❌ /cards/bulk error:", err);
        res.status(500).json({ error: err.message });
    }
});


// ======================================================
// 4️⃣ START SERVER
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
    console.log(`🚀 REWRDS API running on port ${PORT}`)
);
