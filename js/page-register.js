/* VO-AI | page-register.js — the VO register, in the template's column order. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, voValue, today, projectStats } = require("./calc.js");
    var { statusPill, escapeHtml, seedText, renderStatCards } = require("./ui.js");
    var { FIELD_OWNER, voStage } = require("./permissions.js");
    var { rateSummary } = require("./analysis.js");
    var { deadlinesFor } = require("./deadlines.js");
    var { t, voNoLabel } = require("./i18n.js");
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
function dueDateCell(vo, todayIso, project) {
    if (vo.dueDate) {
        return prettyDate(vo.dueDate) + ' <span class="rate-flag manual-due">' + escapeHtml(t("register.manual")) + '</span>';
    }
    const evalClock = deadlinesFor(vo, todayIso, project)[0]; /* "evaluation" is always item 0 */
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
    if (s.norate) bits.push('<span class="rate-flag norate">' + escapeHtml(t("register.rate.norate", { n: s.norate })) + "</span>");
    if (s.unchecked) bits.push('<span class="rate-flag unchecked">' + escapeHtml(t("register.rate.unchecked", { n: s.unchecked })) + "</span>");
    return bits.join(" ") || "—";
}

/* `compact` columns make the short VO list beside the site map; the rest
   show with "Show all columns" (the full register, in the template's order). */
/* `label` stays the English source of truth for callers that read
   COLUMNS without going through js/i18n.js's t(); rendering always
   prefers t(labelKey) so the header follows the current language. */
const COLUMNS = [
    { field: "no", compact: true,                label: "VO NO.",           labelKey: "register.col.no",
      render: v => "<strong>" + escapeHtml(voNoLabel(v.no)) + "</strong>" },
    { field: "description", compact: true,       label: "DESCRIPTION",      labelKey: "register.col.description",
      render: v => escapeHtml(seedText(v.description) || "—") },
    { field: "dateIssued",        label: "DATE ISSUED",      labelKey: "register.col.dateIssued",
      render: v => prettyDate(v.dateIssued) },
    { field: "dueDate",           label: "VO DUE DATE",      labelKey: "register.col.dueDate",
      render: (v, p) => dueDateCell(v, today(), p) },
    { field: "typeOfInstruction", label: "TYPE",             labelKey: "register.col.type",
      render: v => escapeHtml(v.issuedInstruction ? t("instr.kind." + v.issuedInstruction.kind) : (instructionTypeLabel(v.typeOfInstruction) || "—")) },
    { field: "measurement", compact: true,       label: "CONTRACTOR'S MEASUREMENT", labelKey: "register.col.contractorMeasurement",
      render: v => rm(contractorTotal(v)) },
    { field: "assessment",        label: "CONSULTANT'S ASSESSMENT",  labelKey: "register.col.consultantAssessment",
      render: v => rm(assessedTotal(v)) },
    { field: "rateCheck",         label: "RATE CROSS-CHECK", labelKey: "register.col.rateCheck",
      render: (v, p) => rateFlags(v, p) },
    /* where the VO is: the step it has reached, and how it stands there */
    { field: "step", compact: true,              label: "STAGE",            labelKey: "register.col.step",
      render: v => stepCell(v) },
    { field: "state", compact: true,             label: "STATUS",           labelKey: "register.col.state",
      render: (v, p, role) => statePill(v, role) },
    { field: "finalPrice",        label: "FINAL PRICE",      labelKey: "register.col.finalPrice",
      render: v => (v.finalPrice === null || v.finalPrice === "" ? "—" : rm(v.finalPrice)) },
    /* the contract administrator's two steps: instruction, certification */
    { field: "caCertifiedStatus", label: "DESIGN TEAM", labelKey: "register.col.administrator",
      render: v => '<span class="ca-pills">' +
          statusPill(v.instructionStatus || (v.submitted ? "Confirmed" : "Pending")) +
          statusPill(v.caCertifiedStatus || (v.evaluateStatus === "Approved" ? "Certified" : "Pending")) + "</span>" }
];

