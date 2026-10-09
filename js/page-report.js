/* VO-AI | page-report.js — Stage 5: role-specific VO reports, plus an
   all-VO summary report. Both print cleanly via window.print(). */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, today, prettyDate, contractorTotal, assessedTotal, voValue } = require("./calc.js");
    var { checkRate } = require("./analysis.js");
    var { escapeHtml, logoMark, fileLink, seedText } = require("./ui.js");
    var { versionCount } = require("./documents.js");
    var { t, voNoLabel } = require("./i18n.js");
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
        /* Opens from the report too; print shows just the name. */
        return "<li>" + fileLink(f) +
        ' <span class="rate-detail">— ' + t("report.docSection.attached", { date: prettyDate(f.at) }) +
        (vCount > 1 ? " · " + t("report.docSection.priorVersions", { n: vCount - 1 }) : "") +
        "</span></li>";
    }).join("") + "</ul>";
}

/* The full measurement table — every row, claimed and assessed
   quantities, and the rate cross-check verdict. This is the
   consultant's working document (and the default when no role is
   given, so nothing that previously relied on renderReport(vo, project)
   changes behaviour). */
/* The rate check in one line for the printed report (the full
   explanation is on the VO page): which BQ item, and by how much. */
function reportRateNote(check, row, project) {
    const item = check.matchedItem || (row.bqItemId ? (project.bq || []).find(b => b.id === row.bqItemId) : null) || {};
    if (check.state === "same") return t("vo.row.same", { code: item.code || "" });
    if (check.state === "different") {
        return t("vo.row.different", {
            code: item.code || "",
            word: t(check.diff > 0 ? "rate.overstated" : "rate.understated"),
            diff: rm(Math.abs(check.diff)),
            pct: check.pct === null || check.pct === undefined ? "" : t("rate.pctNote", { pct: Math.abs(check.pct).toFixed(1) })
        });
    }
    if (check.state === "unchecked" || check.state === "norate") return t("vo.row." + check.state);
    return t("vo.row.star");
}

