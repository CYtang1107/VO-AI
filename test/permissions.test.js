const test = require("node:test");
const assert = require("node:assert");
const { FIELD_OWNER, canEdit, lockReason } = require("../js/permissions.js");

const draft     = { submitted: false, evaluateStatus: "Draft",    certifiedStatus: "Pending" };
const submitted = { submitted: true,  evaluateStatus: "Pending",  certifiedStatus: "Pending" };
const approved  = { submitted: true,  evaluateStatus: "Approved", certifiedStatus: "Pending" };

test("every owned field maps to exactly one role", () => {
    assert.strictEqual(FIELD_OWNER.description, "contractor");
    assert.strictEqual(FIELD_OWNER.evaluateStatus, "consultant");
    assert.strictEqual(FIELD_OWNER.finalPrice, "client");
});

test("a role can never edit another role's column", () => {
    assert.strictEqual(canEdit("finalPrice", approved, "contractor"), false);
    assert.strictEqual(canEdit("description", draft, "consultant"), false);
    assert.strictEqual(canEdit("evaluateStatus", submitted, "client"), false);
});

test("contractor edits its own columns until the consultant approves", () => {
    assert.strictEqual(canEdit("description", draft, "contractor"), true);
    assert.strictEqual(canEdit("measurement", submitted, "contractor"), true);
    assert.strictEqual(canEdit("description", approved, "contractor"), false);
});

test("a rejected VO reopens for the contractor", () => {
    const rejected = { submitted: true, evaluateStatus: "Rejected", certifiedStatus: "Pending" };
    assert.strictEqual(canEdit("description", rejected, "contractor"), true);
});

test("consultant cannot assess until the contractor submits", () => {
    assert.strictEqual(canEdit("evaluateStatus", draft, "consultant"), false);
    assert.strictEqual(canEdit("evaluateStatus", submitted, "consultant"), true);
});

test("client cannot certify until the consultant approves", () => {
    assert.strictEqual(canEdit("finalPrice", submitted, "client"), false);
    assert.strictEqual(canEdit("finalPrice", approved, "client"), true);
});

test("the client's request-for-further-information fields are client-owned", () => {
    assert.strictEqual(FIELD_OWNER.clientInfoRequestedAt, "client");
    assert.strictEqual(FIELD_OWNER.clientInfoRequestNote, "client");
});

test("the client can only edit its info-request fields under the same gating as its other fields", () => {
    assert.strictEqual(canEdit("clientInfoRequestedAt", submitted, "client"), false);
    assert.strictEqual(canEdit("clientInfoRequestedAt", approved, "client"), true);
    assert.strictEqual(canEdit("clientInfoRequestNote", approved, "client"), true);
});

test("nobody but the client may edit the client's info-request fields", () => {
    assert.strictEqual(canEdit("clientInfoRequestedAt", approved, "contractor"), false);
    assert.strictEqual(canEdit("clientInfoRequestedAt", approved, "consultant"), false);
    assert.strictEqual(canEdit("clientInfoRequestNote", approved, "contractor"), false);
    assert.strictEqual(canEdit("clientInfoRequestNote", approved, "consultant"), false);
});

test("lockReason explains the block and is empty when editable", () => {
    assert.strictEqual(lockReason("description", draft, "contractor"), "");
    assert.match(lockReason("evaluateStatus", draft, "consultant"), /submit/i);
    assert.match(lockReason("finalPrice", submitted, "client"), /consultant/i);
    assert.match(lockReason("finalPrice", approved, "contractor"), /Client/);
});
