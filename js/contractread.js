/* VO-AI | contractread.js
   Reads the project's own contract — the document uploaded as the
   contract or as a VO's contract basis — so a variation is analysed
   against the clauses that actually bind this project, not only the
   bundled standard-form library (js/clauses.js).

   1. Text out of the file, by hand, no libraries: plain text; Word
      .docx (a ZIP of XML, read with js/bqimport.js's ZIP reader); and
      PDF (its compressed page content decoded through each font's
      ToUnicode map). A scanned PDF has no text to read, and is reported
      as such rather than guessed at.
   2. The text split into numbered clauses ("11.6 Valuation of
      Variations ...").
   3. For a variation: which of those clauses deal with what a variation
      is, how it is valued, extension of time and notices, chosen by
      keyword and quoted word for word — and every period of days the
      contract states. Retrieval for a professional to read, not a legal
      opinion; the page says so. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { bqReadZipEntries, bqFindEntry, bqExtractEntryBytes } = require("./bqimport.js");
    var { t } = require("./i18n.js");
    var { escapeHtml, fold } = require("./ui.js");
}

/* ---------------- 1. text out of the file ---------------- */

async function inflateZlib(bytes) {
    const ds = new DecompressionStream("deflate");
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(await out);
}

function latin1(bytes, from, to) {
    let s = "";
    const end = to === undefined ? bytes.length : to;
    for (let i = from || 0; i < end; i += 8192) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + 8192)));
    }
    return s;
}

/* Every "n 0 obj ... endobj" in the file: its dictionary text and, when
   it has one, its stream (still compressed). Objects inside compressed
   object streams are not read — content streams and fonts are never
   stored there. */
function pdfObjects(bytes) {
    const raw = latin1(bytes);
    const objects = {};
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(raw))) {
        const start = re.lastIndex;
        const end = raw.indexOf("endobj", start);
        if (end === -1) break;
        const body = raw.slice(start, end);
        const sIdx = body.indexOf("stream");
        const obj = { dict: sIdx === -1 ? body : body.slice(0, sIdx), stream: null };
        if (sIdx !== -1) {
            let dataStart = start + sIdx + 6;
            if (raw[dataStart] === "\r") dataStart++;
            if (raw[dataStart] === "\n") dataStart++;
            const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(obj.dict);
            const dataEnd = len ? dataStart + Number(len[1]) : raw.lastIndexOf("endstream", end);
            obj.stream = bytes.subarray(dataStart, dataEnd);
        }
        objects[m[1]] = obj;
        re.lastIndex = end + 6;
    }
    return objects;
}

async function streamBytes(obj) {
    if (!obj || !obj.stream) return null;
    if (/\/FlateDecode/.test(obj.dict)) {
        try { return await inflateZlib(obj.stream); } catch (e) { return null; }
    }
    if (/\/Filter/.test(obj.dict)) return null;   /* images and the like */
    return obj.stream;
}

function hexToBytes(hex) {
    const h = hex.replace(/[^0-9a-f]/gi, "");
    const out = [];
    for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2).padEnd(2, "0"), 16));
    return out;
}

function utf16beHex(hex) {
    const b = hexToBytes(hex);
    let s = "";
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return s;
}

/* A ToUnicode CMap: code (as a hex string of its bytes) -> text. */
function parseToUnicode(text) {
    const map = { width: 1, codes: {} };
    const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text);
    if (cs) map.width = Math.max(1, cs[1].length / 2);
    text.replace(/beginbfchar([\s\S]*?)endbfchar/g, (_, block) => {
        block.replace(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g, (__, src, dst) => {
            map.codes[src.toLowerCase()] = utf16beHex(dst);
        });
    });
    text.replace(/beginbfrange([\s\S]*?)endbfrange/g, (_, block) => {
        block.replace(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g, (__, lo, hi, dst) => {
            const a = parseInt(lo, 16), z = parseInt(hi, 16), w = lo.length;
            if (z - a > 5000) return;
            if (dst[0] === "[") {
                const items = dst.match(/<([0-9a-fA-F]*)>/g) || [];
                for (let c = a; c <= z && c - a < items.length; c++) {
                    map.codes[c.toString(16).padStart(w, "0")] = utf16beHex(items[c - a].slice(1, -1));
                }
            } else {
                const base = dst.slice(1, -1);
                const head = base.slice(0, -4), tail = parseInt(base.slice(-4), 16);
                for (let c = a; c <= z; c++) {
                    map.codes[c.toString(16).padStart(w, "0")] =
                        utf16beHex(head + (tail + c - a).toString(16).padStart(4, "0"));
                }
            }
        });
    });
    return map;
}

