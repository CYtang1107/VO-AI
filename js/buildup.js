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
    var { escapeHtml, fold } = require("./ui.js");
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

/* Indicative Klang Valley 2026 prices (RM). `buy` is a plant item's
   purchase price, for rent or buy. */
var REFERENCE_PRICES = [
    { id: "marble-tile",   kind: "material", unit: "m2",  price: 180,  words: ["marble", "tile"] },
    { id: "homog-tile",    kind: "material", unit: "m2",  price: 55,   words: ["homogeneous", "tile"] },
    { id: "ceramic-tile",  kind: "material", unit: "m2",  price: 32,   words: ["ceramic", "tile"] },
    { id: "adhesive",      kind: "material", unit: "m2",  price: 6.5,  words: ["adhesive"] },
    { id: "grout",         kind: "material", unit: "m2",  price: 2,    words: ["grout"] },
    { id: "marble-skirt",  kind: "material", unit: "m",   price: 25,   words: ["marble", "skirting"] },
    { id: "tile-skirt",    kind: "material", unit: "m",   price: 9,    words: ["skirting"] },
    { id: "screed",        kind: "material", unit: "m2",  price: 9,    words: ["screed"] },
    { id: "upvc-150",      kind: "material", unit: "m",   price: 38,   words: ["upvc", "pipe"] },
    { id: "sand",          kind: "material", unit: "m3",  price: 75,   words: ["sand"] },
    { id: "precast-sump",  kind: "material", unit: "no",  price: 450,  words: ["precast", "sump"] },
    { id: "concrete-g25",  kind: "material", unit: "m3",  price: 260,  words: ["concrete"] },
    { id: "rebar",         kind: "material", unit: "kg",  price: 3.3,  words: ["rebar", "reinforcement"] },
    { id: "gypsum-board",  kind: "material", unit: "m2",  price: 18,   words: ["gypsum", "board"] },
    { id: "cove-cornice",  kind: "material", unit: "m",   price: 14,   words: ["cove", "cornice"] },
    { id: "emulsion",      kind: "material", unit: "m2",  price: 4.5,  words: ["paint", "emulsion"] },
    { id: "tiler",         kind: "labour",   unit: "hr",  price: 22,   words: ["tiler"] },
    { id: "general",       kind: "labour",   unit: "hr",  price: 13,   words: ["general", "worker", "labourer"] },
    { id: "plumber",       kind: "labour",   unit: "hr",  price: 22,   words: ["plumber"] },
    { id: "carpenter",     kind: "labour",   unit: "hr",  price: 20,   words: ["carpenter"] },
    { id: "ceiling-fixer", kind: "labour",   unit: "hr",  price: 20,   words: ["ceiling", "fixer"] },
    { id: "painter",       kind: "labour",   unit: "hr",  price: 17,   words: ["painter"] },
    { id: "concretor",     kind: "labour",   unit: "hr",  price: 18,   words: ["concretor"] },
    { id: "operator",      kind: "labour",   unit: "hr",  price: 20,   words: ["operator"] },
    { id: "tile-cutter",   kind: "plant",    unit: "hr",  price: 6,    buy: 2800,   words: ["tile", "cutter"] },
    { id: "mini-excavator",kind: "plant",    unit: "hr",  price: 55,   buy: 120000, words: ["excavator"] },
    { id: "plate-compactor",kind: "plant",   unit: "hr",  price: 10,   buy: 4500,   words: ["compactor"] },
    { id: "poker-vibrator",kind: "plant",    unit: "hr",  price: 8,    buy: 1500,   words: ["vibrator"] },
    { id: "scaffold-tower",kind: "plant",    unit: "hr",  price: 4,    buy: 3500,   words: ["scaffold"] }
];

/* What a unit of each kind of work takes. [reference id, quantity per
   unit of the row, waste fraction (materials)]. The first recipe whose
   words the description has is used. */
