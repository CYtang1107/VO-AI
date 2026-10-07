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
    var { t } = require("./i18n.js");
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
    const points = months.map(date => {
        const x = (dayNo(date) - s) / (e - s);
        const certifiedTo = certs.filter(c => c.date <= date).reduce((a, c) => a + Number(c.amount), 0);
        return {
            date: date,
            planned: Math.round(o.baseline * sFraction(x)),
            forecast: Math.round(o.forecast * sFraction(x)),
            /* actual only up to the month of the latest certificate */
            actual: lastCert && date.slice(0, 7) <= lastCert.slice(0, 7) ? certifiedTo : null
        };
    });
    /* where things stand today: plan to date, and how far ahead or behind */
    const x = todayIso ? (dayNo(todayIso) - s) / (e - s) : null;
    const plannedToday = x === null ? null : Math.round(o.baseline * sFraction(x));
    return {
        points: points, today: todayIso, todayX: x, plannedToday: plannedToday,
        certified: o.certified, behind: plannedToday === null ? null : plannedToday - o.certified,
        progressPct: o.baseline ? o.certified / o.baseline * 100 : 0,
        plannedPct: plannedToday === null || !o.baseline ? null : plannedToday / o.baseline * 100
    };
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
function earnedValue(project, todayIso) {
    const o = costOverview(project);
    const curve = sCurve(project, todayIso);
    const certs = ((project && project.certificates) || []).filter(c => Number(c.amount) > 0 && (!todayIso || c.date <= todayIso));
    const bac = o.baseline;
    const pv = curve ? curve.plannedToday : null;
    const ev = certs.reduce((s, c) => s + Number(c.amount), 0);
    const haveAc = certs.length > 0 && certs.every(c => c.actual !== undefined && c.actual !== null && c.actual !== "" && Number(c.actual) >= 0);
    const ac = haveAc ? certs.reduce((s, c) => s + Number(c.actual), 0) : null;
    const r2 = n => Math.round(n * 100) / 100;
    const sv = pv === null ? null : ev - pv;
    const spi = pv ? r2(ev / pv) : null;
    const cv = ac === null ? null : ev - ac;
    const cpi = ac ? r2(ev / ac) : null;
    const method = EAC_METHODS.indexOf(project && project.eacMethod) >= 0 ? project.eacMethod : "cpi";
    const etcIn = project && project.etcEstimate !== undefined && project.etcEstimate !== null && project.etcEstimate !== ""
        ? Number(project.etcEstimate) : null;
    let eac = null, etc = null;
    if (method === "plan") { eac = bac; etc = bac - ev; }
    else if (method === "cpi" && ac) { eac = Math.round(bac / (ev / ac)); etc = Math.round((bac - ev) / (ev / ac)); }
    else if (method === "atypical" && ac !== null) { etc = bac - ev; eac = ac + etc; }
    else if (method === "new" && ac !== null && etcIn !== null && etcIn >= 0) { etc = Math.round(etcIn); eac = ac + etc; }
    return {
        bac: bac, pv: pv, ev: ev, ac: ac, pctComplete: bac ? ev / bac * 100 : 0,
        sv: sv, spi: spi, cv: cv, cpi: cpi,
        method: method, eac: eac, etc: etc, vac: eac === null ? null : bac - eac,
        missingAc: certs.length > 0 && !haveAc,
        missingEtc: method === "new" && etcIn === null
    };
}

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