function decodeWithFont(byteList, font) {
    if (!font) return String.fromCharCode.apply(null, byteList);
    let s = "";
    for (let i = 0; i < byteList.length; i += font.width) {
        let key = "";
        for (let k = 0; k < font.width; k++) key += (byteList[i + k] || 0).toString(16).padStart(2, "0");
        const u = font.codes[key];
        s += u !== undefined ? u : (font.width === 1 ? String.fromCharCode(byteList[i]) : "");
    }
    return s;
}

/* Tokens of a content stream: numbers, names, strings (as byte lists),
   arrays, and operators. */
function contentTokens(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    const stack = [];
    const push = tok => (stack.length ? stack[stack.length - 1].push(tok) : out.push(tok));
    while (i < n) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "%") { while (i < n && src[i] !== "\n" && src[i] !== "\r") i++; continue; }
        if (c === "(") {
            let depth = 1, bytes = [];
            i++;
            while (i < n && depth > 0) {
                let ch = src[i];
                if (ch === "\\") {
                    const nx = src[i + 1];
                    const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
                    if (nx in esc) { bytes.push(esc[nx]); i += 2; continue; }
                    if (/[0-7]/.test(nx)) {
                        const oct = /^[0-7]{1,3}/.exec(src.slice(i + 1, i + 4))[0];
                        bytes.push(parseInt(oct, 8) & 255); i += 1 + oct.length; continue;
                    }
                    i += 2; continue;
                }
                if (ch === "(") depth++;
                if (ch === ")") { depth--; if (depth === 0) { i++; break; } }
                bytes.push(ch.charCodeAt(0) & 255);
                i++;
            }
            push({ str: bytes });
            continue;
        }
        if (c === "<" && src[i + 1] === "<") { i += 2; push({ op: "<<" }); continue; }
        if (c === ">" && src[i + 1] === ">") { i += 2; push({ op: ">>" }); continue; }
        if (c === "<") {
            const end = src.indexOf(">", i);
            push({ str: hexToBytes(src.slice(i + 1, end)) });
            i = end + 1;
            continue;
        }
        if (c === "[") { stack.push([]); i++; continue; }
        if (c === "]") { const arr = stack.pop() || []; i++; push({ arr: arr }); continue; }
        if (c === "/") {
            let j = i + 1;
            while (j < n && !/[\s\/\[\]<>()%{}]/.test(src[j])) j++;
            push({ name: src.slice(i + 1, j) });
            i = j;
            continue;
        }
        let j = i;
        while (j < n && !/[\s\/\[\]<>()%{}]/.test(src[j])) j++;
        if (j === i) { i++; continue; }
        const word = src.slice(i, j);
        push(/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) ? { num: Number(word) } : { op: word });
        i = j;
    }
    return out;
}

/* Text of one content stream, a line break wherever the text moves to a
   new line and a space where a TJ array leaves a visible gap. */
