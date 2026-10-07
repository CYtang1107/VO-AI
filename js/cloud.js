/* VO-AI | cloud.js — shared data through Supabase (docs/rag-plan.md, step 1).

   Off unless js/config.js names a Supabase project AND the user signed in
   with a team account. Then:
   - the register still lives in a local cache, so every page reads it
     synchronously exactly as before (js/store.js, under its own cache key);
   - each saveDB() pushes what changed since the last sync: for a VO or a
     project only the top-level fields that changed, merged on the server
     (save_vo / save_project in supabase/migrations/0001_init.sql), so two
     roles working on one VO do not overwrite each other;
   - each page load first pushes anything still pending, then pulls the
     projects this user is a member of, and reloads once if they changed;
   - another member's change arrives live (Supabase Realtime) as a banner.
   Without config, or in the offline demo, nothing here runs and the app
   works exactly as it always has.

   Only the public URL and anon key reach the browser; every row is
   protected by row-level security on the server. */

/* ---------- pure helpers (tested in test/cloud.test.js) ---------- */

/* Fields the browser adds to a project that are not project data. */
var CLOUD_LOCAL_FIELDS = ["vos", "cloudRole", "members"];

function projectData(project) {
    var out = {};
    Object.keys(project).forEach(function (k) {
        if (CLOUD_LOCAL_FIELDS.indexOf(k) === -1) out[k] = project[k];
    });
    return out;
}

/* The register as the rows it is stored in: one per project (without its
   VOs) and one per VO, keyed for comparison with the last sync. */
function cloudRows(db) {
    var projects = {}, vos = {};
    ((db && db.projects) || []).forEach(function (p) {
        projects[p.id] = projectData(p);
        (p.vos || []).forEach(function (vo) { vos[p.id + "/" + vo.id] = vo; });
    });
    return { projects: projects, vos: vos };
}

/* JSON with object keys sorted: Postgres jsonb does not keep key order, so
   a pulled object and the same object saved locally can differ only in
   order. */
function canonicalJson(value) {
    if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
    if (value && typeof value === "object") {
        return "{" + Object.keys(value).sort().filter(function (k) { return value[k] !== undefined; })
            .map(function (k) { return JSON.stringify(k) + ":" + canonicalJson(value[k]); }).join(",") + "}";
    }
    return JSON.stringify(value === undefined ? null : value);
}

function sameJson(a, b) {
    return canonicalJson(a) === canonicalJson(b);
}

/* What to send: for a row the server has not seen, the whole object; for a
   changed row, the top-level fields that differ (a removed field is sent as
   null so the merge clears it). Rows that did not change are left out. */
function patchOf(prev, next) {
    if (!prev) return next;
    var patch = {}, changed = false;
    Object.keys(next).forEach(function (k) {
        if (!sameJson(prev[k], next[k])) { patch[k] = next[k]; changed = true; }
    });
    Object.keys(prev).forEach(function (k) {
        if (!(k in next)) { patch[k] = null; changed = true; }
    });
    return changed ? patch : null;
}

function cloudChanges(snapshot, db) {
    var now = cloudRows(db);
    var before = snapshot || { projects: {}, vos: {} };
    var projects = [], vos = [];
    Object.keys(now.projects).forEach(function (id) {
        var patch = patchOf(before.projects[id], now.projects[id]);
        if (patch) projects.push({ id: id, patch: patch });
    });
    Object.keys(now.vos).forEach(function (key) {
        var patch = patchOf(before.vos[key], now.vos[key]);
        if (!patch) return;
        var slash = key.indexOf("/");
        vos.push({ projectId: key.slice(0, slash), id: key.slice(slash + 1), patch: patch });
    });
    return { projects: projects, vos: vos };
}

/* Rows from the server → the register js/store.js works with. Each project
   carries the signed-in user's role there (cloudRole) and its members. */
function dbFromRows(projectRows, voRows, memberRows, userId) {
    var byProject = {};
    (voRows || []).forEach(function (r) {
        (byProject[r.project_id] = byProject[r.project_id] || []).push(r.data);
    });
    var projects = (projectRows || []).map(function (r) {
        var p = Object.assign({ bq: [], documents: [] }, r.data || {});
        p.id = r.id;
        p.vos = (byProject[r.id] || []).slice().sort(function (a, b) {
            return String(a.no || "").localeCompare(String(b.no || ""), "en", { numeric: true }) ||
                   String(a.id).localeCompare(String(b.id));
        });
        var members = (memberRows || []).filter(function (m) { return m.project_id === r.id; });
        var mine = members.find(function (m) { return m.user_id === userId; });
        p.cloudRole = mine ? mine.role : null;
        p.members = members.map(function (m) {
            return { userId: m.user_id, role: m.role, name: m.display_name || m.email || "", email: m.email || "" };
        });
        return p;
    });
    projects.sort(function (a, b) { return String(a.createdAt || "").localeCompare(String(b.createdAt || "")); });
    return { projects: projects };
}

