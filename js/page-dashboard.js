/* VO-AI | page-dashboard.js — Stage 4 landing screen, per role. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, voValue, projectStats } = require("./calc.js");
    var { statusPill, escapeHtml } = require("./ui.js");
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
                    ? "Rejected by the consultant — revise and submit again."
                    : "Draft — complete the measurement and submit to the consultant."
            }));
    }

    if (role === "consultant") {
        return vos
            .filter(v => v.submitted &&
                (v.evaluateStatus === "Pending" || v.evaluateStatus === "Under Review"))
            .map(v => ({ vo: v, text: "Awaiting your assessment and rate cross-check." }));
    }

    return vos
        .filter(v => v.evaluateStatus === "Approved" && v.certifiedStatus === "Pending")
        .map(v => ({ vo: v, text: "Approved by the consultant — awaiting your certification." }));
}

function renderStatCards(stats, role) {
    const cards = [
        { icon: "▧", cls: "blue",   label: "Total VOs",     value: stats.total,
          note: stats.draft + " still in draft" },
        { icon: "◷", cls: "orange", label: "Pending review", value: stats.pending,
          note: stats.pending > 0 ? "Requires attention" : "Nothing waiting", warn: stats.pending > 0 },
        { icon: "✓", cls: "green",  label: "Approved",       value: stats.approved,
          note: stats.certified + " certified by the client" },
        { icon: "RM", cls: "purple", label: "Total VO value", value: rm(stats.value),
          note: stats.timeImpact + " day(s) approved time impact" }
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
        return '<tr><td colspan="5" class="empty-state">No variation orders yet.</td></tr>';
    }

    return sorted.slice(0, 6).map(v =>
        '<tr class="vo-row" data-vo="' + escapeHtml(v.id) + '" style="cursor:pointer">' +
            "<td><strong>" + escapeHtml(v.no) + "</strong></td>" +
            "<td>" + escapeHtml(v.description || "—") + "</td>" +
            "<td>" + prettyDate(v.dateIssued) + "</td>" +
            "<td>" + rm(voValue(v)) + "</td>" +
            "<td>" + statusPill(v.evaluateStatus) + "</td>" +
        "</tr>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { actionItems, renderStatCards, renderRecentRows };
}

/* ---------- browser wiring ---------- */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("dashboard", "Dashboard", "VO-AI / Dashboard");
        if (!ctx) return;

        const { session, project } = ctx;

        /* The breadcrumb must name the project, not the user — mountChrome
           resolves the project, so fill it in once we have it. */
        const crumbEl = document.querySelector(".breadcrumb");
        if (crumbEl) crumbEl.textContent = "Project / " + project.name;

        const stats = projectStats(project);

        document.getElementById("greeting").textContent =
            "Hello, " + session.name;
        document.getElementById("greetingSub").innerHTML =
            "Your variation orders for <strong>" + escapeHtml(project.name) + "</strong>.";

        document.getElementById("statCards").innerHTML = renderStatCards(stats, session.role);
        document.getElementById("recentBody").innerHTML = renderRecentRows(project.vos);

        document.querySelectorAll(".vo-row").forEach(row => {
            row.addEventListener("click", () => {
                window.location.href = "vo.html?id=" + encodeURIComponent(row.dataset.vo);
            });
        });

        /* Action list */
        const items = actionItems(project, session.role);
        document.getElementById("actionList").innerHTML = items.length === 0
            ? '<div class="empty-state">Nothing needs your attention right now.</div>'
            : items.map(i =>
                '<a class="finding" style="text-decoration:none;color:inherit" ' +
                'href="vo.html?id=' + encodeURIComponent(i.vo.id) + '">' +
                "<span><strong>" + escapeHtml(i.vo.no) + "</strong> — " +
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
