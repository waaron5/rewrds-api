const express = require("express");
const router = express.Router();
const { scoreCards } = require("../scoring/scoringEngine");
const pool = require("../db"); // Your Neon client connection

router.post("/", async (req, res) => {
    try {
        const answers = req.body;

        // 1. Pull all cards from Postgres
        const { rows: cards } = await pool.query("SELECT * FROM cards");

        // 2. Score them
        const results = scoreCards(cards, answers);

        // 3. Return sorted score results
        return res.json(results);
    } catch (err) {
        console.error("SCORING ERROR:", err);
        return res.status(500).json({ error: "Scoring failed." });
    }
});

module.exports = router;
