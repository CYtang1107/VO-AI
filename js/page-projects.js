/* VO-AI | page-projects.js — Stage 2 & 3: create and choose a project. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, today, projectStats } = require("./calc.js");
    var { escapeHtml } = require("./ui.js");
    var { uid } = require("./store.js");
    var { t } = require("./i18n.js");
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

/* The passcode gate shown in place of the Open button when a project is
   locked and has not yet been unlocked in this browser tab. Static
   markup only — the browser wiring below fills in behaviour; kept here
   so renderProjectCard stays a single pure function. */
function renderPasscodeGate() {
    return '<div class="project-passcode-gate">' +
        '<div class="field"><label>' + escapeHtml(t("projects.passcode.enterLabel")) + '</label>' +
            '<input type="password" class="project-passcode-gate-input" autocomplete="current-password" ' +
                'placeholder="' + escapeHtml(t("projects.passcode.enterPlaceholder")) + '"></div>' +
        '<div class="passcode-actions">' +
            '<button type="button" class="primary-button project-passcode-gate-unlock">' +
                escapeHtml(t("projects.passcode.unlock")) + '</button>' +
        "</div>" +
    "</div>";
}

/* Only the Consultant QS may set, change or clear a project's passcode —
   this is their control over which project a device can access. Static
   idle-state markup; the manage form itself is built by the browser
   wiring below when the toggle is clicked. */
function renderPasscodeManageBlock(project) {
    const locked = !!project.passcode;
    return '<div class="project-passcode-manage">' +
        '<button type="button" class="link-button project-passcode-manage-toggle">' +
            escapeHtml(locked ? t("projects.passcode.changeOrClear") : t("projects.passcode.setBtn")) +
        "</button>" +
        '<div class="passcode-manage-panel" hidden></div>' +
    "</div>";
}

/* A team project's members (js/cloud.js), with the consultant's form to
   add someone by the email of their VO-AI account. */
function renderMembersBlock(project, session) {
    const members = project.members || [];
    const canManage = project.cloudRole === "consultant";
    const rows = members.map(m =>
        '<li class="member-row"><span class="member-name">' + escapeHtml(m.name || m.email) + "</span>" +
            '<span class="member-role">' + escapeHtml(t("role." + m.role + ".label", {})) + "</span>" +
            (canManage && m.userId !== session.userId
                ? '<button type="button" class="link-button member-remove" data-user="' + escapeHtml(m.userId) + '">' +
                    escapeHtml(t("cloud.members.remove")) + "</button>"
                : "") +
        "</li>").join("");
    return '<div class="project-members">' +
        "<h4>" + escapeHtml(t("cloud.members.title")) + "</h4>" +
        '<ul class="member-list">' + rows + "</ul>" +
        (canManage
            ? '<div class="member-add">' +
                '<input type="email" class="member-email" placeholder="' + escapeHtml(t("cloud.members.emailPlaceholder")) + '">' +
                '<select class="member-role-select">' +
                    ["contractor", "administrator", "consultant", "client"].map(r =>
                        '<option value="' + r + '">' + escapeHtml(t("role." + r + ".label", {})) + "</option>").join("") +
                "</select>" +
                '<button type="button" class="secondary-button member-add-btn">' + escapeHtml(t("cloud.members.add")) + "</button>" +
              "</div>"
            : "") +
    "</div>";
}

