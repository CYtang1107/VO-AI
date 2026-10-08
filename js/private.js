/* VO-AI | private.js — what one member keeps for themselves on a project:
   the working of a built-up rate ("buildup/<VO id>/<row id>") and their own
   price list ("pricelist"). The rest of the team sees only a build-up's
   summary, kept on the measurement row (row.buildUpSummary).

   Kept in this browser under the owner (a team account's user id, or in
   the offline demo the role, so switching role shows another person's
   view), and with a team account also in Supabase's private_notes table,
   which only its owner can read (supabase/migrations/0007_private_buildups.sql). */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { buildUpRate } = require("./buildup.js");
}

var PRIVATE_KEY = "voai.private.v1";

function buildUpKey(voId, rowId) { return "buildup/" + voId + "/" + rowId; }

/* What the team sees of a build-up: the five figures, never its lines. */
function buildUpSummary(b, todayIso) {
    const r = buildUpRate(b);
    return { material: r.material, labour: r.labour, plant: r.plant, net: r.net,
             profitPct: r.ohpPct, profit: r.ohp, rate: r.rate, at: todayIso || null };
}

/* A copy of a VO without any build-up working on its rows (for anything
   that leaves the author's browser). */
function withoutPrivate(vo) {
    if (!vo || !Array.isArray(vo.measurement) || !vo.measurement.some(r => r && r.buildUp)) return vo;
    return Object.assign({}, vo, { measurement: vo.measurement.map(r => {
        if (!r || !r.buildUp) return r;
        const c = Object.assign({}, r);
        delete c.buildUp;
        return c;
    }) });
}

function privateOwner() {
    const s = typeof getSession === "function" ? getSession() : null;
    if (!s) return null;
    return s.cloud && s.userId ? "user:" + s.userId : "role:" + s.role;
}

function readPrivateAll() {
    try { return JSON.parse(localStorage.getItem(PRIVATE_KEY)) || {}; } catch (e) { return {}; }
}

function writePrivateAll(all) {
    try { localStorage.setItem(PRIVATE_KEY, JSON.stringify(all)); } catch (e) { /* not kept */ }
}

function getPrivate(projectId, key) {
    const owner = privateOwner();
    const mine = owner && readPrivateAll()[owner];
    const v = mine && mine[projectId] && mine[projectId][key];
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

/* data null removes it */
function setPrivate(projectId, key, data) {
    const owner = privateOwner();
    if (!owner) return;
    const all = readPrivateAll();
    all[owner] = all[owner] || {};
    all[owner][projectId] = all[owner][projectId] || {};
    if (data === null || data === undefined) delete all[owner][projectId][key];
    else all[owner][projectId][key] = data;
    writePrivateAll(all);
    if (typeof Cloud !== "undefined" && Cloud.active() && Cloud.savePrivate) {
        Cloud.savePrivate(projectId, key, data === undefined ? null : data).catch(function (e) {
            if (typeof toast === "function") toast(t("cloud.saveFailed", { reason: e.message || String(e) }), "error");
        });
    }
}

/* The rows pulled from private_notes become this owner's copy. True when
   it changed. */
function replacePrivate(rows) {
    const owner = privateOwner();
    if (!owner) return false;
    const all = readPrivateAll();
    const next = {};
    (rows || []).forEach(r => {
        next[r.project_id] = next[r.project_id] || {};
        next[r.project_id][r.key] = r.data;
    });
    const changed = JSON.stringify(all[owner] || {}) !== JSON.stringify(next);
    all[owner] = next;
    writePrivateAll(all);
    return changed;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildUpKey, buildUpSummary, withoutPrivate };
}
