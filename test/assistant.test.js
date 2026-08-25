const test = require("node:test");
const assert = require("node:assert");
const { answer, suggestions } = require("../js/assistant.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];
const vo1 = project.vos[0];   /* VO-001: approved + certified, has a star and a different rate */
const vo3 = project.vos[2];   /* VO-003: draft, unsubmitted */

/* ---------- Intent 1: rate flag ---------- */

test("the rate question on VO-001 names the skirting row and the RM 22.00 contract rate", () => {
    const r = answer("Why is this rate flagged?", { vo: vo1, project: project, role: "consultant" });
    assert.strictEqual(r.intent, "rate-flag");
    const joined = r.lines.join("\n");
    assert.match(joined, /Skirting to match new marble finish/);
    assert.match(joined, /RM 22\.00/);
});

test("the rate question says so when every rate matches", () => {
    const vo = { measurement: [{ id: "M1", bqItemId: "BQ1", description: "Ceramic tiles",
        unit: "m2", qty: 10, rate: 85 }] };
    const r = answer("rate-flag", { vo: vo, project: project, role: "consultant" });
    assert.match(r.lines.join(" "), /match the contract BQ/i);
});

/* ---------- Intent 2: governing clause ---------- */

test("the clause question returns PAM 2018 Clause 11.1", () => {
    const r = answer("What clause applies to this variation?", { vo: vo1, project: project, role: "consultant" });
    assert.strictEqual(r.intent, "clause");
    assert.match(r.lines[0], /PAM 2018 Clause 11\.1/);
});

test("the clause question says the description is too vague when unclassified", () => {
    const vo = { description: "", measurement: [] };
    const r = answer("clause", { vo: vo, project: project, role: "consultant" });
    assert.match(r.lines.join(" "), /too vague/i);
});

/* ---------- Intent 3: consequential elements ---------- */

test("the elements question lists the detected element and its related elements", () => {
    const r = answer("What else might need measuring?", { vo: vo1, project: project, role: "consultant" });
    assert.strictEqual(r.intent, "elements");
    assert.match(r.lines.join("\n"), /Skirting/);
});

test("the elements question says nothing was detected when the description names none", () => {
    const vo = { description: "General remeasurement of provisional sum works", measurement: [] };
    const r = answer("elements", { vo: vo, project: project, role: "consultant" });
    assert.match(r.lines.join(" "), /no building element/i);
});

/* ---------- Intent 4: certification checklist ---------- */

test("the certification question on the unsubmitted VO-003 says it has not been submitted", () => {
    const r = answer("What is missing before this can be certified?",
        { vo: vo3, project: project, role: "consultant" });
    assert.strictEqual(r.intent, "certify");
    assert.match(r.lines[0], /not.*submitted/i);
});

test("the certification question on the fully certified VO-001 shows it is approved and certified", () => {
    const r = answer("certify", { vo: vo1, project: project, role: "consultant" });
    assert.match(r.lines.join("\n"), /Approved\./);
    assert.match(r.lines.join("\n"), /Client certification: Approved/);
});

/* ---------- Intent 5: value ---------- */

test("the value question returns RM 62,808.00 claimed", () => {
    const r = answer("What is this variation worth?", { vo: vo1, project: project, role: "client" });
    assert.strictEqual(r.intent, "value");
    assert.match(r.lines.join("\n"), /Contractor claimed: RM 62,808\.00/);
});

/* ---------- Intent 6: what can I edit here ---------- */

test("the edit question differs by role", () => {
    const contractorAnswer = answer("What can I edit here?", { vo: vo1, project: project, role: "contractor" });
    const clientAnswer = answer("What can I edit here?", { vo: vo1, project: project, role: "client" });
    assert.notStrictEqual(contractorAnswer.lines.join("\n"), clientAnswer.lines.join("\n"));
});

test("a role that may edit a field is told so, plainly", () => {
    const r = answer("edit", { vo: vo1, project: project, role: "client" });
    assert.match(r.lines[0], /finalPrice/);
});

/* ---------- Intent 7: how variations are valued ---------- */

test("the valuation-method question draws its text from the clause knowledge base", () => {
    const r = answer("How do variations get valued?", { vo: vo1, project: project, role: "consultant" });
    assert.strictEqual(r.intent, "valuation-method");
    assert.match(r.lines.join("\n"), /Contract Bills rate/i);
});

/* ---------- unmatched ---------- */

test("an unrecognised question returns unmatched: true and offers suggestions", () => {
    const r = answer("what is the weather today", { vo: vo1, project: project, role: "consultant" });
    assert.strictEqual(r.unmatched, true);
    assert.match(r.lines.join("\n"), /can only answer/i);
    assert.match(r.lines.join("\n"), /Why is this rate flagged/);
});

test("an empty question is unmatched, not a crash", () => {
    const r = answer("", { vo: vo1, project: project, role: "consultant" });
    assert.strictEqual(r.unmatched, true);
});

/* ---------- suggestions() ---------- */

test("suggestions omits the rate question when there is no measurement", () => {
    const vo = { description: "x", measurement: [] };
    const list = suggestions({ vo: vo, project: project, role: "consultant" });
    assert.ok(!list.some(s => s.id === "rate-flag"));
});

test("suggestions includes the rate question when there is measurement", () => {
    const list = suggestions({ vo: vo1, project: project, role: "consultant" });
    assert.ok(list.some(s => s.id === "rate-flag"));
});

test("suggestions omits the certification question for a contractor", () => {
    const list = suggestions({ vo: vo1, project: project, role: "contractor" });
    assert.ok(!list.some(s => s.id === "certify"));
});

test("suggestions offers the certification question for a consultant", () => {
    const list = suggestions({ vo: vo1, project: project, role: "consultant" });
    assert.ok(list.some(s => s.id === "certify"));
});

test("suggestions is empty with no VO in context", () => {
    const list = suggestions({ vo: null, project: project, role: "consultant" });
    assert.deepStrictEqual(list, []);
});
