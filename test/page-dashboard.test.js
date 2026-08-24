const test = require("node:test");
const assert = require("node:assert");
const { actionItems, renderStatCards, renderRecentRows } = require("../js/page-dashboard.js");
const { seedDB } = require("../js/store.js");
const { projectStats } = require("../js/calc.js");

const project = seedDB().projects[0];

test("the contractor is told to submit the draft VO", () => {
    const items = actionItems(project, "contractor");
    assert.ok(items.some(i => i.vo.no === "VO-003" && /submit/i.test(i.text)));
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

test("stat cards show the four headline numbers", () => {
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
