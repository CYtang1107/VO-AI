/* VO-AI | askcontract.js — 「问合同」: ask the contract, get cited clauses
   (docs/rag-plan.md, step 3).

   The question goes to the ask-contract Edge Function
   (supabase/functions/ask-contract), which finds the nearest clauses of
   the team's contract by meaning and has Qwen answer from those clauses
   only. This file builds the request and draws the answer.

   AI never calculates money: the amounts the agent may quote are the rule
   engine's own figures (engineFacts below, from js/analysis.js and
   js/calc.js), sent with the question; the server rejects any answer with
   an amount that is not among them.

   Shown only for a team-account session (Cloud.active()); the offline demo
   keeps the structured helper alone. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm } = require("./calc.js");
    var { analyse } = require("./analysis.js");
    var { escapeHtml } = require("./ui.js");
    var { t } = require("./i18n.js");
}

/* The rule engine's figures for one VO, already formatted, with names a
   reader (and the model) can understand without the code. */
function engineFacts(vo, project) {
    const a = analyse(vo, project);
    const facts = {
        vo: [vo.no, vo.description].filter(Boolean).join(" — "),
        classification: a.classification ? a.classification.label : null,
        governing_clause_by_rule_engine: a.clause ? a.clause.form + " " + a.clause.ref + " " + a.clause.title : null,
        contractor_claimed_total: rm(a.contractorTotal),
        consultant_assessed_total: rm(a.assessedTotal),
        assessed_minus_claimed: rm(a.variance),
        rate_check: {
            rows_same_as_bq: a.rates.same,
            rows_different_from_bq: a.rates.different,
            star_rates_new_rates_not_in_bq: a.rates.star,
            rows_not_checked: a.rates.unchecked,
            rows_without_rate: a.rates.norate
        },
        submitted_to_consultant: !!vo.submitted,
        consultant_status: vo.evaluateStatus || null,
        client_certification: vo.certifiedStatus || null,
        findings: a.findings
    };
    if (vo.finalPrice !== "" && vo.finalPrice !== null && vo.finalPrice !== undefined && !isNaN(Number(vo.finalPrice))) {
        facts.client_final_price = rm(vo.finalPrice);
    }
    return facts;
}

/* The demo project's id: 「评审一键体验」 lets anyone ask its contract
   without an account (the server limits how often, migration 0004). */
var GUEST_PROJECT = "PRJ-CADANGAN";

/* A guest question: the demo (no sign-in) on the demo project, with a
   Supabase project configured for the site. */
function askAsGuest(projectId) {
    return typeof Cloud !== "undefined" && Cloud.enabled() && !Cloud.active() && projectId === GUEST_PROJECT;
}

function askContractAvailable(projectId) {
    return (typeof Cloud !== "undefined" && Cloud.active()) || askAsGuest(projectId);
}

/* The other AI features (Copilot, the photo check, reading a BQ) work
   from what the page sends, so the demo has them on every project. */
function aiAsGuest() {
    return typeof Cloud !== "undefined" && Cloud.enabled() && !Cloud.active();
}
/* The contracts this demo visitor imported themselves (js/contractimport.js
   keeps the sandbox id): their questions search them too. */
function guestSandboxId() {
    try { const id = localStorage.getItem("voai.guestKb.v1"); return /^GUEST-[a-f0-9]{16,40}$/.test(id || "") ? id : null; }
    catch (e) { return null; }
}
function aiAvailable() {
    return typeof Cloud !== "undefined" && (Cloud.active() || aiAsGuest());
}

/* Three suggested questions per agent. */
function contractQuestions(role) {
    const r = ["contractor", "administrator", "consultant", "client"].includes(role) ? role : "consultant";
    return [1, 2, 3].map(n => t("ask.q." + r + "." + n));
}

/* The answer text with its 「引用」 labels drawn as chips. */
function answerHtml(text) {
    return escapeHtml(text)
        .replace(/「引用[：:][^」]*」|\[Ref:[^\]]*\]/g, m => '<span class="cite-chip">' + m + "</span>")
        .split(/\n+/).filter(line => line.trim())
        .map(line => "<p>" + line.replace(/^\s*[-*•]\s*/, "• ") + "</p>").join("");
}

