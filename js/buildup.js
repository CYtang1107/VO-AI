/* VO-AI | buildup.js — the cost planning agent's built-up rate.

   A VO row with no comparable item in the contract BQ is valued at a fair
   market rate (PAM 2018 cl. 11.6(c)). The fair rate is built up the way a
   QS does it, per unit of the row:
       materials (quantity × price, plus waste)
     + labour    (hours × hourly rate)
     + plant     (hours × hourly hire rate)
     = net cost, + overhead and profit (15 % by default: the percentage
       PAM 2018 cl. 11.6(d)(ii) allows on daywork)
     = the rate.
   Each price says where it came from:
     - "priceList": the contractor's own price list for the project
       (project.priceList: their supplier quotations and wage rates), first;
     - "reference": the bundled REFERENCE_PRICES, indicative Klang Valley
       2026 figures adjusted by region. They are a starting point for the
       demo, not market data: check them against CIDB's published material
       prices for the state and against supplier quotations.
   suggestBuildUp() drafts a build-up from the row's description (marble
   floor tiles → tiles, adhesive, grout; a tiler and a helper; a tile
   cutter). Everything is editable, and nothing is used until a person
   chooses "use this rate".

   rentOrBuy() compares hiring a piece of plant with buying it for the time
   it is needed. Pure functions; the VO page renders the card. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
    var { rm } = require("./calc.js");
    var { escapeHtml, fold, seedText } = require("./ui.js");
    var { renderSuppliers } = require("./suppliers.js");
}

/* a labour or plant hour, in the interface's language (m, m2, no stay) */
function unitLabel(unit) {
    return unit === "hr" ? t("buildup.unitHr") : unit === "day" ? t("buildup.unitDay") : String(unit || "");
}

/* Regions and their price level against the Klang Valley. */
var REGIONS = [
    { id: "klang",    factor: 1.00, words: /kuala lumpur|selangor|putrajaya|klang|petaling|shah alam|cheras|subang|cyberjaya|kajang|ampang/i },
    { id: "north",    factor: 0.96, words: /penang|pulau pinang|kedah|perak|perlis|ipoh|alor setar|georgetown|george town/i },
    { id: "south",    factor: 0.98, words: /johor|melaka|malacca|negeri sembilan|seremban|johor bahru|iskandar/i },
    { id: "east",     factor: 0.95, words: /pahang|terengganu|kelantan|kuantan|kota bharu|kuala terengganu/i },
    { id: "sabah",    factor: 1.12, words: /sabah|kota kinabalu|sandakan|tawau/i },
    { id: "sarawak",  factor: 1.08, words: /sarawak|kuching|miri|sibu|bintulu/i }
];

function regionOf(project) {
    const id = project && project.region;
    const set = REGIONS.find(r => r.id === id);
    if (set) return { id: set.id, factor: set.factor, from: "set" };
    const address = (project && project.site && project.site.address) || "";
    const hit = REGIONS.find(r => r.words.test(address));
    return hit ? { id: hit.id, factor: hit.factor, from: "address" } : { id: "klang", factor: 1, from: "default" };
}

/* Indicative Klang Valley 2026 prices (RM). Labour and plant are by the
   day (a gang's day rate ÷ what it does in a day, the way a QS builds a
   rate up); plant may burn fuel (litres a day) and oil (RM a year).
   `buy` is a plant item's purchase price, for rent or buy.
   Cement RM 30 a 50 kg bag at 1,440 kg/m³ ≈ RM 870/m³; sand RM 85 a tonne
   at 0.59 m³/t ≈ RM 145/m³. */
var REFERENCE_PRICES = [
    { id: "marble-tile",   kind: "material", unit: "m2",  price: 180,  words: ["marble", "tile"] },
    { id: "homog-tile",    kind: "material", unit: "m2",  price: 55,   words: ["homogeneous", "tile"] },
    { id: "ceramic-tile",  kind: "material", unit: "m2",  price: 32,   words: ["ceramic", "tile"] },
    { id: "adhesive",      kind: "material", unit: "m2",  price: 6.5,  words: ["adhesive"] },
    { id: "grout",         kind: "material", unit: "m2",  price: 2,    words: ["grout"] },
    { id: "marble-skirt",  kind: "material", unit: "m",   price: 25,   words: ["marble", "skirting"] },
    { id: "tile-skirt",    kind: "material", unit: "m",   price: 9,    words: ["skirting"] },
    { id: "cement",        kind: "material", unit: "m3",  price: 870,  words: ["cement"] },
    { id: "sand",          kind: "material", unit: "m3",  price: 145,  words: ["sand"] },
    { id: "upvc-150",      kind: "material", unit: "m",   price: 38,   words: ["upvc", "pipe"] },
    { id: "precast-sump",  kind: "material", unit: "no",  price: 450,  words: ["precast", "sump"] },
    { id: "concrete-g25",  kind: "material", unit: "m3",  price: 260,  words: ["concrete"] },
    { id: "rebar",         kind: "material", unit: "kg",  price: 3.3,  words: ["rebar", "reinforcement"] },
    { id: "gypsum-board",  kind: "material", unit: "m2",  price: 18,   words: ["gypsum", "board"] },
    { id: "cove-cornice",  kind: "material", unit: "m",   price: 14,   words: ["cove", "cornice"] },
    { id: "emulsion",      kind: "material", unit: "m2",  price: 4.5,  words: ["paint", "emulsion"] },
    { id: "skilled",       kind: "labour",   unit: "day", price: 120,  words: ["skilled", "worker"] },
    { id: "tiler",         kind: "labour",   unit: "day", price: 130,  words: ["tiler"] },
    { id: "general",       kind: "labour",   unit: "day", price: 85,   words: ["general", "worker"] },
    { id: "plumber",       kind: "labour",   unit: "day", price: 140,  words: ["plumber"] },
    { id: "carpenter",     kind: "labour",   unit: "day", price: 130,  words: ["carpenter"] },
    { id: "ceiling-fixer", kind: "labour",   unit: "day", price: 130,  words: ["ceiling", "fixer"] },
    { id: "painter",       kind: "labour",   unit: "day", price: 110,  words: ["painter"] },
    { id: "concretor",     kind: "labour",   unit: "day", price: 120,  words: ["concretor"] },
    { id: "backhoe",       kind: "plant",    unit: "day", price: 475,  fuel: 70, oilYear: 2800, buy: 250000, words: ["backhoe"] },
    { id: "lorry-3t",      kind: "plant",    unit: "day", price: 575,  buy: 120000, words: ["lorry"] },
    { id: "diesel",        kind: "plant",    unit: "L",   price: 4.72, words: ["diesel"] },
    { id: "tools",         kind: "plant",    unit: "day", price: 100,  words: ["tools"] },
    { id: "tile-cutter",   kind: "plant",    unit: "day", price: 50,   buy: 2800,   words: ["tile", "cutter"] },
    { id: "plate-compactor",kind: "plant",   unit: "day", price: 80,   fuel: 3, buy: 4500, words: ["compactor"] },
    { id: "poker-vibrator",kind: "plant",    unit: "day", price: 60,   fuel: 2, buy: 1500, words: ["vibrator"] },
    { id: "scaffold-tower",kind: "plant",    unit: "day", price: 30,   buy: 3500,   words: ["scaffold"] }
];

/* What a unit of each kind of work takes. Materials: [reference id,
   quantity per unit of the row, waste]. Labour and plant: [reference id,
   how many, output per day in the row's unit]. perUnit: plant used by
   the unit of the row ([id, quantity], e.g. the lorry's diesel a metre).
   mortar: a cement:sand mix (parts of a m³), laid `thickness` thick (from
   the description's "12mm", else the default). delivery: % on the
   materials; ohp: profit %; roundTo: the rate is rounded up to it.
   The first recipe whose words the description has is used. */
