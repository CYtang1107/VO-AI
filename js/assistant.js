/* VO-AI | assistant.js
   A grounded, structured helper — never a chatbot. It answers a fixed set of
   known questions about the variation order currently open, and about the
   contract position, entirely from real computed state (analysis.js,
   elements.js, clauses.js, permissions.js, calc.js). It never fabricates an
   answer and never claims to have read a document's contents; the app
   stores document metadata only.

   Two entry points:
     suggestions(context) -> [{ id, label }]   the clickable questions that
         make sense for the current VO / role / state.
     answer(question, context) -> { intent, title, lines, unmatched? }
         `question` may be an intent id (e.g. from clicking a suggestion) or
         free text (typed input, matched by keyword). A question that
         matches no known intent returns { unmatched: true } and re-offers
         the current suggestions — it never improvises.

   Pure and DOM-free: `context` is a plain object { vo, project, role,
   session }, so this module is fully unit-testable with no browser. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, contractorTotal, assessedTotal } = require("./calc.js");
    var { rateSummary, analyse } = require("./analysis.js");
    var { clausesFor } = require("./clauses.js");
    var { FIELD_OWNER, canEdit, lockReason } = require("./permissions.js");
}

/* -----------------------------------------------------------
   Intent 1 — "Why is this rate flagged?"
----------------------------------------------------------- */

function answerRateFlag(context) {
    const vo = context.vo;
    const bq = (context.project && context.project.bq) || [];
    const summary = rateSummary(vo, bq);
    const flagged = summary.rows.filter(r =>
        r.check.state === "different" || r.check.state === "star");

    const lines = flagged.length === 0
        ? ["All rates on this variation match the contract BQ. No rate is flagged."]
        : flagged.map(r => {
            const row = r.row, check = r.check;
            const claimedRate = rm(Number(row.rate) || 0);
            const desc = row.description || "(no description)";
            if (check.state === "star") {
                return desc + " — claimed " + claimedRate + " per " + (row.unit || "unit") +
                    ". " + check.detail;
            }
            return desc + " — claimed " + claimedRate + " per " + (row.unit || "unit") +
                ", contract BQ rate " + rm(check.contractRate) + " per " + (row.unit || "unit") +
                ". The contract BQ rate governs. " + check.detail;
        });

    return { title: "Why is this rate flagged?", lines: lines };
}

/* -----------------------------------------------------------
   Intent 2 — "What clause applies to this variation?"
----------------------------------------------------------- */

function answerClause(context) {
    const a = analyse(context.vo, context.project);
    if (!a.clause) {
        return {
            title: "What clause applies to this variation?",
            lines: ["The description is too vague to classify, so no governing clause can " +
                "be identified. Add detail about what is changing — e.g. whether this is an " +
                "addition, an omission, a substitution or a design revision."]
        };
    }
    const c = a.clause;
    return {
        title: "What clause applies to this variation?",
        lines: [
            c.form + " " + c.ref + " — " + c.title,
            "Entitlement: " + c.entitlement,
            "Evidence required: " + c.evidence
        ]
    };
}

/* -----------------------------------------------------------
   Intent 3 — "What else might need measuring?"
----------------------------------------------------------- */

function answerElements(context) {
    const a = analyse(context.vo, context.project);
    const els = a.elements;

    if (!els || els.detected.length === 0) {
        return {
            title: "What else might need measuring?",
            lines: ["No building element was detected in this variation's description, so " +
                "there is nothing to prompt for consequential measurement."]
        };
    }

    const lines = ["Detected element(s): " + els.detected.map(e => e.name).join(", ")];
    if (els.related.length === 0) {
        lines.push("No commonly-related elements need confirming for the detected element(s).");
    } else {
        els.related.forEach(r => lines.push(r.element.name + " — " + r.note));
    }

    return { title: "What else might need measuring?", lines: lines };
}

/* -----------------------------------------------------------
   Intent 4 — "What is missing before this can be certified?"
   A checklist computed from THIS variation's real state, not generic
   advice about certification in general.
----------------------------------------------------------- */

function answerCertify(context) {
    const vo = context.vo;
    const bq = (context.project && context.project.bq) || [];
    const lines = [];

    lines.push(vo.submitted
        ? "Submitted to the consultant."
        : "Not submitted — the contractor has not yet submitted this variation to the consultant.");

    lines.push(vo.evaluateStatus === "Approved"
        ? "Consultant assessment: Approved."
        : "Consultant assessment: " + vo.evaluateStatus + " — not yet approved.");

    lines.push(vo.certifiedStatus === "Approved"
        ? "Client certification: Approved."
        : "Client certification: " + (vo.certifiedStatus || "Pending") + " — not yet certified.");

    const summary = rateSummary(vo, bq);
    if (summary.star > 0) {
        lines.push(summary.star + " star rate row(s) are unresolved and must be agreed, " +
            "supported by a quotation or rate build-up, before certification.");
    }
    if (summary.different > 0) {
        lines.push(summary.different + " row(s) still claim a rate different from the " +
            "contract BQ — correct the assessed rate before certification.");
    }

    if ((vo.revisedDrawing || []).length === 0) {
        lines.push("No revised drawing has been attached.");
    }
    if ((vo.supportingDocs || []).length === 0) {
        lines.push("No supporting document has been attached.");
    }

    if (vo.timeImpact === undefined || vo.timeImpact === null || vo.timeImpact === "") {
        lines.push("Time impact has not been set.");
    } else {
        lines.push("Time impact is set at " + vo.timeImpact + " day(s).");
    }

    return { title: "What is missing before this can be certified?", lines: lines };
}

/* -----------------------------------------------------------
   Intent 5 — "What is this variation worth?"
----------------------------------------------------------- */

