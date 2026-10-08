/* VO-AI | analysis.js
   Deterministic variation analysis: classification, contract clause lookup
   and the contract-BQ rate cross-check. No language model, no invented
   numbers — every output traces to data the user entered. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { contractAnalysis } = require("./contractread.js");
    var { rm, contractorTotal, assessedTotal } = require("./calc.js");
    var { matchClause } = require("./clauses.js");
    var { detectElements, relatedElements } = require("./elements.js");
    var { t, joinList } = require("./i18n.js");
    var { photoLocations } = require("./sitemap.js");
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
   Which BQ item is a described change about? — for the AI Analysis
   form, which used to make the user pick the original BQ item by hand.
   A description names more than the item ("change internal partition
   from plastered wall to brick wall"), so this measures how much of
   each BQ item's description the text covers, not the other way
   round. Word endings are folded (walls/wall, plastered/plaster), and
   common Chinese site words map to the English the BQ is written in.
   Returns { item, matched: [words], score } or null — never a guess
   below the bar.
----------------------------------------------------------- */

const BQ_ZH_WORDS = [
    ["地砖", "floor tile"], ["瓷砖", "ceramic tile"], ["大理石", "marble"], ["花岗岩", "granite"],
    ["踢脚线", "skirting"], ["踢脚", "skirting"], ["地面", "floor"], ["地板", "floor"],
    ["批荡", "plaster"], ["抹灰", "plaster"], ["油漆", "paint"], ["涂料", "paint"], ["内墙", "internal wall"],
    ["外墙", "external wall"], ["墙", "wall"], ["客厅", "living area"], ["门", "door"], ["门框", "door frame"],
    ["五金", "ironmongery"], ["排水管", "drainage pipe"], ["排水", "drainage"], ["水管", "pipe"],
    ["集水井", "sump"], ["沙井", "manhole"], ["天花", "ceiling"], ["吊顶", "suspended ceiling"],
    ["石膏板", "plasterboard"], ["木", "timber"], ["混凝土", "concrete"], ["窗", "window"]
];

function foldWord(w) {
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
}

function changeWords(text) {
    let english = String(text || "");
    BQ_ZH_WORDS.forEach(([zh, en]) => { if (english.indexOf(zh) !== -1) english += " " + en; });
    return new Set(significantWords(english).map(foldWord));
}

function suggestBqForChange(text, bq) {
    const list = bq || [];
    const code = findCodeMatch(text, list);
    if (code) return { item: code, matched: [code.code], score: 1 };
    const words = changeWords(text);
    if (words.size === 0) return null;
    const itemWordsOf = item => Array.from(new Set(significantWords(item.description).map(foldWord)))
        .filter(w => !/^\d/.test(w) && w.length > 2);   /* sizes and "in"/"to" never decide it */
    /* the BQ's own words that matched, as the BQ spells them */
    const shown = (item, folded) => significantWords(item.description).filter(w => folded.indexOf(foldWord(w)) !== -1);

    let best = null;
    list.forEach(item => {
        const itemWords = itemWordsOf(item);
        if (itemWords.length === 0) return;
        const matched = itemWords.filter(w => words.has(w));
        const score = matched.length / itemWords.length;
        if (matched.length < 2 || score < 0.3) return;
        if (!best || score > best.score || (score === best.score && matched.length > best.matched.length)) {
            best = { item: item, matched: shown(item, matched), score: score };
        }
    });
    if (best) return best;

    /* One word is enough only when no other BQ item uses it ("door"
       when the bill has one door item) — and it is marked as weaker. */
    const counts = {};
    list.forEach(item => itemWordsOf(item).forEach(w => { counts[w] = (counts[w] || 0) + 1; }));
    const generic = new Set(["finish", "work", "area", "internal", "external", "match", "new", "item"]);
    const single = list.map(item => ({ item: item, hit: itemWordsOf(item).filter(w => words.has(w) && counts[w] === 1 && w.length >= 4 && !generic.has(w)) }))
        .filter(x => x.hit.length === 1);
    return single.length === 1
        ? { item: single[0].item, matched: shown(single[0].item, single[0].hit), score: 0.2, weak: true }
        : null;
}

