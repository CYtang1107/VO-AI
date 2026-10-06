const test = require("node:test");
const assert = require("node:assert");

const { autoFillRow } = require("../js/page-vo.js");
const { pastRateSources } = require("../js/ratehistory.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];
const sources = pastRateSources(seedDB(), project.id);
const row = description => ({ description: description, unit: "", qty: 1, rate: 0, bqItemId: null, assessedQty: "", assessedRate: "" });
const code = id => (project.bq.find(b => b.id === id) || {}).code;

test("a described row is linked to its BQ item, with the unit and the contract rate filled", () => {
    const r = row("Omit ceramic floor tiles to living area");
    assert.ok(autoFillRow(r, project.bq, sources));
    assert.strictEqual(code(r.bqItemId), "B/4.1");
    assert.strictEqual(r.unit, "m2");
    assert.strictEqual(r.rate, 85);
    assert.deepStrictEqual([r.auto.code, r.auto.rate], ["B/4.1", "bq"]);
});

test("Chinese descriptions are matched too", () => {
    const r = row("主卧天花石膏板");
    autoFillRow(r, project.bq, sources);
    assert.strictEqual(code(r.bqItemId), "E/3.1");
});

test("a different material is never the BQ item: marble gets a past-project (star) rate instead", () => {
    const r = row("增加 600x600mm 大理石地砖");
    autoFillRow(r, project.bq, sources);
    assert.strictEqual(r.bqItemId, null, "marble is not the ceramic floor tiles item");
    assert.strictEqual(r.rate, 235);
    assert.strictEqual(r.auto.rate, "past");
    const skirting = row("Skirting to match new marble finish");
    autoFillRow(skirting, project.bq, sources);
    assert.strictEqual(code(skirting.bqItemId), "B/4.2", "an item naming no material can still match");
});

test("a rate already typed is kept, a hand-picked item is left alone, and a vague row is not guessed", () => {
    const typed = Object.assign(row("Skirting to match floor finish"), { rate: 31 });
    autoFillRow(typed, project.bq, sources);
    assert.strictEqual(typed.rate, 31);
    assert.strictEqual(code(typed.bqItemId), "B/4.2");
    const byHand = Object.assign(row("Omit ceramic floor tiles"), { bqItemId: "BQ6" });
    assert.strictEqual(autoFillRow(byHand, project.bq, sources), false);
    assert.strictEqual(byHand.bqItemId, "BQ6");
    const vague = row("Wall");
    assert.strictEqual(autoFillRow(vague, project.bq, sources), false);
    assert.strictEqual(vague.bqItemId, null);
});

test("re-describing an auto-filled row re-matches it, undoing what no longer fits", () => {
    const r = row("Omit ceramic floor tiles to living area");
    autoFillRow(r, project.bq, sources);
    r.description = "Stainless steel handrail";
    autoFillRow(r, project.bq, sources);
    assert.strictEqual(r.bqItemId, null);
    assert.strictEqual(r.rate, 0);
    assert.strictEqual(r.unit, "");
    assert.ok(!r.auto);
});
