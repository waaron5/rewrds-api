// === index.js ===
// Basic Express server connected to Neon Postgres

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// Connect to your Neon database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // required for Neon
});

// Test route
app.get("/", (req, res) => {
    res.send("REWRDS API is live ✅");
});

// Route to get all cards
app.get("/cards", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM cards ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        console.error("Database error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Start server
app.listen(process.env.PORT, () =>
    console.log(`Server running on http://localhost:${process.env.PORT}`)
);
