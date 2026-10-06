/* VO-AI | kbsplit.js — a contract's text → clauses → chunks for the
   knowledge base behind 「问合同」 (docs/rag-plan.md, step 2).

   Shared by the browser (js/contractimport.js, the 「导入合同到知识库」
   button) and the command-line import (tools/ingest-contract.js), so both
   split a contract the same way.

   A scanned contract's clause numbers are often misread ("113" for 11.3,
   "{1.7" for 11.7), which js/contractread.js's splitClauses cannot know.
   When the contract has a contents page, its list of clauses is the ground
   truth: each listed clause is found in the body in order, with the usual
   OCR confusions allowed, and runs to the next one found. Without a
   contents page, splitClauses is used unchanged. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { splitClauses } = require("./contractread.js");
}

const MAX_CHUNK = 1500;

/* ---------------- contents page ---------------- */

/* OCR's usual misreadings of the characters in a clause number. */
const OCR_DIGIT = {
    "0": "[0Oo]", "1": "[1lIi|\\[\\]{}()Ht!LJ]", "2": "[2Z]", "3": "[3]", "4": "[4A]",
    "5": "[5S§$]", "6": "[6b]", "7": "[7]", "8": "[8B]", "9": "[9g]"
};
const ARTICLE_DIGIT = { "|": "1", "l": "1", "I": "1", "§": "5", "S": "5", "O": "0" };

function cleanTitle(title) {
    return String(title || "")
        .replace(/\s+[\dIl|]{1,3}(\s*-\s*[\dIl|]{1,3})?\s*[\])}]?\s*$/, "")   // trailing page numbers
        .replace(/[\s,.;:|]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
}

/* The clauses a contents page lists, in its order: [{no, title}], with
   "Article 7 Definitions 4-7" lines (articles of agreement) too.
   The contents page is OCR'd as well, so a number may be misread there
   ("LE Definition of Variation 13" for 11.1, "101" for 10.1). A line
   whose number cannot be read takes its number from its neighbours
   (between 11.0 and 11.3, two unreadable lines are 11.1 and 11.2), and a
   number missing from a run (11.0, 11.3 with nothing between) is still
   looked for in the body, titled from its margin heading. */
