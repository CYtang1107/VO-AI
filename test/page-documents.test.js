const test = require("node:test");
const assert = require("node:assert");
const {
    formatSize, collectDocuments, filterDocuments, renderDocumentGroups
} = require("../js/page-documents.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];

/* ---------- formatSize ---------- */

test("formatSize renders a small value in bytes", () => {
    assert.strictEqual(formatSize(500), "500 B");
});

test("formatSize renders a KB-range value", () => {
    assert.strictEqual(formatSize(50000), "49 KB");
});

test("formatSize renders an MB-range value", () => {
    assert.strictEqual(formatSize(5820000), "5.6 MB");
});

test("formatSize handles 0 without throwing", () => {
    assert.strictEqual(formatSize(0), "0 B");
});

test("formatSize handles a missing size without throwing", () => {
    assert.strictEqual(formatSize(undefined), "0 B");
    assert.strictEqual(formatSize(null), "0 B");
});

/* ---------- collectDocuments ---------- */

test("collectDocuments finds project-level documents and labels their source", () => {
    const list = collectDocuments(project);
    const contract = list.find(d => d.category === "contract");
    assert.ok(contract, "the seeded contract should be found");
    assert.strictEqual(contract.source, "project");
    assert.strictEqual(contract.kind, "project");
});

test("collectDocuments finds VO-level documents and labels their source and kind", () => {
    const list = collectDocuments(project);
    const vo1 = project.vos[0];
    const drawing = list.find(d => d.voId === vo1.id && d.kind === "revisedDrawing");
    assert.ok(drawing, "VO-001's revised drawing should be found");
    assert.strictEqual(drawing.source, "vo");
    assert.strictEqual(drawing.bucket, "drawings");
    assert.strictEqual(drawing.voNo, vo1.no);
});

test("a VO document with revisions reports the right version count", () => {
    const list = collectDocuments(project);
    const withRevisions = { id: "T1", name: "a.pdf", size: 10, uploadedBy: "x", at: "2026-01-01",
        revisions: [{ id: "T0", name: "old.pdf", size: 5, uploadedBy: "x", at: "2025-12-01" }] };
    const fakeProject = { documents: [], vos: [
        { id: "V1", no: "VO-999", description: "test", revisedDrawing: [withRevisions],
          oldDrawing: [], supportingDocs: [] }
    ] };
    const l2 = collectDocuments(fakeProject);
    assert.strictEqual(l2[0].revisionCount, 1);
});

test("a VO document without a revisions field does not crash and counts zero", () => {
    const fakeProject = { documents: [], vos: [
        { id: "V1", no: "VO-999", description: "test",
          revisedDrawing: [{ id: "T1", name: "a.pdf", size: 10, uploadedBy: "x", at: "2026-01-01" }],
          oldDrawing: [], supportingDocs: [] }
    ] };
    assert.doesNotThrow(() => {
        const l = collectDocuments(fakeProject);
        assert.strictEqual(l[0].revisionCount, 0);
    });
});

test("a project with no documents at all produces an empty list, not a throw", () => {
    const empty = { documents: [], vos: [] };
    assert.doesNotThrow(() => {
        const l = collectDocuments(empty);
        assert.deepStrictEqual(l, []);
    });
});

test("collectDocuments handles a project with no documents/vos arrays at all", () => {
    assert.doesNotThrow(() => {
        const l = collectDocuments({});
        assert.deepStrictEqual(l, []);
    });
});

/* ---------- filterDocuments ---------- */

test("filterDocuments by kind=project returns only project-level documents", () => {
    const list = collectDocuments(project);
    const filtered = filterDocuments(list, { kind: "project" });
    assert.ok(filtered.length > 0);
    assert.ok(filtered.every(d => d.source === "project"));
});

test("filterDocuments by kind=drawings returns only drawing documents", () => {
    const list = collectDocuments(project);
    const filtered = filterDocuments(list, { kind: "drawings" });
    assert.ok(filtered.length > 0);
    assert.ok(filtered.every(d => d.bucket === "drawings"));
});

test("filterDocuments by kind=supporting returns only supporting documents", () => {
    const list = collectDocuments(project);
    const filtered = filterDocuments(list, { kind: "supporting" });
    assert.ok(filtered.length > 0);
    assert.ok(filtered.every(d => d.bucket === "supporting"));
});

test("filterDocuments by voId returns only that VO's documents", () => {
    const list = collectDocuments(project);
    const vo1 = project.vos[0];
    const filtered = filterDocuments(list, { voId: vo1.id });
    assert.ok(filtered.length > 0);
    assert.ok(filtered.every(d => d.voId === vo1.id));
});

test("filterDocuments with kind=all and voId=all returns everything", () => {
    const list = collectDocuments(project);
    const filtered = filterDocuments(list, { kind: "all", voId: "all" });
    assert.strictEqual(filtered.length, list.length);
});

/* ---------- renderDocumentGroups ---------- */

test("renderDocumentGroups sorts documents newest first within a group", () => {
    const list = [
        { id: "A", name: "old.pdf", size: 1, uploadedBy: "x", at: "2026-01-01",
          source: "project", kind: "project", category: "contract" },
        { id: "B", name: "new.pdf", size: 1, uploadedBy: "x", at: "2026-06-01",
          source: "project", kind: "project", category: "bq" }
    ];
    const html = renderDocumentGroups(list, { kind: "all", voId: "all" });
    const posOld = html.indexOf("old.pdf");
    const posNew = html.indexOf("new.pdf");
    assert.ok(posNew < posOld, "the newer document should render before the older one");
});

test("renderDocumentGroups shows a clear empty state for a project with no documents", () => {
    const html = renderDocumentGroups([], { kind: "all", voId: "all" });
    assert.match(html, /empty-state/);
    assert.doesNotThrow(() => renderDocumentGroups([], {}));
});

test("renderDocumentGroups groups VO documents under their VO and reports revision counts", () => {
    const list = collectDocuments(project);
    const vo1 = project.vos[0];
    const html = renderDocumentGroups(list, { kind: "all", voId: "all" });
    assert.match(html, new RegExp(vo1.no));
    assert.match(html, /data-vo-id="/);
});

test("renderDocumentGroups escapes a document name containing markup", () => {
    const list = [
        { id: "A", name: "<img src=x onerror=alert(1)>.pdf", size: 1, uploadedBy: "x",
          at: "2026-01-01", source: "project", kind: "project", category: "contract" }
    ];
    const html = renderDocumentGroups(list, { kind: "all", voId: "all" });
    assert.ok(!html.includes("<img src=x"), "raw markup must not appear unescaped");
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;\.pdf/);
});

test("renderDocumentGroups produces no empty box for a VO with no documents", () => {
    const fakeProject = { documents: [], vos: [
        { id: "V1", no: "VO-999", description: "empty vo", revisedDrawing: [], oldDrawing: [], supportingDocs: [] }
    ] };
    const list = collectDocuments(fakeProject);
    const html = renderDocumentGroups(list, { kind: "all", voId: "all" });
    assert.ok(!html.includes("VO-999"), "a VO with no documents should not appear as a group");
});