function contentText(src, fonts) {
    const toks = contentTokens(src);
    let operands = [];
    let font = null;
    let tfSize = 12, tmScale = 1;
    let lineX = 0, lineY = 0;
    let lastY = null, curX = null;
    let text = "";
    const em = () => Math.max(1, tfSize * tmScale);

    /* Glyph widths are not read, so a run's width is estimated (half an
       em a character, a capital nearer three quarters, a full em for CJK). A move down starts a new line;
       a move along the same line leaves a space only when it jumps past
       where the last run ended (the next table column), not for kerning
       or letter-spacing. */
    const moveTo = (x, y) => {
        if (lastY !== null && Math.abs(y - lastY) > em() * 0.5) {
            if (text && !/\n$/.test(text)) text += "\n";
        } else if (curX !== null && x > curX + em() * 0.3 && text && !/\s$/.test(text)) {
            text += " ";
        }
        lastY = y;
        curX = x;
    };
    const show = s => {
        text += s;
        let w = 0;
        for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : /[A-Z]/.test(ch) ? 0.72 : 0.5;
        if (curX !== null) curX += w * em();
    };

    toks.forEach(tok => {
        if (!("op" in tok)) { operands.push(tok); return; }
        const op = tok.op;
        const nums = operands.filter(o => "num" in o).map(o => o.num);
        if (op === "Tf") {
            const name = operands.find(o => "name" in o);
            font = name ? fonts[name.name] || null : null;
            tfSize = Math.abs(nums[nums.length - 1] || tfSize) || 12;
        } else if (op === "Tm" && nums.length >= 6) {
            tmScale = Math.abs(nums[0]) || Math.abs(nums[3]) || 1;
            lineX = nums[4]; lineY = nums[5];
            moveTo(lineX, lineY);
        } else if ((op === "Td" || op === "TD") && nums.length >= 2) {
            lineX += nums[0] * tmScale; lineY += nums[1] * tmScale;
            moveTo(lineX, lineY);
        } else if (op === "T*" || op === "'" || op === '"') {
            if (text && !/\n$/.test(text)) text += "\n";
        } else if (op === "BT") {
            lineX = 0; lineY = 0; tmScale = 1;
        }
        if (op === "Tj" || op === "'" || op === '"') {
            const s = operands.filter(o => "str" in o).pop();
            if (s) show(decodeWithFont(s.str, font));
        } else if (op === "TJ") {
            const arr = operands.find(o => "arr" in o);
            (arr ? arr.arr : []).forEach(part => {
                if ("str" in part) show(decodeWithFont(part.str, font));
                else if ("num" in part) {
                    if (part.num < -250 && !/\s$/.test(text)) text += " ";
                    if (curX !== null) curX -= part.num / 1000 * em();
                }
            });
        }
        operands = [];
    });
    return text;
}

function refOf(dictText, key) {
    const m = new RegExp("/" + key + "\\s+(\\d+)\\s+\\d+\\s+R").exec(dictText);
    return m ? m[1] : null;
}

/* The <<...>> that follows /Key, inline or behind a reference. */
function subDict(objects, dictText, key) {
    const ref = refOf(dictText, key);
    if (ref && objects[ref]) return objects[ref].dict;
    const i = dictText.indexOf("/" + key);
    if (i === -1) return "";
    const open = dictText.indexOf("<<", i);
    if (open === -1) return "";
    let depth = 0;
    for (let k = open; k < dictText.length - 1; k++) {
        if (dictText[k] === "<" && dictText[k + 1] === "<") { depth++; k++; }
        else if (dictText[k] === ">" && dictText[k + 1] === ">") { depth--; k++; if (depth === 0) return dictText.slice(open, k + 1); }
    }
    return "";
}

