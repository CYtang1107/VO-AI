const test = require("node:test");
const assert = require("node:assert");

const { canEdit, instructionConfirmed, caCertified, FIELD_OWNER } = require("../js/permissions.js");
const { seedDB, ROLES } = require("../js/store.js");
const { renderAdministratorPanel } = require("../js/page-vo.js");

const vo = over => Object.assign({ evaluateStatus: "Draft", submitted: false, instructionStatus: "Pending", caCertifiedStatus: "Pending" }, over);

test("the contract administrator owns the instruction and certification fields", () => {
    ["instructionStatus", "instructionNote", "caCertifiedStatus", "caRemark"].forEach(f =>
        assert.strictEqual(FIELD_OWNER[f], "administrator", f));
    assert.ok(ROLES.administrator && ROLES.administrator.label);
});

test("the design team works the VO only while it waits for its approval", () => {
    assert.strictEqual(canEdit("instructionStatus", vo(), "administrator"), false, "still being described");
    const sent = vo({ sentToDesign: true });
    ["instructionStatus", "issuedInstruction", "oldDrawing", "revisedDrawing", "designDocs"].forEach(f =>
        assert.strictEqual(canEdit(f, sent, "administrator"), true, f));
    assert.strictEqual(canEdit("revisedDrawing", sent, "contractor"), false, "the drawings are the design team's");
    const approvedByDesign = vo({ sentToDesign: true, instructionStatus: "Confirmed" });
    assert.strictEqual(canEdit("instructionStatus", approvedByDesign, "administrator"), false);
    assert.strictEqual(canEdit("caCertifiedStatus", vo({ submitted: true, evaluateStatus: "Approved" }), "administrator"), false, "no certify step any more");
});

test("a VO saved before this workflow lands in the right stage", () => {
    const old = { submitted: true, evaluateStatus: "Approved" };   /* no design team fields at all */
    assert.strictEqual(instructionConfirmed(old), true);
    assert.strictEqual(caCertified(old), true);
    assert.strictEqual(canEdit("certifiedStatus", old, "client"), true);
    assert.strictEqual(canEdit("evaluateStatus", { submitted: true, evaluateStatus: "Pending" }, "consultant"), true);
    assert.strictEqual(instructionConfirmed({ submitted: false }), false);
});

test("the demo VOs sit at the right steps, and the panel says what each step checks", () => {
    const [v1, v2, v3] = seedDB().projects[0].vos;
    assert.deepStrictEqual([v1.instructionStatus, v1.caCertifiedStatus], ["Confirmed", "Certified"]);
    assert.deepStrictEqual([v2.instructionStatus, v2.caCertifiedStatus], ["Confirmed", "Pending"]);
    assert.deepStrictEqual([v3.instructionStatus, v3.caCertifiedStatus], ["Pending", "Pending"]);
    const html = renderAdministratorPanel(v2, "administrator");
    assert.match(html, /EI-008/);
    assert.match(html, /Waiting for the consultant QS to approve the value/);
    assert.match(renderAdministratorPanel(v1, "administrator"), /The consultant QS approved RM 55,856\.00/);
});
