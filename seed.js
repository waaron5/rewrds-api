// seed.js
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

async function upsertCard(client, card) {
    // core card row (use card.id as slug)
    await client.query(
        `
    INSERT INTO cards (
      slug, name, issuer, network, card_type, image, apply_link, rates_and_fees_link,
      annual_fee, foreign_fees, min_credit_score, intro_apr, ongoing_apr,
      reward_program, rewards_currency, point_value_baseline, point_value_max,
      card_tier, is_business, data_source, last_updated, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9,$10,$11,$12,$13,
      $14,$15,$16,$17,
      $18,$19,$20,$21, NOW()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name=$2, issuer=$3, network=$4, card_type=$5, image=$6, apply_link=$7, rates_and_fees_link=$8,
      annual_fee=$9, foreign_fees=$10, min_credit_score=$11, intro_apr=$12, ongoing_apr=$13,
      reward_program=$14, rewards_currency=$15, point_value_baseline=$16, point_value_max=$17,
      card_tier=$18, is_business=$19, data_source=$20, last_updated=$21, updated_at=NOW();
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
            card.annual_fee ?? null,
            card.foreign_fees ?? null,
            card.min_credit_score ?? null,
            card.intro_apr ?? null,
            card.ongoing_apr ?? null,
            card.reward_program ?? null,
            card.rewards_currency ?? null,
            card.point_value_baseline ?? null,
            card.point_value_max ?? null,
            card.card_tier ?? null,
            !!card.is_business,
            card.data_source ?? null,
            card.last_updated ?? null,
        ]
    );

    // clear child rows for clean re-seed (idempotent)
    await client.query(`DELETE FROM rewards WHERE card_slug=$1`, [card.id]);
    await client.query(`DELETE FROM credits_and_benefits WHERE card_slug=$1`, [card.id]);
    await client.query(`DELETE FROM transfer_partners WHERE card_slug=$1`, [card.id]);
    await client.query(`DELETE FROM recommended_goals WHERE card_slug=$1`, [card.id]);
    await client.query(`DELETE FROM available_regions WHERE card_slug=$1`, [card.id]);
    await client.query(`DELETE FROM pairing_synergy WHERE card_slug=$1`, [card.id]);
    await client.query(`DELETE FROM sign_up_bonuses WHERE card_slug=$1`, [card.id]);

    // rewards
    for (const r of card.rewards ?? []) {
        await client.query(
            `INSERT INTO rewards (card_slug, category, rate, details) VALUES ($1,$2,$3,$4)`,
            [card.id, r.category, r.rate, r.details ?? null]
        );
    }

    // sign-up bonus (take first if array; else object)
    const sub = Array.isArray(card.sign_up_bonus) ? card.sign_up_bonus[0] : card.sign_up_bonus;
    if (sub) {
        await client.query(
            `INSERT INTO sign_up_bonuses (card_slug, description, value_estimate, spend_requirement, timeframe_months)
       VALUES ($1,$2,$3,$4,$5)`,
            [
                card.id,
                sub.description ?? "",
                sub.value_estimate ?? null,
                sub.spend_requirement ?? null,
                sub.timeframe_months ?? null,
            ]
        );
    }

    // credits & benefits
    for (const c of card.credits_and_benefits ?? []) {
        await client.query(
            `INSERT INTO credits_and_benefits (card_slug, type, value, details, category)
       VALUES ($1,$2,$3,$4,$5)`,
            [card.id, c.type ?? null, c.value ?? null, c.details ?? null, c.category ?? null]
        );
    }

    // transfer partners
    for (const p of card.transfer_partners ?? []) {
        await client.query(
            `INSERT INTO transfer_partners (card_slug, partner_name) VALUES ($1,$2)`,
            [card.id, p]
        );
    }

    // recommended goals
    for (const g of card.recommended_goals ?? []) {
        await client.query(
            `INSERT INTO recommended_goals (card_slug, goal) VALUES ($1,$2)`,
            [card.id, g]
        );
    }

    // available regions
    for (const r of card.available_regions ?? []) {
        await client.query(
            `INSERT INTO available_regions (card_slug, region) VALUES ($1,$2)`,
            [card.id, r]
        );
    }

    // pairing synergy
    for (const s of card.pairing_synergy ?? []) {
        await client.query(
            `INSERT INTO pairing_synergy (card_slug, synergy_card) VALUES ($1,$2)`,
            [card.id, s]
        );
    }
}

async function seed() {
    console.log("🌱 Seeding (normalized)…");
    const issuers = fs.readdirSync(cardsDir);

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        for (const issuer of issuers) {
            const issuerPath = path.join(cardsDir, issuer);
            if (!fs.statSync(issuerPath).isDirectory()) continue;

            const files = fs.readdirSync(issuerPath).filter(f => f.endsWith(".json"));
            for (const file of files) {
                const json = JSON.parse(fs.readFileSync(path.join(issuerPath, file), "utf8"));
                await upsertCard(client, json);
                console.log(`✅ ${json.name}`);
            }
        }

        await client.query("COMMIT");
        console.log("🌱 Done.");
    } catch (e) {
        await client.query("ROLLBACK");
        console.error("❌ Seed failed:", e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
