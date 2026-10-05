const test = require("node:test");
const assert = require("node:assert");

/* prompt.mjs is an ES module because the Edge Function (Deno) imports it
   as it is; node:test loads it with a dynamic import. */
const load = () => import("../supabase/functions/ask-contract/prompt.mjs");

const clauses = [
    { clause_no: "11.6", title: "Valuation of variations", form: "PAM 2018", doc_name: "PAM 2018",
      text: "The rates in the Contract Bills shall determine the valuation of work of similar character. Where work is not of similar character a fair valuation shall be made.", similarity: 0.71 },
    { clause_no: "11.2", title: "Instructions requiring a Variation", form: "PAM 2018", doc_name: "PAM 2018",
      text: "The Architect may issue instructions requiring a Variation. No Variation shall vitiate the Contract.", similarity: 0.52 }
];
const facts = { claimedTotal: 12500, assessedTotal: 11800, classification: "addition" };

test("the system prompt states the two rules the plan rests on", async () => {
    const { SYSTEM_RULES, buildMessages, ROLE_FRAMING } = await load();
    assert.match(SYSTEM_RULES, /NEVER calculate/);
    assert.match(SYSTEM_RULES, /引用/);
    const messages = buildMessages({ question: "谁决定变更的估价？", role: "client", clauses, facts });
    assert.strictEqual(messages.length, 2);
    assert.ok(messages[0].content.includes(ROLE_FRAMING.client), "the role's framing is in the system prompt");
    assert.match(messages[1].content, /\[1\] PAM 2018 clause 11\.6 — Valuation of variations/);
    assert.match(messages[1].content, /similar character/, "the clause text itself is given, not only its number");
    assert.match(messages[1].content, /"claimedTotal": 12500/);
    assert.match(messages[1].content, /谁决定变更的估价？/);
});

test("with no engine facts the model is told to write no figure at all", async () => {
    const { buildMessages } = await load();
    const user = buildMessages({ question: "What is clause 11.6 about?", role: "consultant", clauses }).at(-1).content;
    assert.match(user, /ENGINE FACTS: none supplied\. Do not write any figure/);
});

test("a retry quotes back what was wrong with the first answer", async () => {
    const { buildMessages } = await load();
    const messages = buildMessages({ question: "q", role: "consultant", clauses, facts, retry: "It contained figures…" });
    assert.strictEqual(messages.length, 3);
    assert.match(messages[2].content, /previous answer was rejected: It contained figures…/);
});

test("amountsIn finds money and percentages, not days or clause numbers", async () => {
    const { amountsIn } = await load();
    assert.deepStrictEqual(amountsIn("RM 12,500.00 and MYR 300 and 1,100.50 and 5%"), [12500, 300, 1100.5, 5]);
    assert.deepStrictEqual(amountsIn("within 14 days under clause 11.6, see also 23"), [],
        "a period and a clause number are not amounts");
});

test("an answer may repeat the engine's figures, however they are written", async () => {
    const { checkAnswer } = await load();
    const answer = "评估额为 RM 11,800.00，低于申报的 RM 12,500.00。引用：PAM 2018 第 11.6 条";
    assert.deepStrictEqual(checkAnswer(answer, { clauses, facts, question: "差额多少？" }), { ok: true });
});

test("an answer that invents an amount is rejected (the AI never calculates money)", async () => {
    const { checkAnswer } = await load();
    const verdict = checkAnswer("差额为 RM 700.00。引用：PAM 2018 第 11.6 条",
        { clauses, facts, question: "差额多少？" });
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(verdict.reason, "amount");
    assert.deepStrictEqual(verdict.amounts, [700], "12500 − 11800 is arithmetic the engine did not do");
    assert.match(verdict.detail, /700/);
});

test("a figure quoted from a clause is allowed; one invented around it is not", async () => {
    const { checkAnswer } = await load();
    const withPercent = [{ clause_no: "30.4", form: "PAM 2018",
        text: "Retention shall be 5% of the Contract Sum.", similarity: 0.6 }];
    assert.ok(checkAnswer("Retention is 5%. 引用：PAM 2018 第 30.4 条",
        { clauses: withPercent, facts: null, question: "retention?" }).ok);
    assert.strictEqual(checkAnswer("Retention is 7.5%. 引用：PAM 2018 第 30.4 条",
        { clauses: withPercent, facts: null, question: "retention?" }).reason, "amount");
});

test("an answer with no citation, or one citing a clause that was not retrieved, is rejected", async () => {
    const { checkAnswer, hasCitation } = await load();
    assert.strictEqual(checkAnswer("The architect values the variation.", { clauses, facts, question: "q" }).reason,
        "no-citation");
    assert.strictEqual(checkAnswer("引用：PAM 2018 第 99.9 条", { clauses, facts, question: "q" }).reason,
        "no-citation", "a clause number that was never retrieved is not a citation");
    assert.ok(hasCitation("… Source: PAM 2018 clause 11.2", clauses), "the English form counts too");
    assert.strictEqual(checkAnswer("   ", { clauses, facts, question: "q" }).reason, "empty");
});

test("citations carry what the chips need, with the similarity rounded", async () => {
    const { citationsOf } = await load();
    const [first] = citationsOf(clauses);
    assert.strictEqual(first.clause_no, "11.6");
    assert.strictEqual(first.form, "PAM 2018");
    assert.strictEqual(first.similarity, 0.71);
    assert.match(first.text, /similar character/);
});