var RECIPES = [
    { id: "marbleFloor",  words: /marble/i, unit: /m2|m²/i, material: [["marble-tile", 1, 0.05], ["adhesive", 1, 0], ["grout", 1, 0]],
      labour: [["tiler", 1, 8], ["general", 1, 16]], plant: [["tile-cutter", 1, 8]] },
    { id: "marbleSkirting", words: /marble.*skirting|skirting.*marble|大理石踢脚/i, unit: /^m$/i, material: [["marble-skirt", 1, 0.05], ["adhesive", 0.15, 0]],
      labour: [["tiler", 1, 30]], plant: [["tile-cutter", 1, 60]] },
    { id: "skirting",     words: /skirting|踢脚/i, unit: /^m$/i, material: [["tile-skirt", 1, 0.05], ["adhesive", 0.15, 0]],
      labour: [["tiler", 1, 35]], plant: [["tile-cutter", 1, 70]] },
    { id: "screed",       words: /screed|turapan simen|\bplaster(ing)?\b|\brender|找平|抹灰|批荡/i, unit: /m2|m²/i,
      mortar: { mix: [["cement", 0.2], ["sand", 0.8]], thickness: 12, waste: 0.3 }, delivery: 10, ohp: 20,
      labour: [["skilled", 2, 10]], plant: [["tools", 1, 10]] },
    { id: "tileFloor",    words: /tile|瓷砖|地砖/i, unit: /m2|m²/i, material: [["homog-tile", 1, 0.05], ["adhesive", 1, 0], ["grout", 1, 0]],
      labour: [["tiler", 1, 10], ["general", 1, 20]], plant: [["tile-cutter", 1, 10]] },
    { id: "pipe",         words: /pipe|upvc|管/i, unit: /^m$/i, material: [["upvc-150", 1, 0.03], ["sand", 0.05, 0.1]],
      labour: [["plumber", 1, 30], ["general", 2, 36]], plant: [["backhoe", 1, 36]] },
    { id: "excavation",   words: /excavat|trench|korek|drain|开挖|挖|沟/i, unit: /^m$/i, material: [], ohp: 10, roundTo: 5,
      labour: [["general", 2, 36]], plant: [["backhoe", 1, 36], ["lorry-3t", 1, 36]], perUnit: [["diesel", 0.16]] },
    { id: "sump",         words: /sump|manhole|集水井|沙井/i, unit: /no|nr|each|unit/i, material: [["precast-sump", 1, 0], ["concrete-g25", 0.1, 0.05]],
      labour: [["general", 2, 2], ["plumber", 1, 4]], plant: [["backhoe", 1, 6]] },
    { id: "ceiling",      words: /ceiling|cove|gypsum|cornice|天花|吊顶/i, unit: /.*/, material: [["gypsum-board", 1, 0.08], ["cove-cornice", 0.4, 0.05]],
      labour: [["ceiling-fixer", 1, 12]], plant: [["scaffold-tower", 1, 20]] },
    { id: "concrete",     words: /concrete|混凝土/i, unit: /m3|m³/i, material: [["concrete-g25", 1, 0.03]],
      labour: [["concretor", 2, 8], ["general", 3, 8]], plant: [["poker-vibrator", 1, 15]] },
    { id: "paint",        words: /paint|emulsion|油漆|涂料/i, unit: /m2|m²/i, material: [["emulsion", 1, 0.05]],
      labour: [["painter", 1, 60]], plant: [] }
];

function words(text) {
    return String(text || "").toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(w => w.length > 2);
}

/* The contractor's own price for a reference item: a price-list entry
   whose name has every one of the item's words (and the same unit). */
