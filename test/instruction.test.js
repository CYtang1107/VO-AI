const test = require("node:test");
const assert = require("node:assert");

const ins = require("../js/instruction.js");
const { seedDB } = require("../js/store.js");
const { canEdit } = require("../js/permissions.js");
const { renderAdministratorPanel, translateHistoryAction } = require("../js/page-vo.js");

const project = () => seedDB().projects[0];

test("the next number follows the highest in the series, from quoted and issued instructions", () => {
    const p = project();
    assert.strictEqual(ins.nextInstructionNo(p, "AI"), "AI-028", "VO-003 quotes AI-027");
    assert.strictEqual(ins.nextInstructionNo(p, "EI"), "EI-009");
    assert.strictEqual(ins.nextInstructionNo({ vos: [] }, "AI"), "AI-001");
});

test("the form proposes the contractor's own number when it fits, else the next one", () => {
    const p = project();
    const vo3 = p.vos[2];
    assert.deepStrictEqual(ins.proposedInstruction(p, vo3), { kind: "AI", no: "AI-027", confirming: true });
    assert.deepStrictEqual(ins.proposedInstruction(p, Object.assign({}, vo3, { instructionNo: "" })), { kind: "AI", no: "AI-028", confirming: false });
    assert.strictEqual(ins.proposedInstruction(p, Object.assign({}, vo3, { typeOfInstruction: "Engineer's instruction (EI)" })).no, "EI-009");
});

test("a malformed number, or one already issued on another VO, is refused", () => {
    const p = project();
    assert.match(ins.instructionProblem(p, p.vos[2], "AI", "28"), /AI-028/);
    assert.match(ins.instructionProblem(p, p.vos[2], "AI", "AI-021"), /already issued on VO-001/);
    assert.strictEqual(ins.instructionProblem(p, p.vos[2], "AI", "AI-028"), "");
    assert.strictEqual(ins.instructionProblem(p, p.vos[0], "AI", "AI-021"), "", "its own number");
});

test("only the design team issues it, once the VO is submitted", () => {
    const vo = Object.assign({}, project().vos[2]);
    assert.strictEqual(canEdit("issuedInstruction", vo, "administrator"), false, "a draft");
    vo.submitted = true;
    assert.strictEqual(canEdit("issuedInstruction", vo, "administrator"), true);
    assert.strictEqual(canEdit("issuedInstruction", vo, "contractor"), false);
});

test("the design team's panel offers the form until issued, then shows what was issued", () => {
    const p = project();
    const vo = Object.assign({}, p.vos[2], { submitted: true, evaluateStatus: "Pending" });
    assert.match(renderAdministratorPanel(vo, "administrator", p), /id="issueInstrBtn"/);
    assert.doesNotMatch(renderAdministratorPanel(vo, "contractor", p), /issueInstrBtn/);
    const html = renderAdministratorPanel(p.vos[0], "administrator", p);
    assert.match(html, /Architect&#39;s Instruction \(AI\) AI-021 issued/);
    assert.match(html, /report\.html\?mode=instruction&amp;id=VO-SEED-1|report\.html\?mode=instruction&id=VO-SEED-1/);
    assert.strictEqual(translateHistoryAction("Instruction issued — AI-028"), "Instruction issued — AI-028");
});

test("the printed instruction names the clause, the drawings and how it will be valued", () => {
    const p = project();
    const html = ins.renderInstructionSheet(p.vos[0], p);
    assert.match(html, /<h1>Architect&#39;s Instruction \(AI\)<\/h1>/);
    assert.match(html, /AI-021/);
    assert.match(html, /Clause 11 of the PAM 2018/);
    assert.match(html, /A-201 Rev C - Floor Finishes\.pdf/);
    assert.match(html, /Clauses 11\.5 and 11\.6/);
    assert.match(ins.renderInstructionSheet(p.vos[2], p), /No instruction has been issued for VO-003/);
});
