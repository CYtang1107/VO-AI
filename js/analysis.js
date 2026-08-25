/* VO-AI | analysis.js
   Deterministic variation analysis: classification, contract clause lookup
   and the contract-BQ rate cross-check. No language model, no invented
   numbers — every output traces to data the user entered. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, contractorTotal, assessedTotal } = require("./calc.js");
    var { matchClause } = require("./clauses.js");
    var { detectElements, relatedElements } = require("./elements.js");
    var { t, joinList } = require("./i18n.js");
}

/* Every element in js/elements.js is translated by id through
   "element.<id>.name" / "element.<id>.note" — see js/i18n.js. */
function elementName(el) { return t("element." + el.id + ".name"); }
function elementNote(el) { return t("element." + el.id + ".note"); }

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
            basis: t("match.byCode", { code: codeItem.code }),
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

        let basis = t("match.byDescription", { overlap: overlap, total: rowWords.length });
        if (unitsMatch) basis += t("match.andUnit", { unit: item.unit });

        best = { item: item, basis: basis, score: score };
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
            label: t("rate.star.label"),
            detail: t("rate.star.detail")
        };
    }

    const contractRate = Number(item.rate) || 0;
    const diff = claimed - contractRate;
    const autoFields = auto
        ? { autoMatched: true, matchBasis: auto.basis, matchScore: auto.score, matchedItem: item }
        : {};
    const autoNote = auto ? t("rate.autoNote", { basis: auto.basis }) : "";

    if (Math.abs(diff) < RATE_TOLERANCE) {
        return Object.assign({
            state: "same",
            label: t("rate.same.label"),
            detail: t("rate.same.detail", {
                code: item.code, rate: rm(contractRate), unit: item.unit, autoNote: autoNote
            }),
            contractRate: contractRate,
            diff: 0
        }, autoFields);
    }

    const pct = contractRate === 0 ? null : (diff / contractRate) * 100;

    return Object.assign({
        state: "different",
        label: t("rate.different.label"),
        detail: t("rate.different.detail", {
            claimed: rm(claimed), code: item.code, rate: rm(contractRate), unit: item.unit,
            word: t(diff > 0 ? "rate.overstated" : "rate.understated"),
            diff: rm(Math.abs(diff)),
            pct: pct === null ? "" : " (" + Math.abs(pct).toFixed(1) + "%)",
            autoNote: autoNote
        }),
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
    return t("work." + (hit ? hit.name : "General Works"));
}

function classifyVariation(vo) {
    const text = (vo.description || "");
    const rows = vo.measurement || [];

    const label = (id, key) => ({
        id: id,
        label: t(key),
        affectedWork: affectedWork(text)
    });

    if (!text.trim() && rows.length === 0) {
        return label("unclassified", "classification.unclassified");
    }

    /* A substitution shows up as an omission and an addition together,
       or as explicit substitution wording. */
    const hasNegative = rows.some(r => (Number(r.qty) || 0) < 0);
    const hasPositive = rows.some(r => (Number(r.qty) || 0) > 0);

    if (/\bfrom\b.+\bto\b|substitut|replace|change of|upgrade/i.test(text) ||
        (hasNegative && hasPositive)) {
        return label("specification", "classification.specification");
    }

    if (/remeasure|remeasurement|quantity variation|approximate quantit|provisional quantit/i.test(text)) {
        return label("quantity", "classification.quantity");
    }

    if (/\bomit|omission|delete|remove\b/i.test(text) || (hasNegative && !hasPositive)) {
        return label("omission", "classification.omission");
    }

    if (/redesign|design revision|revised design|revision to/i.test(text)) {
        return label("design", "classification.design");
    }

    if (/additional|extra work|add\b|new\b/i.test(text) || hasPositive) {
        /* Extra quantity of an item already in the BQ is a remeasurement,
           not new work. */
        const allLinked = rows.length > 0 && rows.every(r => r.bqItemId);
        return allLinked
            ? label("quantity", "classification.quantity")
            : label("addition", "classification.addition");
    }

    return label("unclassified", "classification.unclassified");
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
    const vague = { signals: [], summary: t("basis.summary.vague") };

    if (!text.trim() && rows.length === 0) {
        return vague;
    }

    const hasNegative = rows.some(r => (Number(r.qty) || 0) < 0);
    const hasPositive = rows.some(r => (Number(r.qty) || 0) > 0);
    const allLinked = rows.length > 0 && rows.every(r => r.bqItemId);

    const wordingSubstitution = /\bfrom\b.+\bto\b|substitut|replace|change of|upgrade/i.test(text);
    if (wordingSubstitution || (hasNegative && hasPositive)) {
        const signals = [];
        if (wordingSubstitution) signals.push(t("basis.signal.wordingSubstitution"));
        if (hasNegative && hasPositive) signals.push(t("basis.signal.shapeOmissionAddition"));
        return { signals: signals,
                 summary: t("basis.summary.substitution", { signals: joinList(signals) }) };
    }

    const wordingQuantity = /remeasure|remeasurement|quantity variation|approximate quantit|provisional quantit/i.test(text);
    if (wordingQuantity) {
        return { signals: [t("basis.signal.wordingQuantity")],
                 summary: t("basis.summary.quantity") };
    }

    const wordingOmission = /\bomit|omission|delete|remove\b/i.test(text);
    if (wordingOmission || (hasNegative && !hasPositive)) {
        const signals = [];
        if (wordingOmission) signals.push(t("basis.signal.wordingOmission"));
        if (hasNegative && !hasPositive) signals.push(t("basis.signal.shapeNegativeOnly"));
        return { signals: signals,
                 summary: t("basis.summary.omission", { signals: joinList(signals) }) };
    }

    const wordingDesign = /redesign|design revision|revised design|revision to/i.test(text);
    if (wordingDesign) {
        return { signals: [t("basis.signal.wordingDesign")],
                 summary: t("basis.summary.design") };
    }

    const wordingAddition = /additional|extra work|add\b|new\b/i.test(text);
    if (wordingAddition || hasPositive) {
        const signals = [];
        if (wordingAddition) signals.push(t("basis.signal.wordingAddition"));
        if (hasPositive) signals.push(t("basis.signal.shapePositive"));
        if (allLinked) signals.push(t("basis.signal.shapeAllLinked"));
        const label = t(allLinked ? "basis.label.quantity" : "basis.label.addition");
        return { signals: signals,
                 summary: t("basis.summary.addition", { label: label, signals: joinList(signals) }) };
    }

    return vague;
}

/* -----------------------------------------------------------
   Full assessment
----------------------------------------------------------- */

/* -----------------------------------------------------------
   Element classification — which building element(s) the description
   names, and which other elements commonly need re-measurement
   alongside them (see js/elements.js). This is a prompt for the user
   to confirm, never an assertion that the related element actually
   changed — the system only knows what is common practice.
----------------------------------------------------------- */

function elementAnalysis(vo) {
    const text = (vo && vo.description) || "";
    const detected = detectElements(text);
    const detectedIds = detected.map(e => e.id);
    const related = relatedElements(detectedIds);
    return { detected: detected, related: related };
}

function analyse(vo, project) {
    const bq = (project && project.bq) || [];
    const classification = classifyVariation(vo);
    const clause = matchClause(classification.id);
    const rates = rateSummary(vo, bq);
    const elements = elementAnalysis(vo);

    const claimed = contractorTotal(vo);
    const assessed = assessedTotal(vo);

    const findings = [];

    if (rates.different > 0) {
        findings.push(t("analysis.finding.rateDifferent", { n: rates.different }));
    }
    if (rates.star > 0) {
        findings.push(t("analysis.finding.rateStar", { n: rates.star }));
    }
    if (rates.same > 0 && rates.different === 0 && rates.star === 0) {
        findings.push(t("analysis.finding.rateAllSame"));
    }
    if (Math.abs(assessed - claimed) >= 0.01) {
        findings.push(t("analysis.finding.assessedDiffers", {
            amount: rm(Math.abs(assessed - claimed)),
            word: t(assessed < claimed ? "analysis.reduction" : "analysis.increase")
        }));
    }
    if (!clause) {
        findings.push(t("analysis.finding.unclassified"));
    }
    if ((vo.measurement || []).length === 0) {
        findings.push(t("analysis.finding.noMeasurement"));
    }

    elements.detected.forEach(el => {
        const relatedForThis = elements.related.filter(r => r.because === el.id);
        if (relatedForThis.length === 0) return;
        const names = relatedForThis.map(r => elementName(r.element));
        const list = joinList(names);
        findings.push(t("analysis.finding.elementRelated", {
            element: elementName(el), related: list, note: elementNote(el)
        }));
    });

    return {
        classification: classification,
        clause: clause,
        rates: rates,
        contractorTotal: claimed,
        assessedTotal: assessed,
        variance: assessed - claimed,
        findings: findings,
        elements: elements
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        RATE_TOLERANCE, checkRate, rateSummary, matchBqItem,
        classifyVariation, affectedWork, classificationBasis, analyse,
        elementAnalysis
    };
}
