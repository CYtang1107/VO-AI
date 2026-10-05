const test = require("node:test");
const assert = require("node:assert");
const { sitePhotoName, siteRecordProblems, applySiteRecord } = require("../js/capture.js");
const { newVO } = require("../js/store.js");

const session = { name: "Ahmad", role: "contractor" };
const photo = { id: "DOC-1", name: "site-photo-20261005-1745-1.jpg", size: 2048, stored: true };

test("site photos get a dated, numbered name instead of the camera's image.jpg", () => {
    assert.strictEqual(sitePhotoName("2026-10-05T17:45", 1, "jpg"), "site-photo-20261005-1745-1.jpg");
    assert.strictEqual(sitePhotoName("2026-10-05T09:03:59", 12, ".PNG"), "site-photo-20261005-0903-12.png");
    assert.strictEqual(sitePhotoName("", 2), "site-photo-undated-2.jpg");
});

test("a site record needs at least one photo and a description", () => {
    assert.deepStrictEqual(siteRecordProblems({ photos: [], description: "  " }),
        ["capture.need.photo", "capture.need.description"]);
    assert.deepStrictEqual(siteRecordProblems({ photos: [photo], description: "Tiles to marble" }), []);
});

test("a measurement line is optional, but if started its quantity must be above 0", () => {
    const base = { photos: [photo], description: "Tiles to marble" };
    assert.deepStrictEqual(siteRecordProblems(Object.assign({ line: { qty: "", unit: "", rate: "" } }, base)), []);
    assert.deepStrictEqual(siteRecordProblems(Object.assign({ line: { qty: "", unit: "m2" } }, base)), ["capture.need.qty"]);
    assert.deepStrictEqual(siteRecordProblems(Object.assign({ line: { qty: "0", unit: "m2" } }, base)), ["capture.need.qty"]);
    assert.deepStrictEqual(siteRecordProblems(Object.assign({ line: { qty: "320", unit: "m2" } }, base)), []);
});

test("applySiteRecord fills the contractor's columns and attaches the photos as supporting documents", () => {
    const vo = applySiteRecord(newVO(4), {
        description: " Living room floor tiles changed to marble ",
        location: "Level 2, living area",
        typeOfInstruction: "Engineer's instruction (EI)",
        instructionNo: " EI-009 ",
        dateIssued: "2026-10-05",
        line: { qty: "320", unit: "m2", rate: "" },
        photos: [photo, { id: "DOC-2", name: "site-photo-20261005-1745-2.jpg", size: 10, stored: false }]
    }, session, "2026-10-05");

    assert.strictEqual(vo.description, "Level 2, living area — Living room floor tiles changed to marble");
    assert.strictEqual(vo.typeOfInstruction, "Engineer's instruction (EI)");
    assert.strictEqual(vo.instructionNo, "EI-009");
    assert.strictEqual(vo.dateIssued, "2026-10-05");
    assert.strictEqual(vo.measurement.length, 1);
    assert.strictEqual(vo.measurement[0].qty, 320);
    assert.strictEqual(vo.measurement[0].unit, "m2");
    assert.strictEqual(vo.measurement[0].rate, 0);
    assert.strictEqual(vo.measurement[0].bqItemId, null);
    assert.deepStrictEqual(vo.supportingDocs.map(d => [d.id, d.uploadedBy, d.at, !!d.stored]),
        [["DOC-1", "Ahmad", "2026-10-05", true], ["DOC-2", "Ahmad", "2026-10-05", false]]);
    /* never touches anyone else's columns, and stays a draft */
    assert.strictEqual(vo.submitted, false);
    assert.strictEqual(vo.evaluateStatus, "Draft");
    assert.strictEqual(vo.certifiedStatus, "Pending");
});

test("without a location or a quantity, the description stands alone and no measurement row is added", () => {
    const vo = applySiteRecord(newVO(5), { description: "Add a door", photos: [photo] }, session, "2026-10-05");
    assert.strictEqual(vo.description, "Add a door");
    assert.deepStrictEqual(vo.measurement, []);
});
