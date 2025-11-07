// === seed.js ===
// This script reads all credit-card JSON files and inserts them into your Neon Postgres database.

import fs from "fs";
import path from "path";
import pkg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pkg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// Adjust this path if needed — this assumes `credit-card-database` is in the same parent folder
const cardsDir = path.resolve("../credit-card-database/cards");

async function seed() {
    console.log("🌱 Seeding started...");

    const issuers = fs.readdirSync(cardsDir);
    let inserted = 0;

    for (const issuer of issuers) {
        const issuerPath = path.join(cardsDir, issuer);
        if (!fs.statSync(issuerPath).isDirectory()) continue;

        const cardFiles = fs.readdirSync(issuerPath).filter(f => f.endsWith(".json"));
        for (const file of cardFiles) {
            const filePath = path.join(issuerPath, file);
            const card = JSON.parse(fs.readFileSync(filePath, "utf8"));
            const slug = card.id;

            try {
                await pool.query(
                    `INSERT INTO cards
          (slug, name, issuer, network, card_type, annual_fee, foreign_fees, min_credit_score,
           reward_program, rewards_currency, point_value_baseline, point_value_max, data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (slug) DO UPDATE SET
             name = EXCLUDED.name,
             issuer = EXCLUDED.issuer,
             network = EXCLUDED.network,
             card_type = EXCLUDED.card_type,
             annual_fee = EXCLUDED.annual_fee,
             foreign_fees = EXCLUDED.foreign_fees,
             min_credit_score = EXCLUDED.min_credit_score,
             reward_program = EXCLUDED.reward_program,
             rewards_currency = EXCLUDED.rewards_currency,
             point_value_baseline = EXCLUDED.point_value_baseline,
             point_value_max = EXCLUDED.point_value_max,
             data = EXCLUDED.data,
             updated_at = NOW();`,
                    [
                        slug,
                        card.name,
                        card.issuer,
                        card.network,
                        card.card_type,
                        card.annual_fee ?? null,
                        card.foreign_fees ?? null,
                        card.min_credit_score ?? null,
                        card.reward_program ?? null,
                        card.rewards_currency ?? null,
                        card.point_value_baseline ?? null,
                        card.point_value_max ?? null,
                        card,
                    ]
                );

                inserted++;
                console.log(`✅ Inserted: ${card.name}`);
            } catch (err) {
                console.error(`❌ Error inserting ${file}:`, err.message);
            }
        }
    }

    console.log(`🌱 Seeding complete — inserted/updated ${inserted} cards.`);
    await pool.end();
}

seed().catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
