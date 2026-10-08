const test = require("node:test");
const assert = require("node:assert");

const bu = require("../js/buildup.js");
const { seedDB } = require("../js/store.js");

const project = () => seedDB().projects[0];

test("the rate: materials, machinery and labour each run down their lines; profit on the net cost; rounded up", () => {
    const r = bu.buildUpRate({ roundTo: 0, sections: {
        material: [{ type: "item", qty: 1, price: 100 }, { type: "pct", pct: 5 }],
        machinery: [{ type: "item", qty: 0.25, price: 8 }],
        labour: [{ type: "day", nos: 2, price: 100, output: 20 }],
        profit: [{ type: "pct", pct: 10 }]
    } });
    assert.deepStrictEqual([r.material, r.machinery, r.labour, r.net, r.ohp, r.ohpPct, r.rate], [105, 2, 10, 117, 11.7, 10, 128.7]);
    const old = bu.buildUpRate({ ohp: 10, items: [{ kind: "material", qty: 1, waste: 0.05, price: 100 }, { kind: "labour", qty: 0.5, price: 20 }, { kind: "plant", qty: 0.25, price: 8 }] });
    assert.deepStrictEqual([old.material, old.labour, old.plant, old.rate], [105, 10, 2, 128.7], "a build-up saved before the sections reads the same");
});
test("a marble floor row is drafted as tiles, adhesive, grout and wastage; a tiler and a helper; a tile cutter; profit", () => {
    const p = project();
    const row = p.vos[0].measurement.find(r => /marble/i.test(r.description) && r.unit === "m2");
    const b = bu.suggestBuildUp(row, p);
    assert.strictEqual(b.recipe, "marbleFloor");
    assert.deepStrictEqual(b.sections.material.map(l => l.ref || l.type), ["marble-tile", "adhesive", "grout", "pct"]);
    assert.deepStrictEqual(b.sections.labour.map(l => l.ref), ["tiler", "general"]);
    assert.deepStrictEqual(b.sections.machinery.map(l => l.ref), ["tile-cutter"]);
    assert.strictEqual(b.sections.profit[0].type, "pct");
    const rate = bu.buildUpRate(b).rate;
    assert.ok(rate > 200 && rate < 300, "a plausible rate per m2: " + rate);
});
test("skirting is matched by its unit and material; work with no recipe gets none", () => {
    const p = project();
    assert.strictEqual(bu.suggestBuildUp({ description: "Skirting to match new marble finish", unit: "m" }, p).recipe, "marbleSkirting");
    assert.strictEqual(bu.suggestBuildUp({ description: "Tile skirting", unit: "m" }, p).recipe, "skirting");
    assert.strictEqual(bu.suggestBuildUp({ description: "uPVC pipe 150mm", unit: "m" }, p).recipe, "pipe");
    assert.strictEqual(bu.suggestBuildUp({ description: "Glass balustrade", unit: "m" }, p), null);
});

test("the contractor's own price list is used before the reference price", () => {
    const p = Object.assign(project(), { priceList: [{ name: "Marble tile 600x600 (Supplier X)", unit: "m2", price: 168 }, { name: "Tiler", unit: "day", price: 150 }] });
    const b = bu.suggestBuildUp({ description: "Marble floor tiles", unit: "m2" }, p);
    const tile = b.sections.material.find(l => l.ref === "marble-tile");
    assert.strictEqual(tile.price, 168);
    assert.strictEqual(tile.source, "priceList");
    assert.strictEqual(b.sections.labour.find(l => l.ref === "tiler").price, 150);
    assert.strictEqual(b.sections.material.find(l => l.ref === "grout").source, "reference");
});
test("prices follow the site's region", () => {
    assert.deepStrictEqual(bu.regionOf(project()), { id: "klang", factor: 1, from: "address" }, "the demo is in Cheras");
    const kk = { site: { lat: 5.98, lng: 116.07, address: "Jalan Tun Razak, Kota Kinabalu, Sabah" } };
    assert.strictEqual(bu.regionOf(kk).id, "sabah");
    const b = bu.suggestBuildUp({ description: "Marble floor tiles", unit: "m2" }, kk);
    assert.strictEqual(b.sections.material[0].price, 201.6, "180 × 1.12");
    assert.strictEqual(bu.regionOf({}).from, "default");
    assert.strictEqual(bu.regionOf({ region: "sarawak" }).factor, 1.08);
});