function contentsEntries(text) {
    const lines = String(text || "").split("\n");
    const pageNo = "[\\dIl|]{1,3}(?:\\s*-\\s*[\\dIl|]{1,3})?\\s*[\\])}]?";
    const tocLine = new RegExp("^\\s*([\\dIlLEHt|{}\\[\\]().,§]{1,6})\\s+([A-Za-z\u2018\u2019'\"(][^\\n]{2,90}?)[\\s.]+" + pageNo + "\\s*$");
    const articleLine = new RegExp("^\\s*Article\\s+([\\dIl|§SO]{1,2})\\s+([A-Za-z][^\\n]{2,80}?)[\\s,.]+" + pageNo + "\\s*$");

    /* candidates; a contents page is a run of such lines, so a lone one
       (a page footer, a sentence ending in a number) is dropped */
    const cand = [];
    lines.forEach((line, i) => {
        if (line.length > 110) return;
        let m = articleLine.exec(line);
        if (m) {
            const n = m[1].split("").map(c => ARTICLE_DIGIT[c] || c).join("");
            if (/^\d+$/.test(n)) cand.push({ i: i, no: "Article " + n, title: cleanTitle(m[2]) });
            return;
        }
        m = tocLine.exec(line);
        if (m && /[\dLE]/.test(m[1]) && !/^PAM\b/.test(line.trim())) {
            const ok = /^\d{1,2}\.\d{1,2}$/.test(m[1]);
            cand.push({ i: i, no: ok ? m[1] : null, title: cleanTitle(m[2]) });
        }
    });
    const run = cand.filter((c, k) =>
        (k > 0 && c.i - cand[k - 1].i <= 3) || (k + 1 < cand.length && cand[k + 1].i - c.i <= 3));

    /* number the unreadable lines from their neighbours */
    const parse = no => { const m = /^(\d+)\.(\d+)$/.exec(no || ""); return m ? [+m[1], +m[2]] : null; };
    for (let k = 0; k < run.length; k++) {
        if (run[k].no) continue;
        let j = k;
        while (j < run.length && !run[j].no) j++;
        const before = k > 0 ? parse(run[k - 1].no) : null;
        const after = j < run.length ? parse(run[j].no) : null;
        const count = j - k;
        if (before && after && before[0] === after[0] && after[1] - before[1] - 1 === count) {
            for (let n = 0; n < count; n++) run[k + n].no = before[0] + "." + (before[1] + 1 + n);
        } else if (before && after && after[0] === before[0] + 1 && after[1] === count) {
            /* e.g. 9.4, ?, 10.1: the ? opens the next group */
            for (let n = 0; n < count; n++) run[k + n].no = after[0] + "." + n;
        }
        k = j;
    }

    const entries = [];
    const seen = new Set();
    function add(no, title) {
        if (!no || seen.has(no)) return;
        seen.add(no);
        entries.push({ no: no, title: title });
    }
    run.forEach((c, k) => {
        const cur = parse(c.no);
        const prev = k > 0 ? parse(run[k - 1].no) : null;
        /* fill a gap inside one group (11.0 → 11.3) */
        if (cur && prev && cur[0] === prev[0] && cur[1] - prev[1] > 1 && cur[1] - prev[1] <= 4) {
            for (let n = prev[1] + 1; n < cur[1]; n++) add(cur[0] + "." + n, "");
        }
        add(c.no, c.title);
    });
    return entries;
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* A pattern for where a clause's text starts in the body: its number at
   the start of a line, or after a short margin heading on the same line,
   followed by the clause's opening words, never by "(a)" (a sub-clause)
   or by a page number. */
function headPattern(no) {
    if (/^Article /.test(no)) {
        const n = no.slice(8);
        return new RegExp("(^|\\n)[ \\t]*Article[ \\t]+" + n.split("").map(d => OCR_DIGIT[d] || escapeRe(d)).join("") +
            "[ \\t]*(\\n|[ \\t]+[A-Z])", "g");
    }
    const [a, b] = no.split(".");
    const digits = s => s.split("").map(d => OCR_DIGIT[d] || escapeRe(d)).join("");
    const num = digits(a) + "[.,·]?" + digits(b);
    const margin = "(?:([A-Z][A-Za-z\u2018\u2019'&,.\\-]*(?:[ \\t]+[A-Za-z\u2018\u2019'&,.\\-]+){0,5})[ \\t]+)?";
    return new RegExp("(^|\\n)[ \\t]*" + margin + num + "(?![\\d(])[ \\t]+(?=[A-Z\u201c\"(\u2018'])", "g");
}

/* The body of the contract: after the last contents-page line. */
function bodyStart(text, entries) {
    const lines = text.split("\n");
    let lastToc = -1, offset = 0, end = 0;
    const tocish = /[\s.]+[\dIl|]{1,3}(?:\s*-\s*[\dIl|]{1,3})?\s*[\])}]?\s*$/;
    const nos = new Set(entries.filter(e => !/^Article/.test(e.no)).map(e => e.no));
    lines.forEach((line, i) => {
        const m = /^\s*(\d{1,2}\.\d{1,2})\s/.exec(line);
        if (m && nos.has(m[1]) && tocish.test(line) && line.length < 110) { lastToc = i; end = offset + line.length; }
        offset += line.length + 1;
    });
    return lastToc === -1 ? 0 : end;
}

/* Clauses found in order through the contents page; null when the text
   has no usable contents page. */