function priceListMatch(priceList, ref) {
    return (priceList || []).find(p => {
        const have = words(p.name);
        return ref.words.every(w => have.some(h => h.indexOf(w) === 0)) &&
               (!p.unit || !ref.unit || String(p.unit).toLowerCase() === ref.unit.toLowerCase());
    }) || null;
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* A reference item's price: the price list first, else the reference
   price for the region (fuel is one price nationwide). */
function priceOf(refId, project) {
    const ref = REFERENCE_PRICES.find(r => r.id === refId);
    const own = priceListMatch(project && project.priceList, ref);
    const factor = refId === "diesel" ? 1 : regionOf(project).factor;
    return { ref: ref, own: own, price: own ? round2(own.price) : round2(ref.price * factor) };
}

/* ---------- the build-up: four sections, each a list of lines ----------
   Materials, machinery, labour, profit — in that order, then the rate.
   Each section works down its lines with a running subtotal, the way the
   QS's sheet does:
     item  quantity × price                (a material; diesel a metre)
     day   how many × (the day rate + its sub-items a day) ÷ output a day
           sub-items: quantity × price a day, or a year (÷ 365): diesel, oil
     pct   a percentage of the subtotal so far (delivery, wastage,
           shrinkage; profit, overhead)
     hr    how many × the day rate ÷ 8 hours × the hours a unit takes
           (the team's sheets: "120/8 × 1.15 hr"); `of`: the unit the
           hours are for, when not the row's (a tonne of bar)
     unit  the subtotal so far × a factor (÷ `per`, when it has one): into
           the row's unit (a mortar priced per m³ × 0.012 m thick = per m²;
           a tonne × 0.001 = per kg; plywood ÷ 3 uses)
   Profit's lines start from the net cost (materials + machinery + labour).
   The rate is the net cost plus profit, rounded up to `roundTo`. */
var SECTIONS = ["material", "machinery", "labour", "profit"];
var HOURS_A_DAY = 8;

/* what each section's "+ add" offers: format:preset */
var ADD_FORMATS = {
    material:  ["item:material", "pct:wastage", "pct:shrinkage", "pct:delivery", "unit:unit", "pct:percent"],
    machinery: ["day:machine", "item:perUnit", "pct:percent", "unit:unit"],
    labour:    ["day:labour", "hr:labour", "item:perUnit", "pct:percent", "unit:unit"],
    profit:    ["pct:profit", "pct:overhead", "item:lump"]
};
var SUB_FORMATS = ["diesel", "oil", "other"];

function newLine(code) {
    const parts = String(code || "").split(":"), format = parts[0], preset = parts[1] || "";
    if (format === "pct") {
        const pct = { wastage: 5, shrinkage: 5, delivery: 10, profit: 15, overhead: 5 }[preset] || 0;
        return { type: "pct", name: t("buildup.preset." + preset), pct: pct };
    }
    if (format === "unit") return { type: "unit", name: t("buildup.preset.unit"), factor: 1, from: "", to: "" };
    if (format === "day") return { type: "day", name: "", nos: 1, price: 0, output: 1, subs: [], source: "manual" };
    if (format === "hr") return { type: "hr", name: "", nos: 1, price: 0, hrs: 1, source: "manual" };
    return { type: "item", name: "", qty: 1, unit: "", price: 0, source: "manual" };
}

function newSub(kind) {
    if (kind === "diesel") return { name: t("buildup.sub.diesel"), qty: 0, unit: "L", price: 4.72, per: "day" };
    if (kind === "oil") return { name: t("buildup.sub.oil"), qty: 1, unit: "", price: 0, per: "year" };
    return { name: "", qty: 1, unit: "", price: 0, per: "day" };
}

const num0 = v => Number(v) || 0;

/* a sub-item's cost a day */
function subPerDay(sb) {
    const v = num0(sb.qty) * num0(sb.price);
    return sb.per === "year" ? v / 365 : v;
}

/* what a line adds to its section, given the subtotal before it */
function lineAmount(line, running) {
    if (!line) return 0;
    if (line.type === "pct") return running * num0(line.pct) / 100;
    if (line.type === "unit") return running * (num0(line.factor) / (num0(line.per) > 0 ? num0(line.per) : 1) - 1);
    if (line.type === "hr") return (line.nos === undefined || line.nos === "" ? 1 : num0(line.nos)) * num0(line.price) / HOURS_A_DAY * num0(line.hrs);
    if (line.type === "day") {
        if (!(num0(line.output) > 0)) return 0;
        const perDay = num0(line.price) + (line.subs || []).reduce((s, sb) => s + subPerDay(sb), 0);
        return (line.nos === undefined || line.nos === "" ? 1 : num0(line.nos)) * perDay / num0(line.output);
    }
    return num0(line.qty) * num0(line.price);
}

/* a section's lines with the subtotal before and after each */
function runSection(lines, start) {
    let running = start || 0;
    const rows = (lines || []).map(line => {
        const before = running, amount = lineAmount(line, running);
        running += amount;
        return { before: before, amount: amount, after: running };
    });
    return { rows: rows, end: running };
}

/* A build-up written before the sections (a list of items): the same
   figures, in sections. */
function asSections(b) {
    if (b && b.sections) return b;
    const items = (b && b.items) || [];
    const out = { sections: { material: [], machinery: [], labour: [], profit: [] }, roundTo: b && b.roundTo !== undefined ? b.roundTo : 0 };
    items.forEach(it => {
        const sec = it.kind === "material" ? "material" : it.kind === "labour" ? "labour" : "machinery";
        if (num0(it.output) > 0) {
            const subs = [];
            if (it.fuel !== undefined) subs.push({ name: t("buildup.sub.diesel"), qty: num0(it.fuel), unit: "L", price: num0(it.fuelPrice), per: "day" });
            if (it.oilYear !== undefined) subs.push({ name: t("buildup.sub.oil"), qty: 1, unit: "", price: num0(it.oilYear), per: "year" });
            out.sections[sec].push({ type: "day", ref: it.ref, name: it.name, nos: it.nos === undefined ? 1 : it.nos, price: it.price, output: it.output, subs: subs, source: it.source });
        } else {
            out.sections[sec].push({ type: "item", ref: it.ref, name: it.name, qty: round2(num0(it.qty) * (1 + num0(it.waste)) * 10000) / 10000, unit: it.unit, price: it.price, source: it.source });
        }
    });
    if (num0(b && b.delivery)) out.sections.material.push({ type: "pct", name: t("buildup.preset.delivery"), pct: num0(b.delivery) });
    out.sections.profit.push({ type: "pct", name: t("buildup.preset.profit"), pct: b && b.ohp !== undefined && b.ohp !== "" ? num0(b.ohp) : 15 });
    return out;
}

/* Rounded up to the nearest `step` (0: not rounded). */
function roundUp(v, step) {
    const s = Number(step) || 0;
    if (s <= 0) return round2(v);
    return round2(Math.ceil(round2(v / s) - 1e-9) * s);
}

/* The rate a build-up gives: each section's total, the net cost, the
   profit (and what it is as a % of the net), and the rate. */
function buildUpRate(bIn) {
    const b = asSections(bIn);
    const sec = b.sections || {};
    const material = runSection(sec.material, 0).end;
    const machinery = runSection(sec.machinery, 0).end;
    const labour = runSection(sec.labour, 0).end;
    const net = material + machinery + labour;
    const profit = runSection(sec.profit, net).end - net;
    const roundTo = b.roundTo !== undefined ? Number(b.roundTo) || 0 : 0;
    const raw = round2(net + profit);
    return { material: round2(material), machinery: round2(machinery), plant: round2(machinery), labour: round2(labour),
             net: round2(net), ohp: round2(profit), ohpPct: net ? Math.round(profit / net * 1000) / 10 : 0,
             raw: raw, roundTo: roundTo, rate: roundUp(raw, roundTo) };
}

/* ---------- drafts from the row's description ---------- */

function refLine(refId, project, fields) {
    const p = priceOf(refId, project);
    return Object.assign({ ref: refId, name: p.own ? p.own.name : t("buildup.item." + refId), unit: p.ref.unit, price: p.price,
                           source: p.own ? "priceList" : "reference" }, fields);
}

function dayLine(refId, nos, output, project) {
    const p = priceOf(refId, project);
    const subs = [];
    if (p.ref.fuel !== undefined) subs.push({ name: t("buildup.sub.diesel"), qty: p.ref.fuel, unit: "L", price: priceOf("diesel", project).price, per: "day" });
    if (p.ref.oilYear !== undefined) subs.push({ name: t("buildup.sub.oil"), qty: 1, unit: "", price: p.ref.oilYear, per: "year" });
    return refLine(refId, project, { type: "day", nos: nos, output: output, subs: subs });
}

/* "12mm" in the description: the thickness in metres, else the default */
function thicknessOf(text, mm) {
    const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*mm\b/i);
    const v = m ? Number(m[1]) : mm;
    return v > 0 && v <= 200 ? v / 1000 : mm / 1000;
}

/* ---------- the team's own build-up sheets ----------
   Each a template drawn up from the row's description (BUR Frame, BUR
   Upper Floor, BUR Staircase and the drainage sheet): the items the sheet
   always has, priced as the sheet prices them (× the region's factor), or
   at the contractor's own price list when it has the item. A size, a bar
   type, a grade, a mix, a thickness or the coats in the description choose
   the figures. They come before the general RECIPES.

   TEMPLATE_PRICES: id: [unit, the sheet's price, price-list words (null:
   sized, no match), true when one price nationwide (fuel)] */
var TEMPLATE_PRICES = {
    "ms-pipe":       ["m",   210,     null],
    "butt-fusion":   ["day", 135,     ["butt", "fusion"]],
    "generator":     ["day", 40,      ["generator"]],
    "ron95":         ["L",   3.82,    ["ron95"], true],
    "engine-oil":    ["L",   30,      ["engine", "oil"]],
    "general":       ["day", 100,     ["general", "worker"]],
    "skilled":       ["day", 120,     ["skilled", "worker"]],
    "cement-bag":    ["bag", 26.80,   ["cement"]],
    "sand":          ["m3",  108.33,  ["sand"]],
    "aggregate":     ["m3",  100,     ["aggregate"]],
    "mixer":         ["day", 12.64,   ["mixer"]],
    "mixer-diesel":  ["L",   2.94,    ["diesel"], true],
    "lubricant":     ["L",   14.80,   ["lubricant"]],
    "concretor":     ["day", 120,     ["concretor"]],
    "bar":           ["t",   0,       null],
    "tying-wire":    ["kg",  7.13,    ["tying", "wire"]],
    "barbender":     ["day", 120,     ["barbender"]],
    "plywood":       ["pc",  54.67,   ["plywood"]],
    "wrot-timber":   ["m3",  1836.07, ["timber"]],
    "carpenter":     ["day", 120,     ["carpenter"]],
    "brc":           ["pc",  0,       null],
    "pavior":        ["day", 120,     ["pavior"]],
    "skim-coat":     ["kg",  0.89,    ["skim"]],
    "plasterer":     ["day", 120,     ["plasterer"]],
    "sealer":        ["L",   10.22,   ["sealer"]],
    "emulsion-paint":["L",   27.53,   ["emulsion"]],
    "primer":        ["L",   26.03,   ["primer"]],
    "undercoat":     ["L",   35.55,   ["undercoat"]],
    "enamel":        ["L",   33.73,   ["enamel"]],
    "painter":       ["day", 120,     ["painter"]],
    "handrail":      ["m",   0,       null],
    "fabricator":    ["day", 120,     ["fabricator"]]
};

