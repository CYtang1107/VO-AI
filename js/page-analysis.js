/* VO-AI | page-analysis.js — "AI Analysis": a what-if analyser.
   The user describes a proposed change against a priced BQ item; every
   number shown is computed by js/analysis.js from that input. Nothing
   here is hardcoded — no confidence score, no fixed clause. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { renderContractBlock } = require("./contractread.js");
    var { rm } = require("./calc.js");
    var { analyse, classificationBasis, suggestBqForChange } = require("./analysis.js");
    var { answer, suggestions } = require("./assistant.js");
    var { escapeHtml, fold } = require("./ui.js");
    var { t } = require("./i18n.js");
    var { suggestPastRate } = require("./ratehistory.js");
}

/* Raw English data VALUEs — never renamed, see optionDisplayText() in
   js/page-vo.js for the same pattern applied to typeOfInstruction. */
const INSTRUCTION_TYPES = ["Architect's Instruction (AI)", "Engineer's instruction (EI)"];

function instructionTypeLabel(value) {
    const key = "instructionType." + value;
    const label = t(key, {});
    return label === key ? value : label;
}

/* Same format as bqOptions in js/page-vo.js: code · description · rate/unit. */
function bqOptions(project, selectedId) {
    const opts = ['<option value="">' + escapeHtml(t("analysis.field.originalItemSelect")) + '</option>'];
    (project.bq || []).forEach(b => {
        opts.push('<option value="' + escapeHtml(b.id) + '"' +
            (b.id === selectedId ? " selected" : "") + ">" +
            escapeHtml(b.code + " · " + b.description + " · " + rm(b.rate) + "/" + b.unit) +
            "</option>");
    });
    return opts.join("");
}

/* The line under the BQ picker saying what was matched automatically
   (and from which words), or that nothing matched yet. */
function autoMatchHint(suggestion) {
    if (!suggestion) return t("analysis.autoMatchNone");
    const words = suggestion.matched.join(t("common.listSep"));
    return suggestion.weak
        ? t("analysis.autoMatchWeak", { code: suggestion.item.code, words: words })
        : t("analysis.autoMatch", { code: suggestion.item.code, words: words });
}

/* If the project has no priced BQ items, there is nothing to substitute
   against — show an explanatory empty state, not an empty dropdown. */
function renderOriginalItemField(project, selectedId) {
    const bq = project.bq || [];
    if (bq.length === 0) {
        return '<div class="field"><label>' + escapeHtml(t("analysis.field.originalItem")) + '</label>' +
               '<div class="empty-state">' + escapeHtml(t("analysis.field.originalItemEmpty")) + '</div></div>';
    }
    return '<div class="field"><label>' + escapeHtml(t("analysis.field.originalItem")) + '</label>' +
           '<select id="vaOriginalItem">' + bqOptions(project, selectedId) + "</select>" +
           '<p class="hint auto-match-hint" id="vaMatchHint" hidden></p></div>';
}

function renderForm(project) {
    return '' +
        '<div class="field"><label>' + escapeHtml(t("analysis.field.description")) + '</label>' +
        '<textarea id="vaDescription" placeholder="' + escapeHtml(t("analysis.field.descriptionPlaceholder")) + '"></textarea></div>' +

        '<div class="field"><label>' + escapeHtml(t("analysis.field.type")) + '</label>' +
        '<select id="vaType">' +
        INSTRUCTION_TYPES.map(ty => '<option value="' + escapeHtml(ty) + '">' + escapeHtml(instructionTypeLabel(ty)) +
            "</option>").join("") +
        "</select></div>" +

        renderOriginalItemField(project, "") +

        '<div class="field"><label>' + escapeHtml(t("analysis.field.revisedDesc")) + '</label>' +
        '<input type="text" id="vaRevisedDesc" placeholder="' + escapeHtml(t("analysis.field.revisedDescPlaceholder")) + '"></div>' +

        '<div class="field"><label>' + escapeHtml(t("analysis.field.qty")) + '</label>' +
        '<input type="number" id="vaQty" min="0" step="any"></div>' +

        '<div class="field"><label>' + escapeHtml(t("analysis.field.rate")) + '</label>' +
        '<input type="number" id="vaRate" min="0" step="any">' +
        '<div id="vaRateSuggest" class="rate-suggest" hidden></div></div>' +

        '<button type="button" class="primary-button" id="analyseBtn" ' +
        'style="margin-top:4px">' + escapeHtml(t("analysis.runBtn")) + '</button>';
}

