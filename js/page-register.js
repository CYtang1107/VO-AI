/* VO-AI | page-register.js — the VO register, in the template's column order. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, voValue } = require("./calc.js");
    var { statusPill, escapeHtml } = require("./ui.js");
    var { FIELD_OWNER } = require("./permissions.js");
    var { rateSummary } = require("./analysis.js");
}

function rateFlags(vo, project) {
    const s = rateSummary(vo, (project && project.bq) || []);
    const bits = [];
    if (s.same) bits.push('<span class="rate-flag same">' + s.same + " same</span>");
    if (s.different) bits.push('<span class="rate-flag different">' + s.different + " different</span>");
    if (s.star) bits.push('<span class="rate-flag star">' + s.star + " star</span>");
    return bits.join(" ") || "—";
}

const COLUMNS = [
    { field: "no",                label: "VO NO.",           render: v => "<strong>" + escapeHtml(v.no) + "</strong>" },
    { field: "description",       label: "DESCRIPTION",      render: v => escapeHtml(v.description || "—") },
    { field: "dateIssued",        label: "DATE ISSUED",      render: v => prettyDate(v.dateIssued) },
    { field: "dueDate",           label: "VO DUE DATE",      render: v => prettyDate(v.dueDate) },
    { field: "typeOfInstruction", label: "TYPE",             render: v => escapeHtml(v.typeOfInstruction || "—") },
    { field: "measurement",       label: "CONTRACTOR'S MEASUREMENT", render: v => rm(contractorTotal(v)) },
    { field: "assessment",        label: "CONSULTANT'S ASSESSMENT",  render: v => rm(assessedTotal(v)) },
    { field: "rateCheck",         label: "RATE CROSS-CHECK", render: (v, p) => rateFlags(v, p) },
    { field: "timeImpact",        label: "TIME IMPACT",      render: v => (Number(v.timeImpact) || 0) + " d" },
    { field: "evaluateStatus",    label: "EVALUATE STATUS",  render: v => statusPill(v.evaluateStatus) },
    { field: "certifiedStatus",   label: "CERTIFIED STATUS", render: v => statusPill(v.certifiedStatus) },
    { field: "finalPrice",        label: "FINAL PRICE",
      render: v => (v.finalPrice === null || v.finalPrice === "" ? "—" : rm(v.finalPrice)) }
];

/* Every role sees every column — the template only restricts *editing*. */
function columnsForRole(role) {
    return COLUMNS;
}

function renderRegisterHead(role) {
    return "<tr>" + COLUMNS.map(c => {
        const owned = FIELD_OWNER[c.field] === role;
        return "<th" + (owned ? ' class="owned-col"' : "") + ">" + c.label + "</th>";
    }).join("") + "</tr>";
}

function renderRegisterBody(project, role) {
    const vos = (project && project.vos) || [];
    if (vos.length === 0) {
        return '<tr><td colspan="' + COLUMNS.length + '" class="empty-state">' +
               "No variation orders in this project yet.</td></tr>";
    }
    return vos.map(v =>
        '<tr class="vo-row" data-vo="' + escapeHtml(v.id) + '" style="cursor:pointer">' +
        COLUMNS.map(c => {
            const owned = FIELD_OWNER[c.field] === role;
            return "<td" + (owned ? ' class="owned-col"' : "") + ">" +
                   c.render(v, project) + "</td>";
        }).join("") + "</tr>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { COLUMNS, columnsForRole, renderRegisterHead, renderRegisterBody };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", "VO Register", "VO-AI / VO Register");
        if (!ctx) return;
        const { session, project } = ctx;

        document.getElementById("registerHead").innerHTML = renderRegisterHead(session.role);
        document.getElementById("registerBody").innerHTML =
            renderRegisterBody(project, session.role);

        document.getElementById("ownedLegend").textContent =
            "Highlighted columns are the ones you may edit as " +
            (session.role === "contractor" ? "Contractor QS"
             : session.role === "consultant" ? "Consultant QS" : "Client");

        document.querySelectorAll(".vo-row").forEach(row => {
            row.addEventListener("click", () => {
                window.location.href = "vo.html?id=" + encodeURIComponent(row.dataset.vo);
            });
        });
    })();
}
