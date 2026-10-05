const test = require("node:test");
const assert = require("node:assert");

/* In-memory localStorage: store.js reads the session from it. */
const backing = new Map();
globalThis.localStorage = {
    getItem: k => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: k => backing.delete(k)
};

const store = require("../js/store.js");
/* store.js calls getSession() as a browser global would; expose it. */
globalThis.getSession = store.getSession;
const {
    canonicalJson, sameJson, cloudRows, patchOf, cloudChanges, dbFromRows, signInRole, Cloud
} = require("../js/cloud.js");

test("canonical JSON ignores key order (jsonb does not keep it)", () => {
    assert.strictEqual(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    assert.ok(sameJson({ a: 1, b: undefined }, { a: 1 }));
    assert.ok(!sameJson({ a: [1, 2] }, { a: [2, 1] }));
});

test("cloudRows splits the register into project rows and VO rows", () => {
    const db = store.seedDB();
    db.projects[0].cloudRole = "consultant";
    db.projects[0].members = [{ userId: "u" }];
    const rows = cloudRows(db);
    const p = rows.projects["PRJ-CADANGAN"];
    assert.ok(p && p.name === "Cadangan Pembangunan ABC Residence");
    assert.ok(!("vos" in p) && !("cloudRole" in p) && !("members" in p), "browser-only fields are not stored");
    assert.deepStrictEqual(Object.keys(rows.vos).sort(),
        ["PRJ-CADANGAN/VO-SEED-1", "PRJ-CADANGAN/VO-SEED-2", "PRJ-CADANGAN/VO-SEED-3"]);
});

test("patchOf sends a new row whole and a changed row as its changed fields", () => {
    const vo = { id: "V", description: "Tile", evaluateStatus: "Draft", history: [] };
    assert.deepStrictEqual(patchOf(undefined, vo), vo);
    assert.strictEqual(patchOf(vo, Object.assign({}, vo)), null);
    assert.deepStrictEqual(patchOf(vo, Object.assign({}, vo, { description: "Marble" })), { description: "Marble" });
    const removed = Object.assign({}, vo);
    delete removed.history;
    assert.deepStrictEqual(patchOf(vo, removed), { history: null }, "a removed field is cleared");
});

test("cloudChanges finds only what changed since the last sync", () => {
    const db = store.seedDB();
    const snapshot = JSON.parse(JSON.stringify(cloudRows(db))); // stored as JSON, as in the browser
    assert.deepStrictEqual(cloudChanges(snapshot, db), { projects: [], vos: [] });

    db.projects[0].vos[1].consultantRemark = "Checking EI-008";
    db.projects[0].bq.push({ id: "BQ9", code: "X/1", description: "New", unit: "no", rate: 1 });
    const vo = store.newVO(4);
    db.projects[0].vos.push(vo);
    const changes = cloudChanges(snapshot, db);
    assert.strictEqual(changes.projects.length, 1);
    assert.deepStrictEqual(Object.keys(changes.projects[0].patch), ["bq"]);
    assert.deepStrictEqual(changes.vos.map(v => v.id).sort(), ["VO-SEED-2", vo.id].sort());
    const edited = changes.vos.find(v => v.id === "VO-SEED-2");
    assert.deepStrictEqual(edited.patch, { consultantRemark: "Checking EI-008" });
    assert.strictEqual(edited.projectId, "PRJ-CADANGAN");
    assert.strictEqual(changes.vos.find(v => v.id === vo.id).patch, vo, "a new VO is sent whole");

    const fresh = cloudChanges(null, db);
    assert.strictEqual(fresh.projects.length, 1);
    assert.strictEqual(fresh.vos.length, 4, "nothing synced yet: everything is sent");
});

test("dbFromRows rebuilds projects with their VOs in order, the user's role and members", () => {
    const seed = store.seedDB().projects[0];
    const rows = cloudRows({ projects: [seed] });
    const projectRows = [{ id: seed.id, data: rows.projects[seed.id] }];
    const voRows = Object.keys(rows.vos).reverse().map(k => ({ project_id: seed.id, id: rows.vos[k].id, data: rows.vos[k] }));
    const members = [
        { project_id: seed.id, user_id: "u1", role: "contractor", display_name: "Ong Wei Han", email: "ong@x" },
        { project_id: seed.id, user_id: "u2", role: "client", display_name: null, email: "tan@x" }
    ];
    const db = dbFromRows(projectRows, voRows, members, "u1");
    const p = db.projects[0];
    assert.deepStrictEqual(p.vos.map(v => v.no), ["VO-001", "VO-002", "VO-003"]);
    assert.strictEqual(p.cloudRole, "contractor");
    assert.deepStrictEqual(p.members.map(m => m.name), ["Ong Wei Han", "tan@x"]);
    /* round trip: nothing to push after a pull */
    assert.deepStrictEqual(cloudChanges(cloudRows(db), db), { projects: [], vos: [] });
    assert.deepStrictEqual(cloudRows(db).vos, rows.vos);
    assert.strictEqual(dbFromRows(projectRows, [], [], "u9").projects[0].cloudRole, null);
});

test("signInRole uses the person's project role, else the role they picked", () => {
    assert.strictEqual(signInRole([], "u", "contractor"), "contractor");
    assert.strictEqual(signInRole([{ user_id: "u", role: "client" }], "u", "contractor"), "client");
    assert.strictEqual(signInRole([
        { user_id: "u", role: "consultant" }, { user_id: "u", role: "client" }, { user_id: "u", role: "client" },
        { user_id: "x", role: "contractor" }], "u"), "client");
});

test("store keeps the team register apart from the offline demo and pushes on save", () => {
    backing.clear();
    globalThis.Cloud = undefined;
    const demo = store.loadDB();
    assert.strictEqual(demo.projects[0].id, "PRJ-CADANGAN", "offline: the demo register");

    store.setSession({ name: "Serena", role: "consultant", projectId: null, cloud: true, userId: "u" });
    assert.ok(store.cloudSession());
    assert.deepStrictEqual(store.loadDB(), { projects: [] }, "team session with nothing pulled yet: empty, not the demo");

    let pushes = 0;
    globalThis.Cloud = { schedulePush: () => { pushes++; } };
    store.saveDB({ projects: [{ id: "PRJ-T", name: "Team", vos: [] }] });
    assert.strictEqual(pushes, 1);
    assert.strictEqual(store.loadDB().projects[0].id, "PRJ-T");
    assert.ok(JSON.parse(backing.get(store.DB_KEY)).projects[0].id === "PRJ-CADANGAN", "demo data untouched");
    assert.strictEqual(store.resetDB().projects[0].id, "PRJ-T", "reset never wipes the team register");

    backing.delete(store.SESSION_KEY);
    assert.strictEqual(store.loadDB().projects[0].id, "PRJ-CADANGAN", "signed out: back to the demo");
    globalThis.Cloud = undefined;
});

test("Cloud is off without config, and never active in node", () => {
    assert.strictEqual(Cloud.enabled(), false);
    assert.strictEqual(Cloud.active(), false);
    Cloud.schedulePush(); // no-op, must not throw
    return Cloud.flush();
});
