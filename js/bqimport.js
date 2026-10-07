/* VO-AI | bqimport.js — read a priced Bills of Quantities from a real
   spreadsheet (.csv or .xlsx) and work out which column is which.
   Zero dependencies: CSV is hand-parsed, and .xlsx is unzipped and its
   XML read with the runtime's own DecompressionStream — no SheetJS, no
   library. Every function here is pure and DOM-free so it is directly
   unit-testable; the browser wiring (file input, preview, confirm) lives
   in page-projects.js. Nothing here ever imports data on its own — the
   caller must always run the result past the user for confirmation. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
}

/* ---------- shared lookup tables (module-level; declared with `var` —
   see the dual-target note at the bottom of this file) ---------- */

var BQ_UNIT_TOKENS = [
    "m", "m2", "m²", "m3", "m³", "mm", "no", "nr", "item",
    "sum", "kg", "t", "set", "pair", "l.s.", "ls"
];

var BQ_UNIT_SET = (function (list) {
    var set = {};
    list.forEach(function (t) { set[t] = true; });
    return set;
})(BQ_UNIT_TOKENS);

/* A bill reference such as B/4.1, C/2.3, A.1.2 or 1.01: an optional
   short letter prefix, then two or more digit groups joined by "/" or
   ".". Deliberately does NOT match a bare number like "85" (a rate)
   or free text. */
var BQ_CODE_RE = /^[A-Za-z]{0,3}[\/.]?\d+(?:[\/.]\d+)+$/;

/* Cells that read like a column title, not a value. */
var BQ_HEADER_WORDS = {
    "code": true, "ref": true, "reference": true, "item": true,
    "item no": true, "item no.": true, "no": true, "no.": true,
    "description": true, "desc": true, "particulars": true,
    "unit": true, "units": true, "uom": true,
    "rate": true, "rate (rm)": true, "unit rate": true,
    "amount": true, "amount (rm)": true, "total": true,
    "qty": true, "quantity": true, "quantities": true,
    "编号": true, "项次": true, "说明": true, "描述": true, "单位": true,
    "数量": true, "工程量": true, "单价": true, "金额": true, "合价": true
};

/* Description text that marks a subtotal / running-total row rather
   than a priced item. */
var BQ_TOTAL_RE = /\b(sub[\s-]?total|total|carried forward|carry forward|c\/f|b\/f|collection)\b/i;

/* ==========================================================
   CSV
========================================================== */

/* Hand-written CSV parser: handles quoted fields (with embedded commas
   and doubled "" for a literal quote), and both \r\n and \n line
   endings. Returns a grid of raw string cells, one array per row. */
function parseCsv(text) {
    var s = String(text === null || text === undefined ? "" : text);
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;

    for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (inQuotes) {
            if (c === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else {
                field += c;
            }
            continue;
        }
        if (c === '"') { inQuotes = true; }
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\r") { /* swallow; \n (if present) ends the row */ }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else { field += c; }
    }
    if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }

    return rows;
}

/* ==========================================================
   XLSX — a .xlsx is a ZIP of XML. We parse just enough of the ZIP
   central directory to pull out xl/worksheets/sheet1.xml and
   xl/sharedStrings.xml, decompressing with DecompressionStream when an
   entry is deflated, and reading it as-is when it is stored.
========================================================== */

function bqColLetterToIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) {
        n = n * 26 + (letters.charCodeAt(i) - 64);
    }
    return n - 1;
}

