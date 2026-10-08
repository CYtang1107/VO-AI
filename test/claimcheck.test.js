const test = require("node:test");
const assert = require("node:assert");

const { claimCheck, contractForm, renderClaimCheck } = require("../js/claimcheck.js");
const { seedDB } = require("../js/store.js");

const project = () => seedDB().projects[0];
const vo = (over) => Object.assign(JSON.parse(JSON.stringify(project().vos[0])), over || {});

test("the demo's VO-001 (AI-021, measured, drawings attached) is claimable under PAM 2018", () => {
    const r = claimCheck(vo(), project());
    assert.strictEqual(r.form, "PAM 2018");
    assert.strictEqual(r.verdict, "claimable");
    assert.deepStrictEqual(r.checks.map(c => c.id), ["variation", "instruction", "particulars", "valuation"]);
    assert.ok(r.checks.every(c => c.state === "ok" || c.state === "info"));
    assert.strictEqual(r.checks[0].clause, "PAM 2018 Clause 11.1");
    assert.strictEqual(r.checks[1].clause, "PAM 2018 Clause 2.2");
    assert.match(r.checks[1].reason, /AI-021/);
    assert.match(r.checks[3].reason, /fair market rates/, "the marble row has no BQ item");
});

test("putting right the contractor's own defective work is not a variation (cl. 11.1)", () => {
    ["Rectify defective floor tiles in living area", "Rework of skirting not in accordance with specification", "客厅地砖返工"]
        .forEach(d => {
            const r = claimCheck(vo({ description: d }), project());
            assert.strictEqual(r.verdict, "notClaimable", d);
            assert.strictEqual(r.checks[0].state, "fail");
            assert.match(r.checks[0].reason, /own cost/);
        });
});

test("no written instruction, an Engineer's Instruction under PAM, or no measurement: needs information", () => {
    let r = claimCheck(vo({ instructionNo: "", issuedInstruction: null }), project());
    assert.strictEqual(r.verdict, "needsInfo");
    assert.match(r.checks.find(c => c.id === "instruction").reason, /CAI/);

    r = claimCheck(vo({ typeOfInstruction: "Engineer's instruction (EI)", instructionNo: "EI-04", instructionStatus: "Pending" }), project());
    assert.strictEqual(r.verdict, "needsInfo");
    assert.match(r.checks.find(c => c.id === "instruction").reason, /EI-04.*Architect/);
    r = claimCheck(vo({ typeOfInstruction: "Engineer's instruction (EI)", instructionNo: "EI-04", instructionStatus: "Confirmed" }), project());
    assert.strictEqual(r.checks.find(c => c.id === "instruction").state, "ok", "the design team confirmed it");

    r = claimCheck(vo({ measurement: [], revisedDrawing: [], supportingDocs: [] }), project());
    const p = r.checks.find(c => c.id === "particulars");
    assert.strictEqual(p.state, "missing");
    assert.match(p.reason, /measurement.*drawing/);
    assert.ok(!r.checks.some(c => c.id === "valuation"), "nothing to value yet");
});

test("a vague description cannot be classified, and an off-site photo is flagged as missing evidence", () => {
    let r = claimCheck(vo({ description: "", measurement: [] }), project());
    assert.strictEqual(r.checks[0].state, "missing");
    const v = vo();
    v.supportingDocs.push({ id: "X", name: "elsewhere.jpg", geo: { lat: 3.3, lng: 101.5, src: "exif" } });
    r = claimCheck(v, project());
    assert.strictEqual(r.verdict, "needsInfo");
    assert.match(r.checks.find(c => c.id === "particulars").reason, /1 photo\(s\) not taken on the site/);
});

test("after practical completion, only when the project records it", () => {
    const p = Object.assign(project(), { practicalCompletion: "2026-07-01" });
    const r = claimCheck(vo({ dateIssued: "2026-07-14" }), p);
    assert.strictEqual(r.checks.find(c => c.id === "timing").clause, "PAM 2018 Clause 11.3");
    assert.strictEqual(r.verdict, "needsInfo");
    assert.ok(!claimCheck(vo(), project()).checks.some(c => c.id === "timing"));
});

test("a PWD 203 project cites its own clauses (Rev. 2007): 24.2, 5.2, 27.1, 25.1", () => {
    const p = project();
    p.documents = [{ id: "D", name: "PWD Form 203 Rev. 2007.pdf" }];
    assert.strictEqual(contractForm(p), "PWD 203");
    const r = claimCheck(vo({ instructionNo: "", issuedInstruction: null }), p);
    assert.deepStrictEqual(r.checks.map(c => c.clause),
        ["PWD 203 Clause 24.2", "PWD 203 Clause 5.2", "PWD 203 Clause 27.1", "PWD 203 Clause 25.1"]);
    assert.match(r.checks.find(c => c.id === "instruction").reason, /Superintending Officer.*7 days/);
    const late = Object.assign(project(), { documents: p.documents, practicalCompletion: "2026-07-01" });
    assert.ok(!claimCheck(vo({ dateIssued: "2026-07-14" }), late).checks.some(c => c.id === "timing"), "no clause like PAM 11.3");
});

test("a PWD 203A project cites clause 24", () => {
    const p = project();
    p.documents = [{ id: "D", name: "PWD 203A Conditions of Contract.pdf" }];
    assert.strictEqual(contractForm(p), "PWD 203A");
    assert.ok(claimCheck(vo({ instructionNo: "", issuedInstruction: null }), p).checks.every(c => c.clause === "PWD 203A Clause 24"));
    assert.strictEqual(contractForm({ documents: [{ name: "JKR contract.pdf" }] }), "PWD 203");
    assert.strictEqual(contractForm(project()), "PAM 2018");
});

test("the card shows the verdict, each check with its clause, and what was recorded at submission", () => {
    const html = renderClaimCheck(claimCheck(vo({ instructionNo: "", issuedInstruction: null }), project()), { recorded: { verdict: "claimable", at: "14 Jul 2026" } });
    assert.match(html, /Needs information/);
    assert.match(html, /PAM 2018 Clause 2\.2/);
    assert.match(html, /At submission the contract agent said: Claimable \(14 Jul 2026\)/);
});

test("an approved VO's check is a record: no new 'needs information', what is missing since is only noted", () => {
    const { renderClaimCheck } = require("../js/claimcheck.js");
    const result = { verdict: "needsInfo", form: "PAM 2018", checks: [{ id: "particulars", clause: "PAM 2018 Clause 11.5", state: "missing", reason: "Missing: 3 photo(s) not taken on site." }] };
    const live = renderClaimCheck(result, {});
    assert.match(live, /claim-needsInfo/);
    const kept = renderClaimCheck(result, { settled: "approved", recorded: { verdict: "claimable", at: "1 Sep 2026" } });
    assert.match(kept, /claim-verdict claim-claimable/);
    assert.match(kept, /approved and closed/);
    assert.match(kept, /claim-check claim-info/);
    assert.doesNotMatch(kept, /claim-check claim-missing/);
});