var RECIPES = [
    { id: "marbleFloor",  words: /marble/i, unit: /m2|m²/i, material: [["marble-tile", 1, 0.05], ["adhesive", 1, 0], ["grout", 1, 0]],
      labour: [["tiler", 0.6], ["general", 0.3]], plant: [["tile-cutter", 0.15]] },
    { id: "marbleSkirting", words: /marble.*skirting|skirting.*marble|大理石踢脚/i, unit: /^m$/i, material: [["marble-skirt", 1, 0.05], ["adhesive", 0.15, 0]],
      labour: [["tiler", 0.25]], plant: [["tile-cutter", 0.05]] },
    { id: "skirting",     words: /skirting|踢脚/i, unit: /^m$/i, material: [["tile-skirt", 1, 0.05], ["adhesive", 0.15, 0]],
      labour: [["tiler", 0.2]], plant: [["tile-cutter", 0.04]] },
    { id: "tileFloor",    words: /tile|瓷砖|地砖/i, unit: /m2|m²/i, material: [["homog-tile", 1, 0.05], ["adhesive", 1, 0], ["grout", 1, 0]],
      labour: [["tiler", 0.55], ["general", 0.3]], plant: [["tile-cutter", 0.12]] },
    { id: "pipe",         words: /pipe|drain|upvc|管/i, unit: /^m$/i, material: [["upvc-150", 1, 0.03], ["sand", 0.05, 0.1]],
      labour: [["plumber", 0.4], ["general", 0.6], ["operator", 0.08]], plant: [["mini-excavator", 0.08], ["plate-compactor", 0.05]] },
    { id: "sump",         words: /sump|manhole|集水井|沙井/i, unit: /no|nr|each|unit/i, material: [["precast-sump", 1, 0], ["concrete-g25", 0.1, 0.05]],
      labour: [["general", 4], ["plumber", 2], ["operator", 0.75]], plant: [["mini-excavator", 0.75]] },
    { id: "ceiling",      words: /ceiling|cove|gypsum|cornice|天花|吊顶/i, unit: /.*/, material: [["gypsum-board", 1, 0.08], ["cove-cornice", 0.4, 0.05]],
      labour: [["ceiling-fixer", 0.8]], plant: [["scaffold-tower", 0.5]] },
    { id: "concrete",     words: /concrete|混凝土/i, unit: /m3|m³/i, material: [["concrete-g25", 1, 0.03]],
      labour: [["concretor", 2.5], ["general", 3]], plant: [["poker-vibrator", 0.5]] },
    { id: "paint",        words: /paint|emulsion|油漆|涂料/i, unit: /m2|m²/i, material: [["emulsion", 1, 0.05]],
      labour: [["painter", 0.15]], plant: [] }
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
               (!p.unit || !ref.unit || String(p.unit).toLowerCase() === ref.unit);
    }) || null;
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* One component, priced: the price list first, else the reference price
   for the region. */
function component(refId, qty, waste, project) {
    const ref = REFERENCE_PRICES.find(r => r.id === refId);
    const own = priceListMatch(project && project.priceList, ref);
    const region = regionOf(project);
    return {
        ref: refId, kind: ref.kind,
        name: own ? own.name : t("buildup.item." + refId),
        unit: ref.unit, qty: qty, waste: waste || 0,
        price: own ? round2(own.price) : round2(ref.price * region.factor),
        source: own ? "priceList" : "reference"
    };
}

/* A draft build-up for a measurement row, or null when no recipe fits. */
function suggestBuildUp(row, project) {
    const text = String((row && row.description) || "");
    const unit = String((row && row.unit) || "");
    const recipe = RECIPES.find(r => r.words.test(text) && (!unit || r.unit.test(unit)));
    if (!recipe) return null;
    return {
        recipe: recipe.id,
        items: recipe.material.map(m => component(m[0], m[1], m[2], project))
            .concat(recipe.labour.map(l => component(l[0], l[1], 0, project)))
            .concat(recipe.plant.map(p => component(p[0], p[1], 0, project))),
        ohp: 15
    };
}

