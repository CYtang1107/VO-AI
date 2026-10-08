const test = require("node:test");
const assert = require("node:assert");
const { field, renderDocList, renderMeasurementRows, renderHistory, renderClientInfoRequestControl } = require("../js/page-vo.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];
const vo1 = project.vos[0];   /* approved + certified */
const vo3 = project.vos[2];   /* contractor draft */

test("a field the role owns and may edit renders as an editable input", () => {
    const html = field({ field: "description", label: "Description", type: "text",
                         value: "x", vo: vo3, role: "contractor" });
    assert.match(html, /class="field owned"/);
    assert.ok(!/disabled/.test(html));
    assert.ok(!/lock-note/.test(html));
});

test("a field owned by another role renders read-only, without a whose-column note", () => {
    const html = field({ field: "finalPrice", label: "Final price", type: "number",
                         value: "", vo: vo1, role: "contractor" });
    assert.match(html, /class="field locked"/);
    assert.match(html, /disabled/);
    assert.ok(!/lock-note/.test(html), "another role's column needs no note — its panel says whose it is");
});

test("a contractor field on an approved VO is locked, its reason given once for the panel", () => {
    const { panelLockNote } = require("../js/page-vo.js");
    const html = field({ field: "description", label: "Description", type: "text",
                         value: "x", vo: vo1, role: "contractor" });
    assert.match(html, /class="field locked"/);
    assert.ok(!/lock-note/.test(html), "no per-field note");
    assert.match(panelLockNote(vo1, "contractor", "contractor"), /Approved by the client: closed/);
    assert.strictEqual(panelLockNote(vo1, "contractor", "client"), "", "another role's panel gets no note");
    assert.strictEqual(panelLockNote(vo3, "contractor", "contractor"), "", "an editable panel gets no note");
});

test("select fields render their options and mark the current one", () => {
    const html = field({ field: "evaluateStatus", label: "Status", type: "select",
                         options: ["Pending", "Approved", "Rejected"],
                         value: "Approved", vo: vo1, role: "consultant" });
    assert.match(html, /<select/);
    assert.match(html, /<option value="Approved" selected/);
});

test("a Draft VO's evaluate status select shows Draft as selected, not Pending", () => {
    const html = field({ field: "evaluateStatus", label: "Evaluate status", type: "select",
                         options: ["Pending", "Under Review", "Approved", "Rejected"],
                         value: vo3.evaluateStatus, vo: vo3, role: "consultant" });
    assert.match(html, /<option value="Draft" selected disabled>/);
    assert.ok(!/<option value="Pending" selected/.test(html));
});

test("field values are escaped", () => {
    const html = field({ field: "description", label: "D", type: "text",
                         value: '"><script>x</script>', vo: vo3, role: "contractor" });
    assert.ok(!html.includes("<script>x</script>"));
});

test("each measurement row shows its rate cross-check verdict", () => {
    const html = renderMeasurementRows(vo1, project, "consultant");
    assert.match(html, /rate-flag same/);
    assert.match(html, /rate-flag star/);
    assert.match(html, /rate-flag different/);
    assert.match(html, /contract BQ rate governs/i);
});

test("the contractor cannot edit assessed columns", () => {
    const html = renderMeasurementRows(vo1, project, "contractor");
    const assessedInputs = html.match(/data-col="assessedRate"[^>]*/g) || [];
    assert.ok(assessedInputs.length > 0);
    assert.ok(assessedInputs.every(i => /disabled/.test(i)),
        "assessed rate inputs must be disabled for the contractor");
});

/* ---------- automatic BQ match suggestion ---------- */

test("a row with no BQ item and a strong description match shows a suggested match", () => {
    const vo = { evaluateStatus: "Pending", submitted: true, measurement: [
        { id: "MX", bqItemId: null, description: "Additional skirting to match floor finish",
          unit: "m", qty: 10, rate: 22, assessedQty: "", assessedRate: "" }
    ] };
    const html = renderMeasurementRows(vo, project, "consultant");
    assert.match(html, /rate-flag auto-match/);
    assert.match(html, /Suggested match/);
    assert.match(html, /B\/4\.2/);
    assert.match(html, /matched on description/);
});

test("a row with a confirmed BQ item shows no suggestion block", () => {
    const html = renderMeasurementRows(vo1, project, "consultant");
    assert.ok(!/rate-flag auto-match/.test(html), "a linked row must not show a suggestion");
});

test("the accept-match control appears only for a role that may edit the measurement", () => {
    const vo = { evaluateStatus: "Draft", submitted: false, instructionStatus: "Confirmed", measurement: [
        { id: "MX", bqItemId: null, description: "Additional skirting to match floor finish",
          unit: "m", qty: 10, rate: 22, assessedQty: "", assessedRate: "" }
    ] };
    const contractorHtml = renderMeasurementRows(vo, project, "contractor");
    const consultantHtml = renderMeasurementRows(vo, project, "consultant");
    /* Approved by the design team: the contractor measures; the consultant does not yet. */
    assert.match(contractorHtml, /accept-match-btn/);
    assert.ok(!/accept-match-btn/.test(consultantHtml));
});

test("no comparable BQ item shows no suggestion block, only the star verdict", () => {
    const vo = { evaluateStatus: "Draft", submitted: false, measurement: [
        { id: "MX", bqItemId: null, description: "Precast concrete sump 600x600mm with cover",
          unit: "no", qty: 4, rate: 1250, assessedQty: "", assessedRate: "" }
    ] };
    const html = renderMeasurementRows(vo, project, "contractor");
    assert.match(html, /rate-flag star/);
    assert.ok(!/rate-flag auto-match/.test(html));
});

test("history renders every recorded action, newest last", () => {
    const html = renderHistory(vo1);
    assert.match(html, /VO created/);
    assert.match(html, /Certified/);
    assert.ok(html.indexOf("VO created") < html.indexOf("Certified"));
});

test("a VO with no history renders an empty state", () => {
    assert.match(renderHistory({ history: [] }), /empty-state/);
});

test("a contractor on a Draft VO gets a file picker for site photos; the drawings are the design team's", () => {
    assert.match(renderDocList(Object.assign({}, vo3, { sentToDesign: true }), "revisedDrawing", "Revised drawing", "administrator"), /class="field doc-field owned"/);
    assert.match(renderDocList(vo3, "revisedDrawing", "Revised drawing", "contractor"), /class="field doc-field locked"/);
    const html = renderDocList(vo3, "supportingDocs", "Site photos", "contractor");
    assert.match(html, /class="field doc-field owned"/);
    assert.match(html, /<input type="file" multiple/);
    assert.ok(!/lock-note/.test(html));
});

test("a consultant on the same VO gets the list read-only, with no note and no picker", () => {
    const html = renderDocList(vo3, "revisedDrawing", "Revised drawing", "consultant");
    assert.match(html, /class="field doc-field locked"/);
    assert.ok(!/lock-note/.test(html));
    assert.ok(!/<input type="file"/.test(html));
});

test("a contractor on an Approved VO gets it read-only (the panel carries the reason)", () => {
    const html = renderDocList(vo1, "revisedDrawing", "Revised drawing", "contractor");
    assert.match(html, /class="field doc-field locked"/);
    assert.ok(!/lock-note/.test(html));
    assert.ok(!/<input type="file"/.test(html));
});

test("seeded VO-001's revised drawing renders its actual file name", () => {
    const html = renderDocList(vo1, "revisedDrawing", "Revised drawing", "consultant");
    assert.match(html, /A-201 Rev C - Floor Finishes\.pdf/);
});

test("a field with no documents renders an empty state rather than a broken list", () => {
    const html = renderDocList(Object.assign({}, vo3, { supportingDocs: [] }), "supportingDocs", "Supporting documents", "contractor");
    assert.match(html, /class="doc-empty"/);
    assert.ok(!/<ul class="doc-list">/.test(html));
});

test("a document name containing markup is escaped", () => {
    const dirty = { revisedDrawing: [{ id: "F9", name: '<img src=x onerror=alert(1)>.pdf',
                                        size: 100, uploadedBy: "x", at: "2026-08-01" }] };
    const html = renderDocList(dirty, "revisedDrawing", "Revised drawing", "contractor");
    assert.ok(!html.includes("<img src=x onerror=alert(1)>.pdf"));
});

/* ---------- client's request for further information ---------- */

test("the client sees an editable request control on an approved VO", () => {
    const html = renderClientInfoRequestControl(Object.assign({}, vo1, { certifiedStatus: "Pending" }), "client", "2026-08-01");
    assert.match(html, /class="field owned"/);
    assert.match(html, /recordClientInfoRequestBtn/);
});

test("the contractor and consultant cannot record a client info request", () => {
    const contractorHtml = renderClientInfoRequestControl(vo1, "contractor", "2026-08-01");
    assert.match(contractorHtml, /class="field locked"/);
    assert.ok(!contractorHtml.includes("recordClientInfoRequestBtn"));

    const consultantHtml = renderClientInfoRequestControl(vo1, "consultant", "2026-08-01");
    assert.match(consultantHtml, /class="field locked"/);
    assert.ok(!consultantHtml.includes("recordClientInfoRequestBtn"));
});

test("a recorded client request renders for the consultant with its note and date", () => {
    const requested = Object.assign({}, vo1, {
        clientInfoRequestedAt: "2026-07-30",
        clientInfoRequestNote: "Please clarify the marble supplier's lead time."
    });
    const html = renderClientInfoRequestControl(requested, "consultant", "2026-08-06");
    assert.match(html, /Please clarify the marble supplier/);
    assert.match(html, /30/); // the recorded date appears somewhere in the rendered text
    assert.match(html, /7 day\(s\) elapsed since the request/);
});

test("a client request never shows a due date, only elapsed time", () => {
    const requested = Object.assign({}, vo1, {
        clientInfoRequestedAt: "2026-07-30", clientInfoRequestNote: "note"
    });
    const html = renderClientInfoRequestControl(requested, "client", "2026-08-06");
    assert.ok(!/deadline/i.test(html));
    assert.ok(!/due/i.test(html));
});

test("contract documents are no longer uploaded per VO (the project's PAM is used); the intro still shows", () => {
    const html = renderDocList(vo3, "contractDocs", "Contract basis document", "contractor",
                               "Upload the contract");
    assert.match(html, /doc-field locked/);
    assert.match(html, /class="hint doc-intro">Upload the contract/);
});

test("a VO saved before the contract basis section existed renders it empty, not broken", () => {
    const legacy = Object.assign({}, vo3);
    delete legacy.contractDocs;
    const html = renderDocList(legacy, "contractDocs", "Contract basis document", "consultant");
    assert.match(html, /doc-field locked/);
    assert.match(html, /class="doc-empty"/);
});

test("a star row shows past project rates; only an editable assessment gets the add-to-BQ control", () => {
    const { renderPastRates } = require("../js/page-vo.js");
    const { pastRateSources, suggestPastRate } = require("../js/ratehistory.js");
    const db = seedDB();
    const row = db.projects[0].vos[1].measurement[1];
    const s = suggestPastRate(row, pastRateSources(db, db.projects[0].id));
    const withAdd = renderPastRates(1, s, true);
    assert.ok(withAdd.includes("add-bq-item-btn"));
    assert.ok(withAdd.includes('value="1080"'));
    assert.ok(!renderPastRates(1, s, false).includes("add-bq-item-btn"));
    assert.ok(renderPastRates(1, null, true).includes("past-rates none"));
});

test("each measurement row shows its verdict in one line; the explanation folds under it", () => {
    const { rowSummary } = require("../js/page-vo.js");
    const { checkRate } = require("../js/analysis.js");
    const db = seedDB();
    const p = db.projects[0];
    const [m1, m2, m3] = p.vos[0].measurement;
    assert.strictEqual(rowSummary(checkRate(m1, p.bq), p.bq[0]), "Matches BQ B/4.1");
    assert.strictEqual(rowSummary(checkRate(m3, p.bq), p.bq[1]), "Overstated by RM 9.00 (40.9%) against BQ B/4.2".replace("Overstated", "overstated"));
    assert.strictEqual(rowSummary(checkRate(m2, p.bq), null, null), "No BQ item · no comparable past rate either");
    assert.strictEqual(rowSummary(checkRate(m2, p.bq), null, { rate: 235, matches: [{ unit: "m2" }] }),
        "No BQ item · past projects suggest RM 235.00/m2");
    const html = renderMeasurementRows(p.vos[0], p, "consultant");
    assert.strictEqual((html.match(/<details class="fold row-fold"/g) || []).length, 3);
    assert.ok(!/<details[^>]* open/.test(html), "folds start closed");
});


test("a row's next step sits on the row: match again when linked by hand; past rate, build-up and add-to-BQ for a new rate", () => {
    const { rowActions } = require("../js/page-vo.js");
    const star = { state: "star" }, same = { state: "same" };
    const suggestion = { rate: 1080, matches: [{ unit: "no" }] };
    const byHand = rowActions(0, { bqItemId: "BQ1" }, same, undefined, true, false, "D/1.2");
    assert.match(byHand, /rematch-btn/);
    assert.match(byHand, /D\/1\.2/);
    assert.doesNotMatch(rowActions(0, { bqItemId: "BQ5" }, same, undefined, true, false, undefined), /rematch-btn/, "a hand link matching would also pick: no button");
    assert.doesNotMatch(rowActions(0, { bqItemId: "BQ1", auto: { code: "B/4.1" } }, same, undefined, true, false), /rematch-btn/, "an automatic link needs no re-match");
    const contractor = rowActions(1, { bqItemId: null }, star, suggestion, true, false);
    assert.match(contractor, /use-past-btn[^>]*data-rate="1080"/);
    assert.match(contractor, /goto-buildup-btn/);
    assert.doesNotMatch(contractor, /add-bq-item-btn/, "only the consultant adds to the BQ");
    assert.match(rowActions(1, { bqItemId: null }, star, suggestion, false, true), /add-bq-item-btn[^>]*data-rate="1080"/);
    assert.strictEqual(rowActions(1, { bqItemId: null }, star, suggestion, false, false), "", "read-only: no buttons");
});

test("a document field is one standard row: its name, an upload button for whoever owns it, then its files", () => {
    const html = renderDocList(Object.assign({}, vo3, { supportingDocs: [] }), "supportingDocs", "Supporting documents", "contractor");
    assert.match(html, /<div class="doc-field-head"><span class="doc-field-label">Supporting documents<\/span><label class="doc-upload-btn"/);
    assert.match(html, /<input type="file" multiple class="doc-picker" data-field="supportingDocs" hidden>/);
    assert.doesNotMatch(renderDocList(vo3, "supportingDocs", "Supporting documents", "client"), /doc-upload-btn/);
});

test("the architect's instruction becomes measurement rows: each item matched to its BQ item, work the BQ lacks as a star row", () => {
    const { rowsFromInstruction, wholeInstructionRow } = require("../js/page-vo.js");
    const bu = require("../js/buildup.js");
    const db = seedDB();
    const p = db.projects[0];
    const isWork = part => !!bu.suggestBuildUp({ description: part, unit: "" }, p);
    let n = 0;
    const vo = { id: "VO-X", description: "Convert ground floor store room into a guest bathroom as instructed by the Architect: new doorway with timber flush door, cement sand screed to floor, plaster and paint to walls, and a new uPVC drainage pipe to the existing manhole.", measurement: [] };
    const r = rowsFromInstruction(vo, p.bq, isWork, () => "M" + (++n));
    const code = id => (p.bq.find(b => b.id === id) || {}).code || null;
    assert.deepStrictEqual(r.rows.map(x => [x.description, code(x.bqItemId)]), [
        ["New doorway with timber flush door", "C/2.3"], ["Cement sand screed to floor", null],
        ["Plaster and paint to walls", "B/5.1"], ["New uPVC drainage pipe to the existing manhole", "D/1.2"]]);
    const door = r.rows[0];
    assert.deepStrictEqual([door.unit, door.rate, door.qty, door.auto.code], ["no", 640, 0, "C/2.3"], "the BQ's unit and rate; the quantity to measure");
    vo.measurement = r.rows;
    assert.strictEqual(rowsFromInstruction(vo, p.bq, isWork, () => "M" + (++n)).added, 0, "never repeated");
    const zh = { description: "依建筑师指示将一楼储物间改为客用浴室：新开门洞并安装实木平板门、地面水泥砂浆找平、内墙批荡及油漆、新增 uPVC 排水管接至现有沙井。" };
    zh.measurement = [{ id: "S1", description: zh.description, unit: "nr", qty: 1, rate: 0, bqItemId: null }];
    assert.ok(wholeInstructionRow(zh, zh.measurement[0]), "a site record's copy of the whole instruction");
    const z = rowsFromInstruction(zh, p.bq, isWork, () => "M" + (++n));
    assert.strictEqual(z.replaced, 1);
    assert.deepStrictEqual(z.rows.map(x => code(x.bqItemId)), ["C/2.3", null, "B/5.1", "D/1.2"], "Chinese wording matches the English BQ");
});
