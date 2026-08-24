const test = require("node:test");
const assert = require("node:assert");
const { ROLES, newVO, seedDB } = require("../js/store.js");
const { projectStats } = require("../js/calc.js");
const { rateSummary, classifyVariation } = require("../js/analysis.js");

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
