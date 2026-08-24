const test = require("node:test");
const assert = require("node:assert");
const { columnsForRole, renderRegisterHead, renderRegisterBody } =
    require("../js/page-register.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];

test("every role sees every column — the client reads everything", () => {
    const contractorCols = columnsForRole("contractor").map(c => c.field);
    const clientCols = columnsForRole("client").map(c => c.field);
    assert.deepStrictEqual(contractorCols, clientCols);
    assert.ok(clientCols.includes("finalPrice"));
    assert.ok(clientCols.includes("measurement"));
});

test("the header marks only the signed-in role's own columns", () => {
    const head = renderRegisterHead("contractor");
    assert.match(head, /owned-col[^>]*>\s*DESCRIPTION/i);
    assert.ok(!/owned-col[^>]*>\s*FINAL PRICE/i.test(head),
        "final price belongs to the client, not the contractor");

    const clientHead = renderRegisterHead("client");
    assert.match(clientHead, /owned-col[^>]*>\s*FINAL PRICE/i);
});

test("the body renders one row per VO", () => {
    const body = renderRegisterBody(project, "consultant");
    assert.strictEqual((body.match(/<tr/g) || []).length, 3);
    assert.match(body, /VO-001/);
    assert.match(body, /VO-003/);
});

test("the register surfaces the rate cross-check result per VO", () => {
    const body = renderRegisterBody(project, "consultant");
    assert.match(body, /rate-flag different/);
});

test("an empty project renders an empty state, not a broken table", () => {
    const body = renderRegisterBody({ vos: [], bq: [] }, "client");
    assert.match(body, /empty-state/);
});

test("descriptions are escaped", () => {
    const body = renderRegisterBody({
        bq: [],
        vos: [{ id: "V", no: "VO-001", description: "<b>x</b>", dateIssued: "",
                measurement: [], evaluateStatus: "Draft", certifiedStatus: "Pending",
                timeImpact: 0, finalPrice: null }]
    }, "client");
    assert.ok(!body.includes("<b>x</b>"));
});
