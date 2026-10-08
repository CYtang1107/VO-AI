/* VO-AI | notify.js — tell each role when a VO is waiting for them.

   Who acts next on a VO follows from its state (the workflow in
   js/permissions.js):
     contractor submits → contract agent checks → design team issues the
     AI / EI → consultant QS values it (cost planning) → design team
     certifies → client approves.
   nextStep(vo) names that step and its role. Nothing is stored for it:
   a notification is a VO whose next step is the signed-in role's.

   In the app:
     - a bell in the top bar, with how many VOs wait for this role, and
       the list one click away;
     - a pop-up when something new has come to this role since they last
       looked (once per step; closing it marks those as seen);
     - a desktop notification, when the person has turned them on
       (the browser asks once), for a step that arrives while the page is
       open: with a team account, another person's change comes through
       live (js/cloud.js raises "voai:dbchanged").
   By email: with a team account, a step change calls the `notify` Edge
   Function, which emails the members whose turn it is
   (supabase/functions/notify). The server-side copy of nextStep is
   supabase/functions/notify/rules.mjs; test/notify.test.js keeps the two
   the same. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t, voNoLabel } = require("./i18n.js");
    var { rm, assessedTotal } = require("./calc.js");
    var { escapeHtml } = require("./ui.js");
    var { voStage } = require("./permissions.js");
}

/* The step a VO waits on, and whose it is; null when it is finished (or
   a draft, which is the contractor's own work in progress). It follows
   the VO's stage (voStage, js/permissions.js). Each step's key includes the
   round (how many times the VO has been sent on), so a VO returned and sent
   again, or asked for information again, notifies again. */
var STEP_OF_STAGE = {
    design: ["issue", "administrator"], designRejected: ["returned", "contractor"],
    measure: ["measure", "contractor"], consultant: ["value", "consultant"],
    info: ["info", "contractor"], rejected: ["rejected", "contractor"], client: ["approve", "client"]
};
function nextStep(vo) {
    if (!vo) return null;
    const s = STEP_OF_STAGE[voStage(vo)];
    if (!s) return null;
    const round = (vo.history || []).filter(h => /^(Submitted to |Sent to design team|Further information sent back)/.test(String(h.action || ""))).length;
    return { id: s[0], role: s[1], key: vo.id + ":" + s[0] + ":" + round };
}

/* Every VO of the project waiting for `role`, oldest first. */
function waitingFor(project, role) {
    return ((project && project.vos) || [])
        .map(vo => ({ vo: vo, step: nextStep(vo) }))
        .filter(x => x.step && x.step.role === role);
}

/* One line saying what is waiting and why. */
function stepMessage(vo, step) {
    const ref = vo.issuedInstruction ? vo.issuedInstruction.no : (vo.instructionNo || "");
    const verdict = vo.claimCheck && vo.claimCheck.verdict ? t("claim.verdict." + vo.claimCheck.verdict) : "";
    return t("notify.msg." + step.id, {
        no: voNoLabel(vo.no), ref: ref || "—", amount: rm(assessedTotal(vo)),
        verdict: verdict ? t("notify.verdict", { verdict: verdict }) : ""
    });
}

/* ---------- what this person has already seen (this browser) ---------- */

var NOTIFY_SEEN_KEY = "voai.notifySeen.v1";

function seenKeys(scope) {
    try { return (JSON.parse(localStorage.getItem(NOTIFY_SEEN_KEY)) || {})[scope] || []; }
    catch (e) { return []; }
}

function markSeen(scope, keys) {
    try {
        const all = JSON.parse(localStorage.getItem(NOTIFY_SEEN_KEY)) || {};
        all[scope] = Array.from(new Set((all[scope] || []).concat(keys))).slice(-300);
        localStorage.setItem(NOTIFY_SEEN_KEY, JSON.stringify(all));
    } catch (e) { /* not kept: it shows again next time */ }
}

/* Items not yet seen in `scope`. */
function unseen(items, seen) {
    const s = new Set(seen);
    return items.filter(x => !s.has(x.step.key));
}

function renderNotifyList(items) {
    if (!items.length) return '<p class="notify-empty">' + escapeHtml(t("notify.none")) + "</p>";
    return '<ul class="notify-list">' + items.map(x =>
        '<li><a href="vo.html?id=' + encodeURIComponent(x.vo.id) + '">' +
            '<span class="notify-step">' + escapeHtml(t("notify.step." + x.step.id)) + "</span>" +
            "<span>" + escapeHtml(stepMessage(x.vo, x.step)) + "</span></a></li>").join("") + "</ul>";
}

/* ---------- browser ---------- */

function desktopNotify(items) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    items.forEach(x => {
        try {
            const n = new Notification("VO-AI · " + t("notify.step." + x.step.id), { body: stepMessage(x.vo, x.step), tag: x.step.key });
            n.onclick = () => { window.focus(); window.location.href = "vo.html?id=" + encodeURIComponent(x.vo.id); };
        } catch (e) { /* some browsers only allow it from a service worker */ }
    });
}

