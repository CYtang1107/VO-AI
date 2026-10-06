/* VO-AI | page-capture.js — capture.html: the contractor records a
   variation on site from a phone. Photos first, then the essentials;
   saved as a draft VO with the photos attached as supporting documents.
   The pure parts live in js/capture.js. */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("capture", t("capture.title"), t("crumb.capture"));
        if (!ctx) return;
        const { session, project } = ctx;

        if (session.role !== "contractor") {
            document.getElementById("captureBlocked").hidden = false;
            return;
        }

        const form = document.getElementById("captureForm");
        form.hidden = false;

        /* {blob, url, ext} per photo, in the order taken. */
        const photos = [];

        const typeSelect = document.getElementById("capType");
        typeSelect.innerHTML = ["Architect's Instruction (AI)", "Engineer's instruction (EI)"].map(ty =>
            '<option value="' + escapeHtml(ty) + '">' + escapeHtml(t("instructionType." + ty)) + "</option>"
        ).join("");
        document.getElementById("capDate").value = today();

        /* A phone photo is 3–10 MB; the register only needs to show what
           was on site. Scale the long side down to 1600 px as JPEG. A
           format the browser cannot draw (e.g. HEIC) is kept as it is. */
        function shrink(file) {
            return new Promise(resolve => {
                const keep = () => resolve({ blob: file, ext: (/\.([a-z0-9]+)$/i.exec(file.name) || [, "jpg"])[1] });
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
                        if (blob && blob.size < file.size) resolve({ blob: blob, ext: "jpg" });
                        else keep();
                    }, "image/jpeg", 0.82);
                };
                img.onerror = () => { URL.revokeObjectURL(src); keep(); };
                img.src = src;
            });
        }

        function drawPhotos() {
            document.getElementById("photoCount").textContent =
                photos.length ? t("capture.photoCount", { n: photos.length }) : "";
            document.getElementById("photoThumbs").innerHTML = photos.length === 0
                ? '<p class="capture-empty">' + escapeHtml(t("capture.noPhotos")) + "</p>"
                : photos.map((p, i) =>
                    '<figure class="capture-thumb"><img src="' + p.url + '" alt="">' +
                    (p.geo ? '<span class="capture-thumb-geo" title="' + escapeHtml(t("capture.geo.placed")) + '">📍</span>' : "") +
                    '<button type="button" class="capture-remove" data-index="' + i + '" aria-label="' +
                    escapeHtml(t("capture.removePhoto")) + '">×</button></figure>'
                  ).join("");
        }

        /* Where each photo was taken (js/sitemap.js): the photo's own GPS
           when it carries one, else the phone's position right now. The
           position is watched from the moment the page opens. */
        const geoStatus = document.getElementById("capGeoStatus");
        function showGeoState(state) {
            geoStatus.textContent = t("capture.geo." + state);
            geoStatus.className = "capture-geo " + state;
        }
        if (typeof SiteGeo !== "undefined") SiteGeo.start(showGeoState);

        function placeOf(file) {
            return file.arrayBuffer()
                .then(buf => typeof exifGps === "function" ? exifGps(buf) : null, () => null)
                .then(exif => typeof photoGeo === "function"
                    ? photoGeo(exif, SiteGeo.position(), Date.now()) : null);
        }

        function addFiles(input) {
            const files = Array.from(input.files || []);
            input.value = "";
            Promise.all(files.map(f => Promise.all([shrink(f), placeOf(f)]))).then(list => {
                list.forEach(([p, geo]) => photos.push({ blob: p.blob, ext: p.ext, url: URL.createObjectURL(p.blob), geo: geo }));
                drawPhotos();
            });
        }

        document.getElementById("cameraInput").addEventListener("change", e => addFiles(e.target));
        document.getElementById("galleryInput").addEventListener("change", e => addFiles(e.target));
        document.getElementById("photoThumbs").addEventListener("click", e => {
            const btn = e.target.closest(".capture-remove");
            if (!btn) return;
            const [gone] = photos.splice(Number(btn.dataset.index), 1);
            URL.revokeObjectURL(gone.url);
            drawPhotos();
        });

        function localStamp() {
            const d = new Date();
            const pad = n => String(n).padStart(2, "0");
            return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
                "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
        }

        form.addEventListener("submit", e => {
            e.preventDefault();
            const rec = {
                description: document.getElementById("capDescription").value,
                location: document.getElementById("capLocation").value,
                typeOfInstruction: typeSelect.value,
                instructionNo: document.getElementById("capInstructionNo").value,
                dateIssued: document.getElementById("capDate").value || today(),
                line: {
                    qty: document.getElementById("capQty").value,
                    unit: document.getElementById("capUnit").value,
                    rate: document.getElementById("capRate").value
                },
                photos: photos
            };

            const problems = siteRecordProblems(rec);
            const list = document.getElementById("captureProblems");
            list.hidden = problems.length === 0;
            list.innerHTML = problems.map(k => "<li>" + escapeHtml(t(k)) + "</li>").join("");
            if (problems.length) { list.scrollIntoView({ block: "center" }); return; }

            const unplaced = unplacedPhotos(photos);
            if (unplaced > 0 && !window.confirm(t("capture.geo.confirmMissing", { n: unplaced, total: photos.length }))) return;

            const saveBtn = document.getElementById("captureSaveBtn");
            saveBtn.disabled = true;
            saveBtn.textContent = t("capture.saving");

            const stamp = localStamp();
            const files = photos.map((p, i) => {
                const name = sitePhotoName(stamp, i + 1, p.ext);
                return { id: uid("DOC"), name: name, geo: p.geo, file: new File([p.blob], name, { type: p.blob.type || "image/jpeg" }) };
            });

            Promise.all(files.map(f => FileStore.put(f.id, f.file))).then(stored => {
                const created = createVO(project.id, session);
                updateVO(project.id, created.id, v => {
                    applySiteRecord(v, Object.assign({}, rec, {
                        photos: files.map((f, k) => ({ id: f.id, name: f.name, size: f.file.size, stored: stored[k], geo: f.geo }))
                    }), session, today());
                    logHistory(v, session, "Recorded on site with " + files.length +
                        (files.length === 1 ? " photo" : " photos"));
                });
                toast(stored.every(Boolean) ? t("capture.saved") : t("file.notStored"),
                      stored.every(Boolean) ? undefined : "error");
                window.location.href = "vo.html?id=" + encodeURIComponent(created.id);
            });
        });

        drawPhotos();
    })();
}
