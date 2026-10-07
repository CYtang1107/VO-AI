const test = require("node:test");
const assert = require("node:assert");
const {
    parseCsv, parseXlsx, detectColumns, extractItems, checkArithmetic,
    parseSheetXml, parseSharedStrings
} = require("../js/bqimport.js");

/* ==========================================================
   CSV
========================================================== */

test("parseCsv handles quoted fields containing commas", () => {
    const rows = parseCsv('Code,Description,Unit,Rate\nB/4.1,"Tiles, ceramic 600x600mm",m2,85.50');
    assert.deepStrictEqual(rows[0], ["Code", "Description", "Unit", "Rate"]);
    assert.deepStrictEqual(rows[1], ["B/4.1", "Tiles, ceramic 600x600mm", "m2", "85.50"]);
});

test("parseCsv unescapes doubled quotes inside a quoted field", () => {
    const rows = parseCsv('A,B\n1,"He said ""hi"""');
    assert.strictEqual(rows[1][1], 'He said "hi"');
});

test("parseCsv reads CRLF line endings", () => {
    const rows = parseCsv("a,b\r\nc,d\r\n");
    assert.deepStrictEqual(rows, [["a", "b"], ["c", "d"]]);
});

test("parseCsv reads LF line endings", () => {
    const rows = parseCsv("a,b\nc,d");
    assert.deepStrictEqual(rows, [["a", "b"], ["c", "d"]]);
});

/* ==========================================================
   Column detection — realistic messy layout
========================================================== */

/* Columns deliberately in a non-obvious order: Description, Qty, Code,
   Unit, Rate — with a title row, a header row, two section headings, a
   blank row and a subtotal row mixed in among the real items. */
function messyRows() {
    return [
        ["MAIN BUILDING WORKS", "", "", "", ""],
        ["Description", "Qty", "Code", "Unit", "Rate"],
        ["SECTION B - FLOOR FINISHES", "", "", "", ""],
        ["Ceramic floor tiles 600x600mm", "120", "B/4.1", "m2", "85.50"],
        ["Skirting to match floor finish", "45", "B/4.2", "m", "22.00"],
        ["", "", "", "", ""],
        ["Timber door complete with ironmongery", "8", "C/2.3", "no", "640.00"],
        ["Total carried forward", "", "", "", ""],
        ["Ironmongery to suit", "1", "C/2.4", "sum", "150.00"]
    ];
}

test("detectColumns identifies all four roles from a non-obvious column order", () => {
    const result = detectColumns(messyRows());
    assert.strictEqual(result.description, 0);
    assert.strictEqual(result.code, 2);
    assert.strictEqual(result.unit, 3);
    assert.strictEqual(result.rate, 4);
    assert.strictEqual(result.confidence, "high");
    assert.ok(result.reasons.length >= 4);
    assert.ok(result.reasons.some(r => /Rate/.test(r)));
});

test("detectColumns does not mistake the small-integer quantity column for the rate column", () => {
    const result = detectColumns(messyRows());
    assert.notStrictEqual(result.rate, 1, "column 1 is Qty, not Rate");
    assert.strictEqual(result.rate, 4);
});

test("detectColumns still finds rate and description when code and unit are absent", () => {
    const rows = [
        ["Description", "Rate"],
        ["Supply and lay hardcore under floor slab", "45.00"],
        ["Excavate for foundation trench in soft soil", "12.50"],
        ["Formwork to edge of slab", "18.75"]
    ];
    const result = detectColumns(rows);
    assert.strictEqual(result.code, null);
    assert.strictEqual(result.unit, null);
    assert.notStrictEqual(result.description, null);
    assert.notStrictEqual(result.rate, null);
    assert.strictEqual(result.confidence, "high");
});

test("detectColumns reports needs review when nothing usable is found", () => {
    const result = detectColumns([["", "", ""], ["", "", ""]]);
    assert.strictEqual(result.confidence, "needs review");
    assert.strictEqual(result.rate, null);
});

/* ==========================================================
   Row classification / extractItems
========================================================== */

