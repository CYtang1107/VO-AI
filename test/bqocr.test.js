const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const o = require("../js/bqocr.js");
const { extractItems, checkArithmetic } = require("../js/bqimport.js");

const rules = () => import(pathToFileURL(path.join(__dirname, "..", "supabase", "functions", "read-bq", "rules.mjs")).href);

test("a read-bq request is one bare base64 page, not too large", async () => {
    const r = await rules();
    assert.strictEqual(r.validBqRequest({ image: "QUJD" }), null);
    assert.match(r.validBqRequest({}), /image/);
    assert.match(r.validBqRequest({ image: "data:image/jpeg;base64,QUJD" }), /bare base64/);
    assert.match(r.validBqRequest({ image: "A".repeat(r.MAX_IMAGE_CHARS + 1) }), /too large/);
});

test("the model's answer is read as rows; RM and commas are tolerated; a number that does not read is a problem", async () => {
    const r = await rules();
    let p = r.parseBqRows('```json\n{"rows":[{"code":"B/4.1","description":"Ceramic  floor tiles\\n600x600mm","unit":"m2","qty":"1,200","rate":"RM 85.00","amount":102000},{"description":""}]}\n```');
    assert.deepStrictEqual(p.problems, []);
    assert.deepStrictEqual(p.rows, [{ code: "B/4.1", description: "Ceramic floor tiles 600x600mm", unit: "m2", qty: 1200, rate: 85, amount: 102000 }]);
    p = r.parseBqRows('Here you go: {"rows":[{"description":"Skirting","unit":"m","qty":null,"rate":22,"amount":null}]}');
    assert.strictEqual(p.rows[0].qty, null);
    assert.deepStrictEqual(r.parseBqRows("I cannot read this page").problems, ["format"]);
    assert.deepStrictEqual(r.parseBqRows('{"rows":[{"description":"X","rate":"eighty"}]}').problems, ["number"]);
    assert.match(r.correction(["format"]), /JSON only/);
    assert.match(r.BQ_PROMPT, /Never calculate, estimate or fill in a number/);
});

test("OCR rows become a sheet that the spreadsheet preview reads with known columns, arithmetic included", () => {
    const sheet = o.ocrRowsToSheet([
        { code: "B/4.1", description: "Ceramic floor tiles", unit: "m2", qty: 320, rate: 85, amount: 27200 },
        { code: "B/4.2", description: "Skirting", unit: "m", qty: 168, rate: 22, amount: 3000 },
        { code: "", description: "Timber door", unit: "no", qty: null, rate: 640, amount: null }
    ]);
    assert.deepStrictEqual(sheet[0], o.BQ_OCR_COLUMNS);
    const items = extractItems(sheet, o.BQ_OCR_MAPPING).items;
    assert.deepStrictEqual(items.map(i => [i.code, i.rate]), [["B/4.1", 85], ["B/4.2", 22], ["", 640]]);
    const check = checkArithmetic(sheet, o.BQ_OCR_MAPPING);
    assert.strictEqual(check.rowIssues.length, 1, "168 × 22 is 3,696, not 3,000");
});

test("PDFs and photos go to OCR; spreadsheets do not", () => {
    ["bq.pdf", "BQ page 1.JPG", "scan.png", "x.webp"].forEach(n => assert.ok(o.isOcrBqFile(n), n));
    ["bq.csv", "bq.xlsx", "bq.docx"].forEach(n => assert.ok(!o.isOcrBqFile(n), n));
});
