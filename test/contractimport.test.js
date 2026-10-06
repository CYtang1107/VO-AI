const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const { inBatches, formFor, groupKnowledge, knowledgeFromText, renderKnowledgeCard } = require("../js/contractimport.js");
const kbsplit = require("../js/kbsplit.js");

const checks = () => import(pathToFileURL(path.join(__dirname, "..", "supabase", "functions", "import-contract", "checks.mjs")).href);

/* Sample wording only: the real contract text never goes in the repo. */
const sample = [
    "Conditions of Contract (sample wording for tests)",
    "1.1 Contractor to comply. The Contractor shall carry out the Works in accordance with the Contract.",
    "2.1 Instructions. The Architect may issue instructions in writing.",
    "11.1 Meaning of Variation. A Variation means a change to the design, quality or quantity of the Works.",
    "11.5 Valuation of Variations. All Variations shall be measured and valued by the Quantity Surveyor.",
    "11.6 Valuation rules. Where work is of a similar character the rates in the Contract Bills shall apply.",
    "23.1 Extension of time. The Contractor shall give written notice within 28 Days."
].join("\n");

test("a contract's text becomes clauses and chunks, cited by its file name when it names no form", () => {
    const kb = knowledgeFromText("Conditions ABC.pdf", sample);
    assert.ok(!kb.error, JSON.stringify(kb));
    assert.strictEqual(kb.clauses, 6);
    assert.strictEqual(kb.form, "Conditions ABC");
    assert.deepStrictEqual(kb.chunks.map(c => c.no), ["1.1", "2.1", "11.1", "11.5", "11.6", "23.1"]);
    assert.ok(kb.chunks.every(c => c.text && c.part === 1));
});

test("too few clauses is refused rather than imported", () => {
    const kb = knowledgeFromText("letter.pdf", "Dear Sir,\n1.1 Please find attached.\nRegards");
    assert.strictEqual(kb.error, "kb.error.fewClauses");
});

test("the standard form is detected from the text", () => {
    assert.strictEqual(kbsplit.detectForm("PAM CONTRACT 2018 (WITH QUANTITIES)\n..."), "PAM 2018");
    assert.strictEqual(kbsplit.detectForm("P.W.D. Form 203A (Rev. 2010)"), "PWD 203A");
    assert.strictEqual(kbsplit.detectForm("CIDB Standard Form of Contract 2000"), "CIDB 2000");
    assert.strictEqual(kbsplit.detectForm("an ordinary letter"), null);
    assert.strictEqual(formFor("Agreement.docx", "PAM Contract 2018 ..."), "PAM 2018");
});

test("long clauses are split at sentence ends, every piece keeping its number", () => {
    const long = "This sentence is about forty characters. ".repeat(80);
    const chunks = kbsplit.chunkClauses([{ no: "11.6", title: "Valuation rules", text: long }]);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(c => c.no === "11.6" && c.text.length <= kbsplit.MAX_CHUNK));
    assert.deepStrictEqual(chunks.map(c => c.part), chunks.map((_, i) => i + 1));
});

test("chunks go up in batches", () => {
    assert.deepStrictEqual(inBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("the knowledge base is listed one entry per document", () => {
    const rows = [
        { doc_name: "PAM 2018", form: "PAM 2018", clause_no: "11.6" },
        { doc_name: "PAM 2018", form: "PAM 2018", clause_no: "11.6" },
        { doc_name: "PAM 2018", form: "PAM 2018", clause_no: "11.5" },
        { doc_name: "Addendum.pdf", form: "Addendum", clause_no: "1.1" }
    ];
    assert.deepStrictEqual(groupKnowledge(rows), [
        { docName: "PAM 2018", form: "PAM 2018", clauses: 2, chunks: 3 },
        { docName: "Addendum.pdf", form: "Addendum", clauses: 1, chunks: 1 }
    ]);
});

test("the card: everyone sees what is imported; only the consultant gets import and remove", () => {
    const entries = [{ docName: "PAM 2018", form: "PAM 2018", clauses: 197, chunks: 231 }];
    const docs = [{ id: "D1", name: "Conditions.pdf" }, { id: "D2", name: "PAM 2018" }];
    const viewer = renderKnowledgeCard(entries, docs, false, null);
    assert.match(viewer, /197 clauses · 231 passages/);
    assert.ok(!/kb-import-btn|kb-remove-btn/.test(viewer));
    const consultant = renderKnowledgeCard(entries, docs, true, { docId: "D1", text: "OCR 3 of 56" });
    assert.match(consultant, /data-doc-id="D1" disabled/);
    assert.match(consultant, /OCR 3 of 56/);
    assert.match(consultant, /Import again/, "a document already imported is offered again, not twice");
    assert.match(renderKnowledgeCard([], [], true, null), /Nothing imported yet/);
});

/* ---------- the Edge Function's checks ---------- */

test("import requests are checked before any work is done", async () => {
    const c = await checks();
    const chunk = { no: "11.6", title: "Valuation rules", part: 1, text: "Where work is of a similar character..." };
    assert.strictEqual(c.validImportRequest({ action: "chunks", project_id: "PRJ-1", doc_name: "PAM 2018", form: "PAM 2018", chunks: [chunk] }), null);
    assert.match(c.validImportRequest({ action: "chunks", project_id: "PRJ-1", doc_name: "x", form: "x", chunks: [] }), /chunks are required/);
    assert.match(c.validImportRequest({ action: "chunks", project_id: "PRJ-1", doc_name: "x", form: "x",
        chunks: Array(61).fill(chunk) }), /at most 60/);
    assert.match(c.validImportRequest({ action: "chunks", project_id: "PRJ-1", doc_name: "x", form: "x",
        chunks: [Object.assign({}, chunk, { text: "x".repeat(2501) })] }), /too long/);
    assert.match(c.validImportRequest({ action: "ocr", project_id: "PRJ-1", image: "data:image/jpeg;base64," + "A".repeat(200) }), /without a data: prefix/);
    assert.strictEqual(c.validImportRequest({ action: "ocr", project_id: "PRJ-1", image: "A".repeat(200) }), null);
    assert.match(c.validImportRequest({ action: "drop", project_id: "PRJ-1" }), /action must be/);
    assert.match(c.validImportRequest({ action: "remove" }), /project_id/);
});

test("the server embeds a clause exactly as the command-line import does", async () => {
    const c = await checks();
    const chunk = { no: "11.6", title: "Valuation rules", text: "Where work..." };
    assert.strictEqual(c.embedText("PAM 2018", chunk), kbsplit.embedText("PAM 2018", chunk));
    assert.strictEqual(c.embedText("PAM 2018", { no: "Article 3", title: "Architect", text: "x" }), "PAM 2018 Article 3 Architect: x");
    const rows = c.chunkRows("PRJ-1", "PAM 2018", "PAM 2018", [Object.assign({ part: 2 }, chunk)], [[0.1, 0.2]]);
    assert.deepStrictEqual(rows[0], { project_id: "PRJ-1", doc_name: "PAM 2018", form: "PAM 2018", clause_no: "11.6",
        title: "Valuation rules", part: 2, text: "Where work...", embedding: "[0.1,0.2]" });
});
