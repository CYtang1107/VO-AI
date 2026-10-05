/* VO-AI | ingest-contract.js — a contract into the knowledge base
   (docs/rag-plan.md, step 2).

   file → text → clauses → embeddings → contract_chunks (Supabase)

     node tools/ingest-contract.js --file PAM-2018-OCR.txt --form "PAM 2018"
         [--project PRJ-…]   only that project's members may search it
                             (default: shared by every signed-in user)
         [--doc-name "…"]    default: the form name
         [--dry-run]         print the clauses; no embedding, no upload
         [--out chunks.json] also write the chunks to a file

   Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DASHSCOPE_API_KEY in the
   environment (never in the repo). Re-running for the same doc name and
   project replaces that document's chunks.

   The contract text is the team's own copy of a copyrighted form: it goes
   only into their Supabase project, never into this repository.

   Text: .txt as is; a text PDF or .docx through js/contractread.js (the same
   reader the app uses); a scanned PDF through pdftoppm + tesseract when
   they are installed.

   Clauses: a scanned contract's clause numbers are often misread ("113"
   for 11.3, "{1.7" for 11.7), which the app's splitClauses cannot know.
   When the contract has a contents page, its list of clauses is the ground
   truth: each listed clause is found in the body in order, with the usual
   OCR confusions allowed, and runs to the next one found. Without a
   contents page, js/contractread.js's splitClauses is used unchanged. */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { splitClauses, contractFileText } = require("../js/contractread.js");

const EMBED_MODEL = "text-embedding-v4";
const EMBED_DIM = 1024;
const EMBED_BATCH = 10;
const MAX_CHUNK = 1500;
const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

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

/* ---------------- I/O ---------------- */

async function readContract(file) {
    const bytes = fs.readFileSync(file);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const read = await contractFileText(path.basename(file), buf);
    if (read.text) return read.text;
    if (read.error === "contract.read.noText" && /\.pdf$/i.test(file)) return ocrPdf(file);
    throw new Error("Could not read " + file + " (" + read.error + ")");
}

/* A scanned PDF: 300 dpi page images, then tesseract (tested on the team's
   PAM 2018 scan: 56 pages in about 2½ minutes). */
function ocrPdf(file) {
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "voai-ocr-"));
    try {
        execFileSync("pdftoppm", ["-r", "300", "-png", file, path.join(tmp, "p")]);
    } catch (e) {
        throw new Error("This PDF is scanned. Install poppler-utils and tesseract-ocr, or pass the OCR text (.txt).");
    }
    const pages = fs.readdirSync(tmp).filter(f => f.endsWith(".png")).sort();
    const text = pages.map((p, i) => {
        process.stderr.write("OCR page " + (i + 1) + "/" + pages.length + "\r");
        return execFileSync("tesseract", [path.join(tmp, p), "-", "--psm", "6"], { encoding: "utf8" });
    }).join("\n");
    fs.rmSync(tmp, { recursive: true, force: true });
    return text;
}

async function embed(texts) {
    const res = await fetch(DASHSCOPE_BASE + "/embeddings", {
        method: "POST",
        headers: { "Authorization": "Bearer " + process.env.DASHSCOPE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIM, encoding_format: "float" })
    });
    const body = await res.json();
    if (!res.ok) throw new Error("DashScope: " + ((body.error && body.error.message) || res.status));
    return body.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function rest(method, pathAndQuery, body) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(process.env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/" + pathAndQuery, {
        method: method,
        headers: {
            apikey: key, Authorization: "Bearer " + key,
            "Content-Type": "application/json", Prefer: "return=minimal"
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error("Supabase " + method + " " + pathAndQuery.split("?")[0] + ": " + res.status + " " + await res.text());
}

function args(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) continue;
        const key = a.slice(2);
        if (["dry-run"].includes(key)) out[key] = true;
        else out[key] = argv[++i];
    }
    return out;
}

async function main() {
    const opt = args(process.argv.slice(2));
    if (!opt.file || !opt.form) {
        console.error("Usage: node tools/ingest-contract.js --file <contract> --form \"PAM 2018\" [--project PRJ-…] [--doc-name …] [--dry-run] [--out chunks.json]");
        process.exit(1);
    }
    const docName = opt["doc-name"] || opt.form;
    const text = (await readContract(opt.file)).replace(/\r\n?/g, "\n");
    const result = contractClauses(text);
    const chunks = chunkClauses(result.clauses);
    console.log(result.method === "contents"
        ? `${result.clauses.length} of ${result.listed} clauses on the contents page found in the text`
        : `${result.clauses.length} clauses (no usable contents page; splitClauses)`);
    console.log(`${chunks.length} chunks (longest ${Math.max(...chunks.map(c => c.text.length))} characters)`);
    if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(chunks, null, 2));
    if (opt["dry-run"]) {
        chunks.forEach(c => console.log(`${c.no}${c.part > 1 ? " (" + c.part + ")" : ""}\t${c.title}\t${c.text.slice(0, 80)}`));
        return;
    }
    for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DASHSCOPE_API_KEY"]) {
        if (!process.env[k]) { console.error("Missing " + k + " in the environment."); process.exit(1); }
    }

    const rows = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        const vectors = await embed(batch.map(c => embedText(opt.form, c)));
        batch.forEach((c, j) => rows.push({
            project_id: opt.project || null, doc_name: docName, form: opt.form,
            clause_no: c.no, title: c.title || null, part: c.part, text: c.text,
            embedding: "[" + vectors[j].join(",") + "]"
        }));
        process.stdout.write(`embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}\r`);
    }
    console.log("");

    const scope = opt.project ? "project_id=eq." + encodeURIComponent(opt.project) : "project_id=is.null";
    await rest("DELETE", "contract_chunks?" + scope + "&doc_name=eq." + encodeURIComponent(docName));
    for (let i = 0; i < rows.length; i += 50) await rest("POST", "contract_chunks", rows.slice(i, i + 50));
    console.log(`Imported ${rows.length} chunks of "${docName}" (${opt.project ? "project " + opt.project : "shared with every project"}).`);
}

if (require.main === module) {
    main().catch(e => { console.error(e.message || e); process.exit(1); });
}

module.exports = { contentsEntries, headPattern, clausesFromContents, chunkClauses, contractClauses, embedText, cleanTitle };
