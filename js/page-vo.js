/* VO-AI | page-vo.js — one variation order, three role panels. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, lineTotal } = require("./calc.js");
    var { canEdit, lockReason } = require("./permissions.js");
    var { checkRate, analyse } = require("./analysis.js");
    var { escapeHtml, statusPill } = require("./ui.js");
}

/* One labelled control. Editable => .owned (yellow). Locked => .locked + reason. */
function field(spec) {
    const editable = canEdit(spec.field, spec.vo, spec.role);
    const reason = editable ? "" : lockReason(spec.field, spec.vo, spec.role);
    const dis = editable ? "" : " disabled";
    const val = escapeHtml(spec.value === null || spec.value === undefined ? "" : spec.value);

    let control;
    if (spec.type === "select") {
        const options = spec.options || [];
        const currentMissing = spec.value && !options.includes(spec.value);
        control = '<select data-field="' + spec.field + '"' + dis + ">" +
            (currentMissing
                ? '<option value="' + escapeHtml(spec.value) + '" selected disabled>' +
                  escapeHtml(spec.value) + "</option>"
                : "") +
            options.map(o =>
                '<option value="' + escapeHtml(o) + '"' +
                (String(o) === String(spec.value) ? " selected" : "") + ">" +
                escapeHtml(o) + "</option>").join("") +
            "</select>";
    } else if (spec.type === "textarea") {
        control = '<textarea data-field="' + spec.field + '"' + dis + ">" + val + "</textarea>";
    } else {
        control = '<input type="' + (spec.type || "text") + '" data-field="' +
            spec.field + '" value="' + val + '"' + dis + ">";
    }

    return '<div class="field ' + (editable ? "owned" : "locked") + '">' +
        "<label>" + escapeHtml(spec.label) + "</label>" +
        control +
        (spec.hint ? '<span class="hint">' + escapeHtml(spec.hint) + "</span>" : "") +
        (reason ? '<span class="lock-note">🔒 ' + escapeHtml(reason) + "</span>" : "") +
    "</div>";
}

/* A document-control block: the attached files (name + date added) for one
   contractor-owned document field, plus a file picker when the field is
   editable for the signed-in role. Records file METADATA only — never the
   file body. */
function renderDocList(vo, fieldName, label, role) {
    const editable = canEdit(fieldName, vo, role);
    const reason = editable ? "" : lockReason(fieldName, vo, role);
    const docs = vo[fieldName] || [];

    const list = docs.length === 0
        ? '<div class="empty-state">No documents attached.</div>'
        : '<ul class="doc-list">' + docs.map(d =>
            '<li class="file-item" data-doc-id="' + escapeHtml(d.id) + '">' +
                '<span class="file-name">' + escapeHtml(d.name) + "</span>" +
                '<span class="file-date">' + escapeHtml(prettyDate(d.at)) + "</span>" +
                (editable
                    ? '<button type="button" class="file-remove" data-field="' +
                      escapeHtml(fieldName) + '" data-doc-id="' + escapeHtml(d.id) +
                      '">Remove</button>'
                    : "") +
            "</li>").join("") + "</ul>";

    const picker = editable
        ? '<input type="file" multiple class="doc-picker" data-field="' +
          escapeHtml(fieldName) + '">' +
          '<span class="hint">This prototype records the document\'s name and size ' +
          "for the register — it does not store or analyse the file's contents.</span>"
        : "";

    return '<div class="field doc-field ' + (editable ? "owned" : "locked") + '">' +
        "<label>" + escapeHtml(label) + "</label>" +
        list +
        picker +
        (reason ? '<span class="lock-note">🔒 ' + escapeHtml(reason) + "</span>" : "") +
    "</div>";
}

function bqOptions(project, selectedId) {
    const opts = ['<option value="">— no comparable BQ item (star rate) —</option>'];
    (project.bq || []).forEach(b => {
        opts.push('<option value="' + escapeHtml(b.id) + '"' +
            (b.id === selectedId ? " selected" : "") + ">" +
            escapeHtml(b.code + " · " + b.description + " · " + rm(b.rate) + "/" + b.unit) +
            "</option>");
    });
    return opts.join("");
}