/* The role a person signs in with: their role on the projects they belong
   to (one role across all of them is the usual case), else the role they
   picked for creating their first project. */
function signInRole(memberRows, userId, fallback) {
    var roles = (memberRows || []).filter(function (m) { return m.user_id === userId; })
        .map(function (m) { return m.role; });
    if (roles.length === 0) return fallback || "consultant";
    var counts = {};
    roles.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
}

/* ---------- browser ---------- */

var Cloud = (function () {
    var LIB_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
    var CACHE_KEY = "voai.db.cloud.v1";
    var SNAPSHOT_KEY = "voai.cloud.snapshot.v1";
    var RELOADED_KEY = "voai.cloud.reloadedAt";

    var clientPromise = null;
    var pushTimer = null;
    var pushing = Promise.resolve();

    function config() {
        var c = (typeof window !== "undefined" && window.VOAI_CONFIG) || null;
        return c && c.supabaseUrl && c.supabaseAnonKey ? c : null;
    }

    /* A Supabase project is configured for this site. */
    function enabled() {
        return !!config();
    }

    /* The current session is a team-account session (not the offline demo). */
    function active() {
        if (!enabled() || typeof getSession !== "function") return false;
        var s = getSession();
        return !!(s && s.cloud);
    }

    function loadLib() {
        if (typeof window === "undefined") return Promise.reject(new Error("no browser"));
        if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
        return new Promise(function (resolve, reject) {
            var el = document.createElement("script");
            el.src = LIB_URL;
            el.onload = function () { resolve(window.supabase); };
            el.onerror = function () { reject(new Error("Could not load the Supabase library")); };
            document.head.appendChild(el);
        });
    }

    function client() {
        if (!enabled()) return Promise.reject(new Error("Supabase is not configured"));
        if (!clientPromise) {
            clientPromise = loadLib().then(function (lib) {
                var c = config();
                return lib.createClient(c.supabaseUrl, c.supabaseAnonKey, {
                    auth: { persistSession: true, autoRefreshToken: true }
                });
            });
            clientPromise.catch(function () { clientPromise = null; });
        }
        return clientPromise;
    }

    function check(res) {
        if (res && res.error) throw res.error;
        return res ? res.data : null;
    }

    /* ---------- local cache + last-synced snapshot ---------- */

    function readJson(key) {
        try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
        catch (e) { return null; }
    }
    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* full: next sync retries */ }
    }
    function cachedDB() { return readJson(CACHE_KEY) || { projects: [] }; }

    /* ---------- auth ---------- */

    async function pullMembership(c, userId) {
        return check(await c.from("members").select("project_id, user_id, role, display_name, email")
            .eq("user_id", userId));
    }

    /* Signs in and starts a team session. `fallbackRole` is used only by a
       person who belongs to no project yet. */
    async function signIn(email, password, fallbackRole) {
        var c = await client();
        var auth = check(await c.auth.signInWithPassword({ email: email, password: password }));
        var user = auth.user;
        var mine = await pullMembership(c, user.id);
        var name = (user.user_metadata && user.user_metadata.name) || user.email;
        localStorage.removeItem(SNAPSHOT_KEY);
        localStorage.removeItem(CACHE_KEY);
        setSession({
            name: name, role: signInRole(mine, user.id, fallbackRole), projectId: null,
            cloud: true, userId: user.id, email: user.email
        });
        await pull();
        return getSession();
    }

    /* A new account. Returns "signed-in", or "confirm-email" when the
       project requires the address to be confirmed first. */
    async function signUp(email, password, name, role) {
        var c = await client();
        var res = check(await c.auth.signUp({
            email: email, password: password, options: { data: { name: name } }
        }));
        if (!res.session) return "confirm-email";
        await signIn(email, password, role);
        return "signed-in";
    }

    async function signOut() {
        try { var c = await client(); await c.auth.signOut(); } catch (e) { /* offline: still clear */ }
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(SNAPSHOT_KEY);
    }

    /* ---------- sync ---------- */

    async function pull() {
        var c = await client();
        var s = getSession();
        var projects = check(await c.from("projects").select("id, data, created_at"));
        var vos = check(await c.from("vos").select("project_id, id, data"));
        var members = check(await c.from("members").select("project_id, user_id, role, display_name, email"));
        var db = dbFromRows(projects, vos, members, s && s.userId);
        writeJson(CACHE_KEY, db);
        writeJson(SNAPSHOT_KEY, cloudRows(db));
        return db;
    }

    async function pushNow() {
        var c = await client();
        var changes = cloudChanges(readJson(SNAPSHOT_KEY), cachedDB());
        var snapshot = readJson(SNAPSHOT_KEY) || { projects: {}, vos: {} };
        var now = cloudRows(cachedDB());
        for (var i = 0; i < changes.projects.length; i++) {
            var p = changes.projects[i];
            check(await c.rpc("save_project", { p_id: p.id, p_patch: p.patch }));
            snapshot.projects[p.id] = now.projects[p.id];
            writeJson(SNAPSHOT_KEY, snapshot);
        }
        for (var j = 0; j < changes.vos.length; j++) {
            var v = changes.vos[j];
            check(await c.rpc("save_vo", { p_project: v.projectId, p_id: v.id, p_patch: v.patch }));
            snapshot.vos[v.projectId + "/" + v.id] = now.vos[v.projectId + "/" + v.id];
            writeJson(SNAPSHOT_KEY, snapshot);
        }
        return changes.projects.length + changes.vos.length;
    }

    /* Serialised, so two saves in a row never race each other. */
    function push() {
        pushing = pushing.then(pushNow, pushNow);
        return pushing;
    }

    /* Called by saveDB() in js/store.js after every local save. */
    function schedulePush() {
        if (!active()) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(function () {
            push().catch(function (e) {
                notify(t("cloud.saveFailed", { reason: e.message || String(e) }), "error");
            });
        }, 250);
    }

    /* Waits for pending saves, e.g. before leaving the page. */
    function flush() {
        if (!active()) return Promise.resolve();
        clearTimeout(pushTimer);
        return push().catch(function () { /* the next page load retries */ });
    }

    /* ---------- files (Supabase Storage, bucket "documents") ---------- */

    function filePath(projectId, id) { return projectId + "/" + id; }

    async function uploadFile(projectId, id, file) {
        var c = await client();
        check(await c.storage.from("documents").upload(filePath(projectId, id), file, {
            upsert: true, contentType: file.type || "application/octet-stream"
        }));
        return true;
    }

    async function downloadFile(projectId, id) {
        var c = await client();
        return check(await c.storage.from("documents").download(filePath(projectId, id)));
    }

    /* ---------- members ---------- */

    async function addMember(projectId, email, role) {
        var c = await client();
        var result = check(await c.rpc("add_member", { p_project: projectId, p_email: email, p_role: role }));
        if (result === "ok") await pull();
        return result;
    }

    async function removeMember(projectId, userId) {
        var c = await client();
        check(await c.rpc("remove_member", { p_project: projectId, p_user: userId }));
        await pull();
    }

    /* ---------- ask the contract (Edge Function ask-contract) ---------- */

    /* Deletes a draft VO on the server (delete_vo checks the rule), then
       from the last-synced snapshot, so the next save does not bring it
       back. Resolves "ok" or "not-found". */
    async function deleteVO(projectId, voId) {
        var c = await client();
        var result = check(await c.rpc("delete_vo", { p_project: projectId, p_id: voId }));
        var snapshot = readJson(SNAPSHOT_KEY);
        if (snapshot && snapshot.vos) {
            delete snapshot.vos[projectId + "/" + voId];
            writeJson(SNAPSHOT_KEY, snapshot);
        }
        return result;
    }

    async function invoke(name, body) {
        var c = await client();
        var res = await c.functions.invoke(name, { body: body });
        if (res.error) {
            var detail = "", payload = null;
            try { payload = await res.error.context.json(); detail = payload.error || ""; } catch (e) { /* not json */ }
            /* an answer the function chose not to give (e.g. the guest
               limit) comes back as data with its reason */
            if (payload && payload.reason) return payload;
            throw new Error(detail || res.error.message);
        }
        return res.data;
    }

    function ask(body) {
        return invoke("ask-contract", body);
    }

    /* One imported document's text, in stored (contract) order, for
       reading and checking it on the Documents page. */
    async function knowledgeText(projectId, docName) {
        var c = await client();
        return check(await c.from("contract_chunks").select("clause_no, title, part, text")
            .eq("project_id", projectId).eq("doc_name", docName).order("id").range(0, 4999));
    }

    /* The project's knowledge base, one row per stored chunk (no text):
       what js/contractimport.js lists on the Documents page. */
    async function knowledgeRows(projectId) {
        var c = await client();
        return check(await c.from("contract_chunks").select("doc_name, form, clause_no")
            .eq("project_id", projectId).order("id").range(0, 4999));
    }

    /* ---------- page wiring ---------- */

    function notify(message, kind, actionLabel, action) {
        if (typeof document === "undefined") return;
        var bar = document.getElementById("cloudBanner");
        if (!bar) {
            bar = document.createElement("div");
            bar.id = "cloudBanner";
            bar.className = "cloud-banner";
            bar.setAttribute("role", "status");
            document.body.appendChild(bar);
        }
        bar.className = "cloud-banner " + (kind || "ok");
        bar.innerHTML = "";
        var text = document.createElement("span");
        text.textContent = message;
        bar.appendChild(text);
        if (actionLabel) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = actionLabel;
            btn.addEventListener("click", action);
            bar.appendChild(btn);
        }
        var close = document.createElement("button");
        close.type = "button";
        close.className = "cloud-banner-close";
        close.setAttribute("aria-label", "×");
        close.textContent = "×";
        close.addEventListener("click", function () { bar.remove(); });
        bar.appendChild(close);
    }

    function subscribe(c) {
        var s = getSession();
        var timer = null;
        function onChange(payload) {
            var row = payload.new || {};
            if (row.updated_by && s && row.updated_by === s.userId) return;
            clearTimeout(timer);
            timer = setTimeout(function () {
                var before = cachedDB();
                pull().then(function (db) {
                    if (sameJson(db, before)) return;
                    /* the bell (js/notify.js) recounts from the new copy */
                    try { window.dispatchEvent(new CustomEvent("voai:dbchanged")); } catch (e) { /* old browser */ }
                    notify(t("cloud.remoteChange"), "ok", t("cloud.refresh"), function () {
                        window.location.reload();
                    });
                }).catch(function () { /* stays on the cached copy */ });
            }, 400);
        }
        c.channel("voai-register")
            .on("postgres_changes", { event: "*", schema: "public", table: "vos" }, onChange)
            .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, onChange)
            .subscribe();
    }

    /* Every page: send what is pending, fetch the latest, and reload once
       if what the page was drawn from is out of date. */
    async function boot() {
        if (!active()) return;
        var c;
        try {
            c = await client();
            var auth = check(await c.auth.getSession());
            if (!auth.session) {
                /* The team sign-in expired or was ended on another tab. */
                localStorage.removeItem(CACHE_KEY);
                localStorage.removeItem(SNAPSHOT_KEY);
                clearSession();
                if (!/index\.html$|\/$/.test(window.location.pathname)) window.location.href = "index.html";
                return;
            }
            await push();
        } catch (e) {
            notify(t("cloud.offline"), "warn");
            return;
        }
        try {
            var before = cachedDB();
            var db = await pull();
            var s = getSession();
            /* Opening a project as the role this person has there. */
            var open = s && s.projectId && db.projects.find(function (p) { return p.id === s.projectId; });
            if (open && open.cloudRole && open.cloudRole !== s.role) {
                setSession(Object.assign({}, s, { role: open.cloudRole }));
                before = null;
            }
            var last = Number(sessionStorage.getItem(RELOADED_KEY) || 0);
            if ((before === null || !sameJson(before, db)) && Date.now() - last > 5000) {
                sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
                window.location.reload();
                return;
            }
            subscribe(c);
        } catch (e) {
            notify(t("cloud.offline"), "warn");
        }
    }

    if (typeof window !== "undefined" && typeof document !== "undefined") {
        window.addEventListener("pagehide", function () { flush(); });
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", boot);
        } else {
            setTimeout(boot, 0);
        }
    }

    return {
        enabled: enabled, active: active, CACHE_KEY: CACHE_KEY,
        signIn: signIn, signUp: signUp, signOut: signOut,
        pull: pull, push: push, schedulePush: schedulePush, flush: flush,
        uploadFile: uploadFile, downloadFile: downloadFile,
        addMember: addMember, removeMember: removeMember,
        ask: ask, invoke: invoke, deleteVO: deleteVO, knowledgeRows: knowledgeRows, knowledgeText: knowledgeText, notify: notify
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = { canonicalJson, sameJson, cloudRows, patchOf, cloudChanges, dbFromRows, signInRole, projectData, Cloud };
}
