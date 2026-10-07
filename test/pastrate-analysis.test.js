const test = require("node:test");
const assert = require("node:assert");

const { suggestPastRate, pastRateSources } = require("../js/ratehistory.js");
const { seedDB } = require("../js/store.js");

const sources = pastRateSources(seedDB(), "PRJ-CADANGAN");

test("a revised item described in Chinese finds the same past rates as in English", () => {
    const zh = suggestPastRate({ description: "600x600mm 大理石地砖", unit: "m2" }, sources);
    const en = suggestPastRate({ description: "Marble floor tiles 600x600mm", unit: "m2" }, sources);
    assert.ok(zh && en);
    assert.strictEqual(zh.rate, en.rate);
    assert.deepStrictEqual(zh.matches.map(m => m.rate).sort(), en.matches.map(m => m.rate).sort());
    assert.strictEqual(zh.rate, 235);
});

test("singular and plural are one word, and the material still has to agree", () => {
    assert.ok(suggestPastRate({ description: "Marble floor tile 600x600mm", unit: "m2" }, sources));
    const granite = suggestPastRate({ description: "600x600mm 花岗岩地砖", unit: "m2" }, sources);
    assert.deepStrictEqual(granite.matches.map(m => m.rate), [190], "marble rates are no evidence for granite");
    assert.strictEqual(suggestPastRate({ description: "新的木门", unit: "no" }, sources), null);
});

test("a size written any common way, and a short material + size description, still find past rates", () => {
    ["600mmx 600mm 大理石", "600 X 600 marble", "600×600 大理石", "600 x 600 mm 大理石地砖"].forEach(d => {
        const s = suggestPastRate({ description: d, unit: "" }, sources);
        assert.ok(s, d);
        assert.strictEqual(s.rate, 235, d);
    });
    assert.strictEqual(suggestPastRate({ description: "大理石", unit: "m2" }, sources), null, "one word alone is not enough");
    const small = suggestPastRate({ description: "450x450 预制混凝土集水井", unit: "no" }, sources);
    assert.deepStrictEqual(small.matches.map(m => m.rate), [760], "a 600x600 sump is no evidence for a 450x450 one");
});
