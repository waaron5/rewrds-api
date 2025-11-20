// routes/card.js — Fetch all cards

const express = require("express");
const router = express.Router();

// GET /cards
router.get("/", async (req, res) => {
    try {
        const pool = req.app.get("db");

        const { rows } = await pool.query("SELECT * FROM cards ORDER BY id ASC");

        return res.json(rows);
    } catch (err) {
        console.error("CARD FETCH ERROR:", err);
        return res.status(500).json({ error: "Could not load cards." });
    }
});

module.exports = router;
