/* VO-AI | agents.js — 「问合同」: a question answered from the clauses the
   project's knowledge base really holds (docs/rag-plan.md, step 3).

   The browser's half of the ask-contract Edge Function:
     engineFacts(vo, project)   everything the answer is allowed to state
                                as a figure, computed by the rule engine
                                (js/analysis.js, js/calc.js) — never by the
                                model, which is forbidden to do arithmetic.
     askContract(context)       the call itself, through Cloud.ask.
     renderContractPanel()      the tab's markup.
     renderContractAnswer(r)    the answer with its 「引用」 chips, or the
                                plain reason there is no answer.

   The tab exists only when the site is signed in to a Supabase project
   (js/cloud.js). The offline demo never shows it and never calls out.

   Pure and DOM-free apart from the strings it returns, so the facts and
   the rendering are unit-tested in test/agents.test.js. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, contractorTotal, assessedTotal, lineTotal } = require("./calc.js");
    var { analyse } = require("./analysis.js");
    var { escapeHtml } = require("./ui.js");
    var { t } = require("./i18n.js");
}

/* -----------------------------------------------------------
   engine_facts — the rule engine's own output for this VO.

   Rule 1 of the plan: the AI never calculates money. The Edge Function
   rejects an answer containing any figure that is not here (or in a
   quoted clause), so this object must carry every number a correct
   answer could need, and nothing the engine did not compute itself.
----------------------------------------------------------- */

function factRow(entry) {
    const row = entry.row, check = entry.check;
    const out = {
        description: row.description || "",
        unit: row.unit || "",
        claimedQty: Number(row.qty) || 0,
        claimedRate: Number(row.rate) || 0,
        claimedAmount: lineTotal(row.qty, row.rate),
        rateCheck: check.state
    };
    if (typeof check.contractRate === "number") out.contractBqRate = check.contractRate;
    if (row.assessedQty !== undefined && row.assessedQty !== "") out.assessedQty = Number(row.assessedQty) || 0;
    if (row.assessedRate !== undefined && row.assessedRate !== "") out.assessedRate = Number(row.assessedRate) || 0;
    return out;
}

function engineFacts(vo, project) {
    if (!vo) return null;
    const a = analyse(vo, project);
    const claimed = contractorTotal(vo);
    const assessed = assessedTotal(vo);
    const facts = {
        source: "VO-AI rule engine (js/analysis.js, js/calc.js) — not computed by the model",
        currency: "MYR",
        vo: {
            no: vo.no || vo.id,
            description: vo.description || "",
            typeOfInstruction: vo.typeOfInstruction || "",
            dateIssued: vo.dateIssued || null,
            submitted: !!vo.submitted,
            evaluateStatus: vo.evaluateStatus || "",
            certifiedStatus: vo.certifiedStatus || "",
            timeImpactDays: Number(vo.timeImpact) || 0
        },
        classification: a.classification ? a.classification.label : null,
        affectedWork: (a.classification && a.classification.affectedWork) || null,
        standardFormClause: a.clause
            ? { form: a.clause.form, ref: a.clause.ref, title: a.clause.title }
            : null,
        totals: {
            claimedTotal: claimed,
            assessedTotal: assessed,
            difference: a.variance
        },
        rateChecks: {
            same: a.rates.same, different: a.rates.different, star: a.rates.star,
            unchecked: a.rates.unchecked, noRate: a.rates.norate
        },
        measurement: a.rates.rows.map(factRow),
        findings: a.findings
    };
    if (vo.finalPrice !== undefined && vo.finalPrice !== "") {
        facts.totals.certifiedFinalPrice = Number(vo.finalPrice) || 0;
    }
    return facts;
}

/* -----------------------------------------------------------
   The call.  Returns what the Edge Function returned:
     { answer, citations }                        an answer to show
     { answer: null, reason, citations }          no answer, said plainly
     { error }                                    could not ask at all
----------------------------------------------------------- */

async function askContract(context) {
    const { question, vo, project, role } = context || {};
    try {
        return await Cloud.ask({
            project_id: (project && project.id) || null,
            vo_id: (vo && vo.id) || null,
            role: role || "consultant",
            question: String(question || "").trim(),
            engine_facts: engineFacts(vo, project)
        });
    } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
    }
}

