const test = require("node:test");
const assert = require("node:assert");
const { ELEMENTS, detectElements, relatedElements } = require("../js/elements.js");

/* ---------- detectElements ---------- */

test("the client's own example: 'Change block wall to brick wall' detects the wall element", () => {
    const detected = detectElements("Change block wall to brick wall");
    assert.ok(detected.some(e => e.id === "wall"), "expected wall to be detected");
});

test("a wall change prompts for wall finishes, DPC and skirting", () => {
    const detected = detectElements("Change block wall to brick wall");
    const ids = detected.map(e => e.id);
    const related = relatedElements(ids);
    const relatedIds = related.map(r => r.element.id);
    assert.ok(relatedIds.includes("wall-finishes"), "expected wall finishes");
    assert.ok(relatedIds.includes("dpc"), "expected DPC");
    assert.ok(relatedIds.includes("skirting"), "expected skirting");
});

test("a floor-finish change prompts for skirting", () => {
    const detected = detectElements("Change floor finishes from ceramic tile to marble");
    const ids = detected.map(e => e.id);
    assert.ok(ids.includes("floor-finishes"));
    const related = relatedElements(ids);
    const relatedIds = related.map(r => r.element.id);
    assert.ok(relatedIds.includes("skirting"), "expected skirting to be prompted");
});

test("a description naming two elements detects both", () => {
    const detected = detectElements("Replace the door and the window in this room");
    const ids = detected.map(e => e.id);
    assert.ok(ids.includes("door"));
    assert.ok(ids.includes("window"));
});

test("a description naming no element returns an empty result, not a guess", () => {
    const detected = detectElements("Extend the working hours for the site office.");
    assert.deepStrictEqual(detected, []);
    assert.deepStrictEqual(relatedElements([]), []);
});

test("related elements already named in the description are not re-prompted", () => {
    /* Wall AND skirting are both named — skirting should not appear as
       a related element to confirm, since it's already in the
       description. */
    const detected = detectElements("Change block wall to brick wall, and replace the skirting");
    const ids = detected.map(e => e.id);
    assert.ok(ids.includes("wall"));
    assert.ok(ids.includes("skirting"));
    const related = relatedElements(ids);
    const relatedIds = related.map(r => r.element.id);
    assert.ok(!relatedIds.includes("skirting"), "skirting is already named, should not be re-prompted");
    /* wall finishes and DPC are still not named, so they should still
       be prompted. */
    assert.ok(relatedIds.includes("wall-finishes"));
    assert.ok(relatedIds.includes("dpc"));
});

test("a ceiling change implicates cornice and electrical", () => {
    const related = relatedElements(["ceiling"]);
    const relatedIds = related.map(r => r.element.id);
    assert.ok(relatedIds.includes("cornice"));
    assert.ok(relatedIds.includes("electrical"));
});

test("a door change implicates ironmongery and the door frame", () => {
    const related = relatedElements(["door"]);
    const relatedIds = related.map(r => r.element.id);
    assert.ok(relatedIds.includes("ironmongery"));
    assert.ok(relatedIds.includes("door-frame"));
});

test("a window change implicates glazing and the sill", () => {
    const related = relatedElements(["window"]);
    const relatedIds = related.map(r => r.element.id);
    assert.ok(relatedIds.includes("glazing"));
    assert.ok(relatedIds.includes("window-sill"));
});

test("every related element note is non-empty, so every prompt is explained", () => {
    ELEMENTS.forEach(el => {
        el.related.forEach(relId => {
            assert.ok(el.note && el.note.trim().length > 0,
                el.id + " has related elements but no note explaining why");
        });
    });
});

test("every related id in the table refers to a real element", () => {
    const ids = new Set(ELEMENTS.map(e => e.id));
    ELEMENTS.forEach(el => {
        el.related.forEach(relId => {
            assert.ok(ids.has(relId), el.id + " lists unknown related element " + relId);
        });
    });
});