/* reinforcement bar a tonne (RM), by type and diameter */
var BAR_PRICES = {
    ms: { 6: 2531.98, 10: 3317.37, 12: 3269.72 },
    ht: { 10: 3410.97, 12: 3467.95, 16: 3279.87, 20: 3163.47, 25: 3427.80, 32: 3499.00 }
};
var BRC_PRICES = { A6: 110.87, A7: 156.71, B5: 152.43 };
var BRC_SHEET_M2 = 13.2;   /* 2.2 × 6 m */
/* concrete mixes by grade: cement (one part, 28 bags) : sand : aggregate */
var CONCRETE_MIXES = { 15: [3, 6], 20: [2, 4], 25: [1.5, 3], 30: [1, 2] };

function tplName(id, vars, task) {
    return t("buildup.tpl." + id, vars || {}) + (task ? " – " + t("buildup.task." + task, vars || {}) : "");
}

/* a template line: the sheet's price (or `price`), the price list first */
function tp(id, project, fields, o) {
    const d = TEMPLATE_PRICES[id], opt = o || {};
    const own = d[2] ? priceListMatch(project && project.priceList, { unit: d[0], words: d[2] }) : null;
    const base = opt.price !== undefined ? opt.price : d[1];
    return Object.assign({ name: own ? own.name + (opt.task ? " – " + t("buildup.task." + opt.task, opt.vars || {}) : "") : tplName(id, opt.vars, opt.task),
        unit: d[0], price: own ? round2(own.price) : round2(base * (d[3] ? 1 : regionOf(project).factor)),
        source: own ? "priceList" : "template" }, fields);
}
const tItem = (id, qty, p, o) => tp(id, p, { type: "item", qty: qty }, o);
const tHr = (id, nos, hrs, p, o) => tp(id, p, { type: "hr", nos: nos, hrs: hrs }, o);
const tDay = (id, nos, output, p, subs, o) => tp(id, p, { type: "day", nos: nos, output: output, subs: subs || [] }, o);
const pctLine = (key, pct, vars) => ({ type: "pct", name: t("buildup.preset." + key, vars || {}), pct: pct });
const unitLine = (key, factor, per, vars, from, to) => ({ type: "unit", name: t("buildup.preset." + key, vars || {}), factor: factor, per: per || 1, from: from || "", to: to || "" });
const sub = (key, qty, unit, price, per) => ({ name: t("buildup.sub." + key), qty: qty, unit: unit, price: price, per: per || "day" });

/* "200mm", "Y12", "T16", "R10", "Ø25" in the description */
function diameterOf(text) {
    const m = String(text || "").match(/(?:^|[^a-z0-9])[rytho](\d{1,2})\b/i) || String(text || "").match(/(?:ø|dia\.?\s*)(\d+)/i) ||
              String(text || "").match(/(\d+(?:\.\d+)?)\s*mm\b/i);
    return m ? Number(m[1]) : 0;
}
function nearest(table, d, dflt) {
    const sizes = Object.keys(table).map(Number);
    if (!d) return dflt;
    return sizes.reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a, sizes[0]);
}
/* what a metre run of painting measures round (m): "300mm girth", a
   pipe's or rail's circumference (π × diameter), any "150mm", else 300mm */
function girthOf(text) {
    const s = String(text || "");
    const g = s.match(/(\d+(?:\.\d+)?)\s*mm\s*girth|girth[^0-9]{0,12}(\d+(?:\.\d+)?)\s*mm|周长\s*(\d+(?:\.\d+)?)\s*mm/i);
    if (g) return Number(g[1] || g[2] || g[3]) / 1000;
    const d = diameterOf(s);
    if (d > 0 && d <= 1000 && /pipe|rail|管|扶手|栏杆/i.test(s)) return Math.round(Math.PI * d) / 1000;
    if (d > 0 && d <= 1000) return d / 1000;
    return 0.3;
}
/* painting priced a m², for a row measured a metre run: × the girth */
function perRun(sections, text, unit) {
    if (!U_M.test(unit)) return sections;
    const g = girthOf(text);
    const line = () => unitLine("girth", g, 1, { mm: Math.round(g * 1000) }, "m2", unit);
    sections.labour.forEach(l => { if (l.type === "hr") l.of = "m2"; });
    sections.material.push(line());
    sections.labour.push(line());
    return sections;
}
function coatsOf(text, dflt) {
    const m = String(text || "").match(/(\d)\s*(?:coats?|道)/i);
    return m && Number(m[1]) > 0 ? Number(m[1]) : dflt;
}

const U_M = /^(m|lm|m run|rm|米)$/i, U_M2 = /^(m2|m²|sq\.?\s*m|sqm|平方米)$/i, U_M2_OR_M = /^(m2|m²|sq\.?\s*m|sqm|平方米|m|lm|m run|rm|米)$/i, U_M3 = /^(m3|m³|cu\.?\s*m|立方米)$/i, U_KG = /^(kg|t|tonne|ton|公斤|吨)$/i;