/* What past projects paid for the revised item (js/ratehistory.js): the
   median rate, its range and every source, so the figure can be checked
   and argued. With nothing comparable, the rate is a new (star) rate and
   must rest on a quotation: no figure is offered at all. `filled`: the
   suggestion was put into the rate field. */
function renderRateSuggestion(suggestion, filled) {
    if (!suggestion) {
        return '<p class="rate-suggest-none">' + escapeHtml(t("analysis.pastRate.none")) + "</p>";
    }
    const unit = suggestion.matches[0].unit;
    const head = t("analysis.pastRate.suggest", {
        rate: rm(suggestion.rate), unit: unit, n: suggestion.count,
        low: rm(suggestion.low), high: rm(suggestion.high)
    });
    const list = suggestion.matches.map(m =>
        "<li>" + escapeHtml(m.project) + (m.year ? " (" + m.year + ")" : "") +
        (m.code ? " · " + escapeHtml(m.code) : "") + " — " + escapeHtml(m.description) +
        " <strong>" + rm(m.rate) + "/" + escapeHtml(m.unit) + "</strong>" +
        ' <span class="past-basis">' + escapeHtml(t("vo.past.basis." + m.basis)) +
        (m.sample ? " · " + escapeHtml(t("vo.past.sample")) : "") + "</span></li>").join("");
    return '<p class="rate-suggest-head"><span class="rate-flag past">' + escapeHtml(t("vo.past.title")) + "</span> " +
        escapeHtml(head) + "</p>" +
        (filled ? '<p class="rate-suggest-filled">' + escapeHtml(t("analysis.pastRate.filled")) + "</p>"
                : '<button type="button" class="secondary-button rate-suggest-use">' +
                  escapeHtml(t("analysis.pastRate.use", { rate: rm(suggestion.rate) })) + "</button>") +
        fold("past-rate-sources", escapeHtml(t("analysis.pastRate.sources", { n: suggestion.count })),
             '<ul class="past-rates-list">' + list + "</ul>") +
        '<p class="past-rates-note">' + escapeHtml(t("analysis.pastRate.note")) + "</p>";
}

function renderAssessmentEmpty() {
    return '<div class="empty-state">' + escapeHtml(t("analysis.empty")) + '</div>';
}

/* A substitution is two measurement rows: the contract-rate omission of
   the original BQ item, and the addition of the revised item at the
   revised rate. This is the ONLY place the synthetic VO is built — it is
   never saved unless the contractor chooses to create it. */
function buildSyntheticVO(bqItem, input) {
    const qty = Number(input.qty) || 0;
    const revisedRate = Number(input.revisedRate) || 0;
    return {
        description: input.description || "",
        typeOfInstruction: input.typeOfInstruction,
        measurement: [
            {
                bqItemId: bqItem.id,
                description: "Omit " + bqItem.description,
                unit: bqItem.unit,
                qty: -qty,
                rate: bqItem.rate
            },
            {
                bqItemId: null,
                description: input.revisedDescription || "",
                unit: bqItem.unit,
                qty: qty,
                rate: revisedRate
            }
        ]
    };
}

/* Original / revised / additional cost, and the percentage change against
   the original (contract) rate — only when that rate is non-zero. */
function computeCosts(bqItem, qty, revisedRate) {
    const q = Number(qty) || 0;
    const originalRate = Number(bqItem.rate) || 0;
    const rRate = Number(revisedRate) || 0;
    const originalCost = q * originalRate;
    const revisedCost = q * rRate;
    return {
        originalCost: originalCost,
        revisedCost: revisedCost,
        additionalCost: revisedCost - originalCost,
        pct: originalRate === 0 ? null : ((rRate - originalRate) / originalRate) * 100
    };
}

function renderClassificationBlock(a, basis) {
    const signalsHtml = basis.signals.length === 0 ? "" :
        basis.signals.map(s => '<div class="finding"><span>' + escapeHtml(s) + "</span></div>")
            .join("");
    return '<div class="result-group">' +
        '<h4 class="result-group-title">' + escapeHtml(t("analysis.group.classification")) + '</h4>' +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.classification")) + '</span>' +
        '<span class="result-value">' + escapeHtml(a.classification.label) + "</span></div>" +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.affectedWork")) + '</span>' +
        '<span class="result-value">' + escapeHtml(a.classification.affectedWork) + "</span></div>" +
        '<p class="rate-detail" style="margin-top:10px"><strong>' + escapeHtml(t("analysis.basisTitle")) +
        "</strong></p>" +
        signalsHtml +
        '<p class="rate-detail">' + escapeHtml(basis.summary) + "</p>" +
        "</div>";
}

