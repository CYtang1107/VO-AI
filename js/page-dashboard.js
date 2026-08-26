/* VO-AI | page-dashboard.js — Stage 4 landing screen, per role. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, voValue, projectStats, today } = require("./calc.js");
    var { statusPill, escapeHtml } = require("./ui.js");
    var { deadlineSummary } = require("./deadlines.js");
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
    return bits.join(", ") + ".";
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

    if (role === "consultant") {
        const awaitingAssessment = vos
            .filter(v => v.submitted &&
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
        .filter(v => v.evaluateStatus === "Approved" && v.certifiedStatus === "Pending")
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
            "<td><strong class=\"item-code\">" + escapeHtml(v.no) + "</strong></td>" +
            "<td>" + escapeHtml(v.description || "—") + "</td>" +
            "<td>" + prettyDate(v.dateIssued) + "</td>" +
            "<td>" + rm(voValue(v)) + "</td>" +
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
            newBtn.addEventListener("click", () => {
                const vo = createVO(project.id, session);
                window.location.href = "vo.html?id=" + encodeURIComponent(vo.id);
            });
        }
    })();
}