var TEMPLATES = [
    /* reinforcement bar: the bar and 5 % wastage, tying wire; unloading,
       cutting and bending, fixing by the hour a tonne; × 0.001 to a kg */
    { id: "rebar", words: /rebar|reinforc|\bbars?\b|钢筋/i, not: /mesh|brc|fabric|钢筋网/i, unit: U_KG, build(text, unit, p) {
        const type = /mild steel|\bms\b|(?:^|[^a-z0-9])r\d|圆钢/i.test(text) ? "ms" : "ht";
        const d = nearest(BAR_PRICES[type], diameterOf(text), 12);
        const wire = d <= 12 ? 10 : d <= 25 ? 6 : 5;
        const cut = d <= 6 ? 30 : d <= 16 ? 20 : d <= 25 ? 15 : 30;
        const fix = d <= 6 ? 50 : d <= 16 ? 40 : d <= 25 ? 35 : 50;
        const perKg = !/^(t|tonne|ton|吨)$/i.test(unit);
        const toKg = perKg ? [unitLine("tonneToKg", 0.001, 1, {}, "t", "kg")] : [];
        return { sections: {
            material: [tItem("bar", 1, p, { price: BAR_PRICES[type][d], vars: { d: d, type: t("buildup.tpl.bar." + type) } }), pctLine("wastage", 5),
                       tItem("tying-wire", wire, p)].concat(toKg),
            machinery: [],
            labour: [tHr("general", 1, 1.5, p, { task: "unload" }), tHr("barbender", 1, cut, p, { task: "cutBend" }),
                     tHr("barbender", 1, fix, p, { task: "fix" })].map(l => Object.assign(l, { of: "t" })).concat(toKg),
            profit: [pctLine("profit", 15)] }, roundTo: 0 };
    } },
    /* BRC mesh: a sheet ÷ its 13.2 m², laps and wastage; fixing */
    { id: "brc", words: /brc|wire mesh|fabric reinforc|钢筋网/i, unit: U_M2, build(text, unit, p) {
        const m = text.match(/\b([AB])\s*(\d{1,2})\b/i);
        const ref = m && BRC_PRICES[(m[1] + m[2]).toUpperCase()] ? (m[1] + m[2]).toUpperCase() : "A7";
        return { sections: {
            material: [tItem("brc", 1, p, { price: BRC_PRICES[ref], vars: { ref: ref } }), unitLine("perSheet", 1, BRC_SHEET_M2, { m2: BRC_SHEET_M2 }, "pc", "m2"),
                       pctLine("lapsWastage", 20)],
            machinery: [],
            labour: [tHr("skilled", 1, 0.3, p, { task: "fixMesh" })],
            profit: [pctLine("profit", 15)] }, roundTo: 0 };
    } },
    /* formwork: plywood (a sheet ÷ 2.88 m²) and wrot timber, ÷ 3 uses,
       nails, wastage; a carpenter and a helper by the hour */
    { id: "formwork", words: /formwork|shutter|模板/i, unit: U_M2, build(text, unit, p) {
        const kind = /column|柱/i.test(text) ? "column" : /beam|梁/i.test(text) ? "beam" : "soffit";
        const timber = { beam: 0.06, column: 0.03, soffit: 0.05 }[kind];
        const hrs = kind === "soffit" ? 0.75 : 1.15;
        return { sections: {
            material: [tItem("plywood", 1, p), unitLine("perSheet", 1, 2.88, { m2: 2.88 }, "pc", "m2"), tItem("wrot-timber", timber, p),
                       unitLine("uses", 1, 3, { n: 3 }), pctLine("nails", 5), pctLine("wastage", 10)],
            machinery: [],
            labour: [tHr("carpenter", 1, hrs, p), tHr("general", 1, 0.15, p)],
            profit: [pctLine("profit", 15)] }, roundTo: 0 };
    } },
    /* site-mixed concrete: cement, sand and aggregate for the grade's mix,
       shrinkage, compaction and wastage, ÷ the parts to a m³; a mixer with
       its diesel and lubricant; the concreting gang, placing */
    { id: "concrete", words: /concrete|混凝土|砼/i, not: /precast|sump|预制/i, unit: U_M3, build(text, unit, p) {
        const g = text.match(/\b(?:g|grade\s*|c)(\d{2})\b/i);
        const grade = g && CONCRETE_MIXES[g[1]] ? Number(g[1]) : /lean|blinding|垫层/i.test(text) ? 15 : 25;
        const mix = CONCRETE_MIXES[grade], parts = 1 + mix[0] + mix[1];
        const mixName = "1:" + mix[0] + ":" + mix[1];
        return { sections: {
            material: [tItem("cement-bag", 28, p), tItem("sand", mix[0], p), tItem("aggregate", mix[1], p),
                       pctLine("shrinkCompact", 50), unitLine("parts", 1, parts, { n: parts, mix: mixName }, "", "m3")],
            machinery: [tDay("mixer", 1, 26, p, [sub("diesel", 14.4, "L", tp("mixer-diesel", p).price), sub("lubricant", 0.56, "L", tp("lubricant", p).price)])],
            labour: [tDay("concretor", 1, 26, p), tDay("general", 4, 26, p), tDay("general", 1, 1, p, [], { task: "place" })],
            profit: [pctLine("profit", 15)] }, roundTo: 0, grade: grade };
    } },
    /* handrail: the rail and 5 % wastage; a fabricator and a helper */
    { id: "handrail", words: /handrail|hand rail|railing|扶手|栏杆/i, unit: U_M, build(text, unit, p) {
        const d = diameterOf(text) && diameterOf(text) <= 60 ? 50 : 75;
        return { sections: {
            material: [tItem("handrail", 1, p, { price: d === 50 ? 293.96 : 263.97, vars: { d: d } }), pctLine("wastage", 5)],
            machinery: [],
            labour: [tHr("fabricator", 1, 0.2, p), tHr("general", 1, 0.2, p)],
            profit: [pctLine("profit", 15)] }, roundTo: 0 };
    } },
    /* enamel paint to steelwork: primer, undercoat, enamel; preparing and
       applying, brushes; overhead and profit */
    { id: "enamel", words: /enamel|gloss|磁漆|调和漆|(paint|油漆).*(steel|metal|钢|铁)|(steel|metal|钢|铁).*(paint|油漆)/i, unit: U_M2_OR_M, build(text, unit, p) {
        const coats = Math.max(3, coatsOf(text, 4));
        return { sections: perRun({
            material: [tItem("primer", 0.08, p), tItem("undercoat", 0.08, p), tItem("enamel", round2((coats - 2) * 0.08), p), pctLine("wastage", 5)],
            machinery: [],
            labour: [tHr("painter", 1, 0.02, p, { task: "prepare" }), tHr("painter", 1, round2(coats * 0.1), p, { task: "apply", vars: { n: coats } }), pctLine("brushes", 3)],
            profit: [pctLine("overhead", 5), pctLine("profit", 30)] }, text, unit), roundTo: 0 };
    } },
    /* emulsion paint: a sealer and the emulsion coats; preparing and
       applying, brushes; overhead and profit */
    { id: "emulsion", words: /emulsion|paint|油漆|涂料|乳胶漆/i, unit: U_M2_OR_M, build(text, unit, p) {
        const coats = Math.max(2, coatsOf(text, 3));
        return { sections: perRun({
            material: [tItem("sealer", 0.08, p), tItem("emulsion-paint", round2((coats - 1) * 0.08), p), pctLine("wastage", 5)],
            machinery: [],
            labour: [tHr("painter", 1, 0.02, p, { task: "prepare" }), tHr("painter", 1, round2(coats * 0.1), p, { task: "apply", vars: { n: coats } }), pctLine("brushes", 3)],
            profit: [pctLine("overhead", 5), pctLine("profit", 30)] }, text, unit), roundTo: 0 };
    } },
    /* plainface: a skim coat, 9 kg a m² at 5 mm; a plasterer and a helper */
    { id: "plainface", words: /plain\s*face|skim|批灰|腻子/i, unit: U_M2, build(text, unit, p) {
        const mm = Math.round(thicknessOf(text, 5) * 1000 * 10) / 10;
        return { sections: {
            material: [tItem("skim-coat", round2(9 * mm / 5), p, { vars: { mm: mm } }), pctLine("wastage", 5)],
            machinery: [],
            labour: [tHr("plasterer", 1, 0.4, p), tHr("general", 1, 0.4, p)],
            profit: [pctLine("profit", 15)] }, roundTo: 0 };
    } },
    /* cement and sand paving: a m³ of the mix with ⅓ wastage, mixed and
       laid; then at the thickness to a m² */
    { id: "paving", words: /paving|cement\s*(and|&)?\s*sand|水泥砂浆|铺地/i, not: /screed|turapan simen|plaster|render|找平|抹灰|批荡/i, unit: U_M2, build(text, unit, p) {
        const m = text.match(/1\s*:\s*(\d+(?:\.\d+)?)/);
        const sand = m ? Number(m[1]) : 3;
        const th = thicknessOf(text, 20), mm = Math.round(th * 1000 * 10) / 10;
        const at = unitLine("thickness", th, 1, { mm: mm }, "m3", unit || "m2");
        return { sections: {
            material: [tItem("cement-bag", 28, p), tItem("sand", sand, p), pctLine("wastage", 33.33), unitLine("parts", 1, 1 + sand, { n: 1 + sand, mix: "1:" + sand }, "", "m3"), at],
            machinery: [],
            labour: [tHr("general", 1, 2, p, { task: "mix" }), tHr("pavior", 1, 0.25, p), tHr("general", 1, 0.25, p)].map(l => Object.assign(l, { of: "m3" }))
                .concat([Object.assign({}, at)]),
            profit: [pctLine("profit", 15)] }, roundTo: 0 };
    } },
    /* steel pipe (the drainage sheet): the pipe and 5 % wastage; a backhoe
       with its diesel and hydraulic oil, a butt-fusion machine, a generator
       with RON95 and engine oil, at 36 m a day; two general workers;
       profit 10 %, rounded up to RM 5 */
    { id: "msPipe", words: /(\bms\b|mild steel|steel|\bgi\b|钢).*(pipe|管)|(pipe|管).*(\bms\b|mild steel|steel|钢)/i, unit: U_M, build(text, unit, p) {
        const d = diameterOf(text) || 200;
        return { sections: {
            material: [tItem("ms-pipe", 1, p, { price: round2(210 * d / 200), vars: { d: d } }), pctLine("wastage", 5)],
            machinery: [dayLine("backhoe", 1, 36, p), tDay("butt-fusion", 1, 36, p),
                        tDay("generator", 1, 36, p, [sub("ron95", 40, "L", tp("ron95", p).price), sub("engineOil", 0.06, "L", tp("engine-oil", p).price)])],
            labour: [tDay("general", 2, 36, p, [], { price: 85 })],
            profit: [pctLine("profit", 10)] }, roundTo: 5 };
    } }
];