function citationLine(c) {
    const label = /^Article /.test(c.clause_no) ? c.clause_no : t("ask.clause", { no: c.clause_no });
    return c.form + " " + label + (c.title ? " — " + c.title : "");
}

/* state: null (nothing asked), {loading}, {error}, or the function's reply. */
function renderContractAnswer(state) {
    if (!state) return '<div class="empty-state">' + escapeHtml(t("ask.empty")) + "</div>";
    if (state.loading) {
        return '<div class="empty-state ask-loading">' + escapeHtml(t("ask.thinking")) + "</div>";
    }
    if (state.error) {
        return '<div class="assistant-unmatched"><p class="assistant-answer-title">' + escapeHtml(t("ask.failedTitle")) +
            '</p><div class="finding"><span>' + escapeHtml(t("ask.failed", { reason: state.error })) + "</span></div></div>";
    }
    if (!state.answer) {
        const key = state.reason === "guest-limit" ? "ask.guestLimit"
            : state.reason === "amount-check" ? "ask.refused.amount"
            : state.reason === "no-citation" ? "ask.refused.citation" : "ask.noClause";
        return '<div class="assistant-unmatched"><p class="assistant-answer-title">' + escapeHtml(t("ask.noAnswerTitle")) +
            '</p><div class="finding"><span>' + escapeHtml(t(key)) + "</span></div></div>";
    }
    const sources = (state.citations || []).map(c =>
        '<details class="cite-source"><summary>' + escapeHtml(citationLine(c)) +
        ' <span class="cite-sim">' + escapeHtml(t("ask.similarity", { pct: Math.round(c.similarity * 100) })) + "</span></summary>" +
        '<p class="rate-detail">' + escapeHtml(c.text) + "</p></details>").join("");
    return '<div class="ask-answer">' +
        (state.question ? '<p class="assistant-answer-title">' + escapeHtml(state.question) + "</p>" : "") +
        '<div class="ask-answer-text">' + answerHtml(state.answer) + "</div>" +
        '<h4 class="ask-sources-title">' + escapeHtml(t("ask.sources")) + "</h4>" + sources +
        '<p class="assistant-note ask-ocr-note">' + escapeHtml(t("ask.ocrNote")) + "</p>" +
        "</div>";
}

function renderContractPane(role, state, guest) {
    const r = ["contractor", "administrator", "consultant", "client"].includes(role) ? role : "consultant";
    return '' +
        '<p class="ask-agent">' + escapeHtml(t("ask.agent." + r)) + "</p>" +
        '<p class="assistant-note">' + escapeHtml(t("ask.note")) + "</p>" +
        (guest ? '<p class="assistant-note ask-guest-note">' + escapeHtml(t("ask.guestNote")) + "</p>" : "") +
        '<div class="assistant-suggestions">' +
        contractQuestions(r).map(q =>
            '<button type="button" class="assistant-suggestion-btn contract-question-btn" data-question="' +
            escapeHtml(q) + '">' + escapeHtml(q) + "</button>").join("") +
        "</div>" +
        '<div class="assistant-ask-row">' +
        '<input type="text" id="contractAskInput" maxlength="500" placeholder="' + escapeHtml(t("ask.placeholder")) + '">' +
        '<button type="button" class="secondary-button" id="contractAskBtn">' + escapeHtml(t("ask.button")) + "</button>" +
        "</div>" +
        '<div id="contractAnswer">' + renderContractAnswer(state) + "</div>";
}

/* Sends one question; resolves to the state renderContractAnswer draws. */
async function askContract(project, vo, question, role) {
    const q = String(question || "").trim();
    if (!q) return null;
    try {
        const body = {
            project_id: project.id, vo_id: vo ? vo.id : null, question: q,
            engine_facts: vo ? engineFacts(vo, project) : {}
        };
        /* the demo with no account: the role picked in the demo frames the answer */
        if (askAsGuest(project.id)) { body.guest = true; body.role = role; const sb = guestSandboxId(); if (sb) body.sandbox = sb; }
        const reply = await Cloud.ask(body);
        return Object.assign({ question: q }, reply);
    } catch (e) {
        return { question: q, error: e.message || String(e) };
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { engineFacts, askContractAvailable, askAsGuest, aiAsGuest, aiAvailable, guestSandboxId, contractQuestions, answerHtml, renderContractAnswer, renderContractPane, askContract };
}