/* The bell and the pop-up, on every page with the app's top bar. */
function mountNotifications(ctx) {
    if (!ctx || !ctx.project || typeof document === "undefined") return;
    const actions = document.querySelector(".top-actions");
    if (!actions || document.getElementById("notifyBell")) return;
    const role = ctx.session.role;
    const scope = ctx.project.id + "|" + role + "|" + (ctx.session.userId || ctx.session.name || "");
    const wrap = document.createElement("div");
    wrap.className = "notify-wrap";
    wrap.innerHTML =
        '<button type="button" class="notify-bell" id="notifyBell" aria-haspopup="true" aria-expanded="false">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>' +
            '<span class="notify-count" hidden></span></button>' +
        '<div class="notify-menu" id="notifyMenu" hidden></div>';
    actions.insertBefore(wrap, actions.firstChild);
    const bell = wrap.querySelector(".notify-bell");
    const menu = wrap.querySelector(".notify-menu");
    const count = wrap.querySelector(".notify-count");
    let notifiedThisPage = new Set();

    function project() {
        return (typeof getProject === "function" && getProject(ctx.project.id)) || ctx.project;
    }

    function draw(fresh) {
        const items = waitingFor(project(), role);
        count.hidden = items.length === 0;
        count.textContent = String(items.length);
        bell.setAttribute("aria-label", t("notify.bellLabel", { n: items.length }));
        menu.innerHTML = '<div class="notify-head"><strong>' + escapeHtml(t("notify.title")) + "</strong>" +
            '<span class="rate-detail">' + escapeHtml(t("role." + role + ".label")) + "</span></div>" +
            renderNotifyList(items) +
            (typeof Notification !== "undefined" && Notification.permission === "default"
                ? '<button type="button" class="link-button" id="notifyDesktopBtn">' + escapeHtml(t("notify.desktopOn")) + "</button>" : "") +
            '<p class="notify-foot">' + escapeHtml(t(typeof Cloud !== "undefined" && Cloud.active() ? "notify.footCloud" : "notify.footDemo")) + "</p>";

        const fresh_ = unseen(items, seenKeys(scope));
        if (fresh_.length) popup(fresh_);
        /* a desktop notification only for what arrives while this page is open */
        if (fresh) desktopNotify(fresh_.filter(x => !notifiedThisPage.has(x.step.key)));
        fresh_.forEach(x => notifiedThisPage.add(x.step.key));
    }

    function popup(items) {
        let box = document.getElementById("notifyPopup");
        if (!box) {
            box = document.createElement("div");
            box.id = "notifyPopup";
            box.className = "notify-popup";
            box.setAttribute("role", "status");
            document.body.appendChild(box);
        }
        box.innerHTML = '<div class="notify-head"><strong>' + escapeHtml(t("notify.popupTitle", { n: items.length })) + "</strong>" +
            '<button type="button" class="notify-close" aria-label="' + escapeHtml(t("notify.close")) + '">×</button></div>' +
            renderNotifyList(items);
        box.querySelector(".notify-close").addEventListener("click", () => { markSeen(scope, items.map(x => x.step.key)); box.remove(); });
        box.querySelectorAll("a").forEach(a => a.addEventListener("click", () => markSeen(scope, items.map(x => x.step.key))));
    }

    bell.addEventListener("click", e => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        bell.setAttribute("aria-expanded", String(!menu.hidden));
        if (!menu.hidden) {
            markSeen(scope, waitingFor(project(), role).map(x => x.step.key));
            const box = document.getElementById("notifyPopup");
            if (box) box.remove();
        }
    });
    menu.addEventListener("click", e => {
        e.stopPropagation();
        if (e.target.id === "notifyDesktopBtn" && typeof Notification !== "undefined") {
            Notification.requestPermission().then(() => draw(false));
        }
    });
    document.addEventListener("click", () => { menu.hidden = true; bell.setAttribute("aria-expanded", "false"); });
    window.addEventListener("voai:dbchanged", () => draw(true));
    /* another tab of this browser (the offline demo, switching roles) */
    window.addEventListener("storage", e => { if (e.key && /voai\.db/.test(e.key)) draw(true); });
    draw(false);
}

/* After a change that moves a VO to its next step: with a team account,
   ask the server to email whoever's turn it now is. Best effort: the
   in-app notification does not depend on it. */
function announceStep(projectId, before, after) {
    const a = nextStep(before), b = nextStep(after);
    if (!b || (a && a.key === b.key)) return;
    if (typeof Cloud !== "undefined" && Cloud.active() && Cloud.invoke) {
        /* after the save has reached the server */
        Promise.resolve(Cloud.flush && Cloud.flush())
            .then(() => Cloud.invoke("notify", { project_id: projectId, vo_id: after.id }))
            .catch(() => { /* email is optional */ });
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { nextStep, waitingFor, stepMessage, unseen, renderNotifyList, announceStep };
}
