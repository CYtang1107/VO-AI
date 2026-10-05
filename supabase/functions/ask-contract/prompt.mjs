/* VO-AI | ask-contract/prompt.mjs — what the model is told, and what its
   answer must satisfy before it reaches a user (docs/rag-plan.md, step 3).

   Kept apart from index.ts, and free of Deno and of the network, so the
   rules the whole feature rests on can be tested with `node --test`
   (test/ask-contract.test.js). Deno imports this file as it is.

   The two rules it enforces, from docs/rag-plan.md:
     1. The AI never calculates money. Every amount in an answer must come
        from the rule engine's own output (engine_facts) or from the
        quoted clause text — never from the model.
     2. Every answer cites its clauses. An answer with no citation is not
        shown; the function asks once more, then gives up and says so. */

/* ---------------- the prompt ---------------- */

/* One line per role: the same clauses, read for a different job. */
export const ROLE_FRAMING = {
    contractor: "The reader is the contractor's own QS, checking this claim before submitting it. Point out what the contract will require of them.",
    consultant: "The reader is the consultant QS, assessing the claim against the contract. Be even-handed: say what supports the claim and what does not.",
    client: "The reader is the employer's certifier, deciding whether to certify. Say what the contract requires before certification."
};

export const SYSTEM_RULES = [
    "You answer questions about a construction contract for the VO-AI variation-order tool.",
    "Answer ONLY from the numbered clauses given to you below. They are the complete extract you are allowed to rely on.",
    "If the clauses do not cover the question, say so plainly and stop. Never answer from general knowledge or from another contract.",
    "Cite every clause you rely on, inline, in the form 「引用：{form} 第 {clause} 条」 (for example 「引用：PAM 2018 第 11.6 条」). At least one citation is required.",
    "NEVER calculate, estimate or invent any amount, rate, percentage or total. The only figures you may write are ones that appear verbatim in ENGINE FACTS or inside a quoted clause. If a figure is not there, say which document or which part of the tool shows it instead.",
    "Answer in the language of the question (Chinese question → Chinese answer; English question → English answer), but keep clause numbers and the form's name as they are.",
    "Be brief: at most about 150 words, no preamble, no restating the question."
].join("\n");

function factsBlock(facts) {
    if (!facts || typeof facts !== "object" || Object.keys(facts).length === 0) {
        return "ENGINE FACTS: none supplied. Do not write any figure at all.";
    }
    return "ENGINE FACTS (computed by VO-AI's rule engine — the only figures you may repeat):\n" +
        JSON.stringify(facts, null, 1);
}

function clauseBlock(clauses) {
    return (clauses || []).map((c, i) =>
        "[" + (i + 1) + "] " + (c.form ? c.form + " " : "") +
        (/^Article/i.test(c.clause_no) ? c.clause_no : "clause " + c.clause_no) +
        (c.title ? " — " + c.title : "") + "\n" + c.text
    ).join("\n\n");
}

/* The chat messages for one question. `retry` is set on the second
   attempt, after a first answer broke a rule. */
export function buildMessages(input) {
    const { question, role, clauses, facts, retry } = input || {};
    const system = SYSTEM_RULES +
        (ROLE_FRAMING[role] ? "\n" + ROLE_FRAMING[role] : "");
    const user = "CLAUSES\n" + clauseBlock(clauses) + "\n\n" + factsBlock(facts) +
        "\n\nQUESTION\n" + String(question || "").trim();
    const messages = [
        { role: "system", content: system },
        { role: "user", content: user }
    ];
    if (retry) {
        messages.push({ role: "user", content:
            "Your previous answer was rejected: " + retry +
            " Answer again, obeying the rules exactly." });
    }
    return messages;
}

/* ---------------- what an answer must satisfy ---------------- */

/* A money amount or a percentage written in the answer: "RM 12,500.00",
   "MYR 500", "12,500.00", "5%". A bare small integer ("within 14 days",
   "clause 11.6") is not an amount and is not checked here. */
const AMOUNT_RE = /(?:RM|MYR|\$)\s*([\d,]+(?:\.\d+)?)|\b([\d,]+\.\d{2})\b|\b(\d+(?:\.\d+)?)\s*%/gi;

function toNumber(raw) {
    const n = Number(String(raw).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
}

/* Every amount the answer states. */
export function amountsIn(text) {
    const out = [];
    const re = new RegExp(AMOUNT_RE.source, "gi");
    let m;
    while ((m = re.exec(String(text || ""))) !== null) {
        const n = toNumber(m[1] || m[2] || m[3]);
        if (n !== null) out.push(n);
    }
    return out;
}

/* Every number that appears anywhere in the material the answer is
   allowed to repeat: the engine's facts, the clauses it was given, and
   the question itself. Any number, not only money-shaped ones, because
   the engine writes totals as plain JSON numbers (12500) that the answer
   may legitimately render as "RM 12,500.00". */
export function allowedNumbers(sources) {
    const text = (sources || []).map(s =>
        typeof s === "string" ? s : JSON.stringify(s === undefined ? null : s)).join(" ");
    const set = new Set();
    const re = /\d[\d,]*(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const n = toNumber(m[0]);
        if (n !== null) set.add(n);
    }
    return set;
}

/* The citation the rules ask for: the marker, and a clause number that
   really was retrieved (so "第 99 条" invented by the model fails). */
export function hasCitation(answer, clauses) {
    const text = String(answer || "");
    if (!/引用|\bSource\s*:/i.test(text)) return false;
    return (clauses || []).some(c => c.clause_no && text.indexOf(String(c.clause_no)) !== -1);
}

/* { ok } or { ok: false, reason, detail } — `detail` is the sentence the
   retry message quotes back to the model. */
export function checkAnswer(answer, context) {
    const { clauses, facts, question } = context || {};
    const text = String(answer || "").trim();
    if (!text) return { ok: false, reason: "empty", detail: "It was empty." };

    const allowed = allowedNumbers([
        facts, question, ...(clauses || []).map(c => (c.text || "") + " " + (c.title || "") + " " + (c.clause_no || ""))
    ]);
    const invented = amountsIn(text).filter(n => !allowed.has(n));
    if (invented.length > 0) {
        return { ok: false, reason: "amount", amounts: invented,
                 detail: "It contained figures that are in neither ENGINE FACTS nor the clauses: " +
                         invented.join(", ") + "." };
    }
    if (!hasCitation(text, clauses)) {
        return { ok: false, reason: "no-citation",
                 detail: "It did not cite a clause in the form 「引用：…第 … 条」." };
    }
    return { ok: true };
}

/* What the browser shows as chips under the answer. */
export function citationsOf(clauses) {
    return (clauses || []).map(c => ({
        clause_no: c.clause_no, title: c.title || null, doc_name: c.doc_name || null,
        form: c.form || null, text: c.text,
        similarity: typeof c.similarity === "number" ? Math.round(c.similarity * 1000) / 1000 : null
    }));
}
