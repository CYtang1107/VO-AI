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
    assert.match(html, /Schedule delay:/);
    assert.match(html, /Planned \(baseline\)[\s\S]*Forecast \(at current performance\)[\s\S]*Certified \(actual\)/);
    assert.match(html, /class="sc-line sc-actual"/);
    assert.match(html, /Monthly performance data \(table\)/);
    assert.match(html, /id="cpStart"/, "the programme for those who keep it");
    assert.doesNotMatch(html, /cpCertAdd/, "no form to add a certificate");
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
    assert.match(html, /Schedule performance index \(SPI\)<\/th><td class="num evm-v-bad">0\.86/);
    assert.match(html, /Forecast cost overrun \(VAC\)/);
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
    assert.match(html, /Variance at completion \(VAC\)<\/th><td class="num">RM 0</);
    assert.doesNotMatch(html, /Forecast cost (overrun|saving)/);
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


test("project performance: two short tables, cost then schedule, each figure named with its abbreviation", () => {
    const html = c.renderEarnedValue(c.earnedValue(project(), "2026-09-12"), {});
    const order = ["1. Cost management and forecast", "Budget at completion (BAC)", "Cost variance (CV)", "Cost performance index (CPI)",
                   "Estimate at completion (EAC)", "Forecast cost overrun (VAC)",
                   "2. Schedule management and forecast", "Schedule performance index (SPI)", "Behind schedule now", "Forecast completion delay"];
    let at = -1;
    order.forEach(k => { const i = html.indexOf(k); assert.ok(i > at, k + " in order"); at = i; });
    assert.match(html, /RM 12,555,856</, "whole ringgit");
    assert.match(html, /Behind schedule now<\/th><td class="num evm-v-bad">\d+ days</);
    assert.doesNotMatch(html, /evm-cards|data-fold="evm-figures"/);
});

test("the cost overview is for the contractor, the design team and the client; the design team and the client keep it", () => {
    assert.deepStrictEqual(["contractor", "administrator", "consultant", "client"].map(c.costOverviewVisible), [true, true, false, true]);
    assert.deepStrictEqual(["contractor", "administrator", "consultant", "client"].map(c.costOverviewEditable), [false, true, false, true]);
});

test("the dashboard links to the S-curve page instead of folding everything under the curve", () => {
    const html = c.renderCostOverview(project(), "2026-09-12", { editable: true, detailHref: "costplan.html" });
    assert.match(html, /<a class="cp-detail-link" href="costplan.html">Cost and schedule performance analysis →<\/a>/);
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
    assert.match(html, /class="evm-sums"/);
    html = at("table");
    assert.match(html, /class="cp-table"/);
    assert.strictEqual((html.match(/<tr><td>/g) || []).length, 18, "every month");
    assert.doesNotMatch(at("inputs", true), /cpCertAdd/, "no form to add a certificate");
    assert.match(at("inputs"), /Programme and payment certificates \(6\)/);
    assert.match(at("nonsense"), /class="cd-tab on" data-tab="curve"/);
});

test("zooming the S-curve: a stretch of months, the money axis fitted to it so the lines separate", () => {
    const curve = c.sCurve(project(), "2026-09-12");
    const z = c.zoomCurve(curve, 3, 6);
    assert.strictEqual(z.points.length, 4);
    assert.strictEqual(z.points[0].date, "2026-06-30");
    assert.ok(z.zoomed);
    assert.ok(!c.zoomCurve(curve, 0, curve.points.length - 1).zoomed, "all months: not zoomed");
    assert.strictEqual(c.zoomCurve(curve, 5, 5).points.length, 2, "at least two months");
    const ticks = svg => (svg.match(/class="sc-tick"[^>]*>RM [^<]+/g) || []).map(s => s.replace(/.*>/, ""));
    assert.strictEqual(ticks(c.renderSCurveSvg(z, 1000, 300))[0], "RM 0", "unzoomed axis starts at RM 0");
    assert.notStrictEqual(ticks(c.renderSCurveSvg(z, 1000, 300, { fitY: true }))[0], "RM 0", "zoomed axis starts near the lowest value in view");
});

test("a cash-flow sheet: the months column and the plan and forecast columns are found; cumulative or monthly", () => {
    const r = c.readCashflowSheet([["Cash flow forecast"], ["Month", "Planned (RM)", "Forecast (RM)", "Actual"],
        ["Apr-26", "131,581", "131,726", ""], ["May-26", "475426", "475949", ""], ["Jun-26", "RM 984,931", "986014", ""]]);
    assert.deepStrictEqual(r.months["2026-06"], { planned: 984931, forecast: 986014 });
    assert.deepStrictEqual(r.mode, { planned: "cumulative", forecast: "cumulative" });
    const m = c.readCashflowSheet([["月份", "计划"], ["2026年4月", "100"], ["2026年5月", "300"], ["2026年6月", "200"]]);
    assert.deepStrictEqual([m.months["2026-04"].planned, m.months["2026-06"].planned, m.mode.planned], [100, 600, "monthly"], "monthly amounts are added up");
    assert.strictEqual(c.readCashflowSheet([["Month", "Plan"], ["2026-04", "100"], ["2026-05", "200"]], "monthly").months["2026-05"].planned, 300, "the person may say they are monthly");
    assert.deepStrictEqual(["2026-04", "Apr 2026", "4/2026", "4月 26", "2026年4月", "30/04/2026", "46142"].map(c.cfMonthKey),
        ["2026-04", "2026-04", "2026-04", "2026-04", "2026-04", "2026-04", "2026-04"]);
    assert.strictEqual(c.readCashflowSheet([["a"], ["b"]]).error, "noMonths");
});