/* A checklist, not a conclusion: the detected element(s) followed by
   the other elements that commonly need re-measurement alongside them,
   each with the reason. The system never asserts that a related
   element actually changed — only that a QS should confirm it. */
function renderElementsBlock(a) {
    const els = a.elements;
    if (!els || els.detected.length === 0) return "";

    const detectedHtml = els.detected.map(el =>
        '<span class="element-tag">' + escapeHtml(t("element." + el.id + ".name")) + "</span>").join(" ");

    const relatedHtml = els.related.length === 0
        ? '<p class="rate-detail">' + escapeHtml(t("analysis.elements.noneRelated")) + "</p>"
        : els.related.map(r =>
            '<div class="finding element-check"><label><input type="checkbox"> ' +
            '<span class="element-tag element-tag-related">' + escapeHtml(t("element." + r.element.id + ".name")) +
            "</span> — " + escapeHtml(t("element." + r.because + ".note")) + "</label></div>").join("");

    return '<div class="result-group">' +
        '<h4 class="result-group-title">' + escapeHtml(t("analysis.group.elements")) + '</h4>' +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.detectedElements")) + '</span>' +
        '<span class="result-value">' + detectedHtml + "</span></div>" +
        '<p class="rate-detail" style="margin-top:10px"><strong>' + escapeHtml(t("vo.result.confirmRelated")) +
        "</strong></p>" +
        relatedHtml +
        "</div>";
}

function renderClauseBlock(a) {
    /* This project's own contract first, when there is one; the bundled
       standard-form clause below it as the reference. */
    const contract = a.contract
        ? '<div class="result-group">' +
              '<h4 class="result-group-title">' + escapeHtml(t("contract.title")) + "</h4>" +
              renderContractBlock(a.contract, { fold: true }) + "</div>"
        : "";
    return contract + renderStandardClauseBlock(a, a.contract && a.contract.state === "read");
}

function renderStandardClauseBlock(a, isReference) {
    const title = escapeHtml(t(isReference ? "contract.standardForm" : "analysis.group.contractualBasis"));
    if (!a.clause) {
        return '<div class="result-group">' +
               '<h4 class="result-group-title">' + title + '</h4>' +
               '<p class="rate-detail">' + escapeHtml(t("analysis.clause.none")) + "</p></div>";
    }
    /* a.clause.title/entitlement/evidence are the clause's own English
       text — see js/i18n.js's clause.note for why that is never
       translated; the note itself is. */
    return '<div class="result-group">' +
        '<h4 class="result-group-title">' + title + '</h4>' +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("vo.result.governingClause")) + '</span>' +
        '<span class="result-value">' + escapeHtml(a.clause.form + " " + a.clause.ref) +
        "</span></div>" +
        fold("std-clause", escapeHtml(t("clause.showWording", { title: a.clause.title })),
            '<p class="rate-detail"><strong>' + escapeHtml(a.clause.title) + "</strong><br>" +
            escapeHtml(a.clause.entitlement) + "</p>" +
            '<p class="rate-detail"><strong>' + escapeHtml(t("clause.evidenceRequired")) + '</strong> ' +
            escapeHtml(a.clause.evidence) + "</p>" +
            '<p class="rate-detail clause-note">' + escapeHtml(t("clause.note")) + "</p>") + "</div>";
}

/* Cost impact: the additional cost is what a QS looks for first, so it
   gets the .cost-highlight treatment; the rest are plain result rows. */
function renderCostBlock(costs) {
    let html = '<div class="result-group">' +
        '<h4 class="result-group-title">' + escapeHtml(t("analysis.group.cost")) + '</h4>' +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("analysis.cost.original")) + '</span>' +
        '<span class="result-value">' + rm(costs.originalCost) + "</span></div>" +
        '<div class="result-row"><span class="result-label">' + escapeHtml(t("analysis.cost.revised")) + '</span>' +
        '<span class="result-value">' + rm(costs.revisedCost) + "</span></div>" +
        '<div class="cost-highlight"><span class="result-label">' + escapeHtml(t("analysis.cost.additional")) + '</span>' +
        '<span class="result-value">' + rm(costs.additionalCost) + "</span></div>";
    if (costs.pct !== null) {
        html += '<div class="result-row"><span class="result-label">' + escapeHtml(t("analysis.cost.changeVsOriginal")) + '</span>' +
            '<span class="result-value">' + (costs.pct >= 0 ? "+" : "") + costs.pct.toFixed(1) +
            "%</span></div>";
    }
    return html + "</div>";
}

