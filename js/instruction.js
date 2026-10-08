/* VO-AI | instruction.js — the design team issues the instruction.

   Once the contract agent (js/claimcheck.js) has checked a submitted VO,
   the design team issues the written instruction it rests on: an
   Architect's Instruction (AI) or an Engineer's Instruction (EI), with
   the next number in the project's series (AI-028, EI-009, ...), or
   confirms the instruction the contractor already quotes. Issuing it
   confirms the instruction, and the VO goes on to the cost planning
   (the consultant QS).

   vo.issuedInstruction = { kind: "AI" | "EI", no, date, by, note }
   It is the design team's field (js/permissions.js). The printable
   instruction is renderInstructionSheet(), on the report page.

   Pure functions; the VO page and the report page render them. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
    var { prettyDate } = require("./calc.js");
    var { escapeHtml, seedText, logoMark } = require("./ui.js");
    var { contractForm } = require("./claimcheck.js");
}

function instructionKind(type) {
    return /\(EI\)|engineer/i.test(String(type || "")) ? "EI" : "AI";
}

/* The highest number already used in a series, from the instructions the
   design team issued and the numbers the contractors quoted; the next
   one follows it, three digits ("AI-028"). */
function nextInstructionNo(project, kind) {
    const re = new RegExp("^" + kind + "[-\\s]?(\\d+)$", "i");
    let max = 0;
    ((project && project.vos) || []).forEach(v => {
        [v.instructionNo, v.issuedInstruction && v.issuedInstruction.no].forEach(no => {
            const m = re.exec(String(no || "").trim());
            if (m) max = Math.max(max, Number(m[1]));
        });
    });
    return kind + "-" + String(max + 1).padStart(3, "0");
}

/* What the design team's form offers: the contractor's own number when
   it quotes one of the right kind (confirming it), else the next one. */
function proposedInstruction(project, vo) {
    const kind = instructionKind(vo && vo.typeOfInstruction);
    const quoted = String((vo && vo.instructionNo) || "").trim();
    const fits = new RegExp("^" + kind + "[-\\s]?\\d+$", "i").test(quoted);
    return { kind: kind, no: fits ? quoted : nextInstructionNo(project, kind), confirming: fits };
}

/* The number must be "AI-…"/"EI-…" and not already issued on another VO. */
function instructionProblem(project, vo, kind, no) {
    const n = String(no || "").trim();
    if (!new RegExp("^" + kind + "[-\\s]?\\d+$", "i").test(n)) return t("instr.badNo", { kind: kind });
    const taken = ((project && project.vos) || []).find(v => v.id !== vo.id &&
        v.issuedInstruction && String(v.issuedInstruction.no).toUpperCase() === n.toUpperCase());
    return taken ? t("instr.taken", { no: n, vo: taken.no }) : "";
}

/* The design team's step ①, when it may still issue: one button. The
   kind (AI / EI) and the next number are set by the system
   (proposedInstruction). */
function renderIssueForm(project, vo) {
    return '<div class="instr-issue">' +
        '<button type="button" class="primary-button" id="issueInstrBtn">' + escapeHtml(t("instr.issueBtn")) + "</button>" +
    "</div>";
}

/* Once issued: what, when, by whom, and the link to print it. */
function renderIssued(vo) {
    const i = vo.issuedInstruction;
    return '<div class="instr-issued">' +
        '<p class="ca-ref"><strong>' + escapeHtml(t("instr.issuedLine", { kind: t("instr.kind." + i.kind), no: i.no })) + "</strong> · " +
        escapeHtml(prettyDate(i.date)) + (i.by ? " · " + escapeHtml(i.by) : "") + "</p>" +
        (i.note ? '<p class="rate-detail">' + escapeHtml(i.note) + "</p>" : "") +
        '<a class="link-button" href="report.html?mode=instruction&id=' + encodeURIComponent(vo.id) + '">' + escapeHtml(t("instr.print")) + "</a>" +
    "</div>";
}

/* The instruction as issued, for printing: who it is to, what it
   instructs, the drawings it refers to, and how it will be valued. */
function renderInstructionSheet(vo, project) {
    const i = vo.issuedInstruction;
    if (!i) return '<div class="empty-state">' + escapeHtml(t("instr.notIssued", { no: vo.no })) + "</div>";
    const form = contractForm(project);
    const drawings = (vo.revisedDrawing || []).map(d => d.name);
    const issuer = t(i.kind === "EI" ? "instr.issuerEI" : "instr.issuerAI");
    return '<div class="report-sheet instr-sheet">' +
        '<div class="report-head">' +
            '<div class="report-head-id">' + logoMark(38) +
            "<div><h1>" + escapeHtml(t("instr.kind." + i.kind)) + "</h1>" +
            "<p>" + escapeHtml(project.name) + "</p>" +
            "<p>" + t("report.contractLine", { no: escapeHtml(project.contractNo || "—"), client: escapeHtml(project.client || "—") }) + "</p></div></div>" +
            '<div class="report-ref"><strong>' + escapeHtml(i.no) + "</strong>" +
            "<span>" + escapeHtml(prettyDate(i.date)) + "</span></div>" +
        "</div>" +
        '<section class="report-sec">' +
            "<p>" + escapeHtml(t("instr.to")) + "</p>" +
            "<p>" + escapeHtml(t(form === "PAM 2018" ? "instr.underPam" : "instr.underPwd", { form: form })) + "</p>" +
        "</section>" +
        '<section class="report-sec"><h3>' + escapeHtml(t("instr.sec.instruction")) + "</h3>" +
            "<p>" + escapeHtml(seedText(vo.description) || "—") + "</p>" +
            (i.note ? "<p>" + escapeHtml(i.note) + "</p>" : "") +
        "</section>" +
        '<section class="report-sec"><h3>' + escapeHtml(t("instr.sec.drawings")) + "</h3>" +
            (drawings.length ? '<ul class="report-list">' + drawings.map(n => "<li>" + escapeHtml(n) + "</li>").join("") + "</ul>"
                             : "<p>" + escapeHtml(t("instr.noDrawings")) + "</p>") +
        "</section>" +
        '<section class="report-sec"><h3>' + escapeHtml(t("instr.sec.valuation")) + "</h3>" +
            "<p>" + escapeHtml(t(form === "PAM 2018" ? "instr.valuationPam" : "instr.valuationPwd",
                { vo: vo.no, clause: form === "PWD 203" ? "25" : "24" })) + "</p>" +
        "</section>" +
        '<div class="signatures instr-signatures">' +
            "<div><span></span><small>" + escapeHtml(issuer) + (i.by ? " — " + escapeHtml(i.by) : "") + "</small></div>" +
            "<div><span></span><small>" + escapeHtml(t("instr.received")) + "</small></div>" +
        "</div>" +
    "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { instructionKind, nextInstructionNo, proposedInstruction, instructionProblem,
                       renderIssueForm, renderIssued, renderInstructionSheet };
}
