const test = require("node:test");
const assert = require("node:assert");
const { currentVersion, versionCount, addVersion } = require("../js/documents.js");

function doc() {
    return { id: "F1", name: "A-201 Rev B.pdf", size: 1000, uploadedBy: "Ong Wei Han", at: "2026-07-14" };
}

test("currentVersion returns the top-level fields without revisions", () => {
    const d = doc();
    assert.deepStrictEqual(currentVersion(d),
        { id: "F1", name: "A-201 Rev B.pdf", size: 1000, uploadedBy: "Ong Wei Han", at: "2026-07-14" });
});

test("a document with no revisions field has a version count of 1", () => {
    assert.strictEqual(versionCount(doc()), 1);
});

test("addVersion moves the previous current version into revisions and the new one becomes current", () => {
    const d = doc();
    const session = { name: "Serena Wong" };
    addVersion(d, { name: "A-201 Rev C.pdf", size: 1500 }, session, "2026-08-01");

    assert.strictEqual(d.name, "A-201 Rev C.pdf");
    assert.strictEqual(d.size, 1500);
    assert.strictEqual(d.uploadedBy, "Serena Wong");
    assert.strictEqual(d.at, "2026-08-01");
    assert.notStrictEqual(d.id, "F1");

    assert.strictEqual(d.revisions.length, 1);
    assert.deepStrictEqual(d.revisions[0],
        { id: "F1", name: "A-201 Rev B.pdf", size: 1000, uploadedBy: "Ong Wei Han", at: "2026-07-14" });
});

test("versionCount reflects the number of prior versions plus the current one", () => {
    const d = doc();
    addVersion(d, { name: "Rev C.pdf", size: 1100 }, { name: "Serena Wong" }, "2026-08-01");
    assert.strictEqual(versionCount(d), 2);
    addVersion(d, { name: "Rev D.pdf", size: 1200 }, { name: "Serena Wong" }, "2026-08-10");
    assert.strictEqual(versionCount(d), 3);
});

test("addVersion never discards a prior version across multiple uploads", () => {
    const d = doc();
    addVersion(d, { name: "Rev C.pdf", size: 1100 }, { name: "Serena Wong" }, "2026-08-01");
    addVersion(d, { name: "Rev D.pdf", size: 1200 }, { name: "Serena Wong" }, "2026-08-10");
    const names = d.revisions.map(r => r.name);
    assert.deepStrictEqual(names, ["A-201 Rev B.pdf", "Rev C.pdf"]);
    assert.strictEqual(d.name, "Rev D.pdf");
});

test("an untouched document (no revisions field) behaves as if it has an empty revisions array", () => {
    const d = doc();
    assert.strictEqual((d.revisions || []).length, 0);
    assert.strictEqual(versionCount(d), 1);
});

test("addVersion keeps each version's stored flag and the id it was stored under", () => {
    const { addVersion } = require("../js/documents.js");
    const doc = { id: "DOC-A", name: "v1.pdf", size: 1, uploadedBy: "X", at: "2026-01-01", stored: true };
    addVersion(doc, { id: "DOC-B", name: "v2.pdf", size: 2 }, { name: "Y" }, "2026-01-02");
    assert.strictEqual(doc.id, "DOC-B");
    assert.strictEqual(doc.stored, undefined, "the new version was not stored");
    assert.strictEqual(doc.revisions[0].id, "DOC-A");
    assert.strictEqual(doc.revisions[0].stored, true, "the prior version stays openable");
});