function renderMeasurementRows(vo, project, role) {
    const rows = vo.measurement || [];
    if (rows.length === 0) {
        return '<tr><td colspan="8" class="empty-state">' +
               "No measurement entered yet.</td></tr>";
    }

    const conEdit = canEdit("measurement", vo, role);
    const conDis = conEdit ? "" : " disabled";
    const assEdit = canEdit("assessment", vo, role);
    const assDis = assEdit ? "" : " disabled";

    return rows.map((row, i) => {
        const check = checkRate(row, project.bq || []);
        const claimed = lineTotal(row.qty, row.rate);

        /* An auto-match is a SUGGESTION, not a decision — shown visually
           distinct (.rate-flag.auto-match, .rate-suggestion) from a
           user-confirmed match, with an explicit Accept control that
           routes through updateVO + logHistory like any other edit.
           Never rendered when the row is already linked, and the accept
           control only appears when the signed-in role may edit the
           measurement. */
        const autoBlock = check.autoMatched
            ? '<div class="rate-suggestion">' +
                '<span class="rate-flag auto-match">Suggested match</span> ' +
                escapeHtml(check.matchedItem.code + " · " + check.matchedItem.description) +
                '<div class="rate-detail">' + escapeHtml(check.matchBasis) + "</div>" +
                (conEdit
                    ? '<button type="button" class="accept-match-btn" data-row="' + i +
                      '" data-bq-id="' + escapeHtml(check.matchedItem.id) + '">Accept suggested match</button>'
                    : "") +
              "</div>"
            : "";

        return '<tr data-row="' + i + '">' +
            '<td><input data-col="description" value="' + escapeHtml(row.description) +
                '"' + conDis + (conEdit ? ' class="owned"' : "") + ' style="width:220px"></td>' +
            '<td><select data-col="bqItemId"' + conDis + (conEdit ? ' class="owned"' : "") +
                ">" + bqOptions(project, row.bqItemId) + "</select></td>" +
            '<td><input data-col="unit" value="' + escapeHtml(row.unit) + '"' + conDis +
                (conEdit ? ' class="owned"' : "") + ' style="width:60px"></td>' +
            '<td><input type="number" data-col="qty" value="' + escapeHtml(row.qty) + '"' +
                conDis + (conEdit ? ' class="owned"' : "") + ' style="width:80px"></td>' +
            '<td><input type="number" data-col="rate" value="' + escapeHtml(row.rate) + '"' +
                conDis + (conEdit ? ' class="owned"' : "") + ' style="width:90px"></td>' +
            "<td><strong>" + rm(claimed) + "</strong></td>" +
            '<td><input type="number" data-col="assessedQty" value="' +
                escapeHtml(row.assessedQty) + '"' + assDis +
                (assEdit ? ' class="owned"' : "") + ' style="width:80px">' +
             '<input type="number" data-col="assessedRate" value="' +
                escapeHtml(row.assessedRate) + '"' + assDis +
                (assEdit ? ' class="owned"' : "") + ' style="width:90px;margin-top:5px"></td>' +
            '<td><span class="rate-flag ' + check.state + '">' + check.label + "</span>" +
                '<div class="rate-detail">' + escapeHtml(check.detail) + "</div>" +
                autoBlock + "</td>" +
        "</tr>";
    }).join("");
}

function renderAssessmentPanel(vo, project, role) {
    const a = analyse(vo, project);

    const clauseBlock = a.clause
        ? '<div class="result-row"><span class="result-label">Governing clause</span>' +
          '<span class="result-value">' + escapeHtml(a.clause.form + " " + a.clause.ref) +
          "</span></div>" +
          '<p class="rate-detail"><strong>' + escapeHtml(a.clause.title) + "</strong><br>" +
          escapeHtml(a.clause.entitlement) + "</p>" +
          '<p class="rate-detail"><strong>Evidence required:</strong> ' +
          escapeHtml(a.clause.evidence) + "</p>"
        : '<p class="rate-detail">No governing clause identified — the description is ' +
          "too vague to classify. Add detail and re-open this VO.</p>";

    return '' +
        '<div class="result-row"><span class="result-label">Classification</span>' +
            '<span class="result-value">' + escapeHtml(a.classification.label) + "</span></div>" +
        '<div class="result-row"><span class="result-label">Affected work</span>' +
            '<span class="result-value">' + escapeHtml(a.classification.affectedWork) + "</span></div>" +
        clauseBlock +
        '<div class="result-row"><span class="result-label">Contractor claimed</span>' +
            '<span class="result-value">' + rm(a.contractorTotal) + "</span></div>" +
        '<div class="result-row"><span class="result-label">Consultant assessed</span>' +
            '<span class="result-value">' + rm(a.assessedTotal) + "</span></div>" +
        '<div class="result-row"><span class="result-label">Variance</span>' +
            '<span class="result-value">' + rm(a.variance) + "</span></div>" +
        "<h4 style=\"font-size:12px;margin:18px 0 10px\">Findings</h4>" +
        (a.findings.length === 0
            ? '<div class="empty-state">Nothing to flag.</div>'
            : a.findings.map(f => '<div class="finding"><span>' + escapeHtml(f) +
                                  "</span></div>").join(""));
}