async function pdfToText(bytes) {
    const objects = pdfObjects(bytes);
    const fontMaps = {};
    async function fontMap(objNo) {
        if (objNo in fontMaps) return fontMaps[objNo];
        fontMaps[objNo] = null;
        const f = objects[objNo];
        const tu = f && refOf(f.dict, "ToUnicode");
        if (tu) {
            const data = await streamBytes(objects[tu]);
            if (data) fontMaps[objNo] = parseToUnicode(latin1(data));
        }
        return fontMaps[objNo];
    }

    /* pages in document order: walk the page tree from the root */
    const pages = [];
    const catalog = Object.keys(objects).find(k => /\/Type\s*\/Catalog/.test(objects[k].dict));
    const visit = (no, inherited) => {
        const o = objects[no];
        if (!o || pages.length > 2000) return;
        if (/\/Type\s*\/Pages/.test(o.dict)) {
            const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
            const res = subDict(objects, o.dict, "Resources") || inherited;
            (kids ? kids[1].match(/(\d+)\s+\d+\s+R/g) || [] : []).forEach(r => visit(r.split(/\s+/)[0], res));
        } else if (/\/Type\s*\/Page\b/.test(o.dict)) {
            pages.push({ no: no, resources: subDict(objects, o.dict, "Resources") || inherited });
        }
    };
    if (catalog) visit(refOf(objects[catalog].dict, "Pages"), "");
    if (pages.length === 0) {
        Object.keys(objects).filter(k => /\/Type\s*\/Page\b/.test(objects[k].dict))
            .forEach(k => pages.push({ no: k, resources: subDict(objects, objects[k].dict, "Resources") }));
    }

    const texts = [];
    for (const page of pages) {
        const fonts = {};
        const fontDict = subDict(objects, page.resources, "Font");
        const re = /\/([^\s\/<>\[\]]+)\s+(\d+)\s+\d+\s+R/g;
        let m;
        while ((m = re.exec(fontDict))) fonts[m[1]] = await fontMap(m[2]);

        const dict = objects[page.no].dict;
        const contents = /\/Contents\s*\[([^\]]*)\]/.exec(dict);
        const refs = contents ? (contents[1].match(/(\d+)\s+\d+\s+R/g) || []).map(r => r.split(/\s+/)[0])
                              : [refOf(dict, "Contents")].filter(Boolean);
        let src = "";
        for (const r of refs) {
            const data = await streamBytes(objects[r]);
            if (data) src += latin1(data) + "\n";
        }
        texts.push(contentText(src, fonts));
    }
    return texts.join("\n\n");
}

