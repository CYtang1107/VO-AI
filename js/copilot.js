/* VO-AI | copilot.js — the project Copilot: questions about the whole
   project, answered from its own data and the firm's experience.

   Two kinds of answer:
   1. From the project's data, at once and offline (answerFromData):
        overview    where the project stands: VOs by stage, cost, plan
        waiting     what is waiting for the signed-in role (js/notify.js)
        deadlines   contractual clocks overdue or due within 7 days
        claims      VOs the contract agent finds not claimable or short of
                    information (js/claimcheck.js)
        rates       rows priced differently from the contract BQ, and
                    star rates with no BQ item (js/analysis.js)
        cost        forecast final cost and earned value (js/costplan.js)
        experience  what past projects paid for similar work: the firm's
                    past-rates library and the other projects in the
                    register (js/ratehistory.js)
      A question is matched to one of these by its words (English or
      Chinese); every line says where it comes from and links to its VO.
   2. Anything else goes to the general AI mode (the copilot Edge
      Function): Qwen answers from the project's data (projectData: every
      VO with its status and the rule engine's figures, cost, earned value,
      deadlines) and the contract clauses nearest the question. The server
      refuses an answer with an amount that is not in that data, or a
      clause it was not given. Any instant answer can also be re-asked
      there ("Ask the AI instead"). Needs a team account, or the demo's
      guest allowance.
   Never invents a figure: what the data does not hold, it says so. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
    var { rm, prettyDate, contractorTotal, assessedTotal } = require("./calc.js");
    var { rateSummary, checkRate } = require("./analysis.js");
    var { claimCheck } = require("./claimcheck.js");
    var { waitingFor, stepMessage } = require("./notify.js");
    var { deadlinesFor } = require("./deadlines.js");
    var { costOverview, earnedValue, costOverviewVisible } = require("./costplan.js");
    var { suggestPastRate, pastRateSources } = require("./ratehistory.js");
    var { escapeHtml } = require("./ui.js");
}

var COPILOT_INTENTS = [
    { id: "waiting",    re: /waiting for me|waiting|my turn|to do|todo|what should i|待办|等我|该我|处理什么/i },
    { id: "deadlines",  re: /deadline|overdue|due|time.?bar|clock|期限|逾期|到期|截止|时限/i },
    { id: "claims",     re: /claimable|can (?:it |they |we )?(?:be )?claim\b|entitle|索赔|资料不足|不可索赔/i },
    { id: "experience", re: /past|previous|history|experience|similar|other project|benchmark|经验|过去|以往|往年|历史|类似|其他项目/i },
    { id: "rates",      re: /rate|bq|bill|price|star|单价|清单|价格|新单价|不符/i },
    { id: "cost",       re: /cost|budget|eac|evm|earned|forecast|final|overrun|spi|cpi|s.?curve|成本|预算|超支|最终|预计|挣值|曲线/i },
    { id: "overview",   re: /overview|status|summary|how is|how's|progress|state|情况|概况|总结|现状|进度|怎么样/i }
];

function copilotIntent(question) {
    const q = String(question || "").trim();
    if (!q) return null;
    /* a question about one VO is the AI's: the instant answers are project-wide */
    if (/\bVO-?\d{1,4}\b/i.test(q)) return null;
    const hit = COPILOT_INTENTS.find(i => i.re.test(q));
    return hit ? hit.id : null;
}

function voLine(vo, text) { return { vo: vo, text: text }; }

