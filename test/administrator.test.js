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

test("the five steps unlock in order: submit → confirm → value → certify → approve", () => {
    const draft = vo();
    assert.strictEqual(canEdit("instructionStatus", draft, "administrator"), false, "nothing to confirm before submission");
    const submitted = vo({ submitted: true, evaluateStatus: "Pending" });
    assert.strictEqual(canEdit("instructionStatus", submitted, "administrator"), true);
    assert.strictEqual(canEdit("evaluateStatus", submitted, "consultant"), false, "the QS waits for the confirmed instruction");
    const confirmed = Object.assign({}, submitted, { instructionStatus: "Confirmed" });
    assert.strictEqual(canEdit("evaluateStatus", confirmed, "consultant"), true);
    assert.strictEqual(canEdit("caCertifiedStatus", confirmed, "administrator"), false, "nothing to certify before the QS approves");
    const approved = Object.assign({}, confirmed, { evaluateStatus: "Approved" });
    assert.strictEqual(canEdit("caCertifiedStatus", approved, "administrator"), true);
    assert.strictEqual(canEdit("certifiedStatus", approved, "client"), false, "the client waits for certification");
    const certified = Object.assign({}, approved, { caCertifiedStatus: "Certified" });
    assert.strictEqual(canEdit("certifiedStatus", certified, "client"), true);
    assert.strictEqual(canEdit("instructionStatus", certified, "contractor"), false, "only the administrator confirms");
});

test("a VO saved before the role existed is not held back", () => {
    const old = { submitted: true, evaluateStatus: "Approved" };   /* no administrator fields at all */
    assert.strictEqual(instructionConfirmed(old), true);
    assert.strictEqual(caCertified(old), true);
    assert.strictEqual(canEdit("evaluateStatus", old, "consultant"), true);
    assert.strictEqual(canEdit("certifiedStatus", old, "client"), true);
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
