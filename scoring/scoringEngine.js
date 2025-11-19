// scoringEngine.js
// Backend scoring logic for REWRDS
// Uses quiz answers + card schema fields to compute a score and human-readable reasons.

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

/**
 * How much the user is willing to work for redemptions:
 * affects point value used in all reward calculations.
 */
function getPointValue(effort, base, max) {
    const baseline = typeof base === "number" && base > 0 ? base : 0.01;
    const maxVal = typeof max === "number" && max > 0 ? max : baseline * 1.5;

    switch (effort) {
        case "yes": // willing to optimize
            return maxVal;
        case "sometimes": // mix of easy + optimized redemptions
            return (baseline + maxVal) / 2;
        case "no":
        case "none":
        default:
            return baseline;
    }
}

/**
 * Get effective reward rate (multiplier) for a given spend category on this card.
 * Uses fuzzy matching against rewards[].category.
 */
function getRewardRateForCategory(rewards, categoryName) {
    if (!Array.isArray(rewards) || rewards.length === 0) return 1;

    const lowerCategory = categoryName.toLowerCase();

    const KEYWORDS = {
        dining: ["dining", "restaurant", "restaurants", "food", "eating out"],
        groceries: ["grocery", "groceries", "supermarket", "super market"],
        travel: ["travel", "airfare", "airline", "airlines", "flight", "hotel", "lodging"],
        gas: ["gas", "fuel", "service station", "service stations"],
        transit: ["transit", "rideshare", "uber", "lyft", "bus", "train", "subway", "commuter"],
        online: ["online", "ecommerce", "e-commerce", "amazon", "digital"],
        rent: ["rent", "landlord", "mortgage"],
        entertainment: ["entertainment", "movies", "movie", "cinema", "concert", "sports", "streaming"],
        utilities: ["utilities", "utility", "phone", "internet", "cable", "water", "electric"],
        other: []
    };

    let keywordSet;
    if (lowerCategory.includes("dining")) keywordSet = KEYWORDS.dining;
    else if (lowerCategory.includes("grocery")) keywordSet = KEYWORDS.groceries;
    else if (lowerCategory.includes("travel")) keywordSet = KEYWORDS.travel;
    else if (lowerCategory.includes("gas")) keywordSet = KEYWORDS.gas;
    else if (lowerCategory.includes("transit")) keywordSet = KEYWORDS.transit;
    else if (lowerCategory.includes("online")) keywordSet = KEYWORDS.online;
    else if (lowerCategory.includes("rent")) keywordSet = KEYWORDS.rent;
    else if (lowerCategory.includes("entertainment")) keywordSet = KEYWORDS.entertainment;
    else if (lowerCategory.includes("utilities")) keywordSet = KEYWORDS.utilities;
    else keywordSet = KEYWORDS.other;

    let bestRate = 0;

    rewards.forEach(r => {
        const cat = (r.category || "").toLowerCase();
        if (!cat) return;

        // direct include
        if (cat.includes(lowerCategory)) {
            if (typeof r.rate === "number" && r.rate > bestRate) bestRate = r.rate;
            return;
        }

        // keyword fuzzy match
        if (keywordSet.length && keywordSet.some(k => cat.includes(k))) {
            if (typeof r.rate === "number" && r.rate > bestRate) bestRate = r.rate;
        }
    });

    // Fallback: catch-all category (1x or similar)
    if (bestRate === 0) {
        const catchAll = rewards.find(r => {
            const c = (r.category || "").toLowerCase();
            return c === "catch_all" || c === "everything" || c === "all purchases";
        });
        if (catchAll && typeof catchAll.rate === "number") bestRate = catchAll.rate;
    }

    if (bestRate === 0) bestRate = 1;
    return bestRate;
}

/**
 * Estimate yearly rewards in dollars from user spend and card rewards.
 * Assumes spend is already annualized by the frontend logic.
 */
function estimateYearlyRewards(card, answers, pointValue) {
    const rewards = Array.isArray(card.rewards) ? card.rewards : [];

    // Merge gas + EV charging into a single "Gas" bucket
    const gasTotal = (answers.spendGas || 0) + (answers.spendEVCharging || 0);

    const spendMatrix = [
        ["Groceries", answers.spendGroceries],
        ["Dining", answers.spendDining],
        ["Travel", answers.spendTravel],
        ["Gas", gasTotal],
        ["Transit", answers.spendTransit],
        ["Online Shopping", answers.spendOnline],
        ["Rent", answers.spendRent],
        ["Entertainment", answers.spendEntertainment],
        ["Utilities", answers.spendUtilities],
        ["Other", answers.spendOther]
    ];

    let total = 0;

    spendMatrix.forEach(([label, amount]) => {
        const amt = typeof amount === "number" ? amount : 0;
        if (!amt) return;
        const rate = getRewardRateForCategory(rewards, label);
        total += amt * rate * pointValue;
    });

    return total;
}

