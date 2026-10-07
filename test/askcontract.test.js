const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const { engineFacts, contractQuestions, answerHtml, renderContractAnswer } = require("../js/askcontract.js");
const { seedDB } = require("../js/store.js");

/* The Edge Function's rules (an ES module, shared with Deno). */
const rules = () => import(pathToFileURL(path.join(__dirname, "..", "supabase", "functions", "ask-contract", "rules.mjs")).href);

/* Sample wording only: the real contract text never goes in the repo. */
const clauses = [
    { clause_no: "11.5", title: "Valuation of Variations", form: "PAM 2018", doc_name: "PAM 2018", similarity: 0.49,
      text: "All Variations shall be measured and valued by the Quantity Surveyor." },
    { clause_no: "11.6", title: "Valuation rules", form: "PAM 2018", doc_name: "PAM 2018", similarity: 0.53,
      text: "Where work is of a similar character the rates in the Contract Bills shall apply; daywork at cost plus 15%." },
    { clause_no: "24.1", title: "Loss and expense", form: "PAM 2018", doc_name: "PAM 2018", similarity: 0.41,
      text: "Written notice within 28 days of the matters referred to in Clause 24.3." }
];
const facts = { contractor_claimed_total: "RM 18,450.00", consultant_assessed_total: "RM 16,200.00" };

test("a question with Chinese characters is answered in Chinese; otherwise English", async () => {
    const r = await rules();
    assert.strictEqual(r.questionLang("变更怎么估价？"), "zh");
    assert.strictEqual(r.questionLang("How are variations valued?"), "en");
    assert.strictEqual(r.citationLabel("PAM 2018", "11.6", "zh"), "「引用：PAM 2018 第 11.6 条」");
    assert.strictEqual(r.citationLabel("PAM 2018", "11.6", "en"), "[Ref: PAM 2018 Clause 11.6]");
});

test("citations are read from the labels only, sub-clauses and lists included", async () => {
    const r = await rules();
    assert.deepStrictEqual(r.citedClauses("「引用：PAM 2018 第 11.5 条」与「引用：PAM 2018 第 11.6(d) 条」"), ["11.5", "11.6"]);
    assert.deepStrictEqual(r.citedClauses("「引用：PAM 2018 第 11.5 条、第 11.6 条」"), ["11.5", "11.6"]);
    assert.deepStrictEqual(r.citedClauses("[Ref: PAM 2018 Clauses 23.1, 23.8]"), ["23.1", "23.8"]);
    assert.deepStrictEqual(r.citedClauses("[Ref: PAM 2018 Article 3]"), ["Article 3"]);
    assert.deepStrictEqual(r.citedClauses("依第11.5条估价"), [], "a clause named in prose is not a citation");
});

test("an answer citing a given clause passes; a clause named in passing is not checked", async () => {
    const r = await rules();
    const answer = "Notice is due within 28 days of the matters in Clause 24.3 [Ref: PAM 2018 Clause 24.1(a)].";
    const review = r.reviewAnswer(answer, clauses, facts, "How long for notice?");
    assert.ok(review.ok, JSON.stringify(review));
    assert.deepStrictEqual(review.cited, ["24.1"]);
});

test("an answer without a citation, or citing a clause it was not given, is rejected", async () => {
    const r = await rules();
    assert.deepStrictEqual(r.reviewAnswer("Variations are valued by the QS.", clauses, facts, "q").problems, ["no-citation"]);
    const invented = r.reviewAnswer("See [Ref: PAM 2018 Clause 30.1].", clauses, facts, "q");
    assert.ok(invented.problems.includes("invented-citation"));
    assert.deepStrictEqual(invented.invented, ["30.1"]);
});

test("amounts must come from the engine, the question or the clauses — never from the model", async () => {
    const r = await rules();
    const ok = r.reviewAnswer("The assessed total is RM 16,200.00 「引用：PAM 2018 第 11.5 条」, daywork at cost plus 15%.", clauses, facts, "q");
    assert.ok(ok.ok, JSON.stringify(ok));
    const made = r.reviewAnswer("The difference is RM 2,250.00 「引用：PAM 2018 第 11.5 条」.", clauses, facts, "q");
    assert.deepStrictEqual(made.problems, ["amount-check"]);
    assert.deepStrictEqual(made.badAmounts, ["RM 2,250.00"]);
    assert.deepStrictEqual(r.amountsIn("within 28 days under clause 11.6, 15% on cost"), [], "days, clause numbers and percentages are not amounts");
    assert.strictEqual(r.unsupportedAmounts("RM 500", facts, "Is RM 500 reasonable?", clauses).length, 0, "an amount from the question may be repeated");
});