function clausesFromContents(text) {
    const entries = contentsEntries(text);
    if (entries.filter(e => !/^Article/.test(e.no)).length < 10) return null;
    const start = bodyStart(text, entries);
    const found = [];
    let pos = start;
    entries.forEach(e => {
        /* articles come before the conditions; search them from the body start */
        const from = /^Article/.test(e.no) && found.length === 0 ? start : pos;
        const re = headPattern(e.no);
        re.lastIndex = from;
        const m = re.exec(text);
        if (!m) return;
        const at = m.index + m[1].length;
        /* never jump far ahead past many unfound clauses: a match that far
           away is more likely a cross-reference than the clause */
        if (found.length && at - pos > 40000) return;
        found.push({ no: e.no, title: e.title || cleanTitle(m[2] || ""), at: at, textAt: m.index + m[0].length });
        pos = m.index + m[0].length;
    });
    const clauses = found.map((c, i) => {
        const end = i + 1 < found.length ? found[i + 1].at : text.length;
        return { no: c.no, title: c.title, text: tidy(text.slice(c.textAt, end)) };
    }).filter(c => c.text.length > 0);
    return { clauses: clauses, listed: entries.length };
}

function tidy(s) {
    return s
        .replace(/\n?PAM Contract 2018 \(With Quantities\)\s*\d*\s*\n?/g, " ")   // running footer
        .replace(/\s+/g, " ")
        .trim();
}

/* One chunk per clause; a long clause split at sentence ends, every piece
   keeping its clause number. */
function chunkClauses(clauses, maxLen) {
    const max = maxLen || MAX_CHUNK;
    const chunks = [];
    clauses.forEach(c => {
        const text = c.text || "";
        if (text.length <= max) { chunks.push({ no: c.no, title: c.title, part: 1, text: text }); return; }
        const sentences = text.match(/[^.;]+(?:[.;]+(?=\s|$)|$)/g) || [text];
        let cur = "", part = 1;
        sentences.forEach(s => {
            if (cur && (cur + s).length > max) {
                chunks.push({ no: c.no, title: c.title, part: part++, text: cur.trim() });
                cur = "";
            }
            cur += s;
            while (cur.length > max * 1.5) {             // a "sentence" with no full stop
                chunks.push({ no: c.no, title: c.title, part: part++, text: cur.slice(0, max).trim() });
                cur = cur.slice(max);
            }
        });
        if (cur.trim()) chunks.push({ no: c.no, title: c.title, part: part, text: cur.trim() });
    });
    return chunks;
}

function contractClauses(text) {
    const viaContents = clausesFromContents(text);
    if (viaContents && viaContents.clauses.length >= viaContents.listed * 0.6) {
        return { method: "contents", clauses: viaContents.clauses, listed: viaContents.listed };
    }
    return { method: "splitClauses", clauses: splitClauses(text), listed: viaContents ? viaContents.listed : 0 };
}

function embedText(form, c) {
    const label = /^Article/.test(c.no) ? c.no : "Clause " + c.no;
    return (form ? form + " " : "") + label + (c.title ? " " + c.title : "") + ": " + c.text;
}

/* The standard form a contract text is, for its citations
   (「引用：PAM 2018 第 11.6 条」); null when it names none. */
function detectForm(text) {
    const head = String(text || "").slice(0, 20000);
    let m = /\bPAM\b[^\n]{0,40}?\b(1998|2006|2018)\b/i.exec(head);
    if (m) return "PAM " + m[1];
    m = /\bP\.?W\.?D\.?\s*(?:Form\s*)?(203A?|DB)\b/i.exec(head);
    if (m) return "PWD " + m[1].toUpperCase();
    m = /\bCIDB\b[^\n]{0,40}?\b(2000|2022)\b/i.exec(head);
    if (m) return "CIDB " + m[1];
    return null;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        MAX_CHUNK, contentsEntries, headPattern, clausesFromContents, chunkClauses,
        contractClauses, embedText, cleanTitle, detectForm
    };
}