/* The team's template for a row, or null. */
function templateFor(text, unit) {
    return TEMPLATES.find(x => x.words.test(text) && !(x.not && x.not.test(text)) && (!unit || x.unit.test(unit))) || null;
}

/* A draft build-up for a measurement row, or null when no recipe fits. */
function suggestBuildUp(row, project) {
    const text = String((row && row.description) || "");
    const unit = String((row && row.unit) || "").trim();
    const tpl = templateFor(text, unit);
    if (tpl) return Object.assign({ recipe: tpl.id, template: true }, tpl.build(text, unit, project));
    const recipe = RECIPES.find(r => r.words.test(text) && (!unit || r.unit.test(unit)));
    if (!recipe) return null;
    const material = [];
    if (recipe.mortar) {
        /* the mix per m³ of mortar, then delivery and wastage, then laid at the thickness */
        recipe.mortar.mix.forEach(m => material.push(refLine(m[0], project, { type: "item", qty: m[1] })));
        if (recipe.delivery) material.push({ type: "pct", name: t("buildup.preset.delivery"), pct: recipe.delivery });
        material.push({ type: "pct", name: t("buildup.preset.wasteShrink"), pct: recipe.mortar.waste * 100 });
        const th = thicknessOf(text, recipe.mortar.thickness);
        material.push({ type: "unit", name: t("buildup.preset.thickness", { mm: Math.round(th * 1000 * 10) / 10 }), factor: th, from: "m3", to: unit || "m2" });
    } else {
        (recipe.material || []).forEach(m => material.push(refLine(m[0], project, { type: "item", qty: m[1] })));
        const waste = (recipe.material || []).reduce((w, m) => Math.max(w, m[2] || 0), 0);
        if (waste) material.push({ type: "pct", name: t("buildup.preset.wastage"), pct: Math.round(waste * 1000) / 10 });
        if (recipe.delivery) material.push({ type: "pct", name: t("buildup.preset.delivery"), pct: recipe.delivery });
    }
    return {
        recipe: recipe.id,
        sections: {
            material: material,
            machinery: recipe.plant.map(l => dayLine(l[0], l[1], l[2], project))
                .concat((recipe.perUnit || []).map(l => refLine(l[0], project, { type: "item", qty: l[1], name: t("buildup.item." + l[0]) }))),
            labour: recipe.labour.map(l => dayLine(l[0], l[1], l[2], project)),
            profit: [{ type: "pct", name: t("buildup.preset.profit"), pct: recipe.ohp !== undefined ? recipe.ohp : 15 }]
        },
        roundTo: recipe.roundTo !== undefined ? recipe.roundTo : 1
    };
}

/* Rent or buy a piece of plant for `months` of use.
   Buying costs the price, less what it sells for afterwards (a fifth
   lost at once, then down to the resale share at 3 years), plus upkeep
   (a share of the price a year). Renting costs the monthly hire.
   breakEven: the months of use after which buying is cheaper. */
function rentOrBuy(o) {
    const months = Math.max(0, Number(o.months) || 0);
    const buy = Math.max(0, Number(o.buyPrice) || 0);
    const resale = Math.min(100, Math.max(0, Number(o.resalePct) || 0)) / 100;
    const upkeep = Math.max(0, Number(o.upkeepPctYear) || 0) / 100;
    const rentMonth = Math.max(0, Number(o.rentPerMonth) || 0);
    /* the resale value: a fifth is lost the day it is bought (it is
       second-hand now), then it falls in a straight line to `resale` at
       3 years */
    const resaleAt = m => m <= 0 ? buy : buy * (0.8 - (0.8 - Math.min(resale, 0.8)) * Math.min(m, 36) / 36);
    const buyCost = m => round2(buy - resaleAt(m) + buy * upkeep * m / 12);
    const rentCost = m => round2(rentMonth * m);
    let breakEven = null;
    for (let m = 1; m <= 120; m++) { if (buyCost(m) < rentCost(m)) { breakEven = m; break; } }
    const b = buyCost(months), r = rentCost(months);
    return { buyCost: b, rentCost: r, cheaper: b < r ? "buy" : "rent", saving: round2(Math.abs(b - r)), breakEven: breakEven };
}

/* A pasted price list: one item a line, "name, unit, price". Lines that
   do not read are reported, not guessed. */
function parsePriceList(text) {
    const items = [], bad = [];
    String(text || "").split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return;
        const parts = line.split(/[,\t;]/).map(s => s.trim());
        const price = Number(String(parts[parts.length - 1] || "").replace(/^RM\s*/i, "").replace(/,/g, ""));
        if (parts.length < 3 || !parts[0] || !isFinite(price) || price <= 0) { bad.push(i + 1); return; }
        items.push({ name: parts[0], unit: parts[1].toLowerCase(), price: round2(price) });
    });
    return { items: items, bad: bad };
}

/* ---------- the card on the VO page ---------- */

/* The rows a build-up is for: every measured row, the ones with no BQ
   item (star rates) marked. `stars` is the set of row indexes. The
   build-up is the author's own (o.buildUp, js/private.js), else a draft. */