function renderSCurveSvg(curve, width) {
    /* drawn at the width it is shown at, so text stays 11px on a phone;
       taller on a wide screen, so the lines do not flatten */
    const W = Math.max(300, Math.min(1800, Math.round(width || 760)));
    const H = Math.max(240, Math.min(440, Math.round(W * 0.4))), L = 70, R = 14, T = 16, B = 34;
    const pts = curve.points;
    const max = Math.max.apply(null, pts.map(p => Math.max(p.planned, p.forecast, p.actual || 0))) || 1;
    /* about one gridline per 55 px of height */
    const step = niceStep(max / Math.max(4, Math.floor((H - T - B) / 55)));
    const top = Math.ceil(max / step) * step;
    const x = i => L + (pts.length === 1 ? 0 : i * (W - L - R) / (pts.length - 1));
    const y = v => T + (H - T - B) * (1 - v / top);
    const path = key => pts.map((p, i) => p[key] === null ? null : [x(i), y(p[key])]).filter(Boolean)
        .map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
    const grid = [];
    for (let v = 0; v <= top + 1; v += step) {
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
    if (curve.todayX !== null && curve.todayX >= 0 && curve.todayX <= 1 && curve.today <= pts[pts.length - 1].date) {
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
function renderEarnedValue(e, opts) {
    const editable = opts && opts.editable;
    const f = EAC_FORMULA[e.method];
    const money = v => v === null ? "—" : (v < 0 ? "−" : "") + rm(Math.abs(v));
    const verdict = (good, keyGood, keyBad) => good === null ? "" :
        '<span class="evm-flag ' + (good ? "evm-good" : "evm-bad") + '">' + (good ? "✓ " : "! ") + escapeHtml(t(good ? keyGood : keyBad)) + "</span>";
    /* exactly on plan: neither good nor bad */
    const level = key => '<span class="evm-flag evm-level">= ' + escapeHtml(t(key)) + "</span>";
    const row = (abbr, formula, value, flag) => "<tr><th>" + escapeHtml(t("evm.name." + abbr)) + ' <abbr>' + abbr + "</abbr></th>" +
        '<td class="evm-formula">' + escapeHtml(formula) + '</td><td class="num">' + value + "</td><td>" + (flag || "") + "</td></tr>";
    const group = key => '<tr class="evm-group"><th colspan="4">' + escapeHtml(t("evm.group." + key)) + "</th></tr>";
    const table = rows => '<div class="table-scroll"><table class="evm-table"><tbody>' + rows + "</tbody></table></div>";
    /* shown: the baseline, the three variances and the two estimates;
       the figures they come from (PV, EV, AC) and the indices (SPI, CPI)
       are one click away */
    return '<h4 class="evm-title">' + escapeHtml(t("evm.title")) + "</h4>" +
        table(
            group("baseline") +
            row("BAC", t("evm.f.BAC"), rm(e.bac)) +
            group("variance") +
            row("CV", "EV − AC", money(e.cv), e.cv === null ? "" : e.cv === 0 ? level("evm.onBudget") : verdict(e.cv > 0, "evm.under", "evm.over")) +
            row("SV", "EV − PV", money(e.sv), e.sv === null ? "" : e.sv === 0 ? level("evm.onSchedule") : verdict(e.sv > 0, "evm.ahead", "evm.behind")) +
            row("VAC", "BAC − EAC", money(e.vac), e.vac === null ? "" : e.vac === 0 ? level("evm.onBudget") : verdict(e.vac > 0, "evm.underrun", "evm.overrun")) +
            group("estimate") +
            row("EAC", f[0], money(e.eac)) +
            row("ETC", f[1].indexOf("evm.") === 0 ? t(f[1]) : f[1], money(e.etc))) +
        fold("evm-detail", escapeHtml(t("evm.detail")), table(
            row("PV", t("evm.f.PV"), money(e.pv)) +
            row("EV", t("evm.f.EV", { pct: e.pctComplete.toFixed(1) }), rm(e.ev)) +
            row("AC", t("evm.f.AC"), money(e.ac)) +
            row("SPI", "EV / PV", e.spi === null ? "—" : e.spi.toFixed(2), e.spi === null ? "" : e.spi === 1 ? level("evm.onSchedule") : verdict(e.spi > 1, "evm.ahead", "evm.behind")) +
            row("CPI", "EV / AC", e.cpi === null ? "—" : e.cpi.toFixed(2), e.cpi === null ? "" : e.cpi === 1 ? level("evm.onBudget") : verdict(e.cpi > 1, "evm.under", "evm.over")))) +
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
        (e.missingEtc ? '<p class="assistant-note">' + escapeHtml(t("evm.needEtc")) + "</p>" : "") +
        '<p class="assistant-note">' + escapeHtml(t("evm.note")) + "</p>";
}

function tile(label, value, sub, cls) {
    return '<div class="cp-tile' + (cls ? " " + cls : "") + '"><small>' + escapeHtml(label) + "</small><strong>" + value + "</strong>" +
        (sub ? "<span>" + escapeHtml(sub) + "</span>" : "") + "</div>";
}

/* opts: { editable, width (px the chart is shown at) } */
function renderCostOverview(project, todayIso, opts) {
    const o = costOverview(project);
    const curve = sCurve(project, todayIso);
    const editable = opts && opts.editable;
    /* the S-curve's months: "toDate" (zoomed in, the default) or "all" */
    const range = opts && opts.range === "all" ? "all" : "toDate";
    const tiles = '<div class="cp-tiles">' +
        tile(t("costplan.contractSum"), rm(o.contractSum)) +
        tile(t("costplan.approved"), rm(o.approved), t("costplan.nVos", { n: o.nApproved })) +
        tile(t("costplan.pending"), rm(o.pending), t("costplan.nVos", { n: o.nPending })) +
        tile(t("costplan.forecast"), rm(o.forecast), t("costplan.change", { sign: o.change >= 0 ? "+" : "−", amount: rm(Math.abs(o.change)), pct: Math.abs(o.changePct).toFixed(1) }), "cp-key") +
        tile(t("costplan.certified"), rm(o.certified), t("costplan.certifiedPct", { pct: o.certifiedPct.toFixed(1) })) +
    "</div>" +
    (o.nDraft ? '<p class="assistant-note">' + escapeHtml(t("costplan.drafts", { n: o.nDraft, amount: rm(o.draft) })) + "</p>" : "");

    let chart;
    if (!curve) chart = '<p class="assistant-note">' + escapeHtml(t("costplan.noProgramme")) + "</p>";
    else {
        const status = curve.behind === null ? "" :
            '<p class="cp-status">' + escapeHtml(t(curve.todayX < 0 ? "costplan.notStarted" : curve.behind > 0 ? "costplan.behind" : "costplan.ahead", {
                amount: rm(Math.abs(curve.behind)), actual: curve.progressPct.toFixed(1), planned: (curve.plannedPct || 0).toFixed(1) })) + "</p>";
        chart = status +
            '<div class="cp-legend">' +
                '<span><i class="k k-planned"></i>' + escapeHtml(t("costplan.series.planned")) + "</span>" +
                '<span><i class="k k-forecast"></i>' + escapeHtml(t("costplan.series.forecast")) + "</span>" +
                '<span><i class="k k-actual"></i>' + escapeHtml(t("costplan.series.actual")) + "</span>" +
            "</div>" +
            '<div class="sc-range" role="group" aria-label="' + escapeHtml(t("costplan.rangeLabel")) + '">' +
                ["toDate", "all"].map(r => '<button type="button" class="sc-range-btn' + (range === r ? " on" : "") + '" data-range="' + r + '" aria-pressed="' +
                    (range === r) + '">' + escapeHtml(t("costplan.range." + r)) + "</button>").join("") + "</div>" +
            '<div class="sc-wrap">' + renderSCurveSvg(viewCurve(curve, range), opts && opts.width) + '<div class="sc-tip" hidden></div></div>' +
            '<p class="assistant-note">' + escapeHtml(t("costplan.curveNote")) + "</p>" +
            fold("cp-table", escapeHtml(t("costplan.tableTitle")),
                '<div class="table-scroll"><table class="cp-table"><thead><tr><th>' + escapeHtml(t("costplan.col.month")) + "</th><th>" +
                escapeHtml(t("costplan.series.planned")) + "</th><th>" + escapeHtml(t("costplan.series.forecast")) + "</th><th>" +
                escapeHtml(t("costplan.series.actual")) + "</th></tr></thead><tbody>" +
                curve.points.map(p => "<tr><td>" + escapeHtml(shortMonth(p.date)) + "</td><td>" + rm(p.planned) + "</td><td>" + rm(p.forecast) +
                    "</td><td>" + (p.actual === null ? "—" : rm(p.actual)) + "</td></tr>").join("") + "</tbody></table></div>");
    }

    if (curve) chart += renderEarnedValue(earnedValue(project, todayIso), { editable: editable });

    const prog = project.programme || {};
    const certs = (project.certificates || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const inputs = fold("cp-inputs", escapeHtml(t("costplan.inputsTitle", { n: certs.length })),
        '<div class="cp-prog"><label>' + escapeHtml(t("costplan.start")) + ' <input type="date" id="cpStart" value="' + escapeHtml(prog.start || "") + '"' + (editable ? "" : " disabled") + "></label>" +
        "<label>" + escapeHtml(t("costplan.end")) + ' <input type="date" id="cpEnd" value="' + escapeHtml(prog.end || "") + '"' + (editable ? "" : " disabled") + "></label></div>" +
        '<ul class="cp-certs">' + certs.map((c, i) => "<li>" + escapeHtml(t("costplan.certLine", { n: i + 1, date: c.date })) + " — <strong>" + rm(c.amount) + "</strong>" +
            (c.actual !== undefined && c.actual !== null && c.actual !== "" ? ' <span class="rate-detail">' + escapeHtml(t("costplan.actualLine", { amount: rm(Number(c.actual)) })) + "</span>" : "") +
            (editable ? ' <button type="button" class="link-button cp-cert-remove" data-date="' + escapeHtml(c.date) + '" data-amount="' + escapeHtml(String(c.amount)) + '">×</button>' : "") + "</li>").join("") + "</ul>" +
        (editable ? '<div class="cp-add"><input type="date" id="cpCertDate" aria-label="' + escapeHtml(t("costplan.certDate")) + '">' +
            '<input type="number" min="0" step="0.01" id="cpCertAmount" placeholder="' + escapeHtml(t("costplan.certAmount")) + '">' +
            '<input type="number" min="0" step="0.01" id="cpCertActual" placeholder="' + escapeHtml(t("costplan.certActual")) + '">' +
            '<button type="button" class="secondary-button" id="cpCertAdd">' + escapeHtml(t("costplan.certAdd")) + "</button></div>" : "") +
        '<p class="assistant-note">' + escapeHtml(t(editable ? "costplan.inputsNote" : "costplan.inputsReadOnly")) + "</p>");
    return tiles + chart + inputs;
}

/* The crosshair: snaps to the nearest month, lists all three series. */
function mountCostChart(host, curve) {
    const svg = host.querySelector(".sc-svg"), tip = host.querySelector(".sc-tip");
    if (!svg || !tip || !curve) return;
    const cross = svg.querySelector(".sc-cross"), hit = svg.querySelector(".sc-hit");
    const L = +svg.dataset.left, R = +svg.dataset.right, W = +svg.dataset.width;
    const n = curve.points.length;
    function show(evt) {
        const box = svg.getBoundingClientRect();
        const sx = (evt.clientX - box.left) * W / box.width;
        const i = Math.max(0, Math.min(n - 1, Math.round((sx - L) / ((W - L - R) / Math.max(1, n - 1)))));
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
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", () => { cross.style.display = "none"; tip.hidden = true; });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { viewCurve, EAC_METHODS, voValue, costOverview, sFraction, sCurve, earnedValue, renderEarnedValue, renderCostOverview, renderSCurveSvg, niceStep };
}
