// scoringEngine.js
// Backend scoring logic for REWRDS
// Uses quiz answers + card schema fields to compute a score and human-readable reasons.

/**
 * Map quiz creditScore answer to a numeric score.
 */
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
 * Estimate point value (in dollars per point) based on user redemption effort
 * and card's point_value_baseline / point_value_max.
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
 * Falls back to "Catch_All" or 1x if nothing specific is found.
 */
function getRewardRateForCategory(rewards, categoryName) {
    if (!Array.isArray(rewards) || rewards.length === 0) return 1;

    const lowerCategory = categoryName.toLowerCase();

    const KEYWORDS = {
        dining: ["dining", "restaurant", "restaurants", "food", "eat"],
        groceries: ["grocery", "groceries", "supermarket"],
        travel: ["travel", "airfare", "airline", "airlines", "hotels", "hotel"],
        gas: ["gas", "fuel", "service station"],
        transit: ["transit", "rideshare", "lyft", "uber", "bus", "train", "subway"],
        online: ["online", "e-commerce", "ecommerce", "amazon"],
        rent: ["rent", "mortgage"],
        entertainment: ["entertainment", "streaming", "movies", "theater", "concert"],
        utilities: ["utilities", "utility", "bills", "phone", "internet", "cable"],
        other: [] // will fall back to catch-all / base
    };

    let keywordSet = [];
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
        // direct include of category name
        if (cat.includes(lowerCategory)) {
            if (typeof r.rate === "number" && r.rate > bestRate) bestRate = r.rate;
            return;
        }
        // keyword matches
        for (const kw of keywordSet) {
            if (kw && cat.includes(kw)) {
                if (typeof r.rate === "number" && r.rate > bestRate) bestRate = r.rate;
                break;
            }
        }
    });

    // Try catch-all category if nothing specific matched
    if (bestRate === 0) {
        const catchAll = rewards.find(
            r => (r.category || "").toLowerCase() === "catch_all"
        );
        if (catchAll && typeof catchAll.rate === "number") {
            bestRate = catchAll.rate;
        }
    }

    // Fallback: assume 1x if we know nothing
    if (bestRate === 0) bestRate = 1;

    return bestRate;
}

/**
 * Estimate yearly rewards in dollars from user spend and card rewards.
 * Assumes spend is already annualized in answers (your slider logic multiplies by 12).
 */
function estimateYearlyRewards(card, answers, pointValue) {
    const rewards = Array.isArray(card.rewards) ? card.rewards : [];

    const categories = [
        ["Groceries", answers.spendGroceries || 0],
        ["Dining", answers.spendDining || 0],
        ["Travel", answers.spendTravel || 0],
        ["Gas", answers.spendGas || 0],
        ["Transit", answers.spendTransit || 0],
        ["Online Shopping", answers.spendOnline || 0],
        ["Rent", answers.spendRent || 0],
        ["Entertainment", answers.spendEntertainment || 0],
        ["Utilities", answers.spendUtilities || 0],
        ["Other", answers.spendOther || 0]
    ];

    let total = 0;

    categories.forEach(([label, amount]) => {
        if (!amount || amount <= 0) return;
        const rate = getRewardRateForCategory(rewards, label);
        total += amount * rate * pointValue;
    });

    return total; // dollars per year
}

/**
 * Score how well the card matches the user's main goal.
 */
function scoreGoalMatch(card, goal) {
    if (!goal) return 0;
    const goals = Array.isArray(card.recommended_goals) ? card.recommended_goals : [];
    if (goals.length === 0) return 0;

    if (goals.includes(goal)) return 1.5; // strong match

    // Some loose matching
    if (
        goal === "points_miles" &&
        (goals.includes("travel") || goals.includes("maximize_value"))
    ) {
        return 1.0;
    }

    if (
        goal === "maximize_value" &&
        (goals.includes("cashback") || goals.includes("points_miles"))
    ) {
        return 0.8;
    }

    if (
        goal === "credit_building" &&
        (goals.includes("starter") || goals.includes("credit_building"))
    ) {
        return 1.0;
    }

    if (
        goal === "low_interest" &&
        (goals.includes("low_interest") || goals.includes("balance_transfer"))
    ) {
        return 1.0;
    }

    return 0.3; // weak / partial match
}

/**
 * Annual fee preference score.
 */
