const test = require("node:test");
const assert = require("node:assert");

const c = require("../js/costplan.js");
const { seedDB, demoDB } = require("../js/store.js");

const project = () => seedDB().projects[0];

test("forecast final cost = contract sum + approved + pending; drafts and rejections are not counted", () => {
    const o = c.costOverview(project());
    assert.strictEqual(o.contractSum, 12500000);
    assert.strictEqual(o.approved, 55856, "VO-001: the client's final price");
    assert.strictEqual(o.nPending, 1, "VO-002, submitted");
    assert.strictEqual(o.nDraft, 1, "VO-003, a draft");
    assert.strictEqual(o.forecast, 12500000 + 55856 + o.pending);
    assert.strictEqual(o.certified, 3100000, "the six interim certificates");
    const p = project();
    p.vos[1].evaluateStatus = "Rejected";
    assert.strictEqual(c.costOverview(p).nPending, 0);
});

test("a VO counts at its final price, then its assessed value once approved, else what is claimed", () => {
    const vo = { certifiedStatus: "Approved", finalPrice: 1000, measurement: [{ qty: 1, rate: 5, assessedQty: 1, assessedRate: 4 }] };
    assert.strictEqual(c.voValue(vo), 1000);
    assert.strictEqual(c.voValue(Object.assign({}, vo, { finalPrice: null })), 4);
    assert.strictEqual(c.voValue({ evaluateStatus: "Approved", measurement: vo.measurement }), 4);
    assert.strictEqual(c.voValue({ evaluateStatus: "Pending", measurement: vo.measurement }), 5);
});

test("the S-curve: slow start, fast middle, slow finish, reaching the baseline at completion", () => {
    assert.strictEqual(c.sFraction(0), 0);
    assert.strictEqual(c.sFraction(0.5), 0.5);
    assert.strictEqual(c.sFraction(1), 1);
    assert.ok(c.sFraction(0.1) < 0.1 && c.sFraction(0.9) > 0.9);
    const curve = c.sCurve(project(), "2026-09-12");
    assert.strictEqual(curve.points.length, 18, "Mar 2026 to Aug 2027");
    assert.strictEqual(curve.points[0].date, "2026-03-31");
    assert.strictEqual(curve.points[17].date, "2027-08-31");
    assert.strictEqual(curve.points[17].planned, 12500000 + 55856, "the baseline: contract sum + approved VOs");
    assert.ok(curve.points[17].forecast > 12500000);
    assert.strictEqual(curve.points[5].actual, 3100000, "August: all six certificates");
    assert.strictEqual(curve.points[6].actual, null, "no certificate after August yet");
    assert.ok(curve.behind > 0, "the demo is a little behind plan");
});

test("no programme, or one that ends before it starts: no curve", () => {
    assert.strictEqual(c.sCurve({ contractSum: 1 }), null);
    assert.strictEqual(c.sCurve({ programme: { start: "2026-05-01", end: "2026-01-01" } }), null);
    assert.match(c.renderCostOverview({ contractSum: 100, vos: [] }, "2026-10-01", {}), /Enter the programme/);
});

test("the demo as a browser first sees it: the programme moves with the VOs' dates", () => {
    const p = demoDB("2027-01-15").projects[0];
    assert.ok(p.programme.start > "2026-03-02");
    assert.strictEqual(p.certificates.length, 6);
});

test("the card: tiles, the behind/ahead line, a legend for the three lines, a table view, and inputs only for those who keep them", () => {
    const html = c.renderCostOverview(project(), "2026-09-12", { editable: true, width: 760 });
    assert.match(html, /Forecast final cost/);
    assert.match(html, /Behind plan/);
    assert.match(html, /Planned \(baseline\)[\s\S]*Forecast \(with variations\)[\s\S]*Certified \(actual\)/);
    assert.match(html, /class="sc-line sc-actual"/);
    assert.match(html, /Month by month \(table\)/);
    assert.match(html, /id="cpCertAdd"/);
    assert.doesNotMatch(c.renderCostOverview(project(), "2026-09-12", { editable: false }), /cpCertAdd/);
    assert.strictEqual(c.niceStep(3.1e6), 5e6);
});

