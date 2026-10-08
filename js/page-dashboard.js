/* VO-AI | page-dashboard.js — Stage 4 landing screen, per role. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, voValue, projectStats, today } = require("./calc.js");
    var { statusPill, escapeHtml, seedText } = require("./ui.js");
    var { deadlineSummary } = require("./deadlines.js");
    var { voStage } = require("./permissions.js");
    var { t } = require("./i18n.js");
}

/* A one-line "where do my contractual deadlines stand" summary for the
   signed-in role, e.g. "2 VOs awaiting evaluation, 1 overdue." Built
   from deadlineSummary() — the client owns none of the three clocks,
   so its summary text is intentionally the empty string. */
function deadlinePositionText(project, role, todayIso) {
    const summary = deadlineSummary(project, role, todayIso);
    const outstanding = summary.items.filter(i => !i.satisfied && i.state !== "not-started");
    if (outstanding.length === 0) return "";
    const bits = [t("dashboard.deadline.outstanding", { n: outstanding.length })];
    if (summary.overdue > 0) bits.push(t("dashboard.deadline.overdue", { n: summary.overdue }));
    if (summary.dueSoon > 0) bits.push(t("dashboard.deadline.dueSoon", { n: summary.dueSoon }));
    return bits.join(t("common.clauseSep")) + t("common.fullStop");
}

/* What does this role have to do next? Each VO whose stage is this
   role's (voStage, js/permissions.js), with what to do; the contractor's
   own drafts too. */
var ACTION_STAGES = {
    contractor: ["describe", "designRejected", "measure", "info", "rejected"],
    administrator: ["design"],
    consultant: ["consultant"],
    client: ["client"]
};

function actionItems(project, role) {
    const vos = project.vos || [];
    const mine = ACTION_STAGES[role] || [];
    const items = vos.filter(v => mine.indexOf(voStage(v)) !== -1)
        .map(v => ({ vo: v, text: t("dashboard.action.stage." + voStage(v)) }));
    if (role === "consultant") {
        /* the client asking the consultant for further information: no
           clock of its own, listed so the consultant notices it */
        vos.filter(v => !!v.clientInfoRequestedAt).forEach(v => items.push({ vo: v,
            text: v.clientInfoRequestNote
                ? t("dashboard.action.clientInfoRequested", { note: v.clientInfoRequestNote })
                : t("dashboard.action.clientInfoRequestedNoNote") }));
    }
    return items;
}

