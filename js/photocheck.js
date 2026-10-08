/* VO-AI | photocheck.js — AI looks at a VO's site photos.

   On the VO page, 「AI 照片核对」, through the photo-check Edge Function
   (supabase/functions/photo-check): does each photo show what the
   description says? One verdict per photo (match / mismatch / unclear)
   with what the photo shows and why. (The capture page's AI-drafted
   description was dropped; the function's "describe" mode is unused.)

   The AI never states quantities or amounts from a photo (checked on the
   server), and a photo never proves an instruction: the contract
   design team still confirms it. The browser scales each photo down
   before sending it.

   Available with a team account, and in the no-sign-in demo for the demo
   project (the guest route of js/askcontract.js). */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { escapeHtml } = require("./ui.js");
    var { t } = require("./i18n.js");
    var { askAsGuest, askContractAvailable } = require("./askcontract.js");
    var { DEMO_FILES } = require("./store.js");
}

var PHOTO_CHECK_MAX = 4;

function isPhotoName(name) {
    return /\.(jpe?g|png|webp|heic|heif)$/i.test(String(name || ""));
}

/* A demo document's sample file (same rule as demoFileUrl in js/ui.js). */
function sampleUrl(doc) {
    return doc.url || (typeof DEMO_FILES !== "undefined" && DEMO_FILES[doc.id]) || "";
}

/* The VO's photos the browser can read: a demo sample file, or a file
   stored in this browser or the team's storage. */
function checkablePhotos(vo) {
    const readable = list => (list || []).filter(d => isPhotoName(d.name) && d.kind !== "video" && (d.stored || sampleUrl(d)));
    /* the completed work's photos (js/media.js) when there are any: what
       the description says was done; else the supporting photos */
    const after = readable(vo && vo.afterMedia);
    return after.length ? after : readable(vo && vo.supportingDocs);
}

/* Which photos one check sends: the first four. */
function photosToCheck(vo) {
    return checkablePhotos(vo).slice(0, PHOTO_CHECK_MAX);
}

function photoCheckAvailable(projectId) {
    return askContractAvailable(projectId);
}

/* A result is kept until the description or the photos change. */
function photoCheckKey(vo, docs) {
    return [vo.id, String(vo.description || "").trim(), (docs || []).map(d => d.id).join(",")].join("|");
}

function verdictPill(verdict) {
    const v = ["match", "mismatch", "unclear"].includes(verdict) ? verdict : "unclear";
    return '<span class="photo-verdict ' + v + '">' + escapeHtml(t("photo.verdict." + v)) + "</span>";
}

/* state: null, {loading}, {error}, {reason} (refused), or {results}.
   `docs`: the photos checked; `total`: how many photos the VO has. */
function renderPhotoCheck(state, docs, thumbs, total) {
    if (!docs || docs.length === 0) return '<p class="assistant-note">' + escapeHtml(t("photo.none")) + "</p>";
    if (!state) return "";
    if (state.loading) return '<div class="empty-state ask-loading">' + escapeHtml(t("photo.checking")) + "</div>";
    if (state.error) return '<div class="finding"><span>' + escapeHtml(t("photo.failed", { reason: state.error })) + "</span></div>";
    if (!state.results) return '<div class="finding"><span>' + escapeHtml(t("photo.refused." + (state.reason || "format"))) + "</span></div>";
    const byId = {};
    docs.forEach(d => { byId[d.id] = d; });
    const counts = { match: 0, mismatch: 0, unclear: 0 };
    state.results.forEach(r => { counts[r.verdict] = (counts[r.verdict] || 0) + 1; });
    const rows = state.results.map(r => {
        const doc = byId[r.id] || { name: r.id };
        const thumb = thumbs && thumbs[r.id]
            ? '<img class="photo-check-thumb" src="' + escapeHtml(thumbs[r.id]) + '" alt="">' : "";
        return '<div class="photo-check-row ' + escapeHtml(r.verdict) + '">' + thumb +
            '<div class="photo-check-body"><div class="photo-check-head">' + verdictPill(r.verdict) +
            ' <span class="photo-check-name">' + escapeHtml(doc.name) + "</span></div>" +
            (r.seen ? '<p><strong>' + escapeHtml(t("photo.seen")) + "</strong> " + escapeHtml(r.seen) + "</p>" : "") +
            (r.reason ? '<p class="rate-detail">' + escapeHtml(r.reason) + "</p>" : "") +
            "</div></div>";
    }).join("");
    return '<p class="photo-check-summary">' + escapeHtml(t("photo.summary", counts)) + "</p>" + rows +
        (total > docs.length ? '<p class="assistant-note">' + escapeHtml(t("photo.firstOnly", { n: docs.length, total: total })) + "</p>" : "");
}

/* ---------- browser-only below ---------- */

/* A photo as base64 JPEG, long side at most `max` px. */
function photoBase64(blob, max) {
    return new Promise((resolve, reject) => {
        const src = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, (max || 1024) / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(src);
            resolve(canvas.toDataURL("image/jpeg", 0.8).replace(/^data:image\/jpeg;base64,/, ""));
        };
        img.onerror = () => { URL.revokeObjectURL(src); reject(new Error(t("photo.cannotRead"))); };
        img.src = src;
    });
}

/* The photo file of a VO document: the demo sample, or the stored file. */
function photoBlob(doc) {
    const url = sampleUrl(doc);
    if (url) return fetch(url).then(r => { if (!r.ok) throw new Error(t("photo.cannotRead")); return r.blob(); });
    return FileStore.get(doc.id).then(rec => {
        if (!rec || !rec.blob) throw new Error(t("file.notInThisBrowser"));
        return rec.blob;
    });
}

/* Sends photos to the photo-check function. `images`: [{id, blob}].
   Resolves to the function's reply, or {error}. */
async function askPhotos(projectId, mode, images, description) {
    try {
        const data = await Promise.all(images.map(i => photoBase64(i.blob, 1024)));
        const body = {
            project_id: projectId, mode: mode, lang: typeof getLang === "function" ? getLang() : "en",
            images: images.map((i, k) => ({ id: i.id, data: data[k] }))
        };
        if (mode === "check") body.description = description;
        if (askAsGuest(projectId)) body.guest = true;
        return await Cloud.invoke("photo-check", body);
    } catch (e) {
        return { error: e.message || String(e) };
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        PHOTO_CHECK_MAX, isPhotoName, sampleUrl, checkablePhotos, photosToCheck, photoCheckAvailable,
        photoCheckKey, verdictPill, renderPhotoCheck
    };
}
