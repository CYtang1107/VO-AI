/* VO-AI | bqocr.js — a priced BQ that is a scan, a PDF or a photo.

   A spreadsheet BQ is read in the browser (js/bqimport.js). A BQ that is
   only a PDF (scanned or printed to PDF) or a photo of its pages is read
   by OCR: each page is drawn as a JPEG here (pdf.js, from the CDN, only
   then) and read by the read-bq Edge Function (Qwen-VL), one page at a
   time. The rows it returns become a table with fixed columns
     code | description | unit | qty | rate | amount
   which goes through the SAME preview as a spreadsheet: the column
   mapping, the qty × rate = amount check, and the consultant's
   confirmation. Nothing read by OCR enters the project unconfirmed.

   Needs the internet; with a team account any signed-in person may use
   it, in the demo it shares the guest limit of 「问合同」. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
}

var BQ_OCR_PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
var BQ_OCR_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
var BQ_OCR_LONG_SIDE = 1800;     /* px: small print in a BQ table must stay legible */
var BQ_OCR_MAX_PAGES = 20;

function isOcrBqFile(name) {
    return /\.(pdf|jpe?g|png|webp)$/i.test(String(name || ""));
}

/* The OCR rows as a sheet for detectColumns / extractItems: a header row
   naming the columns, then one row per item. */
var BQ_OCR_COLUMNS = ["Item", "Description", "Unit", "Qty", "Rate", "Amount"];
function ocrRowsToSheet(rows) {
    return [BQ_OCR_COLUMNS.slice()].concat((rows || []).map(r => [
        r.code || "", r.description || "", r.unit || "",
        r.qty === null || r.qty === undefined ? "" : r.qty,
        r.rate === null || r.rate === undefined ? "" : r.rate,
        r.amount === null || r.amount === undefined ? "" : r.amount
    ]));
}

/* The preview's mapping for that sheet: the columns are known. */
var BQ_OCR_MAPPING = { code: 0, description: 1, unit: 2, qty: 3, rate: 4, amount: 5 };

function bqOcrAvailable() {
    return typeof Cloud !== "undefined" && Cloud.enabled();
}

/* ---------- browser ---------- */

function bqOcrLoadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = BQ_OCR_PDFJS;
        el.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = BQ_OCR_WORKER; resolve(window.pdfjsLib); };
        el.onerror = () => reject(new Error(t("kb.error.pdfjs")));
        document.head.appendChild(el);
    });
}

function canvasJpeg(draw, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return Promise.resolve(draw(ctx, canvas)).then(() => canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
}

/* Each page of the file as a base64 JPEG. */
async function bqPageImages(file) {
    if (/\.pdf$/i.test(file.name)) {
        const lib = await bqOcrLoadPdfJs();
        const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const out = [];
        for (let n = 1; n <= Math.min(pdf.numPages, BQ_OCR_MAX_PAGES); n++) {
            const page = await pdf.getPage(n);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: BQ_OCR_LONG_SIDE / Math.max(base.width, base.height) });
            out.push(await canvasJpeg(ctx => page.render({ canvasContext: ctx, viewport: viewport }).promise, viewport.width, viewport.height));
            page.cleanup();
        }
        return out;
    }
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error(t("bqocr.badImage")));
            i.src = url;
        });
        const scale = Math.min(1, BQ_OCR_LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        return [await canvasJpeg(ctx => ctx.drawImage(img, 0, 0, img.naturalWidth * scale, img.naturalHeight * scale),
                                 img.naturalWidth * scale, img.naturalHeight * scale)];
    } finally { URL.revokeObjectURL(url); }
}

/* Every page read in turn; onProgress(text). Returns { rows, pages,
   failed: [page numbers] }. A page that cannot be read is reported,
   not guessed. */
async function readBqFile(file, onProgress) {
    const images = await bqPageImages(file);
    const guest = !Cloud.active();
    const rows = [], failed = [];
    let lastError = "";
    for (let i = 0; i < images.length; i++) {
        onProgress && onProgress(t("bqocr.progress", { done: i, total: images.length }));
        let res = null;
        for (let tries = 0; tries < 2 && !res; tries++) {
            try { res = await Cloud.invoke("read-bq", guest ? { image: images[i], guest: true } : { image: images[i] }); }
            catch (e) { if (tries === 1) res = { error: e.message || String(e) }; }
        }
        if (res && res.reason === "guest-limit") throw new Error(t("bqocr.guestLimit"));
        if (res && Array.isArray(res.rows)) rows.push.apply(rows, res.rows);
        else { failed.push(i + 1); lastError = (res && (res.error || res.reason)) || lastError; }
    }
    /* nothing read at all: say why, not "no items" */
    if (failed.length === images.length) throw new Error(lastError || t("bqocr.failedPages", { pages: failed.join(", ") }));
    onProgress && onProgress(t("bqocr.progress", { done: images.length, total: images.length }));
    return { rows: rows, pages: images.length, failed: failed };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { isOcrBqFile, ocrRowsToSheet, BQ_OCR_MAPPING, BQ_OCR_COLUMNS };
}
