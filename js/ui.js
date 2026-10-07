/* VO-AI | ui.js — shared page chrome, guards and small render helpers. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { ROLES, DEMO_FILES, SEED_ZH } = require("./store.js");
    var { t, getLang, renderLangSwitch, wireLangSwitch, applyI18n } = require("./i18n.js");
}

/* `labelKey` looks up its display text via t() at render time (so it
   follows the current language); `label` is kept as a plain English
   fallback for any caller that reads NAV without going through t(). */
const NAV = [
    { id: "dashboard", href: "dashboard.html", icon: "⌂", label: "Dashboard",   labelKey: "nav.dashboard" },
    { id: "copilot",   href: "copilot.html",   icon: "✦", label: "Copilot",     labelKey: "nav.copilot" },
    { id: "register",  href: "register.html",  icon: "▤", label: "VO Register", labelKey: "nav.register" },
    { id: "documents", href: "documents.html", icon: "▤", label: "Documents",   labelKey: "nav.documents" },
    { id: "report",    href: "report.html",    icon: "▧", label: "VO Reports",  labelKey: "nav.report" }
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
/* -----------------------------------------------------------
   The VO-AI mark
----------------------------------------------------------- */

/* The three spires rising out of the tower, the tower shoulders running
   on into the outer roof slope, the inner roof over its four panes, and
   the ring behind all of it. Traced off the artwork: the geometry below
   is the artwork's own measurements scaled into a 64-unit box, so the
   bands there become 2-unit strokes here.

   Drawn as line art in currentColor rather than shipped as coloured
   bitmaps, so one definition sits correctly on the white sign-in card,
   on the dark sidebar rail and on a printed report sheet, and stays
   crisp at any size. */
function logoMark(size) {
    const px = Number(size) || 40;
    return '' +
    '<svg class="logo-mark" width="' + px + '" height="' + px + '" viewBox="0 0 64 64" ' +
         'role="img" aria-label="VO-AI" fill="none" stroke="currentColor" ' +
         'stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter">' +
        /* The ring, broken where the tower stands on it. Two half arcs
           rather than one, so the sweep is unambiguous. */
        '<path d="M24.65 25.5 A18.77 18.77 0 0 0 32 61.5 A18.77 18.77 0 0 0 39.35 25.5" ' +
              'stroke-width="1.7"/>' +
        /* The tower: shoulder in to the spire, down the wall, then out
           along the outer roof slope in one unbroken run. */
        '<path d="M28.7 19.5 H24.65 V40.9 L9.24 50.2"/>' +
        '<path d="M35.3 19.5 H39.35 V40.9 L54.76 50.2"/>' +
        /* The three spires, the middle one tallest. */
        '<path d="M28.7 8 V32.9 M32 1.5 V32.9 M35.3 8 V32.9"/>' +
        /* The inner roof, parallel to and below the outer one. */
        '<path d="M12.4 55.75 L32 43.5 L51.6 55.75"/>' +
        /* The four panes under the apex. */
        '<g stroke="none" fill="currentColor">' +
            '<rect x="28.4" y="49.8" width="2.8" height="3"/>' +
            '<rect x="32.8" y="49.8" width="2.8" height="3"/>' +
            '<rect x="28.4" y="54.3" width="2.8" height="3"/>' +
            '<rect x="32.8" y="54.3" width="2.8" height="3"/>' +
        '</g>' +
    '</svg>';
}


const STATUS_CLASS = {
    "Approved": "approved",
    "Pending": "pending",
    "Under Review": "review",
    "Rejected": "rejected",
    "Draft": "draft",
    "Confirmed": "approved",
    "Certified": "approved",
    "Returned": "rejected"
};

/* The stored status value ("Approved", "Pending", ...) is app vocabulary,
   not user data — it is always translated for display via the
   "status.<value>" dictionary key, never shown as the raw English word
   in the Chinese interface. The stored value itself is untouched. */
function statusPill(status) {
    const cls = STATUS_CLASS[status] || "draft";
    const label = t("status." + status, {});
    return '<span class="status ' + cls + '">' + escapeHtml(label === "status." + status ? status : label) + "</span>";
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
            "<span>" + n.icon + "</span>" + escapeHtml(t(n.labelKey)) + "</a>"
          ).join("")
        : "";

    /* template.xlsx: "Each sheet need to mention what project at the above".
       The chip is now also the project switcher (mirrors Bentley Infrastructure Cloud):
       click it to see client / contract context and jump to projects.html. */
    const projectBox = project
        ? '<div class="project-chip-wrap">' +
              '<button type="button" class="project-chip clickable" id="projectChipBtn">' +
                  '<small>' + escapeHtml(t("sidebar.currentProject")) + '</small>' +
                  '<strong>' + escapeHtml(project.name) + ' <span class="chip-caret">&#9662;</span></strong>' +
              '</button>' +
              '<div class="project-chip-menu" id="projectChipMenu" hidden>' +
                  '<div class="project-chip-menu-info">' +
                      '<strong>' + escapeHtml(project.name) + '</strong>' +
                      '<span>' + escapeHtml(project.client || '—') + '</span>' +
                      '<span>' + escapeHtml(t("sidebar.contract", { no: project.contractNo || '—' })) + '</span>' +
                  '</div>' +
                  '<a href="projects.html" class="project-chip-menu-action" id="switchProjectBtn">' +
                      escapeHtml(t("sidebar.switchProject")) + '</a>' +
              '</div>' +
          '</div>'
        : '<div class="project-chip-empty">' + escapeHtml(t("sidebar.selectProject")) + '</div>';

    return '' +
        '<div class="logo">' +
            '<div class="logo-icon">' + logoMark(40) + '</div>' +
            "<div><h2>VO-AI</h2><span>" + escapeHtml(t("app.tagline")) + "</span></div>" +
        "</div>" +
        projectBox +
        "<nav>" + items + "</nav>" +
        '<div class="sidebar-bottom">' +
            renderLangSwitch() +
            '<div class="user-profile">' +
                '<div class="avatar" style="background:' + role.colour + '">' +
                    initials(session.name) + "</div>" +
                "<div><strong>" + escapeHtml(session.name) + "</strong>" +
                "<span>" + escapeHtml(t("role." + role.id + ".label", {})) + "</span></div>" +
            "</div>" +
            '<button class="signout-button" id="signOutBtn">' + escapeHtml(t("sidebar.signOut")) + '</button>' +
        "</div>";
}

