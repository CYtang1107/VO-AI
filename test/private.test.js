const test = require("node:test");
const assert = require("node:assert");

const bu = require("../js/buildup.js");
const pv = require("../js/private.js");
const { cloudRows } = require("../js/cloud.js");

const excavation = () => bu.suggestBuildUp({ description: "Excavation n.e. 1.0m width & 1.0m depth", unit: "m" }, {});

test("what the team sees of a build-up: materials, labour, machinery and tools, profit and the rate — no lines", () => {
    const sm = pv.buildUpSummary(excavation(), "2026-10-08");
    assert.deepStrictEqual(sm, { material: 0, labour: 4.72, plant: 39.31, net: 44.03, profitPct: 10, profit: 4.4, rate: 50, at: "2026-10-08" });
    assert.doesNotMatch(JSON.stringify(sm), /Backhoe|diesel|475|items/i);
});

test("a build-up's working never leaves in the shared VO or project", () => {
    const vo = { id: "VO-1", measurement: [{ id: "M1", rate: 50, buildUp: excavation(), buildUpSummary: { rate: 50 } }, { id: "M2" }] };
    const shared = pv.withoutPrivate(vo);
    assert.ok(!("buildUp" in shared.measurement[0]));
    assert.strictEqual(shared.measurement[0].buildUpSummary.rate, 50);
    assert.ok(vo.measurement[0].buildUp, "the author's own copy is untouched");
    const rows = cloudRows({ projects: [{ id: "P1", name: "x", priceList: [{ name: "Tiler", unit: "day", price: 150 }], vos: [vo] }] });
    assert.ok(!("priceList" in rows.projects.P1), "the price list stays private");
    assert.ok(!("buildUp" in rows.vos["P1/VO-1"].measurement[0]), "the build-up stays private");
    assert.strictEqual(pv.buildUpKey("VO-1", "M1"), "buildup/VO-1/M1");
});

test("the consultant's view of a row: the contractor's five figures, never the lines", () => {
    const b = excavation();
    const vo = { id: "VO-1", measurement: [{ id: "M1", description: "Excavation", unit: "m", rate: 50, buildUpSummary: pv.buildUpSummary(b, "2026-10-08") }] };
    const html = bu.renderBuildUpSummary(vo, { rowIndex: 0 });
    assert.match(html, /The contractor&#39;s built-up rate \(used 2026-10-08\)/);
    assert.match(html, /RM 39\.31/);
    assert.match(html, /RM 50\.00/);
    assert.match(html, /Profit 10 %/);
    assert.doesNotMatch(html, /Backhoe|diesel|bu-table/i);
    assert.match(bu.renderBuildUpSummary({ measurement: [{ id: "M1", rate: 5 }] }, {}), /has not used a built-up rate/);
    vo.measurement[0].rate = 55;
    assert.match(bu.renderBuildUpSummary(vo, {}), /The claimed rate is now RM 55\.00/);
});

test("the contractor's own card shows their saved build-up", () => {
    const vo = { id: "VO-1", measurement: [{ id: "M1", description: "Excavation n.e. 1.0m", unit: "m" }] };
    const html = bu.renderBuildUpCard(vo, {}, { rowIndex: 0, editable: true, buildUp: excavation() });
    assert.match(html, /Backhoe/);
    assert.doesNotMatch(html, /Drafted from the row/, "their own saved build-up, not a draft");
});