/* the worked examples of a project cost management course (EVM) */
test("earned value: BAC, PV, EV, AC and the variances and indices worked out as in the course examples", () => {
    const p = { contractSum: 200000, vos: [], programme: { start: "2026-01-01", end: "2026-12-31" },
                certificates: [{ date: "2026-02-28", amount: 20000, actual: 35000 }] };
    const e = c.earnedValue(p, "2026-03-15");
    assert.strictEqual(e.bac, 200000);
    assert.strictEqual(e.ev, 20000);
    assert.strictEqual(e.ac, 35000);
    assert.strictEqual(e.cv, -15000, "CV = EV − AC");
    assert.strictEqual(e.cpi, 0.57, "CPI = EV / AC");
    assert.strictEqual(e.sv, e.ev - e.pv, "SV = EV − PV");
    assert.strictEqual(e.eac, Math.round(200000 / (20000 / 35000)), "EAC = BAC / CPI");
    assert.strictEqual(e.etc, e.eac - 35000, "ETC = EAC − AC");
    assert.strictEqual(e.vac, 200000 - e.eac, "VAC = BAC − EAC");
});

test("earned value of the demo: behind schedule and slightly over budget", () => {
    const e = c.earnedValue(project(), "2026-09-12");
    assert.strictEqual(e.bac, 12555856);
    assert.strictEqual(e.ev, 3100000);
    assert.strictEqual(e.ac, 3230000);
    assert.strictEqual(e.spi, 0.86);
    assert.strictEqual(e.cpi, 0.96);
    assert.ok(e.vac < 0, "an overrun is forecast");
    const html = c.renderEarnedValue(e);
    assert.match(html, /Schedule performance index <abbr>SPI<\/abbr>[\s\S]*0\.86[\s\S]*behind schedule/);
    assert.match(html, /BAC \/ CPI/);
});

test("without an actual cost on every certificate, only the schedule figures are worked out", () => {
    const p = project();
    delete p.certificates[2].actual;
    const e = c.earnedValue(p, "2026-09-12");
    assert.strictEqual(e.ac, null);
    assert.deepStrictEqual([e.cv, e.cpi, e.eac, e.etc, e.vac], [null, null, null, null, null]);
    assert.ok(e.spi !== null);
    assert.match(c.renderEarnedValue(e), /Enter the actual cost with every certificate/);
});


test("the EAC situation: as planned, CPI continues, past variances won't recur, or a new estimate", () => {
    const base = project();   /* BAC 12,555,856; EV 3,100,000; AC 3,230,000 */
    const at = m => c.earnedValue(Object.assign(project(), m), "2026-09-12");
    let e = at({});
    assert.strictEqual(e.method, "cpi", "the default");
    assert.strictEqual(e.eac, Math.round(12555856 / (3100000 / 3230000)));
    assert.strictEqual(e.etc, Math.round((12555856 - 3100000) / (3100000 / 3230000)));
    e = at({ eacMethod: "plan" });
    assert.deepStrictEqual([e.eac, e.etc, e.vac], [12555856, 12555856 - 3100000, 0]);
    e = at({ eacMethod: "atypical" });
    assert.deepStrictEqual([e.eac, e.etc, e.vac], [3230000 + 12555856 - 3100000, 12555856 - 3100000, -130000]);
    e = at({ eacMethod: "new" });
    assert.deepStrictEqual([e.eac, e.etc, e.missingEtc], [null, null, true]);
    e = at({ eacMethod: "new", etcEstimate: 9000000 });
    assert.deepStrictEqual([e.eac, e.etc, e.vac], [12230000, 9000000, 12555856 - 12230000]);
    assert.strictEqual(at({ eacMethod: "nonsense" }).method, "cpi");
    assert.ok(base);
});

test("the EAC choice is shown with its formula; only those who keep the figures can change it", () => {
    const p = Object.assign(project(), { eacMethod: "atypical" });
    let html = c.renderEarnedValue(c.earnedValue(p, "2026-09-12"), { editable: true });
    assert.match(html, /<td class="evm-formula">AC \+ \(BAC − EV\)<\/td>/);
    assert.match(html, /<option value="atypical" selected>/);
    assert.match(html, /equals BAC \/ CPI, since AC = EV \/ CPI/);
    assert.doesNotMatch(html, /id="evmMethod" disabled/);
    html = c.renderEarnedValue(c.earnedValue(Object.assign(project(), { eacMethod: "new" }), "2026-09-12"), { editable: false });
    assert.match(html, /id="evmMethod" disabled/);
    assert.match(html, /id="evmEtc"/);
    assert.match(html, /Enter the new estimate to complete/);
});

test("a variance of exactly zero reads as on budget, not under budget", () => {
    const html = c.renderEarnedValue(c.earnedValue(Object.assign(project(), { eacMethod: "plan" }), "2026-09-12"), {});
    assert.match(html, /<abbr>VAC<\/abbr>[\s\S]*?RM 0\.00[\s\S]*?= on budget/);
    assert.doesNotMatch(html, /expected to finish under budget/);
});

