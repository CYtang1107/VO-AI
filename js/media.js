/* VO-AI | media.js — a VO's site photos and videos, on the VO page.

   Two sets, each a list of documents on the VO (like supportingDocs):
     beforeMedia  施工前照片 — the site before the work, taken when the
                  contractor describes the change (step 1). At least one
                  photo before the VO can go on: it shows what was there.
     afterMedia   完工照片 — the work done, sent with the measurement to
                  the consultant QS. At least one photo before it can be
                  submitted; the AI checks each against the description
                  (js/photocheck.js).
   Videos may be added to either, never required.

   Photos are taken with the phone's camera or chosen from the album,
   scaled down (long side 1600 px), and placed where they were taken
   (their own GPS, else the phone's position: js/sitemap.js). Taking
   photos on site used to be its own page (capture.html); it is now this
   part of a new VO. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
    var { escapeHtml } = require("./ui.js");
    var { prettyDate } = require("./calc.js");
}

var MEDIA_FIELDS = ["beforeMedia", "afterMedia"];
var VIDEO_MAX_MB = 200;

function isVideoName(name) {
    return /\.(mp4|mov|m4v|webm|3gp|avi|mkv)$/i.test(String(name || ""));
}
function isPhotoDoc(d) {
    return !!d && (d.kind === "photo" || (!d.kind && /\.(jpe?g|png|webp|heic|heif)$/i.test(String(d.name || ""))));
}
function isVideoDoc(d) {
    return !!d && (d.kind === "video" || (!d.kind && isVideoName(d.name)));
}

/* The photos (not videos) of one set. */
function mediaPhotos(vo, field) {
    return ((vo && vo[field]) || []).filter(isPhotoDoc);
}

/* What still stops this step: the description, the before photo; the
   measured rows, the completed photo. Keys of t(). */
function describeMissing(vo) {
    const out = [];
    if (!String((vo && vo.description) || "").trim()) out.push("media.need.description");
    if (!mediaPhotos(vo, "beforeMedia").length) out.push("media.need.before");
    return out;
}
function submitMissing(vo) {
    const out = [];
    const rows = ((vo && vo.measurement) || []).filter(r => String(r.description || "").trim() && Number(r.qty));
    if (!rows.length) out.push("wf.c.needRow");
    if (!mediaPhotos(vo, "afterMedia").length) out.push("media.need.after");
    return out;
}

/* A demo document's sample file, as js/photocheck.js reads it. */
function mediaSampleUrl(doc) {
    return doc.url || (typeof DEMO_FILES !== "undefined" && DEMO_FILES[doc.id]) || "";
}

/* One set: its name (and whether it is required), what it is for, the
   photos and videos so far, and, when editable, take a photo / choose
   from the album / add a video. Thumbnails are filled in afterwards
   (fillMediaThumbs) from this browser's file store. */
function renderMediaField(vo, field, opts) {
    const o = opts || {};
    const docs = (vo && vo[field]) || [];
    const editable = !!o.editable;
    const photos = docs.filter(isPhotoDoc).length, videos = docs.filter(isVideoDoc).length;
    const thumb = d => {
        const src = mediaSampleUrl(d);
        const at = ' data-media-thumb="' + escapeHtml(d.id) + '"' + (src ? ' data-src="' + escapeHtml(src) + '"' : "");
        const body = isVideoDoc(d)
            ? '<video controls preload="metadata" playsinline' + at + "></video>"
            : (src ? '<a href="' + escapeHtml(src) + '" target="_blank" rel="noopener">' : '<a href="#" class="file-open" data-file-id="' + escapeHtml(d.id) + '">') +
              '<img alt=""' + at + "></a>";
        return '<figure class="media-thumb' + (isVideoDoc(d) ? " is-video" : "") + '">' + body +
            '<figcaption>' + (isVideoDoc(d) ? "🎬 " : "") + escapeHtml(d.name) + (d.geo ? ' <span title="' + escapeHtml(t("capture.geo.placed")) + '">📍</span>' : "") +
                (d.at ? '<small>' + escapeHtml(prettyDate(d.at)) + "</small>" : "") + "</figcaption>" +
            (editable ? '<button type="button" class="media-remove" data-media="' + field + '" data-doc-id="' + escapeHtml(d.id) + '" aria-label="' +
                escapeHtml(t("capture.removePhoto")) + '">×</button>' : "") +
            "</figure>";
    };
    const picker = (cls, key, attrs) => '<label class="' + cls + ' media-btn">' + escapeHtml(t(key)) +
        '<input type="file" class="media-picker" data-media="' + field + '" ' + attrs + " hidden></label>";
    return '<div class="field media-field ' + (editable ? "owned" : "locked") + (o.required && !photos ? " media-missing" : "") + '" data-media-field="' + field + '">' +
        '<div class="doc-field-head"><span class="doc-field-label">' + escapeHtml(t("media." + field)) +
            (o.required ? ' <span class="media-req">' + escapeHtml(t("media.required")) + "</span>" : "") +
            (docs.length ? ' <span class="doc-count">' + escapeHtml(t("media.count", { p: photos, v: videos })) + "</span>" : "") + "</span></div>" +
        '<span class="hint">' + escapeHtml(t("media." + field + ".intro")) + "</span>" +
        (docs.length ? '<div class="media-grid">' + docs.map(thumb).join("") + "</div>"
                     : '<p class="doc-empty">' + escapeHtml(t(editable ? "media.empty" : "media.emptyLocked")) + "</p>") +
        (editable ? '<div class="media-actions">' +
            picker("primary-button", "media.takePhoto", 'accept="image/*" capture="environment"') +
            picker("secondary-button", "media.fromAlbum", 'accept="image/*" multiple') +
            picker("secondary-button", "media.addVideo", 'accept="video/*" multiple') +
            (o.geoState ? '<span class="capture-geo ' + escapeHtml(o.geoState) + '">' + escapeHtml(t("capture.geo." + o.geoState)) + "</span>" : "") +
            "</div>" : "") +
    "</div>";
}

