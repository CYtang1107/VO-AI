const test = require("node:test");
const assert = require("node:assert");
const {
    bqOptions, renderOriginalItemField, buildSyntheticVO, computeCosts,
    renderAssessmentResult
} = require("../js/page-analysis.js");
const { analyse, classificationBasis } = require("../js/analysis.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];
const ceramicTiles = project.bq.find(b => b.id === "BQ1"); /* B/4.1, RM 85/m2 */

/* ---------- original-item picker ---------- */

test("bqOptions lists each BQ item as code, description and rate", () => {
    const html = bqOptions(project, "");
    assert.match(html, /B\/4\.1 · Ceramic floor tiles 600x600mm to living area · RM 85\.00\/m2/);
});

test("renderOriginalItemField shows an explanatory empty state with no BQ items", () => {
    const html = renderOriginalItemField({ bq: [] }, "");
    assert.match(html, /empty-state/);
    assert.ok(!/<select/.test(html), "no dropdown should render with no BQ items");
    assert.match(html, /no priced BQ items/i);
});

test("renderOriginalItemField renders a select when BQ items exist", () => {
    const html = renderOriginalItemField(project, "BQ1");
    assert.match(html, /<select id="vaOriginalItem">/);
    assert.match(html, /<option value="BQ1" selected>/);
});

/* ---------- synthetic VO construction ---------- */

test("buildSyntheticVO produces an omission row and an addition row", () => {
    const vo = buildSyntheticVO(ceramicTiles, {
        description: "Change of living area floor finish from ceramic tile to marble tile",
        typeOfInstruction: "Architect's Instruction (AI)",
        revisedDescription: "Marble floor tiles",
        qty: 320,
        revisedRate: 265
    });
    assert.strictEqual(vo.measurement.length, 2);

    const [omit, add] = vo.measurement;
    assert.strictEqual(omit.bqItemId, "BQ1");
    assert.strictEqual(omit.description, "Omit Ceramic floor tiles 600x600mm to living area");
    assert.strictEqual(omit.unit, "m2");
    assert.strictEqual(omit.qty, -320);
    assert.strictEqual(omit.rate, 85);

    assert.strictEqual(add.bqItemId, null);
    assert.strictEqual(add.description, "Marble floor tiles");
    assert.strictEqual(add.unit, "m2");
    assert.strictEqual(add.qty, 320);
    assert.strictEqual(add.rate, 265);
});

/* ---------- cost computation ---------- */

test("computeCosts reproduces the team's demonstration case: RM 57,600.00 additional cost", () => {
    const costs = computeCosts(ceramicTiles, 320, 265);
    assert.strictEqual(costs.originalCost, 27200);
    assert.strictEqual(costs.revisedCost, 84800);
    assert.strictEqual(costs.additionalCost, 57600);
    assert.ok(Math.abs(costs.pct - 211.76470588235293) < 1e-9);
});

test("computeCosts omits the percentage change when the original rate is zero", () => {
    const costs = computeCosts({ rate: 0 }, 10, 100);
    assert.strictEqual(costs.pct, null);
});

test("changing the quantity changes the cost figures", () => {
    const a = computeCosts(ceramicTiles, 320, 265);
    const b = computeCosts(ceramicTiles, 600, 265);
    assert.notStrictEqual(a.additionalCost, b.additionalCost);
    assert.strictEqual(b.additionalCost, 600 * (265 - 85));
});

/* ---------- full result render: honesty requirement ---------- */

function demoResult(role) {
    const vo = buildSyntheticVO(ceramicTiles, {
        description: "Change of living area floor finish from ceramic tile to marble tile",
        typeOfInstruction: "Architect's Instruction (AI)",
        revisedDescription: "Marble floor tiles",
        qty: 320,
        revisedRate: 265
    });
    const a = analyse(vo, project);
    const basis = classificationBasis(vo);
    const costs = computeCosts(ceramicTiles, 320, 265);
    return renderAssessmentResult(a, basis, costs, role === "contractor");
}

test("the result names the real classification and a real PAM 2018 clause, not 'Clause 13.1'", () => {
    const html = demoResult("consultant");
    assert.match(html, /Material \/ specification change/);
    assert.match(html, /PAM 2018/);
    assert.ok(!/Clause 13\.1/.test(html), "Clause 13.1 does not exist in this system");
});

test("the result shows the additional cost computed from the inputs", () => {
    const html = demoResult("consultant");
    assert.match(html, /RM 57,600\.00/);
});

test("the result shows one same-rate and one star-rate verdict for the demo case", () => {
    const html = demoResult("consultant");
    assert.match(html, /rate-flag same/);
    assert.match(html, /rate-flag star/);
});

test("the result never renders a confidence percentage or score", () => {
    const html = demoResult("consultant");
    assert.ok(!/confidence/i.test(html), "no confidence wording should appear");
    assert.ok(!/94%/.test(html), "the fabricated 94% must never appear");
});

test("the result shows the basis for classification, naming the real signals used", () => {
    const html = demoResult("consultant");
    assert.match(html, /Basis for classification/);
    assert.match(html, /instruction wording/i);
});

test("a null clause is explained in words, with no clause fields rendered", () => {
    const vo = { description: "Please review", measurement: [] };
    const a = analyse(vo, { bq: [] });
    const basis = classificationBasis(vo);
    const html = renderAssessmentResult(a, basis, { originalCost: 0, revisedCost: 0,
        additionalCost: 0, pct: null }, false);
    assert.ok(!a.clause, "sanity: this input should not classify");
    assert.match(html, /too vague to classify|could not be classified/i);
    assert.ok(!/Governing clause/.test(html));
});

/* ---------- automatic BQ match on the revised item ---------- */

test("a revised item whose description strongly matches another BQ item shows the suggested match", () => {
    const vo = buildSyntheticVO(ceramicTiles, {
        description: "Additional skirting works",
        typeOfInstruction: "Architect's Instruction (AI)",
        revisedDescription: "Additional skirting to match floor finish",
        qty: 10,
        revisedRate: 22
    });
    /* Override the synthetic addition row's unit so it matches BQ2 (m),
       not the omitted item's unit (m2) — the analysis screen always
       carries the original item's unit onto both synthetic rows, but
       this test is specifically about the revised item finding its
       OWN comparable BQ item by description, independent of that. */
    vo.measurement[1].unit = "m";
    const a = analyse(vo, project);
    const basis = classificationBasis(vo);
    const costs = computeCosts(ceramicTiles, 10, 22);
    const html = renderAssessmentResult(a, basis, costs, false);
    assert.match(html, /rate-flag auto-match/);
    assert.match(html, /Suggested match/);
    assert.match(html, /B\/4\.2/);
    assert.match(html, /matched on description/);
});

test("a revised item with no comparable BQ item shows no suggested match", () => {
    const html = demoResult("consultant"); /* revised item: "Marble floor tiles" */
    assert.ok(!/rate-flag auto-match/.test(html),
        "marble tiles must not auto-match the ceramic BQ item");
});

/* ---------- role gating on the create-VO button ---------- */

test("a contractor gets a Create-VO button in the result", () => {
    assert.match(demoResult("contractor"), /id="createVoBtn"/);
});

test("a consultant does not get a Create-VO button", () => {
    assert.ok(!/id="createVoBtn"/.test(demoResult("consultant")));
});

test("a client does not get a Create-VO button", () => {
    assert.ok(!/id="createVoBtn"/.test(demoResult("client")));
});