/* Every role sees every column — the template only restricts *editing*. */
/* The client sees only VOs the consultant QS has passed on (clientSees,
   js/store.js): the step is always the last one, so only the status. */
function columnsForRole(role) {
    return role === "client" ? COLUMNS.filter(c => c.field !== "step") : COLUMNS;
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
    const step = f.step || "all";
    const state = f.state || "all";

    return (vos || []).filter(v => {
        if (step !== "all" && String(voStep(v)) !== String(step)) return false;
        if (state !== "all" && voState(v) !== state) return false;
        if (evaluateStatus !== "all" && v.evaluateStatus !== evaluateStatus) return false;
        if (certifiedStatus !== "all" && v.certifiedStatus !== certifiedStatus) return false;
        if (query) {
            const haystack = [v.no, voNoLabel(v.no), v.description, seedText(v.description), v.instructionNo]
                .map(s => String(s || "").toLowerCase())
                .join(" \n ");
            if (!haystack.includes(query)) return false;
        }
        return true;
    });
}

function renderRegisterHead(role) {
    return "<tr>" + columnsForRole(role).map(c => {
        const cls = [FIELD_OWNER[c.field] === role ? "owned-col" : "", c.compact ? "" : "col-extra", c.field === "step" ? "col-step" : ""].filter(Boolean);
        return "<th" + (cls.length ? ' class="' + cls.join(" ") + '"' : "") + ">" + escapeHtml(t(c.labelKey)) + "</th>";
    }).join("") + "</tr>";
}

/* The six steps (the VO page's workflow, the report's diagram) and the
   one a VO has reached (voStage, js/permissions.js). The contract check
   (2) is the contractor's draft once the contract agent has looked at it;
   a VO the design team returned is back at 1, one the consultant QS
   returned back at 4. */
var STEP_OF_STAGE = { describe: 1, designRejected: 1, design: 3, measure: 4, rejected: 4, info: 5, consultant: 5, client: 6, done: 6, closed: 6 };
var STEP_COUNT = 6;
function voStep(vo) {
    const stage = voStage(vo);
    if (stage === "describe" && vo.claimCheck && vo.claimCheck.verdict) return 2;
    return STEP_OF_STAGE[stage] || 1;
}

/* How it stands at that step: one status for the row. */
var STATE_CLASS = { draft: "draft", progress: "review", returned: "pending", info: "pending", approved: "approved", rejected: "rejected" };
function voState(vo) {
    switch (voStage(vo)) {
        case "done": return "approved";
        case "closed": return "rejected";
        case "designRejected": case "rejected": return "returned";
        case "info": return "info";
        case "describe": return "draft";
        default: return "progress";
    }
}

function stepCell(vo) {
    const n = voStep(vo);
    let dots = "";
    for (let i = 1; i <= STEP_COUNT; i++) dots += '<i class="' + (i <= n ? "on" : "") + '"></i>';
    return '<span class="step-cell" title="' + escapeHtml(t("register.stepOf", { n: n, total: STEP_COUNT })) + '">' +
        '<span class="step-dots" aria-hidden="true">' + dots + "</span>" +
        "<span>" + n + " " + escapeHtml(t("register.step." + n)) + "</span></span>";
}

function statePill(vo, role) {
    const s = voState(vo);
    /* for the client, a VO with them is waiting for their approval */
    if (role === "client" && s === "progress") return '<span class="status pending">' + escapeHtml(t("register.state.awaitingYou")) + "</span>";
    return '<span class="status ' + STATE_CLASS[s] + '">' + escapeHtml(t("register.state." + s)) + "</span>";
}

/* Where a VO stands, for the coloured edge of its card on a phone:
   certified, rejected, with the consultant or client, or a draft. */
