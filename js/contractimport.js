/* VO-AI | contractimport.js — 「导入合同到知识库」: a contract uploaded on
   the Documents page becomes searchable by 「问合同」 (docs/rag-plan.md).

   file → text → clauses → embedded chunks in the project's knowledge base

   - Text: js/contractread.js reads a text PDF, .docx or .txt in the
     browser. A scanned PDF has no text, so each page is drawn as an image
     (pdf.js, loaded from the CDN only then) and read by the import-contract
     Edge Function's OCR (Qwen-VL), four pages at a time.
   - Clauses: js/kbsplit.js, the same splitter as tools/ingest-contract.js.
   - Embedding and storage: the import-contract Edge Function, which holds
     the API key, checks the caller is the project's consultant, and
     stores the clauses under this project only.

   Team accounts only (Cloud.active()); the offline demo has no knowledge
   base. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { contractFileText } = require("./contractread.js");
    var { contractClauses, chunkClauses, detectForm } = require("./kbsplit.js");
    var { t } = require("./i18n.js");
    var { escapeHtml } = require("./ui.js");
}

var KB_BATCH = 40;          /* chunks per call: one call embeds them all */
var OCR_PARALLEL = 4;       /* pages read at once */
var OCR_LONG_SIDE = 1700;   /* px: about 150 dpi on A4, enough for OCR */
var PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
var PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

/* ---------- pure (tested in test/contractimport.test.js) ---------- */

function inBatches(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/* The form a document's clauses are cited by: the standard form it
   names, else its file name without the extension. */
function formFor(docName, text) {
    return detectForm(text) || String(docName || "Contract").replace(/\.[a-z0-9]{2,5}$/i, "").trim() || "Contract";
}

/* contract_chunks rows → one entry per imported document. */
function groupKnowledge(rows) {
    const byDoc = {};
    const order = [];
    (rows || []).forEach(r => {
        if (!byDoc[r.doc_name]) {
            byDoc[r.doc_name] = { docName: r.doc_name, form: r.form || r.doc_name, clauses: new Set(), chunks: 0 };
            order.push(r.doc_name);
        }
        byDoc[r.doc_name].clauses.add(r.clause_no);
        byDoc[r.doc_name].chunks++;
    });
    return order.map(n => ({ docName: n, form: byDoc[n].form, clauses: byDoc[n].clauses.size, chunks: byDoc[n].chunks }));
}

/* The clauses and chunks to import from a contract's text, or an error
   key when too few clauses were found to be useful. */
function knowledgeFromText(docName, text) {
    const split = contractClauses(text);
    const chunks = chunkClauses(split.clauses);
    if (split.clauses.length < 5) return { error: "kb.error.fewClauses", clauses: split.clauses.length };
    return {
        form: formFor(docName, text),
        method: split.method, listed: split.listed,
        clauses: split.clauses.length,
        chunks: chunks.map(c => ({ no: c.no, title: c.title || "", part: c.part, text: c.text }))
    };
}

/* ---------- the knowledge-base card on the Documents page ---------- */

/* entries: groupKnowledge(...); docs: the project's contract documents;
   progress: {docId, text} while an import runs. */
function renderKnowledgeCard(entries, docs, canImport, progress) {
    const imported = new Set((entries || []).map(e => e.docName));
    const list = (entries || []).length
        ? '<ul class="doc-list">' + entries.map(e =>
            '<li class="file-item doc-registry-item kb-entry"><div class="doc-current">' +
            '<span class="doc-category-tag kb-tag">' + escapeHtml(t("kb.inKnowledge")) + "</span>" +
            "<strong>" + escapeHtml(e.form) + "</strong>" +
            (e.docName !== e.form ? '<span class="file-date">' + escapeHtml(e.docName) + "</span>" : "") +
            '<span class="file-date">' + escapeHtml(t("kb.counts", { clauses: e.clauses, chunks: e.chunks })) + "</span>" +
            (canImport ? '<button type="button" class="file-remove kb-remove-btn" data-doc-name="' + escapeHtml(e.docName) + '">' +
                escapeHtml(t("kb.remove")) + "</button>" : "") +
            "</div></li>").join("") + "</ul>"
        : '<div class="empty-state">' + escapeHtml(t("kb.empty")) + "</div>";

    let importRows = "";
    if (canImport) {
        importRows = (docs || []).length
            ? '<h4 class="kb-subhead">' + escapeHtml(t("kb.importTitle")) + "</h4>" +
              '<ul class="doc-list">' + docs.map(d => {
                  const busy = progress && progress.docId === d.id;
                  return '<li class="file-item doc-registry-item"><div class="doc-current">' +
                      "<span>" + escapeHtml(d.name) + "</span>" +
                      '<button type="button" class="secondary-button kb-import-btn" data-doc-id="' + escapeHtml(d.id) + '"' +
                      (progress ? " disabled" : "") + ">" +
                      escapeHtml(t(imported.has(d.name) ? "kb.reimport" : "kb.import")) + "</button>" +
                      "</div>" +
                      (busy ? '<p class="kb-progress" role="status">' + escapeHtml(progress.text) + "</p>" : "") +
                      "</li>";
              }).join("") + "</ul>"
            : '<p class="assistant-note">' + escapeHtml(t("kb.noContractDocs")) + "</p>";
    }
    return '<p class="assistant-note">' + escapeHtml(t("kb.note")) + "</p>" + list + importRows;
}

/* ---------- browser ---------- */

function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = PDFJS_URL;
        el.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            resolve(window.pdfjsLib);
        };
        el.onerror = () => reject(new Error(t("kb.error.pdfjs")));
        document.head.appendChild(el);
    });
}