function renderProjectCard(project, session) {
    const s = projectStats(project);
    const team = !!session.cloud;
    const locked = !team && !!project.passcode;
    const isConsultant = !team && session.role === "consultant";
    const role = (team && project.cloudRole) || session.role;
    return '' +
        '<div class="card project-card" data-project="' + escapeHtml(project.id) + '">' +
          '<div class="card-body">' +
            "<h3>" + escapeHtml(project.name) +
                (locked ? ' <span class="passcode-badge" title="' + escapeHtml(t("projects.passcode.badgeTitle")) + '">&#128274;</span>' : "") +
            "</h3>" +
            '<p class="lead" style="font-size:11px;margin:6px 0 14px">' +
                escapeHtml(project.client || "—") + " · " + escapeHtml(t("sidebar.contract", { no: project.contractNo || "—" })) + "</p>" +
            '<div class="project-meta">' +
                "<div><small>" + escapeHtml(t("projects.card.vos")) + "</small><strong>" + s.total + "</strong></div>" +
                "<div><small>" + escapeHtml(t("status.Pending")) + "</small><strong>" + s.pending + "</strong></div>" +
                "<div><small>" + escapeHtml(t("projects.card.voValue")) + "</small><strong>" + rm(s.value) + "</strong></div>" +
                "<div><small>" + escapeHtml(t("projects.card.bqItems")) + "</small><strong>" + (project.bq || []).length + "</strong></div>" +
            "</div>" +
            '<div class="project-passcode-gate-slot"></div>' +
            '<button class="primary-button open-project" style="width:100%;margin-top:16px">' +
                escapeHtml(t("projects.openAs", { role: t("role." + role + ".label", {}) })) +
            "</button>" +
            '<button type="button" class="secondary-button export-project" ' +
                'style="width:100%;margin-top:8px">' + escapeHtml(t("projects.exportBtn")) + '</button>' +
            (isConsultant ? renderPasscodeManageBlock(project) : "") +
            (team ? renderMembersBlock(project, session) : "") +
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
   a malformed or hostile file gets a clear, itemised reason instead.
   Deliberately kept in English: these are technical, machine-shape
   diagnostics about a raw imported JSON file (a power-user recovery
   path), tested with exact string equality (test/page-projects.test.js),
   and the toast that surfaces them (toast.importFailed) already carries
   a translated prefix — see the browser wiring below. */
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

/* The BQ arithmetic check (checkArithmetic in bqimport.js) as the
   import preview shows it: each figure that does not add up, named by
   its code and description, or one line saying everything did. */
function renderBqCheck(check) {
    if (!check || !check.available) {
        return '<p class="hint">' + escapeHtml(t("projects.bq.check.notAvailable")) + "</p>";
    }
    const issues = check.rowIssues.length + check.totalIssues.length;
    if (issues === 0) {
        return '<p class="bq-check ok">' + escapeHtml(t("projects.bq.check.ok",
            { rows: check.rowsChecked, totals: check.totalsChecked })) + "</p>";
    }
    const name = it => escapeHtml(it.code ? it.code + " " + it.description : it.description);
    const lines = check.rowIssues.map(it => t("projects.bq.check.row", {
        item: name(it), qty: escapeHtml(String(it.qty)), rate: rm(it.rate),
        expected: rm(it.expected), amount: rm(it.amount), diff: rm(Math.abs(it.amount - it.expected))
    })).concat(check.totalIssues.map(it => t("projects.bq.check.total", {
        item: name(it), stated: rm(it.stated), computed: rm(it.computed),
        diff: rm(Math.abs(it.stated - it.computed))
    })));
    return '<div class="bq-check warn">' +
        "<p><strong>" + escapeHtml(t("projects.bq.check.issues", { n: issues })) + "</strong></p>" +
        "<ul>" + lines.map(l => "<li>" + l + "</li>").join("") + "</ul>" +
        "<p>" + escapeHtml(t("projects.bq.check.summary",
            { rows: check.rowsChecked, totals: check.totalsChecked })) + "</p>" +
        "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderBqCheck, parseBqPaste, renderProjectCard, renderMembersBlock, exportProject, validateImport, importProject };
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
            const check = checkArithmetic(bqFileState.rows, bqFileState.mapping);

            const maxCols = bqFileState.rows.reduce((m, r) => Math.max(m, r.length), 0);

            function roleField(role, label) {
                let opts = '<option value="">' + escapeHtml(t("projects.bq.noneOption")) + '</option>';
                for (let c = 0; c < maxCols; c++) {
                    const sample = bqColumnSample(bqFileState.rows, c);
                    const selected = bqFileState.mapping[role] === c ? " selected" : "";
                    opts += '<option value="' + c + '"' + selected + '>' + escapeHtml(t("projects.bq.column", { n: c + 1 })) +
                        (sample ? " (" + escapeHtml(sample.slice(0, 24)) + ")" : "") + "</option>";
                }
                return '<div class="field"><label>' + escapeHtml(label) + '</label>' +
                    '<select class="bq-map-select" data-role="' + role + '">' + opts + "</select></div>";
            }

            const skipCounts = {};
            bqFileState.skipped.forEach(s => { skipCounts[s.reason] = (skipCounts[s.reason] || 0) + 1; });
            const skipReasonKeys = Object.keys(skipCounts);
            const skipSummary = skipReasonKeys.length === 0
                ? t("projects.bq.noRowsSkipped")
                : skipReasonKeys.map(reason => t("projects.bq.skippedSummary", { n: skipCounts[reason], reason: escapeHtml(reason) })).join("; ");

            const previewRows = bqFileState.items.slice(0, 8).map(it =>
                "<tr><td>" + escapeHtml(it.code || "—") + "</td><td>" + escapeHtml(it.description) +
                "</td><td>" + escapeHtml(it.unit || "—") + "</td><td>" + rm(it.rate) + "</td></tr>"
            ).join("");

            const confidenceLabel = bqFileState.confidence === "high"
                ? t("projects.bq.confidenceHigh") : t("projects.bq.confidenceNeedsReview");

            host.hidden = false;
            host.innerHTML =
                '<div class="bq-preview-header">' +
                    t("projects.bq.detectedFor", {
                        file: "<strong>" + escapeHtml(bqFileState.fileName) + "</strong>",
                        confidence: '<span class="bq-confidence ' + (bqFileState.confidence === "high" ? "ok" : "warn") + '">' +
                            escapeHtml(confidenceLabel) + "</span>"
                    }) +
                    (bqFileState.confirmed ? '<span class="bq-confidence ok">' + escapeHtml(t("projects.bq.confirmed")) + '</span>' : "") +
                "</div>" +
                '<ul class="bq-reasons">' +
                    bqFileState.reasons.map(r => "<li>" + escapeHtml(r) + "</li>").join("") +
                "</ul>" +
                '<div class="bq-map-grid">' +
                    roleField("code", t("projects.bq.codeColumn")) +
                    roleField("description", t("projects.bq.descColumn")) +
                    roleField("unit", t("projects.bq.unitColumn")) +
                    roleField("rate", t("projects.bq.rateColumn")) +
                    roleField("qty", t("projects.bq.qtyColumn")) +
                    roleField("amount", t("projects.bq.amountColumn")) +
                "</div>" +
                '<p class="hint">' + t("projects.bq.itemsWillImport", { n: bqFileState.items.length, summary: skipSummary }) + "</p>" +
                renderBqCheck(check) +
                '<div class="bq-preview-table-wrap"><table class="bq-preview-table">' +
                    "<thead><tr><th>" + escapeHtml(t("projects.bq.col.code")) + "</th><th>" + escapeHtml(t("projects.bq.col.description")) +
                    "</th><th>" + escapeHtml(t("projects.bq.col.unit")) + "</th><th>" + escapeHtml(t("projects.bq.col.rate")) + "</th></tr></thead>" +
                    "<tbody>" + (previewRows || '<tr><td colspan="4">' + escapeHtml(t("projects.bq.noItemsDetected")) + '</td></tr>') +
                    "</tbody></table></div>" +
                (bqFileState.items.length > 8
                    ? '<p class="hint">' + escapeHtml(t("projects.bq.showingFirst8", { n: bqFileState.items.length })) + "</p>" : "") +
                '<div class="bq-preview-actions">' +
                    '<button type="button" class="primary-button" id="bqConfirmBtn"' +
                        (bqFileState.items.length === 0 ? " disabled" : "") + ">" +
                        escapeHtml(t("projects.bq.confirmUse", { n: bqFileState.items.length })) + "</button>" +
                    '<button type="button" class="secondary-button" id="bqCancelBtn">' + escapeHtml(t("projects.bq.cancelImport")) + '</button>' +
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
                toast(t("toast.bqConfirmed", { n: bqFileState.items.length }));
                renderBqPreview();
            });

            document.getElementById("bqCancelBtn").addEventListener("click", () => {
                bqFileState = null;
                document.getElementById("pBqFile").value = "";
                renderBqPreview();
            });
        }