function scoreAnnualFeePreference(card, annualFeePreference) {
    const fee = typeof card.annual_fee === "number" ? card.annual_fee : 0;

    if (!annualFeePreference) return 0;

    if (annualFeePreference === "no_fee") {
        if (fee === 0) return 1.0;
        if (fee <= 100) return 0.3;
        return 0.1;
    }

    if (annualFeePreference === "small_fee") {
        if (fee === 0) return 0.8;
        if (fee <= 100) return 1.0;
        return 0.4;
    }

    if (annualFeePreference === "premium") {
        if (fee >= 100) return 1.0;
        if (fee > 0) return 0.7;
        return 0.3;
    }

    return 0;
}

/**
 * Travel-related fit: travel frequency + card travel perks.
 */
function scoreTravelFit(card, answers) {
    const freq = answers.travelFrequency;
    if (!freq) return 0;

    const rewards = Array.isArray(card.rewards) ? card.rewards : [];
    const transferPartners = Array.isArray(card.transfer_partners)
        ? card.transfer_partners
        : [];
    const foreignFees = (card.foreign_fees || "").toLowerCase();

    const hasTravelRewards = rewards.some(r =>
        (r.category || "").toLowerCase().includes("travel")
    );
    const hasPartners = transferPartners.length > 0;
    const noForeignFees =
        foreignFees.includes("no") || foreignFees.includes("0%");

    let base = 0;
    if (freq === "rarely") base = 0.2;
    if (freq === "occasionally") base = 0.6;
    if (freq === "frequently") base = 1.0;

    let bonus = 0;
    if (hasTravelRewards) bonus += 0.4;
    if (hasPartners) bonus += 0.3;
    if (noForeignFees) bonus += 0.3;

    return base * (1 + bonus); // up to around ~2
}

/**
 * Airline / hotel alignment using transfer partners.
 */
function scoreAirlineHotelAlignment(card, answers) {
    const partners = Array.isArray(card.transfer_partners)
        ? card.transfer_partners.map(p => p.toLowerCase())
        : [];

    if (partners.length === 0) return 0;

    let score = 0;

    const airlines = Array.isArray(answers.airline) ? answers.airline : [];
    const hotels = Array.isArray(answers.hotel) ? answers.hotel : [];

    if (airlines.includes("none") && hotels.includes("none")) return 0.2;

    if (airlines.length > 0 && !airlines.includes("none")) {
        const airlineMatches = airlines.filter(a =>
            partners.some(p => p.includes(a))
        ).length;
        if (airlineMatches > 0) score += 0.7;
    }

    if (hotels.length > 0 && !hotels.includes("none")) {
        const hotelMatches = hotels.filter(h =>
            partners.some(p => p.includes(h))
        ).length;
        if (hotelMatches > 0) score += 0.6;
    }

    return score;
}

/**
 * Map quiz perks to card.credits_and_benefits (strings).
 */
function scorePerks(card, answers) {
    const perksAns = Array.isArray(answers.perks) ? answers.perks : [];
    if (perksAns.length === 0) return 0;
    if (perksAns.includes("none")) return 0.2;

    const benefits = Array.isArray(card.credits_and_benefits)
        ? card.credits_and_benefits.map(b => b.toLowerCase())
        : [];

    if (benefits.length === 0) return 0;

    let matches = 0;

    perksAns.forEach(p => {
        const pLower = p.toLowerCase();
        if (
            (pLower === "lounge_access" &&
                benefits.some(b => b.includes("lounge"))) ||
            (pLower === "travel_insurance" &&
                benefits.some(b => b.includes("travel insurance"))) ||
            (pLower === "rental_car" &&
                benefits.some(b => b.includes("rental car"))) ||
            (pLower === "cell_phone" &&
                benefits.some(b => b.includes("cell phone"))) ||
            (pLower === "purchase_protection" &&
                benefits.some(
                    b => b.includes("purchase protection") || b.includes("extended warranty")
                )) ||
            (pLower === "credits" && benefits.some(b => b.includes("credit"))) ||
            ((pLower === "tsa" || pLower === "tsa_pre" || pLower === "tsa_precheck") &&
                benefits.some(
                    b => b.includes("tsa") || b.includes("global entry")
                )) ||
            (pLower === "no_foreign" &&
                benefits.some(
                    b => b.includes("no foreign") || b.includes("foreign transaction")
                )) ||
            (pLower === "exclusive" &&
                benefits.some(b => b.includes("exclusive") || b.includes("vip")))
        ) {
            matches += 1;
        }
    });

    if (matches === 0) return 0.1;
    return Math.min(1.5, matches * 0.4); // cap perk score
}

/**
 * Card strategy vs pairing_synergy.
 */
