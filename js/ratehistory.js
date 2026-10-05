/* VO-AI | ratehistory.js
   Past project rates — the firm's experience, used when a VO item has
   no comparable item in this project's contract BQ (a star rate).

   Where the rates come from:
   - PAST_PROJECTS below: a sample library standing in for the firm's
     completed projects (demo data, marked as such on screen);
   - every OTHER project in this browser's register: its contract BQ
     items, and the rates agreed on its VOs that had no BQ item.

   For a star-rated row it finds the comparable past items, suggests the
   median of their rates and lists every source, so the figure can be
   checked and argued — never a number without its evidence. The
   consultant can then add it to this project's BQ as a new item
   (newBqItemFromRow), and the row is checked against it from then on. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { uid } = require("./store.js");
}

/* Demo sample: three completed projects. Not real tenders. */
var PAST_PROJECTS = [
    {
        id: "PAST-SERI-MURNI", name: "Taman Seri Murni Phase 2", year: 2024,
        rates: [
            { code: "B/3.4", description: "Marble floor tiles 600x600mm polished", unit: "m2", rate: 235, basis: "agreed" },
            { code: "B/3.1", description: "Ceramic floor tiles 600x600mm", unit: "m2", rate: 80, basis: "bq" },
            { code: "D/2.6", description: "Precast concrete sump 600x600mm with cover", unit: "no", rate: 1080, basis: "bq" },
            { code: "B/3.9", description: "Timber skirting 100mm high", unit: "m", rate: 18, basis: "bq" }
        ]
    },
    {
        id: "PAST-BAYU", name: "Residensi Bayu Kondominium", year: 2025,
        rates: [
            { code: "F/1.2", description: "Marble floor tiles 600x600mm to lobby", unit: "m2", rate: 255, basis: "bq" },
            { code: "F/1.5", description: "Granite floor tiles 600x600mm", unit: "m2", rate: 190, basis: "bq" },
            { code: "H/4.3", description: "Precast concrete sump 600x600mm with heavy duty cover", unit: "no", rate: 1180, basis: "bq" }
        ]
    },
    {
        id: "PAST-PUCHONG", name: "Sekolah Menengah Puchong Blok B", year: 2023,
        rates: [
            { code: "VO-012/1", description: "Marble floor tiles 600x600mm", unit: "m2", rate: 228, basis: "agreed" },
            { code: "C/5.2", description: "Precast concrete sump 600x600mm with cover", unit: "no", rate: 1020, basis: "agreed" },
            { code: "C/5.1", description: "Precast concrete sump 450x450mm with cover", unit: "no", rate: 760, basis: "bq" },
            { code: "C/4.1", description: "100mm dia uPVC drainage pipe", unit: "m", rate: 45, basis: "bq" }
        ]
    }
];

/* Words that say what is being done or where, not what the item is. */
var PAST_RATE_FILLER = new Set([
    "to", "and", "the", "of", "with", "incl", "including", "complete", "in", "on", "for", "at", "as",
    "add", "omit", "new", "additional", "extra", "supply", "install", "provide", "lay", "laid", "fix", "match"
]);

function pastRateWords(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
        .split(" ").filter(w => w && !PAST_RATE_FILLER.has(w));
}

/* "600x600mm", "900 x 2100" -> "600x600": a size that must agree. */
function sizeTokens(text) {
    const out = [];
    const re = /(\d+)\s*x\s*(\d+)/gi;
    let m;
    while ((m = re.exec(String(text || "")))) out.push(m[1] + "x" + m[2]);
    return out;
}

/* Every past rate on record, newest project first. `db` is the register
   ({projects}); the project being assessed is left out — its own BQ was
   already checked and found nothing. */
function pastRateSources(db, currentProjectId) {
    const sources = [];
    PAST_PROJECTS.forEach(p => p.rates.forEach(r => sources.push(Object.assign({
        project: p.name, year: p.year, sample: true
    }, r))));

    ((db && db.projects) || []).forEach(p => {
        if (p.id === currentProjectId) return;
        const year = Number(String(p.createdAt || "").slice(0, 4)) || null;
        (p.bq || []).forEach(item => sources.push({
            project: p.name, year: year, code: item.code, description: item.description,
            unit: item.unit, rate: Number(item.rate) || 0, basis: item.origin ? "agreed" : "bq"
        }));
        (p.vos || []).forEach(vo => (vo.measurement || []).forEach(row => {
            /* an agreed rate: no BQ item, and the consultant set one */
            if (row.bqItemId || !(Number(row.assessedRate) > 0)) return;
            sources.push({
                project: p.name, year: year, code: vo.no, description: row.description,
                unit: row.unit, rate: Number(row.assessedRate), basis: "agreed"
            });
        }));
    });

    return sources
        .filter(s => s.rate > 0)
        .sort((a, b) => (b.year || 0) - (a.year || 0));
}

