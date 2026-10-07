// VO-AI | read-bq/rules.mjs — the prompt for reading a priced BQ page, and
// the check its answer must pass. Plain ES module: Deno and the Node tests.

export const MAX_IMAGE_CHARS = 2_800_000;   // base64 of a ~2 MB JPEG

export function validBqRequest(body) {
    if (!body || typeof body !== "object") return "Body must be a JSON object.";
    const img = body.image;
    if (typeof img !== "string" || !img) return "image (a base64 JPEG) is required.";
    if (/^data:/.test(img)) return "image must be bare base64, without the data: prefix.";
    if (img.length > MAX_IMAGE_CHARS) return "image is too large: scale the page down first.";
    return null;
}

export const BQ_PROMPT =
    "This image is one page of a priced Bills of Quantities (BQ) for a building contract in Malaysia. " +
    "Read its table. Return JSON only, no prose and no code fence:\n" +
    '{"rows":[{"code":"B/4.1","description":"...","unit":"m2","qty":320,"rate":85.00,"amount":27200.00}]}\n' +
    "Rules:\n" +
    "- One object per priced item, in the order printed. Copy the item code, description and unit exactly as printed.\n" +
    "- qty, rate and amount are numbers as printed (no RM, no commas). Use null for a cell that is empty or that you cannot read.\n" +
    "- Never calculate, estimate or fill in a number that is not printed on the page.\n" +
    "- A description that continues on the next line belongs to the same item: join it.\n" +
    "- Leave out section headings, page totals, 'carried to collection' and 'brought forward' lines.\n" +
    '- If the page has no priced items, return {"rows":[]}.';

function num(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/^RM\s*/i, "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : NaN;
}

// The answer as rows, or the problems that make it unusable. A row with
// a number that does not read is a problem; a row without a rate is kept
// (the browser preview reports it as having no rate).
export function parseBqRows(text) {
    const problems = [];
    let json = null;
    const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { json = JSON.parse(raw); } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) { try { json = JSON.parse(m[0]); } catch { /* below */ } }
    }
    if (!json || !Array.isArray(json.rows)) return { rows: [], problems: ["format"] };
    const rows = [];
    json.rows.forEach((r) => {
        if (!r || typeof r !== "object") return;
        const description = String(r.description ?? "").replace(/\s+/g, " ").trim();
        if (!description) return;
        const qty = num(r.qty), rate = num(r.rate), amount = num(r.amount);
        if ([qty, rate, amount].some((n) => Number.isNaN(n))) { problems.push("number"); return; }
        rows.push({ code: String(r.code ?? "").trim(), description, unit: String(r.unit ?? "").trim(), qty, rate, amount });
    });
    return { rows, problems: Array.from(new Set(problems)) };
}

export function correction(problems) {
    return "Your answer could not be used (" + problems.join(", ") + "). Answer again with JSON only, exactly " +
        'in the form {"rows":[{"code":"","description":"","unit":"","qty":0,"rate":0,"amount":0}]}, ' +
        "numbers as plain numbers or null.";
}
