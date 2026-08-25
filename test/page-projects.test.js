const test = require("node:test");
const assert = require("node:assert");
const { renderProjectCard, parseBqPaste, exportProject, validateImport, importProject } =
    require("../js/page-projects.js");
const {
    createProject, getProject,
    setProjectPasscode, verifyProjectPasscode, projectHasPasscode
} = require("../js/store.js");

if (typeof globalThis.localStorage === "undefined" ||
    typeof globalThis.localStorage.getItem !== "function") {
    const backing = new Map();
    globalThis.localStorage = {
        getItem: k => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => backing.set(k, String(v)),
        removeItem: k => backing.delete(k)
    };
}

function sampleProject() {
    return {
        id: "PRJ-1",
        name: "Cadangan Pembangunan ABC Residence",
        client: "ABC Development Sdn Bhd",
        contractNo: "ABC/2026/014",
        contractSum: 12500000,
        bq: [{ id: "BQ1", code: "B/4.1", description: "Ceramic floor tiles", unit: "m2", rate: 85 }],
        documents: [{ id: "D1", name: "Contract.pdf", size: 100, category: "contract",
                      uploadedBy: "Serena Wong", role: "consultant", at: "2026-06-01T09:10:00Z" }],
        vos: [{
            id: "VO-1", no: "VO-001", description: "Change of floor finish",
            measurement: [{ id: "M1", bqItemId: "BQ1", description: "Omit tiles",
                            unit: "m2", qty: -320, rate: 85, assessedQty: -320, assessedRate: 85 }],
            revisedDrawing: [], oldDrawing: [], supportingDocs: [], history: []
        }]
    };
}

test("parseBqPaste reads tab separated BQ lines", () => {
    const rows = parseBqPaste("B/4.1\tCeramic floor tiles\tm2\t85\nB/4.2\tSkirting\tm\t22");
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0],
        { code: "B/4.1", description: "Ceramic floor tiles", unit: "m2", rate: 85 });
    assert.strictEqual(rows[1].rate, 22);
});

test("parseBqPaste reads comma separated lines and trims spaces", () => {
    const rows = parseBqPaste(" C/2.3 , Timber door , no , 640 ");
    assert.deepStrictEqual(rows[0],
        { code: "C/2.3", description: "Timber door", unit: "no", rate: 640 });
});

test("parseBqPaste skips blank lines and malformed rows", () => {
    const rows = parseBqPaste("B/1\tOK\tm\t10\n\nnot enough columns\n\nB/2\tAlso OK\tm\t20");
    assert.strictEqual(rows.length, 2);
});

test("parseBqPaste skips a row whose rate cell is not a parseable number", () => {
    const rows = parseBqPaste("B/1\tItem\tm\tabc");
    assert.strictEqual(rows.length, 0);
});

test("parseBqPaste keeps a genuine zero rate rather than dropping it", () => {
    const rows = parseBqPaste("B/1\tItem\tm\t0");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].rate, 0);
});

test("parseBqPaste skips a pasted BQ header row", () => {
    const rows = parseBqPaste("Code\tDescription\tUnit\tRate\nB/4.1\tCeramic floor tiles\tm2\t85");
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual(rows[0],
        { code: "B/4.1", description: "Ceramic floor tiles", unit: "m2", rate: 85 });
});

test("a project card shows the name, contract number and VO count", () => {
    const html = renderProjectCard({
        id: "P1", name: "ABC Residence", client: "ABC Sdn Bhd",
        contractNo: "ABC/2026/014", contractSum: 1000000, bq: [], documents: [],
        vos: [{ evaluateStatus: "Approved", certifiedStatus: "Pending", timeImpact: 0,
                measurement: [{ qty: 1, rate: 500 }] }]
    }, { role: "client" });
    assert.match(html, /ABC Residence/);
    assert.match(html, /ABC\/2026\/014/);
    assert.match(html, /RM 500\.00/);
});

test("project card escapes a name containing markup", () => {
    const html = renderProjectCard({
        id: "P1", name: "<img src=x onerror=1>", client: "", contractNo: "",
        contractSum: 0, bq: [], documents: [], vos: []
    }, { role: "client" });
    assert.ok(!html.includes("<img src=x"));
    assert.match(html, /&lt;img/);
});