function renderBuildUpCard(vo, project, opts) {
    const o = opts || {};
    const rows = (vo.measurement || []);
    if (!rows.length) return '<div class="empty-state">' + escapeHtml(t("buildup.noRows")) + "</div>";
    const i = Math.min(Math.max(0, o.rowIndex || 0), rows.length - 1);
    const row = rows[i];
    const drafted = !o.buildUp;
    const b = asSections(o.buildUp || suggestBuildUp(row, project) || { sections: { material: [], machinery: [], labour: [], profit: [newLine("pct:profit")] }, roundTo: 1 });
    const r = buildUpRate(b);
    const region = regionOf(project);
    const dis = o.editable ? "" : " disabled";
    const rowUnit = escapeHtml(row.unit || t("buildup.unit"));
    const at = (sec, j, sIdx) => ' data-sec="' + sec + '" data-i="' + j + '"' + (sIdx === undefined ? "" : ' data-s="' + sIdx + '"');
    const num = (sec, j, k, v, step, sIdx, cls) => '<input type="number" step="' + step + '" class="bu-n' + (cls ? " " + cls : "") + '"' + at(sec, j, sIdx) +
        ' data-k="' + k + '" data-t="n" value="' + escapeHtml(String(v === undefined || v === null ? "" : v)) + '"' + dis + ">";
    const txt = (sec, j, k, v, ph, sIdx, cls) => '<input type="text" class="' + (cls || "bu-t") + '"' + at(sec, j, sIdx) + ' data-k="' + k + '" value="' + escapeHtml(String(v || "")) + '"' +
        (ph ? ' placeholder="' + escapeHtml(ph) + '"' : "") + dis + ">";
    const del = (sec, j, sIdx) => o.editable ? '<button type="button" class="link-button bu-remove"' + at(sec, j, sIdx) + ' aria-label="' + escapeHtml(t("buildup.remove")) + '">×</button>' : "";
    const up = (sec, j) => o.editable && j > 0 ? '<button type="button" class="link-button bu-up"' + at(sec, j) + ' aria-label="' + escapeHtml(t("buildup.moveUp")) + '">↑</button>' : "";
    const src = l => l.source && l.source !== "manual" ? ' <span class="bu-src bu-src-' + escapeHtml(l.source) + '">' + escapeHtml(t("buildup.src." + l.source)) + "</span>" : "";

    /* how a line is worked out, as the QS writes it */
    function calc(sec, j, l, before) {
        if (l.type === "pct") return num(sec, j, "pct", l.pct, "0.1", undefined, "bu-n-s") + " % × " + escapeHtml(rm(before));
        if (l.type === "unit") return "× " + num(sec, j, "factor", l.factor, "0.001") + (num0(l.per) > 0 && num0(l.per) !== 1 ? " ÷ " + num(sec, j, "per", l.per, "0.01", undefined, "bu-n-s") : "") + " " +
            txt(sec, j, "from", l.from, t("buildup.unitFrom"), undefined, "bu-u") + " → " + txt(sec, j, "to", l.to, rowUnit, undefined, "bu-u");
        if (l.type === "hr") return '<span class="bu-calc">' + num(sec, j, "nos", l.nos === undefined ? 1 : l.nos, "1", undefined, "bu-n-s") + " × RM " + num(sec, j, "price", l.price, "0.01") +
            " " + escapeHtml(t("buildup.perDay")) + " ÷ " + HOURS_A_DAY + " " + escapeHtml(t("buildup.unitHr")) + " × " + num(sec, j, "hrs", l.hrs, "0.01", undefined, "bu-n-s") +
            " " + escapeHtml(t("buildup.unitHr")) + "/" + (l.of ? escapeHtml(l.of) : rowUnit) + "</span>";
        if (l.type === "day") {
            const subs = (l.subs || []).map((sb, k) => '<div class="bu-sub">+ ' + txt(sec, j, "name", sb.name, t("buildup.namePh"), k, "bu-t bu-t-s") + " " +
                num(sec, j, "qty", sb.qty, "0.01", k, "bu-n-s") + " " + txt(sec, j, "unit", sb.unit, "", k, "bu-u") + " × RM " + num(sec, j, "price", sb.price, "0.01", k) +
                ' <select data-k="per"' + at(sec, j, k) + dis + ">" + ["day", "year"].map(p => '<option value="' + p + '"' + ((sb.per || "day") === p ? " selected" : "") + ">" +
                    escapeHtml(t("buildup.per." + p)) + "</option>").join("") + "</select> " + del(sec, j, k) + "</div>").join("");
            return '<span class="bu-calc">' + num(sec, j, "nos", l.nos === undefined ? 1 : l.nos, "1", undefined, "bu-n-s") + " × ( RM " + num(sec, j, "price", l.price, "0.01") +
                " " + escapeHtml(t("buildup.perDay")) + (l.subs && l.subs.length ? " + " + escapeHtml(t("buildup.subsLabel")) : "") + " ) ÷ " +
                num(sec, j, "output", l.output, "0.1", undefined, "bu-n-s") + " " + rowUnit + escapeHtml(t("buildup.perDay")) + "</span>" + subs +
                (o.editable ? '<select class="bu-add-sub"' + at(sec, j) + '><option value="">' + escapeHtml(t("buildup.addSub")) + "</option>" +
                    SUB_FORMATS.map(f => '<option value="' + f + '">' + escapeHtml(t("buildup.sub." + f)) + "</option>").join("") + "</select>" : "");
        }
        return '<span class="bu-calc">' + num(sec, j, "qty", l.qty, "0.001", undefined, "bu-n-s") + " " + txt(sec, j, "unit", l.unit, "", undefined, "bu-u") +
            " × RM " + num(sec, j, "price", l.price, "0.01") + "</span>";
    }

    const net = r.material + r.machinery + r.labour;
    const sections = SECTIONS.map(sec => {
        const lines = b.sections[sec] || [];
        const start = sec === "profit" ? runSection(b.sections.material, 0).end + runSection(b.sections.machinery, 0).end + runSection(b.sections.labour, 0).end : 0;
        const run = runSection(lines, start);
        const total = sec === "profit" ? run.end - start : run.end;
        /* each section shows its total; its lines open on 展开 */
        const head = '<span class="bu-sec-head"><strong>' + escapeHtml(t("buildup.sec." + sec)) + "</strong>" +
                (sec === "profit" ? '<span class="rate-detail">' + escapeHtml(t("buildup.netStart", { amount: rm(net) })) + "</span>" : "") +
                '<span class="bu-sec-total">' + escapeHtml(rm(total)) + "</span></span>";
        return '<div class="bu-sec bu-sec-' + sec + '">' + fold("bu-sec-" + sec, head, (lines.length ? '<table class="bu-table"><tbody>' + lines.map((l, j) => '<tr class="bu-line bu-' + escapeHtml(l.type || "item") + '">' +
                "<td>" + txt(sec, j, "name", l.name, t("buildup.namePh")) + src(l) + "</td>" +
                "<td>" + calc(sec, j, l, run.rows[j].before) + "</td>" +
                '<td class="num">' + (l.type === "unit" ? "→ " + escapeHtml(rm(run.rows[j].after)) : escapeHtml(rm(run.rows[j].amount))) + "</td>" +
                '<td class="bu-act">' + up(sec, j) + del(sec, j) + "</td></tr>").join("") + "</tbody></table>" : "") +
            (o.editable ? '<select class="bu-add-line" data-sec="' + sec + '"><option value="">' + escapeHtml(t("buildup.addLine")) + "</option>" +
                ADD_FORMATS[sec].map(f => '<option value="' + f + '">' + escapeHtml(t("buildup.fmt." + f.replace(":", "."))) + "</option>").join("") + "</select>" : ""), "bu-sec-fold") +
        "</div>";
    }).join("");

    const machines = (b.sections.machinery || []).filter(l => l.type === "day" && l.ref && (REFERENCE_PRICES.find(x => x.id === l.ref) || {}).buy);
    const rentBlock = machines.length ? fold("bu-rent", escapeHtml(t("buildup.rentTitle")), renderRentOrBuy(machines, o.rent || {})) : "";
    const pl = (project && project.priceList) || [];
    const priceBlock = fold("bu-pricelist", escapeHtml(t("buildup.priceListTitle", { n: pl.length })),
        '<p class="assistant-note">' + escapeHtml(t("buildup.priceListNote")) + "</p>" +
        (pl.length ? '<ul class="bu-pl">' + pl.map(p => "<li>" + escapeHtml(p.name) + " — " + rm(p.price) + "/" + escapeHtml(unitLabel(p.unit)) + "</li>").join("") + "</ul>" : "") +
        (o.canEditPriceList ? '<textarea id="buPriceListInput" rows="4" placeholder="' + escapeHtml(t("buildup.priceListPh")) + '"></textarea>' +
            '<button type="button" class="secondary-button" id="buPriceListSave">' + escapeHtml(t("buildup.priceListSave")) + "</button>" : ""));

    return '<p class="bu-private">' + escapeHtml(t(o.privateNote || "buildup.private.contractor")) + "</p>" +
        '<div class="bu-head">' +
            (o.hideRow ? "" : rowPicker(rows, i, o.stars)) +
            '<span class="rate-detail">' + escapeHtml(t("buildup.region." + region.from, { region: t("buildup.regionName." + region.id), f: region.factor.toFixed(2) })) + "</span>" +
        "</div>" +
        (o.stars && o.stars.has(i) ? '<p class="assistant-note">' + escapeHtml(t("buildup.starNote")) + "</p>" : "") +
        (drafted && o.editable ? '<p class="assistant-note">' + escapeHtml(t(suggestBuildUp(row, project) ? "buildup.drafted" : "buildup.noRecipe")) + "</p>" : "") +
        '<div class="bu-secs">' + sections + "</div>" +
        /* the four sections show their totals above: here only the rate */
        '<div class="bu-totals bu-totals-rate">' +
            '<div class="bu-rate"><small>' + escapeHtml(t("buildup.total.rate", { unit: row.unit || t("buildup.unit") })) + "</small><strong>" + rm(r.rate) + "</strong>" +
                '<span class="bu-round">' + (r.rate !== r.raw ? escapeHtml(rm(r.raw)) + " → " : "") + escapeHtml(t("buildup.roundTo")) + ' <select data-k="roundTo"' + dis + ">" +
                [0, 0.5, 1, 5, 10].map(v => '<option value="' + v + '"' + (v === r.roundTo ? " selected" : "") + ">" + escapeHtml(v ? "RM " + v : t("buildup.noRound")) + "</option>").join("") +
                "</select></span></div>" +
        "</div>" +
        (o.useAs ? '<button type="button" class="primary-button" id="buUseRate">' + escapeHtml(t("buildup.use." + o.useAs, { rate: rm(r.rate) })) + "</button>" : "") +
        rentBlock + priceBlock +
        /* where to buy or hire it near the site (js/suppliers.js) */
        (typeof renderSuppliers === "function"
            ? fold("bu-suppliers", escapeHtml(t("suppliers.title")), '<div id="suppliersBody">' + renderSuppliers(project, o.suppliers || null) + "</div>") : "") +
        '<p class="assistant-note">' + escapeHtml(t("buildup.note")) + "</p>";
}