/* The answer for one intent: { intent, title, lines: [{text, vo?}], source } */
function answerFromData(intent, ctx) {
    const p = ctx.project, role = ctx.role, today = ctx.today;
    const vos = (p && p.vos) || [];
    const lines = [];
    if (intent === "overview") {
        const o = costOverview(p);
        const stages = { draft: 0, submitted: 0, approved: 0, certified: 0, rejected: 0 };
        vos.forEach(v => {
            if (v.evaluateStatus === "Rejected") stages.rejected++;
            else if (v.certifiedStatus === "Approved") stages.certified++;
            else if (v.evaluateStatus === "Approved") stages.approved++;
            else if (v.submitted) stages.submitted++;
            else stages.draft++;
        });
        lines.push({ text: t("copilot.ov.vos", { n: vos.length, draft: stages.draft, submitted: stages.submitted,
            approved: stages.approved, certified: stages.certified, rejected: stages.rejected }) });
        /* the cost overview is not the consultant QS's (js/costplan.js) */
        if (costOverviewVisible(role)) {
            lines.push({ text: t("copilot.ov.cost", { sum: rm(o.contractSum), approved: rm(o.approved), pending: rm(o.pending), forecast: rm(o.forecast) }) });
            const e = earnedValue(p, today);
            if (e.spi !== null) lines.push({ text: t(e.spi >= 1 ? "copilot.ov.ahead" : "copilot.ov.behind", { spi: e.spi.toFixed(2), pct: e.pctComplete.toFixed(1) }) });
        }
        const w = waitingFor(p, role);
        lines.push({ text: t("copilot.ov.waiting", { n: w.length, role: t("role." + role + ".label") }) });
    } else if (intent === "waiting") {
        /* the VO's number is its link: not said twice */
        waitingFor(p, role).forEach(x => lines.push(voLine(x.vo,
            stepMessage(x.vo, x.step).replace(new RegExp("^" + x.vo.no + "[\\s:：]*"), ""))));
        if (!lines.length) lines.push({ text: t("copilot.none.waiting") });
    } else if (intent === "deadlines") {
        vos.forEach(v => deadlinesFor(v, today, p).forEach(d => {
            if (d.state !== "overdue" && d.state !== "due-soon") return;
            lines.push(voLine(v, t(d.state === "overdue" ? "copilot.dl.overdue" : "copilot.dl.soon", {
                no: v.no, label: d.label, date: prettyDate(d.dueDate), n: Math.abs(d.daysRemaining),
                owner: t("role." + d.owner + ".label") })));
        }));
        if (!lines.length) lines.push({ text: t("copilot.none.deadlines") });
    } else if (intent === "claims") {
        vos.forEach(v => {
            const c = claimCheck(v, p);
            if (c.verdict === "claimable") return;
            const why = c.checks.filter(x => x.state === "fail" || x.state === "missing").map(x => x.clause + ": " + x.reason);
            lines.push(voLine(v, t("copilot.claim", { no: v.no, verdict: t("claim.verdict." + c.verdict), why: why.join(" ") })));
        });
        if (!lines.length) lines.push({ text: t("copilot.none.claims", { n: vos.length }) });
    } else if (intent === "rates") {
        const bq = p.bq || [];
        vos.forEach(v => {
            const r = rateSummary(v, bq);
            if (!r.different && !r.star) return;
            lines.push(voLine(v, t("copilot.rates", { no: v.no, diff: r.different, star: r.star })));
        });
        if (!lines.length) lines.push({ text: t("copilot.none.rates") });
    } else if (intent === "cost" && !costOverviewVisible(role)) {
        lines.push({ text: t("copilot.cost.notForRole") });
    } else if (intent === "cost") {
        const o = costOverview(p), e = earnedValue(p, today);
        lines.push({ text: t("copilot.cost.forecast", { forecast: rm(o.forecast), change: (o.change >= 0 ? "+" : "−") + rm(Math.abs(o.change)), pct: Math.abs(o.changePct).toFixed(1) }) });
        lines.push({ text: t("copilot.cost.certified", { ev: rm(e.ev), pct: e.pctComplete.toFixed(1) }) });
        if (e.spi !== null) lines.push({ text: t("copilot.cost.spi", { spi: e.spi.toFixed(2) }) });
        if (e.cpi !== null) lines.push({ text: t("copilot.cost.cpi", { cpi: e.cpi.toFixed(2), eac: rm(e.eac), vac: (e.vac >= 0 ? "" : "−") + rm(Math.abs(e.vac)) }) });
        else lines.push({ text: t("copilot.cost.noAc") });
    } else if (intent === "experience") {
        const sources = pastRateSources(ctx.db, p.id);
        const q = String(ctx.question || "");
        const unit = (q.match(/\b(m2|m²|m3|m³|m|no|nr|kg)\b/i) || [])[1] || "";
        const asked = suggestPastRate({ description: q, unit: unit.replace("²", "2").replace("³", "3") }, sources);
        if (asked) {
            lines.push({ text: t("copilot.exp.asked", { rate: rm(asked.rate), low: rm(asked.low), high: rm(asked.high), n: asked.count }) });
            asked.matches.forEach(m => lines.push({ text: t("copilot.exp.source", { project: m.project, year: m.year || "—", desc: m.description, rate: rm(m.rate), unit: m.unit }) }));
        } else {
            /* nothing named in the question: the project's own star rates against experience */
            vos.forEach(v => (v.measurement || []).forEach(row => {
                if (checkRate(row, p.bq || []).state !== "star") return;
                const s = suggestPastRate(row, sources);
                const used = Number(row.assessedRate) || Number(row.rate) || 0;
                lines.push(voLine(v, s
                    ? t("copilot.exp.row", { no: v.no, desc: row.description, used: rm(used), rate: rm(s.rate), low: rm(s.low), high: rm(s.high), n: s.count, unit: row.unit || "" })
                    : t("copilot.exp.rowNone", { no: v.no, desc: row.description })));
            }));
            if (!lines.length) lines.push({ text: t("copilot.none.experience") });
            else lines.unshift({ text: t("copilot.exp.intro") });
        }
    }
    return { intent: intent, title: t("copilot.title." + intent), lines: lines, source: t("copilot.source." + intent) };
}

