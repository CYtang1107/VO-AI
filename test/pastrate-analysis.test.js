const test = require("node:test");
const assert = require("node:assert");

const { suggestPastRate, pastRateSources } = require("../js/ratehistory.js");
const { renderRateSuggestion } = require("../js/page-analysis.js");
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

test("the panel shows the median, its range and its sources, or asks for a quotation", () => {
    const s = suggestPastRate({ description: "Marble floor tiles 600x600mm", unit: "m2" }, sources);
    const offered = renderRateSuggestion(s, false);
    assert.match(offered, /RM 235\.00\/m2 \(median of 3 comparable rate\(s\), RM 228\.00 to RM 255\.00\)/);
    assert.match(offered, /class="secondary-button rate-suggest-use">Use RM 235\.00/);
    assert.match(offered, /Taman Seri Murni Phase 2/);
    assert.match(renderRateSuggestion(s, true), /Filled in from past projects/);
    assert.ok(!/rate-suggest-use/.test(renderRateSuggestion(s, true)));
    const none = renderRateSuggestion(null, false);
    assert.match(none, /supplier quotation or a market check/);
    assert.ok(!/RM/.test(none), "no figure is offered without evidence");
});
