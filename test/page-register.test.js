const test = require("node:test");
const assert = require("node:assert");
const { columnsForRole, renderRegisterHead, renderRegisterBody, filterVos } =
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

/* ---------- filterVos ---------- */

test("filterVos matches on VO number", () => {
    const result = filterVos(project.vos, { query: "vo-002" });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].no, "VO-002");
});

test("filterVos matches on description, case-insensitively", () => {
    const result = filterVos(project.vos, { query: "MARBLE" });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].no, "VO-001");
});

test("filterVos matches on the instruction reference", () => {
    const result = filterVos(project.vos, { query: "ei-008" });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].no, "VO-002");
});

test("filterVos combines a text query with the evaluate status filter", () => {
    const result = filterVos(project.vos, { query: "revision", evaluateStatus: "Draft" });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].no, "VO-003");

    const noMatch = filterVos(project.vos, { query: "revision", evaluateStatus: "Approved" });
    assert.strictEqual(noMatch.length, 0);
});

test("filterVos combines a text query with the certified status filter", () => {
    const result = filterVos(project.vos, { query: "vo", certifiedStatus: "Approved" });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].no, "VO-001");
});

test("filterVos returns everything when nothing is set", () => {
    assert.strictEqual(filterVos(project.vos, {}).length, project.vos.length);
    assert.strictEqual(filterVos(project.vos, { query: "", evaluateStatus: "all", certifiedStatus: "all" }).length,
        project.vos.length);
});

test("filterVos returns empty for a query matching nothing", () => {
    assert.strictEqual(filterVos(project.vos, { query: "no-such-vo-anywhere" }).length, 0);
});

test("a filtered-empty register renders the honest 'no match' message, not the generic empty message", () => {
    const body = renderRegisterBody(project, "client", { vos: [], filtered: true });
    assert.match(body, /match your search/i);
    assert.ok(!/No variation orders in this project yet/.test(body));
});

test("a genuinely empty project still renders the generic empty message when not filtered", () => {
    const body = renderRegisterBody({ vos: [], bq: [] }, "client", { filtered: false });
    assert.match(body, /No variation orders in this project yet/);
});
