/* VO-AI | page-vo.js — one variation order, three role panels. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, lineTotal } = require("./calc.js");
    var { canEdit, canDeleteVO, lockReason, fieldLabel, FIELD_OWNER } = require("./permissions.js");
    var { checkRate, analyse, matchBqItem, suggestBqForChange } = require("./analysis.js");
    var { answer, suggestions } = require("./assistant.js");
    var { escapeHtml, statusPill, fileLink, fold, seedText } = require("./ui.js");
    var { deadlinesFor, clockPeriods, daysBetween } = require("./deadlines.js");
    var { currentVersion, versionCount, addVersion } = require("./documents.js");
    var { suggestPastRate, pastRateSources, pastRateWords, MATERIAL_WORDS } = require("./ratehistory.js");
    var { renderContractBlock } = require("./contractread.js");
    var { renderContractPane } = require("./askcontract.js");
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

/* The contract administrator's panel (the Architect, Engineer or SO):
   ① confirm the instruction the contractor's claim rests on, or return
   it; ② once the consultant QS has approved the value, certify it.
   Each step names what it is checking against. */
function renderAdministratorPanel(vo, role) {
    const ref = [optionDisplayText(vo.typeOfInstruction || ""), vo.instructionNo, vo.dateIssued ? prettyDate(vo.dateIssued) : ""]
        .filter(Boolean).join(" · ");
    const status = vo.instructionStatus || (vo.submitted ? "Confirmed" : "Pending");
    const certStatus = vo.caCertifiedStatus || (vo.evaluateStatus === "Approved" ? "Certified" : "Pending");
    return panelLockNote(vo, role, "administrator") +
        '<h4 class="ca-step">' + escapeHtml(t("vo.ca.step1")) + "</h4>" +
        '<p class="ca-ref">' + escapeHtml(t("vo.ca.instructionRef", { ref: ref || t("vo.ca.noRef") })) + "</p>" +
        (vo.submitted || status !== "Returned" ? "" : '<p class="ca-note">' + escapeHtml(t("vo.ca.returnedWaiting")) + "</p>") +
        field({ field: "instructionStatus", label: t("vo.field.instructionStatus"), type: "select",
                options: ["Pending", "Confirmed", "Returned"], value: status, vo: vo, role: role,
                hint: t("vo.field.instructionStatusHint") }) +
        field({ field: "instructionNote", label: t("vo.field.instructionNote"), type: "textarea",
                value: seedText(vo.instructionNote), vo: vo, role: role }) +
        '<h4 class="ca-step">' + escapeHtml(t("vo.ca.step2")) + "</h4>" +
        '<p class="ca-ref">' + escapeHtml(vo.evaluateStatus === "Approved"
            ? t("vo.ca.assessedValue", { amount: rm(assessedTotal(vo)) })
            : t("vo.ca.waitingForQs")) + "</p>" +
        field({ field: "caCertifiedStatus", label: t("vo.field.caCertifiedStatus"), type: "select",
                options: ["Pending", "Certified"], value: certStatus, vo: vo, role: role }) +
        field({ field: "caRemark", label: t("vo.field.caRemark"), type: "textarea",
                value: seedText(vo.caRemark), vo: vo, role: role });
}

/* Why the signed-in role's own panel is locked at this stage (e.g.
   "waiting for the consultant's approval"), said once at the top of
   that panel rather than under every field. Another role's panel gets
   no note: its heading already says whose columns they are. */
function panelLockNote(vo, role, panelRole) {
    if (role !== panelRole) return "";
    const own = Object.keys(FIELD_OWNER).filter(f => FIELD_OWNER[f] === role);
    if (own.length === 0 || own.some(f => canEdit(f, vo, role))) return "";
    return '<div class="panel-lock-note">🔒 ' + escapeHtml(lockReason(own[0], vo, role)) + "</div>";
}

/* One labelled control. Editable => .owned (yellow). Locked => .locked
   (the reason, if it is the role's own panel, is panelLockNote()'s). */
function field(spec) {
    const editable = canEdit(spec.field, spec.vo, spec.role);
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
        '<li class="doc-revision">' + fileLink(r) +
            '<span class="file-date">' + escapeHtml(prettyDate(r.at)) + " · " +
            escapeHtml(r.uploadedBy) + "</span></li>"
    ).join("") + "</ul>";
}