/* Navigates into the project — the only place opening happens, so this
   is the one gate a passcode gets checked at. */
        function openProject(projectId) {
            /* A team member opens a project as their role there. */
            const opened = loadDB().projects.find(p => p.id === projectId);
            const role = (getSession().cloud && opened && opened.cloudRole) || getSession().role;
            setSession(Object.assign({}, getSession(), { projectId: projectId, role: role }));
            window.location.href = "dashboard.html";
        }

        /* Shows the passcode entry form in place of the Open button on a
           locked, not-yet-unlocked card. Correct passcode marks the
           project unlocked for this browser tab and opens it; a wrong
           one is refused via toast and never opens the project. */
        function showPasscodeGate(card, project) {
            const slot = card.querySelector(".project-passcode-gate-slot");
            const openBtn = card.querySelector(".open-project");
            slot.innerHTML = renderPasscodeGate();
            openBtn.hidden = true;

            const input = slot.querySelector(".project-passcode-gate-input");
            const unlockBtn = slot.querySelector(".project-passcode-gate-unlock");

            async function attemptUnlock() {
                const ok = await verifyProjectPasscode(project, input.value);
                if (!ok) {
                    toast(t("toast.wrongProjectPasscode"), "error");
                    input.value = "";
                    input.focus();
                    return;
                }
                markProjectUnlocked(project.id);
                openProject(project.id);
            }

            unlockBtn.addEventListener("click", attemptUnlock);
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") attemptUnlock();
            });
        }

        /* Renders (or clears) the Consultant QS's set/change/clear
           passcode panel for one project card. `mode`: "idle" | "set" |
           "manage" (locked — change or clear). */
        function renderPasscodeManagePanel(card, project, mode) {
            const panel = card.querySelector(".passcode-manage-panel");
            const toggle = card.querySelector(".project-passcode-manage-toggle");
            if (!panel) return;

            if (mode === "idle") {
                panel.hidden = true;
                panel.innerHTML = "";
                if (toggle) toggle.hidden = false;
                return;
            }
            if (toggle) toggle.hidden = true;
            panel.hidden = false;

            if (!passcodeSupported()) {
                panel.innerHTML = '<p class="passcode-note">' + escapeHtml(t("projects.passcode.unavailable")) + "</p>" +
                    '<button type="button" class="link-button pc-cancel">' + escapeHtml(t("projects.passcode.cancel")) + "</button>";
                panel.querySelector(".pc-cancel").addEventListener("click", () => renderPasscodeManagePanel(card, project, "idle"));
                return;
            }

            if (mode === "set") {
                panel.innerHTML =
                    '<div class="field"><label>' + escapeHtml(t("projects.passcode.newLabel")) + '</label>' +
                        '<input type="password" class="pc-new" autocomplete="new-password"></div>' +
                    '<div class="field"><label>' + escapeHtml(t("projects.passcode.confirmLabel")) + '</label>' +
                        '<input type="password" class="pc-confirm" autocomplete="new-password"></div>' +
                    '<div class="passcode-actions">' +
                        '<button type="button" class="primary-button pc-save">' + escapeHtml(t("projects.passcode.save")) + "</button>" +
                        '<button type="button" class="link-button pc-cancel">' + escapeHtml(t("projects.passcode.cancel")) + "</button>" +
                    "</div>" +
                    '<p class="passcode-note">' + escapeHtml(t("projects.passcode.honesty")) + "</p>";

                panel.querySelector(".pc-save").addEventListener("click", async () => {
                    const a = panel.querySelector(".pc-new").value;
                    const b = panel.querySelector(".pc-confirm").value;
                    if (!a) { toast(t("toast.enterPasscode"), "warn"); return; }
                    if (a !== b) { toast(t("toast.passcodesMismatch"), "warn"); return; }
                    const ok = await setProjectPasscode(project.id, a);
                    if (!ok) { toast(t("toast.passcodeUnavailable"), "warn"); return; }
                    toast(t("toast.passcodeSet"), "ok");
                    refresh();
                });
                panel.querySelector(".pc-cancel").addEventListener("click", () => renderPasscodeManagePanel(card, project, "idle"));
                return;
            }

            /* mode === "manage": locked already — requires the current
               passcode before changing OR clearing it. */
            panel.innerHTML =
                '<div class="field"><label>' + escapeHtml(t("projects.passcode.currentLabel")) + '</label>' +
                    '<input type="password" class="pc-current" autocomplete="current-password"></div>' +
                '<div class="field"><label>' + escapeHtml(t("projects.passcode.newLabel")) + '</label>' +
                    '<input type="password" class="pc-new" autocomplete="new-password"></div>' +
                '<div class="field"><label>' + escapeHtml(t("projects.passcode.confirmLabel")) + '</label>' +
                    '<input type="password" class="pc-confirm" autocomplete="new-password"></div>' +
                '<p class="hint">' + escapeHtml(t("projects.passcode.leaveBlankHint")) + "</p>" +
                '<div class="passcode-actions">' +
                    '<button type="button" class="primary-button pc-save-change">' + escapeHtml(t("projects.passcode.saveChange")) + "</button>" +
                    '<button type="button" class="secondary-button pc-clear">' + escapeHtml(t("projects.passcode.clear")) + "</button>" +
                    '<button type="button" class="link-button pc-cancel">' + escapeHtml(t("projects.passcode.cancel")) + "</button>" +
                "</div>" +
                '<p class="passcode-note">' + escapeHtml(t("projects.passcode.honesty")) + "</p>";

            panel.querySelector(".pc-save-change").addEventListener("click", async () => {
                const current = panel.querySelector(".pc-current").value;
                const a = panel.querySelector(".pc-new").value;
                const b = panel.querySelector(".pc-confirm").value;
                const ok = await verifyProjectPasscode(project, current);
                if (!ok) { toast(t("toast.passcodeWrong"), "error"); return; }
                if (!a) { toast(t("toast.enterPasscode"), "warn"); return; }
                if (a !== b) { toast(t("toast.passcodesMismatch"), "warn"); return; }
                const saved = await setProjectPasscode(project.id, a);
                if (!saved) { toast(t("toast.passcodeUnavailable"), "warn"); return; }
                toast(t("toast.passcodeSet"), "ok");
                refresh();
            });
            panel.querySelector(".pc-clear").addEventListener("click", async () => {
                const current = panel.querySelector(".pc-current").value;
                const ok = await verifyProjectPasscode(project, current);
                if (!ok) { toast(t("toast.passcodeWrong"), "error"); return; }
                clearProjectPasscode(project.id);
                toast(t("toast.passcodeCleared"), "ok");
                refresh();
            });
            panel.querySelector(".pc-cancel").addEventListener("click", () => renderPasscodeManagePanel(card, project, "idle"));
        }

        function refresh() {
            const db = loadDB();
            const list = document.getElementById("projectList");

            list.innerHTML = db.projects.length === 0
                ? '<div class="empty-state">' + t("projects.empty", {
                    sub: escapeHtml(isConsultant ? t("projects.emptyConsultant") : t("projects.emptyOther"))
                  }) +
                  "</div>"
                : db.projects.map(p => renderProjectCard(p, session)).join("");

            list.querySelectorAll(".project-card").forEach(card => {
                const project = db.projects.find(p => p.id === card.dataset.project);
                if (!project) return;

                card.querySelector(".open-project").addEventListener("click", () => {
                    if (!session.cloud && project.passcode && !isProjectUnlocked(project.id)) {
                        showPasscodeGate(card, project);
                        return;
                    }
                    openProject(project.id);
                });

                card.querySelector(".export-project").addEventListener("click", () => {
                    downloadProjectJson(exportProject(project));
                    toast(t("toast.projectExported"));
                });

                const addBtn = card.querySelector(".member-add-btn");
                if (addBtn) {
                    addBtn.addEventListener("click", async () => {
                        const email = card.querySelector(".member-email").value.trim();
                        const role = card.querySelector(".member-role-select").value;
                        if (!email) { toast(t("cloud.members.enterEmail"), "warn"); return; }
                        addBtn.disabled = true;
                        try {
                            const result = await Cloud.addMember(project.id, email, role);
                            if (result === "no-account") toast(t("cloud.members.noAccount", { email: email }), "warn");
                            else { toast(t("cloud.members.added", { email: email })); refresh(); }
                        } catch (e) {
                            toast(e.message || String(e), "error");
                        }
                        addBtn.disabled = false;
                    });
                }
                card.querySelectorAll(".member-remove").forEach(btn => {
                    btn.addEventListener("click", async () => {
                        try { await Cloud.removeMember(project.id, btn.dataset.user); refresh(); }
                        catch (e) { toast(e.message || String(e), "error"); }
                    });
                });

                const manageToggle = card.querySelector(".project-passcode-manage-toggle");
                if (manageToggle) {
                    manageToggle.addEventListener("click", () => {
                        renderPasscodeManagePanel(card, project, project.passcode ? "manage" : "set");
                    });
                }
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
            /* A new team account belongs to no project until a consultant
               adds it: say so, with the address to give them. */
            const waiting = session.cloud && loadDB().projects.length === 0;
            createBox.innerHTML = '<div class="empty-state">' + escapeHtml(waiting
                ? t("projects.waitForInvite", { email: session.email || "" })
                : t("projects.consultantOnly")) + '</div>';
        } else {
            /* with projects already, the form waits behind "+ New project" */
            const newBtn = document.getElementById("newProjectBtn");
            if (newBtn && loadDB().projects.length > 0) {
                createBox.hidden = true;
                newBtn.hidden = false;
                newBtn.addEventListener("click", () => {
                    createBox.hidden = !createBox.hidden;
                    if (!createBox.hidden) createBox.scrollIntoView({ behavior: "smooth", block: "start" });
                });
            }
            document.getElementById("createBtn").addEventListener("click", async () => {
                const name = document.getElementById("pName").value.trim();
                if (!name) { toast(t("toast.giveProjectName"), "warn"); return; }

                if (bqFileState && !bqFileState.confirmed) {
                    toast(t("toast.confirmBqFileFirst"), "warn");
                    return;
                }

                const newPasscode = document.getElementById("pPasscode").value;
                const newPasscodeConfirm = document.getElementById("pPasscodeConfirm").value;
                if (newPasscode && newPasscode !== newPasscodeConfirm) {
                    toast(t("toast.passcodesMismatch"), "warn");
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

                if (newPasscode) {
                    const ok = await setProjectPasscode(project.id, newPasscode);
                    if (!ok) toast(t("toast.passcodeUnavailable"), "warn");
                }

                toast(t("toast.projectCreated", { n: allBqRows.length }));
                ["pName", "pClient", "pContractNo", "pSum", "pBq", "pContractFile", "pPasscode", "pPasscodeConfirm"]
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

                function useRows(rows, ocr) {
                    const detection = detectColumns(rows);
                    /* a BQ read by OCR (js/bqocr.js): its columns are known,
                       and it always needs the consultant's review */
                    if (ocr) {
                        Object.assign(detection, BQ_OCR_MAPPING, { confidence: "needsReview",
                            reasons: [t("bqocr.reason", { pages: ocr.pages, rows: rows.length - 1 })].concat(
                                ocr.failed.length ? [t("bqocr.failedPages", { pages: ocr.failed.join(", ") })] : []) });
                    }
                    bqFileState = {
                        fileName: file.name,
                        fileSize: file.size,
                        rows: rows,
                        mapping: {
                            code: detection.code, description: detection.description,
                            unit: detection.unit, rate: detection.rate,
                            qty: detection.qty, amount: detection.amount
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
                        toast(t("toast.couldNotReadFile"), "error");
                        bqFileInput.value = "";
                    };
                    reader.readAsText(file);
                } else if (lower.endsWith(".xlsx")) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        parseXlsx(reader.result).then(useRows).catch(err => {
                            toast(t("toast.couldNotReadXlsx", { msg: err.message }), "error");
                            bqFileState = null;
                            bqFileInput.value = "";
                            renderBqPreview();
                        });
                    };
                    reader.onerror = () => {
                        toast(t("toast.couldNotReadFile"), "error");
                        bqFileInput.value = "";
                    };
                    reader.readAsArrayBuffer(file);
                } else if (typeof isOcrBqFile === "function" && isOcrBqFile(lower)) {
                    if (!bqOcrAvailable()) { toast(t("bqocr.unavailable"), "error"); bqFileInput.value = ""; return; }
                    const note = document.getElementById("bqOcrProgress");
                    note.hidden = false;
                    bqFileInput.disabled = true;
                    readBqFile(file, text => { note.textContent = text; })
                        .then(res => {
                            if (!res.rows.length) throw new Error(t("bqocr.nothing", { pages: res.pages }));
                            useRows(ocrRowsToSheet(res.rows), res);
                            note.hidden = true;
                        })
                        .catch(err => {
                            note.textContent = t("bqocr.failed", { reason: err.message || String(err) });
                            bqFileState = null;
                            bqFileInput.value = "";
                            renderBqPreview();
                        })
                        .then(() => { bqFileInput.disabled = false; });
                } else {
                    toast(t("toast.onlyCsvXlsx"), "error");
                    bqFileInput.value = "";
                }
            });
        }

        /* The team's shared register has no demo data to restore. */
        if (session.cloud) document.getElementById("resetBtn").hidden = true;
        document.getElementById("resetBtn").addEventListener("click", () => {
            resetDB();
            toast(t("toast.demoDataRestored"));
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
                        toast(t("toast.importNotJson"), "error");
                        return;
                    }
                    const result = validateImport(parsed);
                    if (!result.ok) {
                        toast(t("toast.importFailed", { reasons: result.errors.join(" ") }), "error");
                        return;
                    }
                    const db = loadDB();
                    const project = importProject(parsed, db);
                    saveDB(db);
                    toast(t("toast.importedAs", { name: project.name }));
                    refresh();
                };
                reader.onerror = () => {
                    toast(t("toast.couldNotReadFile"), "error");
                };
                reader.readAsText(file);
            });
        }

        refresh();
    })();
}