/* What an item is made of decides its price more than any other word:
   "ceramic floor tiles 600x600mm" shares three words with the marble
   ones and is still no evidence for them. Every material the row names
   must be named by the past item too. */
var MATERIAL_WORDS = new Set([
    "marble", "granite", "ceramic", "porcelain", "homogeneous", "terrazzo", "quartz", "vinyl", "carpet",
    "timber", "plywood", "laminate", "concrete", "precast", "steel", "stainless", "aluminium", "aluminum",
    "upvc", "pvc", "hdpe", "brick", "block", "plasterboard", "gypsum", "glass", "copper", "cement"
]);

var PAST_RATE_THRESHOLD = 0.7;

/* How alike a row and a past item are: 0 to 1 (Dice overlap of their
   significant words), or 0 outright when the units or the sizes differ
   — a 450x450 sump is not evidence for a 600x600 one. */
function pastRateScore(row, source) {
    const rowUnit = String(row.unit || "").trim().toLowerCase();
    const srcUnit = String(source.unit || "").trim().toLowerCase();
    if (rowUnit && srcUnit && rowUnit !== srcUnit) return 0;

    const rowSizes = sizeTokens(row.description);
    const srcSizes = sizeTokens(source.description);
    if (rowSizes.length && srcSizes.length && !rowSizes.some(s => srcSizes.indexOf(s) !== -1)) return 0;

    const a = new Set(pastRateWords(row.description));
    const b = new Set(pastRateWords(source.description));
    if (a.size === 0 || b.size === 0) return 0;
    for (const w of a) if (MATERIAL_WORDS.has(w) && !b.has(w)) return 0;
    let overlap = 0;
    a.forEach(w => { if (b.has(w)) overlap++; });
    if (overlap < 2) return 0;
    return (2 * overlap) / (a.size + b.size);
}

function median(values) {
    const v = values.slice().sort((x, y) => x - y);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/* The comparable past rates for one measurement row and the rate they
   suggest, or null when the firm has no comparable experience.
   { rate, low, high, count, matches: [source + score] } */
function suggestPastRate(row, sources) {
    const matches = (sources || [])
        .map(s => Object.assign({ score: pastRateScore(row, s) }, s))
        .filter(s => s.score >= PAST_RATE_THRESHOLD)
        .sort((x, y) => y.score - x.score || (y.year || 0) - (x.year || 0))
        .slice(0, 5);
    if (matches.length === 0) return null;
    const rates = matches.map(m => m.rate);
    return {
        rate: Math.round(median(rates) * 100) / 100,
        low: Math.min.apply(null, rates),
        high: Math.max.apply(null, rates),
        count: matches.length,
        matches: matches
    };
}

/* A new item for this project's BQ, made from a star-rated row: coded
   after its VO ("VO-002/1", "VO-002/2", ...) so where it came from is
   plain in every list, and carrying the past rates it was based on. */
function newBqItemFromRow(row, vo, project, rate, suggestion, todayIso) {
    const prefix = vo.no + "/";
    const taken = (project.bq || []).filter(b => String(b.code || "").indexOf(prefix) === 0).length;
    return {
        id: uid("BQ"),
        code: prefix + (taken + 1),
        description: String(row.description || "").replace(/^\s*(add|additional|new|supply and install)\s+/i, "")
            .replace(/^./, c => c.toUpperCase()),
        unit: row.unit,
        rate: Number(rate),
        origin: {
            voNo: vo.no,
            at: todayIso,
            suggestedRate: suggestion ? suggestion.rate : null,
            basedOn: suggestion
                ? suggestion.matches.map(m => ({ project: m.project, year: m.year, code: m.code, rate: m.rate }))
                : []
        }
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        PAST_PROJECTS, pastRateSources, pastRateScore, suggestPastRate, newBqItemFromRow, sizeTokens
    };
}