test("parseBqPaste keeps a comma inside a description intact", () => {
    const rows = parseBqPaste("B/4.1, Ceramic floor tiles 600x600mm, laid to falls, m2, 85");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].code, "B/4.1");
    assert.strictEqual(rows[0].description, "Ceramic floor tiles 600x600mm, laid to falls");
    assert.strictEqual(rows[0].unit, "m2");
    assert.strictEqual(rows[0].rate, 85);
});

/* -----------------------------------------------------------
   Project export / import
----------------------------------------------------------- */

test("exportProject round-trips through JSON without loss", () => {
    const project = sampleProject();
    const exported = exportProject(project);
    const parsed = JSON.parse(JSON.stringify(exported));

    const check = validateImport(parsed);
    assert.deepStrictEqual(check, { ok: true, errors: [] });

    const db = { projects: [] };
    const imported = importProject(parsed, db);

    assert.strictEqual(imported.vos.length, 1);
    assert.strictEqual(imported.vos[0].measurement[0].qty, -320);
    assert.strictEqual(imported.vos[0].measurement[0].rate, 85);
    assert.strictEqual(imported.bq[0].rate, 85);
    assert.strictEqual(imported.name, project.name);
});

test("validateImport rejects a non-object", () => {
    assert.deepStrictEqual(validateImport(null), { ok: false, errors: ["The file is not a JSON object."] });
    assert.deepStrictEqual(validateImport("hello"), { ok: false, errors: ["The file is not a JSON object."] });
    assert.deepStrictEqual(validateImport([1, 2]), { ok: false, errors: ["The file is not a JSON object."] });
});

test("validateImport rejects an object missing vos", () => {
    const result = validateImport({ name: "X", bq: [], documents: [] });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes("vos")));
});

test("validateImport rejects an object whose bq is not an array", () => {
    const result = validateImport({ name: "X", bq: "not an array", vos: [], documents: [] });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes("bq")));
});

test("importProject assigns a new id and never overwrites an existing project", () => {
    const existing = sampleProject();
    existing.id = "PRJ-1";
    const db = { projects: [existing] };

    const incoming = sampleProject();
    incoming.id = "PRJ-1"; /* same id as the existing project, on purpose */
    incoming.name = "A Different Project Name";

    const imported = importProject(incoming, db);

    assert.notStrictEqual(imported.id, "PRJ-1");
    assert.strictEqual(db.projects.length, 2);
    assert.strictEqual(db.projects[0].id, "PRJ-1");
    assert.strictEqual(db.projects[0].name, existing.name);
});

test("importProject suffixes the name when a project of the same name already exists", () => {
    const existing = sampleProject();
    const db = { projects: [existing] };

    const incoming = sampleProject();
    const imported = importProject(incoming, db);

    assert.notStrictEqual(imported.name, existing.name);
    assert.match(imported.name, /\(imported 2\)$/);
    assert.strictEqual(db.projects.length, 2);
    assert.strictEqual(db.projects[0].name, existing.name);
});

test("an exported project retains its passcode hash, and an imported copy still requires it", async () => {
    const project = createProject({ name: "Locked Project " + Math.random() },
        { name: "Serena Wong", role: "consultant" });
    await setProjectPasscode(project.id, "correct-horse");
    const stored = getProject(project.id);
    assert.ok(stored.passcode && stored.passcode.hash, "expected the project to have a passcode hash");

    const exported = exportProject(stored);
    assert.ok(exported.passcode && exported.passcode.hash, "export must retain the passcode hash");
    assert.strictEqual(JSON.stringify(exported).includes("correct-horse"), false,
        "the exported JSON must never contain the plain passcode");

    const parsed = JSON.parse(JSON.stringify(exported));
    const db = { projects: [] };
    const imported = importProject(parsed, db);

    assert.ok(projectHasPasscode(imported), "the imported project must still be locked");
    assert.strictEqual(await verifyProjectPasscode(imported, "correct-horse"), true);
    assert.strictEqual(await verifyProjectPasscode(imported, "wrong-guess"), false);
});

test("a project name containing markup is escaped when rendered", () => {
    const db = { projects: [] };
    const imported = importProject({
        name: "<img src=x onerror=1>", bq: [], vos: [], documents: []
    }, db);

    const html = renderProjectCard(imported, { role: "client" });
    assert.ok(!html.includes("<img src=x"));
    assert.match(html, /&lt;img/);
});
