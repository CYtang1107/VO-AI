/* VO-AI | page-vo.js — one variation order, three role panels. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, lineTotal } = require("./calc.js");
    var { canEdit, lockReason } = require("./permissions.js");
    var { checkRate, analyse } = require("./analysis.js");
    var { answer, suggestions } = require("./assistant.js");
    var { escapeHtml, statusPill } = require("./ui.js");
    var { deadlinesFor, INFO_RESPONSE_DAYS } = require("./deadlines.js");
    var { currentVersion, versionCount, addVersion } = require("./documents.js");
    var { t } = require("./i18n.js");
}

/* An <option> VALUE is always the raw English data value (evaluateStatus,
   certifiedStatus, typeOfInstruction are stored and compared as these
   exact strings — never renamed, per the constraint). Only the text a
   user reads is translated, via "status.<value>" / "instructionType.<value>". */
function optionDisplayText(value) {
    const statusText = t("status." + value, {});
    if (statusText !== "status." + value) return statusText;
    const instrText = t("instructionType." + value, {});
    if (instrText !== "instructionType." + value) return instrText;
    return value;
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
                  escapeHtml(optionDisplayText(spec.value)) + "</option>"
                : "") +
            options.map(o =>
                '<option value="' + escapeHtml(o) + '"' +
                (String(o) === String(spec.value) ? " selected" : "") + ">" +
                escapeHtml(optionDisplayText(o)) + "</option>").join("") +
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
function renderDocRevisions(d) {
    const revisions = d.revisions || [];
    if (revisions.length === 0) return "";
    /* Most recent prior version first. */
    return '<ul class="doc-revisions">' + revisions.slice().reverse().map(r =>
        '<li class="doc-revision"><span class="file-name">' + escapeHtml(r.name) + "</span>" +
            '<span class="file-date">' + escapeHtml(prettyDate(r.at)) + " · " +
            escapeHtml(r.uploadedBy) + "</span></li>"
    ).join("") + "</ul>";
}

function renderDocList(vo, fieldName, label, role) {
    const editable = canEdit(fieldName, vo, role);
    const reason = editable ? "" : lockReason(fieldName, vo, role);
    const docs = vo[fieldName] || [];

    const list = docs.length === 0
        ? '<div class="empty-state">' + escapeHtml(t("vo.docList.empty")) + '</div>'
        : '<ul class="doc-list">' + docs.map(d => {
            const vCount = versionCount(d);
            return '<li class="file-item" data-doc-id="' + escapeHtml(d.id) + '">' +
                '<div class="doc-current">' +
                    '<span class="file-name">' + escapeHtml(d.name) + "</span>" +
                    '<span class="file-date">' + escapeHtml(prettyDate(d.at)) + " · " +
                        escapeHtml(d.uploadedBy) + "</span>" +
                    (vCount > 1
                        ? '<span class="doc-version-count">' + escapeHtml(t("documents.versionsOnRecord", { n: vCount })) + "</span>"
                        : "") +
                    (editable
                        ? '<label class="doc-version-upload">' + escapeHtml(t("vo.docList.uploadNewVersion")) +
                          '<input type="file" class="doc-version-picker" data-field="' +
                          escapeHtml(fieldName) + '" data-doc-id="' + escapeHtml(d.id) +
                          '" hidden></label>' +
                          '<button type="button" class="file-remove" data-field="' +
                          escapeHtml(fieldName) + '" data-doc-id="' + escapeHtml(d.id) +
                          '">' + escapeHtml(t("vo.docList.remove")) + '</button>'
                        : "") +
                "</div>" +
                renderDocRevisions(d) +
            "</li>";
        }).join("") + "</ul>";

    const picker = editable
        ? '<input type="file" multiple class="doc-picker" data-field="' +
          escapeHtml(fieldName) + '">' +
          '<span class="hint">' + escapeHtml(t("vo.docList.hint")) + "</span>"
        : "";

    return '<div class="field doc-field ' + (editable ? "owned" : "locked") + '">' +
        "<label>" + escapeHtml(label) + "</label>" +
        list +
        picker +
        (reason ? '<span class="lock-note">🔒 ' + escapeHtml(reason) + "</span>" : "") +
    "</div>";
}

