const test = require("node:test");
const assert = require("node:assert");
const {
    rm, today, prettyDate, lineTotal,
    contractorTotal, assessedTotal, voValue, projectStats
} = require("../js/calc.js");

test("rm formats ringgit with two decimals and thousands separators", () => {
    assert.strictEqual(rm(1234), "RM 1,234.00");
    assert.strictEqual(rm(0), "RM 0.00");
    assert.strictEqual(rm(-500.5), "RM -500.50");
    assert.strictEqual(rm(""), "RM 0.00");
    assert.strictEqual(rm(null), "RM 0.00");
});

test("today returns an ISO date string", () => {
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test("prettyDate renders a readable date and an em dash for empty", () => {
    assert.strictEqual(prettyDate(""), "—");
    assert.strictEqual(prettyDate(null), "—");
    assert.match(prettyDate("2026-07-14"), /Jul/);
});

test("lineTotal multiplies quantity by rate and tolerates blanks", () => {
    assert.strictEqual(lineTotal(10, 5), 50);
    assert.strictEqual(lineTotal(-320, 85), -27200);
    assert.strictEqual(lineTotal("", 5), 0);
});

test("contractorTotal sums the contractor's claimed rows", () => {
    const vo = { measurement: [
        { qty: -320, rate: 85 },
        { qty: 320, rate: 265 }
    ] };
    assert.strictEqual(contractorTotal(vo), 57600);
});

test("assessedTotal falls back to contractor figures on unassessed rows", () => {
    const vo = { measurement: [
        { qty: 100, rate: 10, assessedQty: 90, assessedRate: 10 },
        { qty: 100, rate: 10, assessedQty: "", assessedRate: "" }
    ] };
    assert.strictEqual(assessedTotal(vo), 900 + 1000);
});

test("voValue prefers the certified final price", () => {
    const base = { measurement: [{ qty: 1, rate: 100 }] };
    assert.strictEqual(voValue({ ...base, certifiedStatus: "Pending", finalPrice: null }), 100);
    assert.strictEqual(voValue({ ...base, certifiedStatus: "Approved", finalPrice: 88 }), 88);
});

test("projectStats counts by status and excludes drafts from value", () => {
    const project = { vos: [
        { evaluateStatus: "Draft", certifiedStatus: "Pending", timeImpact: 5,
          measurement: [{ qty: 1, rate: 1000 }] },
        { evaluateStatus: "Pending", certifiedStatus: "Pending", timeImpact: 0,
          measurement: [{ qty: 1, rate: 200 }] },
        { evaluateStatus: "Approved", certifiedStatus: "Approved", finalPrice: 300,
          timeImpact: 7, measurement: [{ qty: 1, rate: 400 }] }
    ] };
    const s = projectStats(project);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.draft, 1);
    assert.strictEqual(s.pending, 1);
    assert.strictEqual(s.approved, 1);
    assert.strictEqual(s.certified, 1);
    assert.strictEqual(s.value, 500);      // 200 + 300, draft excluded
    assert.strictEqual(s.timeImpact, 7);   // approved only
});
