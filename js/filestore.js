/* VO-AI | filestore.js — the content of attached documents.

   The register (localStorage) records each document's metadata; the
   file itself is kept here, in the browser's IndexedDB, keyed by the
   document's id, so a file name can be clicked to open the file.
   Like the rest of the prototype's data it lives in this browser only:
   someone on another computer sees the name but cannot open the file,
   and a project exported as .json carries metadata only.

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
    function put(id, file) {
        if (!supported()) return Promise.resolve(false);
        return run("readwrite", function (store) {
            store.put({ blob: file, name: file.name, type: file.type || "" }, id);
        }).then(function () { return true; }, function () { return false; });
    }

    function get(id) {
        if (!supported()) return Promise.resolve(null);
        return run("readonly", function (store) { return store.get(id); })
            .then(function (rec) { return rec || null; }, function () { return null; });
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

    function download(id, name) {
        return get(id).then(function (rec) {
            if (!rec) {
                if (typeof toast === "function") toast(t("file.notInThisBrowser"), "error");
                return;
            }
            var url = URL.createObjectURL(rec.blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = rec.name || name || "document";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        });
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
            var link = e.target.closest && e.target.closest(".file-open[data-file-id], .file-download[data-file-id]");
            if (!link) return;
            e.preventDefault();
            if (link.classList.contains("file-download")) download(link.dataset.fileId, link.dataset.fileName);
            else open(link.dataset.fileId, link.dataset.fileName);
        });
    }

    return { supported: supported, put: put, get: get, remove: remove, open: open, download: download };
})();
