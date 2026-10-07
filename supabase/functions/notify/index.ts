// VO-AI | notify — email whoever's turn a VO now is.
//
// POST { project_id, vo_id }   (a project member, signed in)
//   → { sent: n, step } | { sent: 0, reason: "no-step" | "already-sent" | "no-recipients" | "email-off" }
//
// The browser calls it after a change that moves a VO on (js/notify.js
// announceStep): submitted, instruction issued or returned, valued,
// certified. The server works out the step itself from the stored VO
// (rules.mjs), so a caller cannot make it email anyone else, and sends one
// email per step (notify_log, migration 0005) to the project's members with
// that role, other than the caller.
//
// Secrets: RESEND_API_KEY and NOTIFY_FROM (e.g. "VO-AI <notify@your-domain>")
// turn email on; without them it answers "email-off" and the in-app
// notifications carry on. APP_URL is the link target (default: the live
// GitHub Pages site). SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { emailFor, nextStep } from "./rules.mjs";

const APP_URL = Deno.env.get("APP_URL") || "https://cytang1107.github.io/VO-AI";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return reply({ error: "POST only" }, 405);
    let body: { project_id?: string; vo_id?: string };
    try { body = await req.json(); } catch { return reply({ error: "JSON body required" }, 400); }
    if (!body.project_id || !body.vo_id) return reply({ error: "project_id and vo_id are required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: auth } = await user.auth.getUser();
    if (!auth?.user) return reply({ error: "Sign in with a team account" }, 401);

    // a member of the project reads the VO through row-level security
    const { data: row } = await user.from("vos").select("data")
        .eq("project_id", body.project_id).eq("id", body.vo_id).maybeSingle();
    if (!row) return reply({ error: "No such VO in a project you are on" }, 403);
    const vo = row.data;
    const step = nextStep(vo);
    if (!step) return reply({ sent: 0, reason: "no-step" });

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: logged } = await admin.from("notify_log").select("step_key")
        .eq("project_id", body.project_id).eq("step_key", step.key).maybeSingle();
    if (logged) return reply({ sent: 0, reason: "already-sent", step: step.id });

    const { data: people } = await admin.from("members").select("email, user_id")
        .eq("project_id", body.project_id).eq("role", step.role);
    const to = (people || []).filter((p) => p.email && p.user_id !== auth.user.id).map((p) => p.email as string);
    if (!to.length) return reply({ sent: 0, reason: "no-recipients", step: step.id });

    const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("NOTIFY_FROM");
    if (!key || !from) return reply({ sent: 0, reason: "email-off", step: step.id, recipients: to.length });

    const { data: project } = await admin.from("projects").select("id, name").eq("id", body.project_id).maybeSingle();
    const mail = emailFor(step, vo, { id: body.project_id, name: project?.name || "" }, APP_URL);
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: mail.subject, html: mail.html }),
    });
    if (!res.ok) return reply({ error: "Email service: " + res.status + " " + (await res.text()).slice(0, 200) }, 502);
    await admin.from("notify_log").insert({ project_id: body.project_id, vo_id: body.vo_id, step_key: step.key, sent_to: to.length });
    return reply({ sent: to.length, step: step.id });
});