test("extractItems imports only real item rows and records everything else as skipped", () => {
    const rows = messyRows();
    const mapping = { code: 2, description: 0, unit: 3, rate: 4 };
    const { items, skipped } = extractItems(rows, mapping);

    assert.strictEqual(items.length, 4);
    assert.deepStrictEqual(items[0], { code: "B/4.1", description: "Ceramic floor tiles 600x600mm", unit: "m2", rate: 85.5 });
    assert.strictEqual(items[3].code, "C/2.4");

    assert.strictEqual(skipped.length, 5);
    const reasons = skipped.map(s => s.reason);
    assert.ok(reasons.some(r => /header row/.test(r)));
    assert.ok(reasons.some(r => /blank row/.test(r)));
    assert.ok(reasons.filter(r => /section heading/.test(r)).length === 2);
    assert.ok(reasons.some(r => /subtotal|total/.test(r)));
});

test("extractItems skips an item row that has a description but no parseable rate", () => {
    const rows = [
        ["Code", "Description", "Unit", "Rate"],
        ["B/1.1", "Excavate for foundation", "m3", "not priced yet"]
    ];
    const mapping = { code: 0, description: 1, unit: 2, rate: 3 };
    const { items, skipped } = extractItems(rows, mapping);

    assert.strictEqual(items.length, 0);
    assert.strictEqual(skipped.length, 2);
    assert.ok(skipped.some(s => /no parseable rate/.test(s.reason)));
});

test("extractItems respects a user-corrected mapping over any other guess", () => {
    const rows = [
        ["Ceramic floor tiles", "B/4.1", "m2", "85.50"]
    ];
    // A deliberately wrong mapping: description and code swapped.
    const wrongMapping = { code: 0, description: 1, unit: 2, rate: 3 };
    const wrong = extractItems(rows, wrongMapping);
    assert.strictEqual(wrong.items[0].description, "B/4.1");
    assert.strictEqual(wrong.items[0].code, "Ceramic floor tiles");

    // The user corrects it — extractItems must follow the correction exactly.
    const correctedMapping = { code: 1, description: 0, unit: 2, rate: 3 };
    const corrected = extractItems(rows, correctedMapping);
    assert.strictEqual(corrected.items[0].description, "Ceramic floor tiles");
    assert.strictEqual(corrected.items[0].code, "B/4.1");
});

/* ==========================================================
   XLSX — XML parsing layer (direct, sync)
========================================================== */

test("parseSharedStrings concatenates rich-text runs within one <si>", () => {
    const xml = "<sst><si><t>Ceramic floor tiles</t></si>" +
        "<si><r><t>Skirting </t></r><r><t>board</t></r></si></sst>";
    const strings = parseSharedStrings(xml);
    assert.deepStrictEqual(strings, ["Ceramic floor tiles", "Skirting board"]);
});

test("parseSheetXml reads shared-string, inline-string and numeric cells at their real column", () => {
    const shared = ["Ceramic floor tiles"];
    const xml = "<sheetData>" +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>85.5</v></c>' +
        '<c r="B1" t="inlineStr"><is><t>m2</t></is></c></row>' +
        "</sheetData>";
    const rows = parseSheetXml(xml, shared);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0][0], "Ceramic floor tiles");
    assert.strictEqual(rows[0][1], "m2");
    assert.strictEqual(rows[0][2], "85.5");
});

test("parseSheetXml treats a row with no cells as blank", () => {
    const xml = "<sheetData><row r=\"1\"></row></sheetData>";
    const rows = parseSheetXml(xml, []);
    assert.deepStrictEqual(rows, [[""]]);
});

/* ==========================================================
   XLSX — full ZIP round trip (built by hand, no library)
========================================================== */

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }

async function deflateRawBytes(bytes) {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    const chunks = [];
    const readDone = (async () => {
        const reader = cs.readable.getReader();
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            chunks.push(next.value);
        }
    })();
    await writer.write(bytes);
    await writer.close();
    await readDone;
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    chunks.forEach(c => { out.set(c, off); off += c.length; });
    return out;
}

