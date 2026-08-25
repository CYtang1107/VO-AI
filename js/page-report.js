/* VO-AI | page-report.js — Stage 5: role-specific VO reports, plus an
   all-VO summary report. Both print cleanly via window.print(). */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, today, prettyDate, contractorTotal, assessedTotal, voValue } = require("./calc.js");
    var { analyse, checkRate } = require("./analysis.js");
    var { escapeHtml } = require("./ui.js");
    var { versionCount } = require("./documents.js");
}

/* -----------------------------------------------------------
   Small shared builders
----------------------------------------------------------- */

/* One numbered section listing attached documents with the date each
   was attached — used for the revised drawing, old drawing and
   supporting document sections, so the evidence trail is visible in
   the sequence the client asked for, not collapsed into one line. */
function docSection(files, label) {
    if (!files || files.length === 0) {
        return '<p class="empty-state">No ' + escapeHtml(label) + ' attached.</p>';
    }
    return '<ul class="report-doc-list">' + files.map(f => {
        const vCount = versionCount(f);
        return "<li>" + escapeHtml(f.name) +
        ' <span class="rate-detail">— attached ' + prettyDate(f.at) +
        (vCount > 1 ? " · " + (vCount - 1) + " prior version(s) on record" : "") +
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
    let html = '<p class="rate-detail"><strong>Elements affected:</strong> ' +
        detected.map(e => escapeHtml(e.name)).join(", ") + "</p>";
    if (related.length > 0) {
        html += related.map(r =>
            '<div class="finding"><span>Confirm whether ' + escapeHtml(r.element.name) +
            " also requires re-measurement — " + escapeHtml(r.note) + "</span></div>"
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
    }).join("") || '<tr><td colspan="8" class="empty-state">No measurement entered.</td></tr>';

    return '<div class="table-scroll"><table><thead><tr>' +
        "<th>#</th><th>DESCRIPTION</th><th>UNIT</th><th>QTY</th><th>RATE</th>" +
        "<th>CLAIMED</th><th>ASSESSED</th><th>RATE CROSS-CHECK</th>" +
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
    ).join("") || '<tr><td colspan="6" class="empty-state">No measurement entered.</td></tr>';

    return '<div class="table-scroll"><table><thead><tr>' +
        "<th>#</th><th>DESCRIPTION</th><th>UNIT</th><th>QTY</th><th>RATE</th><th>CLAIMED</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
}

/* The client's version does not itemise the take-off — a client
   approves a value, they do not check a measurement row. */
function clientValuationSummary(vo) {
    const count = (vo.measurement || []).length;
    return "<p>" + count + " measurement item(s) claimed. The claimed, assessed and " +
        "certified values are set out below; the itemised take-off and rate cross-check " +
        "are held in the consultant's assessment document.</p>";
}

function renderTotals(a, certifiedCell, opts) {
    opts = opts || {};
    const assessedLabel = opts.readOnly ? "Consultant assessed (read-only)" : "Consultant assessed";
    const varianceLabel = opts.readOnly ? "Variance (read-only)" : "Variance";
    return '<div class="report-totals">' +
        "<div><small>Contractor claimed</small><strong>" + rm(a.contractorTotal) + "</strong></div>" +
        "<div><small>" + assessedLabel + "</small><strong>" + rm(a.assessedTotal) + "</strong></div>" +
        "<div><small>" + varianceLabel + "</small><strong>" + rm(a.variance) + "</strong></div>" +
        "<div><small>Certified value</small><strong>" + certifiedCell + "</strong></div>" +
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

    const clauseBlock = a.clause
        ? "<p><strong>" + escapeHtml(a.clause.form + " " + a.clause.ref + " — " +
            a.clause.title) + "</strong></p><p class=\"rate-detail\">" +
            escapeHtml(a.clause.entitlement) + "</p><p class=\"rate-detail\">" +
            "<strong>Evidence required:</strong> " + escapeHtml(a.clause.evidence) + "</p>"
        : "<p class=\"rate-detail\">No governing clause identified from the description.</p>";

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
        "<div><h1>Draft Variation Order</h1>" +
        "<p>" + escapeHtml(project.name) + "</p>" +
        "<p>Contract " + escapeHtml(project.contractNo || "—") +
            " · Client " + escapeHtml(project.client || "—") + "</p></div>" +
        '<div class="report-ref"><strong>' + escapeHtml(vo.no) + "</strong>" +
        "<span>Issued " + prettyDate(vo.dateIssued) + "</span></div>" +
      "</div>" +

      "<h3>1. Instruction</h3>" +
      "<p>" + escapeHtml(vo.description || "—") + "</p>" +
      '<p class="rate-detail">' + escapeHtml(vo.typeOfInstruction || "—") +
        " · Reference " + escapeHtml(vo.instructionNo || "—") +
        " · Due " + prettyDate(vo.dueDate) + "</p>" +

      "<h3>2. Classification and affected elements</h3>" +
      "<p>" + escapeHtml(a.classification.label) +
        " affecting <strong>" + escapeHtml(a.classification.affectedWork) + "</strong></p>" +
      elementsBlock(a) +

      "<h3>3. Contractual basis</h3>" + clauseBlock +

      "<h3>4. Revised drawing</h3>" + docSection(vo.revisedDrawing, "revised drawing") +

      "<h3>5. Old drawing (superseded)</h3>" + docSection(vo.oldDrawing, "superseded drawing") +

      "<h3>6. Measurement and valuation</h3>" +
      measurementBody + totalsHtml +

      "<h3>7. Supporting documents</h3>" + docSection(vo.supportingDocs, "supporting document") +

      "<h3>8. Findings</h3>" +
      (a.findings.length === 0 ? "<p>Nothing flagged.</p>"
        : a.findings.map(f => '<div class="finding"><span>' + escapeHtml(f) +
                              "</span></div>").join("")) +

      "<h3>9. Time impact</h3>" +
      "<p>" + (Number(vo.timeImpact) || 0) + " day(s) claimed extension of time.</p>" +

      "<h3>10. Status and signatures</h3>" +
      "<p>Consultant evaluation: <strong>" + escapeHtml(vo.evaluateStatus) + "</strong><br>" +
      "Client certification: <strong>" + escapeHtml(vo.certifiedStatus) + "</strong></p>" +
      (vo.assessmentNote ? '<p class="rate-detail"><strong>Consultant\'s assessment:</strong> ' +
        escapeHtml(vo.assessmentNote) + "</p>" : "") +
      (showRecommendation ? '<p class="rate-detail"><strong>Consultant\'s recommendation:</strong> ' +
        escapeHtml(vo.consultantRemark) + "</p>" : "") +

      '<div class="signatures">' +
        "<div><span></span><small>Contractor QS</small></div>" +
        "<div><span></span><small>Consultant QS</small></div>" +
        "<div><span></span><small>Client / Developer</small></div>" +
      "</div>" +

      '<div class="disclaimer"><strong>⚠ Professional Review Required</strong>' +
      "<span>This draft is a decision-support output generated by VO-AI from the data " +
      "entered above. It is not a certificate. The responsible construction professional " +
      "must verify every figure before issue.</span></div>" +

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
        ? '<tr><td colspan="9" class="empty-state">No variation orders on this project.</td></tr>'
        : rows.map(r => "<tr>" +
            "<td>" + escapeHtml(r.vo.no) + "</td>" +
            "<td>" + escapeHtml(r.vo.description || "—") + "</td>" +
            "<td>" + prettyDate(r.vo.dateIssued) + "</td>" +
            "<td>" + escapeHtml(r.vo.evaluateStatus || "—") + "</td>" +
            "<td>" + escapeHtml(r.vo.certifiedStatus || "—") + "</td>" +
            "<td>" + rm(r.claimed) + "</td>" +
            "<td>" + rm(r.assessed) + "</td>" +
            "<td>" + (r.certified === null ? "—" : rm(r.certified)) + "</td>" +
            "<td>" + (Number(r.vo.timeImpact) || 0) + " day(s)</td>" +
        "</tr>").join("");

    return '' +
    '<div class="report-sheet">' +

      '<div class="report-head">' +
        "<div><h1>Variation Orders — Summary Report</h1>" +
        "<p>" + escapeHtml((project && project.name) || "—") + "</p>" +
        "<p>Contract " + escapeHtml((project && project.contractNo) || "—") +
            " · Client " + escapeHtml((project && project.client) || "—") + "</p></div>" +
        '<div class="report-ref"><strong>' + rows.length + " VO(s)</strong>" +
        "<span>Printed " + prettyDate(today()) + "</span></div>" +
      "</div>" +

      '<div class="table-scroll"><table><thead><tr>' +
        "<th>VO NO.</th><th>DESCRIPTION</th><th>DATE ISSUED</th><th>EVALUATE STATUS</th>" +
        "<th>CERTIFIED STATUS</th><th>CLAIMED</th><th>ASSESSED</th><th>CERTIFIED</th><th>TIME IMPACT</th>" +
      "</tr></thead><tbody>" + bodyRows + "</tbody></table></div>" +

      '<div class="report-totals">' +
        "<div><small>Total claimed</small><strong>" + rm(totalClaimed) + "</strong></div>" +
        "<div><small>Total assessed</small><strong>" + rm(totalAssessed) + "</strong></div>" +
        "<div><small>Total certified</small><strong>" + rm(totalCertified) + "</strong></div>" +
        "<div><small>Total approved time impact</small><strong>" + totalTimeImpact + " day(s)</strong></div>" +
      "</div>" +

      (pctOfContract ? '<p class="rate-detail"><strong>Certified total is ' +
        escapeHtml(pctOfContract) + " of the contract sum</strong> (" + rm(contractSum) + ").</p>" : "") +

      '<div class="disclaimer"><strong>⚠ Professional Review Required</strong>' +
      "<span>This summary is a decision-support output generated by VO-AI from the data " +
      "entered above. It is not a certificate. The responsible construction professional " +
      "must verify every figure before issue.</span></div>" +

    "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderReport, renderSummaryReport };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("report", "VO Report", "VO-AI / VO Reports");
        if (!ctx) return;
        const { project, session } = ctx;
        const role = session.role;

        const voId = new URLSearchParams(location.search).get("id");
        const host = document.getElementById("reportHost");
        const picker = document.getElementById("voPicker");
        const modeSelect = document.getElementById("reportMode");

        picker.innerHTML = (project.vos || []).map(v =>
            '<option value="' + escapeHtml(v.id) + '"' + (v.id === voId ? " selected" : "") +
            ">" + escapeHtml(v.no + " — " + (v.description || "Untitled")) + "</option>"
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
            if (!vo) { host.innerHTML = '<div class="empty-state">No VOs to report on.</div>'; return; }
            host.innerHTML = renderReport(vo, project, role);
        }

        picker.addEventListener("change", render);
        modeSelect.addEventListener("change", render);
        document.getElementById("printBtn").addEventListener("click", () => window.print());
        render();
    })();
}
