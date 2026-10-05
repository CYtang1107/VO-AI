const test = require("node:test");
const assert = require("node:assert");
const { PAST_PROJECTS, pastRateSources, pastRateScore, suggestPastRate, newBqItemFromRow, sizeTokens } =
    require("../js/ratehistory.js");
const { seedDB } = require("../js/store.js");
const { checkRate } = require("../js/analysis.js");

const db = seedDB();
const project = db.projects[0];
const sources = pastRateSources(db, project.id);
const vo1 = project.vos[0], vo2 = project.vos[1];
const marbleRow = vo1.measurement.find(r => r.id === "M2");
const sumpRow = vo2.measurement.find(r => r.id === "M5");

test("the demo's two star-rated rows really have no BQ item, so past rates are what's left", () => {
    assert.strictEqual(checkRate(marbleRow, project.bq).state, "star");
    assert.strictEqual(checkRate(sumpRow, project.bq).state, "star");
});

test("every past project in the sample library is marked as demo data", () => {
    const sample = sources.filter(s => s.sample);
    assert.strictEqual(sample.length, PAST_PROJECTS.reduce((n, p) => n + p.rates.length, 0));
});

test("the marble row gets the three past marble rates and their median", () => {
    const s = suggestPastRate(marbleRow, sources);
    assert.strictEqual(s.count, 3);
    assert.deepStrictEqual(s.matches.map(m => m.rate).sort(), [228, 235, 255]);
    assert.strictEqual(s.rate, 235);
    assert.strictEqual(s.low, 228);
    assert.strictEqual(s.high, 255);
});

test("the sump row gets 600x600 sumps only, never the 450x450 one", () => {
    const s = suggestPastRate(sumpRow, sources);
    assert.deepStrictEqual(s.matches.map(m => m.rate).sort((a, b) => a - b), [1020, 1080, 1180]);
    assert.strictEqual(s.rate, 1080);
    assert.ok(s.matches.every(m => sizeTokens(m.description).includes("600x600")));
});

test("a different material is no evidence, however many words it shares", () => {
    const s = suggestPastRate({ description: "Ceramic floor tiles 600x600mm", unit: "m2" }, sources);
    assert.deepStrictEqual(s.matches.map(m => m.description), ["Ceramic floor tiles 600x600mm"]);
    assert.strictEqual(pastRateScore({ description: "Marble floor tiles 600x600mm", unit: "m2" },
        { description: "Granite floor tiles 600x600mm", unit: "m2" }), 0);
});

test("a different unit is no evidence", () => {
    assert.strictEqual(pastRateScore({ description: "Precast concrete sump 600x600mm with cover", unit: "m" },
        { description: "Precast concrete sump 600x600mm with cover", unit: "no" }), 0);
});

test("nothing comparable gives null, not a guess", () => {
    assert.strictEqual(suggestPastRate({ description: "Solar water heater 300 litre", unit: "no" }, sources), null);
});

test("another project in the register adds its BQ and its agreed star rates; the current one does not", () => {
    const other = JSON.parse(JSON.stringify(project));
    other.id = "PRJ-OTHER"; other.name = "Other Project"; other.createdAt = "2025-03-01T00:00:00Z";
    const withOther = { projects: [project, other] };
    const src = pastRateSources(withOther, project.id);
    const fromOther = src.filter(s => s.project === "Other Project");
    /* its six BQ items + VO-001's agreed marble rate (RM 248) */
    assert.strictEqual(fromOther.length, 7);
    assert.ok(fromOther.some(s => s.basis === "agreed" && s.rate === 248 && s.year === 2025));
    assert.ok(!src.some(s => s.project === project.name));
    /* and that agreed rate now counts towards the marble suggestion */
    assert.strictEqual(suggestPastRate(marbleRow, src).count, 4);
});

test("a new BQ item is coded after its VO, numbered on, and records what it was based on", () => {
    const p = JSON.parse(JSON.stringify(project));
    const s = suggestPastRate(sumpRow, sources);
    const item = newBqItemFromRow(sumpRow, vo2, p, 1100, s, "2026-10-05");
    assert.strictEqual(item.code, "VO-002/1");
    assert.strictEqual(item.rate, 1100);
    assert.strictEqual(item.unit, "no");
    assert.strictEqual(item.origin.voNo, "VO-002");
    assert.strictEqual(item.origin.suggestedRate, 1080);
    assert.strictEqual(item.origin.basedOn.length, 3);
    p.bq.push(item);
    assert.strictEqual(newBqItemFromRow(sumpRow, vo2, p, 900, null, "2026-10-05").code, "VO-002/2");
    /* "Add marble ..." loses the verb as a BQ description */
    assert.strictEqual(newBqItemFromRow(marbleRow, vo1, p, 235, null, "2026-10-05").description,
        "Marble floor tiles 600x600mm to living area");
});

test("once linked to its new BQ item, the row is checked against it", () => {
    const p = JSON.parse(JSON.stringify(project));
    const item = newBqItemFromRow(sumpRow, vo2, p, 1100, null, "2026-10-05");
    p.bq.push(item);
    const row = Object.assign({}, sumpRow, { bqItemId: item.id });
    const check = checkRate(row, p.bq);
    assert.strictEqual(check.state, "different");
    assert.strictEqual(check.diff, 150);
});