function scoreCardStrategy(card, answers) {
    const strategy = answers.cardStrategy;
    if (!strategy) return 0;
    const synergy = Array.isArray(card.pairing_synergy)
        ? card.pairing_synergy
        : [];

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

/**
 * Business card filter / score.
 */
function scoreBusinessPreference(card, answers) {
    const choice = answers.businessCards;
    const isBiz = !!card.is_business;

    if (choice === "no" && isBiz) {
        // Effectively disqualify business cards if user said no.
        return -5;
    }
    if (choice === "yes" && isBiz) {
        return 1.0;
    }
    return 0.2;
}

/**
 * Region / zip handling + quiz_metadata local boosts.
 */
function scoreRegion(card, answers) {
    const zip = (answers.zip || "").trim();
    if (!zip) return 0;

    const regions = Array.isArray(card.available_regions)
        ? card.available_regions.map(r => r.toLowerCase())
        : [];

    const quizMeta = card.quiz_metadata || {};
    const localOnly = !!quizMeta.local_only;
    const regionPriority = (quizMeta.region_priority || "").toLowerCase();

    let score = 0;

    // Very light "likely US" check
    const isUS =
        regions.some(r => r.includes("us") || r.includes("united states")) ||
        regions.length === 0;

    if (!isUS && !regions.some(r => r.includes("utah"))) {
        // Card is clearly not for US or Utah
        score -= 1.0;
    }

    // Utah boost if user is in a Utah-style zip and card is Utah-focused
    const looksLikeUtahZip = zip.startsWith("84"); // rough but fine for now
    if (looksLikeUtahZip && regions.some(r => r.includes("utah"))) {
        score += 1.0;
        if (localOnly || regionPriority === "utah") score += 0.5;
    }

    return score;
}

/**
 * Quiz metadata alignment (recommended_for + manual_tags).
 */
function scoreQuizMetadata(card, answers) {
    const quizMeta = card.quiz_metadata || {};
    const recommendedFor = Array.isArray(quizMeta.recommended_for)
        ? quizMeta.recommended_for.map(x => x.toLowerCase())
        : [];
    const manualTags = Array.isArray(quizMeta.manual_tags)
        ? quizMeta.manual_tags.map(x => x.toLowerCase())
        : [];

    if (recommendedFor.length === 0 && manualTags.length === 0) return 0;

    const tags = new Set([...recommendedFor, ...manualTags]);

    const userTags = [];

    // Build a simple profile out of quiz answers
    const creditScore = answers.creditScore;
    if (creditScore === "poor" || creditScore === "fair") userTags.push("beginner", "rebuilding");
    if (creditScore === "good" || creditScore === "very_good") userTags.push("intermediate");
    if (creditScore === "excellent") userTags.push("advanced");

    const goal = answers.goal;
    if (goal) userTags.push(goal);

    const travelFreq = answers.travelFrequency;
    if (travelFreq === "frequently") userTags.push("frequent_traveler");
    if (travelFreq === "occasionally") userTags.push("casual_traveler");

    if (answers.businessCards === "yes") userTags.push("business_friendly");

    // Rough "optimizer" tag
    if (answers.cardStrategy === "optimizer") userTags.push("optimizer");

    let matches = 0;
    userTags.forEach(t => {
        if (tags.has(t)) matches++;
    });

    if (matches === 0) return 0.1;
    return Math.min(1.5, matches * 0.4);
}

/**
 * Low-interest / intro APR bias (non-dollar).
 */
function scoreLowInterest(card, answers) {
    if (answers.goal !== "low_interest") return 0;

    const intro = (card.intro_apr || "").toLowerCase();
    const ongoing = (card.ongoing_apr || "").toLowerCase();

    let score = 0;

    if (intro.includes("0%") || intro.includes("0 %")) score += 1.2;
    if (intro.includes("balance transfer")) score += 0.8;

    // Very crude: lower stated APR strings get a small boost
    if (ongoing.includes("14") || ongoing.includes("15")) score += 0.3;

    return score;
}

/**
 * Main scoring entry point.
 * @param {Array<Object>} cards
 * @param {Object} answers
 * @returns {Array<Object>} scored cards sorted descending by score
 */
function scoreCards(cards, answers) {
    const results = [];
    const userScoreNumeric = mapCreditScore(answers.creditScore);

    (cards || []).forEach(card => {
        // Filter out invisible / inactive cards early
        if (card.visibility === false) return;
        if (card.availability_status && card.availability_status !== "active") return;

        // Basic credit qualification filter
        const minScore = typeof card.min_credit_score === "number"
            ? card.min_credit_score
            : null;

        if (minScore && userScoreNumeric > 0 && userScoreNumeric + 20 < minScore) {
            // User is clearly below minimum recommended score -> skip
            return;
        }

        let reasons = [];
        let score = 0;

        // === 1. Core dollar value (first-year-ish) ===
        const pointValue = getPointValue(
            answers.redemption_value,
            card.point_value_baseline,
            card.point_value_max
        );

        const yearlyRewards = estimateYearlyRewards(card, answers, pointValue);

        const bonusValue =
            card.sign_up_bonus && typeof card.sign_up_bonus.value_estimate === "number"
                ? card.sign_up_bonus.value_estimate
                : 0;

        const annualFee = typeof card.annual_fee === "number" ? card.annual_fee : 0;

        // First-year net dollar estimate (rewards + bonus - fee)
        const netFirstYear = yearlyRewards + bonusValue - annualFee;

        // Normalize dollars into a score component
        const valueComponent = netFirstYear / 100; // $100 net ≈ 1 score point
        score += valueComponent;

        if (yearlyRewards > 0) {
            reasons.push(
                `Estimated $${Math.round(yearlyRewards)} in yearly rewards based on your spending`
            );
        }
        if (bonusValue > 0) {
            reasons.push(`Sign-up bonus worth about $${Math.round(bonusValue)} in the first year`);
        }
        if (annualFee > 0) {
            reasons.push(`Annual fee: $${annualFee}`);
        } else {
            reasons.push("No annual fee");
        }

        // === 2. Qualification / approval comfort ===
        if (minScore && userScoreNumeric > 0) {
            const diff = userScoreNumeric - minScore;
            let approvalScore = 0;
            if (diff >= 30) approvalScore = 2.0;
            else if (diff >= 10) approvalScore = 1.5;
            else if (diff >= 0) approvalScore = 1.0;
            else if (diff >= -10) approvalScore = 0.4;
            else approvalScore = 0.1;

            score += approvalScore;
            if (diff >= 0) {
                reasons.push("You’re likely to qualify based on your credit score range");
            } else {
                reasons.push("May be harder to qualify given your current credit score range");
            }
        }

        // === 3. Goal match ===
        const goalScore = scoreGoalMatch(card, answers.goal);
        score += goalScore;
        if (goalScore > 1.0) {
            reasons.push("Aligns well with your main card goal");
        }

        // === 4. Annual fee preference ===
        const feePrefScore = scoreAnnualFeePreference(card, answers.annualFee);
        score += feePrefScore;

        // === 5. Travel fit ===
        const travelFitScore = scoreTravelFit(card, answers);
        score += travelFitScore;
        if (travelFitScore > 1.2) {
            reasons.push("Strong fit for your travel habits and perks");
        }

        // === 6. Airline / hotel alignment ===
        const airHotelScore = scoreAirlineHotelAlignment(card, answers);
        score += airHotelScore;
        if (airHotelScore > 0.5) {
            reasons.push("Good match with your preferred airlines or hotel chains");
        }

        // === 7. Perks / benefits ===
        const perksScore = scorePerks(card, answers);
        score += perksScore;
        if (perksScore > 0.8) {
            reasons.push("Offers perks that match the benefits you care about");
        }

        // === 8. Card strategy (minimalist vs optimizer) ===
        const strategyScore = scoreCardStrategy(card, answers);
        score += strategyScore;

        // === 9. Business card preference ===
        const bizScore = scoreBusinessPreference(card, answers);
        // If user explicitly said no to business cards and this is business,
        // bizScore will be -5 and essentially knock it out of the top list.
        score += bizScore;
        if (bizScore > 0.5) {
            reasons.push("Fits your preference for including business cards");
        }
        if (bizScore <= -4) {
            reasons.push("Business card (you indicated you prefer personal cards)");
        }

        // === 10. Region / local fit ===
        const regionScore = scoreRegion(card, answers);
        score += regionScore;
        if (regionScore > 1.0) {
            reasons.push("Local or regional card likely available in your area");
        }

        // === 11. Quiz metadata alignment ===
        const metaScore = scoreQuizMetadata(card, answers);
        score += metaScore;
        if (metaScore > 0.8) {
            reasons.push("Matches your profile based on internal tags");
        }

        // === 12. Low-interest handling ===
        const lowInterestScore = scoreLowInterest(card, answers);
        score += lowInterestScore;
        if (lowInterestScore > 0.5) {
            reasons.push("Supports your goal of lower interest / balance transfers");
        }

        // Final clamp and formatting
        const finalScore = parseFloat(score.toFixed(2));

        results.push({
            ...card,
            score: finalScore,
            reasons: reasons.slice(0, 6) // keep top 6 reasons
        });
    });

    // Sort high to low
    return results.sort((a, b) => b.score - a.score);
}

module.exports = { scoreCards };
