/* VO-AI | photo-check rules — what the photo agent may say. Pure
   functions, shared by the Edge Function (index.ts, Deno) and the Node
   tests (test/photocheck.test.js).

   Two modes:
   - "check": does each site photo show what the VO description says?
     One verdict per photo: match, mismatch or unclear, with what the
     photo shows and why.
   - "describe": a short draft description of the change from the photos,
     for the contractor to edit before saving.

   Checked on every answer, not only asked for in the prompt: no money and
   no quantities. A photo is evidence of what is on site; measurement and
   valuation stay with the contractor and the rule engine. */

export const MAX_IMAGES = 4;
export const MAX_IMAGE_CHARS = 700000;     // base64 of a ~500 KB JPEG
export const MAX_DESCRIPTION = 1000;
export const MAX_TEXT = 240;               // one "seen" / "reason" line
export const MAX_DRAFT = 400;
export const VERDICTS = ["match", "mismatch", "unclear"];

export function validPhotoRequest(body) {
    if (!body || typeof body !== "object") return "Body must be JSON.";
    if (typeof body.project_id !== "string" || !body.project_id) return "project_id is required.";
    if (body.mode !== "check" && body.mode !== "describe") return "mode must be check or describe.";
    const images = body.images;
    if (!Array.isArray(images) || images.length === 0) return "images are required.";
    if (images.length > MAX_IMAGES) return "At most " + MAX_IMAGES + " photos at a time.";
    for (const img of images) {
        if (!img || typeof img.id !== "string" || !img.id || img.id.length > 80) return "Each image needs an id.";
        if (typeof img.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(img.data)) return "Each image must be base64 JPEG data.";
        if (img.data.length > MAX_IMAGE_CHARS) return "A photo is too large.";
    }
    if (new Set(images.map((i) => i.id)).size !== images.length) return "Image ids must be different.";
    if (body.mode === "check") {
        if (typeof body.description !== "string" || !body.description.trim()) return "description is required to check photos.";
        if (body.description.length > MAX_DESCRIPTION) return "description is too long.";
    }
    return null;
}

export function replyLang(lang) {
    return lang === "zh" ? "zh" : "en";
}

const LANG_NAME = { zh: "Simplified Chinese", en: "English" };

const COMMON_RULES = [
    "Describe only what is visible. Do not guess what is outside the photo or hidden.",
    "Never state any amount of money, and never state a quantity (no areas, lengths, counts or volumes). Sizes printed on a product (e.g. 600x600mm) may be mentioned.",
    "A photo cannot prove an instruction was given; do not say whether the variation is valid.",
    "If a photo is too dark, blurred, or does not show the work clearly, say it is unclear."
];

export function checkPrompt(description, ids, lang) {
    const l = replyLang(lang);
    return [
        "You are checking site photos for a construction variation order (VO).",
        "The VO description says: \"" + String(description).trim() + "\"",
        "The photos are given in order, with these ids: " + ids.join(", ") + ".",
        "For EACH photo decide: \"match\" (it shows the work or area the description is about), \"mismatch\" (it clearly shows something else), or \"unclear\".",
        ...COMMON_RULES,
        "Write \"seen\" (what the photo shows) and \"reason\" (why that verdict) in " + LANG_NAME[l] + ", one short sentence each.",
        "Reply with JSON only, no other text, in exactly this shape:",
        "{\"results\":[{\"id\":\"<id>\",\"verdict\":\"match|mismatch|unclear\",\"seen\":\"...\",\"reason\":\"...\"}]}"
    ].join("\n");
}

export function describePrompt(ids, lang) {
    const l = replyLang(lang);
    return [
        "You are helping a contractor's quantity surveyor record a construction variation on site.",
        "From the " + ids.length + " site photo(s), write a draft description of the work or change shown: the element, the material or finish, and the area if it is evident.",
        ...COMMON_RULES,
        "Write it in " + LANG_NAME[l] + ", at most two short sentences, in the style of a VO description (e.g. \"Change of living area floor finish to marble tiles\").",
        "Reply with JSON only, no other text, in exactly this shape:",
        "{\"description\":\"...\"}"
    ].join("\n");
}

/* Money, or a number with a unit of quantity. "600x600mm" (a product
   size) and "Level 2" are not quantities. */
const MONEY = /(RM|MYR|令吉|\$)\s?\d|\d\s*(令吉|ringgit)/i;
const QUANTITY = /\d[\d,.]*\s*(m2|m²|m3|m³|sq\.?\s?m|square\s+met(er|re)s?|cubic|met(er|re)s?\b|m\b|nos\b|no\.\s|pcs\b|pieces?\b|units?\b|平方米|立方米|平米|米|件|块|个|片|根|张)/i;

export function hasQuantity(text) {
    const s = String(text || "");
    return MONEY.test(s) || QUANTITY.test(s);
}

function jsonIn(text) {
    const s = String(text || "").replace(/^```[a-z]*\s*|```\s*$/gi, "").trim();
    const start = s.indexOf("{"), end = s.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function clip(s, n) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/* The model's check answer, cleaned: one result per photo id asked about,
   in that order; anything missing or malformed reads as unclear. Returns
   {results, problems}; problems name a rule the answer broke. */
export function parseCheck(text, ids) {
    const json = jsonIn(text);
    const given = Array.isArray(json && json.results) ? json.results : null;
    const problems = [];
    if (!given) problems.push("format");
    const results = ids.map((id, i) => {
        const r = (given || []).find((x) => x && x.id === id) || (given && given.length === ids.length ? given[i] : null);
        if (!r) return { id, verdict: "unclear", seen: "", reason: "" };
        const verdict = VERDICTS.includes(r.verdict) ? r.verdict : "unclear";
        const seen = clip(r.seen, MAX_TEXT), reason = clip(r.reason, MAX_TEXT);
        if (hasQuantity(seen) || hasQuantity(reason)) problems.push("quantity");
        return { id, verdict, seen, reason };
    });
    return { results, problems: [...new Set(problems)] };
}

export function parseDescribe(text) {
    const json = jsonIn(text);
    const description = clip(json && json.description, MAX_DRAFT);
    const problems = [];
    if (!description) problems.push("format");
    if (hasQuantity(description)) problems.push("quantity");
    return { description, problems };
}

/* What the model is told when its first answer broke a rule. */
export function correction(problems) {
    const lines = ["Your previous answer broke the rules:"];
    if (problems.includes("format")) lines.push("- It was not the JSON shape asked for.");
    if (problems.includes("quantity")) lines.push("- It stated a quantity or an amount of money. Remove every area, length, count and amount.");
    lines.push("Answer again with JSON only, following every rule.");
    return lines.join("\n");
}
