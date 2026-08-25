/* VO-AI | page-projects.js — Stage 2 & 3: create and choose a project. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, today, projectStats } = require("./calc.js");
    var { escapeHtml } = require("./ui.js");
    var { uid } = require("./store.js");
}

/* Accepts a BQ pasted straight out of Excel (tab separated) or a CSV.
   Columns: code, description, unit, rate. */
function parseBqPaste(text) {
    return String(text || "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(line.includes("\t") ? "\t" : ",").map(c => c.trim()))
        .filter(cells => cells.length >= 4)
        .filter(cells => {
            const last = cells[cells.length - 1];
            return last !== "" && !Number.isNaN(Number(last));
        })
        .map(cells => ({
            code: cells[0],
            description: cells.slice(1, cells.length - 2).join(", "),
            unit: cells[cells.length - 2],
            rate: Number(cells[cells.length - 1])
        }));
}

function renderProjectCard(project, session) {
    const s = projectStats(project);
    return '' +
        '<div class="card project-card" data-project="' + escapeHtml(project.id) + '">' +
          '<div class="card-body">' +
            "<h3>" + escapeHtml(project.name) + "</h3>" +
            '<p class="lead" style="font-size:11px;margin:6px 0 14px">' +
                escapeHtml(project.client || "—") + " · Contract " +
                escapeHtml(project.contractNo || "—") + "</p>" +
            '<div class="project-meta">' +
                "<div><small>VOs</small><strong>" + s.total + "</strong></div>" +
                "<div><small>Pending</small><strong>" + s.pending + "</strong></div>" +
                "<div><small>VO value</small><strong>" + rm(s.value) + "</strong></div>" +
                "<div><small>BQ items</small><strong>" + (project.bq || []).length + "</strong></div>" +
            "</div>" +
            '<button class="primary-button open-project" style="width:100%;margin-top:16px">' +
                "Open as " + escapeHtml(session.role === "contractor" ? "Contractor QS" :
                    session.role === "consultant" ? "Consultant QS" : "Client") +
            " →</button>" +
            '<button type="button" class="secondary-button export-project" ' +
                'style="width:100%;margin-top:8px">Export project (.json)</button>' +
          "</div>" +
        "</div>";
}

/* -----------------------------------------------------------
   Project export / import — a deliberate, explicit file exchange, not
   live sync. Pure and DOM-free so they are unit-testable; the browser
   wiring below owns the Blob/object URL and the file input.
----------------------------------------------------------- */

/* A JSON-safe deep clone of the project, suitable for JSON.stringify
   and a later validateImport/importProject round trip. */
function exportProject(project) {
    return JSON.parse(JSON.stringify(project));
}

/* Rejects anything that is not a plain object with at least a `name`
   string and array fields for bq, vos and documents. Never throws —
   a malformed or hostile file gets a clear, itemised reason instead. */
function validateImport(parsed) {
    const errors = [];

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, errors: ["The file is not a JSON object."] };
    }
    if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
        errors.push("Missing a project name.");
    }
    ["bq", "vos", "documents"].forEach(key => {
        if (!Array.isArray(parsed[key])) {
            errors.push('"' + key + '" must be a list, not ' + typeof parsed[key] + ".");
        }
    });

    return { ok: errors.length === 0, errors: errors };
}

/* Adds the imported project to `db` (a plain {projects: [...]} object
   — the caller loads and saves it) as a NEW project: a fresh id, so
   importing can never overwrite an existing project by id, and — if a
   project of the same name already exists — a clear "(imported N)"
   suffix on the name rather than a silent merge or overwrite. Assumes
   `parsed` has already passed validateImport. Returns the new project. */
function importProject(parsed, db) {
    db.projects = db.projects || [];
    const existingNames = new Set(db.projects.map(p => p.name));

    let name = parsed.name;
    if (existingNames.has(name)) {
        let n = 2;
        while (existingNames.has(parsed.name + " (imported " + n + ")")) n++;
        name = parsed.name + " (imported " + n + ")";
    }

    const project = Object.assign({}, parsed, {
        id: uid("PRJ"),
        name: name,
        bq: parsed.bq || [],
        vos: parsed.vos || [],
        documents: parsed.documents || []
    });

    db.projects.push(project);
    return project;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseBqPaste, renderProjectCard, exportProject, validateImport, importProject };
}

