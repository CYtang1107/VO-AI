const test = require("node:test");
const assert = require("node:assert");
const { renderReport } = require("../js/page-report.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];
const vo1 = project.vos[0];

test("the report names the project and contract, per the template rule", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /Cadangan Pembangunan ABC Residence/);
    assert.match(html, /ABC\/2026\/014/);
});

test("the report carries the VO identity and instruction reference", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /VO-001/);
    assert.match(html, /AI-021/);
});

test("the report itemises every measurement row with its rate verdict", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /Omit ceramic floor tiles/);
    assert.match(html, /contract BQ rate governs/i);
    assert.strictEqual((html.match(/rate-flag/g) || []).length, 3);
});

test("the report states the governing contract clause", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /PAM 2018/);
    assert.match(html, /Clause 11\.1/);
});

test("the report shows claimed, assessed and certified values", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /RM 62,808\.00/);   /* contractor claimed */
    assert.match(html, /RM 55,856\.00/);   /* certified final price */
});

test("the report lists supporting documents", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /Marble supplier quotation\.pdf/);
    assert.match(html, /A-201 Rev C/);
});

test("the report always carries the professional review disclaimer", () => {
    assert.match(renderReport(vo1, project), /Professional Review Required/);
});

test("a report for an empty VO renders without throwing", () => {
    const html = renderReport({
        no: "VO-009", description: "", dateIssued: "", instructionNo: "",
        typeOfInstruction: "", measurement: [], revisedDrawing: [], oldDrawing: [],
        supportingDocs: [], history: [], evaluateStatus: "Draft",
        certifiedStatus: "Pending", finalPrice: null, timeImpact: 0
    }, project);
    assert.match(html, /VO-009/);
});
