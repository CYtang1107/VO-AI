// VO-AI | ask-contract — answers a question about the contract from the
// knowledge base, always citing the clauses it used (docs/rag-plan.md, step 3).
//
// POST { project_id, vo_id?, question, engine_facts? }
//      { …, guest: true, role } without an account: the demo project only,
//      20 questions a day per visitor and 300 for everyone (migration 0004)
//   → { answer, citations: [{clause_no, title, form, doc_name, similarity, text}], role, model }
//   → { answer: null, reason: "no-clause" | "no-citation" | "amount-check", citations: [] }
//
// 1. The caller must be signed in and a member of the project (their own JWT,
//    so row-level security applies to every query below).
// 2. The question is embedded (DashScope text-embedding-v4, 1024 dims, the
//    same model tools/ingest-contract.js used for the clauses).
// 3. match_chunks finds the nearest clauses above the similarity bar. None:
//    no answer at all; the agent never answers from general knowledge.
// 4. Qwen answers from those clauses only, framed for the caller's role, with
//    the rule engine's figures (engine_facts) as the only amounts it may use.
// 5. The answer is checked (rules.mjs): it must cite a given clause, cite
//    nothing else, and contain no amount the engine, question or clauses do
//    not. One retry with the broken rule named; then it is not shown.
//
// Secrets: AI_API_KEY or DASHSCOPE_API_KEY (supabase secrets). SUPABASE_URL and
// SUPABASE_ANON_KEY are provided by Supabase. The service-role key is not used.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    ROLE_FRAMING, MIN_SIMILARITY, TOP_K, correction, citationsFor, groupChunks, questionLang,
    reviewAnswer, systemPrompt, userPrompt, validRequest
} from "./rules.mjs";

// The AI provider: any OpenAI-compatible address (AI_BASE_URL, e.g. Gemini's
// https://generativelanguage.googleapis.com/v1beta/openai) and its key
// (AI_API_KEY); DashScope international and DASHSCOPE_API_KEY by default.
const DASHSCOPE = (Deno.env.get("AI_BASE_URL") || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").trim().replace(/\/+$/, "");
const AI_KEY = Deno.env.get("AI_API_KEY") || Deno.env.get("DASHSCOPE_API_KEY");
// 「评审一键体验」: questions without an account, for the demo project only
const GUEST_PROJECT = Deno.env.get("GUEST_PROJECT") || "PRJ-CADANGAN";
const GUEST_PER_VISITOR = Number(Deno.env.get("GUEST_PER_VISITOR") || 20);
const GUEST_PER_DAY = Number(Deno.env.get("GUEST_PER_DAY") || 300);
const EMBED_MODEL = Deno.env.get("EMBED_MODEL") || "text-embedding-v4";
// The first model that answers is used; a used-up free quota moves to the next.
const CHAT_MODELS = (Deno.env.get("ASK_MODELS") || "qwen-plus-latest,qwen-flash")
    .split(",").map((s) => s.trim()).filter(Boolean);

/* The stored vectors are 1024 numbers (migration 0001). A model that
   returns more (Gemini's gemini-embedding-001 gives 3072 when it ignores
   `dimensions`) is cut to its first 1024 and scaled back to length 1: its
   leading numbers carry the meaning (a "Matryoshka" embedding). */
function fit1024(v: number[]): number[] {
    if (v.length === 1024) return v;
    const cut = v.slice(0, 1024);
    const n = Math.sqrt(cut.reduce((s, x) => s + x * x, 0)) || 1;
    return cut.map((x) => x / n);
}

/* Gemini models think before they answer, and the thinking counts
   against max_tokens: they get room for both. */
const roomFor = (model: string, n: number) => /^gemini/i.test(model) ? Math.max(n, 8192) : n;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
    });
}