function answerValue(context) {
    const vo = context.vo;
    const claimed = contractorTotal(vo);
    const assessed = assessedTotal(vo);
    const variance = assessed - claimed;

    const lines = [
        "Contractor claimed: " + rm(claimed),
        "Consultant assessed: " + rm(assessed),
        "Variance: " + rm(Math.abs(variance)) +
            (variance < 0 ? " (reduction)" : variance > 0 ? " (increase)" : "")
    ];

    if (vo.certifiedStatus === "Approved" &&
        vo.finalPrice !== null && vo.finalPrice !== undefined && vo.finalPrice !== "") {
        lines.push("Certified value: " + rm(vo.finalPrice));
    } else {
        lines.push("Not yet certified — no certified value.");
    }

    return { title: "What is this variation worth?", lines: lines };
}

/* -----------------------------------------------------------
   Intent 6 — "What can I edit here?"
   Makes the permission model self-explaining: what the signed-in role
   may edit right now, and for everything else, lockReason()'s answer.
----------------------------------------------------------- */

function answerEdit(context) {
    const vo = context.vo;
    const role = context.role;
    const editable = [];
    const locked = [];

    Object.keys(FIELD_OWNER).forEach(f => {
        if (canEdit(f, vo, role)) editable.push(f);
        else locked.push({ field: f, reason: lockReason(f, vo, role) });
    });

    const lines = [
        editable.length > 0
            ? "You may currently edit: " + editable.join(", ") + "."
            : "You cannot currently edit any field on this variation."
    ];
    locked.forEach(l => lines.push(l.field + " — " + l.reason));

    return { title: "What can I edit here?", lines: lines };
}

/* -----------------------------------------------------------
   Intent 7 — "How do variations get valued?"
   Explanation drawn verbatim from the clause knowledge base's entitlement
   text for this variation's classification — never written prose.
----------------------------------------------------------- */

function answerValuationMethod(context) {
    const a = analyse(context.vo, context.project);
    const list = clausesFor(a.classification.id);

    if (list.length === 0) {
        return {
            title: "How do variations get valued?",
            lines: ["The description is too vague to classify, so no valuation clause could " +
                "be identified. Add detail about what is changing."]
        };
    }

    return {
        title: "How do variations get valued?",
        lines: list.map(c => c.form + " " + c.ref + " — " + c.title + ": " + c.entitlement)
    };
}

/* -----------------------------------------------------------
   Intent registry — order matters: the first regex that matches a typed
   question wins. `id` doubles as the label a clicked suggestion sends in.
----------------------------------------------------------- */

const INTENTS = [
    {
        id: "rate-flag",
        label: "Why is this rate flagged?",
        test: /\bflag(ged)?\b|different rate|star rate|rate.?check/i,
        available: context => (context.vo && (context.vo.measurement || []).length > 0),
        handler: answerRateFlag
    },
    {
        id: "clause",
        label: "What clause applies to this variation?",
        test: /\bclause\b|entitlement|governing clause|applies to this variation/i,
        available: context => Boolean(context.vo),
        handler: answerClause
    },
    {
        id: "elements",
        label: "What else might need measuring?",
        test: /else.*measur|measur.*else|consequential|related element|other element/i,
        available: context => Boolean(context.vo),
        handler: answerElements
    },
    {
        id: "certify",
        label: "What is missing before this can be certified?",
        test: /certif/i,
        available: context => Boolean(context.vo) && context.role !== "contractor",
        handler: answerCertify
    },
    {
        id: "value",
        label: "What is this variation worth?",
        test: /\bworth\b|value of this|how much is|claimed total|assessed total/i,
        available: context => Boolean(context.vo),
        handler: answerValue
    },
    {
        id: "edit",
        label: "What can I edit here?",
        test: /\bedit\b|can i change|permission|allowed to (edit|change)/i,
        available: context => Boolean(context.vo) && Boolean(context.role),
        handler: answerEdit
    },
    {
        id: "valuation-method",
        label: "How do variations get valued?",
        test: /how.*valu|valuation method|how (are|do) variations/i,
        available: context => Boolean(context.vo),
        handler: answerValuationMethod
    }
];

/* -----------------------------------------------------------
   suggestions(context) — only the questions that make sense right now.
----------------------------------------------------------- */

function suggestions(context) {
    if (!context || !context.vo) return [];
    return INTENTS.filter(i => i.available(context))
        .map(i => ({ id: i.id, label: i.label }));
}

/* -----------------------------------------------------------
   answer(question, context) — matched by intent id first (a click sends
   its id/label directly), then by keyword against typed free text. A
   question that matches no known intent is never improvised — it says so
   plainly and re-offers the current suggestions.
----------------------------------------------------------- */

function unmatchedResponse(context) {
    const sugg = suggestions(context);
    const lines = ["I can only answer questions about the current variation order, the " +
        "contract position and the register."];
    if (sugg.length > 0) {
        lines.push("Try one of these instead:");
        sugg.forEach(s => lines.push("• " + s.label));
    }
    return {
        intent: null,
        title: "I can't answer that",
        lines: lines,
        unmatched: true
    };
}

function answer(question, context) {
    const ctx = context || {};
    const q = String(question === null || question === undefined ? "" : question).trim();
    if (!q) return unmatchedResponse(ctx);

    let matched = INTENTS.find(i => i.id === q || i.label === q);
    if (!matched) matched = INTENTS.find(i => i.test.test(q));
    if (!matched) return unmatchedResponse(ctx);
    if (!ctx.vo) return unmatchedResponse(ctx);

    const result = matched.handler(ctx);
    return Object.assign({ intent: matched.id }, result);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { answer, suggestions };
}
