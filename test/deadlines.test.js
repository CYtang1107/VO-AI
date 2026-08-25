const test = require("node:test");
const assert = require("node:assert");
const {
    EVALUATION_DAYS, INFO_REQUEST_DAYS, INFO_RESPONSE_DAYS,
    addDays, daysBetween, deadlinesFor, deadlineSummary
} = require("../js/deadlines.js");
const { newVO } = require("../js/store.js");

function vo(overrides) {
    return Object.assign(newVO(1), {
        dateIssued: "2026-07-01",
        submitted: true,
        evaluateStatus: "Pending"
    }, overrides);
}

/* ---------- addDays / daysBetween: UTC-safe arithmetic ---------- */

test("addDays adds calendar days without any timezone drift", () => {
    assert.strictEqual(addDays("2026-07-01", 30), "2026-07-31");
    assert.strictEqual(addDays("2026-01-01", 31), "2026-02-01");
    assert.strictEqual(addDays("2026-02-01", -1), "2026-01-31");
});

test("addDays is stable regardless of the host's local timezone", () => {
    /* The app already had a bug where toISOString() produced the previous
       day's date for a UTC+8 viewer. addDays must never route through
       new Date(isoString) / toISOString() in a way that can reproduce
       that: adding 0 days must return exactly the input, and the date
       boundary must fall exactly on the calendar day, not shifted by
       one due to local-vs-UTC parsing. */
    assert.strictEqual(addDays("2026-08-24", 0), "2026-08-24");
    assert.strictEqual(addDays("2026-12-31", 1), "2027-01-01");
});

test("daysBetween is correct either side of a due date and on the day itself", () => {
    assert.strictEqual(daysBetween("2026-07-30", "2026-07-31"), 1);
    assert.strictEqual(daysBetween("2026-08-01", "2026-07-31"), -1);
    assert.strictEqual(daysBetween("2026-07-31", "2026-07-31"), 0);
});

/* ---------- clock 1: evaluation ---------- */

test("evaluation due date is dateIssued + EVALUATION_DAYS", () => {
    const v = vo({ dateIssued: "2026-07-01" });
    const evalClock = deadlinesFor(v, "2026-07-01")[0];
    assert.strictEqual(evalClock.id, "evaluation");
    assert.strictEqual(evalClock.owner, "consultant");
    assert.strictEqual(evalClock.dueDate, addDays("2026-07-01", EVALUATION_DAYS));
});

test("an approved VO shows evaluation satisfied regardless of the date", () => {
    const v = vo({ dateIssued: "2026-01-01", evaluateStatus: "Approved" });
    const evalClock = deadlinesFor(v, "2026-12-31")[0];
    assert.strictEqual(evalClock.satisfied, true);
    assert.strictEqual(evalClock.state, "satisfied");
    assert.strictEqual(evalClock.daysRemaining, null);
});

test("a rejected VO also shows evaluation satisfied — the consultant has evaluated it", () => {
    const v = vo({ evaluateStatus: "Rejected" });
    const evalClock = deadlinesFor(v, v.dateIssued)[0];
    assert.strictEqual(evalClock.satisfied, true);
});

test("an overdue unevaluated VO shows overdue with a negative days remaining", () => {
    const v = vo({ dateIssued: "2026-06-01", evaluateStatus: "Pending" });
    const due = addDays("2026-06-01", EVALUATION_DAYS);
    const todayIso = addDays(due, 5); /* 5 days past due */
    const evalClock = deadlinesFor(v, todayIso)[0];
    assert.strictEqual(evalClock.state, "overdue");
    assert.strictEqual(evalClock.satisfied, false);
    assert.strictEqual(evalClock.daysRemaining, -5);
});

test("evaluation is due-soon at 7 days remaining and open at 8", () => {
    const v = vo({ dateIssued: "2026-06-01", evaluateStatus: "Pending" });
    const due = addDays("2026-06-01", EVALUATION_DAYS);
    const sevenDaysBefore = addDays(due, -7);
    const eightDaysBefore = addDays(due, -8);
    assert.strictEqual(deadlinesFor(v, sevenDaysBefore)[0].state, "due-soon");
    assert.strictEqual(deadlinesFor(v, eightDaysBefore)[0].state, "open");
});