function renderTopbar(title, crumb, session) {
    const role = ROLES[session.role] || ROLES.contractor;
    return '' +
        '<div class="topbar-left">' +
            /* Hidden on desktop by CSS; becomes the sidebar's replacement
               below the 700px breakpoint, where the sidebar itself is an
               off-canvas drawer (see mountChrome's wiring and style.css). */
            '<button type="button" class="nav-toggle" id="navToggleBtn" aria-expanded="false" aria-label="' +
                escapeHtml(t("nav.toggle")) + '">&#9776;</button>' +
            "<div>" +
                '<p class="breadcrumb">' + escapeHtml(crumb) + "</p>" +
                "<h1>" + escapeHtml(title) + "</h1>" +
            "</div>" +
        "</div>" +
        '<div class="top-actions">' +
            '<div class="role" style="border-color:' + role.colour + '">' +
                role.icon + " " + escapeHtml(t("role." + role.id + ".label", {})) +
            "</div>" +
        "</div>";
}

/* Phone layout: a bottom tab bar, the way site apps are laid out, so the
   main pages are one thumb-tap away. For the contractor, its centre is a
   large camera button that opens capture.html — recording a variation
   on site, photo first. Hidden above 700px by style.css. */
var TAB_ICON = {
    dashboard: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    register:  '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    documents: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    report:    '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 17v-3M12.5 17v-5M16 17v-2"/>',
    capture:   '<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/>'
};

function tabIcon(id) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + TAB_ICON[id] + '</svg>';
}

function renderBottomTabs(active, session) {
    const tab = id => {
        const n = NAV.find(x => x.id === id);
        return '<a href="' + n.href + '" class="tab-item' + (id === active ? ' active" aria-current="page' : '') + '">' +
            tabIcon(id) + '<span>' + escapeHtml(t("tab." + id)) + '</span></a>';
    };
    const capture = session && session.role === "contractor"
        ? '<a href="capture.html" class="tab-capture' + (active === "capture" ? ' active" aria-current="page' : '') + '">' +
              '<span class="tab-capture-ring">' + tabIcon("capture") + '</span>' +
              '<span>' + escapeHtml(t("tab.capture")) + '</span></a>'
        : "";
    return '<nav class="bottom-tabs' + (capture ? " has-capture" : "") + '" aria-label="' +
        escapeHtml(t("nav.tabs")) + '">' +
        tab("dashboard") + tab("register") + capture + tab("documents") + tab("report") +
        '</nav>';
}

/* A detail that is there when wanted and out of the way otherwise:
   <details> with a one-line summary always visible. `key` names it so
   keepFolds() can reopen it after the page redraws. */
function fold(key, summaryHtml, bodyHtml, extraClass) {
    return '<details class="fold' + (extraClass ? " " + extraClass : "") + '" data-fold="' + escapeHtml(key) + '">' +
        '<summary><span class="fold-summary">' + summaryHtml + "</span>" +
        '<span class="fold-toggle"><span class="fold-more">' + escapeHtml(t("common.expand")) + "</span>" +
        '<span class="fold-less">' + escapeHtml(t("common.collapse")) + "</span></span></summary>" +
        '<div class="fold-body">' + bodyHtml + "</div></details>";
}