/* One page drawn as a JPEG, base64 without the data: prefix. */
async function pageImage(pdf, n) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = OCR_LONG_SIDE / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    page.cleanup();
    return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
}

/* A scanned PDF's text, page by page through the server's OCR. */
async function ocrPdf(projectId, buf, onProgress) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    const total = pdf.numPages;
    const texts = new Array(total).fill("");
    let next = 1, done = 0;
    async function worker() {
        while (next <= total) {
            const n = next++;
            const image = await pageImage(pdf, n);
            let tries = 0;
            for (;;) {
                try {
                    const res = await Cloud.invoke("import-contract", { action: "ocr", project_id: projectId, image: image });
                    texts[n - 1] = res.text || "";
                    break;
                } catch (e) {
                    if (++tries >= 2) throw new Error(t("kb.error.ocrPage", { page: n, reason: e.message || String(e) }));
                }
            }
            done++;
            onProgress(t("kb.progress.ocr", { done: done, total: total }));
        }
    }
    onProgress(t("kb.progress.ocr", { done: 0, total: total }));
    await Promise.all(Array.from({ length: Math.min(OCR_PARALLEL, total) }, worker));
    return texts.join("\n");
}

async function contractDocBytes(doc) {
    if (doc.stored && typeof FileStore !== "undefined") {
        const rec = await FileStore.get(doc.id);
        if (rec && rec.blob) return rec.blob.arrayBuffer();
    }
    const url = typeof demoFileUrl === "function" ? demoFileUrl(doc) : "";
    if (url) {
        const res = await fetch(url);
        if (res.ok) return res.arrayBuffer();
    }
    return null;
}

/* Imports one document; onProgress(text) reports each stage. Resolves
   {form, clauses, chunks, ocr, pages?}; rejects with a readable message. */
async function importContractDoc(projectId, doc, onProgress) {
    onProgress(t("kb.progress.reading"));
    const buf = await contractDocBytes(doc);
    if (!buf) throw new Error(t("contract.read.notHere"));

    let text = "", usedOcr = false;
    const read = await contractFileText(doc.name, buf);
    if (read.text) text = read.text;
    else if (read.error === "contract.read.noText" && /\.pdf$/i.test(doc.name)) {
        text = await ocrPdf(projectId, buf, onProgress);
        usedOcr = true;
    } else throw new Error(t(read.error));
    text = text.replace(/\r\n?/g, "\n");

    onProgress(t("kb.progress.splitting"));
    const kb = knowledgeFromText(doc.name, text);
    if (kb.error) throw new Error(t(kb.error, { n: kb.clauses }));

    const batches = inBatches(kb.chunks, KB_BATCH);
    let sent = 0;
    for (let i = 0; i < batches.length; i++) {
        onProgress(t("kb.progress.embedding", { done: sent, total: kb.chunks.length }));
        await Cloud.invoke("import-contract", {
            action: "chunks", project_id: projectId, doc_name: doc.name, form: kb.form,
            chunks: batches[i], replace: i === 0
        });
        sent += batches[i].length;
    }
    return { form: kb.form, clauses: kb.clauses, chunks: kb.chunks.length, ocr: usedOcr };
}

async function loadKnowledge(projectId) {
    return groupKnowledge(await Cloud.knowledgeRows(projectId));
}

async function removeKnowledge(projectId, docName) {
    return Cloud.invoke("import-contract", { action: "remove", project_id: projectId, doc_name: docName });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { inBatches, formFor, groupKnowledge, knowledgeFromText, renderKnowledgeCard };
}