async function docxToText(bytes) {
    const entries = bqReadZipEntries(bytes);
    const doc = bqFindEntry(entries, /^word\/document\.xml$/i);
    if (!doc) throw new Error("no word/document.xml");
    const xml = new TextDecoder("utf-8").decode(await bqExtractEntryBytes(bytes, doc));
    return xml
        .replace(/<w:tab\/>/g, " ")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

/* The text of an uploaded contract. Resolves {text} or {error: i18n key}. */
async function contractFileText(name, arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const lower = String(name || "").toLowerCase();
    let text = "";
    try {
        if (/\.pdf$/.test(lower) || latin1(bytes, 0, 5) === "%PDF-") text = await pdfToText(bytes);
        else if (/\.docx$/.test(lower)) text = await docxToText(bytes);
        else if (/\.(txt|md|text)$/.test(lower)) text = new TextDecoder("utf-8").decode(bytes);
        else return { error: "contract.read.unsupported" };
    } catch (e) {
        return { error: "contract.read.failed" };
    }
    text = text.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (text.replace(/\s/g, "").length < 80) return { error: "contract.read.noText" };
    return { text: text };
}

/* ---------------- 2. clauses ---------------- */

/* A clause starts on a line beginning with its number: "11.6 Valuation
   of Variations", "Clause 23.8", "24. Variations". The heading is the
   rest of that line (if short), the text runs to the next clause. */
function splitClauses(text) {
    const lines = String(text || "").split("\n");
    const clauses = [];
    let cur = null;
    const head = /^\s*(?:clause|cl\.|article|art\.|fasal)?\s*(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+(\S.*)$/i;
    lines.forEach(line => {
        const m = head.exec(line);
        const looksLikeHeading = m && !/^\d/.test(m[2]) && !/^(days?|months?|weeks?|%|per\b|mm\b|m2?\b|no\b)/i.test(m[2]);
        if (looksLikeHeading) {
            if (cur) clauses.push(cur);
            const rest = m[2].trim();
            const short = rest.length <= 70 && !/[.;:]$/.test(rest);
            cur = { no: m[1], title: short ? rest : "", text: short ? "" : rest };
        } else if (cur) {
            cur.text += (cur.text ? " " : "") + line.trim();
        }
    });
    if (cur) clauses.push(cur);
    return clauses
        .map(c => ({ no: c.no, title: c.title, text: c.text.replace(/\s+/g, " ").trim() }))
        .filter(c => c.title || c.text.length > 20);
}

/* ---------------- 3. what the contract says about a variation ---------------- */

/* Each topic: the words its heading would use (weighted heavily — a
   clause headed "Notice of Delay" is about notice) and the words its
   text would use. A clause must contain at least one `must` word. */
var CONTRACT_TOPICS = [
    { id: "meaning",
      title: ["meaning", "definition", "defined"],
      words: ["variation", "alteration", "modification", "substitution", "omission", "addition", "means"],
      must: ["variation"] },
    { id: "valuation",
      title: ["valuation", "valuing", "measurement and valuation", "rates"],
      words: ["valu", "rate", "bills", "similar character", "fair", "star", "schedule of rates", "quotation", "daywork"],
      must: ["valu"] },
    { id: "time",
      title: ["extension of time", "delay", "completion"],
      words: ["extension of time", "delay", "completion", "critical", "programme"],
      must: ["extension of time", "delay"] },
    { id: "notice",
      title: ["notice", "notification", "claims procedure"],
      words: ["notice", "within", "days", "submit", "claim", "particulars", "time-bar", "time bar"],
      must: ["notice"] }
];

function clauseScore(clause, topic) {
    const title = clause.title.toLowerCase();
    const hay = (clause.title + " " + clause.text).toLowerCase();
    if (!topic.must.some(w => hay.indexOf(w) !== -1)) return 0;
    const titleHit = topic.title.some(w => title.indexOf(w) !== -1) ? 10 : 0;
    return titleHit + topic.words.reduce((s, w) => s + Math.min(hay.split(w).length - 1, 4), 0);
}

/* Every "within 28 days" (and "not later than 14 days" etc.) the
   contract states, with the clause it is in. */
function contractPeriods(clauses) {
    const out = [];
    const re = /\b(within|not later than|no later than|not less than|before the expiry of|after)\s+(\d{1,3}|seven|fourteen|twenty[- ]one|twenty[- ]eight|thirty|sixty|ninety)\s*(?:\(\d+\)\s*)?(calendar |working )?days?\b/gi;
    const words = { seven: 7, fourteen: 14, "twenty-one": 21, "twenty one": 21, "twenty-eight": 28, "twenty eight": 28, thirty: 30, sixty: 60, ninety: 90 };
    (clauses || []).forEach(c => {
        const text = c.text || "";
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(text))) {
            const raw = m[2].toLowerCase();
            const days = /^\d+$/.test(raw) ? Number(raw) : words[raw];
            /* a sentence ends at ". " — not at the point in "11.4" */
            const before = text.lastIndexOf(". ", m.index);
            const from = before === -1 ? 0 : before + 2;
            const after = text.indexOf(". ", m.index + m[0].length);
            const sentence = text.slice(from, after === -1 ? text.length : after + 1).trim();
            const shown = sentence.length > 260 ? sentence.slice(0, 257) + "…" : sentence;
            /* one entry per sentence, however many periods it states */
            const same = out.find(o => o.clause === c.no && o.sentence === shown);
            if (same) { if (same.days !== days) same.days = same.days + " / " + days; continue; }
            out.push({ clause: c.no, days: days, sentence: shown });
        }
    });
    return out;
}

/* What the uploaded contract says on each topic: the best clause (with
   its words) or nothing. A clause is quoted, never paraphrased. */
