/* VO-AI | ask-contract rules — what the contract agent may say
   (docs/rag-plan.md, step 3). Pure functions, shared by the Edge Function
   (index.ts, Deno) and the Node tests (test/askcontract.test.js).

   Three rules are checked on every answer, not only asked for in the prompt:
   1. it cites at least one clause, and only clauses it was given;
   2. every amount in it comes from the rule engine's figures (or from the
      question or the clauses themselves), never from the model's arithmetic;
   3. with no clause above the similarity bar there is no answer at all. */

export const MIN_SIMILARITY = 0.35;
export const TOP_K = 6;
export const MAX_QUESTION = 500;

/* The three agents: the same knowledge base, each framed for its role. */
export const ROLE_FRAMING = {
    contractor: {
        zh: "你是承包商自查员：帮助承包商在提交变更申报前，对照合同条文自查申报是否站得住、还缺什么证据。",
        en: "You are the contractor's self-check agent: help the contractor check a variation claim against the contract before it is submitted, and say what evidence it still needs."
    },
    consultant: {
        zh: "你是咨询核价员：帮助咨询工料测量师依照合同条文评估这项变更。",
        en: "You are the consultant's assessment agent: help the consultant quantity surveyor assess this variation against the contract."
    },
    client: {
        zh: "你是业主核证员：帮助业主依照合同条文判断这项变更是否可以核证。",
        en: "You are the client's certification agent: help the client decide, against the contract, whether this variation can be certified."
    }
};

/* A question with any Chinese character is answered in Chinese. */
export function questionLang(question) {
    return /[㐀-鿿]/.test(String(question || "")) ? "zh" : "en";
}

export function citationLabel(form, clauseNo, lang) {
    const isArticle = /^Article /.test(clauseNo);
    if (lang === "zh") {
        return "「引用：" + form + (isArticle ? " " + clauseNo : " 第 " + clauseNo + " 条") + "」";
    }
    return "[Ref: " + form + (isArticle ? " " + clauseNo : " Clause " + clauseNo) + "]";
}

export function systemPrompt(role, lang) {
    const framing = (ROLE_FRAMING[role] || ROLE_FRAMING.consultant)[lang === "zh" ? "zh" : "en"];
    const cite = lang === "zh" ? "「引用：PAM 2018 第 11.6 条」" : "[Ref: PAM 2018 Clause 11.6]";
    return [
        framing,
        "Rules you must follow:",
        "1. Answer ONLY from the contract clauses given in the user message. Do not use general knowledge about construction contracts as if it were this contract.",
        "2. After each statement taken from a clause, cite it exactly in the form " + cite + ", using the form name and clause number shown with that clause. Cite only clauses that were given.",
        "3. Never calculate, estimate, add, subtract or invent any amount of money, rate or quantity. If an amount is needed, use only the figures in ENGINE FACTS, copied exactly. If ENGINE FACTS does not have it, say the rule engine has not produced that figure.",
        "4. If the clauses given do not answer the question, say so plainly and do not guess. Do not give a contract meaning to a term the clauses do not define.",
        "In VO-AI, a \"star rate\" is a new rate claimed for work that the contract BQ does not price; it needs agreement and support (a quotation or rate build-up). It is not a rate marked with an asterisk in the contract.",
        "5. Answer in " + (lang === "zh" ? "Simplified Chinese (contract terms such as Architect, AI, Variation may stay in English)" : "English") + ". Be brief: at most 6 short sentences or bullet points.",
        "6. The clause text came from an OCR scan and may contain small misreadings; quote its meaning, not its typos."
    ].join("\n");
}

/* Neighbouring pieces of one long clause are shown together. */
export function groupChunks(chunks) {
    const byKey = new Map();
    (chunks || []).forEach(c => {
        const key = (c.form || c.doc_name) + "|" + c.clause_no;
        const cur = byKey.get(key);
        if (!cur) byKey.set(key, Object.assign({}, c));
        else {
            cur.text = cur.text + " " + c.text;
            cur.similarity = Math.max(cur.similarity, c.similarity);
        }
    });
    return [...byKey.values()];
}

export function userPrompt(question, clauses, engineFacts, lang) {
    const parts = ["CONTRACT CLAUSES (the only source you may use):"];
    clauses.forEach(c => {
        parts.push("--- " + citationLabel(c.form || c.doc_name, c.clause_no, lang) +
            (c.title ? " " + c.title : "") + "\n" + c.text);
    });
    parts.push("");
    parts.push("ENGINE FACTS (computed by VO-AI's rule engine; the only figures you may quote):");
    parts.push(engineFacts && Object.keys(engineFacts).length ? JSON.stringify(engineFacts, null, 1) : "(none)");
    parts.push("");
    parts.push("QUESTION: " + question);
    return parts.join("\n");
}

/* ---------- checks on the answer ---------- */

/* Clause numbers the answer cites in its citation labels (「引用：…」 or
   [Ref: …]). A clause named in passing ("the matters in Clause 24.3",
   quoted from a given clause) is not a citation and is not checked. */