/* A row with no bqItemId that the matcher found a candidate for gets an
   extra line naming the match and its basis — visually flagged with the
   same .auto-match treatment as the VO measurement grid, so a user
   pasting in a change sees the system find the comparable rate on its
   own, without mistaking it for a confirmed link. */
function renderRateRows(a) {
    if (a.rates.rows.length === 0) return '<div class="empty-state">' + escapeHtml(t("analysis.noMeasurementRows")) + '</div>';
    return a.rates.rows.map(r => {
        const autoNote = r.check.autoMatched
            ? '<div class="rate-detail auto-match-note">' +
              '<span class="rate-flag auto-match">' + escapeHtml(t("vo.measurement.suggestedMatch")) + '</span> ' +
              '<span class="item-code">' + escapeHtml(r.check.matchedItem.code) + "</span> · " +
              escapeHtml(r.check.matchedItem.description) +
              " — " + escapeHtml(r.check.matchBasis) + "</div>"
            : "";
        return '<div class="finding"><span class="rate-flag ' + r.check.state + '">' +
            escapeHtml(r.check.label) + "</span> " +
            "<span>" + escapeHtml(r.row.description || "") + " — " +
            escapeHtml(r.check.detail) + "</span>" + autoNote + "</div>";
    }).join("");
}

function renderFindings(a) {
    return a.findings.length === 0
        ? '<div class="empty-state">' + escapeHtml(t("analysis.nothingToFlag")) + '</div>'
        : a.findings.map(f => '<div class="finding"><span>' + escapeHtml(f) +
                              "</span></div>").join("");
}

/* The full right-column render, grouped into the four blocks a QS reads
   in order: classification, contractual basis, cost impact, rate
   cross-check. No confidence score, no invented number — everything
   traces to `a` (from analyse()), `basis` (from classificationBasis())
   or `costs` (computed from the raw inputs). */
function renderAssessmentResult(a, basis, costs, showCreateButton) {
    return '' +
        renderClassificationBlock(a, basis) +
        renderElementsBlock(a) +
        renderClauseBlock(a) +
        renderCostBlock(costs) +
        '<div class="result-group">' +
        '<h4 class="result-group-title">' + escapeHtml(t("analysis.group.rateCheck")) + '</h4>' +
        renderRateRows(a) +
        "</div>" +
        '<div class="result-group">' +
        '<h4 class="result-group-title">' + escapeHtml(t("analysis.group.findings")) + '</h4>' +
        renderFindings(a) +
        "</div>" +
        (showCreateButton
            ? '<button type="button" class="primary-button" id="createVoBtn" ' +
              'style="margin-top:4px">' + escapeHtml(t("analysis.createVoBtn")) + '</button>'
            : "");
}

/* -----------------------------------------------------------
   Assistant panel — same rendering as js/page-vo.js's, duplicated here
   rather than shared across a <script> boundary (this codebase's usual
   pattern — see renderElementsBlock above). Grounded in the synthetic
   VO built from the analysis form once Analyse has been run; before
   that there is nothing real to answer questions about.
----------------------------------------------------------- */

function renderAssistantSuggestions(context) {
    const list = suggestions(context);
    if (list.length === 0) {
        return '<div class="empty-state">' + escapeHtml(t("assistant.noQuestionsAnalysis")) + '</div>';
    }
    return list.map(s =>
        '<button type="button" class="assistant-suggestion-btn" data-question="' +
        escapeHtml(s.id) + '">' + escapeHtml(s.label) + "</button>").join("");
}

function renderAssistantAnswer(result) {
    if (!result) {
        return '<div class="empty-state">' + escapeHtml(t("assistant.answerEmptyAnalysis")) + '</div>';
    }
    const lines = result.lines.map(l =>
        '<div class="finding"><span>' + escapeHtml(l) + "</span></div>").join("");
    return '<div class="' + (result.unmatched ? "assistant-unmatched" : "") + '">' +
        '<p class="assistant-answer-title">' + escapeHtml(result.title) + "</p>" +
        lines +
    "</div>";
}

