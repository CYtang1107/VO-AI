/* VO-AI | capture.js
   Recording a variation on site: the contractor takes photos and keys in
   the essentials from a phone, and it is saved straight away as a draft
   VO. These are the pure parts (naming the photos, checking the record,
   writing it onto a VO); the page itself is js/page-capture.js. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { uid } = require("./store.js");
}

/* "2026-10-05T17:45:12" + 2 + "jpg" -> "site-photo-20261005-1745-2.jpg".
   Phone cameras all call their file "image.jpg"; a dated name keeps the
   photos of one visit apart from the next in the documents list. */
function sitePhotoName(stampIso, index, ext) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stampIso || "");
    const stamp = m ? m[1] + m[2] + m[3] + "-" + m[4] + m[5] : "undated";
    const clean = String(ext || "jpg").replace(/^\./, "").toLowerCase() || "jpg";
    return "site-photo-" + stamp + "-" + index + "." + clean;
}

/* What still stops the record from being saved, as i18n keys. A photo
   alone is not a VO and neither is a description alone: the point of
   recording on site is the evidence and the words together. */
function siteRecordProblems(rec) {
    const problems = [];
    if (!rec.photos || rec.photos.length === 0) problems.push("capture.need.photo");
    if (!String(rec.description || "").trim()) problems.push("capture.need.description");
    const line = rec.line || {};
    const hasLine = String(line.qty || "").trim() !== "" || String(line.unit || "").trim() !== "";
    if (hasLine && !(Number(line.qty) > 0)) problems.push("capture.need.qty");
    return problems;
}

/* How many photos have no recorded place (GPS off, refused, or not
   available indoors). The page asks before saving them: they will not
   show on the site map, but recording the variation is never blocked. */
function unplacedPhotos(photos) {
    return (photos || []).filter(p => !p.geo).length;
}

/* Writes a site record onto a freshly created VO (the contractor's own
   columns only). `rec`: {description, location, typeOfInstruction,
   instructionNo, dateIssued, line: {unit, qty, rate}, photos: [{id, name,
   size, stored, geo?}]}. Mutates and returns `vo`. */
function applySiteRecord(vo, rec, session, todayIso) {
    const description = String(rec.description || "").trim();
    const location = String(rec.location || "").trim();
    vo.description = location ? location + " — " + description : description;
    if (rec.typeOfInstruction) vo.typeOfInstruction = rec.typeOfInstruction;
    vo.instructionNo = String(rec.instructionNo || "").trim();
    if (rec.dateIssued) vo.dateIssued = rec.dateIssued;

    const line = rec.line || {};
    if (Number(line.qty) > 0) {
        vo.measurement = vo.measurement || [];
        vo.measurement.push({
            id: uid("M"), bqItemId: null, description: description,
            unit: String(line.unit || "").trim(), qty: Number(line.qty),
            rate: Number(line.rate) > 0 ? Number(line.rate) : 0,
            assessedQty: "", assessedRate: ""
        });
    }

    vo.supportingDocs = vo.supportingDocs || [];
    (rec.photos || []).forEach(p => {
        const doc = { id: p.id, name: p.name, size: p.size, uploadedBy: session.name, at: todayIso };
        if (p.stored) doc.stored = true;
        if (p.geo) doc.geo = p.geo;
        vo.supportingDocs.push(doc);
    });
    return vo;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { sitePhotoName, siteRecordProblems, unplacedPhotos, applySiteRecord };
}
