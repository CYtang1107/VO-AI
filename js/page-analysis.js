/* VO-AI | page-analysis.js — "AI Analysis": a what-if analyser.
   The user describes a proposed change against a priced BQ item; every
   number shown is computed by js/analysis.js from that input. Nothing
   here is hardcoded — no confidence score, no fixed clause. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm } = require("./calc.js");
    var { analyse, classificationBasis } = require("./analysis.js");
    var { answer, suggestions } = require("./assistant.js");
    var { escapeHtml } = require("./ui.js");
}

const INSTRUCTION_TYPES = ["Architect's Instruction (AI)", "Engineer's instruction (EI)"];

/* Same format as bqOptions in js/page-vo.js: code · description · rate/unit. */
function bqOptions(project, selectedId) {
    const opts = ['<option value="">— select the BQ item being changed —</option>'];
    (project.bq || []).forEach(b => {
        opts.push('<option value="' + escapeHtml(b.id) + '"' +
            (b.id === selectedId ? " selected" : "") + ">" +
            escapeHtml(b.code + " · " + b.description + " · " + rm(b.rate) + "/" + b.unit) +
            "</option>");
    });
    return opts.join("");
}

/* If the project has no priced BQ items, there is nothing to substitute
   against — show an explanatory empty state, not an empty dropdown. */
function renderOriginalItemField(project, selectedId) {
    const bq = project.bq || [];
    if (bq.length === 0) {
        return '<div class="field"><label>Original item (from priced BQ)</label>' +
               '<div class="empty-state">This project has no priced BQ items yet. Ask the ' +
               'consultant QS to upload the priced Bills of Quantities before running an ' +
               'analysis.</div></div>';
    }
    return '<div class="field"><label>Original item (from priced BQ)</label>' +
           '<select id="vaOriginalItem">' + bqOptions(project, selectedId) + "</select></div>";
}

function renderForm(project) {
    return '' +
        '<div class="field"><label>Variation title / description of the proposed change</label>' +
        '<textarea id="vaDescription" placeholder="Describe what is changing and why"></textarea></div>' +

        '<div class="field"><label>Type of instruction</label>' +
        '<select id="vaType">' +
        INSTRUCTION_TYPES.map(t => '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) +
            "</option>").join("") +
        "</select></div>" +

        renderOriginalItemField(project, "") +

        '<div class="field"><label>Revised item description</label>' +
        '<input type="text" id="vaRevisedDesc" placeholder="e.g. Marble floor tiles 600x600mm"></div>' +

        '<div class="field"><label>Quantity</label>' +
        '<input type="number" id="vaQty" min="0" step="any"></div>' +

        '<div class="field"><label>Revised rate, RM per unit</label>' +
        '<input type="number" id="vaRate" min="0" step="any"></div>' +

        '<button type="button" class="primary-button" id="analyseBtn" ' +
        'style="margin-top:4px">Analyse</button>';
}

function renderAssessmentEmpty() {
    return '<div class="empty-state">Describe the proposed change and click Analyse to see ' +
           "the AI assessment.</div>";
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
        '<h4 class="result-group-title">Classification</h4>' +
        '<div class="result-row"><span class="result-label">Classification</span>' +
        '<span class="result-value">' + escapeHtml(a.classification.label) + "</span></div>" +
        '<div class="result-row"><span class="result-label">Affected work</span>' +
        '<span class="result-value">' + escapeHtml(a.classification.affectedWork) + "</span></div>" +
        '<p class="rate-detail" style="margin-top:10px"><strong>Basis for classification' +
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
        '<span class="element-tag">' + escapeHtml(el.name) + "</span>").join(" ");

    const relatedHtml = els.related.length === 0
        ? '<p class="rate-detail">No commonly-related elements to confirm for the detected ' +
          "element(s)." + "</p>"
        : els.related.map(r =>
            '<div class="finding element-check"><label><input type="checkbox"> ' +
            '<span class="element-tag element-tag-related">' + escapeHtml(r.element.name) +
            "</span> — " + escapeHtml(r.note) + "</label></div>").join("");

    return '<div class="result-group">' +
        '<h4 class="result-group-title">Elements affected</h4>' +
        '<div class="result-row"><span class="result-label">Detected element(s)</span>' +
        '<span class="result-value">' + detectedHtml + "</span></div>" +
        '<p class="rate-detail" style="margin-top:10px"><strong>Confirm whether these ' +
        "also require measurement</strong></p>" +
        relatedHtml +
        "</div>";
}

