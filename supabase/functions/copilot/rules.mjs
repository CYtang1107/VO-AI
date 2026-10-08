/* VO-AI | copilot rules — what the project Copilot's general AI mode may
   say. Pure functions for the Edge Function (index.ts, Deno) and the Node
   tests (test/copilot.test.js). The checks are those of 「问合同」
   (../ask-contract/rules.mjs), with one difference: a project answer need
   not cite a clause, since most questions about the project have none.
     1. Every amount in the answer is in the project's data, the question or
        a clause given: never the model's own arithmetic or estimate.
     2. A clause it cites must be one it was given.
   A general question (not about this project: a definition, construction
   practice, general knowledge) may be answered from general knowledge;
   such an answer starts with GENERAL_TAG, is shown labelled as general,
   and may quote no money amount that is not in the project's data.
   One retry naming the broken rule; then no answer. */

import { amountsIn, checkCitations, citationLabel, citationsFor, groupChunks, questionLang, unsupportedAmounts } from "../ask-contract/rules.mjs";

export { citationsFor, groupChunks, questionLang };

export const MAX_QUESTION = 500;
export const GENERAL_TAG = "[GENERAL]";

/* An answer from general knowledge carries the tag first; it is taken off
   for showing, and the answer is marked general. */
export function splitGeneral(text) {
    const s = String(text || "").trim();
    return s.toUpperCase().startsWith(GENERAL_TAG) ? { general: true, text: s.slice(GENERAL_TAG.length).trim() } : { general: false, text: s };
}
export const MAX_DATA_CHARS = 60000;

export function validCopilotRequest(body) {
    if (!body || typeof body !== "object") return "Body must be JSON.";
    if (typeof body.project_id !== "string" || !body.project_id) return "project_id is required.";
    if (typeof body.question !== "string" || !body.question.trim()) return "question is required.";
    if (body.question.length > MAX_QUESTION) return "question is too long (" + MAX_QUESTION + " characters at most).";
    if (!body.project_data || typeof body.project_data !== "object" || Array.isArray(body.project_data)) return "project_data is required.";
    if (JSON.stringify(body.project_data).length > MAX_DATA_CHARS) return "project_data is too large.";
    return null;
}

const ROLE = {
    contractor: ["the contractor's quantity surveyor", "承包商工料测量师"],
    administrator: ["the design team (Architect, Engineer or SO)", "设计团队（建筑师、工程师或 SO）"],
    consultant: ["the consultant quantity surveyor", "顾问工料测量师"],
    client: ["the client / developer", "业主 / 发展商"]
};

export function copilotSystemPrompt(role, lang) {
    const who = (ROLE[role] || ROLE.consultant)[lang === "zh" ? 1 : 0];
    const cite = citationLabel("PAM 2018", "11.6", lang);
    return [
        "You are VO-AI's project Copilot for a construction project in Malaysia, helping " + who + " with the project's variation orders (VOs), cost and contract.",
        "Rules you must follow:",
        "0. First decide what kind of question it is. A question about THIS project (its VOs, costs, rates, deadlines, documents, people, programme or contract) is a project question: follow rules 1 to 7. Any other question (a definition, how something is usually done in construction or quantity surveying, or general knowledge) is a general question: answer it briefly and correctly from general knowledge, start the answer with exactly " + GENERAL_TAG + ", state no fact or figure about this project, write no money amount, and follow rules 5 to 7. Prefer the project's data whenever the question could be about the project.",
        "1. Answer a project question ONLY from PROJECT DATA and, if given, CONTRACT CLAUSES in the user message. If they do not contain the answer, say plainly that VO-AI's data does not show it. Never use outside knowledge as if it were this project's facts.",
        "2. Every amount of money, rate or quantity you write must be copied exactly from PROJECT DATA, the question or a clause. Never calculate, add, subtract, compare by subtraction, estimate or round an amount. You may say which is larger or name the VO with the largest figure, quoting the figures as given.",
        "3. Name VOs by their number (e.g. VO-002) so the reader can open them. Write natural sentences: never copy the data's keys, never write a word with an underscore, and in Chinese use Chinese terms (申报金额, 评估金额, 差额, 核证, 批准).",
        "Differences already worked out by VO-AI (such as \"assessed minus claimed\") may be quoted and compared to answer which is largest or smallest.",
        "4. When a statement comes from a contract clause, cite it as " + cite + ", only clauses that were given. Project facts need no citation.",
        "5. Answer in " + (lang === "zh" ? "Simplified Chinese (terms such as VO, BQ, AI, EI, SPI, CPI may stay in English)" : "English") + ". Be brief: at most 8 short sentences or bullet points.",
        "6. Never write the words \"PROJECT DATA\" or \"CONTRACT CLAUSES\": call them " + (lang === "zh" ? "\"项目数据\" and \"合同条文\"" : "\"the project's data\" and \"the contract\"") + ", and do not mention what was or was not provided to you.",
        "7. This is decision support: for a judgement (whether to approve, certify or claim), give the facts and the clause, and leave the decision to the professional."
    ].join("\n");
}

export function copilotUserPrompt(question, projectData, clauses, lang) {
    const parts = ["PROJECT DATA (from VO-AI's register and rule engine; the only facts and figures you may use):",
        JSON.stringify(projectData, null, 1), ""];
    if (clauses && clauses.length) {
        parts.push("CONTRACT CLAUSES (nearest to the question; cite them when you use them):");
        clauses.forEach(c => parts.push("--- " + citationLabel(c.form || c.doc_name, c.clause_no, lang) + (c.title ? " " + c.title : "") + "\n" + c.text));
        parts.push("");
    }
    parts.push("QUESTION: " + question);
    return parts.join("\n");
}

export function reviewCopilotAnswer(answer, projectData, clauses, question) {
    const problems = [];
    const { general, text } = splitGeneral(answer);
    if (!text) problems.push("empty");
    const citations = checkCitations(text, clauses || []);
    if (citations.invented.length) problems.push("invented-citation");
    /* a project answer: every amount from the data; a general one: no
       money amount that is not in the data (other numbers, such as a
       year or a size, are general knowledge) */
    const badAmounts = unsupportedAmounts(text, projectData, question, clauses || [])
        .filter(a => !general || /RM|MYR|令吉/i.test(a));
    if (badAmounts.length) problems.push("amount-check");
    return { ok: problems.length === 0, problems, cited: citations.cited, invented: citations.invented, badAmounts, general, text };
}

export function copilotCorrection(review) {
    const lines = ["Your previous answer broke the rules:"];
    if (review.badAmounts.length) lines.push("- It contains amounts that are not in the project's data: " + review.badAmounts.join(", ") + ". Remove them; copy figures exactly and never calculate.");
    if (review.invented.length) lines.push("- It cited clauses that were not given: " + review.invented.join(", ") + ". Cite only the clauses given.");
    if (review.problems.includes("empty")) lines.push("- It was empty.");
    lines.push("Write the answer again, following every rule.");
    return lines.join("\n");
}

export { amountsIn };
