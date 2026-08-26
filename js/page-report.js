/* VO-AI | page-report.js — Stage 5: role-specific VO reports, plus an
   all-VO summary report. Both print cleanly via window.print(). */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, today, prettyDate, contractorTotal, assessedTotal, voValue } = require("./calc.js");
    var { analyse, checkRate } = require("./analysis.js");
    var { escapeHtml } = require("./ui.js");
    var { versionCount } = require("./documents.js");
    var { t } = require("./i18n.js");
}

/* -----------------------------------------------------------
   Small shared builders
----------------------------------------------------------- */

/* typeOfInstruction is a raw English data VALUE — never renamed; see
   optionDisplayText() in js/page-vo.js for the same pattern. */
function instructionTypeLabel(value) {
    if (!value) return value;
    const key = "instructionType." + value;
    const label = t(key, {});
    return label === key ? value : label;
}

function statusLabel(value) {
    if (!value) return "—";
    const key = "status." + value;
    const label = t(key, {});
    return label === key ? value : label;
}

/* One numbered section listing attached documents with the date each
   was attached — used for the revised drawing, old drawing and
   supporting document sections, so the evidence trail is visible in
   the sequence the client asked for, not collapsed into one line. */
function docSection(files, label) {
    if (!files || files.length === 0) {
        return '<p class="empty-state">' + t("report.docSection.none", { label: escapeHtml(label) }) + '</p>';
    }
    return '<ul class="report-doc-list">' + files.map(f => {
        const vCount = versionCount(f);
        return "<li>" + escapeHtml(f.name) +
        ' <span class="rate-detail">— ' + t("report.docSection.attached", { date: prettyDate(f.at) }) +
        (vCount > 1 ? " · " + t("report.docSection.priorVersions", { n: vCount - 1 }) : "") +
        "</span></li>";
    }).join("") + "</ul>";
}

/* The consequential-element prompts from js/elements.js, surfaced
   directly under the classification so a QS sees them without having
   to read every line of the findings section. */
function elementsBlock(a) {
    const detected = (a.elements && a.elements.detected) || [];
    if (detected.length === 0) return "";
    const related = a.elements.related || [];
    let html = '<p class="rate-detail"><strong>' + escapeHtml(t("report.elementsAffected")) + '</strong> ' +
        detected.map(e => escapeHtml(t("element." + e.id + ".name"))).join(", ") + "</p>";
    if (related.length > 0) {
        html += related.map(r =>
            '<div class="finding"><span>' + t("report.confirmRelated", {
                name: escapeHtml(t("element." + r.element.id + ".name")),
                note: escapeHtml(t("element." + r.because + ".note"))
            }) + "</span></div>"
        ).join("");
    }
    return html;
}

/* The full measurement table — every row, claimed and assessed
   quantities, and the rate cross-check verdict. This is the
   consultant's working document (and the default when no role is
   given, so nothing that previously relied on renderReport(vo, project)
   changes behaviour). */
function fullMeasurementTable(vo, project) {
    const rows = (vo.measurement || []).map((row, i) => {
        const check = checkRate(row, project.bq || []);
        const assessedQty = row.assessedQty === "" || row.assessedQty == null ? row.qty : row.assessedQty;
        const assessedRate = row.assessedRate === "" || row.assessedRate == null ? row.rate : row.assessedRate;
        return "<tr>" +
            "<td>" + (i + 1) + "</td>" +
            "<td>" + escapeHtml(row.description || "—") + "</td>" +
            "<td>" + escapeHtml(row.unit || "") + "</td>" +
            "<td>" + escapeHtml(row.qty) + "</td>" +
            "<td>" + rm(row.rate) + "</td>" +
            "<td>" + rm((Number(row.qty) || 0) * (Number(row.rate) || 0)) + "</td>" +
            "<td>" + rm((Number(assessedQty) || 0) * (Number(assessedRate) || 0)) + "</td>" +
            '<td><span class="rate-flag ' + check.state + '">' + check.label + "</span>" +
                '<div class="rate-detail">' + escapeHtml(check.detail) + "</div></td>" +
        "</tr>";
    }).join("") || '<tr><td colspan="8" class="empty-state">' + escapeHtml(t("report.measurement.none")) + '</td></tr>';

    return '<div class="table-scroll"><table><thead><tr>' +
        "<th>" + escapeHtml(t("report.col.no")) + "</th><th>" + escapeHtml(t("report.col.description")) +
        "</th><th>" + escapeHtml(t("report.col.unit")) + "</th><th>" + escapeHtml(t("report.col.qty")) +
        "</th><th>" + escapeHtml(t("report.col.rate")) + "</th>" +
        "<th>" + escapeHtml(t("report.col.claimed")) + "</th><th>" + escapeHtml(t("report.col.assessed")) +
        "</th><th>" + escapeHtml(t("report.col.rateCheck")) + "</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
}