test("the team's own monthly figures stand in for the model's, and the planned value today follows them", () => {
    const p = project();
    const before = c.sCurve(p, "2026-09-12");
    p.cashflow = { months: { "2026-08": { planned: 2000000 }, "2026-09": { planned: 4000000, forecast: 4100000 } } };
    const after = c.sCurve(p, "2026-09-12");
    const pt = k => after.points.find(x => x.date.slice(0, 7) === k);
    assert.strictEqual(pt("2026-09").planned, 4000000);
    assert.strictEqual(pt("2026-09").forecast, 4100000);
    assert.ok(pt("2026-08").forecast > 2000000, "a forecast not given follows the plan, with the VOs");
    assert.strictEqual(pt("2026-07").planned, before.points.find(x => x.date.slice(0, 7) === "2026-07").planned, "other months: the model");
    assert.ok(after.plannedToday > 2000000 && after.plannedToday < 4000000, "PV today between August and September");
    const html = c.renderCostDetail(p, "2026-09-12", { tab: "table", editable: true });
    assert.match(html, /id="cfFile"/);
    assert.match(html, /class="cd-cell cd-own"><input type="text" inputmode="decimal" data-cf-key="2026-09" data-cf-k="planned" value="4,000,000.00"/);
    assert.doesNotMatch(c.renderCostDetail(p, "2026-09-12", { tab: "table", editable: false }), /cfFile|data-cf-key/);
});

test("in Chinese the performance figures go by their Chinese names, the abbreviation in brackets", () => {
    const store = {};
    const had = globalThis.localStorage;
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    require("../js/i18n.js").setLang("zh");
    try {
        const html = c.renderEarnedValue(c.earnedValue(project(), "2026-09-12"), { editable: true });
        assert.match(html, /<h4>1\. 成本管理与预测<\/h4>/);
        assert.match(html, /<th>完工预算（BAC）<\/th>/);
        assert.match(html, /<th>预计成本超支（VAC）<\/th>/);
        assert.match(html, /<h4>2\. 进度管理与预测<\/h4>/);
        assert.match(html, /<th>当前进度滞后<\/th><td class="num evm-v-bad">\d+ 天<\/td>/);
        assert.match(html, /<th>预计完工延误<\/th>/);
    } finally { globalThis.localStorage = had; }
});

test("a VO's number reads 变更单-001 in Chinese and VO-001 in English; the stored number is unchanged", () => {
    const i18n = require("../js/i18n.js");
    assert.strictEqual(i18n.voNoLabel("VO-001"), "VO-001");
    const store = {}, had = globalThis.localStorage;
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    try {
        i18n.setLang("zh");
        assert.strictEqual(i18n.voNoLabel("VO-001"), "变更单-001");
        assert.strictEqual(i18n.voNoLabel("VO-012/1"), "变更单-012/1");
        assert.strictEqual(i18n.voNoLabel("B/4.1"), "B/4.1", "a BQ code stays as it is");
    } finally { globalThis.localStorage = had; }
});

test("the forecast runs from what is certified on to the estimate at completion, so it parts from the plan", () => {
    const p = project();
    const curve = c.sCurve(p, "2026-09-12");
    const last = curve.points[curve.points.length - 1];
    const aug = curve.points.find(x => x.date === "2026-08-31");
    assert.strictEqual(aug.forecast, aug.actual, "to the last certificate: what was certified");
    assert.ok(aug.forecast < aug.planned, "behind plan today");
    assert.strictEqual(last.forecast, c.earnedValue(p, "2026-09-12").eac, "at completion: the EAC");
    assert.ok(last.forecast - last.planned > 500000, "an overrun at completion that shows on the chart");
    const noAc = project();
    noAc.certificates.forEach(x => { delete x.actual; });
    const n = c.sCurve(noAc, "2026-09-12");
    assert.strictEqual(n.points[n.points.length - 1].forecast, c.costOverview(noAc).forecast, "without actual costs: the plan with the VOs");
});

test("the delay in days: the day the plan reached what has been earned, and when it finishes at this pace", () => {
    const { earnedSchedule, earnedValue } = require("../js/costplan.js");
    const p = { programme: { start: "2026-01-01", end: "2026-12-31" }, contractSum: 1000000, vos: [],
        certificates: [{ date: "2026-06-30", amount: 250000 }] };
    const s = earnedSchedule(p, "2026-07-01", 250000);
    assert.ok(s.delayDays > 0, "behind: " + s.delayDays);
    assert.ok(s.esDate < "2026-07-01");
    assert.ok(s.forecastEnd > "2026-12-31" && s.finishDelayDays > 0);
    const on = earnedSchedule(p, "2026-07-02", earnedValue(p, "2026-07-02").pv);
    assert.ok(Math.abs(on.delayDays) <= 1, "on plan: " + on.delayDays);
    assert.strictEqual(earnedSchedule({ programme: null }, "2026-07-01", 1), null);
});
