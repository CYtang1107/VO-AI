/* VO-AI | claimcheck.js — the contract agent: can this VO be claimed?

   Run on the contractor's VO before it goes to the design team. It walks
   the contract's own conditions for a variation, one check per condition,
   and says for each whether the VO meets it, fails it, or is missing what
   the check needs. The verdict follows from the checks:
     - "notClaimable": a check fails (e.g. the change rectifies the
       contractor's own defective work, which PAM 2018 cl. 11.1 excludes);
     - "needsInfo": nothing fails, but something the contract requires is
       missing (no written instruction number, no measurement, ...);
     - "claimable": every check is met.
   Deterministic, like js/analysis.js: no language model, every reason
   names the clause it rests on and the VO data it looked at. Clause
   numbers are PAM 2018's as printed (checked against the imported
   contract text); a PWD 203 project its own (Rev. 2007: 5.2, 24.2,
   25.1, 27.1); a PWD 203A project cites its clause 24.

   Pure functions; the VO page renders the result (renderClaimCheck). */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t, joinList } = require("./i18n.js");
    var { classifyVariation, rateSummary } = require("./analysis.js");
    var { photoLocations } = require("./sitemap.js");
    var { escapeHtml } = require("./ui.js");
}

/* The standard form a project is let under, from its contract documents'
   names: PWD 203A (with bills of quantities), PWD 203 (drawings and
   specification), else PAM 2018 (the private-sector form, and the demo's). */
function contractForm(project) {
    const names = ((project && project.documents) || []).map(d => d.name || "").join(" ");
    if (/203\s*A\b/i.test(names)) return "PWD 203A";
    if (/\b(PWD|P\.W\.D\.?|JKR)\b|\b203\b/i.test(names)) return "PWD 203";
    return "PAM 2018";
}

/* PAM 2018 cl. 11.1 (last words): a change made to put right the
   contractor's own negligence, omission, default or breach is not a
   variation and is at the contractor's own cost. */
