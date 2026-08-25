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
    var { t, joinList } = require("./i18n.js");
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
        ? [t("assistant.rateFlag.allMatch")]
        : flagged.map(r => {
            const row = r.row, check = r.check;
            const claimedRate = rm(Number(row.rate) || 0);
            const desc = row.description || t("assistant.noDescription");
            const unit = row.unit || t("assistant.unit");
            if (check.state === "star") {
                return t("assistant.rateFlag.star", { desc: desc, claimedRate: claimedRate, unit: unit, detail: check.detail });
            }
            return t("assistant.rateFlag.other", {
                desc: desc, claimedRate: claimedRate, unit: unit,
                contractRate: rm(check.contractRate), detail: check.detail
            });
        });

    return { title: t("assistant.rate-flag.label"), lines: lines };
}

/* -----------------------------------------------------------
   Intent 2 — "What clause applies to this variation?"
----------------------------------------------------------- */

function answerClause(context) {
    const a = analyse(context.vo, context.project);
    if (!a.clause) {
        return {
            title: t("assistant.clause.label"),
            lines: [t("assistant.clause.tooVague")]
        };
    }
    const c = a.clause;
    /* c.entitlement / c.evidence are the clause's own English text — see
       js/i18n.js's clause.note for why that is never translated. */
    return {
        title: t("assistant.clause.label"),
        lines: [
            t("assistant.clause.line1", { form: c.form, ref: c.ref, title: c.title }),
            t("assistant.clause.entitlement", { text: c.entitlement }),
            t("assistant.clause.evidence", { text: c.evidence }),
            t("clause.note")
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
            title: t("assistant.elements.label"),
            lines: [t("assistant.elements.none")]
        };
    }

    const lines = [t("assistant.elements.detected",
        { list: els.detected.map(e => t("element." + e.id + ".name")).join(", ") })];
    if (els.related.length === 0) {
        lines.push(t("assistant.elements.noneRelated"));
    } else {
        els.related.forEach(r => lines.push(t("assistant.elements.relatedLine",
            { name: t("element." + r.element.id + ".name"), note: t("element." + r.because + ".note") })));
    }

    return { title: t("assistant.elements.label"), lines: lines };
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
        ? t("assistant.certify.submitted")
        : t("assistant.certify.notSubmitted"));

    lines.push(vo.evaluateStatus === "Approved"
        ? t("assistant.certify.assessmentApproved")
        : t("assistant.certify.assessmentOther", { status: t("status." + vo.evaluateStatus, {}) }));

    lines.push(vo.certifiedStatus === "Approved"
        ? t("assistant.certify.certApproved")
        : t("assistant.certify.certOther", { status: t("status." + (vo.certifiedStatus || "Pending"), {}) }));

    const summary = rateSummary(vo, bq);
    if (summary.star > 0) {
        lines.push(t("assistant.certify.starUnresolved", { n: summary.star }));
    }
    if (summary.different > 0) {
        lines.push(t("assistant.certify.rateDifferent", { n: summary.different }));
    }

    if ((vo.revisedDrawing || []).length === 0) {
        lines.push(t("assistant.certify.noRevisedDrawing"));
    }
    if ((vo.supportingDocs || []).length === 0) {
        lines.push(t("assistant.certify.noSupportingDoc"));
    }

    if (vo.timeImpact === undefined || vo.timeImpact === null || vo.timeImpact === "") {
        lines.push(t("assistant.certify.timeImpactUnset"));
    } else {
        lines.push(t("assistant.certify.timeImpactSet", { n: vo.timeImpact }));
    }

    return { title: t("assistant.certify.label"), lines: lines };
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
        t("assistant.value.claimed", { amount: rm(claimed) }),
        t("assistant.value.assessed", { amount: rm(assessed) }),
        t("assistant.value.variance", {
            amount: rm(Math.abs(variance)),
            word: t(variance < 0 ? "assistant.value.reduction" : variance > 0 ? "assistant.value.increase" : "")
        })
    ];

    if (vo.certifiedStatus === "Approved" &&
        vo.finalPrice !== null && vo.finalPrice !== undefined && vo.finalPrice !== "") {
        lines.push(t("assistant.value.certified", { amount: rm(vo.finalPrice) }));
    } else {
        lines.push(t("assistant.value.notCertified"));
    }

    return { title: t("assistant.value.label"), lines: lines };
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
            ? t("assistant.edit.canEdit", { list: editable.join(", ") })
            : t("assistant.edit.canEditNone")
    ];
    locked.forEach(l => lines.push(t("assistant.edit.lockedLine", { field: l.field, reason: l.reason })));

    return { title: t("assistant.edit.label"), lines: lines };
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
            title: t("assistant.valuation-method.label"),
            lines: [t("assistant.valuationMethod.none")]
        };
    }

    /* c.entitlement is the clause's own English text — see clause.note. */
    return {
        title: t("assistant.valuation-method.label"),
        lines: list.map(c => t("assistant.valuationMethod.line",
            { form: c.form, ref: c.ref, title: c.title, entitlement: c.entitlement }))
            .concat([t("clause.note")])
    };
}

/* -----------------------------------------------------------
   Intent registry — order matters: the first regex that matches a typed
   question wins. `id` doubles as the label a clicked suggestion sends in.
----------------------------------------------------------- */

/* `label` is the English source string, used as a fallback match target
   (see answer() below — a click always sends the id, but typed text
   "What clause applies to this variation?" pasted verbatim should still
   resolve). Display always goes through t("assistant.<id>.label") in
   js/i18n.js so the suggested-question button follows the current
   language. */
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
        .map(i => ({ id: i.id, label: t("assistant." + i.id + ".label") }));
}

/* -----------------------------------------------------------
   answer(question, context) — matched by intent id first (a click sends
   its id/label directly), then by keyword against typed free text. A
   question that matches no known intent is never improvised — it says so
   plainly and re-offers the current suggestions.
----------------------------------------------------------- */

function unmatchedResponse(context) {
    const sugg = suggestions(context);
    const lines = [t("assistant.unmatched.intro")];
    if (sugg.length > 0) {
        lines.push(t("assistant.unmatched.tryInstead"));
        sugg.forEach(s => lines.push("• " + s.label));
    }
    return {
        intent: null,
        title: t("assistant.unmatched.title"),
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
