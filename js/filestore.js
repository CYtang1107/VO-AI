/* VO-AI | filestore.js — the content of attached documents.

   The register (localStorage) records each document's metadata; the
   file itself is kept here, in the browser's IndexedDB, keyed by the
   document's id, so a file name can be clicked to open the file.
   Offline, like the rest of the prototype's data it lives in this
   browser only: someone on another computer sees the name but cannot
   open the file, and a project exported as .json carries metadata only.
   Signed in with a team account (js/cloud.js), each file is also stored
   in the project's private Supabase Storage folder, and a file that is
   not in this browser is fetched from there.

   Browser-only. Any element with class "file-open" and a data-file-id
   opens that file on click (wired once, below). */

var FileStore = (function () {
    var DB_NAME = "voai-files";
    var STORE = "files";
    var dbPromise = null;

    function supported() {
        return typeof indexedDB !== "undefined";
    }

    function openDb() {
        if (!dbPromise) {
            dbPromise = new Promise(function (resolve, reject) {
                var req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        }
        return dbPromise;
    }

    function run(mode, fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, mode);
                var result = fn(tx.objectStore(STORE));
                tx.oncomplete = function () { resolve(result && "result" in result ? result.result : undefined); };
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error); };
            });
        });
    }

    /* Saves `file` (a File/Blob) under `id`. Resolves true when stored,
       false when this browser cannot store it — the caller still records
       the document's name either way. */
    function putLocal(id, file) {
        if (!supported()) return Promise.resolve(false);
        return run("readwrite", function (store) {
            store.put({ blob: file, name: file.name, type: file.type || "" }, id);
        }).then(function () { return true; }, function () { return false; });
    }

    /* The project a team member is working in, when files go to the cloud. */
    function cloudProject() {
        if (typeof Cloud === "undefined" || !Cloud.active()) return null;
        var s = typeof getSession === "function" ? getSession() : null;
        return (s && s.projectId) || null;
    }

    function putCloud(id, file) {
        var projectId = cloudProject();
        if (!projectId) return Promise.resolve(false);
        return Cloud.uploadFile(projectId, id, file).then(function () { return true; }, function (e) {
            if (typeof toast === "function") toast(t("cloud.uploadFailed", { name: file.name || "", reason: e.message || "" }), "error");
            return false;
        });
    }

    function put(id, file) {
        return Promise.all([putLocal(id, file), putCloud(id, file)])
            .then(function (r) { return r[0] || r[1]; });
    }

    function getLocal(id) {
        if (!supported()) return Promise.resolve(null);
        return run("readonly", function (store) { return store.get(id); })
            .then(function (rec) { return rec || null; }, function () { return null; });
    }

    function get(id) {
        return getLocal(id).then(function (rec) {
            var projectId = rec ? null : cloudProject();
            if (!projectId) return rec;
            return Cloud.downloadFile(projectId, id).then(function (blob) {
                if (!blob) return null;
                var fetched = { blob: blob, name: "", type: blob.type || "" };
                putLocal(id, blob);
                return fetched;
            }, function () { return null; });
        });
    }

    function remove(ids) {
        if (!supported() || !ids || ids.length === 0) return Promise.resolve();
        return run("readwrite", function (store) {
            ids.forEach(function (id) { store.delete(id); });
        }).catch(function () {});
    }

    /* Types a browser tab can show itself open in a new tab; anything
       else (Word, Excel, DWG…) is downloaded under its own name. */
    function viewable(name) {
        return /\.(pdf|png|jpe?g|gif|webp|svg|txt|csv)$/i.test(name || "");
    }

    function open(id, name) {
        /* Open the tab synchronously, inside the click, so the browser
           does not treat it as a pop-up; fill it once the file is read. */
        var tab = viewable(name) ? window.open("", "_blank") : null;
        return get(id).then(function (rec) {
            if (!rec) {
                if (tab) tab.close();
                if (typeof toast === "function") toast(t("file.notInThisBrowser"), "error");
                return;
            }
            var url = URL.createObjectURL(rec.blob);
            if (tab) {
                tab.location.href = url;
            } else {
                var a = document.createElement("a");
                a.href = url;
                a.download = rec.name || name || "document";
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
            setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        });
    }

    if (typeof document !== "undefined") {
        document.addEventListener("click", function (e) {
            /* Only links to a stored file carry data-file-id; a demo
               document's link is an ordinary href and is left alone. */
            var link = e.target.closest && e.target.closest(".file-open[data-file-id]");
            if (!link) return;
            e.preventDefault();
            open(link.dataset.fileId, link.dataset.fileName);
        });
    }

    return { supported: supported, put: put, get: get, remove: remove, open: open };
})();