/* The contractor's own submission — their claimed quantities and
   rates in full, without the consultant's rate cross-check working
   (that belongs to the consultant's document; the contractor's copy
   shows the assessment result read-only, separately, below). */
function claimedMeasurementTable(vo) {
    const rows = (vo.measurement || []).map((row, i) =>
        "<tr>" +
            "<td>" + (i + 1) + "</td>" +
            "<td>" + escapeHtml(row.description || "—") + "</td>" +
            "<td>" + escapeHtml(row.unit || "") + "</td>" +
            "<td>" + escapeHtml(row.qty) + "</td>" +
            "<td>" + rm(row.rate) + "</td>" +
            "<td>" + rm((Number(row.qty) || 0) * (Number(row.rate) || 0)) + "</td>" +
        "</tr>"
    ).join("") || '<tr><td colspan="6" class="empty-state">' + escapeHtml(t("report.measurement.none")) + '</td></tr>';

    return '<div class="table-scroll"><table><thead><tr>' +
        "<th>" + escapeHtml(t("report.col.no")) + "</th><th>" + escapeHtml(t("report.col.description")) +
        "</th><th>" + escapeHtml(t("report.col.unit")) + "</th><th>" + escapeHtml(t("report.col.qty")) +
        "</th><th>" + escapeHtml(t("report.col.rate")) + "</th><th>" + escapeHtml(t("report.col.claimed")) + "</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
}

/* The client's version does not itemise the take-off — a client
   approves a value, they do not check a measurement row. */
function clientValuationSummary(vo) {
    const count = (vo.measurement || []).length;
    return "<p>" + t("report.claimedItems", { n: count }) + "</p>";
}

function renderTotals(a, certifiedCell, opts) {
    opts = opts || {};
    const assessedLabel = opts.readOnly ? t("report.totals.assessedReadOnly") : t("report.totals.assessed");
    const varianceLabel = opts.readOnly ? t("report.totals.varianceReadOnly") : t("report.totals.variance");
    return '<div class="report-totals">' +
        "<div><small>" + escapeHtml(t("report.totals.claimed")) + "</small><strong>" + rm(a.contractorTotal) + "</strong></div>" +
        "<div><small>" + escapeHtml(assessedLabel) + "</small><strong>" + rm(a.assessedTotal) + "</strong></div>" +
        "<div><small>" + escapeHtml(varianceLabel) + "</small><strong>" + rm(a.variance) + "</strong></div>" +
        "<div><small>" + escapeHtml(t("report.totals.certified")) + "</small><strong>" + certifiedCell + "</strong></div>" +
    "</div>";
}

/* -----------------------------------------------------------
   Single-VO report — section order is fixed to the client's required
   spine (Instruction / Revised drawing / Old drawing / Measurement /
   Supporting document), with the professional sections that make the
   document defensible arranged around it. Content emphasis changes by
   role; the facts never do.
----------------------------------------------------------- */