var RECTIFY_WORDS = /\b(rectif\w*|defect\w*|remedial|rework\w*|re-?do|make good|making good|not in accordance|non-?conform\w*|at (?:the )?contractor'?s (?:own )?cost)\b|修复|返工|缺陷|整改|重做|不符合规范|承包商自费/i;

/* Each clause a check cites, per form. */
var CLAIM_CLAUSES = {
    "PAM 2018": { variation: "11.1", instruction: "2.2", particulars: "11.5", valuation: "11.6", timing: "11.3" },
    /* P.W.D. Form 203 (Rev. 2007), checked against its printed text:
       5.2 instructions in writing (an oral one confirmed within 7 days),
       24.2 meaning of variation, 25.1 valuation, 27.1 measurement and
       particulars. It has no clause like PAM's 11.3, so no timing check. */
    "PWD 203": { variation: "24.2", instruction: "5.2", particulars: "27.1", valuation: "25.1", timing: null },
    "PWD 203A": { variation: "24", instruction: "24", particulars: "24", valuation: "24", timing: null }
};

function isEngineerInstruction(type) {
    return /\(EI\)|engineer/i.test(String(type || ""));
}

/* checks: [{ id, clause, state: "ok" | "fail" | "missing" | "info", reason }] */
/* opts.stage "describe": the first check, on the description alone, before
   the VO goes to the design team. Only whether it is a variation (and was
   issued in time) can be judged; the instruction and the particulars come
   later and are shown as what comes next, not as gaps. */
function claimCheck(vo, project, opts) {
    const early = !!(opts && opts.stage === "describe");
    const form = contractForm(project);
    const cl = CLAIM_CLAUSES[form];
    const ref = id => t("claim.clauseRef", { form: form, no: cl[id] });
    const checks = [];
    const text = String((vo && vo.description) || "");

    /* 1. Is the change a variation at all? */
    const classification = classifyVariation(vo || {});
    if (RECTIFY_WORDS.test(text) || RECTIFY_WORDS.test(String(vo.contractorRemark || ""))) {
        checks.push({ id: "variation", clause: ref("variation"), state: "fail", reason: t("claim.variation.rectify") });
    } else if (classification.id === "unclassified") {
        checks.push({ id: "variation", clause: ref("variation"), state: "missing", reason: t("claim.variation.unclear") });
    } else {
        checks.push({ id: "variation", clause: ref("variation"), state: "ok",
                      reason: t("claim.variation.ok", { kind: classification.label }) });
    }

    /* 2. Does it rest on a written instruction? */
    const no = String(vo.instructionNo || (vo.issuedInstruction && vo.issuedInstruction.no) || "").trim();
    if (early) {
        checks.push({ id: "instruction", clause: ref("instruction"), state: "info", reason: t("claim.early.instruction") });
    } else if (!no) {
        checks.push({ id: "instruction", clause: ref("instruction"), state: "missing",
                      reason: t(form === "PAM 2018" ? "claim.instruction.noneAI" : "claim.instruction.noneSO") });
    } else if (form === "PAM 2018" && isEngineerInstruction(vo.typeOfInstruction) && vo.instructionStatus === "Confirmed") {
        /* the design team (the Architect) has confirmed it: cl. 2.2(b) */
        checks.push({ id: "instruction", clause: ref("instruction"), state: "ok",
                      reason: t("claim.instruction.engineerConfirmed", { no: no }) });
    } else if (form === "PAM 2018" && isEngineerInstruction(vo.typeOfInstruction)) {
        checks.push({ id: "instruction", clause: ref("instruction"), state: "missing",
                      reason: t("claim.instruction.engineer", { no: no }) });
    } else {
        checks.push({ id: "instruction", clause: ref("instruction"), state: "ok",
                      reason: t("claim.instruction.ok", { no: no }) });
    }

    /* 3. Issued after practical completion? Only when the project records
       the date (project.practicalCompletion, ISO). */
    if (cl.timing && project && project.practicalCompletion && vo.dateIssued && vo.dateIssued > project.practicalCompletion) {
        checks.push({ id: "timing", clause: ref("timing"), state: "missing",
                      reason: t("claim.timing.afterCpc", { date: project.practicalCompletion }) });
    }

    if (early) {
        checks.push({ id: "particulars", clause: ref("particulars"), state: "info", reason: t("claim.early.particulars") });
        const v = checks.some(c => c.state === "fail") ? "notClaimable" : checks.some(c => c.state === "missing") ? "needsInfo" : "claimable";
        return { form: form, verdict: v, checks: checks, early: true };
    }

    /* 4. Has the contractor given the details and particulars the QS
       needs to measure and value it? */
    const rows = (vo.measurement || []).filter(r => String(r.description || "").trim() && Number(r.qty));
    const evidence = ["revisedDrawing", "designDocs", "supportingDocs"].reduce((n, f) => n + ((vo[f] || []).length), 0);
    const offSite = typeof photoLocations === "function"
        ? photoLocations(project, vo).filter(r => r.verdict === "offSite") : [];
    const gaps = [];
    if (!rows.length) gaps.push(t("claim.gap.measurement"));
    if (!evidence) gaps.push(t("claim.gap.evidence"));
    if (offSite.length) gaps.push(t("claim.gap.offSite", { n: offSite.length }));
    checks.push(gaps.length
        ? { id: "particulars", clause: ref("particulars"), state: "missing",
            reason: t("claim.particulars.missing", { gaps: joinList(gaps) }) }
        : { id: "particulars", clause: ref("particulars"), state: "ok",
            reason: t("claim.particulars.ok", { rows: rows.length, docs: evidence }) });

    /* 5. How it will be valued (information, never a failure). */
    if (rows.length) {
        const r = rateSummary(vo, (project && project.bq) || []);
        const parts = [];
        if (r.same + r.different > 0) parts.push(t("claim.valuation.bq", { n: r.same + r.different }));
        if (r.star > 0) parts.push(t("claim.valuation.star", { n: r.star }));
        if (parts.length) {
            checks.push({ id: "valuation", clause: ref("valuation"), state: "info", reason: joinList(parts) });
        }
    }

    const verdict = checks.some(c => c.state === "fail") ? "notClaimable"
        : checks.some(c => c.state === "missing") ? "needsInfo" : "claimable";
    return { form: form, verdict: verdict, checks: checks };
}

var CLAIM_ICON = { ok: "✓", fail: "✕", missing: "!", info: "i" };
var CLAIM_PILL = { claimable: "approved", needsInfo: "pending", notClaimable: "rejected" };

function renderClaimCheck(result, opts) {
    const o = opts || {};
    /* a VO already approved or closed: the check is a record. Its verdict is
       the one given when it was sent (or claimable, if it was not kept);
       anything found missing since is only noted, not a new verdict. */
    const settled = o.settled;
    const verdict = settled && result.verdict !== "notClaimable"
        ? (o.recorded && o.recorded.verdict === "notClaimable" ? "notClaimable" : "claimable") : result.verdict;
    const state = s => settled && s === "missing" ? "info" : s;
    const summary = settled ? t("claim.summary.settled." + settled) : t((result.early ? "claim.summaryEarly." : "claim.summary.") + verdict, { form: result.form });
    return '<div class="claim-verdict claim-' + verdict + '">' +
            '<span class="status ' + CLAIM_PILL[verdict] + '">' + escapeHtml(t("claim.verdict." + verdict)) + "</span>" +
            '<span class="claim-summary">' + escapeHtml(summary) + "</span>" +
        "</div>" +
        '<ul class="claim-checks">' + result.checks.map(c =>
            '<li class="claim-check claim-' + state(c.state) + '">' +
                '<span class="claim-icon" aria-hidden="true">' + CLAIM_ICON[state(c.state)] + "</span>" +
                "<div><strong>" + escapeHtml(t("claim.check." + c.id)) + "</strong> " +
                '<span class="claim-clause">' + escapeHtml(c.clause) + "</span>" +
                '<p class="rate-detail">' + escapeHtml(c.reason) + "</p></div></li>").join("") +
        "</ul>" +
        (o.recorded ? '<p class="assistant-note">' + escapeHtml(t("claim.recorded", {
            verdict: t("claim.verdict." + o.recorded.verdict), date: o.recorded.at })) + "</p>" : "") +
        '<p class="assistant-note">' + escapeHtml(t("claim.note")) + "</p>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { contractForm, claimCheck, renderClaimCheck, RECTIFY_WORDS, CLAIM_CLAUSES };
}
