// index.js simplified for unified schema
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.get("/", (req, res) => res.send("REWRDS API is live ✅"));

// Fetch all cards
app.get("/cards", async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM cards ORDER BY name ASC`);
        res.json(rows);
    } catch (err) {
        console.error("DB error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Fetch one card
app.get("/cards/:id", async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM cards WHERE id=$1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "Not found" });
        res.json(rows[0]);
    } catch (err) {
        console.error("DB error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(process.env.PORT || 3000, () =>
    console.log(`Server running on port ${process.env.PORT || 3000}`)
);