function renderHistory(vo) {
    const h = vo.history || [];
    if (h.length === 0) return '<div class="empty-state">No activity recorded.</div>';
    return h.map(e =>
        '<div class="finding"><span><strong>' + escapeHtml(e.by) + "</strong> — " +
        escapeHtml(e.action) + "<br><small style=\"color:#8992a3\">" +
        prettyDate(e.at) + "</small></span></div>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { field, renderDocList, renderMeasurementRows, renderAssessmentPanel, renderHistory };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", "Variation Order", "VO-AI / VO Register / Detail");
        if (!ctx) return;
        const { session, project } = ctx;
        const role = session.role;

        const voId = new URLSearchParams(location.search).get("id");
        const vo = (project.vos || []).find(v => v.id === voId);
        if (!vo) { toast("That variation order no longer exists.", "error");
                   setTimeout(() => location.href = "register.html", 1200); return; }

        function draw() {
            const fresh = getProject(project.id);
            const v = fresh.vos.find(x => x.id === voId);

            document.getElementById("voTitle").textContent =
                v.no + " — " + (v.description || "Untitled variation");
            document.getElementById("voStatus").innerHTML =
                statusPill(v.evaluateStatus) + " " + statusPill(v.certifiedStatus);

            document.getElementById("contractorPanel").innerHTML =
                field({ field: "description", label: "Description of the change",
                        type: "textarea", value: v.description, vo: v, role: role }) +
                field({ field: "dateIssued", label: "Date VO issued", type: "date",
                        value: v.dateIssued, vo: v, role: role }) +
                field({ field: "typeOfInstruction", label: "Type of instruction",
                        type: "select",
                        options: ["Architect's Instruction (AI)", "Engineer's instruction (EI)"],
                        value: v.typeOfInstruction, vo: v, role: role }) +
                field({ field: "instructionNo", label: "Instruction no.", type: "text",
                        value: v.instructionNo, vo: v, role: role }) +
                field({ field: "contractorRemark", label: "Contractor's remark",
                        type: "textarea", value: v.contractorRemark, vo: v, role: role }) +
                renderDocList(v, "revisedDrawing", "Revised drawing", role) +
                renderDocList(v, "oldDrawing", "Old drawing", role) +
                renderDocList(v, "supportingDocs", "Supporting documents", role);

            document.getElementById("consultantPanel").innerHTML =
                field({ field: "dueDate", label: "VO due date", type: "date",
                        value: v.dueDate, vo: v, role: role }) +
                field({ field: "assessmentNote", label: "Consultant's assessment",
                        type: "textarea", value: v.assessmentNote, vo: v, role: role }) +
                field({ field: "timeImpact", label: "Time impact (days)", type: "number",
                        value: v.timeImpact, vo: v, role: role }) +
                field({ field: "evaluateStatus", label: "Evaluate status", type: "select",
                        options: ["Pending", "Under Review", "Approved", "Rejected"],
                        value: v.evaluateStatus, vo: v, role: role }) +
                field({ field: "consultantRemark", label: "Consultant's remark",
                        type: "textarea", value: v.consultantRemark, vo: v, role: role });

            document.getElementById("clientPanel").innerHTML =
                field({ field: "certifiedStatus", label: "Certified status", type: "select",
                        options: ["Pending", "Approved", "Rejected"],
                        value: v.certifiedStatus, vo: v, role: role }) +
                field({ field: "finalPrice", label: "Final certified price (RM)",
                        type: "number", value: v.finalPrice, vo: v, role: role,
                        hint: "Leave blank to certify at the consultant's assessed value." }) +
                field({ field: "clientRemark", label: "Client's remark", type: "textarea",
                        value: v.clientRemark, vo: v, role: role });

            document.getElementById("measurementBody").innerHTML =
                renderMeasurementRows(v, fresh, role);
            document.getElementById("assessmentPanel").innerHTML =
                renderAssessmentPanel(v, fresh, role);
            document.getElementById("historyPanel").innerHTML = renderHistory(v);

            document.getElementById("addRowBtn").style.display =
                canEdit("measurement", v, role) ? "" : "none";
            document.getElementById("submitBtn").style.display =
                (role === "contractor" && !v.submitted) ? "" : "none";
        }

        /* Persist any panel field on change. */
        document.querySelectorAll(".role-panel").forEach(panel => {
            panel.addEventListener("change", e => {
                const picker = e.target.closest(".doc-picker");
                if (picker) {
                    const fieldName = picker.dataset.field;
                    const files = Array.from(picker.files || []);
                    if (files.length === 0) return;
                    updateVO(project.id, voId, v => {
                        v[fieldName] = v[fieldName] || [];
                        files.forEach(f => {
                            v[fieldName].push({
                                id: uid("DOC"), name: f.name, size: f.size,
                                uploadedBy: session.name, at: today()
                            });
                            logHistory(v, session, "Attached " + f.name + " to " + fieldName);
                        });
                    });
                    toast(files.length > 1 ? "Documents attached." : "Document attached.");
                    draw();
                    return;
                }

                const el = e.target.closest("[data-field]");
                if (!el || el.disabled) return;
                const name = el.dataset.field;
                updateVO(project.id, voId, v => {
                    v[name] = el.type === "number"
                        ? (el.value === "" ? (name === "finalPrice" ? null : 0) : Number(el.value))
                        : el.value;
                    logHistory(v, session, "Updated " + name);
                });
                toast("Saved.");
                draw();
            });

            panel.addEventListener("click", e => {
                const btn = e.target.closest(".file-remove");
                if (!btn) return;
                const fieldName = btn.dataset.field;
                const docId = btn.dataset.docId;
                let removedName = "";
                updateVO(project.id, voId, v => {
                    const doc = (v[fieldName] || []).find(d => d.id === docId);
                    removedName = doc ? doc.name : "document";
                    v[fieldName] = (v[fieldName] || []).filter(d => d.id !== docId);
                    logHistory(v, session, "Removed " + removedName + " from " + fieldName);
                });
                toast("Document removed.");
                draw();
            });
        });

        /* Measurement grid. */
        document.getElementById("measurementBody").addEventListener("change", e => {
            const el = e.target.closest("[data-col]");
            if (!el || el.disabled) return;
            const i = Number(el.closest("tr").dataset.row);
            const col = el.dataset.col;
            updateVO(project.id, voId, v => {
                const row = v.measurement[i];
                if (col === "qty" || col === "rate") row[col] = Number(el.value) || 0;
                else if (col === "assessedQty" || col === "assessedRate")
                    row[col] = el.value === "" ? "" : Number(el.value);
                else if (col === "bqItemId") row[col] = el.value || null;
                else row[col] = el.value;
            });
            toast("Measurement updated.");
            draw();
        });

        /* Accept a suggested BQ match: this is the only place an
           auto-match becomes stored data — it goes through updateVO and
           logHistory exactly like a manual dropdown pick, never a
           silent mutation. */
        document.getElementById("measurementBody").addEventListener("click", e => {
            const btn = e.target.closest(".accept-match-btn");
            if (!btn) return;
            const i = Number(btn.dataset.row);
            const bqId = btn.dataset.bqId;
            updateVO(project.id, voId, v => {
                v.measurement[i].bqItemId = bqId;
                logHistory(v, session, "Accepted suggested BQ match for row " + (i + 1));
            });
            toast("Suggested BQ match accepted.");
            draw();
        });

        document.getElementById("addRowBtn").addEventListener("click", () => {
            updateVO(project.id, voId, v => {
                v.measurement.push({ id: uid("M"), bqItemId: null, description: "",
                    unit: "", qty: 0, rate: 0, assessedQty: "", assessedRate: "" });
            });
            draw();
        });

        document.getElementById("submitBtn").addEventListener("click", () => {
            updateVO(project.id, voId, v => {
                v.submitted = true;
                v.evaluateStatus = "Pending";
                logHistory(v, session, "Submitted to consultant");
            });
            toast("Submitted to the consultant.");
            draw();
        });

        document.getElementById("reportBtn").addEventListener("click", () => {
            location.href = "report.html?id=" + encodeURIComponent(voId);
        });

        draw();
    })();
}
