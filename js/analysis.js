/* VO-AI | analysis.js
   Deterministic variation analysis: classification, contract clause lookup
   and the contract-BQ rate cross-check. No language model, no invented
   numbers — every output traces to data the user entered. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, contractorTotal, assessedTotal } = require("./calc.js");
    var { matchClause } = require("./clauses.js");
}

const RATE_TOLERANCE = 0.005;   /* half a sen */

/* -----------------------------------------------------------
   Automatic BQ matching — find the contract BQ item a measurement row
   is describing, without the user having to pick it from a dropdown.

   Three signals, strongest first:
     1. Code match — the row's description literally contains a BQ
        item's code (e.g. "B/4.1"). Codes always contain a slash and a
        digit, so this is checked as a literal, boundary-safe substring
        match — never fuzzy. A code match is definitive: it is returned
        immediately with score 1, no further scoring needed.
     2. Description similarity — both descriptions are normalised
        (lowercase, non-alphanumeric characters collapsed to spaces) and
        split into "significant" words (common BQ filler words removed).
        The score is "coverage": the SMALLER of recall (fraction of the
        row's words found in the candidate) and precision (fraction of
        the candidate's words found in the row) — not a simple average
        or a plain Jaccard index. That distinction was found by testing
        against the seeded BQ, not assumed: a first version scored by
        Jaccard (intersection / union) and it auto-matched the seed's
        own worked star-rate example — "Add marble floor tiles 600x600mm
        to living area" against BQ item "Ceramic floor tiles 600x600mm
        to living area" (B/4.1) — because five of the row's seven words
        (floor, tiles, 600x600mm, living, area) are shared; Jaccard
        scored that pair at 5/8 ≈ 0.63, HIGHER than a genuine match like
        "Additional skirting to match floor finish" against "Skirting to
        match floor finish" (4/5 = 0.8 Jaccard admittedly still higher —
        the point is Jaccard alone cannot separate them by threshold).
        Marble and ceramic tiles are different, separately priced items
        — comparing the claimed marble rate to the ceramic contract rate
        would be exactly the "confident-looking wrong answer" this
        matcher must not produce. Requiring the MINIMUM of recall and
        precision closes that gap: the marble row covers only 5/7 = 0.71
        of its own words in the candidate (recall), which sits below the
        0.75 acceptance bar, while the skirting example covers 4/5 = 0.8
        of its words and the candidate's 4/4 = 1.0 words are all present
        in the row — both comfortably clear it. Requiring both fractions
        to be high (not just their average, and not just one direction)
        is what a plain word-overlap fraction misses: a short candidate
        fully contained in a much longer row (high precision, low
        recall) or a short row fully contained in a much longer
        candidate (high recall, low precision) are both coincidental
        overlaps, not real matches, and coverage rejects both.
     3. Unit agreement — checked only for candidates whose raw coverage
        already clears the threshold (see below). A matching unit adds
        a small bonus (capped at 1), used only to rank between several
        otherwise-qualifying candidates — it can never lift a candidate
        that failed on description alone over the bar. A conflicting
        unit multiplies the score by 0.3, which CAN drop a qualifying
        candidate back below the bar: even a perfect (1.0) description
        match with conflicting units — e.g. the same wording measured in
        "m2" on one side and "no" on the other — must fail, because an
        item measured by area cannot be the same item as one measured by
        count. 1.0 * 0.3 = 0.3 sits well below the acceptance threshold.
        Unit agreement is deliberately asymmetric like this: it may only
        ever make a match less likely to slip through, never more.

   Threshold: raw coverage (before any unit adjustment) must be >= 0.75,
   AND at least 2 overlapping significant words (so a single shared
   common word on a short description/candidate pair, which can reach a
   high coverage score by accident, cannot pass alone). After that gate,
   the unit-adjusted score must ALSO be >= 0.75, which is where a unit
   conflict can still reject a candidate that passed the first gate.
   This is deliberately conservative — see the module comment at the
   top of this file: a wrong automatic match is worse than no match, so
   near-misses return null rather than a low-confidence guess.
----------------------------------------------------------- */

const BQ_MATCH_THRESHOLD = 0.75;
const BQ_MATCH_MIN_OVERLAP = 2;

const BQ_FILLER_WORDS = new Set([
    "to", "and", "the", "of", "with", "incl", "including", "complete"
]);

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Lowercase, collapse everything that isn't a letter or digit into a
   single space. Deliberately does NOT strip digits or the "x" in
   dimension tokens like "600x600mm" — those are discriminating, not
   noise. */