function renderReport(vo, project, role) {
    const a = analyse(vo, project);
    const certifiedCell = (vo.certifiedStatus === "Approved" &&
        vo.finalPrice !== null && vo.finalPrice !== undefined && vo.finalPrice !== "")
        ? rm(vo.finalPrice)
        : "—";

    const hasAssessment = (vo.measurement || []).some(row =>
        row.assessedQty !== "" && row.assessedQty !== null && row.assessedQty !== undefined
    ) || Boolean(vo.assessmentNote);

    /* a.clause.title/entitlement/evidence are the clause's own English
       text — see js/i18n.js's clause.note for why that is never
       translated; the note itself is. */
    const clauseBlock = a.clause
        ? "<p><strong>" + escapeHtml(a.clause.form + " " + a.clause.ref + " — " +
            a.clause.title) + "</strong></p><p class=\"rate-detail\">" +
            escapeHtml(a.clause.entitlement) + "</p><p class=\"rate-detail\">" +
            "<strong>" + escapeHtml(t("clause.evidenceRequired")) + "</strong> " + escapeHtml(a.clause.evidence) + "</p>" +
            '<p class="rate-detail clause-note">' + escapeHtml(t("clause.note")) + "</p>"
        : '<p class="rate-detail">' + escapeHtml(t("report.clause.none")) + "</p>";

    let measurementBody, totalsHtml;
    if (role === "client") {
        measurementBody = clientValuationSummary(vo);
        totalsHtml = renderTotals(a, certifiedCell, {});
    } else if (role === "contractor") {
        measurementBody = claimedMeasurementTable(vo);
        totalsHtml = renderTotals(a, certifiedCell, { readOnly: hasAssessment });
    } else {
        /* consultant, and the default when no role is given */
        measurementBody = fullMeasurementTable(vo, project);
        totalsHtml = renderTotals(a, certifiedCell, {});
    }

    /* The consultant's recommendation is written for whoever decides
       whether to certify — the consultant themselves (their own
       document) and the client (who makes that decision). The
       contractor's copy is their submission; it does not carry the
       consultant's internal recommendation to the client. */
    const showRecommendation = role !== "contractor" && Boolean(vo.consultantRemark);

    return '' +
    '<div class="report-sheet">' +

      '<div class="report-head">' +
        "<div><h1>" + escapeHtml(t("report.heading")) + "</h1>" +
        "<p>" + escapeHtml(project.name) + "</p>" +
        "<p>" + t("report.contractLine", { no: escapeHtml(project.contractNo || "—"), client: escapeHtml(project.client || "—") }) + "</p></div>" +
        '<div class="report-ref"><strong>' + escapeHtml(vo.no) + "</strong>" +
        "<span>" + t("report.issued", { date: prettyDate(vo.dateIssued) }) + "</span></div>" +
      "</div>" +

      "<h3>" + escapeHtml(t("report.section.instruction")) + "</h3>" +
      "<p>" + escapeHtml(vo.description || "—") + "</p>" +
      '<p class="rate-detail">' + t("report.instructionLine", {
            type: escapeHtml(instructionTypeLabel(vo.typeOfInstruction) || "—"),
            ref: escapeHtml(vo.instructionNo || "—"),
            date: prettyDate(vo.dueDate)
        }) + "</p>" +

      "<h3>" + escapeHtml(t("report.section.classification")) + "</h3>" +
      "<p>" + t("report.classificationLine", {
            label: escapeHtml(a.classification.label),
            work: "<strong>" + escapeHtml(a.classification.affectedWork) + "</strong>"
        }) + "</p>" +
      elementsBlock(a) +

      "<h3>" + escapeHtml(t("report.section.contractualBasis")) + "</h3>" + clauseBlock +

      "<h3>" + escapeHtml(t("report.section.revisedDrawing")) + "</h3>" + docSection(vo.revisedDrawing, t("report.docLabel.revisedDrawing")) +

      "<h3>" + escapeHtml(t("report.section.oldDrawing")) + "</h3>" + docSection(vo.oldDrawing, t("report.docLabel.oldDrawing")) +

      "<h3>" + escapeHtml(t("report.section.measurement")) + "</h3>" +
      measurementBody + totalsHtml +

      "<h3>" + escapeHtml(t("report.section.supportingDocs")) + "</h3>" + docSection(vo.supportingDocs, t("report.docLabel.supportingDocs")) +

      "<h3>" + escapeHtml(t("report.section.findings")) + "</h3>" +
      (a.findings.length === 0 ? "<p>" + escapeHtml(t("report.nothingFlagged")) + "</p>"
        : a.findings.map(f => '<div class="finding"><span>' + escapeHtml(f) +
                              "</span></div>").join("")) +

      "<h3>" + escapeHtml(t("report.section.timeImpact")) + "</h3>" +
      "<p>" + t("report.timeImpactLine", { n: Number(vo.timeImpact) || 0 }) + "</p>" +

      "<h3>" + escapeHtml(t("report.section.status")) + "</h3>" +
      "<p>" + t("report.evaluationLine", { status: "<strong>" + escapeHtml(t("status." + vo.evaluateStatus, {})) + "</strong>" }) + "<br>" +
      t("report.certificationLine", { status: "<strong>" + escapeHtml(t("status." + vo.certifiedStatus, {})) + "</strong>" }) + "</p>" +
      (vo.assessmentNote ? '<p class="rate-detail"><strong>' + t("vo.field.assessmentNote") + ':</strong> ' +
        escapeHtml(vo.assessmentNote) + "</p>" : "") +
      (showRecommendation ? '<p class="rate-detail"><strong>' + t("report.recommendationLabel") + '</strong> ' +
        escapeHtml(vo.consultantRemark) + "</p>" : "") +

      '<div class="signatures">' +
        "<div><span></span><small>" + escapeHtml(t("report.sig.contractor")) + "</small></div>" +
        "<div><span></span><small>" + escapeHtml(t("report.sig.consultant")) + "</small></div>" +
        "<div><span></span><small>" + escapeHtml(t("report.sig.client")) + "</small></div>" +
      "</div>" +

      '<div class="disclaimer"><strong>' + escapeHtml(t("report.disclaimer.title")) + '</strong>' +
      "<span>" + escapeHtml(t("report.disclaimer.body")) + "</span></div>" +

    "</div>";
}

