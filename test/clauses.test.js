const test = require("node:test");
const assert = require("node:assert");
const { CLAUSES, matchClause, clausesFor } = require("../js/clauses.js");

test("every clause carries the fields the report needs", () => {
    assert.ok(CLAUSES.length >= 4);
    for (const c of CLAUSES) {
        assert.ok(c.id && c.form && c.ref && c.title, "missing identity: " + c.id);
        assert.ok(Array.isArray(c.appliesTo) && c.appliesTo.length > 0);
        assert.ok(c.entitlement.length > 20, "entitlement too thin: " + c.id);
        assert.ok(c.evidence.length > 20, "evidence too thin: " + c.id);
    }
});

test("matchClause returns a governing clause for each classification", () => {
    for (const k of ["specification", "addition", "omission", "quantity", "design"]) {
        const c = matchClause(k);
        assert.ok(c, "no clause matched for " + k);
        assert.ok(c.appliesTo.includes(k));
    }
});

test("an unknown classification yields no clause rather than a wrong one", () => {
    assert.strictEqual(matchClause("unclassified"), null);
    assert.strictEqual(matchClause("nonsense"), null);
});

test("clausesFor returns every applicable clause", () => {
    const list = clausesFor("addition");
    assert.ok(list.length >= 1);
    assert.ok(list.every(c => c.appliesTo.includes("addition")));
});

test("the governing clause for each classification is pinned by id and ref", () => {
    assert.strictEqual(matchClause("specification").id, "pam-11-1");
    assert.strictEqual(matchClause("specification").ref, "Clause 11.1");
    assert.strictEqual(matchClause("quantity").id, "pam-11-6");
    assert.strictEqual(matchClause("quantity").ref, "Clause 11.6");
    assert.strictEqual(matchClause("omission").id, "pam-11-1");
    assert.strictEqual(matchClause("addition").id, "pam-11-1");
    assert.strictEqual(matchClause("design").id, "pam-11-1");
});