/* Builds a minimal but real ZIP archive from scratch (local headers +
   central directory + end-of-central-directory record) — no library.
   `files`: [{ name, content, method: 0 (stored) | 8 (deflate) }] */
async function buildZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const f of files) {
        const nameBuf = Buffer.from(f.name, "utf8");
        const rawBuf = Buffer.from(f.content, "utf8");
        const method = f.method || 0;
        const dataBuf = method === 8 ? Buffer.from(await deflateRawBytes(rawBuf)) : rawBuf;

        const localHeader = Buffer.concat([
            u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
            u32(0), u32(dataBuf.length), u32(rawBuf.length),
            u16(nameBuf.length), u16(0), nameBuf
        ]);
        localParts.push(localHeader, dataBuf);

        const centralHeader = Buffer.concat([
            u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
            u32(0), u32(dataBuf.length), u32(rawBuf.length),
            u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0),
            u32(offset), nameBuf
        ]);
        centralParts.push(centralHeader);

        offset += localHeader.length + dataBuf.length;
    }

    const localBuf = Buffer.concat(localParts);
    const centralBuf = Buffer.concat(centralParts);
    const eocd = Buffer.concat([
        u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
        u32(centralBuf.length), u32(localBuf.length), u16(0)
    ]);

    const whole = Buffer.concat([localBuf, centralBuf, eocd]);
    return whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.byteLength);
}

test("parseXlsx round-trips a hand-built ZIP mixing a stored and a deflated entry", async () => {
    const sheetXml = "<worksheet><sheetData>" +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>85.5</v></c>' +
        '<c r="C1" t="inlineStr"><is><t>m2</t></is></c></row>' +
        "</sheetData></worksheet>";
    const sharedXml = '<sst count="1" uniqueCount="1"><si><t>Ceramic floor tiles</t></si></sst>';

    const arrayBuffer = await buildZip([
        { name: "xl/worksheets/sheet1.xml", content: sheetXml, method: 0 },
        { name: "xl/sharedStrings.xml", content: sharedXml, method: 8 }
    ]);

    const rows = await parseXlsx(arrayBuffer);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0][0], "Ceramic floor tiles");
    assert.strictEqual(rows[0][1], "85.5");
    assert.strictEqual(rows[0][2], "m2");
});

test("parseXlsx rejects a file that is not a ZIP", async () => {
    const notZip = Buffer.from("this is not a zip file at all", "utf8");
    const ab = notZip.buffer.slice(notZip.byteOffset, notZip.byteOffset + notZip.byteLength);
    await assert.rejects(() => parseXlsx(ab));
});

/* ==========================================================
   The BQ's own arithmetic — checkArithmetic
========================================================== */

/* Laid out like demo-files/sample-priced-bq.csv: title rows, a header,
   section headings, priced rows and a subtotal per bill. */
function pricedRows() {
    return [
        ["VO-AI DEMO SAMPLE", "", "", "", "", ""],
        ["Item", "Description", "Unit", "Qty", "Rate (RM)", "Amount (RM)"],
        ["", "BILL B - FINISHES", "", "", "", ""],
        ["B/4.1", "Ceramic floor tiles 600x600mm to living area", "m2", "320", "85.00", "27,200.00"],
        ["B/4.2", "Skirting to match floor finish", "m", "168", "22.00", "3,696.00"],
        ["B/5.1", "Plaster and paint to internal walls", "m2", "860", "34.00", "29,240.00"],
        ["", "Sub-total Bill B carried to summary", "", "", "", "60,136.00"],
        ["", "BILL C - DOORS AND WINDOWS", "", "", "", ""],
        ["C/2.3", "Timber flush door 900x2100mm with ironmongery", "no", "14", "640.00", "8,960.00"],
        ["", "Sub-total Bill C carried to summary", "", "", "", "8,960.00"]
    ];
}

