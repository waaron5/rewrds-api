// seed.js simplified for unified schema
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

const cardsDir = path.resolve("../credit-card-database/cards");

async function seed() {
    console.log("🌱 Seeding unified schema…");
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const issuers = fs.readdirSync(cardsDir);
        for (const issuer of issuers) {
            const issuerPath = path.join(cardsDir, issuer);
            if (!fs.statSync(issuerPath).isDirectory()) continue;

            const files = fs.readdirSync(issuerPath).filter(f => f.endsWith(".json"));
            for (const file of files) {
                const card = JSON.parse(fs.readFileSync(path.join(issuerPath, file), "utf8"));

                await client.query(
                    `
          INSERT INTO cards (
            id, name, issuer, network, card_type, image, apply_link, rates_and_fees_link,
            annual_fee, foreign_fees, min_credit_score, intro_apr, ongoing_apr,
            reward_program, rewards_currency, point_value_baseline, point_value_max,
            recommended_goals, rewards, sign_up_bonus, credits_and_benefits,
            transfer_partners, available_regions, pairing_synergy,
            card_tier, is_business, data_source, last_updated,
            quiz_metadata, affiliate_metadata, updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,
            $9,$10,$11,$12,$13,
            $14,$15,$16,$17,
            $18,$19,$20,$21,
            $22,$23,$24,
            $25,$26,$27,$28,
            $29,$30, NOW()
          )
          ON CONFLICT (id) DO UPDATE
          SET name=EXCLUDED.name,
              issuer=EXCLUDED.issuer,
              network=EXCLUDED.network,
              card_type=EXCLUDED.card_type,
              image=EXCLUDED.image,
              apply_link=EXCLUDED.apply_link,
              rates_and_fees_link=EXCLUDED.rates_and_fees_link,
              annual_fee=EXCLUDED.annual_fee,
              foreign_fees=EXCLUDED.foreign_fees,
              min_credit_score=EXCLUDED.min_credit_score,
              intro_apr=EXCLUDED.intro_apr,
              ongoing_apr=EXCLUDED.ongoing_apr,
              reward_program=EXCLUDED.reward_program,
              rewards_currency=EXCLUDED.rewards_currency,
              point_value_baseline=EXCLUDED.point_value_baseline,
              point_value_max=EXCLUDED.point_value_max,
              recommended_goals=EXCLUDED.recommended_goals,
              rewards=EXCLUDED.rewards,
              sign_up_bonus=EXCLUDED.sign_up_bonus,
              credits_and_benefits=EXCLUDED.credits_and_benefits,
              transfer_partners=EXCLUDED.transfer_partners,
              available_regions=EXCLUDED.available_regions,
              pairing_synergy=EXCLUDED.pairing_synergy,
              card_tier=EXCLUDED.card_tier,
              is_business=EXCLUDED.is_business,
              data_source=EXCLUDED.data_source,
              last_updated=EXCLUDED.last_updated,
              quiz_metadata=EXCLUDED.quiz_metadata,
              affiliate_metadata=EXCLUDED.affiliate_metadata,
              updated_at=NOW();
        `,
                    [
                        card.id,
                        card.name,
                        card.issuer,
                        card.network,
                        card.card_type,
                        card.image,
                        card.apply_link,
                        card.rates_and_fees_link,
                        card.annual_fee,
                        card.foreign_fees,
                        card.min_credit_score,
                        card.intro_apr,
                        card.ongoing_apr,
                        card.reward_program,
                        card.rewards_currency,
                        card.point_value_baseline,
                        card.point_value_max,
                        card.recommended_goals || [],
                        JSON.stringify(card.rewards || []),
                        JSON.stringify(card.sign_up_bonus || null),
                        JSON.stringify(card.credits_and_benefits || []),
                        card.transfer_partners || [],
                        card.available_regions || [],
                        card.pairing_synergy || [],
                        card.card_tier,
                        card.is_business || false,
                        card.data_source,
                        card.last_updated,
                        JSON.stringify(card.quiz_metadata || {}),
                        JSON.stringify(card.affiliate_metadata || {})
                    ]
                );

                console.log(`✅ ${card.name}`);
            }
        }

        await client.query("COMMIT");
        console.log("🌱 Done.");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Seed failed:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
