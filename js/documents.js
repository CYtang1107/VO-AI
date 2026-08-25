/* VO-AI | documents.js — version history for one attached document.
   A document is a chain of revisions: the top-level fields
   (id, name, size, uploadedBy, at) are always the CURRENT version; an
   optional `revisions` array holds prior versions in the same shape,
   oldest first. A document with no `revisions` array behaves exactly
   as if it had an empty one — nothing here migrates stored data.
   Pure, no DOM, no localStorage. Records file METADATA only. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { uid } = require("./store.js");
}

/* The current version of a document, as a plain {id, name, size,
   uploadedBy, at} object (the `revisions` chain stripped off). */
function currentVersion(doc) {
    return { id: doc.id, name: doc.name, size: doc.size,
             uploadedBy: doc.uploadedBy, at: doc.at };
}

/* 1 (the current version) plus however many prior versions are on
   record. A missing `revisions` array counts as zero, never crashes. */
function versionCount(doc) {
    return 1 + ((doc.revisions || []).length);
}

/* Attach a new version of an existing document. The previous current
   version is pushed onto `revisions` (oldest first) and the new
   version — built from `file` {name, size} and `session` {name} —
   takes its place as the current version. Never discards a prior
   version. Mutates and returns `doc`. `today` is a pre-computed date
   string (e.g. from calc.js's today()), not a function. */
function addVersion(doc, file, session, today) {
    doc.revisions = doc.revisions || [];
    doc.revisions.push(currentVersion(doc));
    doc.id = uid("DOC");
    doc.name = file.name;
    doc.size = file.size;
    doc.uploadedBy = session.name;
    doc.at = today;
    return doc;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { currentVersion, versionCount, addVersion };
}