// Normalize quiz goals to card recommended_goals strings
function normalizeGoalTags(goals) {
    return (goals || []).map(g => {
        const gL = g.toLowerCase();
        if (gL.includes("cash")) return "cashback";
        if (gL.includes("travel") || gL.includes("miles") || gL.includes("airline"))
            return "points_miles";
        if (gL.includes("premium") || gL.includes("luxury") || gL.includes("status") || gL.includes("high_spender"))
            return "maximize_value";
        if (gL.includes("build") || gL.includes("starter") || gL.includes("secured"))
            return "credit_building";
        if (gL.includes("low_interest") || gL.includes("0%") || gL.includes("balance"))
            return "low_interest";
        return gL;
    });
}

// ---------------------------
//  Scoring Helpers
// ---------------------------

function scoreGoalMatch(card, answers) {
    const goal = answers.goal;
    if (!goal) return 0;

    const cardGoals = normalizeGoalTags(card.recommended_goals || []);

    if (cardGoals.includes(goal)) {
        return 1.5; // strong alignment
    }

    // soft alignment: points_miles roughly aligns to maximize_value, etc.
    if (
        (goal === "maximize_value" && cardGoals.includes("points_miles")) ||
        (goal === "points_miles" && cardGoals.includes("maximize_value")) ||
        (goal === "low_interest" && cardGoals.includes("low_interest"))
    ) {
        return 0.8;
    }

    return 0.3;
}

function scoreAnnualFeePreference(card, answers) {
    const fee = card.annual_fee || 0;
    const pref = answers.annualFee;
    if (!pref) return 0;

    if (pref === "no_fee") {
        return fee === 0 ? 1.2 : 0.1;
    }
    if (pref === "small_fee") {
        if (fee === 0) return 0.8;
        if (fee > 0 && fee <= 100) return 1.0;
        return 0.2;
    }
    if (pref === "premium") {
        if (fee >= 400) return 1.0; // they want big-boy cards
        if (fee >= 95) return 0.7;
        return 0.2;
    }
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
    const noFX = foreign.includes("no") || foreign.includes("none") || foreign.includes("0%");

    let base = { rarely: 0.2, occasionally: 0.6, frequently: 1.0 }[freq] || 0;

    let bonus = 0;
    if (hasTravelRewards) bonus += 0.5;
    if (hasPartners) bonus += 0.4;
    if (noFX) bonus += 0.4;

    return base * (1 + bonus);
}

function scorePerks(card, answers) {
    const perks = Array.isArray(answers.perks) ? answers.perks : [];
    if (!perks.length || perks.includes("none")) return 0;

    const benefits = (card.credits_and_benefits || []).map(b => b.toLowerCase());
    const manual = ((card.quiz_metadata && card.quiz_metadata.manual_tags) || []).map(t => t.toLowerCase());
    const foreign = (card.foreign_fees || "").toLowerCase();

    let score = 0;

    perks.forEach(p => {
        const pL = p.toLowerCase();
        if (pL === "lounge_access") {
            if (benefits.some(b => b.includes("lounge") || b.includes("priority pass"))) {
                score += 0.8;
            }
        } else if (pL === "travel_insurance") {
            if (benefits.some(b => b.includes("travel insurance") || b.includes("trip cancellation") || b.includes("trip interruption"))) {
                score += 0.6;
            }
        } else if (pL === "rental_car") {
            if (benefits.some(b => b.includes("rental car") || b.includes("collision damage"))) {
                score += 0.4;
            }
        } else if (pL === "cell_phone") {
            if (benefits.some(b => b.includes("cell phone") || b.includes("phone protection"))) {
                score += 0.5;
            }
        } else if (pL === "extended_warranty") {
            if (benefits.some(b => b.includes("extended warranty"))) {
                score += 0.4;
            }
        } else if (pL === "purchase_protection") {
            if (benefits.some(b => b.includes("purchase protection"))) {
                score += 0.4;
            }
        } else if (pL === "no_foreign_fees") {
            if (foreign.includes("no") || foreign.includes("none") || foreign.includes("0%")) {
                score += 0.6;
            }
        } else if (pL === "credits") {
            if (benefits.some(b => b.includes("credit") || b.includes("statement credit"))) {
                score += 0.5;
            }
        } else if (pL === "elite_status") {
            if (benefits.some(b => b.includes("elite") || b.includes("gold status") || b.includes("platinum status"))) {
                score += 0.5;
            }
        } else if (pL === "cashback_portal") {
            if (manual.some(m => m.includes("shopping portal") || m.includes("cashback portal"))) {
                score += 0.4;
            }
        } else if (pL === "airport_parking") {
            if (benefits.some(b => b.includes("airport parking"))) {
                score += 0.3;
            }
        }
    });

    // cap to avoid overpowering
    return Math.min(score, 2.0);
}