/* Runs `render` (which replaces innerHTML) and reopens every fold that
   was open before, so an edit elsewhere never snaps a detail shut. */
function keepFolds(render) {
    const open = typeof document === "undefined" ? [] :
        Array.from(document.querySelectorAll("details.fold[open]")).map(d => d.dataset.fold);
    render();
    if (typeof document === "undefined") return;
    open.forEach(key => {
        const el = document.querySelector('details.fold[data-fold="' + key.replace(/["\\]/g, "\\$&") + '"]');
        if (el) el.open = true;
    });
}

/* The demo's English text in Chinese when the interface is in Chinese
   (js/store.js SEED_ZH). Text a user typed is returned unchanged. */
function seedText(value) {
    if (typeof getLang === "function" && getLang() === "zh" &&
        typeof SEED_ZH !== "undefined" && Object.prototype.hasOwnProperty.call(SEED_ZH, value)) {
        return SEED_ZH[value];
    }
    return value;
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

/* A document's name as shown in every list — a link that opens the file
   whenever the file itself is available:
   - a demo document links to its sample file in demo-files/ (by its
     own `url`, or by id for a register saved before urls existed), so
     it opens on any computer;
   - an upload whose content was stored in this browser
     (js/filestore.js) opens from there;
   - anything else (a file uploaded on another computer) is plain text
     with a small note saying only the name is on record. */
function demoFileUrl(doc) {
    if (doc.url) return doc.url;
    return (typeof DEMO_FILES !== "undefined" && DEMO_FILES[doc.id]) || "";
}

function fileLink(doc) {
    const name = escapeHtml(doc && doc.name);
    const openTitle = escapeHtml(t("file.openTitle"));
    const url = doc ? demoFileUrl(doc) : "";
    if (url) {
        return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" class="file-name file-open" title="' +
            openTitle + '">' + name + "</a>";
    }
    if (doc && doc.stored) {
        return '<a href="#" class="file-name file-open" data-file-id="' + escapeHtml(doc.id) +
            '" data-file-name="' + name + '" title="' + openTitle + '">' + name + "</a>";
    }
    return '<span class="file-name">' + name + "</span>" +
        '<span class="file-no-content" title="' + escapeHtml(t("file.nameOnlyTitle")) + '">' +
        escapeHtml(t("file.nameOnly")) + "</span>";
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
    if (btn) btn.addEventListener("click", async () => {
        if (typeof Cloud !== "undefined" && Cloud.active()) {
            await Cloud.flush();
            await Cloud.signOut();
        }
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

    /* Below 700px the sidebar is an off-canvas drawer (see style.css);
       this button is its only way open. body.nav-open drives the CSS
       transform, and aria-expanded keeps a screen reader in sync. */
    const navToggleBtn = document.getElementById("navToggleBtn");
    if (navToggleBtn && aside) {
        if (!aside.id) aside.id = "primaryNav";
        navToggleBtn.setAttribute("aria-controls", aside.id);
        navToggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const open = document.body.classList.toggle("nav-open");
            navToggleBtn.setAttribute("aria-expanded", String(open));
        });
        document.addEventListener("click", (e) => {
            if (!document.body.classList.contains("nav-open")) return;
            if (aside.contains(e.target) || navToggleBtn.contains(e.target)) return;
            document.body.classList.remove("nav-open");
            navToggleBtn.setAttribute("aria-expanded", "false");
        });
        aside.addEventListener("click", (e) => {
            if (e.target.closest && e.target.closest("a.nav-item")) {
                document.body.classList.remove("nav-open");
                navToggleBtn.setAttribute("aria-expanded", "false");
            }
        });
    }

    if (ctx.project && !document.querySelector("nav.bottom-tabs")) {
        document.body.insertAdjacentHTML("beforeend", renderBottomTabs(active, ctx.session));
        document.body.classList.add("has-bottom-tabs");
    }

    wireLangSwitch(document.getElementById("langSwitch"));

    /* Translate every static [data-i18n*] element on the page (headings,
       table header cells, placeholders defined directly in the HTML) —
       everything else is already rendered in the current language by
       the dynamic render functions above and in each page-*.js. */
    applyI18n(document);

    /* what is waiting for this role (js/notify.js) */
    if (typeof mountNotifications === "function") mountNotifications(ctx);

    return ctx;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { NAV, escapeHtml, initials, logoMark, statusPill, renderSidebar, renderTopbar, fileLink, renderBottomTabs, fold, keepFolds, seedText };
}
