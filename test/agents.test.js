const test = require("node:test");
const assert = require("node:assert");

const { seedDB } = require("../js/store.js");
const {
    engineFacts, renderContractPanel, renderContractAnswer, renderContractCitations, renderAskTabs
} = require("../js/agents.js");

const project = seedDB().projects[0];
const vo = project.vos[0];

const citations = [
    { clause_no: "11.6", title: "Valuation of variations", form: "PAM 2018", doc_name: "PAM 2018",
      text: "A fair valuation shall be made.", similarity: 0.713 }
];

test("engine facts carry the rule engine's own numbers, and say so", () => {
    const facts = engineFacts(vo, project);
    assert.strictEqual(facts.currency, "MYR");
    assert.match(facts.source, /rule engine/);
    assert.strictEqual(facts.vo.no, vo.no);
    assert.strictEqual(typeof facts.totals.claimedTotal, "number");
    assert.strictEqual(typeof facts.totals.assessedTotal, "number");
    assert.strictEqual(facts.totals.difference, facts.totals.assessedTotal - facts.totals.claimedTotal,
        "the difference is computed here, never by the model");
    assert.strictEqual(facts.measurement.length, (vo.measurement || []).length);
    assert.ok(facts.measurement.every(r => typeof r.claimedAmount === "number"));
    assert.ok(facts.rateChecks.same + facts.rateChecks.different + facts.rateChecks.star +
        facts.rateChecks.unchecked + facts.rateChecks.noRate === facts.measurement.length);
    assert.strictEqual(engineFacts(null, project), null);
});

test("every figure an answer may state is in the facts the function sends", async () => {
    const { allowedNumbers } = await import("../supabase/functions/ask-contract/prompt.mjs");
    const facts = engineFacts(vo, project);
    const allowed = allowedNumbers([facts]);
    assert.ok(allowed.has(Math.abs(facts.totals.claimedTotal)) || allowed.has(facts.totals.claimedTotal),
        "the claimed total is quotable");
    facts.measurement.forEach(r => {
        assert.ok(allowed.has(r.claimedRate), "each claimed rate is quotable: " + r.claimedRate);
    });
});

test("the panel offers contract questions and never claims to be a chat assistant", () => {
    const html = renderContractPanel();
    assert.match(html, /id="contractSuggestions"/);
    assert.match(html, /id="contractInput"/);
    assert.match(html, /id="contractAskBtn"/);
    assert.match(html, /never calculates/i);
    assert.strictEqual((html.match(/assistant-suggestion-btn/g) || []).length, 3);
});

test("an answer renders with its clauses, each openable to its own text", () => {
    const html = renderContractAnswer({ answer: "A fair valuation applies.\n引用：PAM 2018 第 11.6 条", citations });
    assert.match(html, /A fair valuation applies\./);
    assert.match(html, /引用：PAM 2018 第 11\.6 条/);
    assert.match(html, /<details class="citation"><summary>PAM 2018 clause 11\.6 — Valuation of variations/);
    assert.match(html, /71% match/);
    assert.match(html, /<p>A fair valuation shall be made\.<\/p>/);
});

test("no clause above the bar: the reason is said plainly, with no answer", () => {
    const html = renderContractAnswer({ answer: null, reason: "no-clause", citations: [] });
    assert.match(html, /No clause in this project(&#39;|')s knowledge base is close enough/);
    assert.ok(!/details/.test(html));
});

test("a rejected answer is not shown — the clauses it found are", () => {
    const html = renderContractAnswer({ answer: null, reason: "amount", citations });
    assert.match(html, /failed VO-AI(&#39;|')s own check/);
    assert.match(html, /<details class="citation">/, "the reader is sent to the clauses themselves");
});

test("an error says what went wrong instead of pretending to answer", () => {
    const html = renderContractAnswer({ error: "not a member of this project" });
    assert.match(html, /Could not ask the contract/);
    assert.match(html, /not a member of this project/);
});

test("the answer area starts empty, and says it is thinking while it waits", () => {
    assert.match(renderContractAnswer(null), /empty-state/);
    assert.match(renderContractAnswer({ pending: true }), /Searching the contract clauses/);
});

test("rendered text is escaped (an answer is model output, never trusted markup)", () => {
    const html = renderContractAnswer({
        answer: "<img src=x onerror=alert(1)>",
        citations: [{ clause_no: "1", text: "<script>bad()</script>", form: "F" }]
    });
    assert.ok(!/<img/.test(html) && !/<script>/.test(html));
    assert.match(html, /&lt;img/);
});

test("the tabs mark the open one", () => {
    const html = renderAskTabs("contract");
    assert.match(html, /data-tab="local"/);
    assert.match(html, /class="ask-tab active" data-tab="contract"/);
    assert.ok(!/class="ask-tab active" data-tab="local"/.test(html));
});

test("citations of nothing render nothing", () => {
    assert.strictEqual(renderContractCitations([]), "");
    assert.strictEqual(renderContractCitations(undefined), "");
});
