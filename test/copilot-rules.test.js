const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const rules = () => import(pathToFileURL(path.join(__dirname, "..", "supabase", "functions", "copilot", "rules.mjs")).href);
const data = { cost: { contract_sum: "RM 12,500,000.00" }, variation_orders: [{ vo: "VO-002", contractor_claimed: "RM 13,804.00", consultant_assessed: "RM 12,600.00" }] };
const clause = { clause_no: "11.6", form: "PAM 2018", doc_name: "PAM", title: "Valuation rules", text: "valued at fair rates", similarity: 0.5 };

test("a request needs a project, a question and the project's data, within limits", async () => {
    const r = await rules();
    assert.strictEqual(r.validCopilotRequest({ project_id: "P", question: "q", project_data: data }), null);
    assert.match(r.validCopilotRequest({ project_id: "P", question: "q" }), /project_data/);
    assert.match(r.validCopilotRequest({ project_id: "P", question: "x".repeat(501), project_data: data }), /too long/);
    assert.match(r.validCopilotRequest({ project_id: "P", question: "q", project_data: { big: "x".repeat(r.MAX_DATA_CHARS) } }), /too large/);
});

test("an answer quoting the data's amounts passes; one with a made-up amount or difference does not", async () => {
    const r = await rules();
    assert.ok(r.reviewCopilotAnswer("VO-002: claimed RM 13,804.00, assessed RM 12,600.00.", data, [], "q").ok);
    const bad = r.reviewCopilotAnswer("VO-002 is reduced by RM 1,204.00.", data, [], "q");
    assert.ok(!bad.ok);
    assert.deepStrictEqual(bad.problems, ["amount-check"]);
    assert.match(r.copilotCorrection(bad), /RM 1,204\.00/);
});

test("a clause may be cited only if it was given; no citation is needed for project facts", async () => {
    const r = await rules();
    assert.ok(r.reviewCopilotAnswer("Valued at fair rates [Ref: PAM 2018 Clause 11.6].", data, [clause], "q").ok);
    const bad = r.reviewCopilotAnswer("See [Ref: PAM 2018 Clause 23.8].", data, [clause], "q");
    assert.deepStrictEqual(bad.problems, ["invented-citation"]);
    assert.ok(r.reviewCopilotAnswer("VO-002 waits for the consultant QS.", data, [], "q").ok);
});

test("the prompt carries the data and the clauses, and the rules in the asker's language", async () => {
    const r = await rules();
    const sys = r.copilotSystemPrompt("client", "zh");
    assert.match(sys, /业主/);
    assert.match(sys, /Never calculate/);
    assert.match(sys, /never write a word with an underscore/);
    const user = r.copilotUserPrompt("哪个变更令差额最大？", data, [clause], "zh");
    assert.match(user, /PROJECT DATA/);
    assert.match(user, /「引用：PAM 2018 第 11\.6 条」/);
    assert.match(user, /QUESTION: 哪个变更令差额最大？/);
});