function scoreCardStrategy(card, answers) {
    const strategy = answers.cardStrategy;
    const synergy = card.pairing_synergy || [];

    if (strategy === "minimalist") {
        return synergy.length === 0 ? 1.0 : 0.5;
    }
    if (strategy === "optimizer") {
        return synergy.length > 0 ? 1.0 : 0.6;
    }
    if (strategy === "balanced") {
        return 0.8;
    }
    return 0;
}

function scoreBusinessPreference(card, answers) {
    const wants = answers.businessCards;
    const isBiz = !!card.is_business;

    if (wants === "no" && isBiz) return -5; // hard no
    if (wants === "yes" && isBiz) return 1.0;
    if (wants === "open_to_both" && isBiz) return 0.4;
    return 0.1;
}

function scoreLowInterest(card, answers) {
    if (answers.goal !== "low_interest") return 0;

    const intro = (card.intro_apr || "").toLowerCase();
    const ongoing = (card.ongoing_apr || "").toLowerCase();

    let score = 0;

    if (intro.includes("0%")) score += 1.5;
    if (intro.includes("balance") || intro.includes("transfer")) score += 1.0;

    // crude APR check
    if (ongoing.includes("14") || ongoing.includes("15")) score += 0.4;

    return score;
}

// airline and hotel loyalty based on transfer partners / benefits
function scoreAirlineHotel(card, answers, reasons) {
    const partners = (card.transfer_partners || []).map(p => p.toLowerCase());
    const benefits = (card.credits_and_benefits || []).map(b => b.toLowerCase());

    let score = 0;

    const airlines = Array.isArray(answers.airline) ? answers.airline : [];
    const hotels = Array.isArray(answers.hotel) ? answers.hotel : [];

    const airlinePrefs = airlines.filter(a => a !== "none");
    const hotelPrefs = hotels.filter(h => h !== "none");

    if (airlinePrefs.length) {
        airlinePrefs.forEach(a => {
            const aL = a.toLowerCase();
            if (aL === "international") {
                if (partners.length > 0) {
                    score += 1.0;
                    reasons.push("Good airline transfer partners for international travel");
                }
                return;
            }
            const match = partners.some(p => p.includes(aL));
            if (match) {
                score += 1.5;
                reasons.push(`Strong match for your preferred airline (${a})`);
            }
        });
    }

    if (hotelPrefs.length) {
        hotelPrefs.forEach(h => {
            const hL = h.toLowerCase();
            const matchPartner = partners.some(p => p.includes(hL));
            const matchBenefit = benefits.some(b => b.includes(hL) || b.includes("free night"));
            if (matchPartner || matchBenefit) {
                score += 1.2;
                reasons.push(`Strong match for your preferred hotel chain (${h})`);
            }
        });
    }

    // Cap so airline/hotel can't completely dominate
    return Math.min(score, 4.0);
}

