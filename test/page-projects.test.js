const test = require("node:test");
const assert = require("node:assert");
const { renderProjectCard, parseBqPaste } = require("../js/page-projects.js");

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