test("rent or buy: renting for a short job, buying for a long one, and when buying pays off", () => {
    const excavator = { rentPerMonth: 9680, buyPrice: 120000, resalePct: 40, upkeepPctYear: 10 };
    const short = bu.rentOrBuy(Object.assign({ months: 2 }, excavator));
    assert.strictEqual(short.cheaper, "rent");
    assert.deepStrictEqual([short.rentCost, short.buyCost], [19360, 28666.67]);
    const long = bu.rentOrBuy(Object.assign({ months: 12 }, excavator));
    assert.strictEqual(long.cheaper, "buy");
    assert.strictEqual(long.breakEven, 4);
    assert.strictEqual(bu.rentOrBuy({ months: 3, rentPerMonth: 0, buyPrice: 5000 }).breakEven, null, "free hire: never");
});

test("a pasted price list reads name, unit, price and reports the lines it cannot read", () => {
    const r = bu.parsePriceList("Marble tile 600x600, m2, RM 168\nTiler\thr\t24\n\nbad line\nGrout, m2, 0");
    assert.deepStrictEqual(r.items, [{ name: "Marble tile 600x600", unit: "m2", price: 168 }, { name: "Tiler", unit: "hr", price: 24 }]);
    assert.deepStrictEqual(r.bad, [4, 5]);
});

test("the card: the star row is marked, the draft is said to be a draft, and the rate is offered", () => {
    const p = project();
    const vo = p.vos[0];
    const k = vo.measurement.findIndex(r => /marble/i.test(r.description) && r.unit === "m2");
    const html = bu.renderBuildUpCard(vo, p, { rowIndex: k, stars: new Set([k]), editable: true, useAs: "assessed", rent: {} });
    assert.match(html, /★ /);
    assert.match(html, /Drafted from the row/);
    assert.match(html, /id="buUseRate">Use RM [\d,.]+ as the assessed rate/);
    assert.match(html, /Rent or buy the plant\?/);
    assert.match(html, /Wet tile cutter/);
    const ro = bu.renderBuildUpCard(vo, p, { rowIndex: k, editable: false });
    assert.match(ro, /disabled/);
    assert.doesNotMatch(ro, /buUseRate/);
    assert.match(bu.renderBuildUpCard({ measurement: [] }, p, {}), /Add a measurement row first/);
});

/* the team's own build-up sheets */
test("a 12mm cement screed, as the QS's sheet: cement and sand per m³, delivery 10 %, wastage and shrinkage 30 %, × 0.012 to per m², two skilled workers, tools, profit 20 %", () => {
    const b = bu.suggestBuildUp({ description: "Turapan simen biasa 12mm tebal", unit: "m2" }, {});
    assert.strictEqual(b.recipe, "screed");
    const m = b.sections.material;
    assert.deepStrictEqual(m.map(l => l.type), ["item", "item", "pct", "pct", "unit"]);
    const run = bu.runSection(m, 0).rows.map(x => Math.round(x.after * 100) / 100);
    assert.deepStrictEqual(run, [174, 290, 319, 414.7, 4.98], "RM 290 → 319 → 414.70 a m³ → RM 4.98 a m²");
    const r = bu.buildUpRate(b);
    assert.deepStrictEqual([r.material, r.machinery, r.labour, r.net, r.ohp, r.raw, r.rate], [4.98, 10, 24, 38.98, 7.8, 46.77, 47]);
});
test("excavation with machinery: the backhoe's day with diesel and oil, the lorry and its diesel a metre, two workers, profit 10 %", () => {
    const b = bu.suggestBuildUp({ description: "Excavation n.e. 1.0m width & 1.0m depth", unit: "m" }, {});
    assert.strictEqual(b.recipe, "excavation");
    const hoe = b.sections.machinery.find(l => l.ref === "backhoe");
    assert.deepStrictEqual(hoe.subs.map(x => [x.qty, x.price, x.per]), [[70, 4.72, "day"], [1, 2800, "year"]]);
    const amt = l => Math.round(bu.lineAmount(l, 0) * 100) / 100;
    assert.strictEqual(amt(hoe), 22.59, "(475 + 70 × 4.72 + 2,800 / 365) ÷ 36 m");
    assert.strictEqual(amt(b.sections.machinery.find(l => l.ref === "lorry-3t")), 15.97);
    assert.strictEqual(amt(b.sections.machinery.find(l => l.ref === "diesel")), 0.76, "0.16 L a metre");
    const r = bu.buildUpRate(b);
    assert.deepStrictEqual([r.machinery, r.labour, r.net, r.ohp, r.raw, r.rate], [39.31, 4.72, 44.03, 4.4, 48.44, 50]);
});