function rowStage(vo) {
    if (vo.certifiedStatus === "Approved") return "stage-done";
    if (vo.certifiedStatus === "Rejected" || vo.evaluateStatus === "Rejected") return "stage-rejected";
    return vo.submitted ? "stage-progress" : "stage-draft";
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
        return '<tr><td colspan="' + columnsForRole(role).length + '" class="empty-state">' +
               escapeHtml(t(filteredEmpty ? "register.emptyFiltered" : "register.empty")) +
               "</td></tr>";
    }
    return vos.map(v =>
        '<tr class="vo-row ' + rowStage(v) + '" data-vo="' + escapeHtml(v.id) + '" style="cursor:pointer">' +
        columnsForRole(role).map(c => {
            const owned = FIELD_OWNER[c.field] === role;
            /* VO NO. and DESCRIPTION double as the card heading at narrow
               widths (see .register-scroll in style.css) — everything
               else renders as a labelled pair via data-label + ::before. */
            const heading = c.field === "no" || c.field === "description";
            const classes = [];
            if (owned) classes.push("owned-col");
            if (heading) classes.push("card-heading");
            if (!c.compact) classes.push("col-extra");
            if (c.field === "step") classes.push("col-step");
            const cls = classes.length ? ' class="' + classes.join(" ") + '"' : "";
            const stage = c.field === "no" ? ' data-stage="' + escapeHtml(t("register.stage." + rowStage(v))) + '"' : "";
            return "<td" + cls + stage + ' data-label="' + escapeHtml(t(c.labelKey)) + '">' +
                   c.render(v, project, role) + "</td>";
        }).join("") + "</tr>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        renderStatCards,
        COLUMNS, columnsForRole, renderRegisterHead, renderRegisterBody, dueDateCell, filterVos, rowStage, voStep, voState
    };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", t("nav.register"), t("crumb.register"));
        if (ctx && document.getElementById("statCards")) {
            document.getElementById("statCards").innerHTML = renderStatCards(projectStats(ctx.project), ctx.session.role);
        }
        /* Only the contractor raises a new VO. Its first step is the site
           photos (js/media.js), which used to be their own page. The phone's
           camera tab opens this page with ?new=1. */
        if (ctx && ctx.session.role === "contractor") {
            const newBtn = document.getElementById("newVoBtn");
            newBtn.hidden = false;
            const start = () => {
                const vo = createVO(ctx.project.id, ctx.session);
                window.location.replace("vo.html?id=" + encodeURIComponent(vo.id));
            };
            newBtn.addEventListener("click", start);
            if (/[?&]new=1\b/.test(location.search)) { start(); return; }
        }
        if (!ctx) return;
        const { session, project } = ctx;

        const allVos = (project && project.vos) || [];

        document.getElementById("registerHead").innerHTML = renderRegisterHead(session.role);

        /* The whole register — every VO and every measured item, whatever
           the filters show — as an Excel workbook (js/xlsxexport.js). */
        const exportBtn = document.getElementById("registerExportBtn");
        if (exportBtn) {
            exportBtn.addEventListener("click", () => {
                const fresh = getProject(project.id) || project;
                const day = today();
                const blob = new Blob([buildRegisterWorkbook(fresh, day)],
                    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = registerFileName(fresh, day);
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                toast(t("export.done"));
            });
        }

        /* the short list, or every column of the register (this browser remembers) */
        const layout = document.getElementById("registerLayout");
        const colsBtn = document.getElementById("registerColsBtn");
        function showAllCols(on) {
            layout.classList.toggle("all-cols", on);
            colsBtn.setAttribute("aria-pressed", String(on));
            colsBtn.textContent = t(on ? "register.fewerColumns" : "register.allColumns");
        }
        let allCols = false;
        try { allCols = localStorage.getItem("voai.registerCols.v1") === "all"; } catch (e) { /* default */ }
        showAllCols(allCols);
        colsBtn.addEventListener("click", () => {
            allCols = !allCols;
            showAllCols(allCols);
            try { localStorage.setItem("voai.registerCols.v1", allCols ? "all" : "short"); } catch (e) { /* not kept */ }
        });

        /* The site map (js/sitemap.js), as on the dashboard */
        const mapHost = document.getElementById("siteMapBody");
        let mapApi = null;
        /* the VOs with a photo on the map: their rows get a 📍 */
        const onMap = new Set(typeof photoPins === "function" ? photoPins(project).map(p => p.voId) : []);
        if (mapHost && typeof drawSiteMap === "function") {
            const voById = id => allVos.find(v => v.id === id);
            drawSiteMap(mapHost, getProject(project.id) || project, {
                canSetSite: session.role === "consultant",
                onSiteSaved: site => {
                    updateProject(project.id, p => { p.site = site; });
                    toast(t("map.siteSaved"));
                },
                stageOf: id => voById(id) ? rowStage(voById(id)) : "",
                infoOf: id => {
                    const v = voById(id);
                    return v ? { description: seedText(v.description) || "", amount: t("map.claimed", { amount: rm(contractorTotal(v)) }),
                                 step: t("register.stage." + rowStage(v)) } : null;
                },
                /* a pin opened: its row is marked in the list */
                onPinVo: id => {
                    document.querySelectorAll(".vo-row.vo-row-active").forEach(r => r.classList.remove("vo-row-active"));
                    const row = document.querySelector('.vo-row[data-vo="' + CSS.escape(id) + '"]');
                    if (row) { row.classList.add("vo-row-active"); row.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
                }
            }).then(api => { mapApi = api; if (mapApi) mapApi.filter(filterVos(allVos, currentFilters()).map(v => v.id)); });
        }

        document.getElementById("ownedLegend").textContent =
            t("register.legend", { role: t("role." + session.role + ".label", {}) });

        const searchInput = document.getElementById("registerSearch");
        const evalSelect = document.getElementById("registerEvalFilter");
        const certSelect = document.getElementById("registerCertFilter");
        /* the client: no stage, and only the statuses a VO can have with them */
        if (session.role === "client") {
            if (evalSelect) { evalSelect.value = "all"; evalSelect.closest("label").style.display = "none"; }
            if (certSelect) [...certSelect.options].forEach(o => {
                if (["draft", "returned", "info"].includes(o.value)) o.remove();
                if (o.value === "progress") o.textContent = t("register.state.awaitingYou");
            });
        }
        const clearBtn = document.getElementById("registerClearFilters");
        const countEl = document.getElementById("registerResultCount");

        function wireRows() {
            document.querySelectorAll(".vo-row").forEach(row => {
                row.addEventListener("click", () => {
                    window.location.href = "vo.html?id=" + encodeURIComponent(row.dataset.vo);
                });
                /* 📍: show this VO on the site map (the row itself opens the VO) */
                if (!onMap.has(row.dataset.vo)) return;
                const cell = row.querySelector("td");
                const pin = document.createElement("button");
                pin.type = "button";
                pin.className = "link-button vo-locate";
                pin.textContent = "📍";
                pin.title = t("map.showOnMap");
                pin.setAttribute("aria-label", t("map.showOnMap"));
                pin.addEventListener("click", e => {
                    e.stopPropagation();
                    if (!mapApi) return;
                    mapHost.scrollIntoView({ block: "nearest", behavior: "smooth" });
                    mapApi.focusVo(row.dataset.vo);
                });
                if (cell) cell.appendChild(pin);
            });
        }

        function currentFilters() {
            return {
                query: searchInput ? searchInput.value : "",
                step: evalSelect ? evalSelect.value : "all",
                state: certSelect ? certSelect.value : "all"
            };
        }

        function isActive(filters) {
            return !!(filters.query && filters.query.trim()) ||
                filters.step !== "all" || filters.state !== "all";
        }

        function render() {
            const filters = currentFilters();
            const active = isActive(filters);
            const filtered = filterVos(allVos, filters);

            document.getElementById("registerBody").innerHTML =
                renderRegisterBody(project, session.role, { vos: filtered, filtered: active });
            wireRows();
            if (mapApi) mapApi.filter(filtered.map(v => v.id));

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
        /* The contract sets the clocks shown here (js/deadlines.js);
           read it the first time, then show the page again with it. */
        if (typeof ensureContractReadings === "function") {
            ensureContractReadings(project.id, null).then(changed => { if (changed) location.reload(); });
        }
    })();
}