function bqOptions(project, selectedId) {
    const opts = ['<option value="">' + escapeHtml(t("vo.measurement.bqNone")) + '</option>'];
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
               escapeHtml(t("vo.measurement.empty")) + "</td></tr>";
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
                '<span class="rate-flag auto-match">' + escapeHtml(t("vo.measurement.suggestedMatch")) + '</span> ' +
                escapeHtml(check.matchedItem.code + " · " + check.matchedItem.description) +
                '<div class="rate-detail">' + escapeHtml(check.matchBasis) + "</div>" +
                (conEdit
                    ? '<button type="button" class="accept-match-btn" data-row="' + i +
                      '" data-bq-id="' + escapeHtml(check.matchedItem.id) + '">' + escapeHtml(t("vo.measurement.acceptMatch")) + '</button>'
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

/* Same checklist as js/page-analysis.js's renderElementsBlock — the
   detected element(s) and the other elements that commonly need
   re-measurement alongside them, each with the reason. A prompt to
   confirm, never an assertion. */
function renderElementsBlock(a) {
    const els = a.elements;
    if (!els || els.detected.length === 0) return "";

    const detectedHtml = els.detected.map(el =>
        '<span class="element-tag">' + escapeHtml(t("element." + el.id + ".name")) + "</span>").join(" ");

    const relatedHtml = els.related.length === 0 ? "" :
        els.related.map(r =>
            '<div class="finding element-check"><label><input type="checkbox"> ' +
            '<span class="element-tag element-tag-related">' + escapeHtml(t("element." + r.element.id + ".name")) +
            "</span> — " + escapeHtml(t("element." + r.because + ".note")) + "</label></div>").join("");

    return '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.detectedElements")) + '</span>' +
        '<span class="result-value">' + detectedHtml + "</span></div>" +
        (els.related.length === 0 ? "" :
            '<p class="rate-detail" style="margin-top:10px"><strong>' + escapeHtml(t("vo.result.confirmRelated")) +
            "</strong></p>" + relatedHtml);
}

function renderAssessmentPanel(vo, project, role) {
    const a = analyse(vo, project);

    /* a.clause.title/entitlement/evidence are the clause's own English
       text — see js/i18n.js's clause.note for why that is never
       translated; the note itself is. */
    const clauseBlock = a.clause
        ? '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.governingClause")) + '</span>' +
          '<span class="result-value">' + escapeHtml(a.clause.form + " " + a.clause.ref) +
          "</span></div>" +
          '<p class="rate-detail"><strong>' + escapeHtml(a.clause.title) + "</strong><br>" +
          escapeHtml(a.clause.entitlement) + "</p>" +
          '<p class="rate-detail"><strong>' + escapeHtml(t("clause.evidenceRequired")) + '</strong> ' +
          escapeHtml(a.clause.evidence) + "</p>" +
          '<p class="rate-detail clause-note">' + escapeHtml(t("clause.note")) + "</p>"
        : '<p class="rate-detail">' + escapeHtml(t("vo.result.noClause")) + "</p>";

    return '' +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.classification")) + '</span>' +
            '<span class="result-value">' + escapeHtml(a.classification.label) + "</span></div>" +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.affectedWork")) + '</span>' +
            '<span class="result-value">' + escapeHtml(a.classification.affectedWork) + "</span></div>" +
        renderElementsBlock(a) +
        clauseBlock +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.contractorClaimed")) + '</span>' +
            '<span class="result-value">' + rm(a.contractorTotal) + "</span></div>" +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.consultantAssessed")) + '</span>' +
            '<span class="result-value">' + rm(a.assessedTotal) + "</span></div>" +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.variance")) + '</span>' +
            '<span class="result-value">' + rm(a.variance) + "</span></div>" +
        "<h4 style=\"font-size:12px;margin:18px 0 10px\">" + escapeHtml(t("vo.result.findings")) + "</h4>" +
        (a.findings.length === 0
            ? '<div class="empty-state">' + escapeHtml(t("vo.result.nothingToFlag")) + '</div>'
            : a.findings.map(f => '<div class="finding"><span>' + escapeHtml(f) +
                                  "</span></div>").join(""));
}

/* -----------------------------------------------------------
   Assistant panel — a structured helper, not a chat bubble. Suggested
   questions are the primary interaction; typed input is matched against
   the same fixed set of intents by keyword. See js/assistant.js: this
   file only renders and wires up what that pure module returns.
----------------------------------------------------------- */

function renderAssistantSuggestions(context) {
    const list = suggestions(context);
    if (list.length === 0) {
        return '<div class="empty-state">' + escapeHtml(t("assistant.noQuestionsVo")) + '</div>';
    }
    return list.map(s =>
        '<button type="button" class="assistant-suggestion-btn" data-question="' +
        escapeHtml(s.id) + '">' + escapeHtml(s.label) + "</button>").join("");
}

function renderAssistantAnswer(result) {
    if (!result) {
        return '<div class="empty-state">' + escapeHtml(t("assistant.answerEmptyVo")) + '</div>';
    }
    const lines = result.lines.map(l =>
        '<div class="finding"><span>' + escapeHtml(l) + "</span></div>").join("");
    return '<div class="' + (result.unmatched ? "assistant-unmatched" : "") + '">' +
        '<p class="assistant-answer-title">' + escapeHtml(result.title) + "</p>" +
        lines +
    "</div>";
}

function renderAssistantPanel(context) {
    return '' +
        '<p class="assistant-note">' + escapeHtml(t("assistant.note")) + "</p>" +
        '<div class="assistant-suggestions" id="assistantSuggestions">' +
        renderAssistantSuggestions(context) + "</div>" +
        '<div class="assistant-ask-row">' +
        '<input type="text" id="assistantInput" placeholder="' + escapeHtml(t("assistant.placeholder")) + '">' +
        '<button type="button" class="secondary-button" id="assistantAskBtn">' + escapeHtml(t("assistant.ask")) + '</button>' +
        "</div>" +
        '<div id="assistantAnswer">' + renderAssistantAnswer(null) + "</div>";
}

/* -----------------------------------------------------------
   Contractual time bars — three clocks computed by js/deadlines.js.
   Shown to every role (everyone can see the position); the "record a
   request" control below is consultant-only and drives the second and
   third clocks. d.label/d.note already come translated out of
   js/deadlines.js's t() calls — only the state flag and owner name are
   translated here. */

function renderDeadlinesPanel(vo, todayIso) {
    const items = deadlinesFor(vo, todayIso);
    return '<div class="deadline-list">' + items.map(d => {
        const daysText = d.daysRemaining === null ? ""
            : d.daysRemaining < 0
                ? t("deadline.daysOverdue", { n: Math.abs(d.daysRemaining) })
                : t("deadline.daysRemaining", { n: d.daysRemaining });
        return '<div class="deadline-item deadline-' + d.state + '">' +
            '<div class="deadline-head">' +
                '<span class="deadline-label">' + escapeHtml(d.label) + "</span>" +
                '<span class="deadline-flag">' + escapeHtml(t("deadline.state." + d.state, {}) || d.state) + "</span>" +
            "</div>" +
            '<div class="deadline-detail">' +
                escapeHtml(t("deadline.ownerLabel")) + " " + escapeHtml(t("role." + d.owner + ".label", {}) || d.owner) +
                (d.dueDate ? " · " + escapeHtml(t("deadline.dueLabel")) + " " + escapeHtml(prettyDate(d.dueDate)) : "") +
                (daysText ? " · " + escapeHtml(daysText) : "") +
            "</div>" +
            (d.note ? '<div class="deadline-note">' + escapeHtml(d.note) + "</div>" : "") +
        "</div>";
    }).join("") + "</div>";
}

/* The consultant-only control that starts the contractor's response
   clock. A dedicated button rather than a raw date field — the date is
   always "today", never backdated or postdated by hand. */
function renderInfoRequestControl(vo, role) {
    const fieldLabel = t("vo.field.infoRequestedAt");
    if (vo.infoRequestedAt) {
        return '<div class="field locked"><label>' + escapeHtml(fieldLabel) + '</label>' +
            '<span class="hint">' + escapeHtml(t("vo.infoRequest.requested", { date: prettyDate(vo.infoRequestedAt) })) +
            (vo.infoRequestNote ? " " + escapeHtml(vo.infoRequestNote) : "") + "</span></div>";
    }

    const editable = canEdit("infoRequestedAt", vo, role);
    if (!editable) {
        return '<div class="field locked"><label>' + escapeHtml(fieldLabel) + '</label>' +
            '<span class="lock-note">🔒 ' + escapeHtml(lockReason("infoRequestedAt", vo, role)) + "</span></div>";
    }

    return '<div class="field owned"><label>' + escapeHtml(fieldLabel) + '</label>' +
        '<input type="text" id="infoRequestNoteInput" placeholder="' + escapeHtml(t("vo.infoRequest.placeholder")) + '">' +
        '<button type="button" class="secondary-button" id="recordInfoRequestBtn">' +
        escapeHtml(t("vo.infoRequest.button")) + '</button>' +
        '<span class="hint">' + escapeHtml(t("vo.infoRequest.hint", { days: INFO_RESPONSE_DAYS })) + "</span></div>";
}

/* history.action is stored as a plain English sentence (js/store.js's
   logHistory, called from here and elsewhere) — never rewritten in
   place, so an entry written in English stays exactly as written
   (seed data included). This maps the FIXED action sentences this app
   generates back to a translation key, with the dynamic parts (file
   names, field names) extracted and passed through as params: file
   names are user data and are never translated; field names are
   translated via FIELD_LABEL_KEY. Anything that does not match a known
   pattern (a legacy or hand-edited entry) falls back to the original
   English text — never blank, never a raw key. */
var FIELD_LABEL_KEY = {
    description: "vo.field.description", dateIssued: "vo.field.dateIssued",
    typeOfInstruction: "vo.field.typeOfInstruction", instructionNo: "vo.field.instructionNo",
    contractorRemark: "vo.field.contractorRemark",
    revisedDrawing: "documents.field.revisedDrawing", oldDrawing: "documents.field.oldDrawing",
    supportingDocs: "documents.field.supportingDocs",
    dueDate: "vo.field.dueDate", assessmentNote: "vo.field.assessmentNote",
    timeImpact: "vo.field.timeImpact", evaluateStatus: "vo.field.evaluateStatus",
    consultantRemark: "vo.field.consultantRemark", certifiedStatus: "vo.field.certifiedStatus",
    finalPrice: "vo.field.finalPrice", clientRemark: "vo.field.clientRemark",
    measurement: "vo.field.measurement", infoRequestedAt: "vo.field.infoRequestedAt"
};

function fieldLabel(name) {
    const key = FIELD_LABEL_KEY[name];
    return key ? t(key) : name;
}

function translateHistoryAction(action) {
    const a = String(action === null || action === undefined ? "" : action);
    let m;
    if (a === "VO created") return t("history.voCreated");
    if (a === "Submitted to consultant") return t("history.submitted");
    if (a === "Created from AI Analysis") return t("history.createdFromAnalysis");
    if (a === "Requested further information") return t("history.infoRequested");
    if ((m = a.match(/^Requested further information: (.+)$/))) {
        return t("history.infoRequestedWithNote", { note: m[1] });
    }
    if ((m = a.match(/^Accepted suggested BQ match for row (\d+)$/))) {
        return t("history.acceptedMatch", { n: m[1] });
    }
    if ((m = a.match(/^Uploaded new version of (.+) \(now (.+)\) in (.+)$/))) {
        return t("history.uploadedVersion", { old: m[1], new: m[2], field: fieldLabel(m[3]) });
    }
    if ((m = a.match(/^Attached (.+) to (.+)$/))) {
        return t("history.attached", { file: m[1], field: fieldLabel(m[2]) });
    }
    if ((m = a.match(/^Removed (.+) from (.+) \((\d+) versions\)$/))) {
        return t("history.removedDocVersions", { file: m[1], field: fieldLabel(m[2]), n: m[3] });
    }
    if ((m = a.match(/^Removed (.+) from (.+)$/))) {
        return t("history.removedDoc", { file: m[1], field: fieldLabel(m[2]) });
    }
    if ((m = a.match(/^Updated (.+)$/))) {
        return t("history.updatedField", { field: fieldLabel(m[1]) });
    }
    return a;
}

function renderHistory(vo) {
    const h = vo.history || [];
    if (h.length === 0) return '<div class="empty-state">' + escapeHtml(t("vo.history.empty")) + '</div>';
    return h.map(e =>
        '<div class="finding"><span><strong>' + escapeHtml(e.by) + "</strong> — " +
        escapeHtml(translateHistoryAction(e.action)) + "<br><small style=\"color:#8992a3\">" +
        prettyDate(e.at) + "</small></span></div>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        field, renderDocList, renderDocRevisions, renderMeasurementRows, renderElementsBlock, renderAssessmentPanel,
        renderAssistantSuggestions, renderAssistantAnswer, renderAssistantPanel, renderHistory,
        renderDeadlinesPanel, renderInfoRequestControl
    };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", t("nav.register"), t("crumb.voDetail"));
        if (!ctx) return;
        const { session, project } = ctx;
        const role = session.role;

        const voId = new URLSearchParams(location.search).get("id");
        const vo = (project.vos || []).find(v => v.id === voId);
        if (!vo) { toast(t("vo.noLongerExists"), "error");
                   setTimeout(() => location.href = "register.html", 1200); return; }

        function draw() {
            const fresh = getProject(project.id);
            const v = fresh.vos.find(x => x.id === voId);

            document.getElementById("voTitle").textContent =
                v.no + " — " + (v.description || t("vo.untitled"));
            document.getElementById("voStatus").innerHTML =
                statusPill(v.evaluateStatus) + " " + statusPill(v.certifiedStatus);

            document.getElementById("contractorPanel").innerHTML =
                field({ field: "description", label: t("vo.field.description"),
                        type: "textarea", value: v.description, vo: v, role: role }) +
                field({ field: "dateIssued", label: t("vo.field.dateIssued"), type: "date",
                        value: v.dateIssued, vo: v, role: role }) +
                field({ field: "typeOfInstruction", label: t("vo.field.typeOfInstruction"),
                        type: "select",
                        options: ["Architect's Instruction (AI)", "Engineer's instruction (EI)"],
                        value: v.typeOfInstruction, vo: v, role: role }) +
                field({ field: "instructionNo", label: t("vo.field.instructionNo"), type: "text",
                        value: v.instructionNo, vo: v, role: role }) +
                field({ field: "contractorRemark", label: t("vo.field.contractorRemark"),
                        type: "textarea", value: v.contractorRemark, vo: v, role: role }) +
                renderDocList(v, "revisedDrawing", t("documents.field.revisedDrawing"), role) +
                renderDocList(v, "oldDrawing", t("documents.field.oldDrawing"), role) +
                renderDocList(v, "supportingDocs", t("documents.field.supportingDocs"), role);

            document.getElementById("consultantPanel").innerHTML =
                field({ field: "dueDate", label: t("vo.field.dueDate"), type: "date",
                        value: v.dueDate, vo: v, role: role }) +
                field({ field: "assessmentNote", label: t("vo.field.assessmentNote"),
                        type: "textarea", value: v.assessmentNote, vo: v, role: role }) +
                field({ field: "timeImpact", label: t("vo.field.timeImpact"), type: "number",
                        value: v.timeImpact, vo: v, role: role }) +
                field({ field: "evaluateStatus", label: t("vo.field.evaluateStatus"), type: "select",
                        options: ["Pending", "Under Review", "Approved", "Rejected"],
                        value: v.evaluateStatus, vo: v, role: role }) +
                field({ field: "consultantRemark", label: t("vo.field.consultantRemark"),
                        type: "textarea", value: v.consultantRemark, vo: v, role: role }) +
                renderInfoRequestControl(v, role);

            document.getElementById("deadlinesPanel").innerHTML =
                renderDeadlinesPanel(v, today());

            document.getElementById("clientPanel").innerHTML =
                field({ field: "certifiedStatus", label: t("vo.field.certifiedStatus"), type: "select",
                        options: ["Pending", "Approved", "Rejected"],
                        value: v.certifiedStatus, vo: v, role: role }) +
                field({ field: "finalPrice", label: t("vo.field.finalPrice"),
                        type: "number", value: v.finalPrice, vo: v, role: role,
                        hint: t("vo.field.finalPriceHint") }) +
                field({ field: "clientRemark", label: t("vo.field.clientRemark"), type: "textarea",
                        value: v.clientRemark, vo: v, role: role });

            document.getElementById("measurementBody").innerHTML =
                renderMeasurementRows(v, fresh, role);
            document.getElementById("assessmentPanel").innerHTML =
                renderAssessmentPanel(v, fresh, role);
            document.getElementById("historyPanel").innerHTML = renderHistory(v);

            document.getElementById("assistantPanel").innerHTML =
                renderAssistantPanel({ vo: v, project: fresh, role: role, session: session });

            document.getElementById("addRowBtn").style.display =
                canEdit("measurement", v, role) ? "" : "none";
            document.getElementById("submitBtn").style.display =
                (role === "contractor" && !v.submitted) ? "" : "none";
        }

        /* Persist any panel field on change. */
        document.querySelectorAll(".role-panel").forEach(panel => {
            panel.addEventListener("change", e => {
                const versionPicker = e.target.closest(".doc-version-picker");
                if (versionPicker) {
                    const fieldName = versionPicker.dataset.field;
                    const docId = versionPicker.dataset.docId;
                    const file = (versionPicker.files || [])[0];
                    if (!file) return;
                    let oldName = "";
                    let newName = "";
                    updateVO(project.id, voId, v => {
                        const doc = (v[fieldName] || []).find(d => d.id === docId);
                        if (!doc) return;
                        oldName = doc.name;
                        addVersion(doc, file, session, today());
                        newName = doc.name;
                        logHistory(v, session, "Uploaded new version of " + oldName +
                            " (now " + newName + ") in " + fieldName);
                    });
                    toast(t("toast.newVersionUploaded"));
                    draw();
                    return;
                }

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
                    toast(files.length > 1 ? t("toast.documentsAttached") : t("toast.documentAttached"));
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
                toast(t("toast.saved"));
                draw();
            });

            panel.addEventListener("click", e => {
                const btn = e.target.closest(".file-remove");
                if (!btn) return;
                const fieldName = btn.dataset.field;
                const docId = btn.dataset.docId;
                let removedName = "";
                let removedVersions = 1;
                updateVO(project.id, voId, v => {
                    const doc = (v[fieldName] || []).find(d => d.id === docId);
                    removedName = doc ? doc.name : "document";
                    removedVersions = doc ? versionCount(doc) : 1;
                    v[fieldName] = (v[fieldName] || []).filter(d => d.id !== docId);
                    logHistory(v, session, "Removed " + removedName + " from " + fieldName +
                        (removedVersions > 1 ? " (" + removedVersions + " versions)" : ""));
                });
                toast(t("toast.documentRemoved"));
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
            toast(t("toast.measurementUpdated"));
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
            toast(t("toast.suggestedMatchAccepted"));
            draw();
        });

        document.getElementById("addRowBtn").addEventListener("click", () => {
            updateVO(project.id, voId, v => {
                v.measurement.push({ id: uid("M"), bqItemId: null, description: "",
                    unit: "", qty: 0, rate: 0, assessedQty: "", assessedRate: "" });
            });
            draw();
        });

        document.getElementById("consultantPanel").addEventListener("click", e => {
            if (e.target.id !== "recordInfoRequestBtn") return;
            const noteInput = document.getElementById("infoRequestNoteInput");
            const note = noteInput ? noteInput.value : "";
            updateVO(project.id, voId, v => {
                v.infoRequestedAt = today();
                v.infoRequestNote = note;
                logHistory(v, session, "Requested further information" +
                    (note ? ": " + note : ""));
            });
            toast(t("toast.infoRequestRecorded"));
            draw();
        });

        document.getElementById("submitBtn").addEventListener("click", () => {
            updateVO(project.id, voId, v => {
                v.submitted = true;
                v.evaluateStatus = "Pending";
                logHistory(v, session, "Submitted to consultant");
            });
            toast(t("toast.submittedToConsultant"));
            draw();
        });

        document.getElementById("reportBtn").addEventListener("click", () => {
            location.href = "report.html?id=" + encodeURIComponent(voId);
        });

        /* Assistant: suggested-question clicks and typed input both route
           through the same answer() call. Delegated on the panel element
           itself (which persists across draw()'s innerHTML updates), so
           it only needs wiring once. */
        function askAssistant(question) {
            const fresh = getProject(project.id);
            const v = fresh.vos.find(x => x.id === voId);
            const result = answer(question, { vo: v, project: fresh, role: role, session: session });
            document.getElementById("assistantAnswer").innerHTML = renderAssistantAnswer(result);
        }

        document.getElementById("assistantPanel").addEventListener("click", e => {
            const btn = e.target.closest(".assistant-suggestion-btn");
            if (!btn) return;
            askAssistant(btn.dataset.question);
        });

        document.getElementById("assistantPanel").addEventListener("click", e => {
            if (e.target.id !== "assistantAskBtn") return;
            const input = document.getElementById("assistantInput");
            askAssistant(input.value);
        });

        document.getElementById("assistantPanel").addEventListener("keydown", e => {
            if (e.target.id !== "assistantInput" || e.key !== "Enter") return;
            askAssistant(e.target.value);
        });

        draw();
    })();
}