function bqDecodeXmlEntities(s) {
    return String(s)
        .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

/* Pure: turns xl/sharedStrings.xml text into an ordered array of
   strings, concatenating the runs of any rich-text <si> entry. */
function parseSharedStrings(xml) {
    var strings = [];
    var siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    var m;
    while ((m = siRe.exec(String(xml || "")))) {
        var content = m[1];
        var tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        var tm;
        var text = "";
        while ((tm = tRe.exec(content))) { text += bqDecodeXmlEntities(tm[1]); }
        strings.push(text);
    }
    return strings;
}

/* Pure: turns xl/worksheets/sheet1.xml text (plus the shared-string
   table, if any) into a grid of raw string cells. Cells are placed at
   their real column index (from the "B7" style cell reference) so a
   row with gaps still lines up with the rows around it. */
function parseSheetXml(xml, sharedStrings) {
    sharedStrings = sharedStrings || [];
    var rows = [];
    var rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    var rowMatch;

    while ((rowMatch = rowRe.exec(String(xml || "")))) {
        var rowContent = rowMatch[1];
        var cells = [];
        var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        var cellMatch;

        while ((cellMatch = cellRe.exec(rowContent))) {
            var attrs = cellMatch[1];
            var inner = cellMatch[2];
            var rMatch = /r="([A-Za-z]+)\d+"/.exec(attrs);
            if (!rMatch) continue;
            var colIndex = bqColLetterToIndex(rMatch[1]);
            var tMatch = /\bt="([^"]+)"/.exec(attrs);
            var type = tMatch ? tMatch[1] : "n";
            var value = "";

            if (inner) {
                if (type === "s") {
                    var vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
                    var idx = vMatch ? parseInt(vMatch[1], 10) : -1;
                    value = sharedStrings[idx] !== undefined ? sharedStrings[idx] : "";
                } else if (type === "inlineStr") {
                    var isMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
                    value = isMatch ? bqDecodeXmlEntities(isMatch[1]) : "";
                } else {
                    var vMatch2 = /<v>([\s\S]*?)<\/v>/.exec(inner);
                    value = vMatch2 ? bqDecodeXmlEntities(vMatch2[1]) : "";
                }
            }
            cells.push({ col: colIndex, value: value });
        }

        if (cells.length === 0) { rows.push([""]); continue; }
        var maxCol = cells.reduce(function (m, c) { return Math.max(m, c.col); }, -1);
        var rowArr = new Array(maxCol + 1).fill("");
        cells.forEach(function (c) { rowArr[c.col] = c.value; });
        rows.push(rowArr);
    }

    return rows;
}

/* Minimal ZIP central-directory reader. Returns [{name, method,
   compressedSize, uncompressedSize, localHeaderOffset}, ...]. */
function bqReadZipEntries(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocdOffset = -1;
    for (var i = bytes.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) {
        throw new Error("Not a ZIP file (no end-of-central-directory record found).");
    }

    var totalEntries = view.getUint16(eocdOffset + 10, true);
    var offset = view.getUint32(eocdOffset + 16, true);
    var entries = [];

    for (var e = 0; e < totalEntries; e++) {
        var sig = view.getUint32(offset, true);
        if (sig !== 0x02014b50) break;
        var method = view.getUint16(offset + 10, true);
        var compressedSize = view.getUint32(offset + 20, true);
        var uncompressedSize = view.getUint32(offset + 24, true);
        var nameLen = view.getUint16(offset + 28, true);
        var extraLen = view.getUint16(offset + 30, true);
        var commentLen = view.getUint16(offset + 32, true);
        var localHeaderOffset = view.getUint32(offset + 42, true);
        var nameBytes = bytes.slice(offset + 46, offset + 46 + nameLen);
        var name = new TextDecoder("utf-8").decode(nameBytes);

        entries.push({
            name: name, method: method, compressedSize: compressedSize,
            uncompressedSize: uncompressedSize, localHeaderOffset: localHeaderOffset
        });
        offset += 46 + nameLen + extraLen + commentLen;
    }

    return entries;
}

function bqFindEntry(entries, re) {
    for (var i = 0; i < entries.length; i++) {
        if (re.test(entries[i].name)) return entries[i];
    }
    return null;
}

function bqFindFirstSheetEntry(entries) {
    var sheets = entries.filter(function (e) { return /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name); });
    sheets.sort(function (a, b) {
        var na = parseInt(/sheet(\d+)\.xml/i.exec(a.name)[1], 10);
        var nb = parseInt(/sheet(\d+)\.xml/i.exec(b.name)[1], 10);
        return na - nb;
    });
    return sheets[0] || null;
}