function contractProvisions(reading) {
    const clauses = (reading && reading.clauses) || [];
    const topics = CONTRACT_TOPICS.map(topic => {
        let best = null, bestScore = 0;
        clauses.forEach(c => {
            if (!c.text) return;
            const s = clauseScore(c, topic);
            if (s > bestScore) { best = c; bestScore = s; }
        });
        return { id: topic.id, clause: best };
    });
    return { topics: topics, periods: contractPeriods(clauses) };
}

/* A clause's words for display, cut at a sentence end near `max`. */
function clauseExcerpt(clause, max) {
    const text = (clause && clause.text) || "";
    const limit = max || 320;
    if (text.length <= limit) return text;
    const cut = text.lastIndexOf(". ", limit);
    return (cut > limit * 0.5 ? text.slice(0, cut + 1) : text.slice(0, limit)) + " …";
}

/* The reading kept on the project: small enough for localStorage. */
function makeReading(doc, text, todayIso) {
    const clauses = splitClauses(text);
    return {
        docId: doc.id, docName: doc.name, readAt: todayIso,
        chars: text.length,
        clauses: clauses.map(c => ({ no: c.no, title: c.title, text: c.text.slice(0, 4000) }))
    };
}

/* ---------------- 4. for one variation ---------------- */

/* The documents that make up this VO's contract: its own contract basis
   first, then the project's contract documents. */
function contractSourceDocs(project, vo) {
    const seen = {};
    const out = [];
    const add = d => { if (d && d.id && !seen[d.id]) { seen[d.id] = true; out.push(d); } };
    /* a document's id, name and `stored` are always its current version's */
    ((vo && vo.contractDocs) || []).forEach(add);
    ((project && project.documents) || []).filter(d => d.category === "contract").forEach(add);
    return out;
}

/* What this VO is analysed against.
   state "none":    no contract document uploaded at all;
   state "unread":  documents exist but none has been read yet;
   state "noText":  read, but no numbered clauses found in any of them;
   state "read":    clauses found — topics (each with the clause and
                    the document it came from) and stated periods. */
function contractAnalysis(vo, project) {
    const docs = contractSourceDocs(project, vo);
    if (docs.length === 0) return { state: "none", docs: [] };
    const readings = (project && project.contractReadings) || {};
    const done = docs.map(d => readings[d.id]).filter(Boolean);
    const unread = docs.filter(d => !readings[d.id]);
    if (done.length === 0) return { state: "unread", docs: docs, unread: unread };

    const clauses = [];
    done.forEach(r => (r.clauses || []).forEach(c => clauses.push(Object.assign({ docName: r.docName }, c))));
    if (clauses.length === 0) {
        return { state: "noText", docs: docs, unread: unread, errors: done.filter(r => r.error) };
    }
    const prov = contractProvisions({ clauses: clauses });
    return {
        state: "read", docs: docs, unread: unread,
        docNames: done.filter(r => (r.clauses || []).length).map(r => r.docName),
        topics: prov.topics, periods: prov.periods
    };
}

/* `opts.fold`: on screen, the quotes and periods open under a one-line
   summary; the printed report passes nothing and shows them in full. */
