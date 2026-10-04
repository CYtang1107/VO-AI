/* VO-AI | xlsxexport.js — the VO register as an Excel workbook (.xlsx).

   Written by hand, like js/bqimport.js reads one: a workbook is a ZIP
   of a few XML files, so this builds the XML and a minimal (stored,
   uncompressed) ZIP around it — no SheetJS, no dependency.

   Two sheets:
   - Register: one row per VO — the register's columns, with the claim,
     assessment, variance and certified value as numbers and totals as
     live SUM formulas, so the file can be worked on in Excel.
   - Measurement: one row per measured item, with its rate-check verdict
     and the contract BQ rate it was checked against.
   Every figure comes from the same functions the register, the VO page
   and the summary report use, so the workbook cannot disagree with them.

   buildRegisterWorkbook() is pure (returns the bytes); downloading them
   is the browser wiring's job (js/page-register.js). */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { contractorTotal, assessedTotal, today } = require("./calc.js");
    var { checkRate } = require("./analysis.js");
    var { deadlinesFor } = require("./deadlines.js");
    var { t, getLang } = require("./i18n.js");
}

/* ---------- ZIP (stored entries only) ---------- */

var XLSX_CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function xlsxCrc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = XLSX_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function xlsxUtf8(s) {
    return new TextEncoder().encode(s);
}

/* files: [{ name, text }] -> Uint8Array of a ZIP archive. */
function xlsxZip(files) {
    var locals = [];
    var centrals = [];
    var offset = 0;
    files.forEach(function (f) {
        var name = xlsxUtf8(f.name);
        var data = xlsxUtf8(f.text);
        var crc = xlsxCrc32(data);

        var local = new Uint8Array(30 + name.length + data.length);
        var lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);   /* local file header */
        lv.setUint16(4, 20, true);           /* version needed */
        lv.setUint16(6, 0x0800, true);       /* UTF-8 names */
        lv.setUint16(8, 0, true);            /* stored */
        lv.setUint16(10, 0, true);           /* time */
        lv.setUint16(12, 0x21, true);        /* date: 1980-01-01 */
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, name.length, true);
        lv.setUint16(28, 0, true);
        local.set(name, 30);
        local.set(data, 30 + name.length);

        var central = new Uint8Array(46 + name.length);
        var cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);   /* central directory header */
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0x21, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        central.set(name, 46);

        locals.push(local);
        centrals.push(central);
        offset += local.length;
    });

    var centralSize = centrals.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);       /* end of central directory */
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    var out = new Uint8Array(offset + centralSize + end.length);
    var pos = 0;
    locals.concat(centrals, [end]).forEach(function (part) { out.set(part, pos); pos += part.length; });
    return out;
}

/* ---------- worksheet XML ---------- */

function xlsxEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xlsxCol(i) {
    var s = "";
    i += 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
}

/* Days since 1899-12-30, Excel's date serial, for a YYYY-MM-DD string. */
function xlsxDateSerial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return null;
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

/* Style ids — the order of <cellXfs> in xlsxStylesXml(). */
var XS = { text: 0, header: 1, money: 2, date: 3, totalLabel: 4, totalMoney: 5, wrap: 6, title: 7, int: 8 };

/* A cell value: a string, a number, null (empty), or
   { n, s } / { d: iso } / { f: formula, v: cached value, s } . */
function xlsxCell(ref, value, style) {
    var s = style === undefined ? XS.text : style;
    if (value === null || value === undefined || value === "") {
        return s ? '<c r="' + ref + '" s="' + s + '"/>' : "";
    }
    if (typeof value === "object" && value.f) {
        var cached = (typeof value.v === "number" && isFinite(value.v)) ? "<v>" + value.v + "</v>" : "";
        return '<c r="' + ref + '" s="' + (value.s !== undefined ? value.s : s) + '"><f>' + xlsxEsc(value.f) + "</f>" + cached + "</c>";
    }
    if (typeof value === "object" && value.d) {
        var serial = xlsxDateSerial(value.d);
        return serial === null ? "" : '<c r="' + ref + '" s="' + XS.date + '"><v>' + serial + "</v></c>";
    }
    if (typeof value === "number") {
        return isFinite(value) ? '<c r="' + ref + '" s="' + s + '"><v>' + value + "</v></c>" : "";
    }
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + xlsxEsc(value) + "</t></is></c>";
}

