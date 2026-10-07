const test = require("node:test");
const assert = require("node:assert");

const { canDeleteVO } = require("../js/permissions.js");
const { nextVoNumber, seedDB } = require("../js/store.js");
const { renderMeasurementRows } = require("../js/page-vo.js");

const project = seedDB().projects[0];
const draft = project.vos[2];     /* VO-003, not submitted */
const submitted = project.vos[0]; /* VO-001 */

test("only a draft can be deleted, and only by the contractor or the consultant", () => {
    assert.strictEqual(canDeleteVO(draft, "contractor"), true);
    assert.strictEqual(canDeleteVO(draft, "consultant"), true);
    assert.strictEqual(canDeleteVO(draft, "client"), false);
    assert.strictEqual(canDeleteVO(submitted, "contractor"), false, "a submitted VO is part of the record");
    assert.strictEqual(canDeleteVO(null, "contractor"), false);
});

test("a new VO takes the number after the highest, so a deletion never repeats one", () => {
    assert.strictEqual(nextVoNumber([{ no: "VO-001" }, { no: "VO-002" }, { no: "VO-005" }]), 6);
    assert.strictEqual(nextVoNumber([]), 1);
    assert.strictEqual(nextVoNumber(project.vos), 4);
});

test("each measurement row has a remove button for whoever may edit the measurement", () => {
    const html = renderMeasurementRows(draft, project, "contractor");
    assert.strictEqual((html.match(/class="row-delete-btn"/g) || []).length, draft.measurement.length);
    assert.ok(!/row-delete-btn/.test(renderMeasurementRows(draft, project, "client")));
    assert.ok(!/row-delete-btn/.test(renderMeasurementRows(submitted, project, "contractor")), "VO-001 is approved: its measurement is locked");
});