export function citedClauses(answer) {
    const text = String(answer || "");
    const found = new Set();
    const labels = /「\s*引用\s*[：:]([^」]*)」|\[\s*Ref\s*:([^\]]*)\]/gi;
    const numbers = /(Article\s+\d{1,2})|(\d{1,2}(?:\.\d{1,2})?)(?=\s*(?:\([a-z0-9]{1,4}\)\s*)*(?:条|款|$|[,、，;；\s]))/gi;
    let label;
    while ((label = labels.exec(text))) {
        const inside = (label[1] || label[2] || "").replace(/\b(PAM|PWD|CIDB|JKR)\s*\d{4}\b/gi, "");
        let m;
        while ((m = numbers.exec(inside))) {
            found.add(m[1] ? "Article " + m[1].replace(/\D+/g, "") : m[2]);
        }
    }
    return [...found];
}

/* A cited "11" is clause 11.0 (the heading) or any 11.x given. */
function citesGiven(no, givenNos) {
    if (givenNos.includes(no)) return true;
    if (/^\d+$/.test(no)) return givenNos.some(g => g === no + ".0" || g.startsWith(no + "."));
    return false;
}

export function checkCitations(answer, clauses) {
    const given = clauses.map(c => c.clause_no);
    const cited = citedClauses(answer);
    const valid = cited.filter(no => citesGiven(no, given));
    const invented = cited.filter(no => !citesGiven(no, given));
    return { cited: valid, invented: invented, ok: valid.length > 0 && invented.length === 0 };
}

function numberValue(s) {
    const n = Number(String(s).replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/* Amounts in a text: anything marked RM, and any number written with
   thousands separators or of 1,000 or more. Small numbers (days, clause
   numbers, percentages) are not amounts. */
export function amountsIn(text) {
    const out = [];
    const s = String(text || "");
    const re = /(RM|MYR|令吉)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/gi;
    let m;
    while ((m = re.exec(s))) {
        const raw = m[2];
        const value = numberValue(raw);
        if (value === null) continue;
        const after = s.slice(m.index + m[0].length, m.index + m[0].length + 1);
        if (after === "%") continue;
        if (m[1] || raw.includes(",") || value >= 1000) out.push({ raw: m[0].trim(), value: value });
    }
    return out;
}

function numbersIn(value, into) {
    if (value === null || value === undefined) return into;
    if (typeof value === "number") { into.add(Math.round(value * 100) / 100); return into; }
    if (typeof value === "string") {
        const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
        let m;
        while ((m = re.exec(value))) {
            const n = numberValue(m[0]);
            if (n !== null) into.add(n);
        }
        return into;
    }
    if (Array.isArray(value)) { value.forEach(v => numbersIn(v, into)); return into; }
    if (typeof value === "object") { Object.values(value).forEach(v => numbersIn(v, into)); return into; }
    return into;
}

/* Amounts in the answer that are in none of: the engine's figures, the
   question, the clauses given. Any such amount means the model made a
   number up or did arithmetic, and the answer is not shown. */
export function unsupportedAmounts(answer, engineFacts, question, clauses) {
    const allowed = new Set();
    numbersIn(engineFacts, allowed);
    numbersIn(question, allowed);
    (clauses || []).forEach(c => { numbersIn(c.text, allowed); numbersIn(c.form, allowed); numbersIn(c.doc_name, allowed); });
    return amountsIn(answer).filter(a => !allowed.has(a.value)).map(a => a.raw);
}

/* The whole verdict on one model answer. */
export function reviewAnswer(answer, clauses, engineFacts, question) {
    const citations = checkCitations(answer, clauses);
    const badAmounts = unsupportedAmounts(answer, engineFacts, question, clauses);
    const problems = [];
    if (!String(answer || "").trim()) problems.push("empty");
    if (citations.invented.length) problems.push("invented-citation");
    if (!citations.cited.length) problems.push("no-citation");
    if (badAmounts.length) problems.push("amount-check");
    return { ok: problems.length === 0, problems: problems, cited: citations.cited, invented: citations.invented, badAmounts: badAmounts };
}

/* What the model is told when its first answer broke a rule. */
export function correction(review, lang) {
    const lines = ["Your previous answer broke the rules:"];
    if (review.problems.includes("no-citation")) lines.push("- It did not cite any clause. Cite each point as " + citationLabel("PAM 2018", "11.6", lang) + ".");
    if (review.invented.length) lines.push("- It cited clauses that were not given: " + review.invented.join(", ") + ". Cite only the clauses given.");
    if (review.badAmounts.length) lines.push("- It contains amounts not in ENGINE FACTS: " + review.badAmounts.join(", ") + ". Remove them; never calculate amounts.");
    lines.push("Write the answer again, following every rule.");
    return lines.join("\n");
}

/* The citations returned to the page: the clauses the answer cited, in
   the order they were retrieved, with their text so the page can show it. */
export function citationsFor(cited, clauses) {
    return clauses
        .filter(c => cited.some(no => citesGiven(no, [c.clause_no])))
        .map(c => ({
            clause_no: c.clause_no, title: c.title || "", form: c.form || c.doc_name,
            doc_name: c.doc_name, similarity: Math.round(c.similarity * 1000) / 1000, text: c.text
        }));
}

export function validRequest(body) {
    if (!body || typeof body !== "object") return "Body must be JSON.";
    if (typeof body.project_id !== "string" || !body.project_id) return "project_id is required.";
    if (typeof body.question !== "string" || !body.question.trim()) return "question is required.";
    if (body.question.length > MAX_QUESTION) return "question is too long (" + MAX_QUESTION + " characters at most).";
    return null;
}
