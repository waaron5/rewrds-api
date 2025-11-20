// routes/score.js — Backend Scoring Route

const express = require("express");
const router = express.Router();
const { scoreCards } = require("../scoring/scoringEngine");

// POST /score
router.post("/", async (req, res) => {
    try {
        const answers = req.body;

        // Pull database connection from Express app (correct way)
        const pool = req.app.get("db");

        // Get all cards
        const { rows: cards } = await pool.query("SELECT * FROM cards");

        // Score cards
        const results = scoreCards(cards, answers);

        // Return sorted results
        return res.json(results);

    } catch (err) {
        console.error("SCORING ERROR:", err);
        return res.status(500).json({ error: "Scoring failed on the server." });
    }
});

module.exports = router;