/* -----------------------------------------------------------
   Rendering.  A citation is a <details>: the chip is its summary, the
   clause's retrieved text its body, so reading the source needs no
   script and works on a phone.
----------------------------------------------------------- */

var CONTRACT_QUESTIONS = ["ask.contract.q1", "ask.contract.q2", "ask.contract.q3"];

function renderContractCitations(citations) {
    if (!citations || citations.length === 0) return "";
    return '<p class="assistant-answer-title">' + escapeHtml(t("ask.contract.citations")) + "</p>" +
        citations.map(c => {
            const label = (c.form ? c.form + " " : "") +
                (/^Article/i.test(c.clause_no) ? c.clause_no : t("ask.contract.clause", { no: c.clause_no })) +
                (c.title ? " — " + c.title : "");
            const match = typeof c.similarity === "number"
                ? ' <span class="citation-match">' + escapeHtml(t("ask.contract.match", { pct: Math.round(c.similarity * 100) })) + "</span>"
                : "";
            return '<details class="citation"><summary>' + escapeHtml(label) + match + "</summary>" +
                "<p>" + escapeHtml(c.text || "") + "</p></details>";
        }).join("");
}

function renderContractAnswer(result) {
    if (!result) {
        return '<div class="empty-state">' + escapeHtml(t("ask.contract.empty")) + "</div>";
    }
    if (result.pending) {
        return '<div class="empty-state">' + escapeHtml(t("ask.contract.thinking")) + "</div>";
    }
    if (result.error) {
        return '<div class="assistant-unmatched"><p class="assistant-answer-title">' +
            escapeHtml(t("ask.contract.errorTitle")) + "</p>" +
            '<div class="finding"><span>' + escapeHtml(result.error) + "</span></div></div>";
    }
    if (!result.answer) {
        const key = result.reason === "no-clause" ? "ask.contract.noClause" : "ask.contract.rejected";
        return '<div class="assistant-unmatched"><p class="assistant-answer-title">' +
            escapeHtml(t("ask.contract.noAnswerTitle")) + "</p>" +
            '<div class="finding"><span>' + escapeHtml(t(key)) + "</span></div>" +
            renderContractCitations(result.citations) + "</div>";
    }
    const paragraphs = String(result.answer).split(/\n+/).filter(p => p.trim())
        .map(p => '<div class="finding"><span>' + escapeHtml(p.trim()) + "</span></div>").join("");
    return "<div>" + paragraphs + renderContractCitations(result.citations) + "</div>";
}

function renderContractPanel() {
    return "" +
        '<p class="assistant-note">' + escapeHtml(t("ask.contract.note")) + "</p>" +
        '<div class="assistant-suggestions" id="contractSuggestions">' +
        CONTRACT_QUESTIONS.map(key =>
            '<button type="button" class="assistant-suggestion-btn" data-question="' +
            escapeHtml(t(key)) + '">' + escapeHtml(t(key)) + "</button>").join("") +
        "</div>" +
        '<div class="assistant-ask-row">' +
        '<input type="text" id="contractInput" placeholder="' + escapeHtml(t("ask.contract.placeholder")) + '">' +
        '<button type="button" class="secondary-button" id="contractAskBtn">' + escapeHtml(t("assistant.ask")) + "</button>" +
        "</div>" +
        '<div id="contractAnswer">' + renderContractAnswer(null) + "</div>";
}

/* The two tabs over the ask card: the structured helper that has always
   been there, and the contract knowledge base. */
function renderAskTabs(active) {
    return '<div class="ask-tabs" id="askTabs">' +
        ['local', 'contract'].map(id =>
            '<button type="button" class="ask-tab' + (id === active ? " active" : "") +
            '" data-tab="' + id + '">' + escapeHtml(t("ask.tab." + id)) + "</button>").join("") +
        "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        engineFacts, askContract, renderContractPanel, renderContractAnswer,
        renderContractCitations, renderAskTabs, CONTRACT_QUESTIONS
    };
}
