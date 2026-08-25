const test = require("node:test");
const assert = require("node:assert");
const { renderReport, renderSummaryReport } = require("../js/page-report.js");
const { seedDB } = require("../js/store.js");
const { contractorTotal, assessedTotal } = require("../js/calc.js");

const project = seedDB().projects[0];
const vo1 = project.vos[0];
const vo2 = project.vos[1];
const vo3 = project.vos[2];

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

test("the certified value is only shown for a VO that is actually certified", () => {
    const html2 = renderReport(vo2, project);
    const totalsBlock = html2.slice(html2.indexOf("Certified value"), html2.indexOf("Certified value") + 200);
    assert.ok(!/RM [\d,]+\.\d{2}/.test(totalsBlock),
        "an uncertified VO must not show a ringgit figure under Certified value");
    assert.match(totalsBlock, /—/);

    const html1 = renderReport(vo1, project);
    assert.match(html1, /RM 55,856\.00/);
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

/* -----------------------------------------------------------
   Section order — the client's required spine, with the professional
   sections arranged around it.
----------------------------------------------------------- */

test("sections appear in the required sequence", () => {
    const html = renderReport(vo1, project);
    const order = [
        "1. Instruction",
        "2. Classification and affected elements",
        "3. Contractual basis",
        "4. Revised drawing",
        "5. Old drawing",
        "6. Measurement and valuation",
        "7. Supporting documents",
        "8. Findings",
        "9. Time impact",
        "10. Status and signatures"
    ];
    const positions = order.map(s => html.indexOf(s));
    positions.forEach((pos, i) => {
        assert.ok(pos !== -1, "missing section: " + order[i]);
    });
    for (let i = 1; i < positions.length; i++) {
        assert.ok(positions[i] > positions[i - 1],
            order[i - 1] + " must come before " + order[i]);
    }
});

test("revised drawing, old drawing and supporting documents each get their own section with the attachment date", () => {
    const html = renderReport(vo1, project);
    const revisedIdx = html.indexOf("4. Revised drawing");
    const oldIdx = html.indexOf("5. Old drawing");
    const measurementIdx = html.indexOf("6. Measurement");
    const supportingIdx = html.indexOf("7. Supporting documents");
    const findingsIdx = html.indexOf("8. Findings");

    const revisedBlock = html.slice(revisedIdx, oldIdx);
    assert.match(revisedBlock, /A-201 Rev C - Floor Finishes\.pdf/);
    assert.match(revisedBlock, /attached 14 Jul 2026/);

    const oldBlock = html.slice(oldIdx, measurementIdx);
    assert.match(oldBlock, /A-201 Rev B - Floor Finishes\.pdf/);
    assert.match(oldBlock, /attached 14 Jul 2026/);

    const supportingBlock = html.slice(supportingIdx, findingsIdx);
    assert.match(supportingBlock, /Marble supplier quotation\.pdf/);
    assert.match(supportingBlock, /attached 15 Jul 2026/);
});

test("a VO with no attachments still renders each document section without malformed markup", () => {
    const html = renderReport(vo3, project);
    assert.match(html, /No revised drawing attached/);
    assert.match(html, /No superseded drawing attached/);
    assert.match(html, /No supporting document attached/);
    assert.doesNotMatch(html, /<ul class="report-doc-list"><\/ul>/);
});

/* -----------------------------------------------------------
   Role-specific content
----------------------------------------------------------- */

test("the contractor's report shows claimed measurement in full, without the rate cross-check working", () => {
    const html = renderReport(vo1, project, "contractor");
    assert.match(html, /Omit ceramic floor tiles/);
    assert.match(html, /RM 62,808\.00/);
    assert.doesNotMatch(html, /rate-flag/);
    assert.doesNotMatch(html, /RATE CROSS-CHECK/);
});

test("the contractor's report shows the consultant's assessment and variance, marked read-only, when one exists", () => {
    const html = renderReport(vo1, project, "contractor");
    assert.match(html, /Consultant assessed \(read-only\)/);
    assert.match(html, /Variance \(read-only\)/);
    assert.match(html, /Consultant's assessment:/);
});

test("the contractor's report does not carry the consultant's recommendation to the client", () => {
    const html = renderReport(vo1, project, "contractor");
    assert.doesNotMatch(html, /Consultant's recommendation/);
    assert.doesNotMatch(html, /Recommend approval at the assessed value/);
});

test("an unassessed VO's contractor report does not label totals read-only", () => {
    const html = renderReport(vo2, project, "contractor");
    assert.doesNotMatch(html, /read-only/);
});

test("the consultant's report is the fullest version: every row's rate cross-check, findings, variance and recommendation", () => {
    const html = renderReport(vo1, project, "consultant");
    assert.strictEqual((html.match(/rate-flag/g) || []).length, 3);
    assert.match(html, /RATE CROSS-CHECK/);
    assert.match(html, /Consultant's recommendation:/);
    assert.match(html, /Recommend approval at the assessed value/);
    assert.match(html, /Variance<\/small>/);
});

test("the client's report is decision-focused: no itemised measurement table, but the values, time impact and recommendation are present", () => {
    const html = renderReport(vo1, project, "client");
    assert.doesNotMatch(html, /rate-flag/);
    assert.doesNotMatch(html, /RATE CROSS-CHECK/);
    assert.doesNotMatch(html, /Omit ceramic floor tiles/);
    assert.match(html, /RM 62,808\.00/);   /* claimed */
    assert.match(html, /RM 55,856\.00/);   /* certified */
    assert.match(html, /7 day\(s\) claimed extension of time/);
    assert.match(html, /Consultant's recommendation:/);
    assert.match(html, /PAM 2018/);        /* still contractually a variation, with clause */
});

test("no version of the report shows a certified value for a VO that is not certified", () => {
    ["contractor", "consultant", "client", undefined].forEach(role => {
        const html = renderReport(vo2, project, role);
        const idx = html.indexOf("Certified value");
        const block = html.slice(idx, idx + 200);
        assert.ok(!/RM [\d,]+\.\d{2}/.test(block),
            "role " + role + " must not show a certified figure for an uncertified VO");
    });
});

test("every role's report keeps the professional-review disclaimer and signature blocks", () => {
    ["contractor", "consultant", "client", undefined].forEach(role => {
        const html = renderReport(vo1, project, role);
        assert.match(html, /Professional Review Required/);
        assert.match(html, /Contractor QS/);
        assert.match(html, /Consultant QS/);
        assert.match(html, /Client \/ Developer/);
    });
});

/* -----------------------------------------------------------
   All-VO summary report
----------------------------------------------------------- */

test("the summary lists one row per VO with number, description, dates, statuses, values and time impact", () => {
    const html = renderSummaryReport(project);
    assert.match(html, /VO-001/);
    assert.match(html, /VO-002/);
    assert.match(html, /VO-003/);
    assert.match(html, /Change of living area floor finish/);
    assert.match(html, /Approved/);
    assert.match(html, /Pending/);
});

test("the summary totals equal the sum of the rows", () => {
    const html = renderSummaryReport(project);
    const expectedClaimed = project.vos.reduce((s, v) => s + contractorTotal(v), 0);
    const expectedAssessed = project.vos.reduce((s, v) => s + assessedTotal(v), 0);
    const expectedCertified = project.vos.reduce((s, v) =>
        s + ((v.certifiedStatus === "Approved" && v.finalPrice) ? Number(v.finalPrice) : 0), 0);
    const expectedTime = project.vos
        .filter(v => v.evaluateStatus === "Approved")
        .reduce((s, v) => s + (Number(v.timeImpact) || 0), 0);

    const rm = n => "RM " + n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    assert.match(html, new RegExp("Total claimed</small><strong>" + rm(expectedClaimed).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp("Total assessed</small><strong>" + rm(expectedAssessed).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp("Total certified</small><strong>" + rm(expectedCertified).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp("Total approved time impact</small><strong>" + expectedTime + " day\\(s\\)"));
});

test("the summary shows no certified figure for a VO that is not certified", () => {
    const html = renderSummaryReport(project);
    const rowStart = html.indexOf("VO-002");
    const rowEnd = html.indexOf("</tr>", rowStart);
    const row = html.slice(rowStart, rowEnd);
    /* VO-002 is Pending / Pending — its CERTIFIED cell must be an em dash,
       not a provisional ringgit figure. */
    const cells = row.split("</td>");
    const certifiedCell = cells[7]; /* claimed, assessed precede it */
    assert.match(certifiedCell, /—/);
    assert.doesNotMatch(certifiedCell, /RM [\d,]+\.\d{2}/);
});

test("the summary shows the certified total as a percentage of the contract sum", () => {
    const html = renderSummaryReport(project);
    assert.match(html, /% of the contract sum/);
});

test("the summary handles a project with zero VOs", () => {
    const emptyProject = Object.assign({}, project, { vos: [] });
    const html = renderSummaryReport(emptyProject);
    assert.match(html, /No variation orders on this project/);
    assert.match(html, /Total claimed<\/small><strong>RM 0\.00/);
    assert.match(html, /Total certified<\/small><strong>RM 0\.00/);
});

test("seeded VO-001 still reports RM 62,808.00 claimed and RM 55,856.00 certified in the summary", () => {
    const html = renderSummaryReport(project);
    const rowStart = html.indexOf("VO-001");
    const rowEnd = html.indexOf("</tr>", rowStart);
    const row = html.slice(rowStart, rowEnd);
    assert.match(row, /RM 62,808\.00/);
    assert.match(row, /RM 55,856\.00/);
});