/* -----------------------------------------------------------
   Rate cross-check — template.xlsx, consultant sheet:
   "show similar rate / different rate, if different state which rate wrong"
----------------------------------------------------------- */

/* Does the description say what the work is? At least one real word:
   three or more letters with a vowel and not one letter repeated
   ("vvv", "xxx" fail), or two or more Chinese characters. */
function describesWork(description) {
    const text = String(description || "");
    if (/[\u4e00-\u9fff]{2,}/.test(text)) return true;
    return (text.toLowerCase().match(/[a-z]+/g) || []).some(w =>
        w.length >= 3 && /[aeiouy]/.test(w) && !/^(.)\1+$/.test(w));
}

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
        /* A star rate is a priced item the bill has nothing comparable
           for. A row that does not say what it is ("vvv", "x") cannot be
           checked at all, and a row with no rate has nothing to agree —
           neither is a star rate, and calling them one would send the
           QS to negotiate a rate that does not exist. */
        if (!row.bqItemId && !describesWork(row.description)) {
            return { state: "unchecked", label: t("rate.unchecked.label"), detail: t("rate.unchecked.detail") };
        }
        if (!row.bqItemId && !(claimed > 0)) {
            return { state: "norate", label: t("rate.norate.label"), detail: t("rate.norate.detail") };
        }
        return {
            state: "star",
            label: t("rate.star.label"),
            detail: t("rate.star.detail")
        };
    }

    if (!(claimed !== 0)) {
        /* matched to a BQ item, but nothing claimed yet */
        return Object.assign({
            state: "norate",
            label: t("rate.norate.label"),
            detail: t("rate.norate.detailItem", {
                code: item.code, rate: rm(Number(item.rate) || 0), unit: item.unit,
                autoNote: auto ? t("rate.autoNote", { basis: auto.basis }) : ""
            })
        }, auto ? { autoMatched: true, matchBasis: auto.basis, matchScore: auto.score, matchedItem: item } : {});
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
            pct: pct === null ? "" : t("rate.pctNote", { pct: Math.abs(pct).toFixed(1) }),
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
        star: rows.filter(r => r.check.state === "star").length,
        unchecked: rows.filter(r => r.check.state === "unchecked").length,
        norate: rows.filter(r => r.check.state === "norate").length
    };
}

/* -----------------------------------------------------------
   Classification — keyword and measurement-shape rules.
   Order matters: the most specific signal wins.
----------------------------------------------------------- */

const WORK_SECTIONS = [
    { key: /tile|marble|finish|skirting|floor|paint|plaster|瓷砖|地砖|大理石|饰面|踢脚|地板|地面|油漆|涂料|批荡|抹灰/i, name: "Finishes" },
    { key: /drain|sewer|pipe|sump|manhole|排水|污水|管道|水管|集水井|沙井|水沟/i,                         name: "External Works & Drainage" },
    { key: /ceiling|cornice|cove|天花|吊顶|天棚/i,                                                      name: "Ceilings" },
    { key: /door|window|ironmonger|glaz|门|窗|五金|玻璃/i,                                              name: "Doors & Windows" },
    { key: /concrete|rebar|beam|column|slab|structur|混凝土|钢筋|楼板|结构|横梁|柱子/i,                   name: "Structural Works" },
    { key: /electric|wiring|light|socket|db\b|电线|线路|灯|插座|配电|电力/i,                            name: "Electrical Services" },
    { key: /plumb|sanitary|water|toilet|水喉|卫浴|洁具|厕所|马桶|给水/i,                                  name: "Plumbing & Sanitary" }
];

