/* VO-AI | page-report.js — Stage 5: the draft VO report. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, voValue } = require("./calc.js");
    var { analyse, checkRate } = require("./analysis.js");
    var { escapeHtml } = require("./ui.js");
}

function docList(files, label) {
    if (!files || files.length === 0) {
        return "<p class=\"rate-detail\"><strong>" + label + ":</strong> none attached</p>";
    }
    return "<p class=\"rate-detail\"><strong>" + label + ":</strong> " +
        files.map(f => escapeHtml(f.name)).join(", ") + "</p>";
}

function renderReport(vo, project) {
    const a = analyse(vo, project);
    const certifiedCell = (vo.certifiedStatus === "Approved" &&
        vo.finalPrice !== null && vo.finalPrice !== undefined && vo.finalPrice !== "")
        ? rm(vo.finalPrice)
        : "—";

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

    const clauseBlock = a.clause
        ? "<p><strong>" + escapeHtml(a.clause.form + " " + a.clause.ref + " — " +
            a.clause.title) + "</strong></p><p class=\"rate-detail\">" +
            escapeHtml(a.clause.entitlement) + "</p><p class=\"rate-detail\">" +
            "<strong>Evidence required:</strong> " + escapeHtml(a.clause.evidence) + "</p>"
        : "<p class=\"rate-detail\">No governing clause identified from the description.</p>";

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

      "<h3>2. Classification</h3>" +
      "<p>" + escapeHtml(a.classification.label) +
        " affecting <strong>" + escapeHtml(a.classification.affectedWork) + "</strong></p>" +

      "<h3>3. Contractual basis</h3>" + clauseBlock +

      "<h3>4. Measurement and valuation</h3>" +
      '<div class="table-scroll"><table><thead><tr>' +
        "<th>#</th><th>DESCRIPTION</th><th>UNIT</th><th>QTY</th><th>RATE</th>" +
        "<th>CLAIMED</th><th>ASSESSED</th><th>RATE CROSS-CHECK</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +

      '<div class="report-totals">' +
        "<div><small>Contractor claimed</small><strong>" + rm(a.contractorTotal) + "</strong></div>" +
        "<div><small>Consultant assessed</small><strong>" + rm(a.assessedTotal) + "</strong></div>" +
        "<div><small>Variance</small><strong>" + rm(a.variance) + "</strong></div>" +
        "<div><small>Certified value</small><strong>" + certifiedCell + "</strong></div>" +
      "</div>" +

      "<h3>5. Findings</h3>" +
      (a.findings.length === 0 ? "<p>Nothing flagged.</p>"
        : a.findings.map(f => '<div class="finding"><span>' + escapeHtml(f) +
                              "</span></div>").join("")) +

      "<h3>6. Time impact</h3>" +
      "<p>" + (Number(vo.timeImpact) || 0) + " day(s) claimed extension of time.</p>" +

      "<h3>7. Supporting documents</h3>" +
      docList(vo.revisedDrawing, "Revised drawings") +
      docList(vo.oldDrawing, "Superseded drawings") +
      docList(vo.supportingDocs, "Supporting documents") +

      "<h3>8. Status</h3>" +
      "<p>Consultant evaluation: <strong>" + escapeHtml(vo.evaluateStatus) + "</strong><br>" +
      "Client certification: <strong>" + escapeHtml(vo.certifiedStatus) + "</strong></p>" +
      (vo.assessmentNote ? '<p class="rate-detail"><strong>Consultant\'s assessment:</strong> ' +
        escapeHtml(vo.assessmentNote) + "</p>" : "") +

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

if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderReport };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("report", "VO Report", "VO-AI / VO Reports");
        if (!ctx) return;
        const { project } = ctx;

        const voId = new URLSearchParams(location.search).get("id");
        const host = document.getElementById("reportHost");
        const picker = document.getElementById("voPicker");

        picker.innerHTML = (project.vos || []).map(v =>
            '<option value="' + escapeHtml(v.id) + '"' + (v.id === voId ? " selected" : "") +
            ">" + escapeHtml(v.no + " — " + (v.description || "Untitled")) + "</option>"
        ).join("");

        function show(id) {
            const vo = (project.vos || []).find(v => v.id === id) || project.vos[0];
            if (!vo) { host.innerHTML = '<div class="empty-state">No VOs to report on.</div>'; return; }
            host.innerHTML = renderReport(vo, project);
        }

        picker.addEventListener("change", () => show(picker.value));
        document.getElementById("printBtn").addEventListener("click", () => window.print());
        show(voId || (project.vos[0] || {}).id);
    })();
}
