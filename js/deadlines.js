/* VO-AI | deadlines.js — contractual time-bar clocks.
   Pure functions only: no localStorage, no new Date() inside the
   calculations, every "today" is passed in explicitly. All dates are
   ISO "YYYY-MM-DD" strings and all arithmetic is done in UTC so a
   viewer's timezone can never shift a due date by a day. */

/* ---------- the three periods, as named constants ----------
   The client specified these; INFO_REQUEST_DAYS's start date (the date
   the contractor issues the VO) is VO-AI's interpretation of an
   ambiguous requirement and may need correcting later. Change the
   number here — nothing else needs to change.

   `var`, not `const`: other page-*.js files re-declare these names in a
   parse-time-hoisted guarded `var` for their Node import. `const` here
   would be a SyntaxError in the browser, where every js/ file shares
   one global scope (see js/store.js's ROLES and js/permissions.js's
   FIELD_OWNER for the same rule already in force). */
var EVALUATION_DAYS = 30;    /* consultant: evaluate the VO, from dateIssued */
var INFO_REQUEST_DAYS = 28;  /* consultant: request further info, from dateIssued (our interpretation) */
var INFO_RESPONSE_DAYS = 28; /* contractor: respond to that request, from the request date */

/* ---------- UTC-safe date arithmetic ---------- */

/* "YYYY-MM-DD" -> UTC epoch millis at midnight. Never uses new Date(iso)
   directly — that parses as UTC in some engines and local time in
   others depending on the string shape, which is exactly the drift
   that bit this app once already (toISOString() one day off at UTC+8). */
function parseIsoUTC(isoDate) {
    const parts = String(isoDate || "").split("-").map(Number);
    const y = parts[0], m = parts[1], d = parts[2];
    if (!y || !m || !d) return NaN;
    return Date.UTC(y, m - 1, d);
}

function formatIsoUTC(ms) {
    const dt = new Date(ms);
    const pad = n => String(n).padStart(2, "0");
    return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate());
}

/* addDays(isoDate, days) -> isoDate */
function addDays(isoDate, days) {
    const ms = parseIsoUTC(isoDate);
    if (isNaN(ms)) return null;
    return formatIsoUTC(ms + Number(days) * 86400000);
}

/* Whole calendar days from `fromIso` to `toIso` (positive = toIso is later). */
function daysBetween(fromIso, toIso) {
    const from = parseIsoUTC(fromIso);
    const to = parseIsoUTC(toIso);
    if (isNaN(from) || isNaN(to)) return null;
    return Math.round((to - from) / 86400000);
}

function stateFromDays(daysRemaining) {
    if (daysRemaining < 0) return "overdue";
    if (daysRemaining <= 7) return "due-soon";
    return "open";
}

/* ---------- clocks for one VO ---------- */

/* deadlinesFor(vo, today) -> [{ id, label, owner, dueDate, daysRemaining,
   state, satisfied, note }]
   `today` is an ISO "YYYY-MM-DD" string supplied by the caller — this
   function never calls new Date() itself, so it is deterministic. */
