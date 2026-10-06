/* VO-AI | import-contract checks — what a request may carry
   (docs/rag-plan.md). Pure functions, shared by the Edge Function
   (index.ts, Deno) and the Node tests (test/contractimport.test.js). */

export const MAX_CHUNKS_PER_CALL = 60;
export const MAX_CHUNK_TEXT = 2500;
export const MAX_IMAGE_BASE64 = 4 * 1024 * 1024;   /* about 3 MB of JPEG */
export const MAX_NAME = 200;

/* The text each clause is embedded as: its form, number and title lead,
   so a question about "clause 11.6" or "valuation rules" finds it. Same
   as js/kbsplit.js embedText. */
export function embedText(form, c) {
    const label = /^Article/.test(c.no) ? c.no : "Clause " + c.no;
    return (form ? form + " " : "") + label + (c.title ? " " + c.title : "") + ": " + c.text;
}

function shortText(v, max) {
    return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/* null when the request is acceptable, else the reason. */
export function validImportRequest(body) {
    if (!body || typeof body !== "object") return "Body must be JSON.";
    if (!shortText(body.project_id, MAX_NAME)) return "project_id is required.";
    if (body.action === "ocr") {
        if (typeof body.image !== "string" || body.image.length < 100) return "image is required (base64 JPEG).";
        if (body.image.length > MAX_IMAGE_BASE64) return "image is too large; render the page smaller.";
        if (!/^[A-Za-z0-9+/=]+$/.test(body.image.slice(0, 2000))) return "image must be base64 without a data: prefix.";
        return null;
    }
    if (body.action === "chunks") {
        if (!shortText(body.doc_name, MAX_NAME)) return "doc_name is required.";
        if (!shortText(body.form, MAX_NAME)) return "form is required.";
        if (!Array.isArray(body.chunks) || body.chunks.length === 0) return "chunks are required.";
        if (body.chunks.length > MAX_CHUNKS_PER_CALL) return "at most " + MAX_CHUNKS_PER_CALL + " chunks per call.";
        for (const c of body.chunks) {
            if (!c || !shortText(c.no, 40)) return "every chunk needs its clause number.";
            if (!shortText(c.text, MAX_CHUNK_TEXT)) return "clause " + c.no + ": text missing or too long.";
            if (c.title !== undefined && c.title !== null && typeof c.title !== "string") return "clause " + c.no + ": title must be text.";
        }
        return null;
    }
    if (body.action === "remove") {
        if (!shortText(body.doc_name, MAX_NAME)) return "doc_name is required.";
        return null;
    }
    return "action must be ocr, chunks or remove.";
}

/* The rows written for one call's chunks. */
export function chunkRows(projectId, docName, form, chunks, vectors) {
    return chunks.map((c, i) => ({
        project_id: projectId, doc_name: docName, form: form,
        clause_no: c.no, title: c.title || null, part: Number(c.part) || 1, text: c.text,
        embedding: "[" + vectors[i].join(",") + "]"
    }));
}

/* What the OCR model is asked. Plain text, line by line, nothing added:
   the clause splitter relies on numbers at line starts. */
export const OCR_PROMPT =
    "This is one page of a construction contract. Read all of its text exactly as written, " +
    "line by line, keeping clause numbers (e.g. 11.6) and headings at the start of their lines. " +
    "Output plain text only: no markdown, no commentary, no translation.";
