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
   Rate cross-check — template.xlsx, consultant sheet:
   "show similar rate / different rate, if different state which rate wrong"
----------------------------------------------------------- */

function checkRate(row, bq) {
    const claimed = Number(row.rate) || 0;
    const item = row.bqItemId
        ? (bq || []).find(b => b.id === row.bqItemId)
        : null;

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

    if (Math.abs(diff) < RATE_TOLERANCE) {
        return {
            state: "same",
            label: "Same rate",
            detail: "Matches contract BQ item " + item.code + " at " +
                    rm(contractRate) + " per " + item.unit + ".",
            contractRate: contractRate,
            diff: 0
        };
    }

    const pct = contractRate === 0 ? null : (diff / contractRate) * 100;

    return {
        state: "different",
        label: "Different rate",
        detail: "Contractor claimed " + rm(claimed) + " but contract BQ item " +
                item.code + " is " + rm(contractRate) + " per " + item.unit + ". " +
                "The contract BQ rate governs — the contractor's rate is " +
                (diff > 0 ? "overstated" : "understated") + " by " + rm(Math.abs(diff)) +
                (pct === null ? "" : " (" + Math.abs(pct).toFixed(1) + "%)") + ".",
        contractRate: contractRate,
        diff: diff,
        pct: pct
    };
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
        RATE_TOLERANCE, checkRate, rateSummary,
        classifyVariation, affectedWork, analyse
    };
}