/* Everything the general AI mode may answer from: the project, its cost
   and earned value, and every VO with its status and the rule engine's
   figures. Amounts are formatted as on screen, so the answer quotes them
   as the reader sees them. */
function projectData(project, todayIso, role) {
    const o = costOverview(project), e = earnedValue(project, todayIso);
    const cut = (s, n) => { const v = String(s || ""); return v.length > n ? v.slice(0, n) + "…" : v; };
    /* keys are written as plain words: the model quotes them, so they read
       as a person would say them */
    const vos = (project.vos || []).slice(0, 60).map(v => {
        const rates = rateSummary(v, project.bq || []);
        const check = claimCheck(v, project);
        const dl = deadlinesFor(v, todayIso, project).filter(d => d.dueDate && !d.satisfied)
            .map(d => ({ "clock": d.label, "due date": d.dueDate, "days left": d.daysRemaining, "whose": d.owner }));
        const out = {
            "VO": v.no, "description": cut(v.description, 300), "date issued": v.dateIssued || null,
            "instruction": [v.typeOfInstruction, v.issuedInstruction ? v.issuedInstruction.no : v.instructionNo].filter(Boolean).join(" "),
            "submitted by the contractor": !!v.submitted,
            "instruction confirmed by the design team": v.instructionStatus || null,
            "consultant QS evaluation": v.evaluateStatus || null,
            "design team certification": v.caCertifiedStatus || null,
            "client certification": v.certifiedStatus || null,
            "amount claimed by the contractor": rm(contractorTotal(v)),
            "amount assessed by the consultant QS": rm(assessedTotal(v)),
            /* the rule engine's own difference, so the AI never subtracts */
            "assessed minus claimed": (assessedTotal(v) - contractorTotal(v) < 0 ? "−" : "") + rm(Math.abs(assessedTotal(v) - contractorTotal(v))),
            "time impact (days)": Number(v.timeImpact) || 0,
            "contract agent verdict": check.verdict,
            "rate check": { "rows at the BQ rate": rates.same, "rows priced differently from the BQ": rates.different, "rows with no BQ item (star rates)": rates.star },
            "measurement": (v.measurement || []).slice(0, 12).map(r => ({
                "item": cut(r.description, 120), "unit": r.unit || "", "quantity": Number(r.qty) || 0,
                "rate claimed": rm(Number(r.rate) || 0),
                "rate assessed": r.assessedRate === "" || r.assessedRate === undefined || r.assessedRate === null ? null : rm(Number(r.assessedRate)),
                "rate check": checkRate(r, project.bq || []).state })),
            "remarks": [v.contractorRemark, v.consultantRemark, v.instructionNote, v.caRemark, v.clientRemark].filter(Boolean).map(x => cut(x, 200)),
            "open deadlines": dl
        };
        if (v.finalPrice !== null && v.finalPrice !== undefined && v.finalPrice !== "") out["final price approved by the client"] = rm(Number(v.finalPrice));
        return out;
    });
    const data = {
        "today": todayIso, "asked by": role,
        "project": { "name": project.name, "client": project.client || null, "contract no": project.contractNo || null,
                     "site": project.site && project.site.address || null, "programme": project.programme || null },
        "variation orders": vos
    };
    /* the project's cost and earned value: not for the consultant QS */
    if (costOverviewVisible(role)) {
        Object.assign(data, {
            "cost": { "contract sum": rm(o.contractSum), "approved variations": rm(o.approved), "pending variations": rm(o.pending),
                  "draft variations (not counted)": rm(o.draft), "cost baseline": rm(o.baseline), "forecast final cost": rm(o.forecast) },
            "earned value": { "planned value (PV)": e.pv === null ? null : rm(e.pv), "earned value (EV)": rm(e.ev),
                          "actual cost (AC)": e.ac === null ? null : rm(e.ac), "SPI": e.spi, "CPI": e.cpi,
                          "estimate at completion (EAC)": e.eac === null ? null : rm(e.eac),
                          "variance at completion (VAC)": e.vac === null ? null : rm(e.vac),
                          "percent complete": Math.round(e.pctComplete * 10) / 10 }
        });
    }
    return data;
}

/* ---------- render ---------- */

function copilotQuestions(role) {
    return ["overview", "waiting", "deadlines", "claims", "rates", "cost", "experience"]
        .filter(id => id !== "cost" || !role || costOverviewVisible(role))
        .map(id => ({ id: id, text: t("copilot.q." + id) }));
}

/* ---------- the chat: the person's question on the right, Copilot's
   answer on the left, newest at the bottom ---------- */