/* The wording that signals each kind of change, in English and in
   Chinese (a contractor recording on site may well write 「客厅地砖由瓷砖
   改为大理石」). Shared by classifyVariation and classificationBasis so
   the two can never disagree. */
const WORDING = {
    substitution: /\bfrom\b.+\bto\b|substitut|replace|change of|upgrade|由.+改为|改为|改成|换成|替换|更换|代替|升级/i,
    quantity: /remeasure|remeasurement|quantity variation|approximate quantit|provisional quantit|重新计量|重新测量|数量变更|暂定数量|估计数量/i,
    omission: /\bomit|omission|delete|remove\b|删除|删减|取消|拆除|省略|减少/i,
    design: /redesign|design revision|revised design|revision to|重新设计|设计修改|设计变更|修改设计|修订设计/i,
    addition: /additional|extra work|add\b|new\b|增加|新增|追加|额外|加建|加装|加设|加一/i
};

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

    if (WORDING.substitution.test(text) ||
        (hasNegative && hasPositive)) {
        return label("specification", "classification.specification");
    }

    if (WORDING.quantity.test(text)) {
        return label("quantity", "classification.quantity");
    }

    if (WORDING.omission.test(text) || (hasNegative && !hasPositive)) {
        return label("omission", "classification.omission");
    }

    if (WORDING.design.test(text)) {
        return label("design", "classification.design");
    }

    if (WORDING.addition.test(text) || hasPositive) {
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

    const wordingSubstitution = WORDING.substitution.test(text);
    if (wordingSubstitution || (hasNegative && hasPositive)) {
        const signals = [];
        if (wordingSubstitution) signals.push(t("basis.signal.wordingSubstitution"));
        if (hasNegative && hasPositive) signals.push(t("basis.signal.shapeOmissionAddition"));
        return { signals: signals,
                 summary: t("basis.summary.substitution", { signals: joinList(signals) }) };
    }

    const wordingQuantity = WORDING.quantity.test(text);
    if (wordingQuantity) {
        return { signals: [t("basis.signal.wordingQuantity")],
                 summary: t("basis.summary.quantity") };
    }

    const wordingOmission = WORDING.omission.test(text);
    if (wordingOmission || (hasNegative && !hasPositive)) {
        const signals = [];
        if (wordingOmission) signals.push(t("basis.signal.wordingOmission"));
        if (hasNegative && !hasPositive) signals.push(t("basis.signal.shapeNegativeOnly"));
        return { signals: signals,
                 summary: t("basis.summary.omission", { signals: joinList(signals) }) };
    }

    const wordingDesign = WORDING.design.test(text);
    if (wordingDesign) {
        return { signals: [t("basis.signal.wordingDesign")],
                 summary: t("basis.summary.design") };
    }

    const wordingAddition = WORDING.addition.test(text);
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
    /* the project's own contract, when one has been uploaded and read
       (js/contractread.js); the bundled `clause` stays as the
       standard-form reference */
    const contract = typeof contractAnalysis === "function" ? contractAnalysis(vo, project) : null;

    const claimed = contractorTotal(vo);
    const assessed = assessedTotal(vo);

    const findings = [];

    if (rates.different > 0) {
        findings.push(t("analysis.finding.rateDifferent", { n: rates.different }));
    }
    if (rates.star > 0) {
        findings.push(t("analysis.finding.rateStar", { n: rates.star }));
    }
    if (rates.unchecked > 0) {
        findings.push(t("analysis.finding.rateUnchecked", { n: rates.unchecked }));
    }
    if (rates.norate > 0) {
        findings.push(t("analysis.finding.rateNoRate", { n: rates.norate }));
    }
    if (rates.same > 0 && rates.different === 0 && rates.star === 0 && rates.unchecked === 0 && rates.norate === 0) {
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
    if (contract && contract.state === "read") {
        const valuation = contract.topics.find(tp => tp.id === "valuation" && tp.clause);
        if (valuation && (rates.star > 0 || rates.different > 0)) {
            findings.push(t("analysis.finding.contractValuation", { no: valuation.clause.no, doc: valuation.clause.docName }));
        }
        const notice = contract.topics.find(tp => tp.id === "notice" && tp.clause);
        if (notice && Number(vo.timeImpact) > 0) {
            findings.push(t("analysis.finding.contractNotice", { no: notice.clause.no }));
        }
    } else if (contract && contract.state === "none") {
        findings.push(t("analysis.finding.contractNone"));
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

    /* site photos taken away from the project's site (js/sitemap.js) */
    const offSite = typeof photoLocations === "function"
        ? photoLocations(project, vo).filter(r => r.verdict === "offSite") : [];
    if (offSite.length) {
        findings.push(t("analysis.finding.photoOffSite", {
            n: offSite.length, names: joinList(offSite.map(r => r.name)),
            m: Math.max.apply(null, offSite.map(r => r.metres))
        }));
    }

    return {
        classification: classification,
        clause: clause,
        contract: contract,
        rates: rates,
        contractorTotal: claimed,
        assessedTotal: assessed,
        variance: assessed - claimed,
        findings: findings,
        elements: elements
    };
}

/* ---------- the instruction's items, matched to the BQ ----------
   The architect's instruction (the VO's description) names the work:
   "new doorway with timber flush door, cement sand screed to floor,
   plaster and paint to walls, and a new uPVC drainage pipe…". Each part
   becomes a measurement row: matched to the contract BQ item it names
   (its unit and rate with it), or, when the BQ has none, kept as a
   star-rate row when `isWork` says it is work that can be priced (the
   built-up rate's recipes). Parts that are neither (who instructed it,
   why) are left out. Chinese wording is read through a small glossary
   of construction terms, so it matches an English BQ too. */
var INSTRUCTION_GLOSSARY = [
    [/瓷砖|地砖/, "ceramic floor tiles"], [/大理石/, "marble"], [/踢脚/, "skirting"],
    [/批荡|抹灰|粉刷/, "plaster"], [/油漆|涂料|刷漆|喷漆/, "paint"], [/内墙/, "internal walls"], [/外墙/, "external walls"], [/墙/, "walls"],
    [/平板门/, "flush door"], [/实木|木/, "timber"], [/门/, "door"], [/五金/, "ironmongery"],
    [/排水管/, "drainage pipe"], [/排水/, "drainage"], [/管/, "pipe"], [/沟槽|沟/, "trench"],
    [/吊顶|天花/, "suspended ceiling"], [/石膏板/, "plasterboard"], [/龙骨/, "framing"],
    [/集水井|沙井/, "sump"], [/混凝土/, "concrete"], [/钢筋/, "reinforcement"], [/开挖|挖/, "excavation"],
    [/找平|水泥砂浆/, "cement sand screed"], [/地面|地板|楼面/, "floor"], [/客厅/, "living area"], [/窗/, "window"]
];

var INSTRUCTION_SMALL_WORDS = new Set(["in", "on", "at", "a", "an", "for", "by", "from", "into", "per", "as", "new", "existing", "all", "one", "two", "additional"]);

function instructionWords(text) {
    const extra = INSTRUCTION_GLOSSARY.filter(g => g[0].test(text || "")).map(g => g[1]).join(" ");
    /* "laid" and "lay", "walls" and "wall": compared on their first four letters */
    return Array.from(new Set(significantWords((text || "") + " " + extra)
        .filter(w => !INSTRUCTION_SMALL_WORDS.has(w)).map(w => w.length > 4 ? w.slice(0, 4) : w)));
}

function instructionParts(text) {
    /* a mix ratio ("1:3") is not where the list breaks */
    const parts = String(text || "").replace(/(\d)\s*[:：]\s*(?=\d)/g, "$1\u0001").split(/[,，;；。:：、\n]+/)
        .map(p => p.replace(/\u0001/g, ":"))
        .map(p => p.trim()
            .replace(/^(and|also|then|plus|with)\s+/i, "")
            .replace(/^(a|an|the)\s+/i, "")
            .replace(/^(并|及|和|另|再|然后|以及)\s*/, "")
            .replace(/[.。]+$/, "").trim())
        .filter(Boolean);
    /* a fragment too short to stand alone ("油漆" in "内墙批荡、油漆") stays
       with the item before it */
    const weight = p => (p.match(/[一-鿿]/g) || []).length + 2 * (p.match(/[A-Za-z0-9]{3,}/g) || []).length;
    const out = [];
    parts.forEach(p => {
        if (out.length && weight(p) < 4) out[out.length - 1] += (/[一-鿿]/.test(p) ? "、" : ", ") + p;
        else out.push(p);
    });
    return out.filter(p => p.length >= 3);
}

/* The BQ item a part of the instruction names, or null. `used`: item
   ids already taken by other parts. */
function matchInstructionItem(part, bq, used) {
    const words = new Set(instructionWords(part));
    let best = null;
    (bq || []).forEach(item => {
        if (used && used.has(item.id)) return;
        const cand = instructionWords(item.description);
        if (!cand.length) return;
        const overlap = cand.filter(w => words.has(w)).length;
        const score = overlap / cand.length;
        /* most of the BQ item's own words are in the part */
        if (overlap >= 3 ? score < 0.4 : overlap < 2 || score < 0.5) return;
        if (!best || score > best.score) best = { item: item, score: score };
    });
    return best ? best.item : null;
}

/* A row described in a word or two ("油漆", "paint", "skirting"): the BQ
   item that has every one of its words, the one in the row's unit first,
   then the plainest (fewest words). Null when the row says more, or no
   item has them all. */
var KEYWORD_PLACES = new Set(["wall", "floo", "ceil", "area", "room", "livi", "inte", "exte", "side", "edge"]);

function keywordBqItem(text, bq, unit) {
    const own = instructionWords(text).filter(w => /^[a-z0-9]+$/.test(w) && !/^\d/.test(w));
    /* where ("wall", "floor") is not what: a row has to name the work */
    if (!own.length || own.length > 3 || own.every(w => KEYWORD_PLACES.has(w))) return null;
    /* every word of the row is one of the item's: nothing it says goes unmatched */
    if (significantWords(String(text || "").replace(/[一-鿿]+/g, " ")).filter(w => !/^\d/.test(w) && !INSTRUCTION_SMALL_WORDS.has(w)).length > own.length) return null;
    const u = x => String(x || "").toLowerCase().replace("²", "2").replace("³", "3").trim();
    const hits = (bq || []).map(item => ({ item: item, words: instructionWords(item.description) }))
        .filter(h => own.every(w => h.words.indexOf(w) !== -1));
    if (!hits.length) return null;
    hits.sort((a, b) => (u(b.item.unit) === u(unit)) - (u(a.item.unit) === u(unit)) || a.words.length - b.words.length);
    return hits[0].item;
}

function instructionItems(text, bq, isWork) {
    const used = new Set();
    const items = [];
    instructionParts(text).forEach(part => {
        const hit = matchInstructionItem(part, bq, used);
        if (hit) { used.add(hit.id); items.push({ description: part.charAt(0).toUpperCase() + part.slice(1), bqItem: hit }); }
        /* who instructed it and why ("as instructed by the Architect…")
           is the instruction's preamble, not an item of work */
        else if (!/instruct|as per|according to|指示|依照|根据|按照/i.test(part) && typeof isWork === "function" && isWork(part)) items.push({ description: part.charAt(0).toUpperCase() + part.slice(1), bqItem: null });
    });
    return items;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        RATE_TOLERANCE, checkRate, rateSummary, matchBqItem, suggestBqForChange, describesWork,
        classifyVariation, affectedWork, classificationBasis, analyse,
        elementAnalysis, instructionItems, instructionParts, matchInstructionItem, keywordBqItem
    };
}
