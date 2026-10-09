// VO-AI | import-contract — the 「导入合同到知识库」 button's server side
// (docs/rag-plan.md). The browser reads the contract and splits it into
// clauses (js/contractimport.js, js/kbsplit.js); this function does the
// two things that need a secret key:
//
// POST { action: "ocr", project_id, image }
//   → { text }            one scanned page (base64 JPEG) read by Qwen-VL
// POST { action: "chunks", project_id, doc_name, form, chunks, replace? }
//   → { inserted }        clauses embedded (text-embedding-v4, 1024 dims)
//                          and stored under this project only; replace
//                          clears that document's earlier import first
// POST { action: "remove", project_id, doc_name }
//   → { removed }
//
// Only the project's consultant may call it (their own JWT, role from
// members). Rows are written with the service role, because the browser
// may never write contract_chunks; each row carries the caller's project,
// so only that project's members can read it back.
//
// Secrets: AI_API_KEY or DASHSCOPE_API_KEY. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { OCR_PROMPT, chunkRows, embedText, validImportRequest } from "./checks.mjs";

// The AI provider: any OpenAI-compatible address (AI_BASE_URL, e.g. Gemini's
// https://generativelanguage.googleapis.com/v1beta/openai) and its key
// (AI_API_KEY); DashScope international and DASHSCOPE_API_KEY by default.
const DASHSCOPE = (Deno.env.get("AI_BASE_URL") || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").trim().replace(/\/+$/, "");
const AI_KEY = Deno.env.get("AI_API_KEY") || Deno.env.get("DASHSCOPE_API_KEY");
const EMBED_MODEL = Deno.env.get("EMBED_MODEL") || "text-embedding-v4";
const EMBED_BATCH = 10;
const OCR_MODELS = (Deno.env.get("OCR_MODELS") || "qwen-vl-plus,qwen3-vl-flash")
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

async function ocr(image: string): Promise<string> {
    let last: Error | null = null;
    for (const model of OCR_MODELS) {
        try {
            const json = await dashscope("/chat/completions", {
                model, temperature: 0, max_tokens: 4000,
                messages: [{ role: "user", content: [
                    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + image } },
                    { type: "text", text: OCR_PROMPT },
                ] }],
            });
            return String(json.choices?.[0]?.message?.content || "")
                .replace(/^```[a-z]*\n?|```\s*$/g, "").trim();
        } catch (e) {
            last = e as Error;
            const status = (e as Error & { status?: number }).status || 0;
            if (![400, 401, 403, 404, 429].includes(status)) break;
        }
    }
    throw last || new Error("No OCR model configured");
}

async function embed(texts: string[]): Promise<number[][]> {
    const json = await dashscope("/embeddings", {
        model: EMBED_MODEL, input: texts, dimensions: 1024, encoding_format: "float",
    });
    return json.data.sort((a: { index: number }, b: { index: number }) => a.index - b.index)
        .map((d: { embedding: number[] }) => fit1024(d.embedding));
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return reply({ error: "POST only" }, 405);

    const auth = req.headers.get("Authorization");
    if (!auth) return reply({ error: "Sign in first." }, 401);
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false },
    });
    const { data: userData } = await asUser.auth.getUser();
    if (!userData?.user) return reply({ error: "Sign in first." }, 401);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Body must be JSON." }, 400); }
    const invalid = validImportRequest(body);
    if (invalid) return reply({ error: invalid }, 400);
    const projectId = body.project_id as string;

    const { data: role, error: roleError } = await asUser.rpc("member_role", { p_project: projectId });
    if (roleError) return reply({ error: roleError.message }, 500);
    if (role !== "consultant") {
        return reply({ error: "Only the project's consultant can import a contract." }, 403);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false },
    });

    try {
        if (body.action === "ocr") {
            return reply({ text: await ocr(body.image as string) });
        }

        const docName = (body.doc_name as string).trim();
        if (body.action === "remove") {
            const { error, count } = await admin.from("contract_chunks")
                .delete({ count: "exact" }).eq("project_id", projectId).eq("doc_name", docName);
            if (error) return reply({ error: error.message }, 500);
            return reply({ removed: count || 0 });
        }

        // action "chunks"
        const form = (body.form as string).trim();
        const chunks = body.chunks as { no: string; title?: string; part?: number; text: string }[];
        const vectors: number[][] = [];
        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
            const batch = chunks.slice(i, i + EMBED_BATCH);
            vectors.push(...await embed(batch.map((c) => embedText(form, c))));
        }
        if (body.replace === true) {
            const { error } = await admin.from("contract_chunks")
                .delete().eq("project_id", projectId).eq("doc_name", docName);
            if (error) return reply({ error: error.message }, 500);
        }
        const { error } = await admin.from("contract_chunks")
            .insert(chunkRows(projectId, docName, form, chunks, vectors));
        if (error) return reply({ error: error.message }, 500);
        return reply({ inserted: chunks.length });
    } catch (e) {
        return reply({ error: (e as Error).message || String(e) }, 502);
    }
});
