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
const { contractFileText } = require("../js/contractread.js");
const { chunkClauses, contractClauses, embedText, contentsEntries, headPattern, clausesFromContents, cleanTitle } = require("../js/kbsplit.js");

const EMBED_MODEL = "text-embedding-v4";
const EMBED_DIM = 1024;
const EMBED_BATCH = 10;
const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

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