function userBubble(question) {
    return '<div class="chat-msg chat-user"><div class="chat-bubble">' + escapeHtml(question) + "</div></div>";
}

function botBubble(inner, extraClass) {
    return '<div class="chat-msg chat-bot"><span class="chat-avatar" aria-hidden="true">✦</span>' +
        '<div class="chat-bubble' + (extraClass ? " " + extraClass : "") + '">' + inner + "</div></div>";
}

function renderDataAnswer(a, question, opts) {
    return botBubble(
        '<h4 class="copilot-title">' + escapeHtml(a.title) + "</h4>" +
        '<ul class="copilot-lines">' + a.lines.map(l => "<li>" +
            (l.vo ? '<a class="copilot-vo" href="vo.html?id=' + encodeURIComponent(l.vo.id) + '">' + escapeHtml(l.vo.no) + "</a> " : "") +
            escapeHtml(l.text) + "</li>").join("") + "</ul>" +
        '<p class="copilot-source">' + escapeHtml(a.source) + "</p>" +
        (opts && opts.ai ? '<button type="button" class="link-button copilot-reask" data-question="' + escapeHtml(question) + '">' + escapeHtml(t("copilot.reask")) + "</button>" : ""));
}

/* The general AI mode's answer: state {loading} | {error} | {answer, citations} | {answer: null, reason} */
function renderAiAnswer(state, question) {
    if (state.loading) {
        return botBubble('<span class="chat-typing" aria-label="' + escapeHtml(t("copilot.ai.thinking")) + '"><i></i><i></i><i></i></span>' +
            '<p class="copilot-source">' + escapeHtml(t("copilot.ai.thinking")) + "</p>", "chat-ai");
    }
    let body;
    if (state.error) body = "<p>" + escapeHtml(t("ask.failed", { reason: state.error })) + "</p>";
    else if (!state.answer) body = "<p>" + escapeHtml(t("copilot.ai.refused." + (state.reason === "guest-limit" || state.reason === "amount-check" ? state.reason : "format"))) + "</p>";
    else {
        const text = typeof answerHtml === "function" ? answerHtml(state.answer) : "<p>" + escapeHtml(state.answer) + "</p>";
        const sources = (state.citations || []).map(c => '<details class="cite-source"><summary>' + escapeHtml(c.form + " " + t("ask.clause", { no: c.clause_no }) + (c.title ? " — " + c.title : "")) +
            '</summary><p class="rate-detail">' + escapeHtml(c.text) + "</p></details>").join("");
        body = '<div class="ask-answer-text">' + text.replace(/\b(VO-\d{3,})\b/g, '<span class="copilot-vo">$1</span>') + "</div>" +
            (sources ? '<h4 class="ask-sources-title">' + escapeHtml(t("ask.sources")) + "</h4>" + sources : "") +
            '<p class="copilot-source">' + escapeHtml(t("copilot.ai.source")) + "</p>";
    }
    return botBubble('<h4 class="copilot-title">' + escapeHtml(t("copilot.ai.title")) + "</h4>" + body, "chat-ai");
}

/* the conversation so far: history [{question, data?} | {question, ai: state} | {question}], oldest first */
function renderThread(state, opts) {
    const o = opts || {};
    return botBubble("<p>" + escapeHtml(t("copilot.empty")) + "</p>") +
        state.history.map(h => userBubble(h.question) +
            (h.data ? renderDataAnswer(h.data, h.question, { ai: o.ai })
            : h.ai ? renderAiAnswer(h.ai, h.question)
            : botBubble("<p>" + escapeHtml(t("copilot.unknown")) + "</p>"))).join("");
}

function renderCopilot(state, opts) {
    const o = opts || {};
    return '<div class="chat">' +
        '<div class="chat-thread" id="copilotThread" role="log" aria-live="polite">' + renderThread(state, o) + "</div>" +
        '<div class="chat-dock">' +
            '<div class="copilot-suggestions">' + copilotQuestions(o.role).map(q =>
                '<button type="button" class="assistant-suggestion-btn copilot-q-btn" data-intent="' + q.id + '" data-question="' + escapeHtml(q.text) + '">' + escapeHtml(q.text) + "</button>").join("") +
            "</div>" +
            '<div class="chat-compose"><input type="text" id="copilotInput" maxlength="500" autocomplete="off" placeholder="' + escapeHtml(t("copilot.placeholder")) + '">' +
            '<button type="button" class="primary-button" id="copilotAskBtn">' + escapeHtml(t("copilot.ask")) + "</button></div>" +
        "</div></div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { COPILOT_INTENTS, copilotIntent, answerFromData, projectData, copilotQuestions, renderDataAnswer, renderAiAnswer, renderThread, renderCopilot };
}
