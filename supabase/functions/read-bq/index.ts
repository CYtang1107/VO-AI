// VO-AI | read-bq — read one page of a scanned or PDF priced BQ.
//
// POST { image }                  signed in (a team account), or
// POST { image, guest: true }     the offline demo, within the guest limits
//                                 shared with 「问合同」 (migration 0004)
//   → { rows: [{code, description, unit, qty, rate, amount}], model }
//   → { rows: null, reason: "format" | "guest-limit" }
//
// `image` is one page as a base64 JPEG, drawn and scaled in the browser
// (js/bqocr.js). Qwen-VL reads the table; the answer must be the JSON the
// prompt asks for, with every number readable (rules.mjs), else one retry
// naming the problem, then nothing. The rows are never imported here: the
// browser shows them in the same preview as a spreadsheet, the arithmetic
// check included, and the consultant confirms them first.
//
// Secrets: AI_API_KEY or DASHSCOPE_API_KEY. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { BQ_PROMPT, correction, parseBqRows, validBqRequest } from "./rules.mjs";

// The AI provider: any OpenAI-compatible address (AI_BASE_URL, e.g. Gemini's
// https://generativelanguage.googleapis.com/v1beta/openai) and its key
// (AI_API_KEY); DashScope international and DASHSCOPE_API_KEY by default.
const DASHSCOPE = (Deno.env.get("AI_BASE_URL") || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").trim().replace(/\/+$/, "");
const AI_KEY = Deno.env.get("AI_API_KEY") || Deno.env.get("DASHSCOPE_API_KEY");
const OCR_MODELS = (Deno.env.get("OCR_MODELS") || "qwen-vl-plus,qwen3-vl-flash")
    .split(",").map((s) => s.trim()).filter(Boolean);
const GUEST_PER_VISITOR = Number(Deno.env.get("GUEST_PER_VISITOR") || 20);
const GUEST_PER_DAY = Number(Deno.env.get("GUEST_PER_DAY") || 300);

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

type Message = { role: string; content: unknown };

async function vision(messages: Message[]): Promise<{ text: string; model: string }> {
    let last: Error | null = null;
    for (const model of OCR_MODELS) {
        try {
            const body: Record<string, unknown> = { model, messages, temperature: 0, max_tokens: 4000 };
            if (/^qwen3/.test(model)) body.enable_thinking = false;
            const res = await fetch(DASHSCOPE + "/chat/completions", {
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
            return { text: String(json.choices?.[0]?.message?.content || ""), model };
        } catch (e) {
            last = e as Error;
            const status = (e as Error & { status?: number }).status || 0;
            if (![400, 401, 403, 404, 429].includes(status)) break;
        }
    }
    throw last || new Error("No vision model configured");
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return reply({ error: "POST only" }, 405);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Body must be JSON." }, 400); }
    const invalid = validBqRequest(body);
    if (invalid) return reply({ error: invalid }, 400);

    if (body.guest === true) {
        const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
        const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
        const { data: allowed, error } = await db.rpc("guest_quota", { p_ip: ip, p_ip_limit: GUEST_PER_VISITOR, p_day_limit: GUEST_PER_DAY });
        if (error) return reply({ error: error.message }, 500);
        if (!allowed) return reply({ rows: null, reason: "guest-limit" }, 429);
    } else {
        const auth = req.headers.get("Authorization");
        if (!auth) return reply({ error: "Sign in first." }, 401);
        const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: auth } }, auth: { persistSession: false },
        });
        const { data: userData } = await db.auth.getUser();
        if (!userData?.user) return reply({ error: "Sign in first." }, 401);
    }

    const messages: Message[] = [{ role: "user", content: [
        { type: "image_url", image_url: { url: "data:image/jpeg;base64," + body.image } },
        { type: "text", text: BQ_PROMPT },
    ] }];
    try {
        let result = await vision(messages);
        let parsed = parseBqRows(result.text);
        if (parsed.problems.length) {
            messages.push({ role: "assistant", content: result.text });
            messages.push({ role: "user", content: correction(parsed.problems) });
            result = await vision(messages);
            parsed = parseBqRows(result.text);
        }
        if (parsed.problems.length) return reply({ rows: null, reason: "format" });
        return reply({ rows: parsed.rows, model: result.model });
    } catch (e) {
        return reply({ error: (e as Error).message || String(e) }, 502);
    }
});