/* ---------- browser wiring ---------- */

if (typeof document !== "undefined") {
    (function () {
        const session = requireSession();
        if (!session) return;

        const isConsultant = session.role === "consultant";

        /* State for an uploaded BQ file awaiting confirmation. Nothing
           from it enters the project until `confirmed` is true — see
           renderBqPreview() and the "Confirm" button it wires up. */
        let bqFileState = null;

        /* First non-empty sample value in a column, for the mapping
           dropdown labels — read-only display, always escaped. */
        function bqColumnSample(rows, col) {
            for (let i = 0; i < rows.length; i++) {
                const v = rows[i][col];
                if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
            }
            return "";
        }

        /* Renders (or clears) the BQ import confirmation panel from
           `bqFileState`, re-deriving items/skipped from the CURRENT
           mapping every time — including after the user corrects a
           column dropdown, so the preview always reflects reality. */
        function renderBqPreview() {
            const host = document.getElementById("bqPreview");
            if (!bqFileState) { host.hidden = true; host.innerHTML = ""; return; }

            const result = extractItems(bqFileState.rows, bqFileState.mapping);
            bqFileState.items = result.items;
            bqFileState.skipped = result.skipped;

            const maxCols = bqFileState.rows.reduce((m, r) => Math.max(m, r.length), 0);

            function roleField(role, label) {
                let opts = '<option value="">— none —</option>';
                for (let c = 0; c < maxCols; c++) {
                    const sample = bqColumnSample(bqFileState.rows, c);
                    const selected = bqFileState.mapping[role] === c ? " selected" : "";
                    opts += '<option value="' + c + '"' + selected + '>Column ' + (c + 1) +
                        (sample ? " (" + escapeHtml(sample.slice(0, 24)) + ")" : "") + "</option>";
                }
                return '<div class="field"><label>' + escapeHtml(label) + '</label>' +
                    '<select class="bq-map-select" data-role="' + role + '">' + opts + "</select></div>";
            }

            const skipCounts = {};
            bqFileState.skipped.forEach(s => { skipCounts[s.reason] = (skipCounts[s.reason] || 0) + 1; });
            const skipReasonKeys = Object.keys(skipCounts);
            const skipSummary = skipReasonKeys.length === 0
                ? "No rows skipped."
                : skipReasonKeys.map(reason => skipCounts[reason] + " row(s): " + escapeHtml(reason)).join("; ");

            const previewRows = bqFileState.items.slice(0, 8).map(it =>
                "<tr><td>" + escapeHtml(it.code || "—") + "</td><td>" + escapeHtml(it.description) +
                "</td><td>" + escapeHtml(it.unit || "—") + "</td><td>" + rm(it.rate) + "</td></tr>"
            ).join("");

            host.hidden = false;
            host.innerHTML =
                '<div class="bq-preview-header">' +
                    "Detected columns for <strong>" + escapeHtml(bqFileState.fileName) + "</strong> — confidence " +
                    '<span class="bq-confidence ' + (bqFileState.confidence === "high" ? "ok" : "warn") + '">' +
                    escapeHtml(bqFileState.confidence) + "</span>" +
                    (bqFileState.confirmed ? '<span class="bq-confidence ok">confirmed</span>' : "") +
                "</div>" +
                '<ul class="bq-reasons">' +
                    bqFileState.reasons.map(r => "<li>" + escapeHtml(r) + "</li>").join("") +
                "</ul>" +
                '<div class="bq-map-grid">' +
                    roleField("code", "Code column") +
                    roleField("description", "Description column") +
                    roleField("unit", "Unit column") +
                    roleField("rate", "Rate column") +
                "</div>" +
                '<p class="hint">' + bqFileState.items.length + " item(s) will be imported. " + skipSummary + "</p>" +
                '<div class="bq-preview-table-wrap"><table class="bq-preview-table">' +
                    "<thead><tr><th>Code</th><th>Description</th><th>Unit</th><th>Rate</th></tr></thead>" +
                    "<tbody>" + (previewRows || '<tr><td colspan="4">No items detected with this mapping.</td></tr>') +
                    "</tbody></table></div>" +
                (bqFileState.items.length > 8
                    ? '<p class="hint">Showing the first 8 of ' + bqFileState.items.length + " item(s).</p>" : "") +
                '<div class="bq-preview-actions">' +
                    '<button type="button" class="primary-button" id="bqConfirmBtn"' +
                        (bqFileState.items.length === 0 ? " disabled" : "") + ">" +
                        "Confirm and use these " + bqFileState.items.length + " item(s)</button>" +
                    '<button type="button" class="secondary-button" id="bqCancelBtn">Cancel import</button>' +
                "</div>";

            host.querySelectorAll(".bq-map-select").forEach(sel => {
                sel.addEventListener("change", () => {
                    const role = sel.dataset.role;
                    const val = sel.value === "" ? null : Number(sel.value);
                    bqFileState.mapping = Object.assign({}, bqFileState.mapping, { [role]: val });
                    bqFileState.confirmed = false;
                    renderBqPreview();
                });
            });

            document.getElementById("bqConfirmBtn").addEventListener("click", () => {
                bqFileState.confirmed = true;
                toast("BQ file confirmed — " + bqFileState.items.length + " item(s) ready to import.");
                renderBqPreview();
            });

            document.getElementById("bqCancelBtn").addEventListener("click", () => {
                bqFileState = null;
                document.getElementById("pBqFile").value = "";
                renderBqPreview();
            });
        }

        function refresh() {
            const db = loadDB();
            const list = document.getElementById("projectList");

            list.innerHTML = db.projects.length === 0
                ? '<div class="empty-state">No projects yet. ' +
                  (isConsultant ? "Create one below to get started."
                                : "Ask the Consultant QS to create the project first.") +
                  "</div>"
                : db.projects.map(p => renderProjectCard(p, session)).join("");

            list.querySelectorAll(".project-card").forEach(card => {
                card.querySelector(".open-project").addEventListener("click", () => {
                    setSession(Object.assign({}, getSession(),
                        { projectId: card.dataset.project }));
                    window.location.href = "dashboard.html";
                });

                card.querySelector(".export-project").addEventListener("click", () => {
                    const project = db.projects.find(p => p.id === card.dataset.project);
                    if (!project) return;
                    downloadProjectJson(exportProject(project));
                    toast("Project exported.");
                });
            });
        }

        /* Builds a Blob + object URL (no library) and triggers a
           download named after the project and today's date. The URL
           is revoked immediately after, once the download has started. */
        function downloadProjectJson(exported) {
            const slug = String(exported.name || "project")
                .trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
            const filename = slug + "-" + today() + ".json";

            const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        /* Stage 2 — only the consultant may create a project. */
        const createBox = document.getElementById("createBox");
        if (!isConsultant) {
            createBox.innerHTML =
                '<div class="empty-state">Only the Consultant QS creates projects and ' +
                "uploads the contract and BQ. Choose an existing project above.</div>";
        } else {
            document.getElementById("createBtn").addEventListener("click", () => {
                const name = document.getElementById("pName").value.trim();
                if (!name) { toast("Give the project a name.", "warn"); return; }

                if (bqFileState && !bqFileState.confirmed) {
                    toast("Confirm the uploaded BQ file's column mapping first, or cancel the import.", "warn");
                    return;
                }

                const project = createProject({
                    name: name,
                    client: document.getElementById("pClient").value.trim(),
                    contractNo: document.getElementById("pContractNo").value.trim(),
                    contractSum: document.getElementById("pSum").value
                }, session);

                const bqRows = parseBqPaste(document.getElementById("pBq").value);
                const fileItems = (bqFileState && bqFileState.confirmed) ? bqFileState.items : [];
                const allBqRows = bqRows.concat(fileItems);
                if (allBqRows.length > 0) {
                    updateProject(project.id, p => {
                        allBqRows.forEach(r => p.bq.push(Object.assign({ id: uid("BQ") }, r)));
                    });
                }

                const contractName = document.getElementById("pContractFile").value.trim();
                if (contractName) {
                    updateProject(project.id, p => {
                        p.documents.push({
                            id: uid("DOC"), name: contractName, size: 0,
                            category: "contract", uploadedBy: session.name,
                            role: session.role, at: new Date().toISOString()
                        });
                    });
                }

                if (bqFileState && bqFileState.confirmed) {
                    updateProject(project.id, p => {
                        p.documents.push({
                            id: uid("DOC"), name: bqFileState.fileName, size: bqFileState.fileSize,
                            category: "bq", uploadedBy: session.name,
                            role: session.role, at: new Date().toISOString()
                        });
                    });
                }

                toast("Project created with " + allBqRows.length + " BQ item(s).");
                ["pName", "pClient", "pContractNo", "pSum", "pBq", "pContractFile"]
                    .forEach(id => { document.getElementById(id).value = ""; });
                document.getElementById("pBqFile").value = "";
                bqFileState = null;
                renderBqPreview();
                refresh();
            });

            /* BQ file upload — reads the file's actual contents (unlike
               the metadata-only document fields), detects columns, and
               ALWAYS routes through the confirmation panel above; it
               never enters the project on its own. */
            const bqFileInput = document.getElementById("pBqFile");
            bqFileInput.addEventListener("change", () => {
                const file = (bqFileInput.files || [])[0];
                if (!file) return;
                const lower = file.name.toLowerCase();

                function useRows(rows) {
                    const detection = detectColumns(rows);
                    bqFileState = {
                        fileName: file.name,
                        fileSize: file.size,
                        rows: rows,
                        mapping: {
                            code: detection.code, description: detection.description,
                            unit: detection.unit, rate: detection.rate
                        },
                        confidence: detection.confidence,
                        reasons: detection.reasons,
                        confirmed: false,
                        items: [],
                        skipped: []
                    };
                    renderBqPreview();
                }

                if (lower.endsWith(".csv")) {
                    const reader = new FileReader();
                    reader.onload = () => { useRows(parseCsv(String(reader.result || ""))); };
                    reader.onerror = () => {
                        toast("Could not read that file.", "error");
                        bqFileInput.value = "";
                    };
                    reader.readAsText(file);
                } else if (lower.endsWith(".xlsx")) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        parseXlsx(reader.result).then(useRows).catch(err => {
                            toast("Could not read that .xlsx file — " + err.message, "error");
                            bqFileState = null;
                            bqFileInput.value = "";
                            renderBqPreview();
                        });
                    };
                    reader.onerror = () => {
                        toast("Could not read that file.", "error");
                        bqFileInput.value = "";
                    };
                    reader.readAsArrayBuffer(file);
                } else {
                    toast("Only .csv and .xlsx files are supported for the BQ upload.", "error");
                    bqFileInput.value = "";
                }
            });
        }

        document.getElementById("resetBtn").addEventListener("click", () => {
            resetDB();
            toast("Demo data restored.");
            refresh();
        });

        /* Import — reads a .json file exported from this app (or another
           teammate's browser), validates its shape, and adds it to THIS
           browser's local database as a new, separately-named project.
           This is a one-off copy, never a live sync. */
        const importInput = document.getElementById("importFileInput");
        if (importInput) {
            importInput.addEventListener("change", () => {
                const file = (importInput.files || [])[0];
                importInput.value = "";
                if (!file) return;

                const reader = new FileReader();
                reader.onload = () => {
                    let parsed;
                    try {
                        parsed = JSON.parse(String(reader.result || ""));
                    } catch (e) {
                        toast("That file is not valid JSON.", "error");
                        return;
                    }
                    const result = validateImport(parsed);
                    if (!result.ok) {
                        toast("Import failed — " + result.errors.join(" "), "error");
                        return;
                    }
                    const db = loadDB();
                    const project = importProject(parsed, db);
                    saveDB(db);
                    toast('Imported "' + project.name + '" as a copy in this browser.');
                    refresh();
                };
                reader.onerror = () => {
                    toast("Could not read that file.", "error");
                };
                reader.readAsText(file);
            });
        }

        refresh();
    })();
}