test("detectColumns finds Qty and Amount from Qty x Rate = Amount, and leaves the rest as before", () => {
    const d = detectColumns(pricedRows());
    assert.strictEqual(d.rate, 4);
    assert.strictEqual(d.qty, 3);
    assert.strictEqual(d.amount, 5);
    assert.strictEqual(d.description, 1);
    assert.ok(d.reasons.some(r => /Qty × Rate = Amount on 4 of 4/.test(r)));
});

test("detectColumns leaves Qty and Amount unassigned when no pair of columns multiplies out", () => {
    const d = detectColumns(messyRows());
    assert.strictEqual(d.qty, null);
    assert.strictEqual(d.amount, null);
    assert.ok(d.reasons.some(r => /not checked/.test(r)));
});

test("checkArithmetic passes a BQ whose rows and subtotals add up", () => {
    const rows = pricedRows();
    const c = checkArithmetic(rows, detectColumns(rows));
    assert.strictEqual(c.available, true);
    assert.strictEqual(c.rowsChecked, 4);
    assert.strictEqual(c.totalsChecked, 2);
    assert.deepStrictEqual(c.rowIssues, []);
    assert.deepStrictEqual(c.totalIssues, []);
});

test("checkArithmetic flags a mistyped amount, and the subtotal it throws out", () => {
    const rows = pricedRows();
    rows[3][5] = "27,020.00";
    const c = checkArithmetic(rows, detectColumns(rows));
    assert.strictEqual(c.rowIssues.length, 1);
    assert.strictEqual(c.rowIssues[0].code, "B/4.1");
    assert.strictEqual(c.rowIssues[0].expected, 27200);
    assert.strictEqual(c.rowIssues[0].amount, 27020);
    assert.strictEqual(c.totalIssues.length, 1);
    assert.strictEqual(c.totalIssues[0].stated, 60136);
    assert.strictEqual(c.totalIssues[0].computed, 59956);
});

test("checkArithmetic flags a mistyped rate even though the amount is right", () => {
    const rows = pricedRows();
    rows[4][4] = "2.20";
    const c = checkArithmetic(rows, detectColumns(pricedRows()));
    assert.strictEqual(c.rowIssues.length, 1);
    assert.strictEqual(c.rowIssues[0].code, "B/4.2");
    assert.deepStrictEqual(c.totalIssues, [], "the amounts still add up to the subtotal");
});

test("checkArithmetic flags a subtotal that does not add up when every row does", () => {
    const rows = pricedRows();
    rows[9][5] = "9,860.00";
    const c = checkArithmetic(rows, detectColumns(rows));
    assert.deepStrictEqual(c.rowIssues, []);
    assert.strictEqual(c.totalIssues.length, 1);
    assert.match(c.totalIssues[0].description, /Bill C/);
});

test("checkArithmetic allows for a rounded quantity and amounts to the sen", () => {
    const rows = [
        ["Code", "Description", "Unit", "Qty", "Rate", "Amount"],
        ["A/1.1", "Excavate trench", "m3", "12.35", "18.33", "226.33"],
        ["A/1.2", "Hardcore filling", "m3", "7.5", "45.00", "337.50"]
    ];
    const c = checkArithmetic(rows, { code: 0, description: 1, unit: 2, qty: 3, rate: 4, amount: 5 });
    assert.strictEqual(c.rowsChecked, 2);
    assert.deepStrictEqual(c.rowIssues, []);
});

test("checkArithmetic follows a section over a page break (carried and brought forward)", () => {
    const rows = [
        ["Code", "Description", "Unit", "Qty", "Rate", "Amount"],
        ["B/1.1", "Floor screed", "m2", "100", "20.00", "2,000.00"],
        ["", "Carried forward", "", "", "", "2,000.00"],
        ["", "Brought forward", "", "", "", "2,000.00"],
        ["B/1.2", "Floor tiles", "m2", "100", "80.00", "8,000.00"],
        ["", "Sub-total Bill B", "", "", "", "10,000.00"]
    ];
    const c = checkArithmetic(rows, { code: 0, description: 1, unit: 2, qty: 3, rate: 4, amount: 5 });
    assert.strictEqual(c.totalsChecked, 2);
    assert.deepStrictEqual(c.totalIssues, []);
});

