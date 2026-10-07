/* VO-AI | costplan.js — the client's overview of the project's cost.

   What the project will cost, from the contract sum and the variations:
     - approved VOs: the client certified them (their final price, else the
       assessed value);
     - pending VOs: submitted and still moving (the assessed value once the
       consultant QS approved it, else what the contractor claims);
     - drafts: the contractor's, not yet submitted (shown, not counted);
     forecast final cost = contract sum + approved + pending.

   The S-curve: cumulative cost month by month over the programme.
     - planned: the contract sum spread over the programme on the standard
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
    const certified = ((project && project.certificates) || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    return {
        contractSum: sum, approved: approved, pending: pending, draft: draft,
        nApproved: nApproved, nPending: nPending, nDraft: nDraft,
        forecast: forecast, change: forecast - sum, changePct: sum ? (forecast - sum) / sum * 100 : 0,
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
            planned: Math.round(o.contractSum * sFraction(x)),
            forecast: Math.round(o.forecast * sFraction(x)),
            /* actual only up to the month of the latest certificate */
            actual: lastCert && date.slice(0, 7) <= lastCert.slice(0, 7) ? certifiedTo : null
        };
    });
    /* where things stand today: plan to date, and how far ahead or behind */
    const x = todayIso ? (dayNo(todayIso) - s) / (e - s) : null;
    const plannedToday = x === null ? null : Math.round(o.contractSum * sFraction(x));
    return {
        points: points, today: todayIso, todayX: x, plannedToday: plannedToday,
        certified: o.certified, behind: plannedToday === null ? null : plannedToday - o.certified,
        progressPct: o.contractSum ? o.certified / o.contractSum * 100 : 0,
        plannedPct: plannedToday === null || !o.contractSum ? null : plannedToday / o.contractSum * 100
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
function renderSCurveSvg(curve, width) {
    /* drawn at the width it is shown at, so text stays 11px on a phone */
    const W = Math.max(300, Math.min(1000, Math.round(width || 760)));
    const H = W < 500 ? 240 : 300, L = 62, R = 14, T = 16, B = 34;
    const pts = curve.points;
    const max = Math.max.apply(null, pts.map(p => Math.max(p.planned, p.forecast, p.actual || 0))) || 1;
    const step = niceStep(max / 4);
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
    if (curve.todayX !== null && curve.todayX >= 0 && curve.todayX <= 1) {
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
        '<line class="sc-cross" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" hidden/>' +
        '<rect class="sc-hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/>' +
    "</svg>";
}

function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
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
            '<div class="sc-wrap">' + renderSCurveSvg(curve, opts && opts.width) + '<div class="sc-tip" hidden></div></div>' +
            '<p class="assistant-note">' + escapeHtml(t("costplan.curveNote")) + "</p>" +
            fold("cp-table", escapeHtml(t("costplan.tableTitle")),
                '<div class="table-scroll"><table class="cp-table"><thead><tr><th>' + escapeHtml(t("costplan.col.month")) + "</th><th>" +
                escapeHtml(t("costplan.series.planned")) + "</th><th>" + escapeHtml(t("costplan.series.forecast")) + "</th><th>" +
                escapeHtml(t("costplan.series.actual")) + "</th></tr></thead><tbody>" +
                curve.points.map(p => "<tr><td>" + escapeHtml(shortMonth(p.date)) + "</td><td>" + rm(p.planned) + "</td><td>" + rm(p.forecast) +
                    "</td><td>" + (p.actual === null ? "—" : rm(p.actual)) + "</td></tr>").join("") + "</tbody></table></div>");
    }

    const prog = project.programme || {};
    const certs = (project.certificates || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const inputs = fold("cp-inputs", escapeHtml(t("costplan.inputsTitle", { n: certs.length })),
        '<div class="cp-prog"><label>' + escapeHtml(t("costplan.start")) + ' <input type="date" id="cpStart" value="' + escapeHtml(prog.start || "") + '"' + (editable ? "" : " disabled") + "></label>" +
        "<label>" + escapeHtml(t("costplan.end")) + ' <input type="date" id="cpEnd" value="' + escapeHtml(prog.end || "") + '"' + (editable ? "" : " disabled") + "></label></div>" +
        '<ul class="cp-certs">' + certs.map((c, i) => "<li>" + escapeHtml(t("costplan.certLine", { n: i + 1, date: c.date })) + " — <strong>" + rm(c.amount) + "</strong>" +
            (editable ? ' <button type="button" class="link-button cp-cert-remove" data-date="' + escapeHtml(c.date) + '" data-amount="' + escapeHtml(String(c.amount)) + '">×</button>' : "") + "</li>").join("") + "</ul>" +
        (editable ? '<div class="cp-add"><input type="date" id="cpCertDate" aria-label="' + escapeHtml(t("costplan.certDate")) + '">' +
            '<input type="number" min="0" step="0.01" id="cpCertAmount" placeholder="' + escapeHtml(t("costplan.certAmount")) + '">' +
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
        cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.hidden = false;
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
    hit.addEventListener("pointerleave", () => { cross.hidden = true; tip.hidden = true; });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { voValue, costOverview, sFraction, sCurve, renderCostOverview, renderSCurveSvg, niceStep };
}
