/* VO-AI | bqimport.js — read a priced Bills of Quantities from a real
   spreadsheet (.csv or .xlsx) and work out which column is which.
   Zero dependencies: CSV is hand-parsed, and .xlsx is unzipped and its
   XML read with the runtime's own DecompressionStream — no SheetJS, no
   library. Every function here is pure and DOM-free so it is directly
   unit-testable; the browser wiring (file input, preview, confirm) lives
   in page-projects.js. Nothing here ever imports data on its own — the
   caller must always run the result past the user for confirmation. */

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
    "qty": true, "quantity": true, "quantities": true
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
            reasons: ["No data rows were found to analyse."]
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

    function pick(filterFn, sortFn, role, describe) {
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
            none: "No column matched known unit tokens (m, m2, no, item...) confidently — Unit left unassigned.",
            found: function (s) {
                return "column " + (s.col + 1) + ": " + Math.round(s.unitRatio * 100) +
                    "% match known unit tokens — read as Unit.";
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
            none: "No column looked like a numeric rate column — Rate left unassigned.",
            found: function (s) {
                return "column " + (s.col + 1) + ": " + Math.round(s.numericRatio * 100) +
                    "% numeric, values average RM " + s.avgNumericValue.toFixed(2) + " — read as Rate.";
            }
        }
    );

    var codeCol = pick(
        function (s) { return s.count > 0 && s.codeRatio >= 0.6; },
        function (a, b) { return b.codeRatio - a.codeRatio; },
        "code",
        {
            none: "No column matched a bill-reference pattern (e.g. B/4.1) — Code left unassigned.",
            found: function (s) {
                return "column " + (s.col + 1) + ": " + Math.round(s.codeRatio * 100) +
                    "% match a bill-reference pattern — read as Code.";
            }
        }
    );

    var descCol = pick(
        function (s) { return s.fillRatio >= 0.3 && s.numericRatio < 0.5; },
        function (a, b) { return b.avgLen - a.avgLen; },
        "description",
        {
            none: "No column looked like a description column — Description left unassigned.",
            found: function (s) {
                return "column " + (s.col + 1) + ": longest average text (" +
                    Math.round(s.avgLen) + " characters) — read as Description.";
            }
        }
    );

    var confidence = (rateCol !== null && descCol !== null) ? "high" : "needs review";

    return { code: codeCol, description: descCol, unit: unitCol, rate: rateCol, confidence: confidence, reasons: reasons };
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
        if (bqIsBlankRow(row)) { skipped.push({ index: index, reason: "blank row" }); return; }
        if (bqLooksLikeHeaderRow(row)) { skipped.push({ index: index, reason: "header row" }); return; }

        var descRaw = cellAt(row, "description");
        var desc = descRaw !== undefined && descRaw !== null ? String(descRaw).trim() : "";
        var rateRaw = cellAt(row, "rate");
        var rate = rateRaw !== undefined ? bqNumericLoose(rateRaw) : null;
        var unitRaw = cellAt(row, "unit");
        var unit = unitRaw !== undefined && unitRaw !== null ? String(unitRaw).trim() : "";
        var codeRaw = cellAt(row, "code");
        var code = codeRaw !== undefined && codeRaw !== null ? String(codeRaw).trim() : "";

        if (desc === "") {
            skipped.push({ index: index, reason: "no description found in this row" });
            return;
        }

        if (rate !== null) {
            items.push({ code: code, description: desc, unit: unit, rate: rate });
            return;
        }

        if (BQ_TOTAL_RE.test(desc)) {
            skipped.push({ index: index, reason: "subtotal or total row" });
        } else if (unit === "") {
            skipped.push({ index: index, reason: "section heading (no rate, no unit)" });
        } else {
            skipped.push({ index: index, reason: "no parseable rate in this row" });
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
        parseSheetXml: parseSheetXml,
        parseSharedStrings: parseSharedStrings
    };
}