async function bqInflateRaw(uint8) {
    var ds = new DecompressionStream("deflate-raw");
    var writer = ds.writable.getWriter();
    var chunks = [];
    var readPromise = (async function () {
        var reader = ds.readable.getReader();
        for (;;) {
            var next = await reader.read();
            if (next.done) break;
            chunks.push(next.value);
        }
    })();
    await writer.write(uint8);
    await writer.close();
    await readPromise;

    var total = chunks.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(total);
    var off = 0;
    chunks.forEach(function (c) { out.set(c, off); off += c.length; });
    return out;
}

async function bqExtractEntryBytes(bytes, entry) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var lo = entry.localHeaderOffset;
    if (view.getUint32(lo, true) !== 0x04034b50) {
        throw new Error("Corrupt ZIP entry: " + entry.name);
    }
    var nameLen = view.getUint16(lo + 26, true);
    var extraLen = view.getUint16(lo + 28, true);
    var dataStart = lo + 30 + nameLen + extraLen;
    var compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return compressed;
    if (entry.method === 8) return bqInflateRaw(compressed);
    throw new Error("Unsupported compression in " + entry.name + " (method " + entry.method + ").");
}

/* Reads the first worksheet of an .xlsx file (as an ArrayBuffer) into
   a grid of raw string cells. Async because deflated ZIP entries are
   decompressed with DecompressionStream, which is stream-based. Throws
   a clear Error — never a partial result — when the file is not a
   readable .xlsx. */
async function parseXlsx(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var entries;
    try {
        entries = bqReadZipEntries(bytes);
    } catch (e) {
        throw new Error("This does not look like a valid .xlsx file.");
    }

    var sheetEntry = bqFindEntry(entries, /^xl\/worksheets\/sheet1\.xml$/i) || bqFindFirstSheetEntry(entries);
    if (!sheetEntry) {
        throw new Error("No worksheet was found inside that .xlsx file.");
    }

    var sheetBytes = await bqExtractEntryBytes(bytes, sheetEntry);
    var sheetXml = new TextDecoder("utf-8").decode(sheetBytes);

    var sharedStrings = [];
    var sharedEntry = bqFindEntry(entries, /^xl\/sharedStrings\.xml$/i);
    if (sharedEntry) {
        var sharedBytes = await bqExtractEntryBytes(bytes, sharedEntry);
        sharedStrings = parseSharedStrings(new TextDecoder("utf-8").decode(sharedBytes));
    }

    return parseSheetXml(sheetXml, sharedStrings);
}

/* ==========================================================
   Column role detection + row classification
========================================================== */