/* Change a build-up as the card's inputs say (the VO page calls these). */
function editBuildUp(b, e) {
    const sec = b.sections[e.sec];
    if (e.k === "roundTo") { b.roundTo = Number(e.value) || 0; return b; }
    if (!sec) return b;
    if (e.op === "add") { sec.push(newLine(e.value)); return b; }
    const line = sec[e.i];
    if (!line) return b;
    if (e.op === "addSub") { line.subs = (line.subs || []).concat([newSub(e.value)]); return b; }
    if (e.op === "remove") {
        if (e.s !== undefined) line.subs.splice(e.s, 1); else sec.splice(e.i, 1);
        return b;
    }
    if (e.op === "up") { if (e.i > 0) sec.splice(e.i - 1, 0, sec.splice(e.i, 1)[0]); return b; }
    const target = e.s !== undefined ? (line.subs || [])[e.s] : line;
    if (!target) return b;
    target[e.k] = e.numeric ? (e.value === "" ? "" : Number(e.value) || 0) : e.value;
    if (e.s === undefined && (e.k === "price" || e.k === "name")) line.source = "manual";
    return b;
}

function rowPicker(rows, i, stars) {
    return '<label>' + escapeHtml(t("buildup.row")) + ' <select id="buRow">' + rows.map((x, k) =>
        '<option value="' + k + '"' + (k === i ? " selected" : "") + ">" + (stars && stars.has(k) ? "★ " : "") +
        escapeHtml((k + 1) + ". " + (seedText(x.description) || t("buildup.untitledRow")) + (x.unit ? " (" + x.unit + ")" : "")) + "</option>").join("") +
        "</select></label>";
}

/* What the rest of the team sees of the contractor's build-up for a row:
   materials, labour, machinery and tools, profit and the rate — never its
   lines (they stay with the contractor, js/private.js). */
function renderBuildUpSummary(vo, opts) {
    const o = opts || {};
    const rows = (vo.measurement || []);
    if (!rows.length) return '<div class="empty-state">' + escapeHtml(t("buildup.noRows")) + "</div>";
    const i = Math.min(Math.max(0, o.rowIndex || 0), rows.length - 1);
    const row = rows[i];
    const sm = row.buildUpSummary;
    const head = '<div class="bu-head">' + rowPicker(rows, i, o.stars) + "</div>";
    if (!sm) return head + '<p class="assistant-note">' + escapeHtml(t("buildup.summary.none")) + "</p>";
    const box = (label, v, cls) => '<div' + (cls ? ' class="' + cls + '"' : "") + "><small>" + escapeHtml(label) + "</small><strong>" + rm(v) + "</strong></div>";
    const differs = Number(row.rate) > 0 && Math.abs(Number(row.rate) - Number(sm.rate)) > 0.005;
    return head +
        '<p class="rate-detail">' + escapeHtml(t("buildup.summary.title", { date: sm.at || "" })) + "</p>" +
        '<div class="bu-totals bu-summary">' +
            box(t("buildup.sec.material"), sm.material) + box(t("buildup.sec.machinery"), sm.plant) + box(t("buildup.sec.labour"), sm.labour) +
            box(t("buildup.sec.profit") + " " + (Number(sm.profitPct) || 0) + " %", sm.profit) +
            box(t("buildup.total.rate", { unit: row.unit || t("buildup.unit") }), sm.rate, "bu-rate") +
        "</div>" +
        (differs ? '<p class="assistant-note">' + escapeHtml(t("buildup.summary.differs", { rate: rm(Number(row.rate)) })) + "</p>" : "") +
        '<p class="assistant-note">' + escapeHtml(t("buildup.summary.private")) + "</p>";
}

/* Rent or buy, for each plant item of the build-up that has a purchase
   price; `state` keeps what the person typed (months, prices). */
function renderRentOrBuy(plant, state) {
    return plant.map(it => {
        const ref = REFERENCE_PRICES.find(r => r.id === it.ref) || {};
        const s = state[it.ref || it.name] || {};
        const months = s.months !== undefined ? s.months : 3;
        const rentPerMonth = s.rentPerMonth !== undefined ? s.rentPerMonth : Math.round((Number(it.price) || 0) * (it.unit === "hr" ? 8 * 22 : 22));
        const buyPrice = s.buyPrice !== undefined ? s.buyPrice : (ref.buy || 0);
        const resalePct = s.resalePct !== undefined ? s.resalePct : 40;
        const upkeepPctYear = s.upkeepPctYear !== undefined ? s.upkeepPctYear : 10;
        const r = rentOrBuy({ months: months, rentPerMonth: rentPerMonth, buyPrice: buyPrice, resalePct: resalePct, upkeepPctYear: upkeepPctYear });
        const inp = (k, v) => '<label>' + escapeHtml(t("buildup.rent." + k)) + ' <input type="number" min="0" data-rent="' + escapeHtml(it.ref || it.name) + '" data-k="' + k + '" value="' + escapeHtml(String(v)) + '"></label>';
        return '<div class="bu-rent-item"><strong>' + escapeHtml(it.name) + "</strong>" +
            '<div class="bu-rent-inputs">' + inp("months", months) + inp("rentPerMonth", rentPerMonth) + inp("buyPrice", buyPrice) +
                inp("resalePct", resalePct) + inp("upkeepPctYear", upkeepPctYear) + "</div>" +
            '<p class="rate-detail">' + escapeHtml(t("buildup.rent.result." + r.cheaper, {
                rent: rm(r.rentCost), buy: rm(r.buyCost), saving: rm(r.saving), months: months })) +
            (r.breakEven ? " " + escapeHtml(t("buildup.rent.breakEven", { n: r.breakEven })) : " " + escapeHtml(t("buildup.rent.never"))) + "</p></div>";
    }).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { REGIONS, REFERENCE_PRICES, RECIPES, TEMPLATES, templateFor, diameterOf, girthOf, SECTIONS, ADD_FORMATS, regionOf, priceListMatch, suggestBuildUp, buildUpRate, asSections,
        lineAmount, runSection, newLine, newSub, editBuildUp, roundUp, thicknessOf, rentOrBuy, parsePriceList,
        renderBuildUpCard, renderBuildUpSummary, renderRentOrBuy };
}
