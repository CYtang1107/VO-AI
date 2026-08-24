const test = require("node:test");
const assert = require("node:assert");
const { field, renderDocList, renderMeasurementRows, renderHistory } = require("../js/page-vo.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];
const vo1 = project.vos[0];   /* approved + certified */
const vo3 = project.vos[2];   /* contractor draft */

test("a field the role owns and may edit renders as an editable input", () => {
    const html = field({ field: "description", label: "Description", type: "text",
                         value: "x", vo: vo3, role: "contractor" });
    assert.match(html, /class="field owned"/);
    assert.ok(!/disabled/.test(html));
    assert.ok(!/lock-note/.test(html));
});

test("a field owned by another role renders locked with a reason", () => {
    const html = field({ field: "finalPrice", label: "Final price", type: "number",
                         value: "", vo: vo1, role: "contractor" });
    assert.match(html, /class="field locked"/);
    assert.match(html, /disabled/);
    assert.match(html, /lock-note/);
    assert.match(html, /Client/);
});

test("a contractor field on an approved VO is locked with the right reason", () => {
    const html = field({ field: "description", label: "Description", type: "text",
                         value: "x", vo: vo1, role: "contractor" });
    assert.match(html, /class="field locked"/);
    assert.match(html, /already assessed/i);
});

test("select fields render their options and mark the current one", () => {
    const html = field({ field: "evaluateStatus", label: "Status", type: "select",
                         options: ["Pending", "Approved", "Rejected"],
                         value: "Approved", vo: vo1, role: "consultant" });
    assert.match(html, /<select/);
    assert.match(html, /<option value="Approved" selected/);
});

test("a Draft VO's evaluate status select shows Draft as selected, not Pending", () => {
    const html = field({ field: "evaluateStatus", label: "Evaluate status", type: "select",
                         options: ["Pending", "Under Review", "Approved", "Rejected"],
                         value: vo3.evaluateStatus, vo: vo3, role: "consultant" });
    assert.match(html, /<option value="Draft" selected disabled>/);
    assert.ok(!/<option value="Pending" selected/.test(html));
});

test("field values are escaped", () => {
    const html = field({ field: "description", label: "D", type: "text",
                         value: '"><script>x</script>', vo: vo3, role: "contractor" });
    assert.ok(!html.includes("<script>x</script>"));
});

test("each measurement row shows its rate cross-check verdict", () => {
    const html = renderMeasurementRows(vo1, project, "consultant");
    assert.match(html, /rate-flag same/);
    assert.match(html, /rate-flag star/);
    assert.match(html, /rate-flag different/);
    assert.match(html, /contract BQ rate governs/i);
});

test("the contractor cannot edit assessed columns", () => {
    const html = renderMeasurementRows(vo1, project, "contractor");
    const assessedInputs = html.match(/data-col="assessedRate"[^>]*/g) || [];
    assert.ok(assessedInputs.length > 0);
    assert.ok(assessedInputs.every(i => /disabled/.test(i)),
        "assessed rate inputs must be disabled for the contractor");
});

test("history renders every recorded action, newest last", () => {
    const html = renderHistory(vo1);
    assert.match(html, /VO created/);
    assert.match(html, /Certified/);
    assert.ok(html.indexOf("VO created") < html.indexOf("Certified"));
});

test("a VO with no history renders an empty state", () => {
    assert.match(renderHistory({ history: [] }), /empty-state/);
});

test("a contractor on a Draft VO gets a file picker and remove controls", () => {
    const html = renderDocList(vo3, "revisedDrawing", "Revised drawing", "contractor");
    assert.match(html, /class="field doc-field owned"/);
    assert.match(html, /<input type="file" multiple/);
    assert.ok(!/lock-note/.test(html));
});

test("a consultant on the same VO gets the list read-only, with a lock note and no picker", () => {
    const html = renderDocList(vo3, "revisedDrawing", "Revised drawing", "consultant");
    assert.match(html, /class="field doc-field locked"/);
    assert.match(html, /lock-note/);
    assert.ok(!/<input type="file"/.test(html));
});

test("a contractor on an Approved VO gets it read-only with a lock note", () => {
    const html = renderDocList(vo1, "revisedDrawing", "Revised drawing", "contractor");
    assert.match(html, /class="field doc-field locked"/);
    assert.match(html, /lock-note/);
    assert.match(html, /already assessed/i);
    assert.ok(!/<input type="file"/.test(html));
});

test("seeded VO-001's revised drawing renders its actual file name", () => {
    const html = renderDocList(vo1, "revisedDrawing", "Revised drawing", "consultant");
    assert.match(html, /A-201 Rev C - Floor Finishes\.pdf/);
});

test("a field with no documents renders an empty state rather than a broken list", () => {
    const html = renderDocList(vo3, "supportingDocs", "Supporting documents", "contractor");
    assert.match(html, /empty-state/);
    assert.ok(!/<ul class="doc-list">/.test(html));
});

test("a document name containing markup is escaped", () => {
    const dirty = { revisedDrawing: [{ id: "F9", name: '<img src=x onerror=alert(1)>.pdf',
                                        size: 100, uploadedBy: "x", at: "2026-08-01" }] };
    const html = renderDocList(dirty, "revisedDrawing", "Revised drawing", "contractor");
    assert.ok(!html.includes("<img src=x onerror=alert(1)>.pdf"));
});
