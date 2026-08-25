/* VO-AI | page-register.js — the VO register, in the template's column order. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, voValue, today } = require("./calc.js");
    var { statusPill, escapeHtml } = require("./ui.js");
    var { FIELD_OWNER } = require("./permissions.js");
    var { rateSummary } = require("./analysis.js");
    var { deadlinesFor } = require("./deadlines.js");
    var { t } = require("./i18n.js");
}

/* typeOfInstruction is a raw English data VALUE — never renamed; see
   optionDisplayText() in js/page-vo.js for the same pattern. */
function instructionTypeLabel(value) {
    if (!value) return value;
    const key = "instructionType." + value;
    const label = t(key, {});
    return label === key ? value : label;
}

/* The VO DUE DATE column: if the consultant has entered a due date by
   hand, show that (marked manual). Otherwise fall back to the computed
   evaluation deadline from js/deadlines.js, with its state. */
function dueDateCell(vo, todayIso) {
    if (vo.dueDate) {
        return prettyDate(vo.dueDate) + ' <span class="rate-flag manual-due">' + escapeHtml(t("register.manual")) + '</span>';
    }
    const evalClock = deadlinesFor(vo, todayIso)[0]; /* "evaluation" is always item 0 */
    if (!evalClock.dueDate) return "—";
    return prettyDate(evalClock.dueDate) +
        ' <span class="rate-flag deadline-' + evalClock.state + '">' +
        escapeHtml(t("deadline.state." + evalClock.state, {})) + "</span>";
}

function rateFlags(vo, project) {
    const s = rateSummary(vo, (project && project.bq) || []);
    const bits = [];
    if (s.same) bits.push('<span class="rate-flag same">' + escapeHtml(t("register.rate.same", { n: s.same })) + "</span>");
    if (s.different) bits.push('<span class="rate-flag different">' + escapeHtml(t("register.rate.different", { n: s.different })) + "</span>");
    if (s.star) bits.push('<span class="rate-flag star">' + escapeHtml(t("register.rate.star", { n: s.star })) + "</span>");
    return bits.join(" ") || "—";
}

/* `label` stays the English source of truth for callers that read
   COLUMNS without going through js/i18n.js's t(); rendering always
   prefers t(labelKey) so the header follows the current language. */
const COLUMNS = [
    { field: "no",                label: "VO NO.",           labelKey: "register.col.no",
      render: v => "<strong>" + escapeHtml(v.no) + "</strong>" },
    { field: "description",       label: "DESCRIPTION",      labelKey: "register.col.description",
      render: v => escapeHtml(v.description || "—") },
    { field: "dateIssued",        label: "DATE ISSUED",      labelKey: "register.col.dateIssued",
      render: v => prettyDate(v.dateIssued) },
    { field: "dueDate",           label: "VO DUE DATE",      labelKey: "register.col.dueDate",
      render: v => dueDateCell(v, today()) },
    { field: "typeOfInstruction", label: "TYPE",             labelKey: "register.col.type",
      render: v => escapeHtml(instructionTypeLabel(v.typeOfInstruction) || "—") },
    { field: "measurement",       label: "CONTRACTOR'S MEASUREMENT", labelKey: "register.col.contractorMeasurement",
      render: v => rm(contractorTotal(v)) },
    { field: "assessment",        label: "CONSULTANT'S ASSESSMENT",  labelKey: "register.col.consultantAssessment",
      render: v => rm(assessedTotal(v)) },
    { field: "rateCheck",         label: "RATE CROSS-CHECK", labelKey: "register.col.rateCheck",
      render: (v, p) => rateFlags(v, p) },
    { field: "timeImpact",        label: "TIME IMPACT",      labelKey: "register.col.timeImpact",
      render: v => t("register.dayUnit", { n: Number(v.timeImpact) || 0 }) },
    { field: "evaluateStatus",    label: "EVALUATE STATUS",  labelKey: "register.col.evaluateStatus",
      render: v => statusPill(v.evaluateStatus) },
    { field: "certifiedStatus",   label: "CERTIFIED STATUS", labelKey: "register.col.certifiedStatus",
      render: v => statusPill(v.certifiedStatus) },
    { field: "finalPrice",        label: "FINAL PRICE",      labelKey: "register.col.finalPrice",
      render: v => (v.finalPrice === null || v.finalPrice === "" ? "—" : rm(v.finalPrice)) }
];

/* Every role sees every column — the template only restricts *editing*. */
function columnsForRole(role) {
    return COLUMNS;
}

function renderRegisterHead(role) {
    return "<tr>" + COLUMNS.map(c => {
        const owned = FIELD_OWNER[c.field] === role;
        return "<th" + (owned ? ' class="owned-col"' : "") + ">" + escapeHtml(t(c.labelKey)) + "</th>";
    }).join("") + "</tr>";
}

function renderRegisterBody(project, role) {
    const vos = (project && project.vos) || [];
    if (vos.length === 0) {
        return '<tr><td colspan="' + COLUMNS.length + '" class="empty-state">' +
               escapeHtml(t("register.empty")) + "</td></tr>";
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
    module.exports = { COLUMNS, columnsForRole, renderRegisterHead, renderRegisterBody, dueDateCell };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", t("nav.register"), t("crumb.register"));
        if (!ctx) return;
        const { session, project } = ctx;

        document.getElementById("registerHead").innerHTML = renderRegisterHead(session.role);
        document.getElementById("registerBody").innerHTML =
            renderRegisterBody(project, session.role);

        document.getElementById("ownedLegend").textContent =
            t("register.legend", { role: t("role." + session.role + ".label", {}) });

        document.querySelectorAll(".vo-row").forEach(row => {
            row.addEventListener("click", () => {
                window.location.href = "vo.html?id=" + encodeURIComponent(row.dataset.vo);
            });
        });
    })();
}