/* -----------------------------------------------------------
   All-VO summary report — "generate report with for all vo price."
   Available to every role: a client's first question about variations
   is what they add up to against the contract sum, and a consultant
   needs the same overview.
----------------------------------------------------------- */

function renderSummaryReport(project) {
    const vos = (project && project.vos) || [];

    const rows = vos.map(vo => {
        const claimed = contractorTotal(vo);
        const assessed = assessedTotal(vo);
        const certified = (vo.certifiedStatus === "Approved" &&
            vo.finalPrice !== null && vo.finalPrice !== undefined && vo.finalPrice !== "")
            ? (Number(vo.finalPrice) || 0)
            : null;
        return { vo: vo, claimed: claimed, assessed: assessed, certified: certified };
    });

    const totalClaimed = rows.reduce((s, r) => s + r.claimed, 0);
    const totalAssessed = rows.reduce((s, r) => s + r.assessed, 0);
    const totalCertified = rows.reduce((s, r) => s + (r.certified || 0), 0);
    const totalTimeImpact = vos
        .filter(v => v.evaluateStatus === "Approved")
        .reduce((s, v) => s + (Number(v.timeImpact) || 0), 0);

    const contractSum = Number((project && project.contractSum) || 0);
    const pctOfContract = contractSum > 0
        ? (totalCertified / contractSum * 100).toFixed(2) + "%"
        : null;

    const bodyRows = rows.length === 0
        ? '<tr><td colspan="9" class="empty-state">' + escapeHtml(t("report.summary.empty")) + '</td></tr>'
        : rows.map(r => "<tr>" +
            "<td><span class=\"item-code\">" + escapeHtml(r.vo.no) + "</span></td>" +
            "<td>" + escapeHtml(r.vo.description || "—") + "</td>" +
            "<td>" + prettyDate(r.vo.dateIssued) + "</td>" +
            "<td>" + escapeHtml(statusLabel(r.vo.evaluateStatus)) + "</td>" +
            "<td>" + escapeHtml(statusLabel(r.vo.certifiedStatus)) + "</td>" +
            "<td>" + rm(r.claimed) + "</td>" +
            "<td>" + rm(r.assessed) + "</td>" +
            "<td>" + (r.certified === null ? "—" : rm(r.certified)) + "</td>" +
            "<td>" + t("report.summary.dayUnit", { n: Number(r.vo.timeImpact) || 0 }) + "</td>" +
        "</tr>").join("");

    return '' +
    '<div class="report-sheet">' +

      '<div class="report-head">' +
        "<div><h1>" + escapeHtml(t("report.summary.heading")) + "</h1>" +
        "<p>" + escapeHtml((project && project.name) || "—") + "</p>" +
        "<p>" + t("report.contractLine", {
            no: escapeHtml((project && project.contractNo) || "—"),
            client: escapeHtml((project && project.client) || "—")
        }) + "</p></div>" +
        '<div class="report-ref"><strong>' + escapeHtml(t("report.summary.voCount", { n: rows.length })) + "</strong>" +
        "<span>" + escapeHtml(t("report.summary.printed", { date: prettyDate(today()) })) + "</span></div>" +
      "</div>" +

      '<div class="table-scroll"><table><thead><tr>' +
        "<th>" + escapeHtml(t("report.summary.col.no")) + "</th><th>" + escapeHtml(t("report.summary.col.description")) +
        "</th><th>" + escapeHtml(t("report.summary.col.dateIssued")) + "</th><th>" + escapeHtml(t("report.summary.col.evaluateStatus")) + "</th>" +
        "<th>" + escapeHtml(t("report.summary.col.certifiedStatus")) + "</th><th>" + escapeHtml(t("report.summary.col.claimed")) +
        "</th><th>" + escapeHtml(t("report.summary.col.assessed")) + "</th><th>" + escapeHtml(t("report.summary.col.certified")) +
        "</th><th>" + escapeHtml(t("report.summary.col.timeImpact")) + "</th>" +
      "</tr></thead><tbody>" + bodyRows + "</tbody></table></div>" +

      '<div class="report-totals">' +
        "<div><small>" + escapeHtml(t("report.summary.totalClaimed")) + "</small><strong>" + rm(totalClaimed) + "</strong></div>" +
        "<div><small>" + escapeHtml(t("report.summary.totalAssessed")) + "</small><strong>" + rm(totalAssessed) + "</strong></div>" +
        "<div><small>" + escapeHtml(t("report.summary.totalCertified")) + "</small><strong>" + rm(totalCertified) + "</strong></div>" +
        "<div><small>" + escapeHtml(t("report.summary.totalTimeImpact")) + "</small><strong>" +
            t("report.summary.dayUnit", { n: totalTimeImpact }) + "</strong></div>" +
      "</div>" +

      (pctOfContract ? '<p class="rate-detail"><strong>' +
            t("report.summary.pctOfContractBold", { pct: escapeHtml(pctOfContract) }) +
            "</strong> (" + rm(contractSum) + ").</p>" : "") +

      '<div class="disclaimer"><strong>' + escapeHtml(t("report.disclaimer.title")) + '</strong>' +
      "<span>" + escapeHtml(t("report.summary.disclaimerBody")) + "</span></div>" +

    "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderReport, renderSummaryReport };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("report", t("nav.report"), t("crumb.report"));
        if (!ctx) return;
        const { project, session } = ctx;
        const role = session.role;

        const voId = new URLSearchParams(location.search).get("id");
        const host = document.getElementById("reportHost");
        const picker = document.getElementById("voPicker");
        const modeSelect = document.getElementById("reportMode");

        picker.innerHTML = (project.vos || []).map(v =>
            '<option value="' + escapeHtml(v.id) + '"' + (v.id === voId ? " selected" : "") +
            ">" + escapeHtml(v.no + " — " + (v.description || t("report.pickerUntitled"))) + "</option>"
        ).join("");
        picker.value = voId || (project.vos[0] || {}).id || "";

        function render() {
            if (modeSelect.value === "summary") {
                picker.hidden = true;
                host.innerHTML = renderSummaryReport(project);
                return;
            }
            picker.hidden = false;
            const vo = (project.vos || []).find(v => v.id === picker.value) || project.vos[0];
            if (!vo) { host.innerHTML = '<div class="empty-state">' + escapeHtml(t("report.noVos")) + '</div>'; return; }
            host.innerHTML = renderReport(vo, project, role);
        }

        picker.addEventListener("change", render);
        modeSelect.addEventListener("change", render);
        document.getElementById("printBtn").addEventListener("click", () => window.print());
        render();
    })();
}
