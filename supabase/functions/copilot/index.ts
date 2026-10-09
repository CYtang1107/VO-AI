// VO-AI | copilot — the project Copilot's general AI mode: any question
// about the project, answered from its data and its contract.
//
// POST { project_id, question, project_data }          a project member
// POST { project_id, question, project_data, guest: true, role }
//                                                      the demo, within the
//                                                      guest limits (migration 0004)
//   → { answer, citations: [...], model }
//   → { answer: null, reason: "amount-check" | "format" | "guest-limit" }
//
// project_data is the project as the page holds it (js/copilot.js
// projectData): the VOs, their status and the rule engine's figures. The
// question also retrieves the nearest contract clauses (as 「问合同」 does);
// none is needed for an answer. Qwen answers from those only; the answer is
// checked (rules.mjs): every amount must be in the data, the question or a
// clause, and a cited clause must be one given. One retry, then nothing.
//
// Secrets: AI_API_KEY or DASHSCOPE_API_KEY. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase (the service role only
// for the guest route, as in ask-contract).

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    citationsFor, copilotCorrection, copilotSystemPrompt, copilotUserPrompt, groupChunks, questionLang,
    reviewCopilotAnswer, validCopilotRequest,
} from "./rules.mjs";

// The AI provider: any OpenAI-compatible address (AI_BASE_URL, e.g. Gemini's
// https://generativelanguage.googleapis.com/v1beta/openai) and its key
// (AI_API_KEY); DashScope international and DASHSCOPE_API_KEY by default.
const DASHSCOPE = (Deno.env.get("AI_BASE_URL") || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").trim().replace(/\/+$/, "");
const AI_KEY = Deno.env.get("AI_API_KEY") || Deno.env.get("DASHSCOPE_API_KEY");
const GUEST_PROJECT = Deno.env.get("GUEST_PROJECT") || "PRJ-CADANGAN";
const EMBED_MODEL = Deno.env.get("EMBED_MODEL") || "text-embedding-v4";
const CHAT_MODELS = (Deno.env.get("COPILOT_MODELS") || Deno.env.get("ASK_MODELS") || "qwen-plus-latest,qwen-flash")
    .split(",").map((s) => s.trim()).filter(Boolean);
const MIN_SIMILARITY = 0.4;
const TOP_K = 4;

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

/* A demo visitor's own sandbox (migration 0008), as js/contractimport.js names it. */
const validSandbox = (v: unknown) => typeof v === "string" && /^GUEST-[a-f0-9]{16,40}$/.test(v);

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function dashscope(path: string, body: unknown) {
    const res = await fetch(DASHSCOPE + path, {
        method: "POST",
        headers: { "Authorization": "Bearer " + AI_KEY, "Content-Type": "application/json" },
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

type Message = { role: string; content: string };

async function chat(messages: Message[]): Promise<{ text: string; model: string }> {
    let last: Error | null = null;
    for (const model of CHAT_MODELS) {
        try {
            const body: Record<string, unknown> = { model, messages, temperature: 0.1, max_tokens: roomFor(model, 900) };
            if (/^qwen3/.test(model)) body.enable_thinking = false;
            const json = await dashscope("/chat/completions", body);
            return { text: String(json.choices?.[0]?.message?.content || "").trim(), model };
        } catch (e) {
            last = e as Error;
            const status = (e as Error & { status?: number }).status || 0;
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
    const invalid = validCopilotRequest(body);
    if (invalid) return reply({ error: invalid }, 400);
    const projectId = body.project_id as string;
    const question = (body.question as string).trim();
    const projectData = body.project_data as Record<string, unknown>;

    // deno-lint-ignore no-explicit-any
    let db: any;
    let role: string;
    /* the demo (no account) answers from the project data it sends, for
       any project, with no daily limit; the stored contract clauses it may
       read are the demo project's only */
    let kbProject: string | null = projectId;
    if (body.guest === true) {
        db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
        if (projectId !== GUEST_PROJECT) kbProject = null;
        role = typeof body.role === "string" ? body.role : "consultant";
    } else {
        const auth = req.headers.get("Authorization");
        if (!auth) return reply({ error: "Sign in first." }, 401);
        db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: auth } }, auth: { persistSession: false },
        });
        const { data: userData } = await db.auth.getUser();
        if (!userData?.user) return reply({ error: "Sign in first." }, 401);
        const { data: memberRole, error } = await db.rpc("member_role", { p_project: projectId });
        if (error) return reply({ error: error.message }, 500);
        if (!memberRole) return reply({ error: "You are not a member of this project." }, 403);
        role = memberRole;
    }

    try {
        /* the nearest clauses, if any are close enough: optional context */
        let clauses: Record<string, unknown>[] = [];
        if (kbProject) try {
            const emb = await dashscope("/embeddings", { model: EMBED_MODEL, input: [question], dimensions: 1024, encoding_format: "float" });
            const { data: rows } = await db.rpc("match_chunks", {
                p_project: kbProject, q: "[" + fit1024(emb.data[0].embedding).join(",") + "]", k: TOP_K, min_sim: MIN_SIMILARITY,
            });
            let found = rows || [];
            if (body.guest === true && validSandbox(body.sandbox)) {
                const { data: own } = await db.rpc("match_guest_chunks", {
                    p_sandbox: body.sandbox, q: "[" + fit1024(emb.data[0].embedding).join(",") + "]", k: TOP_K, min_sim: MIN_SIMILARITY,
                });
                found = found.concat(own || []).sort((a: { similarity: number }, b: { similarity: number }) => b.similarity - a.similarity).slice(0, TOP_K);
            }
            clauses = groupChunks(found);
        } catch { clauses = []; }

        const lang = questionLang(question);
        const messages: Message[] = [
            { role: "system", content: copilotSystemPrompt(role, lang) },
            { role: "user", content: copilotUserPrompt(question, projectData, clauses, lang) },
        ];
        let result = await chat(messages);
        let review = reviewCopilotAnswer(result.text, projectData, clauses, question);
        if (!review.ok) {
            messages.push({ role: "assistant", content: result.text });
            messages.push({ role: "user", content: copilotCorrection(review) });
            result = await chat(messages);
            review = reviewCopilotAnswer(result.text, projectData, clauses, question);
        }
        if (!review.ok) {
            return reply({ answer: null, reason: review.problems.includes("amount-check") ? "amount-check" : "format", citations: [] });
        }
        return reply({ answer: review.text, general: review.general, citations: citationsFor(review.cited, clauses), model: result.model });
    } catch (e) {
        return reply({ error: (e as Error).message || String(e) }, 502);
    }
});
