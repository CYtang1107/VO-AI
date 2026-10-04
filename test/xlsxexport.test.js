const test = require("node:test");
const assert = require("node:assert");
const { buildRegisterWorkbook, registerFileName, xlsxCrc32, xlsxDateSerial, xlsxCol } = require("../js/xlsxexport.js");
const { parseXlsx } = require("../js/bqimport.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];

test("the ZIP checksum is standard CRC-32", () => {
    assert.strictEqual(xlsxCrc32(new TextEncoder().encode("123456789")), 0xCBF43926);
});

test("dates become Excel date serials and columns become letters", () => {
    assert.strictEqual(xlsxDateSerial("2020-01-01"), 43831);
    assert.strictEqual(xlsxDateSerial(""), null);
    assert.deepStrictEqual([0, 25, 26, 27].map(xlsxCol), ["A", "Z", "AA", "AB"]);
});

test("the file is named after the contract and the day, safely", () => {
    assert.strictEqual(registerFileName(project, "2026-10-04"), "VO-Register-ABC-2026-014-2026-10-04.xlsx");
});

test("the exported workbook opens, and its register sheet carries every VO with its figures", async () => {
    const bytes = buildRegisterWorkbook(project, "2026-10-04");
    assert.strictEqual(bytes[0], 0x50); /* "PK" — a ZIP */
    assert.strictEqual(bytes[1], 0x4B);
    const rows = await parseXlsx(bytes.buffer);
    const header = rows.find(r => r.includes("VO no."));
    assert.ok(header, "header row present");
    assert.ok(header.includes("Contractor's claim (RM)"));
    const vo1 = rows.find(r => r[0] === "VO-001");
    assert.ok(vo1, "VO-001 row present");
    assert.strictEqual(Number(vo1[7]), 62808, "contractor's claim");
    assert.strictEqual(Number(vo1[8]), 55856, "consultant's assessment");
    assert.strictEqual(Number(vo1[14]), 55856, "certified value");
    for (const vo of project.vos) assert.ok(rows.some(r => r[0] === vo.no), vo.no + " exported");
});

test("an uncertified VO exports no certified value rather than a guess", async () => {
    const rows = await parseXlsx(buildRegisterWorkbook(project, "2026-10-04").buffer);
    const vo2 = rows.find(r => r[0] === "VO-002");
    assert.ok(vo2[14] === undefined || vo2[14] === "" || vo2[14] === null);
});
