// scoringEngine.js — State-based, national-first scoring engine for REWRDS

// ---------------------------
//  Utility Functions
// ---------------------------

function mapCreditScore(range) {
    const map = {
        poor: 550,
        fair: 630,
        good: 700,
        very_good: 740,
        excellent: 800,
        none: 0
    };
    return map[range] || 0;
}

function getPointValue(effort, base, max) {
    const baseline = typeof base === "number" && base > 0 ? base : 0.01;
    const maxVal = typeof max === "number" && max > 0 ? max : baseline * 1.5;

    switch (effort) {
        case "yes": return maxVal;
        case "sometimes": return (baseline + maxVal) / 2;
        default: return baseline;
    }
}

// Reward category matching helper
function getRewardRateForCategory(rewards, categoryName) {
    if (!Array.isArray(rewards)) return 1;

    const lc = categoryName.toLowerCase();

    const KEYWORDS = {
        dining: ["dining", "restaurant", "food"],
        groceries: ["grocery", "groceries", "supermarket"],
        travel: ["travel", "airfare", "airline", "hotel"],
        gas: ["gas", "fuel"],
        transit: ["transit", "rideshare", "uber", "lyft", "bus"],
        online: ["online", "ecommerce", "amazon"],
        rent: ["rent", "landlord"],
        entertainment: ["entertainment", "movies", "concert"],
        utilities: ["utilities", "phone", "internet", "cable"]
    };

    let keywords = KEYWORDS.other || [];

    for (const key in KEYWORDS) {
        if (lc.includes(key)) {
            keywords = KEYWORDS[key];
            break;
        }
    }

    let best = 0;

    for (const r of rewards) {
        const cat = (r.category || "").toLowerCase();
        if (cat.includes(lc) || keywords.some(k => cat.includes(k))) {
            if (typeof r.rate === "number" && r.rate > best) best = r.rate;
        }
    }

    // Check catch-all
    if (best === 0) {
        const fallback = rewards.find(r => (r.category || "").toLowerCase() === "catch_all");
        if (fallback?.rate) best = fallback.rate;
    }

    return best || 1;
}

function estimateYearlyRewards(card, answers, pointValue) {
    const rewards = Array.isArray(card.rewards) ? card.rewards : [];

    const spend = [
        ["Groceries", answers.spendGroceries],
        ["Dining", answers.spendDining],
        ["Travel", answers.spendTravel],
        ["Gas", answers.spendGas],
        ["Transit", answers.spendTransit],
        ["Online Shopping", answers.spendOnline],
        ["Rent", answers.spendRent],
        ["Entertainment", answers.spendEntertainment],
        ["Utilities", answers.spendUtilities],
        ["Other", answers.spendOther]
    ];

    let total = 0;

    for (const [label, amount] of spend) {
        if (!amount) continue;
        const rate = getRewardRateForCategory(rewards, label);
        total += amount * rate * pointValue;
    }

    return total;
}

// ---------------------------
//  Scoring Helpers
// ---------------------------

function scoreGoalMatch(card, goal) {
    if (!goal) return 0;
    const goals = card.recommended_goals || [];
    if (goals.includes(goal)) return 1.5;
    return goals.some(g => g.includes(goal)) ? 0.8 : 0.3;
}

function scoreAnnualFeePreference(card, pref) {
    const fee = card.annual_fee || 0;
    if (!pref) return 0;

    if (pref === "no_fee") return fee === 0 ? 1.0 : 0.2;
    if (pref === "small_fee") return fee <= 100 ? 1.0 : 0.4;
    if (pref === "premium") return fee >= 100 ? 1.0 : 0.3;

    return 0;
}

function scoreTravelFit(card, answers) {
    const freq = answers.travelFrequency;
    if (!freq) return 0;

    const rewards = card.rewards || [];
    const partners = card.transfer_partners || [];
    const foreign = (card.foreign_fees || "").toLowerCase();

    const hasTravelRewards = rewards.some(r => (r.category || "").toLowerCase().includes("travel"));
    const hasPartners = partners.length > 0;
    const noFX = foreign.includes("no") || foreign.includes("0%");

    let base = { rarely: 0.2, occasionally: 0.6, frequently: 1.0 }[freq] || 0;

    let bonus = 0;
    if (hasTravelRewards) bonus += 0.4;
    if (hasPartners) bonus += 0.3;
    if (noFX) bonus += 0.3;

    return base * (1 + bonus);
}