function bqNumericLoose(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (s === "") return null;
    var cleaned = s.replace(/^(RM|MYR)\s*/i, "").replace(/,/g, "").replace(/\s+/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    var n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function bqIsUnitToken(v) {
    var n = String(v).trim().toLowerCase();
    if (BQ_UNIT_SET[n]) return true;
    if (n.slice(-1) === "." && BQ_UNIT_SET[n.slice(0, -1)]) return true;
    return false;
}

function bqIsBlankRow(row) {
    return !row || row.every(function (c) { return String(c === null || c === undefined ? "" : c).trim() === ""; });
}

/* A row of column titles — "Code", "Description", "Unit", "Rate" and
   the like — rather than a priced item. */
function bqLooksLikeHeaderRow(row) {
    if (!row) return false;
    var nonEmpty = 0, matches = 0;
    row.forEach(function (c) {
        var v = String(c === null || c === undefined ? "" : c).trim().toLowerCase();
        if (v === "") return;
        nonEmpty++;
        if (BQ_HEADER_WORDS[v]) matches++;
    });
    if (nonEmpty === 0) return false;
    return matches >= 2 && matches / nonEmpty >= 0.5;
}

/* What a column's title says it is. Rate is tested before Unit, so
   "Unit rate" is a rate. English and Chinese titles. */
var BQ_HEADER_ROLES = [
    ["rate",        /^(unit\s*)?rate\b|^price\b|单价|单位价格/i],
    ["qty",         /^(qty|quantity|quantities)\b|数量|工程量/i],
    ["amount",      /^(amount|total)\b|金额|合价|总价/i],
    ["unit",        /^(unit|units|uom)\.?$|^单位$/i],
    ["description", /^(description|desc|particulars)\b|说明|描述|项目名称/i],
    ["code",        /^(code|ref|reference|item(\s*no\.?)?|no\.?)$|编号|项次/i]
];

/* The first header row's columns by role ({rate: 4, qty: 3, ...}), and
   each column's title; empty when the sheet has no header row. */
function bqHeaderRoles(rows) {
    var header = (rows || []).find(function (r) { return bqLooksLikeHeaderRow(r); });
    var roles = {}, titles = {};
    if (!header) return { roles: roles, titles: titles };
    header.forEach(function (c, col) {
        var v = String(c === null || c === undefined ? "" : c).trim();
        if (!v) return;
        for (var i = 0; i < BQ_HEADER_ROLES.length; i++) {
            var role = BQ_HEADER_ROLES[i][0];
            if (BQ_HEADER_ROLES[i][1].test(v)) {
                if (roles[role] === undefined) { roles[role] = col; titles[role] = v; }
                break;
            }
        }
    });
    return { roles: roles, titles: titles };
}

/* How many of a column's figures are written with decimals ("85.00"):
   a rate nearly always is, a quantity often is not. */
function bqDecimalShare(rows, col) {
    var n = 0, dec = 0;
    rows.forEach(function (r) {
        var v = r[col] === undefined || r[col] === null ? "" : String(r[col]).trim();
        if (bqNumericLoose(v) === null) return;
        n++;
        if (/\.\d/.test(v)) dec++;
    });
    return n ? dec / n : 0;
}

/* Scores every column of `rows` against Rate / Unit / Code /
   Description and returns the best mapping it can find, plus
   human-readable reasons and a plain-label confidence. Never
   fabricates a percentage for the overall confidence — only per-column
   stats, which are real. */
function detectColumns(rows) {
    rows = rows || [];
    var usableRows = rows.filter(function (r) { return r && !bqIsBlankRow(r) && !bqLooksLikeHeaderRow(r); });
    var maxCols = usableRows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);

    if (maxCols === 0 || usableRows.length === 0) {
        return {
            code: null, description: null, unit: null, rate: null,
            confidence: "needs review",
            reasons: [t("bqimport.detect.noneFound")]
        };
    }

    var stats = [];
    for (var col = 0; col < maxCols; col++) {
        var values = usableRows
            .map(function (r) { return r[col] !== undefined ? String(r[col]).trim() : ""; })
            .filter(function (v) { return v !== ""; });

        var numericVals = values.map(bqNumericLoose).filter(function (n) { return n !== null && n >= 0; });
        var wholeSmall = numericVals.filter(function (n) { return Number.isInteger(n) && n <= 20; }).length;
        var unitMatches = values.filter(bqIsUnitToken).length;
        var codeMatches = values.filter(function (v) { return BQ_CODE_RE.test(v); }).length;
        var totalLen = values.reduce(function (s, v) { return s + v.length; }, 0);

        stats.push({
            col: col,
            count: values.length,
            fillRatio: values.length / usableRows.length,
            numericRatio: values.length ? numericVals.length / values.length : 0,
            wholeSmallFraction: numericVals.length ? wholeSmall / numericVals.length : 1,
            avgNumericValue: numericVals.length ? numericVals.reduce(function (s, n) { return s + n; }, 0) / numericVals.length : 0,
            unitRatio: values.length ? unitMatches / values.length : 0,
            codeRatio: values.length ? codeMatches / values.length : 0,
            avgLen: values.length ? totalLen / values.length : 0
        });
    }

    var used = {};
    var reasons = [];

    /* a column whose title names the role is taken first */
    var heads = bqHeaderRoles(rows);
    Object.keys(heads.roles).forEach(function (role) { used[heads.roles[role]] = true; });

    function pick(filterFn, sortFn, role, describe) {
        if (heads.roles[role] !== undefined) {
            reasons.push(t("bqimport.detect.header", { col: heads.roles[role] + 1, title: heads.titles[role], role: t("bqimport.role." + role) }));
            return heads.roles[role];
        }
        var candidates = stats.filter(function (s) { return !used[s.col] && filterFn(s); }).sort(sortFn);
        if (candidates.length === 0) {
            reasons.push(describe.none);
            return null;
        }
        var s = candidates[0];
        used[s.col] = true;
        reasons.push(describe.found(s));
        return s.col;
    }

    var unitCol = pick(
        function (s) { return s.count > 0 && s.unitRatio >= 0.6; },
        function (a, b) { return b.unitRatio - a.unitRatio; },
        "unit",
        {
            none: t("bqimport.detect.unit.none"),
            found: function (s) {
                return t("bqimport.detect.unit.found", { col: s.col + 1, pct: Math.round(s.unitRatio * 100) });
            }
        }
    );

    /* Rate is scored before Code: a purely numeric column (e.g. "45.00")
       can superficially match the bill-reference pattern too (it looks
       like "1.01"), so the stronger, money-shaped numeric candidate is
       claimed as Rate first, leaving Code to pick from what is left. */
    var rateCol = pick(
        function (s) { return s.count > 0 && s.numericRatio >= 0.6; },
        function (a, b) { return a.wholeSmallFraction - b.wholeSmallFraction || b.numericRatio - a.numericRatio; },
        "rate",
        {
            none: t("bqimport.detect.rate.none"),
            found: function (s) {
                return t("bqimport.detect.rate.found",
                    { col: s.col + 1, pct: Math.round(s.numericRatio * 100), avg: s.avgNumericValue.toFixed(2) });
            }
        }
    );

    var codeCol = pick(
        function (s) { return s.count > 0 && s.codeRatio >= 0.6; },
        function (a, b) { return b.codeRatio - a.codeRatio; },
        "code",
        {
            none: t("bqimport.detect.code.none"),
            found: function (s) {
                return t("bqimport.detect.code.found", { col: s.col + 1, pct: Math.round(s.codeRatio * 100) });
            }
        }
    );

    var descCol = pick(
        function (s) { return s.fillRatio >= 0.3 && s.numericRatio < 0.5; },
        function (a, b) { return b.avgLen - a.avgLen; },
        "description",
        {
            none: t("bqimport.detect.desc.none"),
            found: function (s) {
                return t("bqimport.detect.desc.found", { col: s.col + 1, chars: Math.round(s.avgLen) });
            }
        }
    );

    /* Qty and Amount are found by the BQ's own arithmetic rather than by
       their look: the pair of remaining columns for which Qty x Rate =
       Amount on most priced rows. They are used only to check that
       arithmetic (checkArithmetic), never imported. */
    var qtyCol = null, amountCol = null;
    var ambiguous = false;
    if (heads.roles.qty !== undefined && heads.roles.amount !== undefined) {
        qtyCol = heads.roles.qty;
        amountCol = heads.roles.amount;
        reasons.push(t("bqimport.detect.header", { col: qtyCol + 1, title: heads.titles.qty, role: t("bqimport.role.qty") }));
        reasons.push(t("bqimport.detect.header", { col: amountCol + 1, title: heads.titles.amount, role: t("bqimport.role.amount") }));
        /* the titles, checked against the BQ's own arithmetic */
        if (rateCol !== null) {
            var only = {};
            for (var c = 0; c < maxCols; c++) if (c !== qtyCol && c !== amountCol) only[c] = true;
            var hq = bqFindQtyAmount(usableRows, rateCol, only, maxCols);
            if (hq && hq.qty === qtyCol && hq.amount === amountCol) {
                reasons.push(t("bqimport.detect.qtyAmount.found", { qty: qtyCol + 1, amount: amountCol + 1, m: hq.matches, n: hq.rows }));
            }
        }
    } else if (rateCol !== null) {
        /* a header naming just one of them still frees its column for the search */
        var free = Object.assign({}, used);
        if (heads.roles.qty !== undefined) delete free[heads.roles.qty];
        if (heads.roles.amount !== undefined) delete free[heads.roles.amount];
        var qa = bqFindQtyAmount(usableRows, rateCol, free, maxCols);
        if (qa) {
            qtyCol = qa.qty;
            amountCol = qa.amount;
            reasons.push(t("bqimport.detect.qtyAmount.found",
                { qty: qtyCol + 1, amount: amountCol + 1, m: qa.matches, n: qa.rows }));
            /* Qty × Rate = Amount reads the same with Qty and Rate swapped.
               Without a "Rate" title, the column written with decimals is
               the rate; if both are written alike, say it needs a look. */
            if (heads.roles.rate === undefined) {
                var rateDec = bqDecimalShare(usableRows, rateCol), qtyDec = bqDecimalShare(usableRows, qtyCol);
                if (qtyDec > rateDec) {
                    var was = rateCol;
                    rateCol = qtyCol;
                    qtyCol = was;
                    reasons.push(t("bqimport.detect.swapped", { rate: rateCol + 1, qty: qtyCol + 1 }));
                } else if (qtyDec === rateDec) {
                    ambiguous = true;
                    reasons.push(t("bqimport.detect.ambiguous", { rate: rateCol + 1, qty: qtyCol + 1 }));
                }
            }
        } else {
            reasons.push(t("bqimport.detect.qtyAmount.none"));
        }
    }

    var confidence = (rateCol !== null && descCol !== null && !ambiguous) ? "high" : "needs review";

    return {
        code: codeCol, description: descCol, unit: unitCol, rate: rateCol,
        qty: qtyCol, amount: amountCol,
        confidence: confidence, reasons: reasons
    };
}

/* Rounding allowance when a BQ's arithmetic is re-checked. Amounts are
   written to the sen and a quantity may be shown rounded, so a
   difference within RM 0.05, or 0.01% of the amount, is not a mistake.
   A typed-wrong figure (27,020 for 27,200) is far outside it. */
var BQ_ARITH_ABS_TOL = 0.05;
var BQ_ARITH_REL_TOL = 0.0001;

function bqAmountsAgree(a, b) {
    return Math.abs(a - b) <= Math.max(BQ_ARITH_ABS_TOL, BQ_ARITH_REL_TOL * Math.max(Math.abs(a), Math.abs(b)));
}

/* The pair of unused columns (qty, amount) for which qty x rate =
   amount on the most priced rows: at least 2 rows and at least 60% of
   the rows where all three are numbers. Null when no pair qualifies. */
function bqFindQtyAmount(rows, rateCol, used, maxCols) {
    var best = null;
    for (var q = 0; q < maxCols; q++) {
        if (used[q] || q === rateCol) continue;
        for (var a = 0; a < maxCols; a++) {
            if (a === q || used[a] || a === rateCol) continue;
            var n = 0, m = 0;
            rows.forEach(function (row) {
                var rate = bqNumericLoose(row[rateCol]);
                var qty = bqNumericLoose(row[q]);
                var amount = bqNumericLoose(row[a]);
                if (rate === null || qty === null || amount === null || amount <= 0) return;
                n++;
                if (bqAmountsAgree(qty * rate, amount)) m++;
            });
            if (m >= 2 && m / n >= 0.6 && (!best || m > best.matches)) {
                best = { qty: q, amount: a, matches: m, rows: n };
            }
        }
    }
    return best;
}

/* A page that opens with the running total of the page before. The
   figure counts towards the section's subtotal; the "carried forward"
   row that closed that page is checked like any other total. */
var BQ_BROUGHT_RE = /\b(brought forward|b\/f)\b/i;

/* Checks the priced BQ's own arithmetic under a column mapping, before
   it becomes the benchmark every claimed rate is compared against:

   - each priced row: Qty x Rate = Amount;
   - each subtotal row: the Amounts of the priced rows since the
     previous subtotal (plus any amount brought forward) add up to it.

   A total with no priced rows above it (a summary page or grand total)
   is not checked: its lines are not item rows, and guessing what it
   sums would raise false alarms. Nothing is corrected — a row that does
   not add up is reported, and its rate is imported as written; the
   surveyor decides which figure is wrong.

   Returns { available, rowsChecked, rowIssues, totalsChecked, totalIssues }.
   `available` is false when the Rate or Amount column is not mapped. */
function checkArithmetic(rows, mapping) {
    mapping = mapping || {};
    var result = { available: false, rowsChecked: 0, rowIssues: [], totalsChecked: 0, totalIssues: [] };
    if (mapping.rate === null || mapping.rate === undefined ||
        mapping.amount === null || mapping.amount === undefined) return result;
    result.available = true;

    function cell(row, key) {
        var idx = mapping[key];
        if (idx === null || idx === undefined) return undefined;
        return row[idx];
    }
    function text(row, key) {
        var v = cell(row, key);
        return v === undefined || v === null ? "" : String(v).trim();
    }
    function num(row, key) {
        var v = cell(row, key);
        return v === undefined ? null : bqNumericLoose(v);
    }

    var sectionSum = 0;
    var sectionItems = 0;

    (rows || []).forEach(function (row) {
        if (bqIsBlankRow(row) || bqLooksLikeHeaderRow(row)) return;
        var desc = text(row, "description");
        var rate = num(row, "rate");
        var amount = num(row, "amount");

        if (desc !== "" && rate !== null) {
            var qty = num(row, "qty");
            if (qty !== null && amount !== null) {
                result.rowsChecked++;
                var expected = qty * rate;
                if (!bqAmountsAgree(expected, amount)) {
                    result.rowIssues.push({
                        code: text(row, "code"), description: desc,
                        qty: qty, rate: rate, amount: amount, expected: expected
                    });
                }
            }
            if (amount !== null) sectionSum += amount;
            sectionItems++;
            return;
        }

        if (amount === null) return;

        if (BQ_BROUGHT_RE.test(desc)) {
            sectionSum = amount;
            sectionItems = 0;
            return;
        }

        if (BQ_TOTAL_RE.test(desc)) {
            if (sectionItems > 0) {
                result.totalsChecked++;
                if (!bqAmountsAgree(sectionSum, amount)) {
                    result.totalIssues.push({ description: desc, stated: amount, computed: sectionSum });
                }
            }
            sectionSum = 0;
            sectionItems = 0;
        }
    });

    return result;
}

/* Classifies and extracts items from `rows` using an explicit
   {code, description, unit, rate} column mapping — the one the user
   confirmed, which may or may not be what detectColumns proposed.
   Returns { items, skipped }; `skipped` records every ignored row and
   why, so nothing disappears silently. */
function extractItems(rows, mapping) {
    mapping = mapping || {};
    var items = [];
    var skipped = [];

    function cellAt(row, key) {
        var idx = mapping[key];
        if (idx === null || idx === undefined) return undefined;
        return row[idx];
    }

    (rows || []).forEach(function (row, index) {
        if (bqIsBlankRow(row)) { skipped.push({ index: index, reason: t("bqimport.skip.blankRow") }); return; }
        if (bqLooksLikeHeaderRow(row)) { skipped.push({ index: index, reason: t("bqimport.skip.headerRow") }); return; }

        var descRaw = cellAt(row, "description");
        var desc = descRaw !== undefined && descRaw !== null ? String(descRaw).trim() : "";
        var rateRaw = cellAt(row, "rate");
        var rate = rateRaw !== undefined ? bqNumericLoose(rateRaw) : null;
        var unitRaw = cellAt(row, "unit");
        var unit = unitRaw !== undefined && unitRaw !== null ? String(unitRaw).trim() : "";
        var codeRaw = cellAt(row, "code");
        var code = codeRaw !== undefined && codeRaw !== null ? String(codeRaw).trim() : "";

        if (desc === "") {
            skipped.push({ index: index, reason: t("bqimport.skip.noDescription") });
            return;
        }

        if (rate !== null) {
            items.push({ code: code, description: desc, unit: unit, rate: rate });
            return;
        }

        if (BQ_TOTAL_RE.test(desc)) {
            skipped.push({ index: index, reason: t("bqimport.skip.subtotal") });
        } else if (unit === "") {
            skipped.push({ index: index, reason: t("bqimport.skip.sectionHeading") });
        } else {
            skipped.push({ index: index, reason: t("bqimport.skip.noRate") });
        }
    });

    return { items: items, skipped: skipped };
}

/* ---------- dual export: CommonJS in Node, globals in the browser ---------- */

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        parseCsv: parseCsv,
        parseXlsx: parseXlsx,
        detectColumns: detectColumns,
        extractItems: extractItems,
        checkArithmetic: checkArithmetic,
        parseSheetXml: parseSheetXml,
        parseSharedStrings: parseSharedStrings,
        bqReadZipEntries: bqReadZipEntries,
        bqFindEntry: bqFindEntry,
        bqExtractEntryBytes: bqExtractEntryBytes
    };
}