/* ---------- browser-only below ---------- */

/* A phone photo is 3–10 MB: the long side down to 1600 px as JPEG. A
   format the browser cannot draw (e.g. HEIC) is kept as it is. */
function shrinkPhoto(file) {
    return new Promise(resolve => {
        const keep = () => resolve(file);
        const src = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(src);
            canvas.toBlob(blob => {
                if (blob && blob.size < file.size) resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
                else keep();
            }, "image/jpeg", 0.82);
        };
        img.onerror = () => { URL.revokeObjectURL(src); keep(); };
        img.src = src;
    });
}

/* Where a photo or video was taken: a photo's own GPS, else the phone's
   position now (js/sitemap.js). */
function placeOfMedia(file, video) {
    const pos = typeof SiteGeo !== "undefined" ? SiteGeo.position() : null;
    if (video || typeof exifGps !== "function") return Promise.resolve(typeof photoGeo === "function" ? photoGeo(null, pos, Date.now()) : null);
    return file.arrayBuffer().then(buf => exifGps(buf), () => null)
        .then(exif => typeof photoGeo === "function" ? photoGeo(exif, pos, Date.now()) : null);
}

/* The files picked, ready to keep: [{id, file, doc}] (doc without
   uploadedBy/at). Videos over VIDEO_MAX_MB are left out (`tooBig`). */
async function prepareMedia(files, stamp) {
    const out = [], tooBig = [];
    let n = 0;
    for (const f of files) {
        const video = /^video\//.test(f.type) || isVideoName(f.name);
        if (video && f.size > VIDEO_MAX_MB * 1024 * 1024) { tooBig.push(f.name); continue; }
        const kept = video ? f : await shrinkPhoto(f);
        const geo = await placeOfMedia(f, video);
        n++;
        const ext = (/\.([a-z0-9]+)$/i.exec(kept.name) || [, video ? "mp4" : "jpg"])[1].toLowerCase();
        const name = (video ? "VID-" : "IMG-") + stamp + "-" + String(n).padStart(2, "0") + "." + ext;
        const id = typeof uid === "function" ? uid("DOC") : "DOC-" + Date.now() + "-" + n;
        out.push({ id: id, file: kept, doc: { id: id, name: name, size: kept.size, kind: video ? "video" : "photo", geo: geo || undefined } });
    }
    return { items: out, tooBig: tooBig };
}

/* Each thumbnail's picture: the demo sample, or the file kept in this
   browser (or the team's storage, through FileStore). */
var mediaUrls = {};
function fillMediaThumbs(root) {
    (root || document).querySelectorAll("[data-media-thumb]").forEach(el => {
        const id = el.dataset.mediaThumb;
        const set = url => { if (url && el.getAttribute("src") !== url) el.src = url; };
        if (el.dataset.src) { set(el.dataset.src); return; }
        if (mediaUrls[id]) { set(mediaUrls[id]); return; }
        if (typeof FileStore === "undefined") return;
        FileStore.get(id).then(rec => {
            if (rec && rec.blob) { mediaUrls[id] = URL.createObjectURL(rec.blob); set(mediaUrls[id]); }
            else el.closest(".media-thumb").classList.add("media-unavailable");
        }).catch(() => {});
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { MEDIA_FIELDS, VIDEO_MAX_MB, isVideoName, isPhotoDoc, isVideoDoc, mediaPhotos, describeMissing, submitMissing, renderMediaField };
}
