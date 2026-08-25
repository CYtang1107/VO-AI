const test = require("node:test");
const assert = require("node:assert");
const {
    classifyVariation, checkRate, rateSummary, analyse, classificationBasis
} = require("../js/analysis.js");

const bq = [
    { id: "BQ1", code: "B/4.1", description: "Ceramic floor tiles", unit: "m2", rate: 85 },
    { id: "BQ2", code: "B/4.2", description: "Skirting", unit: "m", rate: 22 }
];

/* ---------- rate cross-check: the consultant's core duty ---------- */

test("a rate equal to the contract BQ rate reads as the same rate", () => {
    const c = checkRate({ bqItemId: "BQ1", qty: 10, rate: 85 }, bq);
    assert.strictEqual(c.state, "same");
    assert.match(c.detail, /B\/4\.1/);
});

test("a rate within half a sen of the BQ rate still reads as the same rate", () => {
    const c = checkRate({ bqItemId: "BQ1", qty: 10, rate: 85.004 }, bq);
    assert.strictEqual(c.state, "same");
});

test("an overstated rate is flagged and names the governing rate", () => {
    const c = checkRate({ bqItemId: "BQ2", qty: 168, rate: 31 }, bq);
    assert.strictEqual(c.state, "different");
    assert.match(c.detail, /overstated/);
    assert.match(c.detail, /RM 9\.00/);
    assert.match(c.detail, /contract BQ rate governs/i);
    assert.strictEqual(c.contractRate, 22);
    assert.strictEqual(c.diff, 9);
});

test("an understated rate is flagged as understated", () => {
    const c = checkRate({ bqItemId: "BQ2", qty: 10, rate: 20 }, bq);
    assert.strictEqual(c.state, "different");
    assert.match(c.detail, /understated/);
});

test("a row with no BQ link is a star rate", () => {
    const c = checkRate({ bqItemId: null, qty: 320, rate: 265 }, bq);
    assert.strictEqual(c.state, "star");
    assert.match(c.detail, /star rate/i);
});

test("a row linked to a deleted BQ item is a star rate, not a crash", () => {
    const c = checkRate({ bqItemId: "BQ-GONE", qty: 1, rate: 5 }, bq);
    assert.strictEqual(c.state, "star");
});

test("rateSummary counts each state across the VO", () => {
    const vo = { measurement: [
        { bqItemId: "BQ1", qty: -320, rate: 85 },
        { bqItemId: null,  qty: 320,  rate: 265 },
        { bqItemId: "BQ2", qty: 168,  rate: 31 }
    ] };
    const s = rateSummary(vo, bq);
    assert.strictEqual(s.same, 1);
    assert.strictEqual(s.star, 1);
    assert.strictEqual(s.different, 1);
    assert.strictEqual(s.rows.length, 3);
});

/* ---------- classification ---------- */

test("a substitution is classified as a specification change", () => {
    const vo = { description: "Change floor finish from ceramic tile to marble tile",
                 measurement: [{ qty: -10, rate: 85 }, { qty: 10, rate: 265 }] };
    assert.strictEqual(classifyVariation(vo).id, "specification");
});

test("only-negative quantities are an omission", () => {
    const vo = { description: "Omit the rear canopy",
                 measurement: [{ qty: -10, rate: 85 }] };
    assert.strictEqual(classifyVariation(vo).id, "omission");
});

test("only-positive quantities on new items are an addition", () => {
    const vo = { description: "Additional external drainage works",
                 measurement: [{ qty: 142, rate: 62 }] };
    assert.strictEqual(classifyVariation(vo).id, "addition");
});

test("a remeasurement of an existing BQ item is a quantity variation", () => {
    const vo = { description: "Remeasurement of drainage pipe quantity",
                 measurement: [{ bqItemId: "BQ1", qty: 20, rate: 85 }] };
    assert.strictEqual(classifyVariation(vo).id, "quantity");
});

test("an empty VO is unclassified rather than guessed", () => {
    assert.strictEqual(classifyVariation({ description: "", measurement: [] }).id,
                       "unclassified");
});

/* ---------- full assessment ---------- */

test("analyse reports variance between claimed and assessed totals", () => {
    const project = { bq: bq };
    const vo = {
        description: "Change floor finish from ceramic tile to marble tile",
        measurement: [
            { bqItemId: "BQ2", qty: 100, rate: 31, assessedQty: 100, assessedRate: 22 }
        ]
    };
    const a = analyse(vo, project);
    assert.strictEqual(a.contractorTotal, 3100);
    assert.strictEqual(a.assessedTotal, 2200);
    assert.strictEqual(a.variance, -900);
    assert.ok(a.clause, "a governing clause should be identified");
    assert.strictEqual(a.rates.different, 1);
    assert.ok(a.findings.some(f => /different/i.test(f)));
});

test("analyse never invents a confidence score", () => {
    const a = analyse({ description: "x", measurement: [] }, { bq: [] });
    assert.strictEqual(a.confidence, undefined);
});

/* ---------- classification basis: no confidence score, just signals ---------- */

test("classificationBasis names both signals for a substitution", () => {
    const vo = { description: "Change floor finish from ceramic tile to marble tile",
                 measurement: [{ qty: -10, rate: 85 }, { qty: 10, rate: 265 }] };
    const b = classificationBasis(vo);
    assert.strictEqual(classifyVariation(vo).id, "specification");
    assert.ok(b.signals.some(s => /instruction wording/.test(s)));
    assert.ok(b.signals.some(s => /measurement shape.*omission and addition/.test(s)));
    assert.match(b.summary, /material \/ specification change/);
    assert.strictEqual(b.confidence, undefined);
});

test("classificationBasis reports measurement shape for an only-negative omission", () => {
    const vo = { description: "Omit the rear canopy",
                 measurement: [{ qty: -10, rate: 85 }] };
    const b = classificationBasis(vo);
    assert.strictEqual(classifyVariation(vo).id, "omission");
    assert.ok(b.signals.some(s => /instruction wording/.test(s)));
    assert.ok(b.signals.some(s => /measurement shape.*negative quantity only/.test(s)));
});

test("classificationBasis reports measurement shape alone for an all-linked remeasurement", () => {
    const vo = { description: "Extra quantity of drainage pipe as instructed",
                 measurement: [{ bqItemId: "BQ1", qty: 20, rate: 85 }] };
    const b = classificationBasis(vo);
    assert.strictEqual(classifyVariation(vo).id, "quantity");
    assert.ok(!b.signals.some(s => /instruction wording/.test(s)),
        "no wording signal should fire when no keyword matched");
    assert.ok(b.signals.some(s => /measurement shape.*positive quantity/.test(s)));
    assert.ok(b.signals.some(s => /measurement shape.*all rows linked/.test(s)));
});

test("classificationBasis returns no signals for an unclassifiable input", () => {
    const vo = { description: "Please review", measurement: [] };
    const b = classificationBasis(vo);
    assert.strictEqual(classifyVariation(vo).id, "unclassified");
    assert.deepStrictEqual(b.signals, []);
    assert.match(b.summary, /too vague/i);
});