function renderRecentRows(vos) {
    const sorted = (vos || []).slice().sort((a, b) =>
        String(b.dateIssued || "").localeCompare(String(a.dateIssued || "")));

    if (sorted.length === 0) {
        return '<tr><td colspan="5" class="empty-state">' + escapeHtml(t("dashboard.recent.empty")) + '</td></tr>';
    }

    return sorted.slice(0, 6).map(v =>
        '<tr class="vo-row" data-vo="' + escapeHtml(v.id) + '" style="cursor:pointer">' +
            '<td class="nowrap"><strong class="item-code">' + escapeHtml(v.no) + "</strong></td>" +
            "<td>" + escapeHtml(seedText(v.description) || "—") + "</td>" +
            '<td class="nowrap">' + prettyDate(v.dateIssued) + "</td>" +
            '<td class="nowrap">' + rm(voValue(v)) + "</td>" +
            "<td>" + statusPill(v.evaluateStatus) + "</td>" +
        "</tr>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { actionItems, renderRecentRows, deadlinePositionText };
}

/* ---------- browser wiring ---------- */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("dashboard", t("nav.dashboard"), t("crumb.dashboard"));
        if (!ctx) return;

        const { session, project } = ctx;

        /* The breadcrumb must name the project, not the user — mountChrome
           resolves the project, so fill it in once we have it. */
        const crumbEl = document.querySelector(".breadcrumb");
        if (crumbEl) crumbEl.textContent = t("crumb.project", { name: project.name });


        document.getElementById("greeting").textContent =
            t("dashboard.greeting", { name: session.name });

        document.getElementById("recentBody").innerHTML = renderRecentRows(project.vos);

        const deadlineText = deadlinePositionText(project, session.role, today());
        const deadlineEl = document.getElementById("deadlineSummary");
        if (deadlineText) {
            deadlineEl.textContent = deadlineText;
            deadlineEl.style.display = "";
        } else {
            deadlineEl.style.display = "none";
        }

        document.querySelectorAll(".vo-row").forEach(row => {
            row.addEventListener("click", () => {
                window.location.href = "vo.html?id=" + encodeURIComponent(row.dataset.vo);
            });
        });

        /* The cost overview and S-curve (js/costplan.js): for the
           contractor, the design team and the client, not the consultant QS.
           The design team (who issues the interim certificates) and the client
           keep the programme and the certificates. */
        const costCard = document.querySelector(".cost-plan-card");
        if (costCard && !costOverviewVisible(session.role)) costCard.remove();
        /* with the cost overview, the VO register has the list: the
           dashboard keeps to the curve, the map and what needs you */
        if (costCard && costOverviewVisible(session.role)) document.body.classList.add("dash-has-cost");
        const costHost = document.getElementById("costPlanBody");
        const costEditable = costOverviewEditable(session.role);
        /* the S-curve zoomed to date, or the whole programme: this viewer's choice */
        let costRange = "toDate";
        try { if (localStorage.getItem("voai.scRange.v1") === "all") costRange = "all"; } catch (e) { /* default */ }
        /* the S-curve's height: what is left of the screen under the card's
           first lines, so the whole curve shows when the page opens (the
           chart keeps its own limits on a very short or very tall screen) */
        function chartHeight() {
            if (window.innerWidth <= 760) return null; /* a phone: the chart's own height */
            const top = costHost.getBoundingClientRect().top + window.scrollY;
            /* room under it for the status line, the five figures, the fold
               and the row below (the VO list and what needs you) */
            return window.innerHeight - top - 190 - 168;
        }
        function drawCost() {
            if (!costHost || typeof renderCostOverview !== "function") return;
            const p = getProject(project.id) || project;
            keepFolds(() => { costHost.innerHTML = renderCostOverview(p, today(), { editable: costEditable, width: costHost.clientWidth, height: chartHeight(), range: costRange }); });
            mountCostChart(costHost, viewCurve(sCurve(p, today()), costRange));
        }
        if (costHost) {
            costHost.addEventListener("change", e => {
                /* the EAC situation, and a fresh estimate to complete */
                if (costEditable && e.target.id === "evmMethod") {
                    updateProject(project.id, p => { p.eacMethod = e.target.value; });
                    drawCost();
                    return;
                }
                if (costEditable && e.target.id === "evmEtc") {
                    const v = e.target.value;
                    updateProject(project.id, p => { p.etcEstimate = v === "" ? null : Number(v); });
                    drawCost();
                    return;
                }
                if (!costEditable || (e.target.id !== "cpStart" && e.target.id !== "cpEnd")) return;
                const start = document.getElementById("cpStart").value, end = document.getElementById("cpEnd").value;
                if (start && end && end <= start) { toast(t("costplan.badProgramme"), "error"); return; }
                updateProject(project.id, p => { p.programme = { start: start, end: end }; });
                drawCost();
            });
            costHost.addEventListener("click", e => {
                const rangeBtn = e.target.closest(".sc-range-btn");
                if (rangeBtn) {
                    costRange = rangeBtn.dataset.range;
                    try { localStorage.setItem("voai.scRange.v1", costRange); } catch (err) { /* not kept */ }
                    drawCost();
                    return;
                }
                if (!costEditable) return;
                if (e.target.id === "cpCertAdd") {
                    const date = document.getElementById("cpCertDate").value;
                    const amount = Number(document.getElementById("cpCertAmount").value);
                    if (!date || !(amount > 0)) { toast(t("costplan.badCert"), "error"); return; }
                    const actualRaw = document.getElementById("cpCertActual").value;
                    const cert = { date: date, amount: amount };
                    if (actualRaw !== "" && Number(actualRaw) >= 0) cert.actual = Number(actualRaw);
                    updateProject(project.id, p => { p.certificates = (p.certificates || []).concat([cert]); });
                    toast(t("costplan.certAdded"));
                    drawCost();
                }
                const rem = e.target.closest(".cp-cert-remove");
                if (rem) {
                    updateProject(project.id, p => {
                        const i = (p.certificates || []).findIndex(c => c.date === rem.dataset.date && String(c.amount) === rem.dataset.amount);
                        if (i >= 0) p.certificates.splice(i, 1);
                    });
                    drawCost();
                }
            });
            drawCost();
            /* redrawn at the new width when the window is resized */
            let costWidth = costHost.clientWidth, costTall = window.innerHeight, costTimer = null;
            window.addEventListener("resize", () => {
                clearTimeout(costTimer);
                costTimer = setTimeout(() => {
                    if (Math.abs(costHost.clientWidth - costWidth) > 40 || Math.abs(window.innerHeight - costTall) > 60) {
                        costWidth = costHost.clientWidth; costTall = window.innerHeight; drawCost();
                    }
                }, 200);
            });
        }

        /* Action list */
        const items = actionItems(project, session.role);
        document.getElementById("actionList").innerHTML = items.length === 0
            ? '<div class="empty-state">' + escapeHtml(t("dashboard.action.empty")) + '</div>'
            : items.map(i =>
                '<a class="finding" style="text-decoration:none;color:inherit" ' +
                'href="vo.html?id=' + encodeURIComponent(i.vo.id) + '">' +
                "<span><strong class=\"item-code\">" + escapeHtml(i.vo.no) + "</strong> — " +
                escapeHtml(i.text) + "</span></a>"
            ).join("");

        /* The contract sets the clocks shown here (js/deadlines.js);
           read it the first time, then show the page again with it. */
        if (typeof ensureContractReadings === "function") {
            ensureContractReadings(project.id, null).then(changed => { if (changed) location.reload(); });
        }

        /* The site map (js/sitemap.js): the consultant sets the site's
           location; everyone sees it and where each site photo was taken. */
        const mapHost = document.getElementById("siteMapBody");
        if (mapHost && typeof drawSiteMap === "function") {
            drawSiteMap(mapHost, getProject(project.id) || project, {
                canSetSite: session.role === "consultant",
                onSiteSaved: site => {
                    updateProject(project.id, p => { p.site = site; });
                    toast(t("map.siteSaved"));
                }
            });
        }
    })();
}
