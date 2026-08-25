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

/* Pure, DOM-free filter matcher for the register's search + status
   filters. `query` matches the VO number, description and instruction
   reference, case-insensitively; `evaluateStatus`/`certifiedStatus`
   ("all" or a specific status value) narrow by the two status columns.
   Returns everything when no filter is set, and an empty array when
   nothing matches — the caller decides what empty state to show. */
function filterVos(vos, filters) {
    const f = filters || {};
    const query = String(f.query || "").trim().toLowerCase();
    const evaluateStatus = f.evaluateStatus || "all";
    const certifiedStatus = f.certifiedStatus || "all";

    return (vos || []).filter(v => {
        if (evaluateStatus !== "all" && v.evaluateStatus !== evaluateStatus) return false;
        if (certifiedStatus !== "all" && v.certifiedStatus !== certifiedStatus) return false;
        if (query) {
            const haystack = [v.no, v.description, v.instructionNo]
                .map(s => String(s || "").toLowerCase())
                .join(" \n ");
            if (!haystack.includes(query)) return false;
        }
        return true;
    });
}

function renderRegisterHead(role) {
    return "<tr>" + COLUMNS.map(c => {
        const owned = FIELD_OWNER[c.field] === role;
        return "<th" + (owned ? ' class="owned-col"' : "") + ">" + escapeHtml(t(c.labelKey)) + "</th>";
    }).join("") + "</tr>";
}

/* `opts.vos`, when given, is the already-filtered list to render (from
   filterVos()) — falls back to every VO on the project. `opts.filtered`
   tells the empty state whether the project genuinely has no VOs at all
   (the honest "no variation orders yet" message) or whether the search
   and status filters above simply matched nothing (a different, equally
   honest message that never claims the register is empty). */
function renderRegisterBody(project, role, opts) {
    const allVos = (project && project.vos) || [];
    const o = opts || {};
    const vos = o.vos || allVos;
    if (vos.length === 0) {
        const filteredEmpty = !!o.filtered && allVos.length > 0;
        return '<tr><td colspan="' + COLUMNS.length + '" class="empty-state">' +
               escapeHtml(t(filteredEmpty ? "register.emptyFiltered" : "register.empty")) +
               "</td></tr>";
    }
    return vos.map(v =>
        '<tr class="vo-row" data-vo="' + escapeHtml(v.id) + '" style="cursor:pointer">' +
        COLUMNS.map(c => {
            const owned = FIELD_OWNER[c.field] === role;
            /* VO NO. and DESCRIPTION double as the card heading at narrow
               widths (see .register-scroll in style.css) — everything
               else renders as a labelled pair via data-label + ::before. */
            const heading = c.field === "no" || c.field === "description";
            const classes = [];
            if (owned) classes.push("owned-col");
            if (heading) classes.push("card-heading");
            const cls = classes.length ? ' class="' + classes.join(" ") + '"' : "";
            return "<td" + cls + ' data-label="' + escapeHtml(t(c.labelKey)) + '">' +
                   c.render(v, project) + "</td>";
        }).join("") + "</tr>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        COLUMNS, columnsForRole, renderRegisterHead, renderRegisterBody, dueDateCell, filterVos
    };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", t("nav.register"), t("crumb.register"));
        if (!ctx) return;
        const { session, project } = ctx;

        const allVos = (project && project.vos) || [];

        document.getElementById("registerHead").innerHTML = renderRegisterHead(session.role);

        document.getElementById("ownedLegend").textContent =
            t("register.legend", { role: t("role." + session.role + ".label", {}) });

        const searchInput = document.getElementById("registerSearch");
        const evalSelect = document.getElementById("registerEvalFilter");
        const certSelect = document.getElementById("registerCertFilter");
        const clearBtn = document.getElementById("registerClearFilters");
        const countEl = document.getElementById("registerResultCount");

        function wireRows() {
            document.querySelectorAll(".vo-row").forEach(row => {
                row.addEventListener("click", () => {
                    window.location.href = "vo.html?id=" + encodeURIComponent(row.dataset.vo);
                });
            });
        }

        function currentFilters() {
            return {
                query: searchInput ? searchInput.value : "",
                evaluateStatus: evalSelect ? evalSelect.value : "all",
                certifiedStatus: certSelect ? certSelect.value : "all"
            };
        }

        function isActive(filters) {
            return !!(filters.query && filters.query.trim()) ||
                filters.evaluateStatus !== "all" || filters.certifiedStatus !== "all";
        }

        function render() {
            const filters = currentFilters();
            const active = isActive(filters);
            const filtered = filterVos(allVos, filters);

            document.getElementById("registerBody").innerHTML =
                renderRegisterBody(project, session.role, { vos: filtered, filtered: active });
            wireRows();

            if (countEl) {
                countEl.textContent = t("register.resultCount", { n: filtered.length, total: allVos.length });
            }
            if (clearBtn) clearBtn.hidden = !active;
        }

        if (searchInput) searchInput.addEventListener("input", render);
        if (evalSelect) evalSelect.addEventListener("change", render);
        if (certSelect) certSelect.addEventListener("change", render);
        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                if (searchInput) searchInput.value = "";
                if (evalSelect) evalSelect.value = "all";
                if (certSelect) certSelect.value = "all";
                render();
            });
        }

        render();
    })();
}
