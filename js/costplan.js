/* VO-AI | costplan.js — the client's overview of the project's cost.

   What the project will cost, from the contract sum and the variations:
     - approved VOs: the client certified them (their final price, else the
       assessed value);
     - pending VOs: submitted and still moving (the assessed value once the
       consultant QS approved it, else what the contractor claims);
     - drafts: the contractor's, not yet submitted (shown, not counted);
     forecast final cost = contract sum + approved + pending.

   The S-curve: cumulative cost month by month over the programme.
     - planned: the cost baseline (the contract sum plus the approved
       variations: a baseline changes only by approved changes) spread
       over the programme on the standard
       construction S-curve (slow start, fast middle, slow finish:
       f(x) = 3x² − 2x³ of the time elapsed), until the project's own
       cash flow is entered;
     - forecast: the same curve for the forecast final cost;
     - actual: the interim certificates issued, cumulative.
   project.programme = { start, end }  (ISO dates)
   project.certificates = [{ date, amount }]  (each interim certificate's
     value, entered by the consultant QS or the client)

   Pure functions, plus the chart's SVG and its hover readout. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t, getLang } = require("./i18n.js");
    var { rm, contractorTotal, assessedTotal } = require("./calc.js");
    var { escapeHtml, fold } = require("./ui.js");
}

function voValue(vo) {
    if (vo.certifiedStatus === "Approved") {
        const f = vo.finalPrice;
        return f !== null && f !== undefined && f !== "" ? Number(f) || 0 : assessedTotal(vo);
    }
    return vo.evaluateStatus === "Approved" ? assessedTotal(vo) : contractorTotal(vo);
}

function costOverview(project) {
    const sum = Number((project && project.contractSum) || 0);
    let approved = 0, pending = 0, draft = 0, nApproved = 0, nPending = 0, nDraft = 0;
    ((project && project.vos) || []).forEach(vo => {
        if (vo.certifiedStatus === "Rejected" || vo.evaluateStatus === "Rejected") return;
        const v = voValue(vo);
        if (vo.certifiedStatus === "Approved") { approved += v; nApproved++; }
        else if (vo.submitted) { pending += v; nPending++; }
        else { draft += v; nDraft++; }
    });
    const forecast = sum + approved + pending;
    /* the cost baseline (BAC): re-baselined only by approved changes */
    const baseline = sum + approved;
    const certified = ((project && project.certificates) || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    return {
        contractSum: sum, approved: approved, pending: pending, draft: draft,
        nApproved: nApproved, nPending: nPending, nDraft: nDraft,
        baseline: baseline, forecast: forecast, change: forecast - sum, changePct: sum ? (forecast - sum) / sum * 100 : 0,
        certified: certified, certifiedPct: forecast ? certified / forecast * 100 : 0
    };
}

/* ---------- the S-curve ---------- */

function sFraction(x) {
    const c = Math.min(1, Math.max(0, x));
    return 3 * c * c - 2 * c * c * c;
}

function monthEnd(y, m) {           /* m: 0-11 → "YYYY-MM-DD", the month's last day */
    const d = new Date(Date.UTC(y, m + 1, 0));
    return d.toISOString().slice(0, 10);
}

function dayNo(iso) { return Date.parse(String(iso).slice(0, 10) + "T00:00:00Z") / 86400000; }

/* Month-end points from the programme's start month to its end month.
   null when the programme is not set or does not read. */
function sCurve(project, todayIso) {
    const p = project && project.programme;
    if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(p.start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(p.end || "") || p.end <= p.start) return null;
    const o = costOverview(project);
    const s = dayNo(p.start), e = dayNo(p.end);
    const months = [];
    let y = +p.start.slice(0, 4), m = +p.start.slice(5, 7) - 1;
    for (let guard = 0; guard < 240; guard++) {
        const end = monthEnd(y, m);
        months.push(end > p.end ? p.end : end);
        if (end >= p.end) break;
        if (++m === 12) { m = 0; y++; }
    }
    const certs = ((project.certificates) || []).filter(c => /^\d{4}-\d{2}-\d{2}/.test(c.date || "") && Number(c.amount) > 0)
        .sort((a, b) => a.date < b.date ? -1 : 1);
    const lastCert = certs.length ? certs[certs.length - 1].date : null;
    /* the team's own monthly figures (uploaded from Excel or typed in,
       project.cashflow.months, cumulative RM by "YYYY-MM") stand in for
       the model's where given; a forecast not given follows the plan */
    const cf = (project.cashflow && project.cashflow.months) || {};
    const given = v => v !== undefined && v !== null && v !== "" && isFinite(Number(v));
    /* the forecast at current performance: what has been certified, then
       on to the estimate at completion (EAC, earned value) along the same
       S-shape; without the costs to work out an EAC, the plan with the VOs */
    const est = estimateAtCompletion(project, todayIso);
    const target = est.eac !== null ? est.eac : o.forecast;
    const x0 = lastCert ? Math.min(1, Math.max(0, (dayNo(lastCert) - s) / (e - s))) : 0;
    const from = lastCert ? est.ev : 0;
    const projected = x => {
        if (lastCert && x <= x0) return null;
        const f0 = sFraction(x0);
        return Math.round(from + (target - from) * (f0 >= 1 ? 1 : (sFraction(x) - f0) / (1 - f0)));
    };
    const points = months.map(date => {
        const x = (dayNo(date) - s) / (e - s);
        const certifiedTo = certs.filter(c => c.date <= date).reduce((a, c) => a + Number(c.amount), 0);
        const own = cf[date.slice(0, 7)] || {};
        const planned = given(own.planned) ? Math.round(Number(own.planned)) : Math.round(o.baseline * sFraction(x));
        const ahead = projected(x);
        return {
            date: date,
            planned: planned,
            forecast: given(own.forecast) ? Math.round(Number(own.forecast))
                : ahead === null ? certifiedTo : ahead,
            /* actual only up to the month of the latest certificate */
            actual: lastCert && date.slice(0, 7) <= lastCert.slice(0, 7) ? certifiedTo : null,
            own: given(own.planned) || given(own.forecast)
        };
    });
    /* where things stand today: plan to date, and how far ahead or behind */
    const x = todayIso ? (dayNo(todayIso) - s) / (e - s) : null;
    let plannedToday = x === null ? null : Math.round(o.baseline * sFraction(x));
    if (x !== null && points.some(p => p.own)) {
        /* the team's own plan: between its month-ends, in a straight line */
        const d = dayNo(todayIso);
        let prevDay = s, prevVal = 0;
        plannedToday = points[points.length - 1].planned;
        for (const p of points) {
            const pd = dayNo(p.date);
            if (d <= pd) { plannedToday = Math.round(prevVal + (p.planned - prevVal) * Math.max(0, (d - prevDay) / ((pd - prevDay) || 1))); break; }
            prevDay = pd; prevVal = p.planned;
        }
    }
    return {
        points: points, today: todayIso, todayX: x, plannedToday: plannedToday,
        certified: o.certified, behind: plannedToday === null ? null : plannedToday - o.certified,
        progressPct: o.baseline ? o.certified / o.baseline * 100 : 0,
        plannedPct: plannedToday === null || !o.baseline ? null : plannedToday / o.baseline * 100
    };
}