/* The rate a build-up gives, with its parts. */
function buildUpRate(b) {
    const sum = kind => round2(((b && b.items) || []).filter(i => i.kind === kind)
        .reduce((s, i) => s + (Number(i.qty) || 0) * (1 + (Number(i.waste) || 0)) * (Number(i.price) || 0), 0));
    const material = sum("material"), labour = sum("labour"), plant = sum("plant");
    const net = round2(material + labour + plant);
    const ohpPct = b && b.ohp !== undefined && b.ohp !== "" ? Number(b.ohp) || 0 : 15;
    const ohp = round2(net * ohpPct / 100);
    return { material: material, labour: labour, plant: plant, net: net, ohpPct: ohpPct, ohp: ohp, rate: round2(net + ohp) };
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
   item (star rates) marked. `stars` is the set of row indexes. */
function renderBuildUpCard(vo, project, opts) {
    const o = opts || {};
    const rows = (vo.measurement || []);
    if (!rows.length) return '<div class="empty-state">' + escapeHtml(t("buildup.noRows")) + "</div>";
    const i = Math.min(Math.max(0, o.rowIndex || 0), rows.length - 1);
    const row = rows[i];
    const b = row.buildUp || suggestBuildUp(row, project) || { items: [], ohp: 15 };
    const drafted = !row.buildUp && b.items.length > 0;
    const r = buildUpRate(b);
    const region = regionOf(project);
    const dis = o.editable ? "" : " disabled";
    const num = (k, j, v, step) => '<input type="number" min="0" step="' + step + '" data-bu="' + k + '" data-i="' + j + '" value="' + escapeHtml(String(v)) + '"' + dis + ">";
    const pct = v => Math.round((Number(v) || 0) * 1000) / 10;
    const kindOrder = ["material", "labour", "plant"];
    const body = kindOrder.map(kind => {
        const list = b.items.map((it, j) => ({ it: it, j: j })).filter(x => x.it.kind === kind);
        return '<tr class="bu-kind"><th colspan="7">' + escapeHtml(t("buildup.kind." + kind)) + "</th></tr>" +
            list.map(x => "<tr>" +
                '<td><input type="text" data-bu="name" data-i="' + x.j + '" value="' + escapeHtml(x.it.name) + '"' + dis + "></td>" +
                "<td>" + num("qty", x.j, x.it.qty, "0.01") + ' <span class="rate-detail">' + escapeHtml(x.it.unit || "") + "</span></td>" +
                "<td>" + (kind === "material" ? num("waste", x.j, pct(x.it.waste), "1") + " %" : "") + "</td>" +
                "<td>" + num("price", x.j, x.it.price, "0.01") + "</td>" +
                '<td><span class="bu-src bu-src-' + escapeHtml(x.it.source || "manual") + '">' + escapeHtml(t("buildup.src." + (x.it.source || "manual"))) + "</span></td>" +
                '<td class="num">' + rm((Number(x.it.qty) || 0) * (1 + (Number(x.it.waste) || 0)) * (Number(x.it.price) || 0)) + "</td>" +
                "<td>" + (o.editable ? '<button type="button" class="link-button bu-remove" data-i="' + x.j + '" aria-label="' + escapeHtml(t("buildup.remove")) + '">×</button>' : "") + "</td>" +
            "</tr>").join("") +
            (o.editable ? '<tr><td colspan="7"><button type="button" class="link-button bu-add" data-kind="' + kind + '">' + escapeHtml(t("buildup.add." + kind)) + "</button></td></tr>" : "");
    }).join("");

    const plant = b.items.filter(it => it.kind === "plant");
    const rentBlock = plant.length ? fold("bu-rent", escapeHtml(t("buildup.rentTitle")), renderRentOrBuy(plant, o.rent || {})) : "";
    const pl = (project && project.priceList) || [];
    const priceBlock = fold("bu-pricelist", escapeHtml(t("buildup.priceListTitle", { n: pl.length })),
        '<p class="assistant-note">' + escapeHtml(t("buildup.priceListNote")) + "</p>" +
        (pl.length ? '<ul class="bu-pl">' + pl.map(p => "<li>" + escapeHtml(p.name) + " — " + rm(p.price) + "/" + escapeHtml(p.unit || "") + "</li>").join("") + "</ul>" : "") +
        (o.canEditPriceList ? '<textarea id="buPriceListInput" rows="4" placeholder="' + escapeHtml(t("buildup.priceListPh")) + '"></textarea>' +
            '<button type="button" class="secondary-button" id="buPriceListSave">' + escapeHtml(t("buildup.priceListSave")) + "</button>" : ""));

    return '<div class="bu-head">' +
            '<label>' + escapeHtml(t("buildup.row")) + ' <select id="buRow">' + rows.map((x, k) =>
                '<option value="' + k + '"' + (k === i ? " selected" : "") + ">" + (o.stars && o.stars.has(k) ? "★ " : "") +
                escapeHtml((k + 1) + ". " + (x.description || t("buildup.untitledRow")) + (x.unit ? " (" + x.unit + ")" : "")) + "</option>").join("") +
            "</select></label>" +
            '<span class="rate-detail">' + escapeHtml(t("buildup.region." + region.from, { region: t("buildup.regionName." + region.id), f: region.factor.toFixed(2) })) + "</span>" +
        "</div>" +
        (o.stars && o.stars.has(i) ? '<p class="assistant-note">' + escapeHtml(t("buildup.starNote")) + "</p>" : "") +
        (drafted ? '<p class="assistant-note">' + escapeHtml(t("buildup.drafted")) + "</p>" : "") +
        (!b.items.length ? '<p class="assistant-note">' + escapeHtml(t("buildup.noRecipe")) + "</p>" : "") +
        '<div class="table-scroll"><table class="bu-table"><thead><tr>' +
            ["item", "qty", "waste", "price", "source", "amount", ""].map(h => "<th>" + (h ? escapeHtml(t("buildup.col." + h)) : "") + "</th>").join("") +
        "</tr></thead><tbody>" + body + "</tbody></table></div>" +
        '<div class="bu-totals">' +
            ["material", "labour", "plant", "net"].map(k => "<div><small>" + escapeHtml(t("buildup.total." + k)) + "</small><strong>" + rm(r[k]) + "</strong></div>").join("") +
            "<div><small>" + escapeHtml(t("buildup.total.ohp")) + " " + num("ohp", -1, r.ohpPct, "0.5") + " %</small><strong>" + rm(r.ohp) + "</strong></div>" +
            '<div class="bu-rate"><small>' + escapeHtml(t("buildup.total.rate", { unit: row.unit || t("buildup.unit") })) + "</small><strong>" + rm(r.rate) + "</strong></div>" +
        "</div>" +
        (o.useAs ? '<button type="button" class="primary-button" id="buUseRate">' + escapeHtml(t("buildup.use." + o.useAs, { rate: rm(r.rate) })) + "</button>" : "") +
        rentBlock + priceBlock +
        '<p class="assistant-note">' + escapeHtml(t("buildup.note")) + "</p>";
}

/* Rent or buy, for each plant item of the build-up that has a purchase
   price; `state` keeps what the person typed (months, prices). */
function renderRentOrBuy(plant, state) {
    return plant.map(it => {
        const ref = REFERENCE_PRICES.find(r => r.id === it.ref) || {};
        const s = state[it.ref || it.name] || {};
        const months = s.months !== undefined ? s.months : 3;
        const rentPerMonth = s.rentPerMonth !== undefined ? s.rentPerMonth : Math.round((Number(it.price) || 0) * 8 * 22);
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
    module.exports = { REGIONS, REFERENCE_PRICES, RECIPES, regionOf, priceListMatch, suggestBuildUp, buildUpRate, rentOrBuy, parsePriceList,
        renderBuildUpCard, renderRentOrBuy };
}