test("evaluation is due-soon (0 days remaining) exactly on the due date", () => {
    const v = vo({ dateIssued: "2026-06-01", evaluateStatus: "Pending" });
    const due = addDays("2026-06-01", EVALUATION_DAYS);
    const clock = deadlinesFor(v, due)[0];
    assert.strictEqual(clock.daysRemaining, 0);
    assert.strictEqual(clock.state, "due-soon");
});

/* ---------- clock 2: request for further information ---------- */

test("information-request due date is dateIssued + INFO_REQUEST_DAYS", () => {
    const v = vo({ dateIssued: "2026-07-01", evaluateStatus: "Pending" });
    const reqClock = deadlinesFor(v, "2026-07-01")[1];
    assert.strictEqual(reqClock.id, "info-request");
    assert.strictEqual(reqClock.owner, "consultant");
    assert.strictEqual(reqClock.dueDate, addDays("2026-07-01", INFO_REQUEST_DAYS));
});

test("the information-request clock is satisfied once a request has been made", () => {
    const v = vo({ dateIssued: "2026-07-01", evaluateStatus: "Pending", infoRequestedAt: "2026-07-05" });
    const reqClock = deadlinesFor(v, "2026-07-06")[1];
    assert.strictEqual(reqClock.satisfied, true);
    assert.strictEqual(reqClock.state, "satisfied");
});

test("the information-request clock becomes moot once evaluation is complete", () => {
    const v = vo({ dateIssued: "2026-01-01", evaluateStatus: "Approved", infoRequestedAt: null });
    const reqClock = deadlinesFor(v, "2026-12-31")[1];
    assert.strictEqual(reqClock.satisfied, true);
    assert.match(reqClock.note, /moot/i);
});

/* ---------- clock 3: response to the request ---------- */

test("the response clock is not-started before any request exists", () => {
    const v = vo({ dateIssued: "2026-07-01", evaluateStatus: "Pending", infoRequestedAt: null });
    const responseClock = deadlinesFor(v, "2026-08-01")[2];
    assert.strictEqual(responseClock.id, "response");
    assert.strictEqual(responseClock.owner, "contractor");
    assert.strictEqual(responseClock.state, "not-started");
    assert.strictEqual(responseClock.dueDate, null);
    assert.strictEqual(responseClock.daysRemaining, null);
});

test("the response clock starts from the request date once a request exists", () => {
    const v = vo({ dateIssued: "2026-07-01", evaluateStatus: "Pending", infoRequestedAt: "2026-07-10" });
    const responseClock = deadlinesFor(v, "2026-07-10")[2];
    assert.strictEqual(responseClock.dueDate, addDays("2026-07-10", INFO_RESPONSE_DAYS));
});

test("a document attached after the request date satisfies the response clock", () => {
    const v = vo({
        dateIssued: "2026-07-01", evaluateStatus: "Pending", infoRequestedAt: "2026-07-10",
        supportingDocs: [{ id: "D1", name: "Extra info.pdf", at: "2026-07-12" }]
    });
    const responseClock = deadlinesFor(v, "2026-07-15")[2];
    assert.strictEqual(responseClock.satisfied, true);
    assert.strictEqual(responseClock.state, "satisfied");
});

test("a document attached before the request date does not satisfy the response clock", () => {
    const v = vo({
        dateIssued: "2026-07-01", evaluateStatus: "Pending", infoRequestedAt: "2026-07-10",
        supportingDocs: [{ id: "D1", name: "Old doc.pdf", at: "2026-07-05" }]
    });
    const responseClock = deadlinesFor(v, "2026-07-15")[2];
    assert.strictEqual(responseClock.satisfied, false);
    assert.notStrictEqual(responseClock.state, "satisfied");
});

