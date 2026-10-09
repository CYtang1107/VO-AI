// VO-AI | photo-check — AI looks at a VO's site photos.
//
// POST { project_id, mode: "check", description, images: [{id, data}], lang? }
//   → { results: [{id, verdict: "match"|"mismatch"|"unclear", seen, reason}], model }
// POST { project_id, mode: "describe", images: [{id, data}], lang? }
//   → { description, model }
//      { …, guest: true } without an account: the demo project only, no
//      daily limit
//   → { results: null | description: null, reason: "quantity-check" | "format" }
//
// `data` is a base64 JPEG the browser has already scaled down (at most 4
// photos a call). Any member of the project may ask, whatever their role:
// the contractor drafts and checks before submitting, the contract
// administrator and the consultant check what was submitted.
//
// The answer is checked (rules.mjs): the right JSON, and no money or
// quantities — a photo is evidence of what is on site, never a
// measurement. One retry with the broken rule named; then nothing is shown.
//
// Secrets: VISION_API_KEY, AI_API_KEY or DASHSCOPE_API_KEY. SUPABASE_URL and SUPABASE_ANON_KEY are
// provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    checkPrompt, correction, describePrompt, parseCheck, parseDescribe, validPhotoRequest,
} from "./rules.mjs";

// The vision models may live elsewhere than the text models: VISION_BASE_URL
// and VISION_API_KEY (e.g. Qwen Cloud), else AI_BASE_URL and
// DASHSCOPE_API_KEY, else DashScope international.
const DASHSCOPE = (Deno.env.get("VISION_BASE_URL") || Deno.env.get("AI_BASE_URL") ||
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").trim().replace(/\/+$/, "");
const VISION_KEY = Deno.env.get("VISION_API_KEY") || Deno.env.get("AI_API_KEY") || Deno.env.get("DASHSCOPE_API_KEY");
const VISION_MODELS = (Deno.env.get("VISION_MODELS") || "qwen-vl-plus,qwen3-vl-flash")
    .split(",").map((s) => s.trim()).filter(Boolean);
const GUEST_PROJECT = Deno.env.get("GUEST_PROJECT") || "PRJ-CADANGAN";

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

type Content = { type: string; text?: string; image_url?: { url: string } };
type Message = { role: string; content: string | Content[] };

async function vision(messages: Message[]): Promise<{ text: string; model: string }> {
    let last: Error | null = null;
    const tried: string[] = [];
    for (const model of VISION_MODELS) {
        try {
            const body: Record<string, unknown> = { model, messages, temperature: 0.1, max_tokens: roomFor(model, 800) };
            if (/^qwen3/.test(model)) body.enable_thinking = false;
            const res = await fetch(DASHSCOPE + "/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + VISION_KEY,
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
            return { text: String(json.choices?.[0]?.message?.content || ""), model };
        } catch (e) {
            last = e as Error;
            tried.push(model + ": " + last.message);
            const status = (e as Error & { status?: number }).status || 0;
            // quota, rate limit, unknown model: try the next one
            if (![400, 401, 403, 404, 429].includes(status)) break;
        }
    }
    // every model's refusal, so a wrong key or an empty quota can be told apart
    if (tried.length > 1) throw new Error(tried.join(" | "));
    throw last || new Error("No vision model configured");
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return reply({ error: "POST only" }, 405);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Body must be JSON." }, 400); }
    const invalid = validPhotoRequest(body);
    if (invalid) return reply({ error: invalid }, 400);
    const projectId = body.project_id as string;
    const mode = body.mode as string;
    const images = body.images as { id: string; data: string }[];
    const ids = images.map((i) => i.id);
    const lang = body.lang === "zh" ? "zh" : "en";
    const empty = mode === "check" ? { results: null } : { description: null };

    if (body.guest === true) {
        // The demo project only, with no daily limit: photo checks do not
        // count towards the guest quota of 「问合同」 (migration 0004).
        if (projectId !== GUEST_PROJECT) return reply({ error: "Sign in first." }, 401);
    } else {
        const auth = req.headers.get("Authorization");
        if (!auth) return reply({ error: "Sign in first." }, 401);
        const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: auth } },
            auth: { persistSession: false },
        });
        const { data: userData } = await db.auth.getUser();
        if (!userData?.user) return reply({ error: "Sign in first." }, 401);
        const { data: role, error } = await db.rpc("member_role", { p_project: projectId });
        if (error) return reply({ error: error.message }, 500);
        if (!role) return reply({ error: "You are not a member of this project." }, 403);
    }

    const prompt = mode === "check" ? checkPrompt(body.description as string, ids, lang) : describePrompt(ids, lang);
    const content: Content[] = [];
    images.forEach((img) => {
        content.push({ type: "text", text: "Photo id: " + img.id });
        content.push({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + img.data } });
    });
    content.push({ type: "text", text: prompt });
    const messages: Message[] = [{ role: "user", content }];

    try {
        let result = await vision(messages);
        let parsed = mode === "check" ? parseCheck(result.text, ids) : parseDescribe(result.text);
        if (parsed.problems.length) {
            messages.push({ role: "assistant", content: result.text });
            messages.push({ role: "user", content: correction(parsed.problems) });
            result = await vision(messages);
            parsed = mode === "check" ? parseCheck(result.text, ids) : parseDescribe(result.text);
        }
        if (parsed.problems.length) {
            const reason = parsed.problems.includes("quantity") ? "quantity-check" : "format";
            return reply({ ...empty, reason });
        }
        return reply(mode === "check"
            ? { results: (parsed as { results: unknown[] }).results, model: result.model }
            : { description: (parsed as { description: string }).description, model: result.model });
    } catch (e) {
        return reply({ error: (e as Error).message || String(e) }, 502);
    }
});