/* rows: [{ cells: [value...], styles: [style...] (optional), height? }]
   meta: { widths: [chars...], headerRow (1-based), lastCol } */
function xlsxSheetXml(rows, meta) {
    var cols = '<cols>' + meta.widths.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join("") + "</cols>";
    var body = rows.map(function (row, r) {
        var rn = r + 1;
        var cells = row.cells.map(function (v, c) {
            var style = row.styles ? row.styles[c] : row.style;
            return xlsxCell(xlsxCol(c) + rn, v, style);
        }).join("");
        return '<row r="' + rn + '"' + (row.height ? ' ht="' + row.height + '" customHeight="1"' : "") + ">" + cells + "</row>";
    }).join("");
    var lastRow = meta.lastDataRow || rows.length;
    var range = "A" + meta.headerRow + ":" + xlsxCol(meta.lastCol) + lastRow;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + meta.headerRow + '" topLeftCell="A' +
        (meta.headerRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' + cols +
        "<sheetData>" + body + "</sheetData>" +
        (lastRow > meta.headerRow ? '<autoFilter ref="' + range + '"/>' : "") +
        '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
        '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
        "</worksheet>";
}

function xlsxStylesXml(lang) {
    var dateFmt = lang === "zh" ? 'yyyy"年"m"月"d"日"' : "dd mmm yyyy";
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/>' +
        '<numFmt numFmtId="165" formatCode="' + xlsxEsc(dateFmt) + '"/></numFmts>' +
        '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE3E7EE"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left/><right/><top/><bottom style="thin"><color rgb="FF8A93A6"/></bottom><diagonal/></border>' +
        '<border><left/><right/><top style="thin"><color rgb="FF161D2E"/></top><bottom style="double"><color rgb="FF161D2E"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="9">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
        "</cellXfs>" +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        "</styleSheet>";
}

/* ---------- the register ---------- */

function xlsxStatus(value) {
    if (!value) return "";
    var key = "status." + value;
    var label = t(key, {});
    return label === key ? value : label;
}

function xlsxInstructionType(value) {
    if (!value) return "";
    var key = "instructionType." + value;
    var label = t(key, {});
    return label === key ? value : label;
}

/* Same rule as the register's VO DUE DATE column (js/page-register.js
   dueDateCell): the consultant's manual date, else the computed
   evaluation deadline and its state. */
function xlsxDueDate(vo, todayIso) {
    if (vo.dueDate) return { date: vo.dueDate, basis: t("register.manual") };
    var clock = deadlinesFor(vo, todayIso)[0];
    if (!clock || !clock.dueDate) return { date: null, basis: "" };
    return { date: clock.dueDate, basis: t("deadline.state." + clock.state, {}) };
}

/* Same rule as the summary report: a certified value exists only once
   the client has certified AND entered a final price. */
function xlsxCertifiedValue(vo) {
    if (vo.certifiedStatus === "Approved" &&
        vo.finalPrice !== null && vo.finalPrice !== undefined && vo.finalPrice !== "") {
        return Number(vo.finalPrice) || 0;
    }
    return null;
}

function xlsxBlankable(v) {
    return (v === "" || v === null || v === undefined) ? null : (Number(v) || 0);
}

function registerSheet(project, todayIso) {
    var vos = project.vos || [];
    var bq = project.bq || [];
    var headers = ["no", "description", "dateIssued", "dueDate", "dueBasis", "type", "instructionNo",
                   "claimed", "assessed", "variance", "rateCheck", "timeImpact",
                   "evaluateStatus", "certifiedStatus", "certified"].map(function (k) { return t("export.col." + k); });
    var H = 4; /* header row */
    var rows = [
        { cells: [t("export.title", { project: project.name || "" })], style: XS.title, height: 22 },
        { cells: [t("export.subtitle", { no: project.contractNo || "—", client: project.client || "—", date: todayIso })] },
        { cells: [] },
        { cells: headers, style: XS.header, height: 48 }
    ];
    vos.forEach(function (vo, i) {
        var r = H + 1 + i;
        var due = xlsxDueDate(vo, todayIso);
        var counts = { same: 0, different: 0, star: 0 };
        (vo.measurement || []).forEach(function (row) { counts[checkRate(row, bq).state]++; });
        var rateText = ["same", "different", "star"].filter(function (k) { return counts[k]; })
            .map(function (k) { return t("register.rate." + k, { n: counts[k] }); }).join(" · ");
        var claimed = contractorTotal(vo);
        var assessed = assessedTotal(vo);
        rows.push({
            cells: [vo.no, vo.description || "", { d: vo.dateIssued }, due.date ? { d: due.date } : null, due.basis,
                    xlsxInstructionType(vo.typeOfInstruction), vo.instructionNo || "",
                    claimed, assessed, { f: "I" + r + "-H" + r, v: assessed - claimed },
                    rateText, xlsxBlankable(vo.timeImpact),
                    xlsxStatus(vo.evaluateStatus), xlsxStatus(vo.certifiedStatus), xlsxCertifiedValue(vo)],
            styles: [XS.text, XS.wrap, XS.date, XS.date, XS.text, XS.text, XS.text,
                     XS.money, XS.money, XS.money, XS.wrap, XS.int, XS.text, XS.text, XS.money]
        });
    });
    var first = H + 1, last = H + vos.length;
    if (vos.length > 0) {
        var sum = function (col, values) {
            return { f: "SUM(" + col + first + ":" + col + last + ")", v: values.reduce(function (s, x) { return s + (x || 0); }, 0), s: XS.totalMoney };
        };
        var claimedAll = vos.map(contractorTotal), assessedAll = vos.map(assessedTotal);
        rows.push({
            cells: [t("export.total"), "", "", "", "", "", "",
                    sum("H", claimedAll), sum("I", assessedAll),
                    sum("J", assessedAll.map(function (a, i) { return a - claimedAll[i]; })),
                    "", "", "", "", sum("O", vos.map(xlsxCertifiedValue))],
            styles: [XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel,
                     XS.totalMoney, XS.totalMoney, XS.totalMoney, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalMoney]
        });
    }
    return xlsxSheetXml(rows, {
        widths: [10, 46, 15, 15, 12, 24, 14, 18, 18, 16, 28, 14, 12, 12, 18],
        headerRow: H, lastCol: 14, lastDataRow: Math.max(last, H)
    });
}

function measurementSheet(project, todayIso) {
    var bq = project.bq || [];
    var headers = ["no", "item", "bqItem", "unit", "qty", "rate", "amount", "contractRate", "verdict",
                   "assessedQty", "assessedRate", "assessedAmount"].map(function (k) { return t("export.mcol." + k); });
    var H = 4;
    var rows = [
        { cells: [t("export.measurementTitle", { project: project.name || "" })], style: XS.title, height: 22 },
        { cells: [t("export.subtitle", { no: project.contractNo || "—", client: project.client || "—", date: todayIso })] },
        { cells: [] },
        { cells: headers, style: XS.header, height: 48 }
    ];
    var claimedSum = 0, assessedSum = 0;
    (project.vos || []).forEach(function (vo) {
        (vo.measurement || []).forEach(function (row) {
            var r = rows.length + 1; /* the 1-based row this item is written to */
            var check = checkRate(row, bq);
            var linked = row.bqItemId ? bq.find(function (b) { return b.id === row.bqItemId; }) : null;
            var item = linked
                ? linked.code
                : (check.matchedItem ? t("export.suggested", { code: check.matchedItem.code }) : "");
            var qty = Number(row.qty) || 0, rate = Number(row.rate) || 0;
            var aQty = xlsxBlankable(row.assessedQty), aRate = xlsxBlankable(row.assessedRate);
            var assessedAmount = (aQty === null ? qty : aQty) * (aRate === null ? rate : aRate);
            claimedSum += qty * rate;
            assessedSum += assessedAmount;
            rows.push({
                cells: [vo.no, row.description || "", item, row.unit || "", qty, rate,
                        { f: "E" + r + "*F" + r, v: qty * rate },
                        check.contractRate !== undefined ? check.contractRate : null,
                        t("rate." + check.state + ".label"),
                        aQty, aRate,
                        { f: 'IF(J' + r + '="",E' + r + ',J' + r + ')*IF(K' + r + '="",F' + r + ',K' + r + ')', v: assessedAmount }],
                styles: [XS.text, XS.wrap, XS.text, XS.text, XS.money, XS.money, XS.money, XS.money, XS.text,
                         XS.money, XS.money, XS.money]
            });
        });
    });
    var first = H + 1, last = rows.length;
    if (last >= first) {
        rows.push({
            cells: [t("export.total"), "", "", "", "", "",
                    { f: "SUM(G" + first + ":G" + last + ")", v: claimedSum, s: XS.totalMoney }, "", "", "", "",
                    { f: "SUM(L" + first + ":L" + last + ")", v: assessedSum, s: XS.totalMoney }],
            styles: [XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel,
                     XS.totalMoney, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalLabel, XS.totalMoney]
        });
    }
    return xlsxSheetXml(rows, {
        widths: [10, 44, 16, 8, 10, 14, 16, 16, 14, 12, 14, 16],
        headerRow: H, lastCol: 11, lastDataRow: Math.max(last, H)
    });
}

/* The whole workbook, as the bytes of an .xlsx file. */
function buildRegisterWorkbook(project, todayIso) {
    var day = todayIso || today();
    var lang = typeof getLang === "function" ? getLang() : "en";
    /* Sheet names: max 31 chars, none of : \ / ? * [ ] */
    var clean = function (s) { return String(s).replace(/[:\\\/?*\[\]]/g, " ").slice(0, 31); };
    var sheet1 = clean(t("export.sheet.register"));
    var sheet2 = clean(t("export.sheet.measurement"));
    return xlsxZip([
        { name: "[Content_Types].xml", text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            "</Types>" },
        { name: "_rels/.rels", text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            "</Relationships>" },
        { name: "xl/workbook.xml", text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheets><sheet name="' + xlsxEsc(sheet1) + '" sheetId="1" r:id="rId1"/>' +
            '<sheet name="' + xlsxEsc(sheet2) + '" sheetId="2" r:id="rId2"/></sheets>' +
            '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' +
            xlsxEsc(sheet1.replace(/'/g, "''")) + '\'!$A$4:$O$' + (4 + (project.vos || []).length) + "</definedName></definedNames>" +
            '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
            "</workbook>" },
        { name: "xl/_rels/workbook.xml.rels", text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            "</Relationships>" },
        { name: "xl/styles.xml", text: xlsxStylesXml(lang) },
        { name: "xl/worksheets/sheet1.xml", text: registerSheet(project, day) },
        { name: "xl/worksheets/sheet2.xml", text: measurementSheet(project, day) }
    ]);
}

/* "VO-Register-ABC-2026-014-2026-10-04.xlsx" — safe on every OS. */
function registerFileName(project, todayIso) {
    var ref = String(project.contractNo || project.name || "project").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return "VO-Register-" + (ref || "project") + "-" + (todayIso || today()) + ".xlsx";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildRegisterWorkbook, registerFileName, xlsxZip, xlsxCrc32, xlsxDateSerial, xlsxCol };
}