test("checkArithmetic does not check a grand total with no priced rows above it", () => {
    const rows = pricedRows().concat([
        ["", "SUMMARY", "", "", "", ""],
        ["", "Grand total carried to Form of Tender", "", "", "", "99,999.00"]
    ]);
    const c = checkArithmetic(rows, detectColumns(rows));
    assert.strictEqual(c.totalsChecked, 2);
    assert.deepStrictEqual(c.totalIssues, []);
});

test("checkArithmetic is unavailable until the Amount column is mapped, and follows a corrected mapping", () => {
    const rows = pricedRows();
    const none = checkArithmetic(rows, { code: 0, description: 1, unit: 2, rate: 4, qty: 3, amount: null });
    assert.strictEqual(none.available, false);
    assert.strictEqual(none.rowsChecked, 0);

    // Amount wrongly mapped to the Qty column: every row is reported.
    const wrong = checkArithmetic(rows, { code: 0, description: 1, unit: 2, rate: 4, qty: 5, amount: 3 });
    assert.strictEqual(wrong.rowIssues.length, 4);
});

/* Qty × Rate = Amount reads the same with Qty and Rate swapped, so the
   two must be told apart by their titles, else by how they are written. */
const QTY_BEFORE_RATE = [
    ["B/4.1", "Ceramic floor tiles", "m2", "320", "85.00", "27200.00"],
    ["B/4.2", "Skirting", "m", "168", "22.00", "3696.00"],
    ["B/5.1", "Plaster and paint", "m2", "900", "34.00", "30600.00"],
    ["D/1.2", "uPVC pipe", "m", "120", "48.00", "5760.00"]
];

test("detectColumns reads the column titles first: Qty before Rate, large whole quantities", () => {
    const d = detectColumns([["Item", "Description", "Unit", "Qty", "Rate", "Amount"]].concat(QTY_BEFORE_RATE));
    assert.deepStrictEqual([d.code, d.description, d.unit, d.qty, d.rate, d.amount], [0, 1, 2, 3, 4, 5]);
    assert.strictEqual(d.confidence, "high");
    assert.ok(d.reasons.some(r => /headed "Rate" — read as Rate/.test(r)));
    const items = extractItems([["Item", "Description", "Unit", "Qty", "Rate", "Amount"]].concat(QTY_BEFORE_RATE), d).items;
    assert.deepStrictEqual(items.map(i => i.rate), [85, 22, 34, 48], "rates, not quantities");
});

test("detectColumns reads Chinese titles, and Rate before Qty", () => {
    let d = detectColumns([["编号", "说明", "单位", "数量", "单价", "金额"]].concat(QTY_BEFORE_RATE));
    assert.deepStrictEqual([d.qty, d.rate, d.amount], [3, 4, 5]);
    d = detectColumns([["Item", "Description", "Unit", "Rate (RM)", "Qty", "Amount (RM)"]]
        .concat(QTY_BEFORE_RATE.map(r => [r[0], r[1], r[2], r[4], r[3], r[5]])));
    assert.deepStrictEqual([d.rate, d.qty, d.amount], [3, 4, 5]);
});

test("without titles, the column written with decimals is the Rate; written alike, it needs review", () => {
    let d = detectColumns(QTY_BEFORE_RATE);
    assert.deepStrictEqual([d.qty, d.rate, d.amount], [3, 4, 5]);
    assert.strictEqual(d.confidence, "high");
    assert.ok(d.reasons.some(r => /written with decimals \(column 5\) is read as Rate/.test(r)));
    d = detectColumns(QTY_BEFORE_RATE.map(r => [r[0], r[1], r[2], r[3] + ".00", r[4], r[5]]));
    assert.strictEqual(d.confidence, "needs review");
    assert.ok(d.reasons.some(r => /could each be the Rate/.test(r)));
});