function renderClauseBlock(a) {
    if (!a.clause) {
        return '<div class="result-group">' +
               '<h4 class="result-group-title">Contractual basis</h4>' +
               '<p class="rate-detail">The change could not be classified from the ' +
               "description, so no governing contract clause can be identified. Enter a " +
               "clearer description and analyse again.</p></div>";
    }
    return '<div class="result-group">' +
        '<h4 class="result-group-title">Contractual basis</h4>' +
        '<div class="result-row"><span class="result-label">Governing clause</span>' +
        '<span class="result-value">' + escapeHtml(a.clause.form + " " + a.clause.ref) +
        "</span></div>" +
        '<p class="rate-detail"><strong>' + escapeHtml(a.clause.title) + "</strong><br>" +
        escapeHtml(a.clause.entitlement) + "</p>" +
        '<p class="rate-detail"><strong>Evidence required:</strong> ' +
        escapeHtml(a.clause.evidence) + "</p></div>";
}

/* Cost impact: the additional cost is what a QS looks for first, so it
   gets the .cost-highlight treatment; the rest are plain result rows. */
function renderCostBlock(costs) {
    let html = '<div class="result-group">' +
        '<h4 class="result-group-title">Cost impact</h4>' +
        '<div class="result-row"><span class="result-label">Original cost</span>' +
        '<span class="result-value">' + rm(costs.originalCost) + "</span></div>" +
        '<div class="result-row"><span class="result-label">Revised cost</span>' +
        '<span class="result-value">' + rm(costs.revisedCost) + "</span></div>" +
        '<div class="cost-highlight"><span class="result-label">Additional cost</span>' +
        '<span class="result-value">' + rm(costs.additionalCost) + "</span></div>";
    if (costs.pct !== null) {
        html += '<div class="result-row"><span class="result-label">Change vs. original rate</span>' +
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
    if (a.rates.rows.length === 0) return '<div class="empty-state">No measurement rows.</div>';
    return a.rates.rows.map(r => {
        const autoNote = r.check.autoMatched
            ? '<div class="rate-detail auto-match-note">' +
              '<span class="rate-flag auto-match">Suggested match</span> ' +
              escapeHtml(r.check.matchedItem.code + " · " + r.check.matchedItem.description) +
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
        ? '<div class="empty-state">Nothing to flag.</div>'
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
        '<h4 class="result-group-title">Rate cross-check</h4>' +
        renderRateRows(a) +
        "</div>" +
        '<div class="result-group">' +
        '<h4 class="result-group-title">Findings</h4>' +
        renderFindings(a) +
        "</div>" +
        (showCreateButton
            ? '<button type="button" class="primary-button" id="createVoBtn" ' +
              'style="margin-top:4px">Create this as a Variation Order</button>'
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
        return '<div class="empty-state">Run an analysis above to ask the assistant about it.</div>';
    }
    return list.map(s =>
        '<button type="button" class="assistant-suggestion-btn" data-question="' +
        escapeHtml(s.id) + '">' + escapeHtml(s.label) + "</button>").join("");
}

function renderAssistantAnswer(result) {
    if (!result) {
        return '<div class="empty-state">Click a suggested question, or type your own, to get ' +
            "an answer grounded in the analysis above.</div>";
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
        '<p class="assistant-note">Answers are computed from this project\'s stored data and ' +
        "the bundled clause and element knowledge bases. This is not a general chat assistant " +
        "— it can only answer the questions below.</p>" +
        '<div class="assistant-suggestions" id="assistantSuggestions">' +
        renderAssistantSuggestions(context) + "</div>" +
        '<div class="assistant-ask-row">' +
        '<input type="text" id="assistantInput" placeholder="Ask about this variation or the contract position...">' +
        '<button type="button" class="secondary-button" id="assistantAskBtn">Ask</button>' +
        "</div>" +
        '<div id="assistantAnswer">' + renderAssistantAnswer(null) + "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        bqOptions, renderOriginalItemField, renderForm, renderAssessmentEmpty,
        buildSyntheticVO, computeCosts,
        renderClassificationBlock, renderElementsBlock, renderClauseBlock, renderCostBlock,
        renderRateRows, renderFindings, renderAssessmentResult,
        renderAssistantSuggestions, renderAssistantAnswer, renderAssistantPanel
    };
}

/* ---------- browser wiring ---------- */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("analysis", "AI Analysis", "VO-AI / AI Analysis");
        if (!ctx) return;
        const { session, project } = ctx;

        document.getElementById("vaFormBody").innerHTML = renderForm(project);
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
                toast("Select the original BQ item being changed.", "warn");
                return;
            }

            const revisedDescription = (document.getElementById("vaRevisedDesc").value || "").trim();
            if (!revisedDescription) {
                toast("Enter a description of the revised item.", "warn");
                return;
            }

            const qty = Number(document.getElementById("vaQty").value);
            if (!(qty > 0)) {
                toast("Enter a quantity greater than zero.", "warn");
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

            const a = analyse(vo, project);
            const basis = classificationBasis(vo);
            const costs = computeCosts(bqItem, qty, revisedRate);

            lastVO = vo;
            drawAssistant();

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
                    toast("Variation order created.");
                    window.location.href = "vo.html?id=" + encodeURIComponent(created.id);
                });
            }

            toast("Analysis complete.");
        }

        document.getElementById("analyseBtn").addEventListener("click", runAnalysis);
    })();
}