async function dashscope(path: string, body: unknown) {
    const res = await fetch(DASHSCOPE + path, {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + AI_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        // Gemini wraps its error in a list: [{ error: {…} }]
        const detail = (Array.isArray(json) ? json[0] : json)?.error?.message;
        const err = new Error(new URL(DASHSCOPE).host + " " + res.status + ": " + (detail || res.statusText));
        (err as Error & { status?: number }).status = res.status;
        throw err;
    }
    return json;
}

async function embed(text: string): Promise<number[]> {
    const json = await dashscope("/embeddings", {
        model: EMBED_MODEL, input: [text], dimensions: 1024, encoding_format: "float",
    });
    return fit1024(json.data[0].embedding);
}

type Message = { role: string; content: string };

async function chat(messages: Message[]): Promise<{ text: string; model: string }> {
    let last: Error | null = null;
    for (const model of CHAT_MODELS) {
        try {
            const body: Record<string, unknown> = { model, messages, temperature: 0.1, max_tokens: roomFor(model, 700) };
            if (/^qwen3/.test(model)) body.enable_thinking = false;
            const json = await dashscope("/chat/completions", body);
            return { text: String(json.choices?.[0]?.message?.content || "").trim(), model };
        } catch (e) {
            last = e as Error;
            const status = (e as Error & { status?: number }).status || 0;
            // quota, rate limit, unknown model: try the next one
            if (![400, 401, 403, 404, 429].includes(status)) break;
        }
    }
    throw last || new Error("No chat model configured");
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return reply({ error: "POST only" }, 405);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Body must be JSON." }, 400); }
    const invalid = validRequest(body);
    if (invalid) return reply({ error: invalid }, 400);
    const projectId = body.project_id as string;
    const question = (body.question as string).trim();
    const engineFacts = (body.engine_facts && typeof body.engine_facts === "object") ? body.engine_facts : {};

    // deno-lint-ignore no-explicit-any
    let db: any;
    let role: string;
    if (body.guest === true) {
        // 「评审一键体验」: the demo with no account. Only the demo project,
        // read with the service role, and only within the daily limits
        // (migration 0004). The role is the one picked in the demo.
        if (projectId !== GUEST_PROJECT) return reply({ error: "Sign in first." }, 401);
        db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
            auth: { persistSession: false },
        });
        const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
            req.headers.get("x-real-ip") || "unknown";
        const { data: allowed, error: quotaError } = await db.rpc("guest_quota", {
            p_ip: ip, p_ip_limit: GUEST_PER_VISITOR, p_day_limit: GUEST_PER_DAY,
        });
        if (quotaError) return reply({ error: quotaError.message }, 500);
        if (!allowed) return reply({ answer: null, reason: "guest-limit", citations: [] }, 429);
        role = ROLE_FRAMING[body.role as string] ? body.role as string : "consultant";
    } else {
        const auth = req.headers.get("Authorization");
        if (!auth) return reply({ error: "Sign in first." }, 401);
        db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: auth } },
            auth: { persistSession: false },
        });
        const { data: userData } = await db.auth.getUser();
        if (!userData?.user) return reply({ error: "Sign in first." }, 401);
        // The role comes from the membership, never from the request.
        const { data: memberRole, error: roleError } = await db.rpc("member_role", { p_project: projectId });
        if (roleError) return reply({ error: roleError.message }, 500);
        if (!memberRole) return reply({ error: "You are not a member of this project." }, 403);
        role = memberRole;
    }

    try {
        const vector = await embed(question);
        const { data: rows, error } = await db.rpc("match_chunks", {
            p_project: projectId, q: "[" + vector.join(",") + "]", k: TOP_K, min_sim: MIN_SIMILARITY,
        });
        if (error) return reply({ error: error.message }, 500);
        const clauses = groupChunks(rows || []);
        if (clauses.length === 0) return reply({ answer: null, reason: "no-clause", citations: [], role });

        const lang = questionLang(question);
        const messages: Message[] = [
            { role: "system", content: systemPrompt(role, lang) },
            { role: "user", content: userPrompt(question, clauses, engineFacts, lang) },
        ];
        let result = await chat(messages);
        let review = reviewAnswer(result.text, clauses, engineFacts, question);
        if (!review.ok) {
            messages.push({ role: "assistant", content: result.text });
            messages.push({ role: "user", content: correction(review, lang) });
            result = await chat(messages);
            review = reviewAnswer(result.text, clauses, engineFacts, question);
        }
        if (!review.ok) {
            const reason = review.problems.includes("amount-check") ? "amount-check" : "no-citation";
            /* which rule the answer broke, for whoever looks into it */
            return reply({ answer: null, reason, problems: review.problems, citations: [], role });
        }
        return reply({
            answer: result.text,
            citations: citationsFor(review.cited, clauses),
            role,
            model: result.model,
        });
    } catch (e) {
        return reply({ error: (e as Error).message || String(e) }, 502);
    }
});
