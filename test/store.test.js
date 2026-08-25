const test = require("node:test");
const assert = require("node:assert");
const {
    ROLES, newVO, seedDB, PASSCODE_KEY,
    hasPasscode, setPasscode, verifyPasscode, clearPasscode
} = require("../js/store.js");
const { projectStats } = require("../js/calc.js");
const { rateSummary, classifyVariation } = require("../js/analysis.js");

/* store.js guards every localStorage access, so the rest of this file's
   tests run fine without one. The passcode functions persist through
   localStorage though, so give this process a minimal in-memory stand-in
   (node:test runs each file in its own process, so this never leaks). */
if (typeof globalThis.localStorage === "undefined" ||
    typeof globalThis.localStorage.getItem !== "function") {
    const backing = new Map();
    globalThis.localStorage = {
        getItem: k => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => backing.set(k, String(v)),
        removeItem: k => backing.delete(k)
    };
}

test("there are exactly three roles", () => {
    assert.deepStrictEqual(Object.keys(ROLES).sort(),
        ["client", "consultant", "contractor"]);
    for (const r of Object.values(ROLES)) {
        assert.ok(r.id && r.label && r.blurb && r.icon && r.colour);
    }
});

test("a new VO carries every field in the data model", () => {
    const vo = newVO(4);
    assert.strictEqual(vo.no, "VO-004");
    for (const f of ["description", "dateIssued", "typeOfInstruction", "instructionNo",
                     "revisedDrawing", "oldDrawing", "supportingDocs", "measurement",
                     "contractorRemark", "submitted", "dueDate", "assessmentNote",
                     "timeImpact", "evaluateStatus", "consultantRemark",
                     "certifiedStatus", "finalPrice", "clientRemark", "history"]) {
        assert.ok(f in vo, "missing field: " + f);
    }
    assert.strictEqual(vo.evaluateStatus, "Draft");
    assert.strictEqual(vo.certifiedStatus, "Pending");
    assert.strictEqual(vo.submitted, false);
});

test("a new VO carries the client's request-for-further-information fields, unset", () => {
    const vo = newVO(5);
    assert.ok("clientInfoRequestedAt" in vo, "missing field: clientInfoRequestedAt");
    assert.ok("clientInfoRequestNote" in vo, "missing field: clientInfoRequestNote");
    assert.strictEqual(vo.clientInfoRequestedAt, null);
    assert.strictEqual(vo.clientInfoRequestNote, "");
});

test("the seed project matches the demo scenario in the spec", () => {
    const db = seedDB();
    assert.strictEqual(db.projects.length, 1);
    const p = db.projects[0];
    assert.match(p.name, /ABC Residence/);
    assert.ok(p.bq.length >= 5, "the BQ needs enough items to link against");
    assert.strictEqual(p.vos.length, 3);
});

test("the seed VOs cover all three workflow states", () => {
    const p = seedDB().projects[0];
    const statuses = p.vos.map(v => v.evaluateStatus);
    assert.ok(statuses.includes("Approved"));
    assert.ok(statuses.includes("Pending"));
    assert.ok(statuses.includes("Draft"));
});

test("VO-001 exercises all three rate states, as the demo requires", () => {
    const p = seedDB().projects[0];
    const vo1 = p.vos.find(v => v.no === "VO-001");
    const s = rateSummary(vo1, p.bq);
    assert.strictEqual(s.same, 1);
    assert.strictEqual(s.star, 1);
    assert.strictEqual(s.different, 1);
});

test("VO-001 classifies as a specification change", () => {
    const p = seedDB().projects[0];
    const vo1 = p.vos.find(v => v.no === "VO-001");
    assert.strictEqual(classifyVariation(vo1).id, "specification");
});

test("every seed measurement row links to a real BQ item or to nothing", () => {
    const p = seedDB().projects[0];
    const ids = p.bq.map(b => b.id);
    for (const vo of p.vos) {
        for (const row of vo.measurement) {
            if (row.bqItemId !== null) {
                assert.ok(ids.includes(row.bqItemId),
                    vo.no + " links to missing BQ item " + row.bqItemId);
            }
        }
    }
});

test("the seed project produces sensible dashboard statistics", () => {
    const p = seedDB().projects[0];
    const s = projectStats(p);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.draft, 1);
    assert.strictEqual(s.approved, 1);
    assert.ok(s.value > 0);
});

/* ---------- device-local passcode ---------- */

test.afterEach(() => clearPasscode());

test("hasPasscode is false before setting one and true after", async () => {
    assert.strictEqual(hasPasscode(), false);
    await setPasscode("hunter2");
    assert.strictEqual(hasPasscode(), true);
});

test("verifying the correct passcode succeeds", async () => {
    await setPasscode("hunter2");
    assert.strictEqual(await verifyPasscode("hunter2"), true);
});

test("verifying a wrong passcode fails", async () => {
    await setPasscode("hunter2");
    assert.strictEqual(await verifyPasscode("wrong-guess"), false);
});

test("clearing removes the passcode", async () => {
    await setPasscode("hunter2");
    clearPasscode();
    assert.strictEqual(hasPasscode(), false);
    assert.strictEqual(await verifyPasscode("hunter2"), false);
});

test("the stored value never contains the plain passcode text", async () => {
    const plain = "correct-horse-battery-staple";
    await setPasscode(plain);
    const raw = localStorage.getItem(PASSCODE_KEY);
    assert.ok(raw, "expected a passcode record to be stored");
    assert.ok(!raw.includes(plain), "the serialised store must not contain the plain passcode");
});

test("two different passcodes with the same salt produce different digests", async () => {
    /* Inject a fixed salt via a digest function so both hashes are computed
       against the identical salt string, isolating the passcode as the
       only variable. */
    const fixedSaltDigest = text => {
        const forced = "fixed-salt:" + text.split(":").slice(1).join(":");
        return require("node:crypto").createHash("sha256").update(forced).digest();
    };
    await setPasscode("passcodeA", fixedSaltDigest);
    const hashA = JSON.parse(localStorage.getItem(PASSCODE_KEY)).hash;
    await setPasscode("passcodeB", fixedSaltDigest);
    const hashB = JSON.parse(localStorage.getItem(PASSCODE_KEY)).hash;
    assert.notStrictEqual(hashA, hashB);
});

test("the same passcode with the same salt produces the same digest", async () => {
    const digestFn = text => require("node:crypto").createHash("sha256").update(text).digest();
    await setPasscode("repeat-me", digestFn);
    const record1 = JSON.parse(localStorage.getItem(PASSCODE_KEY));
    /* Re-hash the same salt + passcode text directly and compare, proving
       the digest is a pure function of (salt, passcode). */
    const again = digestFn(record1.salt + ":repeat-me");
    const hex = Array.from(new Uint8Array(again)).map(b => b.toString(16).padStart(2, "0")).join("");
    assert.strictEqual(record1.hash, hex);
});

test("setPasscode uses real Web Crypto SHA-256 by default", async () => {
    await setPasscode("web-crypto-check");
    const record = JSON.parse(localStorage.getItem(PASSCODE_KEY));
    const expected = await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(record.salt + ":web-crypto-check"));
    const hex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, "0")).join("");
    assert.strictEqual(record.hash, hex);
});