test("the builder: each section's add offers its formats; lines and sub-items are added, edited, moved and removed", () => {
    assert.deepStrictEqual(bu.ADD_FORMATS.material, ["item:material", "pct:wastage", "pct:shrinkage", "pct:delivery", "unit:unit", "pct:percent"]);
    assert.deepStrictEqual(bu.ADD_FORMATS.profit, ["pct:profit", "pct:overhead", "item:lump"]);
    let b = { sections: { material: [], machinery: [], labour: [], profit: [] }, roundTo: 0 };
    const ed = e => { b = bu.editBuildUp(b, e); };
    ed({ op: "add", sec: "material", value: "item:material" });
    ed({ sec: "material", i: 0, k: "qty", value: "2", numeric: true });
    ed({ sec: "material", i: 0, k: "price", value: "50", numeric: true });
    ed({ op: "add", sec: "material", value: "pct:delivery" });
    assert.strictEqual(b.sections.material[1].pct, 10);
    ed({ op: "add", sec: "material", value: "unit:unit" });
    ed({ sec: "material", i: 2, k: "factor", value: "0.5", numeric: true });
    assert.strictEqual(bu.buildUpRate(b).material, 55, "(2 × 50) + 10 % = 110, × 0.5");
    ed({ op: "up", sec: "material", i: 2 });
    assert.strictEqual(bu.buildUpRate(b).material, 55, "× 0.5 then + 10 %: the same here");
    ed({ op: "add", sec: "machinery", value: "day:machine" });
    ed({ sec: "machinery", i: 0, k: "price", value: "400", numeric: true });
    ed({ sec: "machinery", i: 0, k: "output", value: "20", numeric: true });
    ed({ op: "addSub", sec: "machinery", i: 0, value: "diesel" });
    ed({ sec: "machinery", i: 0, s: 0, k: "qty", value: "50", numeric: true });
    assert.strictEqual(bu.buildUpRate(b).machinery, 31.8, "(400 + 50 L × 4.72) ÷ 20");
    ed({ op: "remove", sec: "machinery", i: 0, s: 0 });
    assert.strictEqual(bu.buildUpRate(b).machinery, 20);
    ed({ op: "add", sec: "profit", value: "pct:profit" });
    ed({ op: "add", sec: "profit", value: "pct:overhead" });
    const r = bu.buildUpRate(b);
    assert.strictEqual(r.net, 75);
    assert.strictEqual(r.ohp, 15.56, "15 % on 75 = 86.25, then 5 % on that = 90.56");
    ed({ k: "roundTo", value: "5" });
    assert.strictEqual(bu.buildUpRate(b).rate, 95, "90.56 rounded up to RM 5");
    ed({ op: "remove", sec: "material", i: 0 });
    assert.strictEqual(b.sections.material.length, 2);
});

test("the card: four sections with an add under each, the sub-item add under a machine, totals in order", () => {
    const vo = { id: "VO-1", measurement: [{ id: "M1", description: "Excavation n.e. 1.0m", unit: "m" }] };
    const html = bu.renderBuildUpCard(vo, {}, { rowIndex: 0, editable: true });
    const order = ["bu-sec-material", "bu-sec-machinery", "bu-sec-labour", "bu-sec-profit"];
    let at = -1;
    order.forEach(k => { const i = html.indexOf(k); assert.ok(i > at, k); at = i; });
    assert.strictEqual((html.match(/class="bu-add-line"/g) || []).length, 4);
    assert.match(html, /class="bu-add-sub"/);
    assert.match(html, /Wastage \(%\)[\s\S]*Shrinkage \(%\)[\s\S]*Delivery \(%\)[\s\S]*Unit conversion/);
    assert.match(html, /Rate per m<\/small><strong>RM 50\.00/);
    assert.doesNotMatch(bu.renderBuildUpCard(vo, {}, { rowIndex: 0, editable: false }), /bu-add-line|bu-remove/);
});
test("the rate is rounded up as chosen", () => {
    assert.deepStrictEqual([bu.roundUp(46.77, 1), bu.roundUp(48.44, 5), bu.roundUp(48.44, 10), bu.roundUp(47, 1), bu.roundUp(46.77, 0)], [47, 50, 50, 47, 46.77]);
    assert.strictEqual(bu.thicknessOf("screed 25mm thick", 12), 0.025);
    assert.strictEqual(bu.thicknessOf("screed", 12), 0.012);
});