function fullMeasurementTable(vo, project) {
    const rows = (vo.measurement || []).map((row, i) => {
        const check = checkRate(row, project.bq || []);
        const assessedQty = row.assessedQty === "" || row.assessedQty == null ? row.qty : row.assessedQty;
        const assessedRate = row.assessedRate === "" || row.assessedRate == null ? row.rate : row.assessedRate;
        return "<tr>" +
            "<td>" + (i + 1) + "</td>" +
            "<td>" + escapeHtml(seedText(row.description) || "—") + "</td>" +
            "<td>" + escapeHtml(row.unit || "") + "</td>" +
            "<td>" + escapeHtml(row.qty) + "</td>" +
            "<td>" + rm(row.rate) + "</td>" +
            "<td>" + rm((Number(row.qty) || 0) * (Number(row.rate) || 0)) + "</td>" +
            "<td>" + rm((Number(assessedQty) || 0) * (Number(assessedRate) || 0)) + "</td>" +
            '<td><span class="rate-flag ' + check.state + '">' + check.label + "</span>" +
                '<div class="rate-detail">' + escapeHtml(reportRateNote(check, row, project)) + "</div></td>" +
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
            "<td>" + escapeHtml(seedText(row.description) || "—") + "</td>" +
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


/* -----------------------------------------------------------
   Single-VO report — section order is fixed to the client's required
   spine (Instruction / Revised drawing / Original drawing / Measurement /
   Supporting document), with the professional sections that make the
   document defensible arranged around it. Content emphasis changes by
   role; the facts never do.
----------------------------------------------------------- */

function renderReport(vo, project, role) {
    let measurementBody;
    if (role === "client") {
        measurementBody = clientValuationSummary(vo);
    } else if (role === "contractor") {
        measurementBody = claimedMeasurementTable(vo);
    } else {
        /* consultant, and the default when no role is given */
        measurementBody = fullMeasurementTable(vo, project);
    }

    /* The consultant's recommendation is written for whoever decides
       whether to certify — the consultant themselves (their own
       document) and the client (who makes that decision). The
       contractor's copy is their submission; it does not carry the
       consultant's internal recommendation to the client. */
    const showRecommendation = role !== "contractor" && Boolean(vo.consultantRemark);

    /* the contract administrator's two steps; a VO saved before that role
       existed reads as the page shows it (js/page-vo.js) */
    const instructionStatus = vo.instructionStatus || (vo.submitted ? "Confirmed" : "Pending");
    const statusHtml = value => "<strong>" + escapeHtml(t("status." + value, {})) + "</strong>";

    return '' +
    '<div class="report-sheet">' +

      '<div class="report-head">' +
        '<div class="report-head-id">' + logoMark(38) +
        "<div><h1>" + escapeHtml(t("report.heading")) + "</h1>" +
        "<p>" + escapeHtml(seedText(project.name)) + "</p>" +
        "<p>" + t("report.contractLine", { no: escapeHtml(project.contractNo || "—"), client: escapeHtml(project.client || "—") }) + "</p></div></div>" +
        '<div class="report-ref"><strong>' + escapeHtml(voNoLabel(vo.no)) + "</strong>" +
        "<span>" + t("report.issued", { date: prettyDate(vo.dateIssued) }) + "</span></div>" +
      "</div>" +

      '<section class="report-sec">' +
      "<h3>" + escapeHtml(t("report.section.instruction")) + "</h3>" +
      "<p>" + escapeHtml(seedText(vo.description) || "—") + "</p>" +
      '<p class="rate-detail">' + t("report.instructionLine", {
            type: escapeHtml(instructionTypeLabel(vo.typeOfInstruction) || "—"),
            ref: escapeHtml(vo.instructionNo || "—"),
            date: prettyDate(vo.dueDate)
        }) + "</p>" + "</section>" +

      '<div class="report-pair report-sec">' +
        "<div><h3>" + escapeHtml(t("report.section.revisedDrawing")) + "</h3>" + docSection(vo.revisedDrawing, t("report.docLabel.revisedDrawing")) + "</div>" +
        "<div><h3>" + escapeHtml(t("report.section.oldDrawing")) + "</h3>" + docSection(vo.oldDrawing, t("report.docLabel.oldDrawing")) + "</div>" +
      "</div>" +

      /* the measurement may run longer than a page: it may break between
         rows, never inside one, and its heading stays with the table */
      '<section class="report-sec report-sec-long">' +
      "<h3>" + escapeHtml(t("report.section.measurement")) + "</h3>" +
      measurementBody + "</section>" +

      '<section class="report-sec">' +
      "<h3>" + escapeHtml(t("report.section.supportingDocs")) + "</h3>" + docSection(vo.supportingDocs, t("report.docLabel.supportingDocs")) +
      "</section>" +

      /* time, status, the notes, signatures and disclaimer close the
         report together on one page */
      '<div class="report-close">' +
      '<div class="report-pair">' +
        "<div><h3>" + escapeHtml(t("report.section.status")) + "</h3>" +
        "<p>" + t("report.instructionStatusLine", { status: statusHtml(instructionStatus) }) + "<br>" +
        t("report.evaluationLine", { status: statusHtml(vo.evaluateStatus) }) + "<br>" +
        t("report.certificationLine", { status: statusHtml(vo.certifiedStatus) }) + "</p></div>" +
      "</div>" +
      (vo.assessmentNote ? '<p class="rate-detail"><strong>' + t("report.assessmentNoteLabel") + '</strong> ' +
        escapeHtml(seedText(vo.assessmentNote)) + "</p>" : "") +
      (showRecommendation ? '<p class="rate-detail"><strong>' + t("report.recommendationLabel") + '</strong> ' +
        escapeHtml(seedText(vo.consultantRemark)) + "</p>" : "") +

      '<div class="signatures">' +
        "<div><span></span><small>" + escapeHtml(t("report.sig.contractor")) + "</small></div>" +
        "<div><span></span><small>" + escapeHtml(t("report.sig.administrator")) + "</small></div>" +
        "<div><span></span><small>" + escapeHtml(t("report.sig.consultant")) + "</small></div>" +
        "<div><span></span><small>" + escapeHtml(t("report.sig.client")) + "</small></div>" +
      "</div>" +

      '<div class="disclaimer"><strong>' + escapeHtml(t("report.disclaimer.title")) + '</strong>' +
      "<span>" + escapeHtml(t("report.disclaimer.body")) + "</span></div>" +
      "</div>" +

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

    const contractSum = Number((project && project.contractSum) || 0);
    const pctOfContract = contractSum > 0
        ? (totalCertified / contractSum * 100).toFixed(2) + "%"
        : null;

    const bodyRows = rows.length === 0
        ? '<tr><td colspan="8" class="empty-state">' + escapeHtml(t("report.summary.empty")) + '</td></tr>'
        : rows.map(r => "<tr>" +
            "<td><span class=\"item-code\">" + escapeHtml(voNoLabel(r.vo.no)) + "</span></td>" +
            "<td>" + escapeHtml(seedText(r.vo.description) || "—") + "</td>" +
            "<td>" + prettyDate(r.vo.dateIssued) + "</td>" +
            "<td>" + escapeHtml(statusLabel(r.vo.evaluateStatus)) + "</td>" +
            "<td>" + escapeHtml(statusLabel(r.vo.certifiedStatus)) + "</td>" +
            "<td>" + rm(r.claimed) + "</td>" +
            "<td>" + rm(r.assessed) + "</td>" +
            "<td>" + (r.certified === null ? "—" : rm(r.certified)) + "</td>" +
        "</tr>").join("");

    return '' +
    '<div class="report-sheet">' +

      '<div class="report-head">' +
        '<div class="report-head-id">' + logoMark(38) +
        "<div><h1>" + escapeHtml(t("report.summary.heading")) + "</h1>" +
        "<p>" + escapeHtml((project && seedText(project.name)) || "—") + "</p>" +
        "<p>" + t("report.contractLine", {
            no: escapeHtml((project && project.contractNo) || "—"),
            client: escapeHtml((project && project.client) || "—")
        }) + "</p></div></div>" +
        '<div class="report-ref"><strong>' + escapeHtml(t("report.summary.voCount", { n: rows.length })) + "</strong>" +
        "<span>" + escapeHtml(t("report.summary.printed", { date: prettyDate(today()) })) + "</span></div>" +
      "</div>" +

      '<div class="table-scroll"><table><thead><tr>' +
        "<th>" + escapeHtml(t("report.summary.col.no")) + "</th><th>" + escapeHtml(t("report.summary.col.description")) +
        "</th><th>" + escapeHtml(t("report.summary.col.dateIssued")) + "</th><th>" + escapeHtml(t("report.summary.col.evaluateStatus")) + "</th>" +
        "<th>" + escapeHtml(t("report.summary.col.certifiedStatus")) + "</th><th>" + escapeHtml(t("report.summary.col.claimed")) +
        "</th><th>" + escapeHtml(t("report.summary.col.assessed")) + "</th><th>" + escapeHtml(t("report.summary.col.certified")) +
        "</th>" +
      "</tr></thead><tbody>" + bodyRows + "</tbody></table></div>" +

      '<div class="report-totals">' +
        "<div><small>" + escapeHtml(t("report.summary.totalClaimed")) + "</small><strong>" + rm(totalClaimed) + "</strong></div>" +
        "<div><small>" + escapeHtml(t("report.summary.totalAssessed")) + "</small><strong>" + rm(totalAssessed) + "</strong></div>" +
        "<div><small>" + escapeHtml(t("report.summary.totalCertified")) + "</small><strong>" + rm(totalCertified) + "</strong></div>" +
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
            ">" + escapeHtml(voNoLabel(v.no) + " — " + (seedText(v.description) || t("report.pickerUntitled"))) + "</option>"
        ).join("");
        picker.value = voId || (project.vos[0] || {}).id || "";
        if (new URLSearchParams(location.search).get("mode") === "instruction") modeSelect.value = "instruction";

        /* Building the sheet is one long string concatenation over the
           whole VO, so any single bad field throws before the assignment
           happens and the panel is left blank with nothing said. That
           reads as a broken feature when it is usually one stale cached
           script or one unexpected value. Say what actually went wrong
           instead of showing an empty page. */
        function render() {
            try {
                if (modeSelect.value === "summary") {
                    picker.hidden = true;
                    host.innerHTML = renderSummaryReport(project);
                    return;
                }
                picker.hidden = false;
                const fresh = getProject(project.id) || project;
                const vo = (fresh.vos || []).find(v => v.id === picker.value) || fresh.vos[0];
                if (!vo) { host.innerHTML = '<div class="empty-state">' + escapeHtml(t("report.noVos")) + '</div>'; return; }
                if (modeSelect.value === "instruction") { host.innerHTML = renderInstructionSheet(vo, fresh); return; }
                host.innerHTML = renderReport(vo, fresh, role);
                /* the contract is read once; redraw when it is in */
                if (typeof ensureContractReadings === "function") {
                    ensureContractReadings(project.id, vo).then(changed => { if (changed) render(); });
                }
            } catch (err) {
                console.error("VO-AI: the report could not be built.", err);
                host.innerHTML = '<div class="report-error">' +
                    "<h2>" + escapeHtml(t("report.error.title")) + "</h2>" +
                    "<p>" + escapeHtml(t("report.error.body")) + "</p>" +
                    "<pre>" + escapeHtml(String((err && err.stack) || err)) + "</pre>" +
                "</div>";
            }
        }

        picker.addEventListener("change", render);
        modeSelect.addEventListener("change", render);
        document.getElementById("printBtn").addEventListener("click", () => window.print());
        render();
    })();
}