function renderDocList(vo, fieldName, label, role, intro) {
    const editable = canEdit(fieldName, vo, role);
    const docs = vo[fieldName] || [];

    const list = docs.length === 0
        ? '<div class="empty-state">' + escapeHtml(t("vo.docList.empty")) + '</div>'
        : '<ul class="doc-list">' + docs.map(d => {
            const vCount = versionCount(d);
            return '<li class="file-item" data-doc-id="' + escapeHtml(d.id) + '">' +
                '<div class="doc-current">' +
                    fileLink(d) +
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
        (intro ? '<span class="hint doc-intro">' + escapeHtml(intro) + "</span>" : "") +
        list +
        picker +
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

/* A star-rated row (no item in this project's BQ): what past projects
   paid for the same thing, the rate they suggest, and every source.
   The consultant, when the assessment is theirs to edit, can add it to
   this project's BQ as a new item at the suggested rate or their own. */
function renderPastRates(i, suggestion, canAdd) {
    if (!suggestion) {
        return '<div class="past-rates none">' + escapeHtml(t("vo.past.none")) + "</div>";
    }
    const unit = suggestion.matches[0].unit;
    const list = suggestion.matches.map(m =>
        "<li>" + (m.code ? '<span class="item-code">' + escapeHtml(m.code) + "</span> " : "") +
            '<span class="past-src">' + escapeHtml(t("vo.past.source", { project: m.project, year: m.year || "—" })) +
            ' <span class="past-basis">' + escapeHtml(t("vo.past.basis." + m.basis)) +
            (m.sample ? " · " + escapeHtml(t("vo.past.sample")) : "") + "</span></span>" +
            '<span class="past-desc">' + escapeHtml(m.description) + "</span>" +
            "<strong>" + rm(m.rate) + "/" + escapeHtml(m.unit) + "</strong></li>"
    ).join("");
    return '<div class="past-rates">' +
        '<div class="past-rates-head"><span class="rate-flag past">' + escapeHtml(t("vo.past.title")) + "</span> " +
            escapeHtml(t("vo.past.suggest", {
                rate: rm(suggestion.rate), unit: unit, n: suggestion.count,
                low: rm(suggestion.low), high: rm(suggestion.high)
            })) + "</div>" +
        '<ul class="past-rates-list">' + list + "</ul>" +
        '<p class="past-rates-note">' + escapeHtml(t("vo.past.note")) + "</p>" +
        (canAdd
            ? '<div class="past-rates-add"><label>' + escapeHtml(t("vo.past.rateLabel")) +
                ' <input type="number" class="past-rate-input owned" data-row="' + i + '" min="0" step="any" value="' +
                suggestion.rate + '"></label>' +
                '<button type="button" class="primary-button add-bq-item-btn" data-row="' + i + '">' +
                escapeHtml(t("vo.past.addBtn")) + "</button></div>"
            : "") +
        "</div>";
}

/* A line under a row linked to a BQ item that a VO added (see
   newBqItemFromRow in js/ratehistory.js): where the item came from. */
function renderBqOrigin(item) {
    if (!item || !item.origin) return "";
    const o = item.origin;
    const n = (o.basedOn || []).length;
    return '<div class="rate-detail bq-origin">' + escapeHtml(n
        ? t("vo.past.origin", { code: item.code, vo: o.voNo, date: prettyDate(o.at), n: n, rate: rm(o.suggestedRate) })
        : t("vo.past.originNoPast", { code: item.code, vo: o.voNo, date: prettyDate(o.at) })) + "</div>";
}

/* The row's verdict in one line — the full explanation, the past
   project rates and any suggested match open under it. */
/* A measurement row whose description was just typed: link it to the
   BQ item it describes and fill what is still empty, the way the AI
   Analysis form does.
   - BQ item: the strict English matcher first, then the description
     matcher that also reads Chinese site words; a match resting on one
     word only ("Wall") is never linked, only suggested as before.
   - Unit: the BQ item's, when the row has none.
   - Rate: when the row has none, the contract BQ rate; with no BQ item,
     the median of comparable past-project rates (a star rate). A rate
     already typed is never replaced.
   Only a row not linked by hand is matched. Records what it did on
   row.auto ({code, basis, unit, rate: "bq" | "past"}) so the page can say
   so; returns true when it changed anything. */
function autoFillRow(row, bq, pastSources) {
    if (!row || !String(row.description || "").trim()) return false;
    if (row.bqItemId && !row.auto) return false;   /* linked by hand: leave it */
    /* a BQ item made of a different material is not this item: marble
       floor tiles are not the "ceramic floor tiles" item, they are a new
       (star) rate. An item that names no material ("Skirting to match
       floor finish") can still match. */
    const mine = pastRateWords(row.description).filter(w => MATERIAL_WORDS.has(w));
    const fits = it => {
        const theirs = pastRateWords(it.description).filter(w => MATERIAL_WORDS.has(w));
        return theirs.length === 0 || mine.length === 0 || mine.every(w => theirs.indexOf(w) !== -1);
    };
    const list = (bq || []).filter(fits);
    const strict = matchBqItem(Object.assign({}, row, { unit: "" }), list);
    const loose = strict ? null : suggestBqForChange(row.description, list);
    const item = strict ? strict.item : (loose && !loose.weak ? loose.item : null);
    const basis = strict ? strict.basis : (loose && !loose.weak ? loose.matched.join(", ") : "");
    const before = JSON.stringify([row.bqItemId, row.unit, row.rate, row.auto]);
    const prevAuto = row.auto || {};
    const auto = {};

    if (item) {
        row.bqItemId = item.id;
        auto.code = item.code;
        auto.basis = basis;
        if (!String(row.unit || "").trim() || prevAuto.unit) { row.unit = item.unit; auto.unit = true; }
        if (!(Number(row.rate) > 0) || prevAuto.rate) { row.rate = Number(item.rate) || 0; auto.rate = "bq"; }
    } else {
        if (prevAuto.code) row.bqItemId = null;   /* an earlier auto-link no longer fits */
        if (prevAuto.unit) row.unit = "";
        const past = typeof suggestPastRate === "function" ? suggestPastRate(row, pastSources || []) : null;
        if (past && (!(Number(row.rate) > 0) || prevAuto.rate)) {
            row.rate = past.rate;
            auto.rate = "past";
            if (!String(row.unit || "").trim()) { row.unit = past.matches[0].unit; auto.unit = true; }
        } else if (prevAuto.rate) row.rate = 0;
    }
    if (Object.keys(auto).length) row.auto = auto; else delete row.auto;
    return JSON.stringify([row.bqItemId, row.unit, row.rate, row.auto]) !== before;
}

function rowSummary(check, linkedItem, suggestion, row) {
    let text;
    if (check.state === "same") {
        text = t("vo.row.same", { code: (check.matchedItem || linkedItem || {}).code || "" });
    } else if (check.state === "different") {
        text = t("vo.row.different", {
            code: (check.matchedItem || linkedItem || {}).code || "",
            word: t(check.diff > 0 ? "rate.overstated" : "rate.understated"),
            diff: rm(Math.abs(check.diff)),
            pct: check.pct === null || check.pct === undefined ? "" : t("rate.pctNote", { pct: Math.abs(check.pct).toFixed(1) })
        });
    } else if (check.state === "unchecked" || check.state === "norate") {
        text = t("vo.row." + check.state);
    } else {
        text = suggestion
            ? t("vo.row.starPast", { rate: rm(suggestion.rate), unit: suggestion.matches[0].unit })
            : t(suggestion === null ? "vo.row.starNoPast" : "vo.row.star");
    }
    if (check.autoMatched) text += t("vo.row.suggested", { code: check.matchedItem.code });
    if (row && row.auto) {
        if (row.auto.code) text += t("vo.row.autoLinked", { code: row.auto.code });
        if (row.auto.rate) text += t(row.auto.rate === "bq" ? "vo.row.autoRateBq" : "vo.row.autoRatePast");
    }
    if (linkedItem && linkedItem.origin) text += t("vo.row.newItem");
    return text;
}

function renderMeasurementRows(vo, project, role, pastSources) {
    const rows = vo.measurement || [];
    if (rows.length === 0) {
        return '<tr><td colspan="8" class="empty-state">' +
               escapeHtml(t("vo.measurement.empty")) + "</td></tr>";
    }

    const conEdit = canEdit("measurement", vo, role);
    const conDis = conEdit ? "" : " disabled";
    const assEdit = canEdit("assessment", vo, role);
    const assDis = assEdit ? "" : " disabled";

    /* Column names on each cell: on a phone the table becomes one card
       per row and each field carries its own label (style.css). */
    const lbl = {
        description: escapeHtml(t("vo.col.description")), bqItem: escapeHtml(t("vo.col.bqItem")),
        unit: escapeHtml(t("vo.col.unit")), qty: escapeHtml(t("vo.col.qty")), rate: escapeHtml(t("vo.col.rate")),
        claimed: escapeHtml(t("vo.col.claimed")), assessed: escapeHtml(t("vo.col.assessedQtyRate")),
        check: escapeHtml(t("vo.col.rateCheck"))
    };

    return rows.map((row, i) => {
        const check = checkRate(row, project.bq || []);
        const claimed = lineTotal(row.qty, row.rate);
        const linkedItem = row.bqItemId ? (project.bq || []).find(b => b.id === row.bqItemId) : null;
        /* undefined: not looked up; null: looked up, nothing comparable */
        const suggestion = check.state === "star" && pastSources ? suggestPastRate(row, pastSources) : undefined;

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
                '<span class="item-code">' + escapeHtml(check.matchedItem.code) + "</span> · " +
                escapeHtml(check.matchedItem.description) +
                '<div class="rate-detail">' + escapeHtml(check.matchBasis) + "</div>" +
                (conEdit
                    ? '<button type="button" class="accept-match-btn" data-row="' + i +
                      '" data-bq-id="' + escapeHtml(check.matchedItem.id) + '">' + escapeHtml(t("vo.measurement.acceptMatch")) + '</button>'
                    : "") +
              "</div>"
            : "";

        return '<tr data-row="' + i + '">' +
            '<td class="m-desc" data-label="' + lbl.description + '"><input data-col="description" value="' + escapeHtml(row.description) +
                '"' + conDis + (conEdit ? ' class="owned"' : "") + ' style="width:220px"></td>' +
            '<td class="m-bq" data-label="' + lbl.bqItem + '"><select data-col="bqItemId"' + conDis + (conEdit ? ' class="owned"' : "") +
                ">" + bqOptions(project, row.bqItemId) + "</select></td>" +
            '<td data-label="' + lbl.unit + '"><input data-col="unit" value="' + escapeHtml(row.unit) + '"' + conDis +
                (conEdit ? ' class="owned"' : "") + ' style="width:60px"></td>' +
            '<td data-label="' + lbl.qty + '"><input type="number" data-col="qty" value="' + escapeHtml(row.qty) + '"' +
                conDis + (conEdit ? ' class="owned"' : "") + ' style="width:80px"></td>' +
            '<td data-label="' + lbl.rate + '"><input type="number" data-col="rate" value="' + escapeHtml(row.rate) + '"' +
                conDis + (conEdit ? ' class="owned"' : "") + ' style="width:90px"></td>' +
            '<td data-label="' + lbl.claimed + '"><strong>' + rm(claimed) + "</strong></td>" +
            '<td class="m-assessed" data-label="' + lbl.assessed + '"><input type="number" data-col="assessedQty" value="' +
                escapeHtml(row.assessedQty) + '"' + assDis +
                (assEdit ? ' class="owned"' : "") + ' style="width:80px">' +
             '<input type="number" data-col="assessedRate" value="' +
                escapeHtml(row.assessedRate) + '"' + assDis +
                (assEdit ? ' class="owned"' : "") + ' style="width:90px;margin-top:5px"></td>' +
            '<td class="m-flag" data-label="' + lbl.check + '"><span class="rate-flag ' + check.state + '">' + check.label + "</span>" +
                (conEdit ? '<button type="button" class="row-delete-btn" data-row="' + i + '" title="' + escapeHtml(t("vo.row.delete")) +
                    '" aria-label="' + escapeHtml(t("vo.row.delete")) + '">✕</button>' : "") + "</td>" +
        "</tr>" +
        /* The verdict's explanation runs the full width of the table on
           its own line under the item, instead of wrapping down a narrow
           last column and stretching every cell of the row. */
        '<tr class="rate-detail-row" data-row="' + i + '">' +
            '<td colspan="8">' + fold("row-" + (row.id || i),
                '<span class="row-verdict row-verdict-' + check.state + '">' + escapeHtml(rowSummary(check, linkedItem, suggestion, row)) + "</span>",
                '<div class="rate-detail rate-detail-' + check.state + '">' + escapeHtml(check.detail) + "</div>" + autoBlock +
                (row.auto && row.auto.code ? '<div class="rate-detail auto-fill-note">' +
                    escapeHtml(t("vo.row.autoBasis", { code: row.auto.code, basis: row.auto.basis || "" })) + "</div>" : "") +
                renderBqOrigin(linkedItem) +
                (suggestion !== undefined ? renderPastRates(i, suggestion, assEdit) : ""),
                "row-fold") +
            "</td>" +
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

/* The first three findings in full; any more open on demand. */
function renderFindings(findings) {
    if (findings.length === 0) {
        return '<div class="empty-state">' + escapeHtml(t("vo.result.nothingToFlag")) + "</div>";
    }
    const item = f => '<div class="finding"><span>' + escapeHtml(f) + "</span></div>";
    const shown = findings.slice(0, 3).map(item).join("");
    const rest = findings.slice(3);
    return shown + (rest.length
        ? fold("findings-more", escapeHtml(t("vo.result.moreFindings", { n: rest.length })), rest.map(item).join(""))
        : "");
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
          fold("std-clause", escapeHtml(t("clause.showWording", { title: a.clause.title })),
              '<p class="rate-detail"><strong>' + escapeHtml(a.clause.title) + "</strong><br>" +
              escapeHtml(a.clause.entitlement) + "</p>" +
              '<p class="rate-detail"><strong>' + escapeHtml(t("clause.evidenceRequired")) + '</strong> ' +
              escapeHtml(a.clause.evidence) + "</p>" +
              '<p class="rate-detail clause-note">' + escapeHtml(t("clause.note")) + "</p>")
        : '<p class="rate-detail">' + escapeHtml(t("vo.result.noClause")) + "</p>";

    /* This project's own contract leads when it has been read; the
       bundled standard-form clause then follows as a reference. */
    const contract = a.contract;
    const contractRead = contract && contract.state === "read";
    const contractBlock = contract
        ? '<h4 class="contract-heading">' + escapeHtml(t("contract.title")) + "</h4>" +
          renderContractBlock(contract, { fold: true }) +
          (contract.state === "read" || contract.state === "noText"
              ? '<button type="button" class="link-button contract-reread-btn">' + escapeHtml(t("contract.reread")) + "</button>"
              : "")
        : "";

    return '' +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.classification")) + '</span>' +
            '<span class="result-value">' + escapeHtml(a.classification.label) + "</span></div>" +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.affectedWork")) + '</span>' +
            '<span class="result-value">' + escapeHtml(a.classification.affectedWork) + "</span></div>" +
        renderElementsBlock(a) +
        contractBlock +
        (contractRead ? '<h4 class="contract-heading">' + escapeHtml(t("contract.standardForm")) + "</h4>" : "") +
        clauseBlock +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.contractorClaimed")) + '</span>' +
            '<span class="result-value">' + rm(a.contractorTotal) + "</span></div>" +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.consultantAssessed")) + '</span>' +
            '<span class="result-value">' + rm(a.assessedTotal) + "</span></div>" +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.variance")) + '</span>' +
            '<span class="result-value">' + rm(a.variance) + "</span></div>" +
        "<h4 style=\"font-size:12px;margin:18px 0 10px\">" + escapeHtml(t("vo.result.findings")) + "</h4>" +
        renderFindings(a.findings);
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

/* With a team account the card has two tabs: this structured helper, and
   「问合同」 (js/askcontract.js), which answers from the contract itself.
   context.contract = { tab: "vo" | "contract", state } keeps the open tab
   and the last contract answer across redraws. */
function renderAssistantPanel(context) {
    const helper = '' +
        '<p class="assistant-note">' + escapeHtml(t("assistant.note")) + "</p>" +
        '<div class="assistant-suggestions" id="assistantSuggestions">' +
        renderAssistantSuggestions(context) + "</div>" +
        '<div class="assistant-ask-row">' +
        '<input type="text" id="assistantInput" placeholder="' + escapeHtml(t("assistant.placeholder")) + '">' +
        '<button type="button" class="secondary-button" id="assistantAskBtn">' + escapeHtml(t("assistant.ask")) + '</button>' +
        "</div>" +
        '<div id="assistantAnswer">' + renderAssistantAnswer(null) + "</div>";
    if (!context.contract) return helper;
    const tab = context.contract.tab === "contract" ? "contract" : "vo";
    const tabButton = (id, label) =>
        '<button type="button" role="tab" class="ask-tab' + (tab === id ? " active" : "") + '" data-ask-tab="' + id +
        '" aria-selected="' + (tab === id) + '">' + escapeHtml(label) + "</button>";
    return '' +
        '<div class="ask-tabs" role="tablist">' + tabButton("vo", t("ask.tabVo")) + tabButton("contract", t("ask.tabContract")) + "</div>" +
        '<div data-ask-pane="vo"' + (tab === "vo" ? "" : " hidden") + ">" + helper + "</div>" +
        '<div data-ask-pane="contract"' + (tab === "contract" ? "" : " hidden") + ">" +
        renderContractPane(context.role, context.contract.state, typeof askAsGuest === "function" && askAsGuest(context.project && context.project.id)) + "</div>";
}

/* -----------------------------------------------------------
   Contractual time bars — three clocks computed by js/deadlines.js.
   Shown to every role (everyone can see the position); the "record a
   request" control below is consultant-only and drives the second and
   third clocks. d.label/d.note already come translated out of
   js/deadlines.js's t() calls — only the state flag and owner name are
   translated here. */

function renderDeadlinesPanel(vo, todayIso, project) {
    const items = deadlinesFor(vo, todayIso, project);
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
                escapeHtml(t("deadline.ownerLabel")) + escapeHtml(t("role." + d.owner + ".label", {}) || d.owner) +
                (d.dueDate ? " · " + escapeHtml(t("deadline.dueLabel")) + " " + escapeHtml(prettyDate(d.dueDate)) : "") +
                (daysText ? " · " + escapeHtml(daysText) : "") +
            "</div>" +
            (d.note ? '<div class="deadline-note">' + escapeHtml(d.note) + "</div>" : "") +
            '<div class="deadline-source' + (d.period && d.period.clause ? " from-contract" : "") + '">' +
                escapeHtml(d.period && d.period.clause
                    ? t("deadline.fromContract", { no: d.period.clause, n: d.period.days })
                    : t("deadline.defaultPeriod", { n: d.period ? d.period.days : "" })) + "</div>" +
        "</div>";
    }).join("") + "</div>";
}

/* The consultant-only control that starts the contractor's response
   clock. A dedicated button rather than a raw date field — the date is
   always "today", never backdated or postdated by hand. */
function renderInfoRequestControl(vo, role, project) {
    const fieldLabel = t("vo.field.infoRequestedAt");
    if (vo.infoRequestedAt) {
        return '<div class="field locked"><label>' + escapeHtml(fieldLabel) + '</label>' +
            '<span class="hint">' + escapeHtml(t("vo.infoRequest.requested", { date: prettyDate(vo.infoRequestedAt) })) +
            (vo.infoRequestNote ? " " + escapeHtml(vo.infoRequestNote) : "") + "</span></div>";
    }

    const editable = canEdit("infoRequestedAt", vo, role);
    if (!editable) {
        return '<div class="field locked"><label>' + escapeHtml(fieldLabel) + '</label>' +
            '<span class="hint">' + escapeHtml(t("vo.infoRequest.none")) + "</span></div>";
    }

    return '<div class="field owned"><label>' + escapeHtml(fieldLabel) + '</label>' +
        '<input type="text" id="infoRequestNoteInput" placeholder="' + escapeHtml(t("vo.infoRequest.placeholder")) + '">' +
        '<button type="button" class="secondary-button" id="recordInfoRequestBtn">' +
        escapeHtml(t("vo.infoRequest.button")) + '</button>' +
        '<span class="hint">' + escapeHtml(t("vo.infoRequest.hint", { days: clockPeriods(vo, project).response.days })) + "</span></div>";
}

/* The client-owned mirror of renderInfoRequestControl above: the client
   asking the consultant for further information. Scenario 3 of the
   proposal only gives the client approve/reject/request-further-info —
   no contractual period is stated for this direction, so (unlike the
   consultant's clock-starting control) this never touches
   js/deadlines.js. Once made, the request shows only ELAPSED time, never
   a due date, so it can never be misread as a deadline. Rendered inside
   the client panel, which every role can see (see draw() below) — that
   is how the consultant is shown the request without a second control. */
function renderClientInfoRequestControl(vo, role, todayIso) {
    const fieldLabel = t("vo.field.clientInfoRequestedAt");
    if (vo.clientInfoRequestedAt) {
        const elapsed = daysBetween(vo.clientInfoRequestedAt, todayIso);
        const elapsedText = elapsed === null || elapsed === undefined
            ? "" : t("vo.clientInfoRequest.elapsed", { n: elapsed });
        return '<div class="field locked"><label>' + escapeHtml(fieldLabel) + '</label>' +
            '<span class="hint">' + escapeHtml(t("vo.clientInfoRequest.requested", { date: prettyDate(vo.clientInfoRequestedAt) })) +
            (vo.clientInfoRequestNote ? " " + escapeHtml(vo.clientInfoRequestNote) : "") +
            (elapsedText ? " · " + escapeHtml(elapsedText) : "") +
            "</span></div>";
    }

    const editable = canEdit("clientInfoRequestedAt", vo, role);
    if (!editable) {
        return '<div class="field locked"><label>' + escapeHtml(fieldLabel) + '</label>' +
            '<span class="hint">' + escapeHtml(t("vo.infoRequest.none")) + "</span></div>";
    }

    return '<div class="field owned"><label>' + escapeHtml(fieldLabel) + '</label>' +
        '<input type="text" id="clientInfoRequestNoteInput" placeholder="' + escapeHtml(t("vo.clientInfoRequest.placeholder")) + '">' +
        '<button type="button" class="secondary-button" id="recordClientInfoRequestBtn">' +
        escapeHtml(t("vo.clientInfoRequest.button")) + '</button>' +
        '<span class="hint">' + escapeHtml(t("vo.clientInfoRequest.hint")) + "</span></div>";
}

/* history.action is stored as a plain English sentence (js/store.js's
   logHistory, called from here and elsewhere) — never rewritten in
   place, so an entry written in English stays exactly as written
   (seed data included). This maps the FIXED action sentences this app
   generates back to a translation key, with the dynamic parts (file
   names, field names) extracted and passed through as params: file
   names are user data and are never translated; field names are
   translated via fieldLabel() (js/permissions.js). Anything that does not match a known
   pattern (a legacy or hand-edited entry) falls back to the original
   English text — never blank, never a raw key. */
function translateHistoryAction(action) {
    const a = String(action === null || action === undefined ? "" : action);
    let m;
    if (a === "VO created") return t("history.voCreated");
    if (a === "Submitted to consultant") return t("history.submitted");
    if (a === "Submitted to contract administrator") return t("history.submittedToCa");
    if (a === "Contract administrator certified the assessed value") return t("history.caCertified");
    if ((m = a.match(/^Instruction confirmed — (.+)$/))) return t("history.instructionConfirmed", { ref: m[1] });
    if (a === "Instruction confirmed") return t("history.instructionConfirmedNoRef");
    if ((m = a.match(/^Instruction returned to contractor: (.+)$/))) return t("history.instructionReturnedWithNote", { note: m[1] });
    if (a === "Instruction returned to contractor") return t("history.instructionReturned");
    if (a === "Created from AI Analysis") return t("history.createdFromAnalysis");
    if (a === "Requested further information") return t("history.infoRequested");
    if ((m = a.match(/^Requested further information: (.+)$/))) {
        return t("history.infoRequestedWithNote", { note: m[1] });
    }
    if (a === "Client requested further information") return t("history.clientInfoRequested");
    if ((m = a.match(/^Client requested further information: (.+)$/))) {
        return t("history.clientInfoRequestedWithNote", { note: m[1] });
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
    if ((m = a.match(/^Assessment completed — (.+)$/))) {
        return t("history.assessed", { status: t("status." + m[1], {}) });
    }
    if ((m = a.match(/^Certified — (.+)$/))) {
        return t("history.certified", { status: t("status." + m[1], {}) });
    }
    if ((m = a.match(/^Recorded on site with (\d+) photos?$/))) {
        return t("history.recordedOnSite", { n: m[1] });
    }
    if ((m = a.match(/^Added row (\d+) to the contract BQ as new item (\S+) at RM ([\d.]+)\/(\S+?)(, based on (\d+) past project rate\(s\))?$/))) {
        return t(m[6] ? "history.addedBqItemPast" : "history.addedBqItem",
                 { row: m[1], code: m[2], rate: m[3], unit: m[4], n: m[6] || "" });
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
        field, renderDocList, renderDocRevisions, renderMeasurementRows, autoFillRow, renderPastRates, renderFindings, rowSummary, renderElementsBlock, renderAssessmentPanel,
        renderAssistantSuggestions, renderAssistantAnswer, renderAssistantPanel, renderHistory, translateHistoryAction,
        renderDeadlinesPanel, renderInfoRequestControl, renderClientInfoRequestControl, panelLockNote, renderAdministratorPanel
    };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", t("nav.register"), t("crumb.voDetail"));
        if (!ctx) return;
        const { session, project } = ctx;
        const role = session.role;
        const contractAsk = { tab: "vo", state: null };

        /* Narrow screens stack the three role panels; the signed-in
           role's own panel should come first since that is the one they
           can edit — see .role-panels[data-active-role] in style.css. */
        const panelsSection = document.getElementById("rolePanelsSection");
        if (panelsSection) panelsSection.dataset.activeRole = role;

        /* Each role sees only its own panel by default, so the page is
           just the form they fill in. The other two roles' columns are
           one click away, read-only, for checking what they entered. */
        const toggleOthers = document.getElementById("toggleOtherPanels");
        function setShowOthers(show) {
            if (!panelsSection || !toggleOthers) return;
            panelsSection.classList.toggle("show-others", show);
            toggleOthers.setAttribute("aria-expanded", show ? "true" : "false");
            toggleOthers.textContent = t(show ? "vo.panel.hideOthers" : "vo.panel.showOthers");
        }
        if (toggleOthers) {
            setShowOthers(false);
            toggleOthers.addEventListener("click", () =>
                setShowOthers(!panelsSection.classList.contains("show-others")));
        }

        const voId = new URLSearchParams(location.search).get("id");
        const vo = (project.vos || []).find(v => v.id === voId);
        if (!vo) { toast(t("vo.noLongerExists"), "error");
                   setTimeout(() => location.href = "register.html", 1200); return; }

        function draw() { keepFolds(drawNow); }

        function drawNow() {
            const fresh = getProject(project.id);
            const v = fresh.vos.find(x => x.id === voId);
            if (typeof drawPhotoCheck === "function") drawPhotoCheck();

            document.getElementById("voTitle").textContent =
                v.no + " — " + (seedText(v.description) || t("vo.untitled"));
            /* Two pills of the same kind side by side read as a duplicate —
               name each one. */
            document.getElementById("voStatus").innerHTML =
                '<span class="status-pair"><span class="status-pair-label">' +
                    escapeHtml(t("vo.field.instructionStatus")) + "</span>" +
                    statusPill(v.instructionStatus || (v.submitted ? "Confirmed" : "Pending")) + "</span>" +
                '<span class="status-pair"><span class="status-pair-label">' +
                    escapeHtml(t("vo.field.evaluateStatus")) + "</span>" + statusPill(v.evaluateStatus) + "</span>" +
                '<span class="status-pair"><span class="status-pair-label">' +
                    escapeHtml(t("vo.field.caCertifiedStatus")) + "</span>" +
                    statusPill(v.caCertifiedStatus || (v.evaluateStatus === "Approved" ? "Certified" : "Pending")) + "</span>" +
                '<span class="status-pair"><span class="status-pair-label">' +
                    escapeHtml(t("vo.field.certifiedStatus")) + "</span>" + statusPill(v.certifiedStatus) + "</span>";

            document.getElementById("contractorPanel").innerHTML =
                panelLockNote(v, role, "contractor") +
                field({ field: "description", label: t("vo.field.description"),
                        type: "textarea", value: seedText(v.description), vo: v, role: role }) +
                field({ field: "dateIssued", label: t("vo.field.dateIssued"), type: "date",
                        value: v.dateIssued, vo: v, role: role }) +
                field({ field: "typeOfInstruction", label: t("vo.field.typeOfInstruction"),
                        type: "select",
                        options: ["Architect's Instruction (AI)", "Engineer's instruction (EI)"],
                        value: v.typeOfInstruction, vo: v, role: role }) +
                field({ field: "instructionNo", label: t("vo.field.instructionNo"), type: "text",
                        value: v.instructionNo, vo: v, role: role }) +
                field({ field: "contractorRemark", label: t("vo.field.contractorRemark"),
                        type: "textarea", value: seedText(v.contractorRemark), vo: v, role: role }) +
                renderDocList(v, "revisedDrawing", t("documents.field.revisedDrawing"), role) +
                renderDocList(v, "oldDrawing", t("documents.field.oldDrawing"), role) +
                renderDocList(v, "supportingDocs", t("documents.field.supportingDocs"), role) +
                renderDocList(v, "contractDocs", t("documents.field.contractDocs"), role,
                              t("vo.docList.contractIntro"));

            document.getElementById("administratorPanel").innerHTML = renderAdministratorPanel(v, role);

            document.getElementById("consultantPanel").innerHTML =
                panelLockNote(v, role, "consultant") +
                field({ field: "dueDate", label: t("vo.field.dueDate"), type: "date",
                        value: v.dueDate, vo: v, role: role }) +
                field({ field: "assessmentNote", label: t("vo.field.assessmentNote"),
                        type: "textarea", value: seedText(v.assessmentNote), vo: v, role: role }) +
                field({ field: "timeImpact", label: t("vo.field.timeImpact"), type: "number",
                        value: v.timeImpact, vo: v, role: role }) +
                field({ field: "evaluateStatus", label: t("vo.field.evaluateStatus"), type: "select",
                        options: ["Pending", "Under Review", "Approved", "Rejected"],
                        value: v.evaluateStatus, vo: v, role: role }) +
                field({ field: "consultantRemark", label: t("vo.field.consultantRemark"),
                        type: "textarea", value: seedText(v.consultantRemark), vo: v, role: role }) +
                renderInfoRequestControl(v, role, fresh);

            document.getElementById("deadlinesPanel").innerHTML =
                renderDeadlinesPanel(v, today(), fresh);

            document.getElementById("clientPanel").innerHTML =
                panelLockNote(v, role, "client") +
                field({ field: "certifiedStatus", label: t("vo.field.certifiedStatus"), type: "select",
                        options: ["Pending", "Approved", "Rejected"],
                        value: v.certifiedStatus, vo: v, role: role }) +
                field({ field: "finalPrice", label: t("vo.field.finalPrice"),
                        type: "number", value: v.finalPrice, vo: v, role: role,
                        hint: t("vo.field.finalPriceHint") }) +
                field({ field: "clientRemark", label: t("vo.field.clientRemark"), type: "textarea",
                        value: seedText(v.clientRemark), vo: v, role: role }) +
                renderClientInfoRequestControl(v, role, today());

            document.getElementById("measurementBody").innerHTML =
                renderMeasurementRows(v, fresh, role, pastRateSources(loadDB(), project.id));
            document.getElementById("assessmentPanel").innerHTML =
                renderAssessmentPanel(v, fresh, role);
            /* The contract is read once, the first time it is needed;
               the panel redraws when the reading is in. */
            if (typeof ensureContractReadings === "function") {
                ensureContractReadings(project.id, v).then(changed => { if (changed) draw(); });
            }
            document.getElementById("historyPanel").innerHTML = renderHistory(v);

            document.getElementById("assistantPanel").innerHTML =
                renderAssistantPanel({ vo: v, project: fresh, role: role, session: session,
                                       contract: askContractAvailable(project.id) ? contractAsk : null });

            document.getElementById("addRowBtn").style.display =
                canEdit("measurement", v, role) ? "" : "none";
            document.getElementById("deleteVoBtn").hidden = !canDeleteVO(v, role);
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
                    const newId = uid("DOC");
                    FileStore.put(newId, file).then(stored => {
                        let oldName = "";
                        let newName = "";
                        updateVO(project.id, voId, v => {
                            const doc = (v[fieldName] || []).find(d => d.id === docId);
                            if (!doc) return;
                            oldName = doc.name;
                            addVersion(doc, { id: newId, name: file.name, size: file.size, stored: stored },
                                       session, today());
                            newName = doc.name;
                            logHistory(v, session, "Uploaded new version of " + oldName +
                                " (now " + newName + ") in " + fieldName);
                        });
                        toast(stored ? t("toast.newVersionUploaded") : t("file.notStored"), stored ? undefined : "error");
                        draw();
                    });
                    return;
                }

                const picker = e.target.closest(".doc-picker");
                if (picker) {
                    const fieldName = picker.dataset.field;
                    const files = Array.from(picker.files || []);
                    if (files.length === 0) return;
                    const ids = files.map(() => uid("DOC"));
                    Promise.all(files.map((f, k) => FileStore.put(ids[k], f))).then(stored => {
                        updateVO(project.id, voId, v => {
                            v[fieldName] = v[fieldName] || [];
                            files.forEach((f, k) => {
                                const doc = { id: ids[k], name: f.name, size: f.size,
                                              uploadedBy: session.name, at: today() };
                                if (stored[k]) doc.stored = true;
                                v[fieldName].push(doc);
                                logHistory(v, session, "Attached " + f.name + " to " + fieldName);
                            });
                        });
                        toast(stored.every(Boolean)
                            ? (files.length > 1 ? t("toast.documentsAttached") : t("toast.documentAttached"))
                            : t("file.notStored"), stored.every(Boolean) ? undefined : "error");
                        draw();
                    });
                    return;
                }

                const el = e.target.closest("[data-field]");
                if (!el || el.disabled) return;
                const name = el.dataset.field;
                let note = "";
                updateVO(project.id, voId, v => {
                    v[name] = el.type === "number"
                        ? (el.value === "" ? (name === "finalPrice" ? null : 0) : Number(el.value))
                        : el.value;
                    /* the contract administrator's two steps say what they did */
                    if (name === "instructionStatus" && el.value === "Confirmed") {
                        logHistory(v, session, v.instructionNo ? "Instruction confirmed — " + v.instructionNo : "Instruction confirmed");
                        note = t("toast.instructionConfirmed");
                    } else if (name === "instructionStatus" && el.value === "Returned") {
                        /* back to the contractor, who corrects it and submits again */
                        v.submitted = false;
                        logHistory(v, session, v.instructionNote ? "Instruction returned to contractor: " + v.instructionNote
                                                                 : "Instruction returned to contractor");
                        note = t("toast.instructionReturned");
                    } else if (name === "caCertifiedStatus" && el.value === "Certified") {
                        logHistory(v, session, "Contract administrator certified the assessed value");
                        note = t("toast.caCertified");
                    } else {
                        logHistory(v, session, "Updated " + name);
                    }
                });
                toast(note || t("toast.saved"));
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
                    if (doc) FileStore.remove([doc.id].concat((doc.revisions || []).map(r => r.id)));
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
            let autoNote = "";
            updateVO(project.id, voId, v => {
                const row = v.measurement[i];
                if (col === "qty" || col === "rate") row[col] = Number(el.value) || 0;
                else if (col === "assessedQty" || col === "assessedRate")
                    row[col] = el.value === "" ? "" : Number(el.value);
                else if (col === "bqItemId") row[col] = el.value || null;
                else row[col] = el.value;
                /* a hand-made choice ends the automatic one */
                if (row.auto && col === "bqItemId") delete row.auto;
                if (row.auto && col === "rate") { delete row.auto.rate; if (!Object.keys(row.auto).length) delete row.auto; }
                if (row.auto && col === "unit") { delete row.auto.unit; }
                if (col === "description" && autoFillRow(row, (getProject(project.id) || project).bq, pastRateSources(loadDB(), project.id)) && row.auto) {
                    autoNote = row.auto.code ? t("vo.row.autoToast", { code: row.auto.code })
                        : row.auto.rate === "past" ? t("vo.row.autoToastPast") : "";
                    logHistory(v, session, "Row " + (i + 1) + " filled automatically" +
                        (row.auto.code ? ": linked to BQ " + row.auto.code : "") +
                        (row.auto.rate === "bq" ? ", contract rate" : row.auto.rate === "past" ? ", past-project rate" : ""));
                }
            });
            toast(autoNote || t("toast.measurementUpdated"));
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

        /* Add a star-rated row to this project's BQ as a new item, at
           the rate in the box (the past-projects suggestion unless the
           consultant changed it), and link the row to it. */
        document.getElementById("measurementBody").addEventListener("click", e => {
            const btn = e.target.closest(".add-bq-item-btn");
            if (!btn) return;
            const i = Number(btn.dataset.row);
            const input = document.querySelector('.past-rate-input[data-row="' + i + '"]');
            const rate = Number(input && input.value);
            if (!(rate > 0)) { toast(t("vo.past.badRate"), "error"); return; }
            const sources = pastRateSources(loadDB(), project.id);
            let code = "";
            updateProject(project.id, p => {
                const v = p.vos.find(x => x.id === voId);
                const row = v && v.measurement[i];
                if (!row || row.bqItemId) return;
                const suggestion = suggestPastRate(row, sources);
                const item = newBqItemFromRow(row, v, p, rate, suggestion, today());
                p.bq = p.bq || [];
                p.bq.push(item);
                row.bqItemId = item.id;
                if (row.assessedQty === "" || row.assessedQty === null) row.assessedQty = row.qty;
                if (row.assessedRate === "" || row.assessedRate === null) row.assessedRate = rate;
                code = item.code;
                logHistory(v, session, "Added row " + (i + 1) + " to the contract BQ as new item " + item.code +
                    " at RM " + rate + "/" + item.unit +
                    (suggestion ? ", based on " + suggestion.count + " past project rate(s)" : ""));
            });
            if (code) toast(t("vo.past.added", { code: code }));
            draw();
        });

        document.getElementById("assessmentPanel").addEventListener("click", e => {
            if (!e.target.closest(".contract-reread-btn")) return;
            const fresh = getProject(project.id);
            const v = fresh.vos.find(x => x.id === voId);
            forgetContractReadings(project.id, contractSourceDocs(fresh, v).map(d => d.id));
            draw();
        });

        /* Remove one measurement row (the contractor, while they may edit
           the measurement). */
        document.getElementById("measurementBody").addEventListener("click", e => {
            const btn = e.target.closest(".row-delete-btn");
            if (!btn) return;
            const i = Number(btn.dataset.row);
            const v = getProject(project.id).vos.find(x => x.id === voId);
            const row = v && v.measurement[i];
            if (!row) return;
            const label = row.description || t("vo.row.untitled", { n: i + 1 });
            if ((row.description || Number(row.qty) || Number(row.rate)) &&
                !window.confirm(t("vo.row.deleteConfirm", { row: label }))) return;
            updateVO(project.id, voId, vo => {
                vo.measurement.splice(i, 1);
                logHistory(vo, session, "Removed measurement row " + (i + 1) + (row.description ? " (" + row.description + ")" : ""));
            });
            toast(t("vo.row.deleted"));
            draw();
        });

        /* Delete a draft VO (canDeleteVO): on the server first when signed
           in with a team account, so a failure leaves it where it was. */
        document.getElementById("deleteVoBtn").addEventListener("click", async () => {
            const v = getProject(project.id).vos.find(x => x.id === voId);
            if (!canDeleteVO(v, role)) return;
            if (!window.confirm(t("vo.delete.confirm", { no: v.no }))) return;
            if (typeof Cloud !== "undefined" && Cloud.active()) {
                try { await Cloud.deleteVO(project.id, voId); }
                catch (err) { toast(t("vo.delete.failed", { reason: err.message || String(err) }), "error"); return; }
            }
            deleteVO(project.id, voId);
            toast(t("vo.delete.done", { no: v.no }));
            window.location.href = "register.html";
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

        document.getElementById("clientPanel").addEventListener("click", e => {
            if (e.target.id !== "recordClientInfoRequestBtn") return;
            const noteInput = document.getElementById("clientInfoRequestNoteInput");
            const note = noteInput ? noteInput.value : "";
            updateVO(project.id, voId, v => {
                v.clientInfoRequestedAt = today();
                v.clientInfoRequestNote = note;
                logHistory(v, session, "Client requested further information" +
                    (note ? ": " + note : ""));
            });
            toast(t("toast.clientInfoRequestRecorded"));
            draw();
        });

        document.getElementById("submitBtn").addEventListener("click", () => {
            updateVO(project.id, voId, v => {
                v.submitted = true;
                v.evaluateStatus = "Pending";
                logHistory(v, session, "Submitted to contract administrator");
            });
            toast(t("toast.submittedToCa"));
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

        /* 「问合同」 tab: switching tabs and asking keep their state in
           contractAsk, so a redraw of the page leaves both in place. */
        document.getElementById("assistantPanel").addEventListener("click", e => {
            const tabBtn = e.target.closest(".ask-tab");
            if (!tabBtn) return;
            contractAsk.tab = tabBtn.dataset.askTab;
            document.querySelectorAll("#assistantPanel .ask-tab").forEach(b => {
                const on = b === tabBtn;
                b.classList.toggle("active", on);
                b.setAttribute("aria-selected", String(on));
            });
            document.querySelectorAll("#assistantPanel [data-ask-pane]").forEach(p => {
                p.hidden = p.dataset.askPane !== contractAsk.tab;
            });
        });

        function showContractAnswer() {
            const el = document.getElementById("contractAnswer");
            if (el) el.innerHTML = renderContractAnswer(contractAsk.state);
        }

        async function askTheContract(question) {
            const q = String(question || "").trim();
            if (!q || (contractAsk.state && contractAsk.state.loading)) return;
            const fresh = getProject(project.id);
            const v = fresh.vos.find(x => x.id === voId);
            contractAsk.state = { loading: true, question: q };
            showContractAnswer();
            contractAsk.state = await askContract(fresh, v, q, role);
            showContractAnswer();
        }

        document.getElementById("assistantPanel").addEventListener("click", e => {
            const btn = e.target.closest(".contract-question-btn");
            if (btn) { askTheContract(btn.dataset.question); return; }
            if (e.target.id === "contractAskBtn") askTheContract(document.getElementById("contractAskInput").value);
        });

        document.getElementById("assistantPanel").addEventListener("keydown", e => {
            if (e.target.id !== "contractAskInput" || e.key !== "Enter") return;
            askTheContract(e.target.value);
        });

        /* 「AI 照片核对」 (js/photocheck.js): asked on demand, kept for this
           browser session until the description or the photos change. */
        const photoCheck = { key: null, state: null, thumbs: {} };
        const PHOTO_CACHE = "voai.photocheck.";
        function readPhotoCache(key) {
            try { const s = sessionStorage.getItem(PHOTO_CACHE + key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
        }
        function writePhotoCache(key, state) {
            try { sessionStorage.setItem(PHOTO_CACHE + key, JSON.stringify(state)); } catch (e) { /* storage off */ }
        }
        function drawPhotoCheck() {
            const host = document.getElementById("photoCheckBody");
            if (!host || typeof photoCheckAvailable !== "function") return;
            const card = host.closest(".photo-check-card");
            if (!photoCheckAvailable(project.id)) { card.hidden = true; return; }
            const v = getProject(project.id).vos.find(x => x.id === voId);
            const docs = photosToCheck(v), total = checkablePhotos(v).length;
            const key = photoCheckKey(v, docs);
            if (key !== photoCheck.key) { photoCheck.key = key; photoCheck.state = readPhotoCache(key); }
            docs.forEach(d => {
                if (!photoCheck.thumbs[d.id] && sampleUrl(d)) photoCheck.thumbs[d.id] = sampleUrl(d);
            });
            const loading = !!(photoCheck.state && photoCheck.state.loading);
            const noDescription = !String(v.description || "").trim();
            host.innerHTML =
                '<p class="assistant-note">' + escapeHtml(t("photo.note")) + "</p>" +
                (askAsGuest(project.id) ? '<p class="assistant-note ask-guest-note">' + escapeHtml(t("ask.guestNote")) + "</p>" : "") +
                (docs.length ? '<div class="photo-check-actions"><button type="button" class="secondary-button" id="photoCheckBtn"' +
                    (loading || noDescription ? " disabled" : "") + ">" +
                    escapeHtml(t(photoCheck.state && photoCheck.state.results ? "photo.recheck" : "photo.check", { n: docs.length })) + "</button>" +
                    (noDescription ? ' <span class="assistant-note">' + escapeHtml(t("photo.needDescription")) + "</span>" : "") + "</div>" : "") +
                '<div id="photoCheckResult">' + renderPhotoCheck(photoCheck.state, docs, photoCheck.thumbs, total) + "</div>";
        }
        document.getElementById("photoCheckBody").addEventListener("click", async e => {
            if (e.target.id !== "photoCheckBtn" || (photoCheck.state && photoCheck.state.loading)) return;
            const v = getProject(project.id).vos.find(x => x.id === voId);
            const docs = photosToCheck(v);
            const key = photoCheckKey(v, docs);
            photoCheck.state = { loading: true };
            drawPhotoCheck();
            let state;
            try {
                const blobs = await Promise.all(docs.map(d => photoBlob(d)));
                docs.forEach((d, i) => { if (!photoCheck.thumbs[d.id]) photoCheck.thumbs[d.id] = URL.createObjectURL(blobs[i]); });
                state = await askPhotos(project.id, "check", docs.map((d, i) => ({ id: d.id, blob: blobs[i] })), v.description);
            } catch (err) {
                state = { error: err.message || String(err) };
            }
            photoCheck.key = key;
            photoCheck.state = state;
            if (state && state.results) writePhotoCache(key, state);
            drawPhotoCheck();
        });

        /* Where this VO's site photos were taken (js/sitemap.js); drawn
           once, hidden when neither the site nor any photo has a place. */
        const voMapHost = document.getElementById("voMapBody");
        if (voMapHost && typeof drawSiteMap === "function") {
            const p = getProject(project.id);
            if (siteOf(p) || photoPins(p, voId).length) drawSiteMap(voMapHost, p, { voId: voId });
            else voMapHost.closest(".site-map-card").hidden = true;
        }

        draw();
    })();
}