function scorePerks(card, answers) {
    const perks = answers.perks || [];
    if (perks.includes("none")) return 0.2;

    const benefits = (card.credits_and_benefits || []).map(b => b.toLowerCase());

    let matches = 0;
    for (const p of perks) {
        const pL = p.toLowerCase();
        if (benefits.some(b => b.includes(pL))) matches++;
    }

    return Math.min(1.5, matches * 0.4);
}

function scoreCardStrategy(card, answers) {
    const strategy = answers.cardStrategy;
    const synergy = card.pairing_synergy || [];

    if (strategy === "minimalist") return synergy.length === 0 ? 1.0 : 0.5;
    if (strategy === "optimizer") return synergy.length > 0 ? 1.0 : 0.6;
    if (strategy === "balanced") return 0.8;

    return 0;
}

function scoreBusinessPreference(card, answers) {
    const wants = answers.businessCards;
    const isBiz = card.is_business;

    if (wants === "no" && isBiz) return -5;
    if (wants === "yes" && isBiz) return 1.0;
    return 0.2;
}

function scoreLowInterest(card, answers) {
    if (answers.goal !== "low_interest") return 0;

    const intro = (card.intro_apr || "").toLowerCase();
    const ongoing = (card.ongoing_apr || "").toLowerCase();

    let score = 0;
    if (intro.includes("0%")) score += 1.2;
    if (intro.includes("balance transfer")) score += 0.8;
    if (ongoing.includes("14") || ongoing.includes("15")) score += 0.3;

    return score;
}

// ---------------------------
//  MAIN ENGINE
// ---------------------------

function scoreCards(cards, answers) {
    const results = [];

    const userState = (answers.state || "").trim().toLowerCase();
    const noState = !userState;

    const userScoreNumeric = mapCreditScore(answers.creditScore);

    (cards || []).forEach(card => {
        if (card.visibility === false) return;
        if (card.availability_status && card.availability_status !== "active") return;

        // -------------------------------
        //  STATE + NATIONAL FILTERING
        // -------------------------------

        const regions = Array.isArray(card.available_regions)
            ? card.available_regions.map(r => r.toLowerCase())
            : [];

        const quizMeta = card.quiz_metadata || {};
        const localOnly = quizMeta.local_only === true;

        const isNational =
            regions.length === 0 ||
            regions.includes("us") ||
            regions.includes("united states") ||
            regions.includes("national");

        // If user did NOT select a state → only show national cards
        if (noState) {
            if (!isNational) return;
        }

        // If user DID select a state →
        if (!noState) {
            if (!isNational) {
                // Card is LOCAL/REGIONAL — requires exact state match
                const stateMatch = regions.includes(userState);

                if (!stateMatch) return; // hide this card
            }
        }

        // -------------------------------
        //  Credit Qualification Filter
        // -------------------------------

        const minScore = typeof card.min_credit_score === "number"
            ? card.min_credit_score
            : null;

        if (minScore && userScoreNumeric > 0 && userScoreNumeric + 20 < minScore) return;

        // -------------------------------
        //  VALUE CALCULATIONS
        // -------------------------------

        let reasons = [];
        let score = 0;

        const pointValue = getPointValue(
            answers.redemption_value,
            card.point_value_baseline,
            card.point_value_max
        );

        const yearlyRewards = estimateYearlyRewards(card, answers, pointValue);
        const bonusValue = card.sign_up_bonus?.value_estimate || 0;
        const annualFee = card.annual_fee || 0;

        const netFirstYear = yearlyRewards + bonusValue - annualFee;

        score += netFirstYear / 100;

        if (yearlyRewards > 0)
            reasons.push(`Estimated $${Math.round(yearlyRewards)} in yearly rewards`);

        if (bonusValue > 0)
            reasons.push(`Sign-up bonus worth ~$${bonusValue}`);

        if (annualFee > 0) reasons.push(`Annual fee: $${annualFee}`);
        else reasons.push("No annual fee");

        // -------------------------------
        //  ADDITIONAL SCORING FACTORS
        // -------------------------------

        score += scoreGoalMatch(card, answers.goal);
        score += scoreAnnualFeePreference(card, answers.annualFee);
        score += scoreTravelFit(card, answers);
        score += scorePerks(card, answers);
        score += scoreCardStrategy(card, answers);
        score += scoreBusinessPreference(card, answers);
        score += scoreLowInterest(card, answers);

        // -------------------------------
        // Finalize
        // -------------------------------

        results.push({
            ...card,
            score: parseFloat(score.toFixed(2)),
            reasons: reasons.slice(0, 6)
        });
    });

    return results.sort((a, b) => b.score - a.score);
}

module.exports = { scoreCards };
