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
        const { rows: base } = await pool.query(`SELECT * FROM cards ORDER BY name ASC`);

        // hydrate children per card in parallel
        const hydrated = await Promise.all(
            base.map(async (card) => {
                const [rewards, bonus, credits, partners, goals, regions, synergy] = await Promise.all([
                    pool.query(`SELECT category, rate, details FROM rewards WHERE card_slug=$1 ORDER BY rate DESC`, [card.slug]),
                    pool.query(`SELECT description, value_estimate, spend_requirement, timeframe_months FROM sign_up_bonuses WHERE card_slug=$1`, [card.slug]),
                    pool.query(`SELECT type, value, details, category FROM credits_and_benefits WHERE card_slug=$1`, [card.slug]),
                    pool.query(`SELECT partner_name FROM transfer_partners WHERE card_slug=$1 ORDER BY partner_name`, [card.slug]),
                    pool.query(`SELECT goal FROM recommended_goals WHERE card_slug=$1`, [card.slug]),
                    pool.query(`SELECT region FROM available_regions WHERE card_slug=$1`, [card.slug]),
                    pool.query(`SELECT synergy_card FROM pairing_synergy WHERE card_slug=$1`, [card.slug]),
                ]);

                return {
                    id: card.slug,                      // keep your JSON `id`
                    name: card.name,
                    issuer: card.issuer,
                    network: card.network,
                    card_type: card.card_type,
                    image: card.image,
                    apply_link: card.apply_link,
                    rates_and_fees_link: card.rates_and_fees_link,
                    annual_fee: card.annual_fee,
                    foreign_fees: card.foreign_fees,
                    min_credit_score: card.min_credit_score,
                    intro_apr: card.intro_apr,
                    ongoing_apr: card.ongoing_apr,
                    reward_program: card.reward_program,
                    rewards_currency: card.rewards_currency,
                    point_value_baseline: card.point_value_baseline,
                    point_value_max: card.point_value_max,
                    card_tier: card.card_tier,
                    is_business: card.is_business,
                    data_source: card.data_source,
                    last_updated: card.last_updated,

                    rewards: rewards.rows,
                    sign_up_bonus: bonus.rows[0] || null,
                    credits_and_benefits: credits.rows,
                    transfer_partners: partners.rows.map(p => p.partner_name),
                    recommended_goals: goals.rows.map(g => g.goal),
                    available_regions: regions.rows.map(r => r.region),
                    pairing_synergy: synergy.rows.map(s => s.synergy_card),
                };
            })
        );

        res.json(hydrated);
    } catch (err) {
        console.error("DB error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get("/cards/:slug", async (req, res) => {
    const { slug } = req.params;
    try {
        const { rows } = await pool.query(`SELECT * FROM cards WHERE slug=$1`, [slug]);
        if (!rows.length) return res.status(404).json({ error: "Not found" });

        const card = rows[0];
        const [rewards, bonus, credits, partners, goals, regions, synergy] = await Promise.all([
            pool.query(`SELECT category, rate, details FROM rewards WHERE card_slug=$1 ORDER BY rate DESC`, [slug]),
            pool.query(`SELECT description, value_estimate, spend_requirement, timeframe_months FROM sign_up_bonuses WHERE card_slug=$1`, [slug]),
            pool.query(`SELECT type, value, details, category FROM credits_and_benefits WHERE card_slug=$1`, [slug]),
            pool.query(`SELECT partner_name FROM transfer_partners WHERE card_slug=$1 ORDER BY partner_name`, [slug]),
            pool.query(`SELECT goal FROM recommended_goals WHERE card_slug=$1`, [slug]),
            pool.query(`SELECT region FROM available_regions WHERE card_slug=$1`, [slug]),
            pool.query(`SELECT synergy_card FROM pairing_synergy WHERE card_slug=$1`, [slug]),
        ]);

        res.json({
            id: card.slug,
            name: card.name,
            issuer: card.issuer,
            network: card.network,
            card_type: card.card_type,
            image: card.image,
            apply_link: card.apply_link,
            rates_and_fees_link: card.rates_and_fees_link,
            annual_fee: card.annual_fee,
            foreign_fees: card.foreign_fees,
            min_credit_score: card.min_credit_score,
            intro_apr: card.intro_apr,
            ongoing_apr: card.ongoing_apr,
            reward_program: card.reward_program,
            rewards_currency: card.rewards_currency,
            point_value_baseline: card.point_value_baseline,
            point_value_max: card.point_value_max,
            card_tier: card.card_tier,
            is_business: card.is_business,
            data_source: card.data_source,
            last_updated: card.last_updated,

            rewards: rewards.rows,
            sign_up_bonus: bonus.rows[0] || null,
            credits_and_benefits: credits.rows,
            transfer_partners: partners.rows.map(p => p.partner_name),
            recommended_goals: goals.map(g => g.goal),
            available_regions: regions.map(r => r.region),
            pairing_synergy: synergy.map(s => s.synergy_card),
        });
    } catch (err) {
        console.error("DB error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Start server
app.listen(process.env.PORT, () =>
    console.log(`Server running on http://localhost:${process.env.PORT}`)
);
