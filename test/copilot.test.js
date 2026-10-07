const test = require("node:test");
const assert = require("node:assert");

const cp = require("../js/copilot.js");
const { seedDB } = require("../js/store.js");

const db = () => seedDB();
const ctx = (over) => { const d = db(); return Object.assign({ project: d.projects[0], role: "consultant", today: "2026-09-12", db: d, question: "" }, over || {}); };

test("a question is matched to what the project's data can answer, in English or Chinese", () => {
    const cases = {
        "How is the project doing?": "overview", "项目目前情况如何？": "overview",
        "What is waiting for me?": "waiting", "有什么在等我处理？": "waiting",
        "Any deadlines overdue?": "deadlines", "哪些期限快到期？": "deadlines",
        "Which VOs may not be claimable?": "claims", "哪些变更令可能无法索赔？": "claims",
        "Which rates differ from the BQ?": "rates", "哪些单价与合同清单不符？": "rates",
        "Will the project overrun?": "cost", "项目会超支吗？": "cost",
        "What did past projects pay for marble tiles?": "experience", "过去项目的大理石单价": "experience"
    };
    Object.keys(cases).forEach(q => assert.strictEqual(cp.copilotIntent(q), cases[q], q));
    assert.strictEqual(cp.copilotIntent("What does clause 11.1 say about omissions?"), null, "a contract question");
    assert.strictEqual(cp.copilotIntent("  "), null);
});

test("overview: VOs by stage, cost and what waits for this role", () => {
    const a = cp.answerFromData("overview", ctx());
    assert.match(a.lines[0].text, /3 VO\(s\): 1 draft, 1 in progress, 0 valued, 1 certified/);
    assert.match(a.lines[1].text, /Contract sum RM 12,500,000\.00/);
    assert.ok(a.lines.some(l => /1 VO\(s\) are waiting for the Consultant QS/.test(l.text)));
});

test("waiting: the consultant QS has VO-002 to value, linked to it", () => {
    const a = cp.answerFromData("waiting", ctx());
    assert.strictEqual(a.lines.length, 1);
    assert.strictEqual(a.lines[0].vo.no, "VO-002");
    assert.match(a.lines[0].text, /^instruction EI-008 issued/, "the number is not repeated");
    assert.match(cp.answerFromData("waiting", ctx({ role: "client" })).lines[0].text, /Nothing is waiting/);
});

test("rates and claims name the VOs and why", () => {
    const r = cp.answerFromData("rates", ctx());
    assert.ok(r.lines.some(l => l.vo && l.vo.no === "VO-001" && /1 row\(s\) priced differently/.test(l.text)));
    const c = cp.answerFromData("claims", ctx());
    assert.match(c.lines[0].text, /all 3 VO\(s\) claimable/);
});

test("experience: a named item finds past projects' rates; otherwise the project's own new items are compared", () => {
    let a = cp.answerFromData("experience", ctx({ question: "past rate for marble floor tiles 600x600mm m2" }));
    assert.match(a.lines[0].text, /Past projects paid RM [\d,.]+ \(median of \d+/);
    assert.ok(a.lines.slice(1).every(l => /\(\d{4}\)/.test(l.text)), "each source names its project and year");
    a = cp.answerFromData("experience", ctx({ question: "past experience" }));
    assert.match(a.lines[0].text, /new items/);
    assert.ok(a.lines.some(l => l.vo && /past projects paid|no comparable item/.test(l.text)));
    assert.match(a.source, /not adjusted for price changes/);
});

test("cost: forecast, certified, SPI and CPI from the cost overview", () => {
    const a = cp.answerFromData("cost", ctx());
    assert.match(a.lines[0].text, /Forecast final cost RM 12,569,660\.00/);
    assert.ok(a.lines.some(l => /SPI 0\.\d\d/.test(l.text)));
    assert.ok(a.lines.some(l => /CPI 0\.96/.test(l.text)));
});

test("a contract question is sent with the project's figures as the only amounts", () => {
    const f = cp.projectFacts(db().projects[0], "2026-09-12");
    assert.strictEqual(f.contract_sum, "RM 12,500,000.00");
    assert.strictEqual(f.variation_orders.length, 3);
    assert.strictEqual(f.variation_orders[0].vo, "VO-001");
});

test("the page offers the seven questions and shows answers newest first", () => {
    const d = cp.answerFromData("waiting", ctx());
    const html = cp.renderCopilot({ history: [{ question: "first", data: d }, { question: "second", data: d }] }, { contract: false });
    assert.strictEqual((html.match(/copilot-q-btn/g) || []).length, 7);
    assert.ok(html.indexOf("second") < html.indexOf("first"));
    assert.match(html, /href="vo\.html\?id=VO-SEED-2"/);
    assert.match(cp.renderCopilot({ history: [{ question: "what is clause 2.2?" }] }, {}), /need a team account/);
});