test("the EAC choice sits in a folded Advanced section that names the current choice", () => {
    const html = c.renderEarnedValue(c.earnedValue(project(), "2026-09-12"), { editable: true });
    assert.match(html, /<details class="fold" data-fold="evm-advanced"><summary><span class="fold-summary">Advanced: how EAC is forecast — Cost performance so far continues \(BAC \/ CPI\)/);
    assert.match(html, /data-fold="evm-advanced"[\s\S]*id="evmMethod"/);
});

test("the S-curve zoomed to date ends the month after today; the whole programme keeps every month", () => {
    const curve = c.sCurve(project(), "2026-09-12");
    const z = c.viewCurve(curve, "toDate");
    assert.strictEqual(z.points[z.points.length - 1].date, "2026-10-31", "September (today) and October");
    assert.strictEqual(c.viewCurve(curve, "all").points.length, 18);
    const svg = c.renderSCurveSvg(z, 1500);
    assert.match(svg, /viewBox="0 0 1500 440"/, "taller on a wide screen");
    assert.match(svg, /class="sc-cross"[^>]*style="display:none"/);
    const html = c.renderCostOverview(project(), "2026-09-12", { width: 1000 });
    assert.match(html, /class="sc-range-btn on" data-range="toDate"/, "zoomed in by default");
});


test("earned value opens with three plain-language cards; every figure is one click away, in order", () => {
    const html = c.renderEarnedValue(c.earnedValue(project(), "2026-09-12"), {});
    const shown = html.slice(0, html.indexOf('data-fold="evm-figures"'));
    assert.match(shown, /class="evm-cards"/);
    ["Cost", "Schedule", "At completion"].forEach(k => assert.ok(shown.includes("<small>" + k + "</small>"), k + " card"));
    assert.match(shown, /Every RM 1\.00 spent has done RM [\d.]+ of work\./);
    assert.ok(!shown.includes("<abbr>"), "no abbreviation before the fold");
    const folded = html.slice(html.indexOf('data-fold="evm-figures"'));
    const order = ["Cost baseline", "<abbr>BAC</abbr>", "Variance", "<abbr>CV</abbr>", "<abbr>SV</abbr>", "<abbr>VAC</abbr>", "Estimation", "<abbr>EAC</abbr>", "<abbr>ETC</abbr>",
                   "<abbr>PV</abbr>", "<abbr>EV</abbr>", "<abbr>AC</abbr>", "<abbr>SPI</abbr>", "<abbr>CPI</abbr>"];
    let at = -1;
    order.forEach(k => { const i = folded.indexOf(k); assert.ok(i > at, k + " in order"); at = i; });
});

test("the cost overview is for the contractor, the design team and the client; the design team and the client keep it", () => {
    assert.deepStrictEqual(["contractor", "administrator", "consultant", "client"].map(c.costOverviewVisible), [true, true, false, true]);
    assert.deepStrictEqual(["contractor", "administrator", "consultant", "client"].map(c.costOverviewEditable), [false, true, false, true]);
});

test("the dashboard links to the S-curve page instead of folding everything under the curve", () => {
    const html = c.renderCostOverview(project(), "2026-09-12", { editable: true, detailHref: "costplan.html" });
    assert.match(html, /<a class="cp-detail-link" href="costplan.html">See full details →<\/a>/);
    assert.doesNotMatch(html, /data-fold="cp-more"/);
    assert.doesNotMatch(html, /cpCertAdd/);
});

test("the S-curve page: one view at a time — the curve, how the project is doing, the months, the programme", () => {
    const at = (tab, editable) => c.renderCostDetail(project(), "2026-09-12", { tab: tab, editable: editable, width: 1000 });
    assert.deepStrictEqual(c.COST_TABS, ["curve", "health", "table", "inputs"]);
    let html = at("curve");
    assert.match(html, /class="cd-tab on" data-tab="curve"/);
    assert.match(html, /class="sc-svg/);
    assert.match(html, /Forecast final cost/);
    assert.doesNotMatch(html, /cp-detail-link|cp-foot/);
    html = at("health");
    assert.match(html, /data-fold="evm-figures" open/);
    assert.match(html, /class="evm-cards"/);
    html = at("table");
    assert.match(html, /class="cp-table"/);
    assert.strictEqual((html.match(/<tr><td>/g) || []).length, 18, "every month");
    assert.match(at("inputs", true), /id="cpCertAdd"/);
    assert.doesNotMatch(at("inputs", false), /cpCertAdd/);
    assert.match(at("inputs"), /Programme and certificates \(6\)/);
    assert.match(at("nonsense"), /class="cd-tab on" data-tab="curve"/);
});
