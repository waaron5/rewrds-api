const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM cards");
        res.json(rows);
    } catch (err) {
        console.error("Error fetching cards:", err);
        res.status(500).json({ error: "Failed to fetch cards." });
    }
});

module.exports = router;
