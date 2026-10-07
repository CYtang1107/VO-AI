/* VO-AI | page-dashboard.js — Stage 4 landing screen, per role. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, voValue, projectStats, today } = require("./calc.js");
    var { statusPill, escapeHtml, seedText } = require("./ui.js");
    var { deadlineSummary } = require("./deadlines.js");
    var { instructionConfirmed, caCertified } = require("./permissions.js");
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

/* What does this role have to do next? */
function actionItems(project, role) {
    const vos = project.vos || [];

    if (role === "contractor") {
        return vos
            .filter(v => !v.submitted || v.evaluateStatus === "Rejected")
            .map(v => ({
                vo: v,
                text: v.evaluateStatus === "Rejected"
                    ? t("dashboard.action.rejected")
                    : t("dashboard.action.draft")
            }));
    }

    if (role === "administrator") {
        /* ① submitted, its instruction not yet confirmed; ② approved by
           the consultant QS, not yet certified */
        const toConfirm = vos
            .filter(v => v.submitted && !instructionConfirmed(v))
            .map(v => ({ vo: v, text: t("dashboard.action.awaitingConfirm") }));
        const toCertify = vos
            .filter(v => v.evaluateStatus === "Approved" && !caCertified(v))
            .map(v => ({ vo: v, text: t("dashboard.action.awaitingCaCert") }));
        return toConfirm.concat(toCertify);
    }

    if (role === "consultant") {
        const awaitingAssessment = vos
            .filter(v => v.submitted && instructionConfirmed(v) &&
                (v.evaluateStatus === "Pending" || v.evaluateStatus === "Under Review"))
            .map(v => ({ vo: v, text: t("dashboard.action.awaitingAssessment") }));

        /* The client asking the consultant for further information (the
           mirror of the consultant's own info-request to the contractor)
           has no contractual clock of its own — it belongs on this list
           purely so the consultant notices it, not because it is overdue. */
        const clientInfoRequests = vos
            .filter(v => !!v.clientInfoRequestedAt)
            .map(v => ({
                vo: v,
                text: v.clientInfoRequestNote
                    ? t("dashboard.action.clientInfoRequested", { note: v.clientInfoRequestNote })
                    : t("dashboard.action.clientInfoRequestedNoNote")
            }));

        return awaitingAssessment.concat(clientInfoRequests);
    }

    return vos
        .filter(v => v.evaluateStatus === "Approved" && caCertified(v) && v.certifiedStatus === "Pending")
        .map(v => ({ vo: v, text: t("dashboard.action.awaitingCert") }));
}

function renderStatCards(stats, role) {
    const cards = [
        { icon: "▧", cls: "blue",   label: t("dashboard.stat.total"),     value: stats.total,
          note: t("dashboard.stat.totalNote", { n: stats.draft }) },
        { icon: "◷", cls: "orange", label: t("dashboard.stat.pending"), value: stats.pending,
          note: stats.pending > 0 ? t("dashboard.stat.pendingNoteWarn") : t("dashboard.stat.pendingNoteOk"), warn: stats.pending > 0 },
        { icon: "✓", cls: "green",  label: t("dashboard.stat.approved"),       value: stats.approved,
          note: t("dashboard.stat.approvedNote", { n: stats.certified }) },
        { icon: "RM", cls: "purple", label: t("dashboard.stat.value"), value: rm(stats.value),
          note: t("dashboard.stat.valueNote", { n: stats.timeImpact }) }
    ];

    return cards.map(c =>
        '<div class="stat-card">' +
            '<div class="stat-icon ' + c.cls + '">' + c.icon + "</div>" +
            "<div><p>" + c.label + "</p><h2>" + c.value + "</h2>" +
            '<small' + (c.warn ? ' class="warning"' : "") + ">" + escapeHtml(c.note) +
            "</small></div>" +
        "</div>"
    ).join("");
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
    module.exports = { actionItems, renderStatCards, renderRecentRows, deadlinePositionText };
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

        const stats = projectStats(project);

        document.getElementById("greeting").textContent =
            t("dashboard.greeting", { name: session.name });
        document.getElementById("greetingSub").innerHTML =
            t("dashboard.greetingSub", { name: "<strong>" + escapeHtml(project.name) + "</strong>" });

        document.getElementById("statCards").innerHTML = renderStatCards(stats, session.role);
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

        /* The cost overview and S-curve (js/costplan.js): everyone sees
           it; the consultant QS and the client keep the programme and the
           interim certificates. */
        const costHost = document.getElementById("costPlanBody");
        const costEditable = session.role === "consultant" || session.role === "client";
        function drawCost() {
            if (!costHost || typeof renderCostOverview !== "function") return;
            const p = getProject(project.id) || project;
            keepFolds(() => { costHost.innerHTML = renderCostOverview(p, today(), { editable: costEditable, width: costHost.clientWidth }); });
            mountCostChart(costHost, sCurve(p, today()));
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
            let costWidth = costHost.clientWidth, costTimer = null;
            window.addEventListener("resize", () => {
                clearTimeout(costTimer);
                costTimer = setTimeout(() => { if (Math.abs(costHost.clientWidth - costWidth) > 40) { costWidth = costHost.clientWidth; drawCost(); } }, 200);
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

        /* Only the contractor raises a new VO. */
        const newBtn = document.getElementById("newVoBtn");
        if (session.role !== "contractor") {
            newBtn.style.display = "none";
        } else {
            /* ...and can do it from site: photos first (capture.html). */
            document.getElementById("captureBtn").hidden = false;
            newBtn.addEventListener("click", () => {
                const vo = createVO(project.id, session);
                window.location.href = "vo.html?id=" + encodeURIComponent(vo.id);
            });
        }
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
