/* VO-AI | ui.js — shared page chrome, guards and small render helpers. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { ROLES } = require("./store.js");
}

const NAV = [
    { id: "dashboard", href: "dashboard.html", icon: "⌂", label: "Dashboard" },
    { id: "analysis",  href: "analysis.html",  icon: "✦", label: "AI Analysis" },
    { id: "register",  href: "register.html",  icon: "▤", label: "VO Register" },
    { id: "report",    href: "report.html",    icon: "▧", label: "VO Reports" }
];

function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    return parts.slice(0, 2).map(p => p[0].toUpperCase()).join("");
}

const STATUS_CLASS = {
    "Approved": "approved",
    "Pending": "pending",
    "Under Review": "review",
    "Rejected": "rejected",
    "Draft": "draft"
};

function statusPill(status) {
    const cls = STATUS_CLASS[status] || "draft";
    return '<span class="status ' + cls + '">' + escapeHtml(status) + "</span>";
}

function renderSidebar(active, session, project) {
    const role = ROLES[session.role] || ROLES.contractor;

    /* Stage 1 sign-in -> Stage 2/3 choose a project -> Stage 4 work the register.
       Until a project is chosen, the working pages are dead ends; the project chip
       itself (see projectBox below) is the only place to go, and it is on projects.html. */
    const items = project
        ? NAV.map(n =>
            '<a href="' + n.href + '" class="nav-item' +
            (n.id === active ? " active" : "") + '">' +
            "<span>" + n.icon + "</span>" + n.label + "</a>"
          ).join("")
        : "";

    /* template.xlsx: "Each sheet need to mention what project at the above".
       The chip is now also the project switcher (mirrors Bentley Infrastructure Cloud):
       click it to see client / contract context and jump to projects.html. */
    const projectBox = project
        ? '<div class="project-chip-wrap">' +
              '<button type="button" class="project-chip clickable" id="projectChipBtn">' +
                  '<small>CURRENT PROJECT</small>' +
                  '<strong>' + escapeHtml(project.name) + ' <span class="chip-caret">&#9662;</span></strong>' +
              '</button>' +
              '<div class="project-chip-menu" id="projectChipMenu" hidden>' +
                  '<div class="project-chip-menu-info">' +
                      '<strong>' + escapeHtml(project.name) + '</strong>' +
                      '<span>' + escapeHtml(project.client || '—') + '</span>' +
                      '<span>Contract ' + escapeHtml(project.contractNo || '—') + '</span>' +
                  '</div>' +
                  '<a href="projects.html" class="project-chip-menu-action" id="switchProjectBtn">Switch project</a>' +
              '</div>' +
          '</div>'
        : '<div class="project-chip-empty">Select a project to begin</div>';

    return '' +
        '<div class="logo">' +
            '<div class="logo-icon">V</div>' +
            "<div><h2>VO-AI</h2><span>Variation Intelligence</span></div>" +
        "</div>" +
        projectBox +
        "<nav>" + items + "</nav>" +
        '<div class="sidebar-bottom">' +
            '<div class="user-profile">' +
                '<div class="avatar" style="background:' + role.colour + '">' +
                    initials(session.name) + "</div>" +
                "<div><strong>" + escapeHtml(session.name) + "</strong>" +
                "<span>" + role.label + "</span></div>" +
            "</div>" +
            '<button class="signout-button" id="signOutBtn">Switch role / sign out</button>' +
        "</div>";
}

function renderTopbar(title, crumb, session) {
    const role = ROLES[session.role] || ROLES.contractor;
    return '' +
        "<div>" +
            '<p class="breadcrumb">' + escapeHtml(crumb) + "</p>" +
            "<h1>" + escapeHtml(title) + "</h1>" +
        "</div>" +
        '<div class="top-actions">' +
            '<div class="role" style="border-color:' + role.colour + '">' +
                role.icon + " " + role.label +
            "</div>" +
        "</div>";
}

/* ---------- browser-only below ---------- */

function requireSession() {
    const s = getSession();
    if (!s) { window.location.href = "index.html"; return null; }
    return s;
}

function requireProject() {
    const session = requireSession();
    if (!session) return null;
    const db = loadDB();
    const project = db.projects.find(p => p.id === session.projectId);
    if (!project) { window.location.href = "projects.html"; return null; }
    return { session: session, project: project };
}

function toast(message, kind) {
    let host = document.getElementById("toastHost");
    if (!host) {
        host = document.createElement("div");
        host.id = "toastHost";
        host.className = "toast-host";
        document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "toast " + (kind || "ok");
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.classList.add("out"), 3200);
    setTimeout(() => el.remove(), 3600);
}

/* Fills <aside class="sidebar"> and <header class="topbar">, wires sign-out.
   Returns {session, project} or null when the guard has redirected. */
function mountChrome(active, title, crumb, opts) {
    const needProject = !(opts && opts.projectOptional);
    const ctx = needProject ? requireProject()
                            : (requireSession() ? { session: getSession(), project: null } : null);
    if (!ctx) return null;

    const aside = document.querySelector("aside.sidebar");
    const header = document.querySelector("header.topbar");
    if (aside) aside.innerHTML = renderSidebar(active, ctx.session, ctx.project);
    if (header) header.innerHTML = renderTopbar(title, crumb, ctx.session);

    const btn = document.getElementById("signOutBtn");
    if (btn) btn.addEventListener("click", () => {
        clearSession();
        window.location.href = "index.html";
    });

    const chipBtn = document.getElementById("projectChipBtn");
    const chipMenu = document.getElementById("projectChipMenu");
    if (chipBtn && chipMenu) {
        chipBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            chipMenu.hidden = !chipMenu.hidden;
        });
        document.addEventListener("click", () => { chipMenu.hidden = true; });
    }

    return ctx;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { NAV, escapeHtml, initials, statusPill, renderSidebar, renderTopbar };
}