function renderAssistantPanel(context) {
    return '' +
        '<p class="assistant-note">' + escapeHtml(t("assistant.note")) + "</p>" +
        '<div class="assistant-suggestions" id="assistantSuggestions">' +
        renderAssistantSuggestions(context) + "</div>" +
        '<div class="assistant-ask-row">' +
        '<input type="text" id="assistantInput" placeholder="' + escapeHtml(t("assistant.placeholder")) + '">' +
        '<button type="button" class="secondary-button" id="assistantAskBtn">' + escapeHtml(t("assistant.ask")) + '</button>' +
        "</div>" +
        '<div id="assistantAnswer">' + renderAssistantAnswer(null) + "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        bqOptions, renderOriginalItemField, renderForm, renderAssessmentEmpty, renderRateSuggestion,
        buildSyntheticVO, computeCosts,
        renderClassificationBlock, renderElementsBlock, renderClauseBlock, renderCostBlock, autoMatchHint,
        renderRateRows, renderFindings, renderAssessmentResult,
        renderAssistantSuggestions, renderAssistantAnswer, renderAssistantPanel
    };
}

/* ---------- browser wiring ---------- */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("analysis", t("nav.analysis"), t("crumb.analysis"));
        if (!ctx) return;
        const { session, project } = ctx;

        document.getElementById("vaFormBody").innerHTML = renderForm(project);

        /* Pick the original BQ item from the description as it is typed,
           until the user picks one by hand — then their choice stands. */
        (function wireAutoMatch() {
            const desc = document.getElementById("vaDescription");
            const select = document.getElementById("vaOriginalItem");
            const hint = document.getElementById("vaMatchHint");
            if (!desc || !select || !hint) return;
            let chosenByHand = false;
            let timer = null;
            desc.addEventListener("input", () => {
                if (chosenByHand) return;
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const text = desc.value.trim();
                    if (!text) { hint.hidden = true; select.value = ""; select.classList.remove("auto-matched"); return; }
                    const suggestion = suggestBqForChange(text, project.bq || []);
                    select.value = suggestion ? suggestion.item.id : "";
                    select.classList.toggle("auto-matched", !!suggestion);
                    hint.textContent = autoMatchHint(suggestion);
                    hint.classList.toggle("weak", !!(suggestion && suggestion.weak));
                    hint.hidden = false;
                    updateRateSuggestion();
                }, 250);
            });
            select.addEventListener("change", () => {
                chosenByHand = true;
                select.classList.remove("auto-matched");
                hint.hidden = true;
                updateRateSuggestion();
            });
        })();

        /* The revised rate from past projects (js/ratehistory.js), as the
           revised item is described: filled in while the rate field is
           empty or still holds an earlier suggestion; once the user types
           a rate of their own, it is only offered. */
        let rateWasSuggested = false;
        let rateTimer = null;
        function updateRateSuggestion() {
            const box = document.getElementById("vaRateSuggest");
            const rateInput = document.getElementById("vaRate");
            const text = (document.getElementById("vaRevisedDesc").value || "").trim();
            if (!box || !rateInput) return;
            if (!text || typeof suggestPastRate !== "function") { box.hidden = true; return; }
            const select = document.getElementById("vaOriginalItem");
            const item = select ? (project.bq || []).find(b => b.id === select.value) : null;
            const suggestion = suggestPastRate({ description: text, unit: item ? item.unit : "" },
                                               pastRateSources(loadDB(), project.id));
            const free = rateInput.value === "" || rateWasSuggested;
            if (suggestion && free) {
                rateInput.value = suggestion.rate;
                rateWasSuggested = true;
            } else if (!suggestion && rateWasSuggested) {
                rateInput.value = "";
                rateWasSuggested = false;
            }
            box.innerHTML = renderRateSuggestion(suggestion, suggestion && rateWasSuggested && Number(rateInput.value) === suggestion.rate);
            box.hidden = false;
            box.dataset.rate = suggestion ? suggestion.rate : "";
        }
        document.getElementById("vaRevisedDesc").addEventListener("input", () => {
            clearTimeout(rateTimer);
            rateTimer = setTimeout(updateRateSuggestion, 250);
        });
        document.getElementById("vaRate").addEventListener("input", () => {
            rateWasSuggested = false;
            updateRateSuggestion();
        });
        document.getElementById("vaFormBody").addEventListener("click", e => {
            if (!e.target.closest(".rate-suggest-use")) return;
            const box = document.getElementById("vaRateSuggest");
            document.getElementById("vaRate").value = box.dataset.rate;
            rateWasSuggested = true;
            updateRateSuggestion();
        });
        document.getElementById("assessmentResult").innerHTML = renderAssessmentEmpty();

        let lastVO = null; /* the synthetic VO from the most recent analysis */

        function assistantContext() {
            return { vo: lastVO, project: project, role: session.role, session: session };
        }

        function drawAssistant() {
            document.getElementById("assistantPanel").innerHTML = renderAssistantPanel(assistantContext());
            document.getElementById("assistantAnswer").innerHTML = renderAssistantAnswer(null);
        }

        function askAssistant(question) {
            const result = answer(question, assistantContext());
            document.getElementById("assistantAnswer").innerHTML = renderAssistantAnswer(result);
        }

        document.getElementById("assistantPanel").addEventListener("click", e => {
            const suggestBtn = e.target.closest(".assistant-suggestion-btn");
            if (suggestBtn) { askAssistant(suggestBtn.dataset.question); return; }
            if (e.target.id === "assistantAskBtn") {
                askAssistant(document.getElementById("assistantInput").value);
            }
        });

        document.getElementById("assistantPanel").addEventListener("keydown", e => {
            if (e.target.id !== "assistantInput" || e.key !== "Enter") return;
            askAssistant(e.target.value);
        });

        drawAssistant();

        function runAnalysis() {
            const bqSelect = document.getElementById("vaOriginalItem");
            const bqItemId = bqSelect ? bqSelect.value : "";
            const bqItem = (project.bq || []).find(b => b.id === bqItemId);

            if (!bqItem) {
                toast(t("toast.selectBqItem"), "warn");
                return;
            }

            const revisedDescription = (document.getElementById("vaRevisedDesc").value || "").trim();
            if (!revisedDescription) {
                toast(t("toast.enterRevisedDesc"), "warn");
                return;
            }

            const qty = Number(document.getElementById("vaQty").value);
            if (!(qty > 0)) {
                toast(t("toast.enterQtyPositive"), "warn");
                return;
            }

            const revisedRate = document.getElementById("vaRate").value;
            const description = document.getElementById("vaDescription").value;
            const typeOfInstruction = document.getElementById("vaType").value;

            const vo = buildSyntheticVO(bqItem, {
                description: description,
                typeOfInstruction: typeOfInstruction,
                revisedDescription: revisedDescription,
                qty: qty,
                revisedRate: revisedRate
            });

            const a = analyse(vo, getProject(project.id) || project);
            const basis = classificationBasis(vo);
            const costs = computeCosts(bqItem, qty, revisedRate);

            lastVO = vo;
            drawAssistant();

            /* The result and the helper appear once there is something
               in them — no empty cards before the first analysis. */
            const resultCard = document.getElementById("resultCard");
            const firstTime = resultCard.hidden;
            resultCard.hidden = false;
            document.getElementById("askCard").hidden = false;
            if (firstTime && window.matchMedia("(max-width: 1000px)").matches) {
                setTimeout(() => resultCard.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }

            document.getElementById("assessmentResult").innerHTML =
                renderAssessmentResult(a, basis, costs, session.role === "contractor");

            const createBtn = document.getElementById("createVoBtn");
            if (createBtn) {
                createBtn.addEventListener("click", () => {
                    const created = createVO(project.id, session);
                    updateVO(project.id, created.id, v => {
                        v.description = lastVO.description;
                        v.typeOfInstruction = lastVO.typeOfInstruction;
                        v.measurement = lastVO.measurement.map(row => ({
                            id: uid("M"),
                            bqItemId: row.bqItemId,
                            description: row.description,
                            unit: row.unit,
                            qty: row.qty,
                            rate: row.rate,
                            assessedQty: "",
                            assessedRate: ""
                        }));
                        logHistory(v, session, "Created from AI Analysis");
                    });
                    toast(t("toast.voCreated"));
                    window.location.href = "vo.html?id=" + encodeURIComponent(created.id);
                });
            }

            toast(t("toast.analysisComplete"));
        }

        document.getElementById("analyseBtn").addEventListener("click", runAnalysis);

        /* Read the project's contract in the background (once); if an
           analysis is already on screen, run it again against it. */
        if (typeof ensureContractReadings === "function") {
            ensureContractReadings(project.id, null).then(changed => { if (changed && lastVO) runAnalysis(); });
        }
    })();
}