function renderContractBlock(c, opts) {
    if (!c || c.state === "none") {
        return '<p class="rate-detail contract-missing">' + escapeHtml(t("contract.none")) + "</p>";
    }
    if (c.state === "unread") {
        return '<p class="rate-detail contract-reading">' + escapeHtml(t("contract.reading", { n: c.docs.length })) + "</p>";
    }
    if (c.state === "noText") {
        return '<p class="rate-detail contract-missing">' + escapeHtml(t("contract.noClauses")) + "</p>";
    }
    const seen = {};
    const topics = c.topics.filter(tp => tp.clause).map(tp => {
        const key = tp.clause.docName + "|" + tp.clause.no;
        const labels = c.topics.filter(o => o.clause && o.clause.docName + "|" + o.clause.no === key)
            .map(o => t("contract.topic." + o.id));
        if (seen[key]) return "";
        seen[key] = true;
        return '<div class="contract-clause">' +
            '<div class="contract-clause-head"><span class="contract-topic">' + escapeHtml(labels.join(" · ")) + "</span>" +
            "<strong>" + escapeHtml(t("contract.clauseRef", { no: tp.clause.no })) +
            (tp.clause.title ? " " + escapeHtml(tp.clause.title) : "") + "</strong></div>" +
            "<blockquote>" + escapeHtml(clauseExcerpt(tp.clause, 360)) + "</blockquote></div>";
    }).join("");
    const periods = c.periods.length
        ? '<div class="contract-periods"><strong>' + escapeHtml(t("contract.periods")) + "</strong><ul>" +
            c.periods.map(p => "<li><b>" + escapeHtml(t("contract.days", { n: p.days })) + "</b> · " +
                escapeHtml(t("contract.clauseRef", { no: p.clause })) + " — " + escapeHtml(p.sentence) + "</li>").join("") +
          "</ul></div>"
        : "";
    const body = (topics || '<p class="rate-detail">' + escapeHtml(t("contract.noTopics")) + "</p>") +
        periods +
        '<p class="rate-detail clause-note">' + escapeHtml(t("contract.note")) + "</p>";
    if (opts && opts.fold && typeof fold === "function") {
        const refs = [];
        c.topics.forEach(tp => {
            if (tp.clause && refs.indexOf(tp.clause.no) === -1) refs.push(tp.clause.no);
        });
        const summary = t("contract.summary", {
            doc: c.docNames.join("、"),
            clauses: refs.length ? t("contract.clauseRef", { no: refs.join(t("common.listSep")) }) : t("contract.noTopics"),
            n: c.periods.length
        });
        return '<div class="contract-block">' + fold("contract", escapeHtml(summary), body, "contract-fold") + "</div>";
    }
    return '<div class="contract-block">' +
        '<div class="contract-source">' + escapeHtml(t("contract.basedOn", { docs: c.docNames.join("、") })) + "</div>" +
        body + "</div>";
}

/* ---------------- browser: read what has not been read ---------------- */

/* Reads every contract document of this VO/project not yet read, and
   keeps the result on the project (so it is read once, not on every
   page view). Resolves true when anything new was read. */
async function ensureContractReadings(projectId, vo) {
    const project = getProject(projectId);
    if (!project) return false;
    const readings = project.contractReadings || {};
    const todo = contractSourceDocs(project, vo).filter(d => !readings[d.id]);
    if (todo.length === 0) return false;
    const results = {};
    for (const doc of todo) {
        let buf = null;
        try {
            if (doc.stored && typeof FileStore !== "undefined") {
                const rec = await FileStore.get(doc.id);
                if (rec && rec.blob) buf = await rec.blob.arrayBuffer();
            }
            const url = !buf && typeof demoFileUrl === "function" ? demoFileUrl(doc) : "";
            if (url) {
                const res = await fetch(url);
                if (res.ok) buf = await res.arrayBuffer();
            }
        } catch (e) { buf = null; }
        if (!buf) {
            results[doc.id] = { docId: doc.id, docName: doc.name, readAt: today(), error: "contract.read.notHere", clauses: [] };
            continue;
        }
        const got = await contractFileText(doc.name, buf);
        results[doc.id] = got.error
            ? { docId: doc.id, docName: doc.name, readAt: today(), error: got.error, clauses: [] }
            : makeReading(doc, got.text, today());
    }
    updateProject(projectId, p => {
        p.contractReadings = Object.assign({}, p.contractReadings || {}, results);
    });
    return true;
}

/* Forget the readings of these documents, so they are read again. */
function forgetContractReadings(projectId, docIds) {
    updateProject(projectId, p => {
        p.contractReadings = p.contractReadings || {};
        docIds.forEach(id => { delete p.contractReadings[id]; });
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        contractSourceDocs, contractAnalysis, renderContractBlock,
        contractFileText, pdfToText, docxToText, parseToUnicode, contentText,
        splitClauses, contractPeriods, contractProvisions, clauseExcerpt, makeReading, CONTRACT_TOPICS
    };
}