test("a document dated exactly on the request date satisfies the response clock", () => {
    const v = vo({
        dateIssued: "2026-07-01", evaluateStatus: "Pending", infoRequestedAt: "2026-07-10",
        revisedDrawing: [{ id: "D1", name: "Rev.pdf", at: "2026-07-10" }]
    });
    const responseClock = deadlinesFor(v, "2026-07-15")[2];
    assert.strictEqual(responseClock.satisfied, true);
});

test("an overdue response clock reports negative days remaining", () => {
    const v = vo({ dateIssued: "2026-06-01", evaluateStatus: "Pending", infoRequestedAt: "2026-06-05" });
    const due = addDays("2026-06-05", INFO_RESPONSE_DAYS);
    const todayIso = addDays(due, 3);
    const responseClock = deadlinesFor(v, todayIso)[2];
    assert.strictEqual(responseClock.state, "overdue");
    assert.strictEqual(responseClock.daysRemaining, -3);
});

/* ---------- missing dateIssued: no crash, no nonsense date ---------- */

test("a VO with no dateIssued does not crash and produces no nonsense due date", () => {
    const v = vo({ dateIssued: "", evaluateStatus: "Pending", infoRequestedAt: null });
    const items = deadlinesFor(v, "2026-07-01");
    assert.strictEqual(items.length, 3);
    assert.strictEqual(items[0].dueDate, null);
    assert.strictEqual(items[0].state, "not-started");
    assert.strictEqual(items[1].dueDate, null);
    assert.strictEqual(items[1].state, "not-started");
    /* response clock is unaffected by a missing dateIssued — it only cares
       about infoRequestedAt, which is also absent here. */
    assert.strictEqual(items[2].state, "not-started");
});

test("a VO with no dateIssued but an evaluation decision still reports satisfied, not a crash", () => {
    const v = vo({ dateIssued: null, evaluateStatus: "Approved" });
    const items = deadlinesFor(v, "2026-07-01");
    assert.strictEqual(items[0].satisfied, true);
    assert.strictEqual(items[0].state, "satisfied");
});

/* ---------- deadlineSummary ---------- */

test("deadlineSummary returns only the given role's deadlines", () => {
    const project = {
        vos: [
            vo({ id: "V1", dateIssued: "2026-06-01", evaluateStatus: "Pending" }),
            vo({ id: "V2", dateIssued: "2026-07-01", evaluateStatus: "Pending", infoRequestedAt: "2026-07-05" })
        ]
    };
    const consultantSummary = deadlineSummary(project, "consultant", "2026-08-01");
    const contractorSummary = deadlineSummary(project, "contractor", "2026-08-01");

    assert.ok(consultantSummary.items.every(i => i.owner === "consultant"));
    assert.ok(contractorSummary.items.every(i => i.owner === "contractor"));
    /* V2's request was made, so the contractor has a response clock. */
    assert.ok(contractorSummary.items.some(i => i.id === "response" && i.voNo === project.vos[1].no));
});

test("deadlineSummary is empty for the client, who owns none of the three clocks", () => {
    const project = { vos: [vo({ dateIssued: "2026-06-01" })] };
    const clientSummary = deadlineSummary(project, "client", "2026-08-01");
    assert.strictEqual(clientSummary.items.length, 0);
    assert.strictEqual(clientSummary.overdue, 0);
    assert.strictEqual(clientSummary.dueSoon, 0);
});

test("deadlineSummary counts overdue and due-soon and sorts overdue first", () => {
    const overdueVo = vo({ id: "V1", dateIssued: "2026-01-01", evaluateStatus: "Pending" });
    const openVo = vo({ id: "V2", dateIssued: "2026-07-30", evaluateStatus: "Pending" });
    const project = { vos: [openVo, overdueVo] };
    const summary = deadlineSummary(project, "consultant", "2026-08-01");

    assert.ok(summary.overdue >= 1);
    assert.strictEqual(summary.items[0].state, "overdue");
});

test("deadlineSummary handles an empty project without crashing", () => {
    const summary = deadlineSummary({ vos: [] }, "consultant", "2026-08-01");
    assert.deepStrictEqual(summary, { overdue: 0, dueSoon: 0, items: [] });
});