function deadlinesFor(vo, todayIso) {
    vo = vo || {};
    const hasIssued = !!vo.dateIssued;
    const evalSatisfied = vo.evaluateStatus === "Approved" || vo.evaluateStatus === "Rejected";
    const items = [];

    /* Clock 1: evaluation — consultant, from dateIssued, 30 days. */
    let evalDue = null, evalDays = null, evalNote = "";
    if (hasIssued) {
        evalDue = addDays(vo.dateIssued, EVALUATION_DAYS);
        evalDays = daysBetween(todayIso, evalDue);
    } else {
        evalNote = "No issue date recorded yet — this clock has not started.";
    }
    if (evalSatisfied) evalNote = "Evaluation completed (" + vo.evaluateStatus + ").";
    items.push({
        id: "evaluation",
        label: "Evaluation",
        owner: "consultant",
        dueDate: evalDue,
        daysRemaining: evalSatisfied ? null : evalDays,
        state: evalSatisfied ? "satisfied" : (evalDue === null ? "not-started" : stateFromDays(evalDays)),
        satisfied: evalSatisfied,
        note: evalNote
    });

    /* Clock 2: request for further information — consultant, from
       dateIssued, 28 days. Satisfied once the request has been made;
       also moot (treated as satisfied) once evaluation is complete. */
    let reqDue = null, reqDays = null, reqNote = "", reqSatisfied = false;
    if (vo.infoRequestedAt) {
        reqSatisfied = true;
        reqNote = "Information request made on " + vo.infoRequestedAt + ".";
        reqDue = hasIssued ? addDays(vo.dateIssued, INFO_REQUEST_DAYS) : null;
    } else if (evalSatisfied) {
        reqSatisfied = true;
        reqNote = "Moot — the VO was evaluated without a request for further information.";
        reqDue = hasIssued ? addDays(vo.dateIssued, INFO_REQUEST_DAYS) : null;
    } else if (hasIssued) {
        reqDue = addDays(vo.dateIssued, INFO_REQUEST_DAYS);
        reqDays = daysBetween(todayIso, reqDue);
    } else {
        reqNote = "No issue date recorded yet — this clock has not started.";
    }
    items.push({
        id: "info-request",
        label: "Request for further information",
        owner: "consultant",
        dueDate: reqDue,
        daysRemaining: reqSatisfied ? null : reqDays,
        state: reqSatisfied ? "satisfied" : (reqDue === null ? "not-started" : stateFromDays(reqDays)),
        satisfied: reqSatisfied,
        note: reqNote
    });

    /* Clock 3: response to that request — contractor, from the request
       date, 28 days. Only exists once a request has actually been
       made. Satisfied once a document is attached on or after the
       request date. */
    let resDue = null, resDays = null, resNote = "", resSatisfied = false;
    if (!vo.infoRequestedAt) {
        resNote = "The consultant has not requested further information — this clock has not started.";
    } else {
        resDue = addDays(vo.infoRequestedAt, INFO_RESPONSE_DAYS);
        const docs = [].concat(vo.revisedDrawing || [], vo.oldDrawing || [], vo.supportingDocs || []);
        resSatisfied = docs.some(d => d && d.at && d.at >= vo.infoRequestedAt);
        if (resSatisfied) {
            resNote = "A document was attached on or after the request date.";
        } else {
            resDays = daysBetween(todayIso, resDue);
        }
    }
    items.push({
        id: "response",
        label: "Response to information request",
        owner: "contractor",
        dueDate: resDue,
        daysRemaining: resSatisfied ? null : resDays,
        state: resSatisfied ? "satisfied" : (resDue === null ? "not-started" : stateFromDays(resDays)),
        satisfied: resSatisfied,
        note: resNote
    });

    return items;
}

/* ---------- roll-up across a project, for one role ---------- */

const STATE_PRIORITY = { "overdue": 0, "due-soon": 1, "open": 2, "not-started": 3, "satisfied": 4 };

/* deadlineSummary(project, role, today) -> { overdue, dueSoon, items }
   Only the clocks that ROLE owns are returned — the client owns none
   of the three clocks, so their summary is correctly empty. Items are
   sorted overdue first, then due-soon, then open/not-started/satisfied,
   and within a state by soonest due date. */
function deadlineSummary(project, role, todayIso) {
    const vos = (project && project.vos) || [];
    const items = [];
    vos.forEach(vo => {
        deadlinesFor(vo, todayIso).forEach(d => {
            if (d.owner !== role) return;
            items.push(Object.assign({ voId: vo.id, voNo: vo.no }, d));
        });
    });
    items.sort((a, b) => {
        const p = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
        if (p !== 0) return p;
        const da = a.daysRemaining === null ? Infinity : a.daysRemaining;
        const db = b.daysRemaining === null ? Infinity : b.daysRemaining;
        return da - db;
    });
    return {
        overdue: items.filter(i => i.state === "overdue").length,
        dueSoon: items.filter(i => i.state === "due-soon").length,
        items: items
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        EVALUATION_DAYS, INFO_REQUEST_DAYS, INFO_RESPONSE_DAYS,
        addDays, daysBetween, deadlinesFor, deadlineSummary
    };
}