/* ---------- the monthly figures from a spreadsheet ----------
   A cash-flow sheet (Excel or CSV) read into project.cashflow.months:
   one column of months (2026-04, Apr 2026, Apr-26, 4/2026, 2026年4月,
   4月 26, or an Excel date), and columns of money named for the plan
   (plan / baseline / 计划 / 基准) and the forecast (forecast / 预测 /
   预计). Without such names, the first column of money is the plan and
   the second the forecast. A column that never falls is taken as
   cumulative; otherwise as each month's amount, added up. */
var MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function cfMonthKey(v) {
    if (v === null || v === undefined) return null;
    const str = String(v).trim();
    if (!str) return null;
    const ym = (y, m) => {
        y = +y; m = +m;
        if (y < 100) y += 2000;
        return y >= 1990 && y <= 2100 && m >= 1 && m <= 12 ? y + "-" + String(m).padStart(2, "0") : null;
    };
    let m;
    if (/^\d+(\.\d+)?$/.test(str)) {
        /* an Excel date: days since 1899-12-30 */
        const n = Number(str);
        if (n < 20000 || n > 80000) return null;
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
        return ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
    }
    if ((m = str.match(/^(\d{4})[-\/.](\d{1,2})(?:[-\/.]\d{1,2})?/))) return ym(m[1], m[2]);
    if ((m = str.match(/^(?:\d{1,2}[-\/.])?(\d{1,2})[-\/.](\d{4})$/))) return ym(m[2], m[1]);
    if ((m = str.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月/))) return ym(m[1], m[2]);
    if ((m = str.match(/^(\d{1,2})\s*月\s*(\d{2,4})$/))) return ym(m[2], m[1]);
    if ((m = str.match(/^([A-Za-z]{3})[A-Za-z]*[\s\-'’,.]*(\d{2,4})$/))) {
        const i = MONTH_NAMES.indexOf(m[1].toLowerCase());
        return i < 0 ? null : ym(m[2], i + 1);
    }
    return null;
}

function cfNumber(v) {
    if (v === null || v === undefined) return null;
    const str = String(v).trim().replace(/^(RM|MYR)\s*/i, "").replace(/,/g, "").replace(/\s+/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(str)) return null;
    const n = Number(str);
    return isFinite(n) ? n : null;
}

/* rows: the sheet as rows of cells. Returns { months, columns, mode,
   matched } or { error }. */
function readCashflowSheet(rows, forceMode) {
    rows = (rows || []).map(r => (r || []).map(c => c === null || c === undefined ? "" : String(c)));
    const width = Math.max(0, ...rows.map(r => r.length));
    let monthCol = -1, best = 0;
    for (let c = 0; c < width; c++) {
        const n = rows.filter(r => cfMonthKey(r[c])).length;
        if (n > best) { best = n; monthCol = c; }
    }
    if (best < 2) return { error: "noMonths" };
    const dataRows = rows.filter(r => cfMonthKey(r[monthCol]));
    const firstData = rows.findIndex(r => cfMonthKey(r[monthCol]));
    const header = firstData > 0 ? rows[firstData - 1] : [];
    const money = [];
    for (let c = 0; c < width; c++) {
        if (c === monthCol) continue;
        const n = dataRows.filter(r => cfNumber(r[c]) !== null).length;
        if (n >= Math.max(2, Math.ceil(dataRows.length / 2))) money.push(c);
    }
    if (!money.length) return { error: "noMoney" };
    const name = c => String(header[c] || "").toLowerCase();
    const role = {};
    money.forEach(c => {
        if (/actual|certif|实际|核证/.test(name(c))) role[c] = "skip";
        else if (/forecast|预测|预计/.test(name(c))) role[c] = role.forecastCol === undefined ? (role.forecastCol = c, "forecast") : "skip";
        else if (/plan|baseline|budget|计划|基准|预算/.test(name(c))) role[c] = role.plannedCol === undefined ? (role.plannedCol = c, "planned") : "skip";
    });
    money.filter(c => !role[c]).forEach(c => {
        if (role.plannedCol === undefined) { role.plannedCol = c; role[c] = "planned"; }
        else if (role.forecastCol === undefined) { role.forecastCol = c; role[c] = "forecast"; }
    });
    if (role.plannedCol === undefined && role.forecastCol === undefined) return { error: "noMoney" };
    const months = {};
    const mode = {};
    [["planned", role.plannedCol], ["forecast", role.forecastCol]].forEach(pair => {
        const k = pair[0], c = pair[1];
        if (c === undefined) return;
        const series = dataRows.map(r => ({ key: cfMonthKey(r[monthCol]), v: cfNumber(r[c]) })).filter(x => x.v !== null);
        const cumulative = forceMode === "cumulative" ? true : forceMode === "monthly" ? false
            : series.every((x, i) => i === 0 || x.v >= series[i - 1].v);
        mode[k] = cumulative ? "cumulative" : "monthly";
        let run = 0;
        series.forEach(x => {
            run = cumulative ? x.v : run + x.v;
            months[x.key] = months[x.key] || {};
            months[x.key][k] = Math.round(run * 100) / 100;
        });
    });
    return { months: months, mode: mode, matched: Object.keys(months).length,
             columns: { planned: role.plannedCol === undefined ? null : (header[role.plannedCol] || null),
                        forecast: role.forecastCol === undefined ? null : (header[role.forecastCol] || null) } };
}

/* ---------- earned value ----------
   The project's earned value figures today, the way project cost
   management measures them:
     BAC  budget at completion: the cost baseline (contract sum + approved VOs)
     PV   planned value: the baseline's planned share by today (the S-curve)
     EV   earned value: the value of the work done, i.e. the interim
          valuations certified to date (a QS valuation measures work done
          at contract rates)
     AC   actual cost of that work: entered with each certificate
          (certificate.actual: the amount paid, or the contractor's
          recorded cost); known only when every certificate has one
     SV = EV − PV, SPI = EV / PV        (schedule: always available)
     CV = EV − AC, CPI = EV / AC        (cost: needs AC)
     EAC and ETC by the situation chosen (project.eacMethod, EAC_METHODS):
       "plan"     work going as planned:        EAC = BAC,             ETC = BAC − EV
       "cpi"      cost performance continues:   EAC = BAC / CPI,       ETC = (BAC − EV) / CPI
       "atypical" past variances won't recur:   EAC = AC + (BAC − EV), ETC = BAC − EV
       "new"      a fresh estimate of the rest: EAC = AC + ETC,        ETC = project.etcEstimate
     VAC = BAC − EAC
   ("atypical" is the standard formula for that situation. Written as
   AC + (BAC − EV) / CPI it would equal BAC / CPI, since AC = EV / CPI.)
   Nulls where a figure cannot be worked out, never a guess. */
var EAC_METHODS = ["cpi", "plan", "atypical", "new"];
/* The estimate at completion and what it rests on: the work certified
   (EV), its actual cost (AC, when every certificate has one) and the
   EAC situation chosen. Used by earned value and by the S-curve's
   forecast. */
function estimateAtCompletion(project, todayIso) {
    const o = costOverview(project);
    const certs = ((project && project.certificates) || []).filter(c => Number(c.amount) > 0 && (!todayIso || c.date <= todayIso));
    const bac = o.baseline;
    const ev = certs.reduce((s, c) => s + Number(c.amount), 0);
    const haveAc = certs.length > 0 && certs.every(c => c.actual !== undefined && c.actual !== null && c.actual !== "" && Number(c.actual) >= 0);
    const ac = haveAc ? certs.reduce((s, c) => s + Number(c.actual), 0) : null;
    const method = EAC_METHODS.indexOf(project && project.eacMethod) >= 0 ? project.eacMethod : "cpi";
    const etcIn = project && project.etcEstimate !== undefined && project.etcEstimate !== null && project.etcEstimate !== ""
        ? Number(project.etcEstimate) : null;
    let eac = null, etc = null;
    if (method === "plan") { eac = bac; etc = bac - ev; }
    else if (method === "cpi" && ac) { eac = Math.round(bac / (ev / ac)); etc = Math.round((bac - ev) / (ev / ac)); }
    else if (method === "atypical" && ac !== null) { etc = bac - ev; eac = ac + etc; }
    else if (method === "new" && ac !== null && etcIn !== null && etcIn >= 0) { etc = Math.round(etcIn); eac = ac + etc; }
    return { certs: certs, bac: bac, ev: ev, ac: ac, haveAc: haveAc, method: method, etcIn: etcIn, eac: eac, etc: etc };
}

function earnedValue(project, todayIso) {
    const curve = sCurve(project, todayIso);
    const est = estimateAtCompletion(project, todayIso);
    const certs = est.certs, bac = est.bac, ev = est.ev, ac = est.ac, haveAc = est.haveAc;
    const method = est.method, etcIn = est.etcIn, eac = est.eac, etc = est.etc;
    const pv = curve ? curve.plannedToday : null;
    const r2 = n => Math.round(n * 100) / 100;
    const sv = pv === null ? null : ev - pv;
    const spi = pv ? r2(ev / pv) : null;
    const cv = ac === null ? null : ev - ac;
    const cpi = ac ? r2(ev / ac) : null;
    return {
        bac: bac, pv: pv, ev: ev, ac: ac, pctComplete: bac ? ev / bac * 100 : 0,
        sv: sv, spi: spi, cv: cv, cpi: cpi,
        method: method, eac: eac, etc: etc, vac: eac === null ? null : bac - eac,
        missingAc: certs.length > 0 && !haveAc,
        missingEtc: method === "new" && etcIn === null
    };
}

/* Who sees the cost overview on the dashboard, and who keeps its
   programme and interim certificates (the design team issues them). */
function costOverviewVisible(role) { return role === "contractor" || role === "administrator" || role === "client"; }
function costOverviewEditable(role) { return role === "administrator" || role === "client"; }

/* ---------- render ---------- */

function money(n) {
    const a = Math.abs(n);
    if (a >= 1e6) return "RM " + String(Number((n / 1e6).toFixed(a >= 1e7 ? 1 : 2))) + "M";
    if (a >= 1e3) return "RM " + Math.round(n / 1e3) + "k";
    return "RM " + Math.round(n);
}

function shortMonth(iso) {
    const m = +iso.slice(5, 7);
    return t("costplan.month." + m) + " " + iso.slice(2, 4);
}

/* The chart: one y axis (RM), three lines, a "today" line, a crosshair
   readout (wired by mountCostChart). Series colours are the reference
   palette's first three slots (they pass every colour-vision pair). */
/* The months shown: the whole programme, or "toDate": from the start to
   the month after today (or after the latest certificate, if later), where
   planned and certified can be told apart. */
function viewCurve(curve, range) {
    if (!curve || range !== "toDate") return curve;
    const pts = curve.points;
    let last = pts.findIndex(p => p.date >= curve.today);
    if (last < 0) last = pts.length - 1;
    pts.forEach((p, i) => { if (p.actual !== null) last = Math.max(last, i); });
    const end = Math.min(pts.length, last + 2);
    return Object.assign({}, curve, { points: pts.slice(0, Math.max(2, end)) });
}

/* A stretch of the curve: months i0 to i1 (zoomed in on the chart). */
function zoomCurve(curve, i0, i1) {
    if (!curve) return curve;
    const n = curve.points.length;
    const a = Math.max(0, Math.min(n - 2, Math.round(i0))), b = Math.max(a + 1, Math.min(n - 1, Math.round(i1)));
    return Object.assign({}, curve, { points: curve.points.slice(a, b + 1), zoomed: a > 0 || b < n - 1 });
}

function renderSCurveSvg(curve, width, height, opts) {
    /* drawn at the width it is shown at, so text stays 11px on a phone;
       taller on a wide screen, so the lines do not flatten; `height`, when
       given, fits the chart to the screen (the dashboard: the whole curve in
       view when the page opens) */
    const W = Math.max(300, Math.min(1800, Math.round(width || 760)));
    const H = height ? Math.max(130, Math.min(460, Math.round(height)))
        : Math.max(240, Math.min(440, Math.round(W * 0.4))), L = 70, R = 14, T = 16, B = 34;
    const pts = curve.points;
    const vals = [];
    pts.forEach(p => { vals.push(p.planned, p.forecast); if (p.actual !== null) vals.push(p.actual); });
    const max = Math.max.apply(null, vals) || 1;
    /* zoomed in (opts.fitY): the money axis covers only what is in view,
       so the gap between the three lines shows; otherwise from RM 0 */
    const fit = !!(opts && opts.fitY);
    const min = fit ? Math.min.apply(null, vals) : 0;
    const lines = Math.max(4, Math.floor((H - T - B) / 55)); /* about one gridline per 55 px */
    const step = niceStep(Math.max(1, (max - min) * (fit ? 1.1 : 1)) / lines);
    const bottom = fit ? Math.max(0, Math.floor(min / step) * step) : 0;
    const top = Math.max(bottom + step, Math.ceil(max / step) * step);
    const x = i => L + (pts.length === 1 ? 0 : i * (W - L - R) / (pts.length - 1));
    const y = v => T + (H - T - B) * (1 - (v - bottom) / (top - bottom));
    const path = key => pts.map((p, i) => p[key] === null ? null : [x(i), y(p[key])]).filter(Boolean)
        .map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
    const grid = [];
    for (let v = bottom; v <= top + 1; v += step) {
        grid.push('<line class="sc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
            '<text class="sc-tick" x="' + (L - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + escapeHtml(money(v)) + "</text>");
    }
    const every = Math.max(1, Math.ceil(pts.length / Math.max(3, Math.floor(W / 85))));
    const last = pts.length - 1;
    /* every `every`th month, and the last; a regular tick too close to the
       last one is left out so the two labels never overlap */
    const shown = i => i === last || (i % every === 0 && last - i >= Math.ceil(every * 0.75));
    const xt = pts.map((p, i) => !shown(i) ? "" :
        '<text class="sc-tick" x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' + (i === pts.length - 1 ? "end" : i === 0 ? "start" : "middle") + '">' +
        escapeHtml(shortMonth(p.date)) + "</text>").join("");
    let today = "";
    if (curve.todayX !== null && curve.todayX >= 0 && curve.todayX <= 1 && curve.today <= pts[pts.length - 1].date && curve.today >= pts[0].date) {
        /* on the same month scale as the points: between the two
           month-ends today falls between */
        const d = dayNo(curve.today);
        let idx = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const a0 = dayNo(pts[i].date), a1 = dayNo(pts[i + 1].date);
            if (d >= a1) idx = i + 1;
            else if (d >= a0) { idx = i + (d - a0) / ((a1 - a0) || 1); break; }
        }
        const tx = x(Math.min(pts.length - 1, idx));
        today = '<line class="sc-today" x1="' + tx.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
            '<text class="sc-today-label" x="' + (tx + 4).toFixed(1) + '" y="' + (T + 10) + '">' + escapeHtml(t("costplan.today")) + "</text>";
    }
    const lastActual = pts.map((p, i) => ({ p: p, i: i })).filter(q => q.p.actual !== null).pop();
    const dot = lastActual ? '<circle class="sc-dot sc-actual-dot" cx="' + x(lastActual.i).toFixed(1) + '" cy="' + y(lastActual.p.actual).toFixed(1) + '" r="4.5"/>' : "";
    return '<svg class="sc-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + escapeHtml(t("costplan.chartLabel")) + '" ' +
            'data-left="' + L + '" data-right="' + R + '" data-width="' + W + '">' +
        grid.join("") + xt + today +
        '<path class="sc-line sc-planned" d="' + path("planned") + '"/>' +
        '<path class="sc-line sc-forecast" d="' + path("forecast") + '"/>' +
        '<path class="sc-line sc-actual" d="' + path("actual") + '"/>' + dot +
        /* SVG ignores the hidden attribute: display is what hides it */
        '<line class="sc-cross" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="display:none"/>' +
        '<rect class="sc-hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/>' +
    "</svg>";
}

function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/* The earned value table: each figure, its formula, its value and what
   it means (an index below 1 or a negative variance is bad). */
var EAC_FORMULA = {
    plan: ["BAC", "BAC − EV"], cpi: ["BAC / CPI", "(BAC − EV) / CPI"],
    atypical: ["AC + (BAC − EV)", "BAC − EV"], new: ["AC + ETC", "evm.etcEntered"]
};

/* opts: { editable } — whether the EAC situation (and a fresh ETC) can be changed */
/* In Chinese the figures go by their Chinese names alone, formulas too
   (挣值 − 计划值), never the English abbreviations. */
var EVM_ABBR = /\b(BAC|PV|EV|AC|CV|SV|CPI|SPI|EAC|ETC|VAC)\b/g;
function evmChinese() { return typeof getLang === "function" && getLang() === "zh"; }
function evmFormula(text) {
    if (!evmChinese()) return text;
    return String(text).replace(EVM_ABBR, a => t("evm.name." + a)).replace(/ \/ /g, " ÷ ");
}

function renderEarnedValue(e, opts) {
    const editable = opts && opts.editable;
    const zh = evmChinese();
    const f = EAC_FORMULA[e.method];
    const money = v => v === null ? "—" : (v < 0 ? "−" : "") + rm(Math.abs(v));
    const verdict = (good, keyGood, keyBad) => good === null ? "" :
        '<span class="evm-flag ' + (good ? "evm-good" : "evm-bad") + '">' + (good ? "✓ " : "! ") + escapeHtml(t(good ? keyGood : keyBad)) + "</span>";
    /* exactly on plan: neither good nor bad */
    const level = key => '<span class="evm-flag evm-level">= ' + escapeHtml(t(key)) + "</span>";
    const row = (abbr, formula, value, flag) => "<tr><th>" + escapeHtml(t("evm.name." + abbr)) + (zh ? "" : ' <abbr>' + abbr + "</abbr>") + "</th>" +
        '<td class="evm-formula">' + escapeHtml(evmFormula(formula)) + '</td><td class="num">' + value + "</td><td>" + (flag || "") + "</td></tr>";
    const group = key => '<tr class="evm-group"><th colspan="4">' + escapeHtml(t("evm.group." + key)) + "</th></tr>";
    const table = rows => '<div class="table-scroll"><table class="evm-table"><tbody>' + rows + "</tbody></table></div>";
    /* first, three cards in plain words: cost, schedule, at completion;
       every figure (the baseline, variances, estimates, PV / EV / AC and
       the indices) is one click away */
    const card = (labelKey, state, headKey, line) => '<div class="evm-card evm-' + state + '"><small>' + escapeHtml(t(labelKey)) + "</small>" +
        "<strong>" + escapeHtml(t(headKey)) + "</strong><span>" + escapeHtml(line) + "</span></div>";
    const sign = v => v === null ? "none" : v > 0 ? "good" : v < 0 ? "bad" : "level";
    const costCard = e.cpi === null
        ? card("evm.card.cost", "none", "evm.card.costUnknown", t("evm.needAc"))
        : card("evm.card.cost", sign(e.cv), e.cv > 0 ? "evm.under" : e.cv < 0 ? "evm.over" : "evm.onBudget",
            t("evm.card.costLine", { rate: rm(e.cpi) }));
    const timeCard = e.spi === null ? "" :
        card("evm.card.time", sign(e.sv), e.sv > 0 ? "evm.ahead" : e.sv < 0 ? "evm.behind" : "evm.onSchedule",
            t("evm.card.timeLine", { pct: (e.spi * 100).toFixed(0) }));
    const endCard = e.eac === null ? "" :
        card("evm.card.end", sign(e.vac), e.vac > 0 ? "evm.underrun" : e.vac < 0 ? "evm.overrun" : "evm.onBudget",
            t(e.vac < 0 ? "evm.card.endOver" : e.vac > 0 ? "evm.card.endUnder" : "evm.card.endOn", { eac: rm(e.eac), bac: rm(e.bac), amount: rm(Math.abs(e.vac)) }));
    return '<h4 class="evm-title">' + escapeHtml(t("evm.title")) + "</h4>" +
        '<div class="evm-cards">' + costCard + timeCard + endCard + "</div>" +
        /* two tables side by side: the results (baseline, variances,
           estimates), and the figures they come from */
        fold("evm-figures", escapeHtml(t("evm.allFigures")), '<div class="evm-tables">' + table(
            group("baseline") +
            row("BAC", t("evm.f.BAC"), rm(e.bac)) +
            group("variance") +
            row("CV", "EV − AC", money(e.cv), e.cv === null ? "" : e.cv === 0 ? level("evm.onBudget") : verdict(e.cv > 0, "evm.under", "evm.over")) +
            row("SV", "EV − PV", money(e.sv), e.sv === null ? "" : e.sv === 0 ? level("evm.onSchedule") : verdict(e.sv > 0, "evm.ahead", "evm.behind")) +
            row("VAC", "BAC − EAC", money(e.vac), e.vac === null ? "" : e.vac === 0 ? level("evm.onBudget") : verdict(e.vac > 0, "evm.underrun", "evm.overrun")) +
            group("estimate") +
            row("EAC", f[0], money(e.eac)) +
            row("ETC", f[1].indexOf("evm.") === 0 ? t(f[1]) : f[1], money(e.etc))) + table(
            group("source") +
            row("PV", t("evm.f.PV"), money(e.pv)) +
            row("EV", t("evm.f.EV", { pct: e.pctComplete.toFixed(1) }), rm(e.ev)) +
            row("AC", t("evm.f.AC"), money(e.ac)) +
            row("SPI", "EV / PV", e.spi === null ? "—" : e.spi.toFixed(2), e.spi === null ? "" : e.spi === 1 ? level("evm.onSchedule") : verdict(e.spi > 1, "evm.ahead", "evm.behind")) +
            row("CPI", "EV / AC", e.cpi === null ? "—" : e.cpi.toFixed(2), e.cpi === null ? "" : e.cpi === 1 ? level("evm.onBudget") : verdict(e.cpi > 1, "evm.under", "evm.over"))) + "</div>" +
            '<p class="assistant-note">' + escapeHtml(t("evm.note")) + "</p>") +
        /* the EAC situation: an advanced choice, folded away (BAC / CPI by default) */
        fold("evm-advanced", escapeHtml(t("evm.advanced", { method: t("evm.method." + e.method) })),
        '<div class="evm-method"><label for="evmMethod">' + escapeHtml(t("evm.methodLabel")) + "</label>" +
            '<select id="evmMethod"' + (editable ? "" : " disabled") + ">" + EAC_METHODS.map(m =>
                '<option value="' + m + '"' + (m === e.method ? " selected" : "") + ">" + escapeHtml(t("evm.method." + m)) + "</option>").join("") + "</select>" +
            (e.method === "new" ? '<label for="evmEtc">' + escapeHtml(t("evm.etcLabel")) + '</label><input type="number" min="0" step="0.01" id="evmEtc" value="' +
                (e.etc === null ? "" : e.etc) + '"' + (editable ? "" : " disabled") + ">" : "") +
        "</div>" +
        '<p class="assistant-note">' + escapeHtml(t("evm.methodNote." + e.method)) + "</p>") +
        (e.missingAc && e.method !== "plan" ? '<p class="assistant-note">' + escapeHtml(t("evm.needAc")) + "</p>" : "") +
        (e.missingEtc ? '<p class="assistant-note">' + escapeHtml(t("evm.needEtc")) + "</p>" : "");
}

function tile(label, value, sub, cls) {
    /* the currency smaller, so five figures fit one row */
    const v = String(value).replace(/^(RM)\s*/, '<span class="cur">$1</span>');
    return '<div class="cp-tile' + (cls ? " " + cls : "") + '"><small>' + escapeHtml(label) + "</small><strong>" + v + "</strong>" +
        (sub ? "<span>" + escapeHtml(sub) + "</span>" : "") + "</div>";
}

/* opts: { editable, width (px the chart is shown at) } */
var MORE_START = "<!--cp-more-->";

function renderCostOverview(project, todayIso, opts) {
    const o = costOverview(project);
    const curve = sCurve(project, todayIso);
    const editable = opts && opts.editable;
    /* the S-curve's months: "toDate" (zoomed in, the default) or "all" */
    const range = opts && opts.range === "all" ? "all" : "toDate";
    const tiles = '<div class="cp-tiles">' +
        tile(t("costplan.contractSum"), rm(o.contractSum)) +
        /* the amounts alone: the counts and percentages are on the register and the analysis page */
        tile(t("costplan.approved"), rm(o.approved)) +
        tile(t("costplan.pending"), rm(o.pending)) +
        tile(t("costplan.forecast"), rm(o.forecast), "", "cp-key") +
        tile(t("costplan.certified"), rm(o.certified)) +
    "</div>";
    const drafts = "";

    let chart;
    /* the figures sit under the S-curve */
    if (!curve) chart = '<p class="assistant-note">' + escapeHtml(t("costplan.noProgramme")) + "</p>" + tiles;
    else {
        const status = curve.behind === null ? "" :
            '<p class="cp-status">' + escapeHtml(t(curve.todayX < 0 ? "costplan.notStarted" : curve.behind > 0 ? "costplan.behind" : "costplan.ahead", {
                amount: rm(Math.abs(curve.behind)), actual: curve.progressPct.toFixed(1), planned: (curve.plannedPct || 0).toFixed(1) })) + "</p>";
        /* the curve and its controls in one block, so a page can set
           something beside it (the dashboard: the site map) */
        chart = '<div class="cp-chart">' + status +
            '<div class="cp-bar"><div class="cp-legend">' +
                '<span><i class="k k-planned"></i>' + escapeHtml(t("costplan.series.planned")) + "</span>" +
                '<span><i class="k k-forecast"></i>' + escapeHtml(t("costplan.series.forecast")) + "</span>" +
                '<span><i class="k k-actual"></i>' + escapeHtml(t("costplan.series.actual")) + "</span>" +
            "</div>" +
            '<div class="sc-range" role="group" aria-label="' + escapeHtml(t("costplan.rangeLabel")) + '">' +
                ["toDate", "all"].map(r => '<button type="button" class="sc-range-btn' + (range === r ? " on" : "") + '" data-range="' + r + '" aria-pressed="' +
                    (range === r) + '">' + escapeHtml(t("costplan.range." + r)) + "</button>").join("") + "</div></div>" +
            '<div class="sc-wrap">' + renderSCurveSvg(viewCurve(curve, range), opts && opts.width, opts && opts.height) + '<div class="sc-tip" hidden></div></div></div>' +
            tiles +
            MORE_START +
            fold("cp-table", escapeHtml(t("costplan.tableTitle")),
                '<div class="table-scroll"><table class="cp-table"><thead><tr><th>' + escapeHtml(t("costplan.col.month")) + "</th><th>" +
                escapeHtml(t("costplan.series.planned")) + "</th><th>" + escapeHtml(t("costplan.series.forecast")) + "</th><th>" +
                escapeHtml(t("costplan.series.actual")) + "</th></tr></thead><tbody>" +
                curve.points.map(p => "<tr><td>" + escapeHtml(shortMonth(p.date)) + "</td><td>" + rm(p.planned) + "</td><td>" + rm(p.forecast) +
                    "</td><td>" + (p.actual === null ? "—" : rm(p.actual)) + "</td></tr>").join("") + "</tbody></table></div>");
    }

    /* in "More": how the project is doing first, then the monthly figures */
    if (curve) chart = chart.replace(MORE_START, MORE_START + renderEarnedValue(earnedValue(project, todayIso), { editable: editable }));

    const inputs = fold("cp-inputs", escapeHtml(t("costplan.inputsTitle", { n: (project.certificates || []).length })), costInputsBody(project, editable));
    /* everything after the figures (the table, earned value, the
       programme and certificates) behind one fold, or, on the dashboard,
       one link to the page that shows it all (costplan.html) */
    const more = chart.indexOf(MORE_START);
    const head = more === -1 ? chart : chart.slice(0, more);
    const rest = (more === -1 ? "" : chart.slice(more + MORE_START.length)) + inputs;
    const tail = opts && opts.detailHref
        ? '<a class="cp-detail-link" href="' + escapeHtml(opts.detailHref) + '">' + escapeHtml(t("costplan.detailLink")) + " →</a>"
        : fold("cp-more", escapeHtml(t("costplan.more")), rest, "cp-more");
    /* the drafts note and the fold share one line under the figures */
    return head + '<div class="cp-foot">' + drafts + tail + "</div>";
}

/* The programme and the interim certificates: those who keep them can change them. */
function costInputsBody(project, editable) {
    const prog = project.programme || {};
    const certs = (project.certificates || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    return '<div class="cp-prog"><label>' + escapeHtml(t("costplan.start")) + ' <input type="date" id="cpStart" value="' + escapeHtml(prog.start || "") + '"' + (editable ? "" : " disabled") + "></label>" +
        "<label>" + escapeHtml(t("costplan.end")) + ' <input type="date" id="cpEnd" value="' + escapeHtml(prog.end || "") + '"' + (editable ? "" : " disabled") + "></label></div>" +
        '<ul class="cp-certs">' + certs.map((c, i) => "<li>" + escapeHtml(t("costplan.certLine", { n: i + 1, date: c.date })) + " — <strong>" + rm(c.amount) + "</strong>" +
            (c.actual !== undefined && c.actual !== null && c.actual !== "" ? ' <span class="rate-detail">' + escapeHtml(t("costplan.actualLine", { amount: rm(Number(c.actual)) })) + "</span>" : "") +
            (editable ? ' <button type="button" class="link-button cp-cert-remove" data-date="' + escapeHtml(c.date) + '" data-amount="' + escapeHtml(String(c.amount)) + '">×</button>' : "") + "</li>").join("") + "</ul>" +
        (editable ? '<div class="cp-add"><input type="date" id="cpCertDate" aria-label="' + escapeHtml(t("costplan.certDate")) + '">' +
            '<input type="number" min="0" step="0.01" id="cpCertAmount" placeholder="' + escapeHtml(t("costplan.certAmount")) + '">' +
            '<input type="number" min="0" step="0.01" id="cpCertActual" placeholder="' + escapeHtml(t("costplan.certActual")) + '">' +
            '<button type="button" class="secondary-button" id="cpCertAdd">' + escapeHtml(t("costplan.certAdd")) + "</button></div>" : "") +
        '<p class="assistant-note">' + escapeHtml(t(editable ? "costplan.inputsNote" : "costplan.inputsReadOnly")) + "</p>";
}

/* The S-curve page (costplan.html): one view at a time, so each fits the
   screen — the curve with its figures, how the project is doing, the
   monthly figures, and the programme with its certificates. */
var COST_TABS = ["curve", "health", "table", "inputs"];

function renderCostDetail(project, todayIso, opts) {
    const editable = opts && opts.editable;
    const tab = COST_TABS.indexOf(opts && opts.tab) === -1 ? "curve" : opts.tab;
    const curve = sCurve(project, todayIso);
    const tabs = '<div class="cd-tabs" role="tablist">' + COST_TABS.map(k =>
        '<button type="button" role="tab" class="cd-tab' + (k === tab ? " on" : "") + '" data-tab="' + k + '" aria-selected="' + (k === tab) + '">' +
        escapeHtml(t("costplan.tab." + k, { n: (project.certificates || []).length })) + "</button>").join("") + "</div>";
    let body;
    if (tab === "curve" || !curve) {
        const full = renderCostOverview(project, todayIso, Object.assign({}, opts, { detailHref: "#" }));
        body = full.slice(0, full.indexOf('<div class="cp-foot">'));
        const o = costOverview(project);
        if (!curve && tab !== "curve") body += costInputsBody(project, editable);
    } else if (tab === "health") {
        /* every figure open beside the three cards: the page has the room */
        body = renderEarnedValue(earnedValue(project, todayIso), { editable: editable })
            .replace('<details class="fold" data-fold="evm-figures">', '<details class="fold" data-fold="evm-figures" open>');
    } else if (tab === "table") {
        /* the monthly figures: the model's until the team uploads its own
           cash-flow sheet or types over a cell (project.cashflow) */
        const cf = project.cashflow || {};
        const own = cf.months || {};
        const cell = (p, k) => {
            const key = p.date.slice(0, 7), mine = own[key] && own[key][k] !== undefined && own[key][k] !== "";
            return editable
                ? '<td class="cd-cell' + (mine ? " cd-own" : "") + '"><input type="text" inputmode="decimal" data-cf-key="' + key + '" data-cf-k="' + k + '" value="' +
                    escapeHtml(Number(p[k]).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '" aria-label="' +
                    escapeHtml(shortMonth(p.date) + " " + t("costplan.series." + k)) + '"></td>'
                : '<td class="cd-cell' + (mine ? " cd-own" : "") + '">' + rm(p[k]) + "</td>";
        };
        const source = cf.source ? t("costplan.cf.source", { name: cf.source.name || "—", date: cf.source.at || "" }) :
            Object.keys(own).length ? t("costplan.cf.edited") : t(editable ? "costplan.cf.model" : "costplan.cf.modelReadOnly");
        body = '<div class="cd-cf-bar">' +
                '<span class="rate-detail">' + escapeHtml(source) + "</span>" +
                (editable ? '<span class="cd-cf-actions">' +
                    '<select id="cfMode" aria-label="' + escapeHtml(t("costplan.cf.modeLabel")) + '">' +
                        ["auto", "cumulative", "monthly"].map(m => '<option value="' + m + '">' + escapeHtml(t("costplan.cf.mode." + m)) + "</option>").join("") + "</select>" +
                    '<label class="doc-upload-btn">' + escapeHtml(t("costplan.cf.upload")) + '<input type="file" id="cfFile" accept=".xlsx,.csv" hidden></label>' +
                    (Object.keys(own).length ? '<button type="button" class="link-button" id="cfReset">' + escapeHtml(t("costplan.cf.reset")) + "</button>" : "") +
                "</span>" : "") +
            "</div>" +
            '<div class="table-scroll cd-scroll" data-fit data-fit-gap="40"><table class="cp-table"><thead><tr><th>' + escapeHtml(t("costplan.col.month")) + "</th><th>" +
            escapeHtml(t("costplan.series.planned")) + "</th><th>" + escapeHtml(t("costplan.series.forecast")) + "</th><th>" +
            escapeHtml(t("costplan.series.actual")) + "</th></tr></thead><tbody>" +
            curve.points.map(p => "<tr><td>" + escapeHtml(shortMonth(p.date)) + "</td>" + cell(p, "planned") + cell(p, "forecast") +
                "<td>" + (p.actual === null ? "—" : rm(p.actual)) + "</td></tr>").join("") + "</tbody></table></div>" +
            '<p class="assistant-note">' + escapeHtml(t(editable ? "costplan.cf.note" : "costplan.cf.noteReadOnly")) + "</p>";
    } else {
        body = '<div class="cd-scroll" data-fit data-fit-gap="40">' + costInputsBody(project, editable) + "</div>";
    }
    return tabs + '<div class="cd-pane cd-' + tab + '">' + body + "</div>";
}

/* The crosshair: snaps to the nearest month, lists all three series.
   Scroll on the chart zooms in and out around the pointer (the money axis
   then covers only what is in view, so the three lines separate); drag
   moves along; a double-click or "reset" shows it all again. */
function mountCostChart(host, full) {
    const wrap = host.querySelector(".sc-wrap"), tip = host.querySelector(".sc-tip");
    if (!wrap || !tip || !full) return;
    const first = wrap.querySelector(".sc-svg");
    if (!first) return;
    const vb = first.getAttribute("viewBox").split(" ").map(Number);
    const W0 = vb[2], H0 = vb[3];
    const N = full.points.length;
    let i0 = 0, i1 = N - 1;
    let reset = wrap.querySelector(".sc-reset");
    if (!reset) {
        reset = document.createElement("button");
        reset.type = "button"; reset.className = "sc-reset"; reset.hidden = true;
        reset.textContent = t("costplan.zoomReset");
        wrap.appendChild(reset);
        const hint = document.createElement("span");
        hint.className = "sc-hint"; hint.textContent = t("costplan.zoomHint");
        wrap.appendChild(hint);
    }
    function redraw() {
        const view = zoomCurve(full, i0, i1);
        const old = wrap.querySelector(".sc-svg");
        const tmp = document.createElement("div");
        tmp.innerHTML = renderSCurveSvg(view, W0, H0, { fitY: view.zoomed });
        old.replaceWith(tmp.firstChild);
        reset.hidden = !view.zoomed;
        wire(view);
    }
    function wire(curve) {
        const svg = wrap.querySelector(".sc-svg");
        const cross = svg.querySelector(".sc-cross"), hit = svg.querySelector(".sc-hit");
        const L = +svg.dataset.left, R = +svg.dataset.right, W = +svg.dataset.width;
        const n = curve.points.length;
        const at = evt => {
            const box = svg.getBoundingClientRect();
            const sx = (evt.clientX - box.left) * W / box.width;
            return { box: box, f: Math.max(0, Math.min(1, (sx - L) / (W - L - R))) };
        };
        function show(evt) {
            const a = at(evt), box = a.box;
            const i = Math.max(0, Math.min(n - 1, Math.round(a.f * Math.max(1, n - 1))));
            const px = L + i * (W - L - R) / Math.max(1, n - 1);
            cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.style.display = "";
            const p = curve.points[i];
            tip.textContent = "";
            const head = document.createElement("div"); head.className = "sc-tip-head"; head.textContent = shortMonth(p.date); tip.appendChild(head);
            [["planned", p.planned], ["forecast", p.forecast], ["actual", p.actual]].forEach(r => {
                const row = document.createElement("div"); row.className = "sc-tip-row";
                const k = document.createElement("i"); k.className = "k k-" + r[0]; row.appendChild(k);
                const v = document.createElement("strong"); v.textContent = r[1] === null ? "—" : rm(r[1]); row.appendChild(v);
                const l = document.createElement("span"); l.textContent = t("costplan.series." + r[0]); row.appendChild(l);
                tip.appendChild(row);
            });
            tip.hidden = false;
            const left = (px / W) * box.width;
            tip.style.left = Math.min(box.width - 190, Math.max(0, left + 12)) + "px";
        }
        let drag = null;
        hit.addEventListener("pointermove", evt => {
            if (drag) {
                const span = i1 - i0;
                const shift = Math.round((drag.x - evt.clientX) / (drag.w / Math.max(1, span)));
                if (shift) {
                    const a = Math.max(0, Math.min(N - 1 - span, drag.i0 + shift));
                    if (a !== i0) { i0 = a; i1 = a + span; drag.moved = true; redraw(); return; }
                }
            }
            show(evt);
        });
        hit.addEventListener("pointerdown", evt => {
            drag = { x: evt.clientX, w: svg.getBoundingClientRect().width * (W - L - R) / W, i0: i0 };
            show(evt);
        });
        hit.addEventListener("pointerup", () => { drag = null; });
        hit.addEventListener("pointerleave", () => { drag = null; cross.style.display = "none"; tip.hidden = true; });
        hit.addEventListener("dblclick", () => { i0 = 0; i1 = N - 1; redraw(); });
        svg.addEventListener("wheel", evt => {
            if (N < 3) return;
            evt.preventDefault();
            const f = at(evt).f;
            const span = i1 - i0;
            const next = evt.deltaY < 0 ? Math.max(2, Math.round(span * 0.7)) : Math.min(N - 1, Math.max(span + 1, Math.round(span / 0.7)));
            if (next === span) return;
            const centre = i0 + f * span;
            let a = Math.round(centre - f * next);
            a = Math.max(0, Math.min(N - 1 - next, a));
            i0 = a; i1 = a + next;
            redraw();
        }, { passive: false });
    }
    reset.onclick = () => { i0 = 0; i1 = N - 1; redraw(); };
    wire(full);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { costOverviewVisible, costOverviewEditable, viewCurve, EAC_METHODS, voValue, costOverview, sFraction, sCurve, earnedValue, renderEarnedValue, renderCostOverview, renderCostDetail, COST_TABS, renderSCurveSvg, zoomCurve, niceStep, readCashflowSheet, cfMonthKey };
}