// merchant/category preferences: grocery, gas/EV, online shopping
function scoreMerchantPreferences(card, answers, reasons) {
    const rewards = card.rewards || [];

    const groceryPrefs = Array.isArray(answers.grocery) ? answers.grocery : [];
    const gasPrefs = Array.isArray(answers.gas) ? answers.gas : [];
    const onlinePrefs = Array.isArray(answers.onlineShopping) ? answers.onlineShopping : [];

    const hasRealGroceryPref = groceryPrefs.some(g => g !== "other" && g !== "none");
    const hasRealGasPref = gasPrefs.some(g => g !== "none");
    const hasRealOnlinePref = onlinePrefs.some(o => o !== "none");

    let score = 0;

    if (hasRealGroceryPref) {
        const rate = getRewardRateForCategory(rewards, "Groceries");
        if (rate > 1) {
            const bump = (rate - 1) * 0.7; // hard weighting
            score += bump;
            reasons.push(`Great for your grocery spending (${rate}x on groceries)`);
        } else {
            score -= 0.4; // they'd like grocery rewards, this card doesn't really have them
        }
    }

    if (hasRealGasPref) {
        const rate = getRewardRateForCategory(rewards, "Gas");
        if (rate > 1) {
            const bump = (rate - 1) * 0.7;
            score += bump;
            reasons.push(`Strong rewards on gas/EV spending (${rate}x)`);
        } else {
            score -= 0.3;
        }
    }

    if (hasRealOnlinePref) {
        const rate = getRewardRateForCategory(rewards, "Online Shopping");
        if (rate > 1) {
            const bump = (rate - 1) * 0.7;
            score += bump;
            reasons.push(`Well-suited for your online shopping (${rate}x)`);
        } else {
            score -= 0.3;
        }
    }

    // Cap merchant influence to avoid insane skew
    return Math.min(score, 5.0);
}

// region / state-specific boost (in addition to filtering)
function scoreRegionBoost(card, userStateLower) {
    if (!userStateLower) return 0;

    const regions = Array.isArray(card.available_regions)
        ? card.available_regions.map(r => r.toLowerCase())
        : [];

    const quizMeta = card.quiz_metadata || {};
    const regionPriority = (quizMeta.region_priority || "").toLowerCase();

    let score = 0;

    if (regions.includes(userStateLower)) score += 0.5;
    if (regionPriority === userStateLower) score += 0.5;

    return score;
}

// ---------------------------
//  MAIN ENGINE
// ---------------------------

function scoreCards(cards, answers) {
    const results = [];

    const userStateRaw = (answers.state || "").trim();
    const userState = userStateRaw.toLowerCase();
    const noState = !userState;

    const userScoreNumeric = mapCreditScore(answers.creditScore);

    (cards || []).forEach(card => {
        // basic visibility / availability
        if (card.visibility === false) return;
        if (card.availability_status && card.availability_status !== "active") return;

        // -------------------------------
        //  STATE + NATIONAL FILTERING
        // -------------------------------
        const regions = Array.isArray(card.available_regions)
            ? card.available_regions.map(r => r.toLowerCase())
            : [];

        const quizMeta = card.quiz_metadata || {};
        const isNational =
            regions.length === 0 ||
            regions.includes("us") ||
            regions.includes("united states") ||
            regions.includes("national");

        if (noState) {
            // No state given → only show clearly national cards
            if (!isNational) return;
        } else {
            // State given → show national + cards whose available_regions include that state
            if (!isNational && !regions.includes(userState)) {
                return; // hide local card from wrong state
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

        const bonusValue = card.sign_up_bonus && typeof card.sign_up_bonus.value_estimate === "number"
            ? card.sign_up_bonus.value_estimate
            : 0;

        const annualFee = card.annual_fee || 0;

        const netFirstYear = yearlyRewards + bonusValue - annualFee;

        score += netFirstYear / 100; // 100 net dollars ≈ +1.0 score

        if (yearlyRewards > 0) {
            reasons.push(`Estimated ~$${Math.round(yearlyRewards)} in yearly rewards`);
        }
        if (bonusValue > 0) {
            reasons.push(`Intro bonus worth about $${Math.round(bonusValue)}`);
        }
        if (annualFee > 0) {
            reasons.push(`Annual fee: $${annualFee}`);
        } else {
            reasons.push("No annual fee");
        }

        // -------------------------------
        //  QUIZ-BASED ADJUSTMENTS
        // -------------------------------

        score += scoreGoalMatch(card, answers);
        score += scoreAnnualFeePreference(card, answers);
        score += scoreTravelFit(card, answers);
        score += scorePerks(card, answers);
        score += scoreCardStrategy(card, answers);
        score += scoreBusinessPreference(card, answers);
        score += scoreLowInterest(card, answers);

        // Airline / hotel loyalty
        score += scoreAirlineHotel(card, answers, reasons);

        // Grocery / Gas / Online shopping preferences (hard-weighted)
        score += scoreMerchantPreferences(card, answers, reasons);

        // Region/state boost
        score += scoreRegionBoost(card, userState);

        const finalScore = parseFloat(score.toFixed(2));

        results.push({
            ...card,
            score: finalScore,
            reasons: reasons.slice(0, 6)
        });
    });

    return results.sort((a, b) => b.score - a.score);
}

module.exports = { scoreCards };