function normaliseText(text) {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function significantWords(text) {
    const norm = normaliseText(text);
    if (!norm) return [];
    return norm.split(" ").filter(w => w && !BQ_FILLER_WORDS.has(w));
}

/* A BQ code is a definitive identifier — it always contains a slash and
   a digit (e.g. "B/4.1"). Match it as a literal substring of the row's
   description, guarded so "B/4.1" doesn't accidentally match inside
   "B/4.10": the characters immediately before and after the code, if
   any, must not themselves be alphanumeric. */
function findCodeMatch(description, bq) {
    const text = description || "";
    for (const item of bq) {
        const code = item.code || "";
        if (!code || code.indexOf("/") === -1 || !/\d/.test(code)) continue;
        const pattern = new RegExp("(^|[^a-z0-9])" + escapeRegExp(code) + "($|[^a-z0-9])", "i");
        if (pattern.test(text)) return item;
    }
    return null;
}

/* Best-matching BQ item for a measurement row, with WHY it matched.
   Returns { item, basis, score } or null when nothing clears the bar —
   see the reasoning above the constants. */
function matchBqItem(row, bq) {
    const list = bq || [];
    if (!row) return null;

    const codeItem = findCodeMatch(row.description, list);
    if (codeItem) {
        return {
            item: codeItem,
            basis: "matched BQ code " + codeItem.code + " in the description",
            score: 1
        };
    }

    const rowWords = significantWords(row.description);
    if (rowWords.length === 0) return null;
    const rowSet = new Set(rowWords);
    const rowUnit = (row.unit || "").trim().toLowerCase();

    let best = null;

    list.forEach(item => {
        const candWords = significantWords(item.description);
        if (candWords.length === 0) return;
        const candSet = new Set(candWords);

        let overlap = 0;
        rowSet.forEach(w => { if (candSet.has(w)) overlap++; });
        if (overlap < BQ_MATCH_MIN_OVERLAP) return;

        const recall = overlap / rowWords.length;
        const precision = overlap / candWords.length;
        const coverage = Math.min(recall, precision);

        /* Gate on raw coverage BEFORE any unit adjustment. A unit match
           may only nudge the score for ranking between two candidates
           that already clear the bar on description alone — it must
           never be able to rescue a candidate that doesn't. Only a
           unit CONFLICT is allowed to move a candidate across the
           threshold (downward, rejecting it) after this gate. */
        if (coverage < BQ_MATCH_THRESHOLD) return;

        const candUnit = (item.unit || "").trim().toLowerCase();
        const bothDeclareUnit = Boolean(rowUnit && candUnit);
        const unitsMatch = bothDeclareUnit && rowUnit === candUnit;
        const unitsConflict = bothDeclareUnit && rowUnit !== candUnit;

        let score = coverage;
        if (unitsMatch) score = Math.min(1, score + 0.05);
        if (unitsConflict) score = score * 0.3;

        if (score < BQ_MATCH_THRESHOLD) return;
        if (best && score <= best.score) return;

        const basisParts = ["matched on description (" + overlap + " of " +
            rowWords.length + " significant words)"];
        if (unitsMatch) basisParts.push("and unit " + item.unit);

        best = { item: item, basis: basisParts.join(" "), score: score };
    });

    return best;
}

/* -----------------------------------------------------------
   Rate cross-check — template.xlsx, consultant sheet:
   "show similar rate / different rate, if different state which rate wrong"
----------------------------------------------------------- */

function checkRate(row, bq) {
    const claimed = Number(row.rate) || 0;
    const list = bq || [];
    let item = row.bqItemId
        ? list.find(b => b.id === row.bqItemId)
        : null;

    /* Only attempt an automatic match when the user hasn't linked a BQ
       item at all. A bqItemId that points at nothing (e.g. a deleted
       item) is left as-is — that is a data problem, not something to
       paper over with a guess. */
    let auto = null;
    if (!item && !row.bqItemId) {
        auto = matchBqItem(row, list);
        if (auto) item = auto.item;
    }

    if (!item) {
        return {
            state: "star",
            label: "Star rate",
            detail: "No matching contract BQ item. This is a star rate and must be " +
                    "agreed separately, supported by a quotation or rate build-up, " +
                    "before certification."
        };
    }

    const contractRate = Number(item.rate) || 0;
    const diff = claimed - contractRate;
    const autoFields = auto
        ? { autoMatched: true, matchBasis: auto.basis, matchScore: auto.score, matchedItem: item }
        : {};
    const autoNote = auto ? " (Automatically matched — " + auto.basis + ".)" : "";

    if (Math.abs(diff) < RATE_TOLERANCE) {
        return Object.assign({
            state: "same",
            label: "Same rate",
            detail: "Matches contract BQ item " + item.code + " at " +
                    rm(contractRate) + " per " + item.unit + "." + autoNote,
            contractRate: contractRate,
            diff: 0
        }, autoFields);
    }

    const pct = contractRate === 0 ? null : (diff / contractRate) * 100;

    return Object.assign({
        state: "different",
        label: "Different rate",
        detail: "Contractor claimed " + rm(claimed) + " but contract BQ item " +
                item.code + " is " + rm(contractRate) + " per " + item.unit + ". " +
                "The contract BQ rate governs — the contractor's rate is " +
                (diff > 0 ? "overstated" : "understated") + " by " + rm(Math.abs(diff)) +
                (pct === null ? "" : " (" + Math.abs(pct).toFixed(1) + "%)") + "." + autoNote,
        contractRate: contractRate,
        diff: diff,
        pct: pct
    }, autoFields);
}

function rateSummary(vo, bq) {
    const rows = (vo.measurement || []).map(row => ({
        row: row,
        check: checkRate(row, bq)
    }));
    return {
        rows: rows,
        same: rows.filter(r => r.check.state === "same").length,
        different: rows.filter(r => r.check.state === "different").length,
        star: rows.filter(r => r.check.state === "star").length
    };
}

/* -----------------------------------------------------------
   Classification — keyword and measurement-shape rules.
   Order matters: the most specific signal wins.
----------------------------------------------------------- */

const WORK_SECTIONS = [
    { key: /tile|marble|finish|skirting|floor|paint|plaster/i, name: "Finishes" },
    { key: /drain|sewer|pipe|sump|manhole/i,                   name: "External Works & Drainage" },
    { key: /ceiling|cornice|cove/i,                            name: "Ceilings" },
    { key: /door|window|ironmonger|glaz/i,                     name: "Doors & Windows" },
    { key: /concrete|rebar|beam|column|slab|structur/i,        name: "Structural Works" },
    { key: /electric|wiring|light|socket|db\b/i,               name: "Electrical Services" },
    { key: /plumb|sanitary|water|toilet/i,                     name: "Plumbing & Sanitary" }
];

function affectedWork(text) {
    const hit = WORK_SECTIONS.find(s => s.key.test(text || ""));
    return hit ? hit.name : "General Works";
}

function classifyVariation(vo) {
    const text = (vo.description || "");
    const rows = vo.measurement || [];

    const label = (id, name) => ({
        id: id,
        label: name,
        affectedWork: affectedWork(text)
    });

    if (!text.trim() && rows.length === 0) {
        return label("unclassified", "Not yet classified");
    }

    /* A substitution shows up as an omission and an addition together,
       or as explicit substitution wording. */
    const hasNegative = rows.some(r => (Number(r.qty) || 0) < 0);
    const hasPositive = rows.some(r => (Number(r.qty) || 0) > 0);

    if (/\bfrom\b.+\bto\b|substitut|replace|change of|upgrade/i.test(text) ||
        (hasNegative && hasPositive)) {
        return label("specification", "Material / specification change");
    }

    if (/remeasure|remeasurement|quantity variation|approximate quantit|provisional quantit/i.test(text)) {
        return label("quantity", "Quantity variation / remeasurement");
    }

    if (/\bomit|omission|delete|remove\b/i.test(text) || (hasNegative && !hasPositive)) {
        return label("omission", "Omission of work");
    }

    if (/redesign|design revision|revised design|revision to/i.test(text)) {
        return label("design", "Design revision");
    }

    if (/additional|extra work|add\b|new\b/i.test(text) || hasPositive) {
        /* Extra quantity of an item already in the BQ is a remeasurement,
           not new work. */
        const allLinked = rows.length > 0 && rows.every(r => r.bqItemId);
        return allLinked
            ? label("quantity", "Quantity variation / remeasurement")
            : label("addition", "Additional work");
    }

    return label("unclassified", "Not yet classified");
}

/* -----------------------------------------------------------
   Classification basis — WHICH signals the engine used, so the UI can
   show its working instead of a fabricated confidence score. Mirrors
   classifyVariation's branches exactly: same conditions, same order,
   so this can never disagree with the classification it explains.
----------------------------------------------------------- */

function classificationBasis(vo) {
    const text = (vo.description || "");
    const rows = vo.measurement || [];
    const vague = { signals: [], summary: "The description was too vague to classify — " +
                    "enter more detail about what is changing." };

    if (!text.trim() && rows.length === 0) {
        return vague;
    }

    const hasNegative = rows.some(r => (Number(r.qty) || 0) < 0);
    const hasPositive = rows.some(r => (Number(r.qty) || 0) > 0);
    const allLinked = rows.length > 0 && rows.every(r => r.bqItemId);

    const wordingSubstitution = /\bfrom\b.+\bto\b|substitut|replace|change of|upgrade/i.test(text);
    if (wordingSubstitution || (hasNegative && hasPositive)) {
        const signals = [];
        if (wordingSubstitution) signals.push("instruction wording (substitution / change-of phrasing)");
        if (hasNegative && hasPositive) signals.push("measurement shape (omission and addition)");
        return { signals: signals,
                 summary: "Classified as a material / specification change because of " +
                          signals.join(" and ") + "." };
    }

    const wordingQuantity = /remeasure|remeasurement|quantity variation|approximate quantit|provisional quantit/i.test(text);
    if (wordingQuantity) {
        return { signals: ["instruction wording (remeasurement / quantity-variation phrasing)"],
                 summary: "Classified as a quantity variation because the description used " +
                          "remeasurement wording." };
    }

    const wordingOmission = /\bomit|omission|delete|remove\b/i.test(text);
    if (wordingOmission || (hasNegative && !hasPositive)) {
        const signals = [];
        if (wordingOmission) signals.push("instruction wording (omission / deletion phrasing)");
        if (hasNegative && !hasPositive) signals.push("measurement shape (negative quantity only)");
        return { signals: signals,
                 summary: "Classified as an omission of work because of " +
                          signals.join(" and ") + "." };
    }

    const wordingDesign = /redesign|design revision|revised design|revision to/i.test(text);
    if (wordingDesign) {
        return { signals: ["instruction wording (design-revision phrasing)"],
                 summary: "Classified as a design revision because the description used " +
                          "design-revision wording." };
    }

    const wordingAddition = /additional|extra work|add\b|new\b/i.test(text);
    if (wordingAddition || hasPositive) {
        const signals = [];
        if (wordingAddition) signals.push("instruction wording (additional / extra-work phrasing)");
        if (hasPositive) signals.push("measurement shape (positive quantity)");
        if (allLinked) signals.push("measurement shape (all rows linked to existing BQ items)");
        const label = allLinked ? "a quantity variation" : "additional work";
        return { signals: signals,
                 summary: "Classified as " + label + " because of " + signals.join(" and ") + "." };
    }

    return vague;
}

/* -----------------------------------------------------------
   Full assessment
----------------------------------------------------------- */

function analyse(vo, project) {
    const bq = (project && project.bq) || [];
    const classification = classifyVariation(vo);
    const clause = matchClause(classification.id);
    const rates = rateSummary(vo, bq);

    const claimed = contractorTotal(vo);
    const assessed = assessedTotal(vo);

    const findings = [];

    if (rates.different > 0) {
        findings.push(
            rates.different + " row(s) use a rate that is different from the contract " +
            "BQ. The contract BQ rate governs — correct the assessed rate before approval.");
    }
    if (rates.star > 0) {
        findings.push(
            rates.star + " row(s) have no comparable contract BQ item and must be " +
            "agreed as star rates, supported by a quotation or rate build-up.");
    }
    if (rates.same > 0 && rates.different === 0 && rates.star === 0) {
        findings.push("All rates match the contract BQ. No rate adjustment required.");
    }
    if (Math.abs(assessed - claimed) >= 0.01) {
        findings.push(
            "Assessed value differs from the contractor's claim by " +
            rm(Math.abs(assessed - claimed)) +
            (assessed < claimed ? " (reduction)." : " (increase)."));
    }
    if (!clause) {
        findings.push(
            "The change could not be classified from the description. Enter a clearer " +
            "description so the governing contract clause can be identified.");
    }
    if ((vo.measurement || []).length === 0) {
        findings.push("No measurement has been entered, so no cost impact can be assessed.");
    }

    return {
        classification: classification,
        clause: clause,
        rates: rates,
        contractorTotal: claimed,
        assessedTotal: assessed,
        variance: assessed - claimed,
        findings: findings
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        RATE_TOLERANCE, checkRate, rateSummary, matchBqItem,
        classifyVariation, affectedWork, classificationBasis, analyse
    };
}
