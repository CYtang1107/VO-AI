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
    autoFillRow(vague, project.bq, sources);
    assert.strictEqual(vague.bqItemId, null, "no BQ item guessed");
    assert.strictEqual(vague.unit, "m2", "only its unit");
});

test("re-describing an auto-filled row re-matches it, undoing what no longer fits", () => {
    const r = row("Omit ceramic floor tiles to living area");
    autoFillRow(r, project.bq, sources);
    r.description = "Stainless steel handrail";
    autoFillRow(r, project.bq, sources);
    assert.strictEqual(r.bqItemId, null);
    assert.strictEqual(r.rate, 0);
    assert.strictEqual(r.unit, "m", "the unit a handrail is measured in, not the tiles'");
    assert.deepStrictEqual(r.auto, { unit: true });
});
test("a row described in a word or two (油漆) is linked to the BQ item that has it; a typed unit and rate stay", () => {
    const r = row("油漆");
    assert.ok(autoFillRow(r, project.bq, sources));
    assert.strictEqual(code(r.bqItemId), "B/5.1");
    const typed = Object.assign(row("油漆"), { unit: "m", rate: 76.32 });
    autoFillRow(typed, project.bq, sources);
    assert.deepStrictEqual([code(typed.bqItemId), typed.unit, typed.rate], ["B/5.1", "m", 76.32]);
    const run = Object.assign(row("油漆"), { unit: "m" });
    autoFillRow(run, project.bq, sources);
    assert.deepStrictEqual([code(run.bqItemId), run.rate], ["B/5.1", 0], "a rate per m2 is not put on a row measured in m");
    const ext = row("外墙油漆");
    autoFillRow(ext, project.bq, sources);
    assert.strictEqual(ext.bqItemId, null, "external walls are not the internal walls item");
});
test("a row with no BQ item gets the unit its description says, and a typed unit stays", () => {
    const { guessUnit } = require("../js/buildup.js");
    assert.deepStrictEqual(["铺设200mm MS pipe", "G25混凝土挡土墙", "Y12 high tensile bar", "BRC A7 钢筋网", "75mm 钢扶手", "新开门洞并安装实木平板门", "Something"].map(guessUnit),
        ["m", "m3", "kg", "m2", "m", "no", ""]);
    const r = row("铺设200mm MS pipe");
    autoFillRow(r, project.bq, sources);
    assert.strictEqual(r.unit, "m");
    const typed = Object.assign(row("铺设200mm MS pipe"), { unit: "nr" });
    autoFillRow(typed, project.bq, sources);
    assert.strictEqual(typed.unit, "nr");
});
test("rows made before units were filled in get the unit their description says; a BQ row or a typed unit is left", () => {
    const { fillMissingUnits } = require("../js/page-vo.js");
    const rows = [{ description: "铺设200mm MS pipe", unit: "" }, { description: "G25混凝土挡土墙" }, { description: "Y12 high tensile bar", unit: "t" },
                  { description: "内墙油漆", unit: "", bqItemId: "BQ3" }, { description: "Something", unit: "" }];
    assert.strictEqual(fillMissingUnits(rows), 2);
    assert.deepStrictEqual(rows.map(r => r.unit || ""), ["m", "m3", "t", "", ""]);
});
test("a substitution in the instruction is two items: the omitted one at its BQ rate, the new one a new rate", () => {
    const { instructionItems } = require("../js/analysis.js");
    const items = instructionItems("Change living room floor finish from ceramic tiles to polished marble", project.bq, () => true);
    assert.deepStrictEqual(items.map(i => [i.description, i.bqItem ? code(i.bqItem.id) : null]),
        [["Omit Change living room floor finish ceramic tiles", "B/4.1"], ["Change living room floor finish polished marble", null]]);
});
