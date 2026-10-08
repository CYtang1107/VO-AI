const test = require("node:test");
const assert = require("node:assert");

const bu = require("../js/buildup.js");
const { seedDB } = require("../js/store.js");

const project = () => seedDB().projects[0];

test("the rate adds materials (with waste), labour and plant, then overhead and profit", () => {
    const r = bu.buildUpRate({ ohp: 10, items: [
        { kind: "material", qty: 1, waste: 0.05, price: 100 },
        { kind: "labour", qty: 0.5, price: 20 },
        { kind: "plant", qty: 0.25, price: 8 }
    ] });
    assert.deepStrictEqual(r, { material: 105, deliveryPct: 0, delivery: 0, labour: 10, plant: 2, net: 117, ohpPct: 10, ohp: 11.7, raw: 128.7, roundTo: 0, rate: 128.7 });
    assert.strictEqual(bu.buildUpRate({ items: [] }).ohpPct, 15, "15 % by default");
});

test("a marble floor row is drafted as tiles, adhesive, grout; a tiler and a helper; a tile cutter", () => {
    const p = project();
    const row = p.vos[0].measurement.find(r => /marble/i.test(r.description) && r.unit === "m2");
    const b = bu.suggestBuildUp(row, p);
    assert.strictEqual(b.recipe, "marbleFloor");
    assert.deepStrictEqual(b.items.map(i => i.ref), ["marble-tile", "adhesive", "grout", "tiler", "general", "tile-cutter"]);
    assert.ok(b.items.every(i => i.source === "reference"));
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
    const tile = b.items.find(i => i.ref === "marble-tile");
    assert.strictEqual(tile.price, 168);
    assert.strictEqual(tile.source, "priceList");
    assert.strictEqual(b.items.find(i => i.ref === "tiler").price, 150);
    assert.strictEqual(b.items.find(i => i.ref === "grout").source, "reference");
});

test("prices follow the site's region", () => {
    assert.deepStrictEqual(bu.regionOf(project()), { id: "klang", factor: 1, from: "address" }, "the demo is in Cheras");
    const kk = { site: { lat: 5.98, lng: 116.07, address: "Jalan Tun Razak, Kota Kinabalu, Sabah" } };
    assert.strictEqual(bu.regionOf(kk).id, "sabah");
    const b = bu.suggestBuildUp({ description: "Marble floor tiles", unit: "m2" }, kk);
    assert.strictEqual(b.items[0].price, 201.6, "180 × 1.12");
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
test("a 12mm cement screed, built up as the QS does: mortar 1:4 per m³, delivery 10 %, wastage 30 %, two skilled workers, tools, profit 20 %", () => {
    const b = bu.suggestBuildUp({ description: "Turapan simen biasa 12mm tebal", unit: "m2" }, {});
    assert.strictEqual(b.recipe, "screed");
    const mortar = b.items[0];
    assert.deepStrictEqual([mortar.qty, mortar.price, mortar.waste], [0.012, 290, 0.3], "0.2 × 870 + 0.8 × 145, 12mm thick");
    assert.strictEqual(Math.round(bu.itemAmount(mortar) * 1.1 * 100) / 100, 4.98, "RM 414.70 a m³ × 0.012");
    const r = bu.buildUpRate(b);
    assert.deepStrictEqual([r.material, r.labour, r.plant, r.net, r.ohp, r.raw, r.rate], [4.98, 24, 10, 38.98, 7.8, 46.77, 47]);
});

test("excavation with machinery: the backhoe's day with diesel and oil, the lorry and its diesel a metre, two workers, profit 10 %", () => {
    const b = bu.suggestBuildUp({ description: "Excavation n.e. 1.0m width & 1.0m depth", unit: "m" }, {});
    assert.strictEqual(b.recipe, "excavation");
    const hoe = b.items.find(i => i.ref === "backhoe");
    assert.strictEqual(Math.round(bu.itemAmount(hoe) * 100) / 100, 22.59, "(475 + 70 × 4.72 + 2,800 / 365) ÷ 36 m");
    assert.strictEqual(Math.round(bu.itemAmount(b.items.find(i => i.ref === "lorry-3t")) * 100) / 100, 15.97);
    assert.strictEqual(Math.round(bu.itemAmount(b.items.find(i => i.ref === "diesel")) * 100) / 100, 0.76, "0.16 L a metre");
    const r = bu.buildUpRate(b);
    assert.deepStrictEqual([r.plant, r.labour, r.net, r.ohp, r.raw, r.rate], [39.31, 4.72, 44.03, 4.4, 48.44, 50]);
});

test("the rate is rounded up as chosen", () => {
    assert.deepStrictEqual([bu.roundUp(46.77, 1), bu.roundUp(48.44, 5), bu.roundUp(48.44, 10), bu.roundUp(47, 1), bu.roundUp(46.77, 0)], [47, 50, 50, 47, 46.77]);
    assert.strictEqual(bu.thicknessOf("screed 25mm thick", 12), 0.025);
    assert.strictEqual(bu.thicknessOf("screed", 12), 0.012);
});
