const test = require("node:test");
const assert = require("node:assert");
const {
    classifyVariation, checkRate, rateSummary, analyse, classificationBasis, matchBqItem
} = require("../js/analysis.js");
const { seedDB } = require("../js/store.js");

const bq = [
    { id: "BQ1", code: "B/4.1", description: "Ceramic floor tiles", unit: "m2", rate: 85 },
    { id: "BQ2", code: "B/4.2", description: "Skirting", unit: "m", rate: 22 }
];

const seededBq = seedDB().projects[0].bq;
/* [
     BQ1 B/4.1  "Ceramic floor tiles 600x600mm to living area"  m2   85
     BQ2 B/4.2  "Skirting to match floor finish"                m    22
     BQ3 B/5.1  "Plaster and paint to internal walls"           m2   34
     BQ4 C/2.3  "Timber flush door 900x2100mm with ironmongery" no   640
     BQ5 D/1.2  "100mm dia uPVC drainage pipe laid in trench"   m    48
     BQ6 E/3.1  "Suspended plasterboard ceiling incl. framing"  m2   76
   ] */

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

/* ---------- automatic BQ matching ---------- */

test("a BQ code found in the description is a definitive match", () => {
    const m = matchBqItem({ description: "Additional B/4.1 ceramic tiles to balcony",
                             unit: "m2" }, seededBq);
    assert.ok(m, "expected a match");
    assert.strictEqual(m.item.id, "BQ1");
    assert.match(m.basis, /matched BQ code B\/4\.1/);
    assert.strictEqual(m.score, 1);
});

test("a close description match with the same unit succeeds", () => {
    const m = matchBqItem({ description: "Additional skirting to match floor finish",
                             unit: "m" }, seededBq);
    assert.ok(m, "expected a match");
    assert.strictEqual(m.item.id, "BQ2");
    assert.match(m.basis, /matched on description \(4 of 5 significant words\)/);
    assert.match(m.basis, /unit m/);
});

test("the same description with a conflicting unit does not match", () => {
    const m = matchBqItem({ description: "Additional skirting to match floor finish",
                             unit: "no" }, seededBq);
    assert.strictEqual(m, null);
});

test("an unrelated description returns null rather than a weak guess", () => {
    const m = matchBqItem({ description: "Precast concrete sump 600x600mm with cover",
                             unit: "no" }, seededBq);
    assert.strictEqual(m, null);
});

test("a strong word overlap that is really a different, separately-priced item declines to match", () => {
    /* The seeded VO-001 M2 row: marble tiles replacing the BQ's ceramic
       tiles. Five of the row's seven significant words (floor, tiles,
       600x600mm, living, area) are shared with BQ1's ceramic-tile
       description and the unit matches too — but "marble" is not
       "ceramic": these are different, separately negotiated items, and
       an automatic match here would silently compare the marble rate
       against the ceramic contract rate. Must return null. */
    const m = matchBqItem({ description: "Add marble floor tiles 600x600mm to living area",
                             unit: "m2" }, seededBq);
    assert.strictEqual(m, null);
});

test("a row already linked to a BQ item is unaffected by the matcher", () => {
    /* Description text overlaps strongly with BQ2 (skirting), but the
       row is explicitly linked to BQ1 — the link must win, and no
       auto-match should be attempted at all. */
    const c = checkRate({ bqItemId: "BQ1", description: "Additional skirting to match floor finish",
                           unit: "m", rate: 22 }, seededBq);
    assert.strictEqual(c.state, "different");
    assert.strictEqual(c.contractRate, 85);
    assert.strictEqual(c.autoMatched, undefined);
});

test("an auto-matched row with a rate equal to the matched item's is a same-rate verdict, marked auto-matched", () => {
    const c = checkRate({ bqItemId: null, description: "Additional skirting to match floor finish",
                           unit: "m", rate: 22 }, seededBq);
    assert.strictEqual(c.state, "same");
    assert.strictEqual(c.autoMatched, true);
    assert.strictEqual(c.matchedItem.id, "BQ2");
    assert.match(c.matchBasis, /matched on description/);
});

test("an auto-matched row with a different rate is a different-rate verdict, marked auto-matched", () => {
    const c = checkRate({ bqItemId: null, description: "Additional skirting to match floor finish",
                           unit: "m", rate: 31 }, seededBq);
    assert.strictEqual(c.state, "different");
    assert.strictEqual(c.autoMatched, true);
    assert.strictEqual(c.contractRate, 22);
    assert.match(c.detail, /Automatically matched/);
});

test("no comparable BQ item still returns the unchanged star verdict", () => {
    const c = checkRate({ bqItemId: null, description: "Precast concrete sump 600x600mm with cover",
                           unit: "no", rate: 1250 }, seededBq);
    assert.strictEqual(c.state, "star");
    assert.strictEqual(c.autoMatched, undefined);
    assert.match(c.detail, /star rate/i);
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

/* ---------- elements section: additive, must not disturb existing fields ---------- */

test("analyse includes an elements section without disturbing its existing fields", () => {
    const project = { bq: bq };
    const vo = {
        description: "Change floor finish from ceramic tile to marble tile",
        measurement: [
            { bqItemId: "BQ2", qty: 100, rate: 31, assessedQty: 100, assessedRate: 22 }
        ]
    };
    const a = analyse(vo, project);

    /* Existing fields, unchanged. */
    assert.strictEqual(a.contractorTotal, 3100);
    assert.strictEqual(a.assessedTotal, 2200);
    assert.strictEqual(a.variance, -900);
    assert.ok(a.clause);
    assert.strictEqual(a.rates.different, 1);
    assert.ok(a.classification);

    /* New elements section. */
    assert.ok(a.elements, "expected an elements section");
    assert.ok(a.elements.detected.some(e => e.id === "floor-finishes"));
    assert.ok(a.elements.related.some(r => r.element.id === "skirting"));
});

test("analyse prompts for related elements as a finding, worded as a prompt not an assertion", () => {
    const a = analyse({ description: "Change block wall to brick wall", measurement: [] },
                       { bq: [] });
    const elementFinding = a.findings.find(f => /affects the Wall/.test(f));
    assert.ok(elementFinding, "expected a finding naming the wall element");
    assert.match(elementFinding, /Confirm whether/);
    assert.doesNotMatch(elementFinding, /\bare affected\b/i);
});

test("analyse with no element named in the description adds no element finding", () => {
    const a = analyse({ description: "Extend the working hours for the site office.",
                         measurement: [] }, { bq: [] });
    assert.deepStrictEqual(a.elements.detected, []);
    assert.ok(!a.findings.some(f => /affects the/.test(f)));
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