test("pieces of one long clause are shown together; citations come back with their text", async () => {
    const r = await rules();
    const grouped = r.groupChunks([
        { clause_no: "11.6", form: "PAM 2018", text: "part one", similarity: 0.4 },
        { clause_no: "11.6", form: "PAM 2018", text: "part two", similarity: 0.5 },
        { clause_no: "11.5", form: "PAM 2018", text: "other", similarity: 0.45 }
    ]);
    assert.strictEqual(grouped.length, 2);
    assert.strictEqual(grouped[0].text, "part one part two");
    assert.strictEqual(grouped[0].similarity, 0.5);
    const cites = r.citationsFor(["11.6"], clauses);
    assert.deepStrictEqual(cites.map(c => c.clause_no), ["11.6"]);
    assert.match(cites[0].text, /similar character/);
    assert.deepStrictEqual(r.citationsFor(["11"], [{ clause_no: "11.0", form: "PAM 2018", similarity: 0.4, text: "x" }]).map(c => c.clause_no), ["11.0"]);
});

test("the system prompt forbids arithmetic and general knowledge, framed per role", async () => {
    const r = await rules();
    const zh = r.systemPrompt("contractor", "zh");
    assert.match(zh, /承包商自查员/);
    assert.match(zh, /Never calculate/);
    assert.match(zh, /ONLY from the contract clauses/);
    assert.match(zh, /「引用：PAM 2018 第 11.6 条」/);
    assert.match(r.systemPrompt("client", "en"), /certification agent/);
    assert.match(r.correction({ problems: ["amount-check"], invented: [], badAmounts: ["RM 9.00"] }, "en"), /RM 9\.00/);
});

test("requests need a project and a short question", async () => {
    const r = await rules();
    assert.strictEqual(r.validRequest({ project_id: "PRJ-1", question: "How?" }), null);
    assert.ok(r.validRequest({ question: "How?" }));
    assert.ok(r.validRequest({ project_id: "PRJ-1", question: " " }));
    assert.ok(r.validRequest({ project_id: "PRJ-1", question: "x".repeat(501) }));
});

/* ---------- the page side ---------- */

const project = seedDB().projects[0];

test("engine facts carry the rule engine's own formatted figures", () => {
    const f = engineFacts(project.vos[0], project);
    assert.match(f.contractor_claimed_total, /^RM [\d,]+\.\d\d$/);
    assert.match(f.consultant_assessed_total, /^RM [\d,]+\.\d\d$/);
    assert.ok("star_rates_new_rates_not_in_bq" in f.rate_check);
    assert.ok(Array.isArray(f.findings));
});

test("each agent has three suggested questions", () => {
    ["contractor", "consultant", "client"].forEach(role => assert.strictEqual(contractQuestions(role).length, 3));
});

test("an answer draws its citation labels as chips and its clauses as openable sources", () => {
    assert.match(answerHtml("Valued by the QS 「引用：PAM 2018 第 11.5 条」"), /<span class="cite-chip">「引用：PAM 2018 第 11.5 条」<\/span>/);
    assert.match(answerHtml("<b>x</b>"), /&lt;b&gt;/, "model text is escaped");
    const html = renderContractAnswer({ question: "How?", answer: "Valued by the QS [Ref: PAM 2018 Clause 11.5]",
        citations: [{ clause_no: "11.5", title: "Valuation", form: "PAM 2018", similarity: 0.49, text: "All Variations…" }] });
    assert.match(html, /<details class="cite-source">/);
    assert.match(html, /PAM 2018 Clause 11\.5 — Valuation/);
    assert.match(html, /match 49%/);
});

test("no clause, a refused draft and a network error each say so", () => {
    assert.match(renderContractAnswer({ answer: null, reason: "no-clause" }), /does not answer from general knowledge/);
    assert.match(renderContractAnswer({ answer: null, reason: "amount-check" }), /amount that the rule engine did not produce/);
    assert.match(renderContractAnswer({ error: "offline" }), /offline/);
    assert.match(renderContractAnswer({ loading: true }), /Searching the contract/);
});

