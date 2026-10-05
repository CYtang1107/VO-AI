// VO-AI | ask-contract — answers a question about the contract from the
// knowledge base, always citing the clauses it used (docs/rag-plan.md, step 3).
//
// POST { project_id, vo_id?, question, engine_facts? }
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
// Secrets: DASHSCOPE_API_KEY (supabase secrets). SUPABASE_URL and
// SUPABASE_ANON_KEY are provided by Supabase. The service-role key is not used.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    MIN_SIMILARITY, TOP_K, correction, citationsFor, groupChunks, questionLang,
    reviewAnswer, systemPrompt, userPrompt, validRequest
} from "./rules.mjs";

const DASHSCOPE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const EMBED_MODEL = "text-embedding-v4";
// The first model that answers is used; a used-up free quota moves to the next.
const CHAT_MODELS = (Deno.env.get("ASK_MODELS") || "qwen-plus-latest,qwen-flash")
    .split(",").map((s) => s.trim()).filter(Boolean);

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
            "Authorization": "Bearer " + Deno.env.get("DASHSCOPE_API_KEY"),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error("DashScope " + res.status + ": " + (json?.error?.message || res.statusText));
        (err as Error & { status?: number }).status = res.status;
        throw err;
    }
    return json;
}

async function embed(text: string): Promise<number[]> {
    const json = await dashscope("/embeddings", {
        model: EMBED_MODEL, input: [text], dimensions: 1024, encoding_format: "float",
    });
    return json.data[0].embedding;
}

type Message = { role: string; content: string };

async function chat(messages: Message[]): Promise<{ text: string; model: string }> {
    let last: Error | null = null;
    for (const model of CHAT_MODELS) {
        try {
            const body: Record<string, unknown> = { model, messages, temperature: 0.1, max_tokens: 700 };
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

    const auth = req.headers.get("Authorization");
    if (!auth) return reply({ error: "Sign in first." }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false },
    });
    const { data: userData } = await db.auth.getUser();
    if (!userData?.user) return reply({ error: "Sign in first." }, 401);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Body must be JSON." }, 400); }
    const invalid = validRequest(body);
    if (invalid) return reply({ error: invalid }, 400);
    const projectId = body.project_id as string;
    const question = (body.question as string).trim();
    const engineFacts = (body.engine_facts && typeof body.engine_facts === "object") ? body.engine_facts : {};

    // The role comes from the membership, never from the request.
    const { data: role, error: roleError } = await db.rpc("member_role", { p_project: projectId });
    if (roleError) return reply({ error: roleError.message }, 500);
    if (!role) return reply({ error: "You are not a member of this project." }, 403);

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
            return reply({ answer: null, reason, citations: [], role });
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
