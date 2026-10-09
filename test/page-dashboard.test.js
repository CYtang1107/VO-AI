const test = require("node:test");
const assert = require("node:assert");
const { actionItems, renderRecentRows } = require("../js/page-dashboard.js");
const { renderStatCards } = require("../js/page-register.js");
const { seedDB } = require("../js/store.js");
const { projectStats } = require("../js/calc.js");

const project = seedDB().projects[0];

test("the contractor is told to describe the draft VO and send it to the design team", () => {
    const items = actionItems(project, "contractor");
    assert.ok(items.some(i => i.vo.no === "VO-003" && /design team/i.test(i.text)));
});

test("the consultant is told to assess the submitted VO", () => {
    const items = actionItems(project, "consultant");
    assert.ok(items.some(i => i.vo.no === "VO-002" && /assess/i.test(i.text)));
    assert.ok(!items.some(i => i.vo.no === "VO-003"),
        "an unsubmitted draft is not the consultant's problem");
});

test("the client only sees VOs that are approved and not yet certified", () => {
    const items = actionItems(project, "client");
    assert.ok(!items.some(i => i.vo.no === "VO-002"));
    assert.ok(!items.some(i => i.vo.no === "VO-001"),
        "VO-001 is already certified");
});

test("stat cards (now on the VO register) show the four headline numbers", () => {
    const html = renderStatCards(projectStats(project), "consultant");
    assert.match(html, /Total VOs/);
    assert.match(html, /Pending/);
    assert.match(html, /Approved/);
    assert.match(html, /RM /);
});

test("recent rows render newest first and carry a status pill", () => {
    const html = renderRecentRows(project.vos);
    assert.match(html, /class="status/);
    assert.ok(html.indexOf("VO-003") < html.indexOf("VO-001"),
        "newest VO should appear first");
});

test("needs-your-attention puts the most urgent contract deadline first and names its rule", () => {
    const { actionItems } = require("../js/page-dashboard.js");
    const project = { vos: [
        { id: "A", no: "VO-1", sentToDesign: true, instructionStatus: "Confirmed", measurement: [] },
        { id: "B", no: "VO-2", submitted: true, instructionStatus: "Confirmed", dateIssued: "2026-09-01",
          infoRequestedAt: "2026-09-05", infoRequestNote: "x", measurement: [], evaluateStatus: "Pending", certifiedStatus: "Pending" }
    ] };
    const items = actionItems(project, "contractor", "2026-10-09");
    assert.strictEqual(items[0].vo.id, "B");
    assert.strictEqual(items[0].deadline.state, "overdue");
    assert.strictEqual(items[1].deadline, null);
});
