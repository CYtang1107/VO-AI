/* VO-AI | ask-contract — a question about the contract, answered only from
   the clauses this project's knowledge base really holds
   (docs/rag-plan.md, step 3).

     POST { project_id?, vo_id?, role, question, engine_facts?, k?, min_sim? }
     ->   { answer, citations: [{clause_no, title, form, doc_name, text, similarity}] }
     or   { answer: null, reason: "no-clause" | "no-citation" | "amount" | "empty" }

   The caller's own JWT is used for the database, so row-level security
   decides which clauses they may see: a project's own contract only for
   its members, a shared standard form (project_id null) for any signed-in
   user. The DashScope key stays here; it never reaches the browser.

   Deploy:
     supabase functions deploy ask-contract --project-ref <ref>
     supabase secrets set DASHSCOPE_API_KEY=… --project-ref <ref>
   (SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform.)

   The rules the answer must obey, and the prompt itself, live in
   prompt.mjs so they can be unit-tested: test/ask-contract.test.js. */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildMessages, checkAnswer, citationsOf } from "./prompt.mjs";

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const EMBED_MODEL = "text-embedding-v4";
const EMBED_DIM = 1024;                                   /* the vector(1024) column */
const CHAT_MODEL = Deno.env.get("QWEN_MODEL") || "qwen3.7-plus";
const DEFAULT_K = 6;
const DEFAULT_MIN_SIM = 0.35;
const MAX_QUESTION = 500;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status, headers: { ...CORS, "Content-Type": "application/json" }
    });
}

async function embed(question: string): Promise<number[]> {
    const res = await fetch(DASHSCOPE_BASE + "/embeddings", {
        method: "POST",
        headers: {
            Authorization: "Bearer " + Deno.env.get("DASHSCOPE_API_KEY"),
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: EMBED_MODEL, input: [question],
            dimensions: EMBED_DIM, encoding_format: "float"
        })
    });
    const body = await res.json();
    if (!res.ok) throw new Error("embedding: " + (body?.error?.message || res.status));
    return body.data[0].embedding;
}

async function chat(messages: unknown[]): Promise<string> {
    const res = await fetch(DASHSCOPE_BASE + "/chat/completions", {
        method: "POST",
        headers: {
            Authorization: "Bearer " + Deno.env.get("DASHSCOPE_API_KEY"),
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: CHAT_MODEL, messages, temperature: 0.2, max_tokens: 700 })
    });
    const body = await res.json();
    if (!res.ok) throw new Error("chat: " + (body?.error?.message || res.status));
    return (body.choices?.[0]?.message?.content || "").trim();
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "sign in first" }, 401);

    let input: Record<string, unknown>;
    try { input = await req.json(); } catch { return json({ error: "bad request" }, 400); }

    const question = String(input.question ?? "").trim().slice(0, MAX_QUESTION);
    if (!question) return json({ error: "no question" }, 400);
    const projectId = input.project_id ? String(input.project_id) : null;
    const role = ["contractor", "consultant", "client"].includes(String(input.role))
        ? String(input.role) : "consultant";
    const k = Math.min(Math.max(Number(input.k) || DEFAULT_K, 1), 12);
    const minSim = Number.isFinite(Number(input.min_sim))
        ? Math.min(Math.max(Number(input.min_sim), 0), 1) : DEFAULT_MIN_SIM;

    const db = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
    );

    const { data: user, error: userError } = await db.auth.getUser();
    if (userError || !user?.user) return json({ error: "sign in first" }, 401);

    /* Membership: RLS already hides another project's rows, so an empty
       answer here is the same "no" — said plainly instead of as "no clause". */
    if (projectId) {
        const { data: member, error } = await db.from("members")
            .select("role").eq("project_id", projectId).eq("user_id", user.user.id).maybeSingle();
        if (error) return json({ error: error.message }, 400);
        if (!member) return json({ error: "not a member of this project" }, 403);
    }

    let clauses;
    try {
        const vector = await embed(question);
        const { data, error } = await db.rpc("match_chunks", {
            p_project: projectId, q: "[" + vector.join(",") + "]", k, min_sim: minSim
        });
        if (error) throw new Error(error.message);
        clauses = data || [];
    } catch (e) {
        return json({ error: String((e as Error).message || e) }, 502);
    }

    if (clauses.length === 0) return json({ answer: null, reason: "no-clause", citations: [] });

    const context = { clauses, facts: input.engine_facts, question };
    let text = "";
    let verdict: { ok: boolean; reason?: string; detail?: string } = { ok: false };
    try {
        for (let attempt = 0; attempt < 2 && !verdict.ok; attempt++) {
            text = await chat(buildMessages({
                question, role, clauses, facts: input.engine_facts,
                retry: attempt > 0 ? verdict.detail : null
            }));
            verdict = checkAnswer(text, context);
        }
    } catch (e) {
        return json({ error: String((e as Error).message || e) }, 502);
    }

    /* Twice rejected: the user gets the clauses, never the unchecked answer. */
    if (!verdict.ok) {
        return json({ answer: null, reason: verdict.reason, citations: citationsOf(clauses) });
    }
    return json({ answer: text, citations: citationsOf(clauses) });
});
