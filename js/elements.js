/* VO-AI | elements.js
   Building element knowledge base. Captures the ordinary-practice fact
   that a change instructed against one element commonly requires
   re-measurement of others — e.g. "change block wall to brick wall"
   also touches the wall finishes, the DPC and the skirting. This is a
   deterministic lookup table, not a generated guess: every relationship
   below is standard QS/construction knowledge, and the table is kept
   deliberately conservative — a relationship is only listed here when
   it is genuinely standard practice, because a wrong prompt wastes a
   QS's time and undermines trust in every other prompt.

   Detection: `keywords` are matched against a description as
   case-insensitive whole-word regexes (built from plain strings here
   for readability; see keywordPattern below for how they become
   regexes). A description can name several elements at once — e.g.
   "change block wall to brick wall, make good wall finishes and DPC"
   — and detectElements finds all of them.
----------------------------------------------------------- */

const ELEMENTS = [
    {
        id: "wall",
        name: "Wall",
        keywords: ["wall", "block wall", "brick wall", "blockwork", "brickwork", "partition"],
        related: ["wall-finishes", "dpc", "skirting", "painting"],
        note: "Changing the wall construction commonly requires the applied finish, damp-proof " +
              "course and abutting skirting to be re-measured, and the exposed new surface repainted."
    },
    {
        id: "wall-finishes",
        name: "Wall finishes",
        keywords: ["wall finish", "wall finishes", "plaster", "plastering", "render", "wall tile", "wall tiling"],
        related: ["painting"],
        note: "A change of wall finish changes the surface the paint is applied to, so the " +
              "painting quantity commonly needs re-measurement as well."
    },
    {
        id: "dpc",
        name: "DPC (damp-proof course)",
        keywords: ["dpc", "damp-proof course", "damp proof course", "damp course"],
        related: ["wall"],
        note: "The DPC is built into the wall at a specific course, so a wall change and a DPC " +
              "change are normally measured together."
    },
    {
        id: "floor-finishes",
        name: "Floor finishes",
        keywords: ["floor finish", "floor finishes", "floor tile", "floor tiling", "flooring", "screeding to floor"],
        related: ["skirting", "screed"],
        note: "A change of floor finish commonly requires the skirting that abuts it (chosen to " +
              "match the floor) and the screed bed under it to be re-measured too."
    },
    {
        id: "skirting",
        name: "Skirting",
        keywords: ["skirting"],
        related: ["floor-finishes"],
        note: "Skirting is selected and fixed to match the floor finish it sits against, so a " +
              "floor finish change commonly changes the skirting too."
    },
    {
        id: "screed",
        name: "Screed",
        keywords: ["screed", "screeding"],
        related: ["floor-finishes"],
        note: "Screed is the bedding layer under a floor finish, so a change to one commonly " +
              "requires the other to be checked."
    },
    {
        id: "ceiling",
        name: "Ceiling",
        keywords: ["ceiling", "plasterboard ceiling", "suspended ceiling"],
        related: ["cornice", "electrical"],
        note: "Changing the ceiling commonly requires the cornice fixed to it to be re-measured, " +
              "and any light fittings recessed into or mounted on it to be checked."
    },
    {
        id: "cornice",
        name: "Cornice",
        keywords: ["cornice", "coving", "cove"],
        related: ["ceiling"],
        note: "Cornice is fixed at the wall-ceiling junction, so a ceiling change commonly " +
              "requires the cornice to be re-measured with it."
    },
    {
        id: "door",
        name: "Door",
        keywords: ["door", "doorset", "door leaf"],
        related: ["ironmongery", "door-frame"],
        note: "A door change commonly requires the ironmongery fitted to it and the frame it " +
              "hangs from to be re-measured, since these are usually specified and priced together."
    },
    {
        id: "ironmongery",
        name: "Ironmongery",
        keywords: ["ironmongery", "door handle", "hinges", "door closer", "lockset"],
        related: ["door"],
        note: "Ironmongery is selected to suit a specific door, so a door change commonly changes " +
              "the ironmongery as well."
    },
    {
        id: "door-frame",
        name: "Door frame",
        keywords: ["door frame", "doorframe", "door jamb"],
        related: ["door"],
        note: "The frame is sized and fixed to suit the door it carries, so the two are commonly " +
              "changed together."
    },
    {
        id: "window",
        name: "Window",
        keywords: ["window", "window unit"],
        related: ["glazing", "window-sill"],
        note: "A window change commonly requires the glazing fitted to it and the sill beneath " +
              "it to be re-measured, since these are usually specified and priced together."
    },
    {
        id: "glazing",
        name: "Glazing",
        keywords: ["glazing", "glass", "glazed"],
        related: ["window"],
        note: "Glazing is sized and specified to suit a particular window, so a window change " +
              "commonly changes the glazing as well."
    },
    {
        id: "window-sill",
        name: "Window sill",
        keywords: ["window sill", "windowsill", "sill"],
        related: ["window"],
        note: "The sill is built to suit the window opening it sits under, so the two are " +
              "commonly changed together."
    },
    {
        id: "roof",
        name: "Roof",
        keywords: ["roof", "roofing", "roof covering"],
        related: ["drainage"],
        note: "A roof change commonly requires the rainwater drainage (gutters and downpipes) " +
              "serving it to be re-measured."
    },
    {
        id: "structural-frame",
        name: "Structural frame",
        keywords: ["structural frame", "column", "beam", "slab", "rebar", "reinforcement", "concrete frame"],
        related: [],
        note: ""
    },
    {
        id: "drainage",
        name: "Drainage",
        keywords: ["drainage", "drain", "sewer", "manhole", "downpipe", "gutter", "rainwater pipe"],
        related: [],
        note: ""
    },
    {
        id: "electrical",
        name: "Electrical",
        keywords: ["electrical", "wiring", "light fitting", "lighting", "socket", "switch", "db board", "distribution board"],
        related: [],
        note: ""
    },
    {
        id: "plumbing",
        name: "Plumbing",
        keywords: ["plumbing", "sanitary", "water pipe", "pipework", "toilet", "sanitary fitting"],
        related: [],
        note: ""
    },
    {
        id: "painting",
        name: "Painting",
        keywords: ["paint", "painting", "emulsion", "coating"],
        related: [],
        note: ""
    }
];

/* Build a case-insensitive, whole-phrase regex from a plain keyword
   string. Phrases may contain spaces or hyphens; \b works either side
   because every keyword starts and ends with a word character. */
/* The same elements as a contractor writes them in Chinese. Added to
   each element's keywords, so a description recorded on site in Chinese
   is checked for consequential work exactly like an English one. */
const ELEMENT_KEYWORDS_ZH = {
    "wall": ["墙", "砖墙", "砌块墙", "隔墙", "砌墙"],
    "wall-finishes": ["墙面饰面", "批荡", "抹灰", "墙砖", "墙面砖"],
    "dpc": ["防潮层"],
    "floor-finishes": ["地砖", "地面饰面", "地板", "大理石", "瓷砖", "地面"],
    "skirting": ["踢脚线", "踢脚"],
    "screed": ["找平层", "水泥砂浆找平"],
    "ceiling": ["天花", "吊顶", "天棚"],
    "cornice": ["线脚", "顶角线"],
    "door": ["门"],
    "ironmongery": ["五金", "门锁", "门铰"],
    "door-frame": ["门框"],
    "window": ["窗"],
    "glazing": ["玻璃"],
    "window-sill": ["窗台"],
    "roof": ["屋顶", "屋面"],
    "structural-frame": ["梁", "柱", "楼板", "结构"],
    "drainage": ["排水", "污水", "集水井", "沙井", "排水管"],
    "electrical": ["电线", "插座", "灯具", "配电"],
    "plumbing": ["水喉", "给水", "卫浴", "洁具"],
    "painting": ["油漆", "涂料", "刷漆"]
};
ELEMENTS.forEach(el => { el.keywords = el.keywords.concat(ELEMENT_KEYWORDS_ZH[el.id] || []); });

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* English keywords match whole words; Chinese has no spaces between
   words, so a Chinese keyword matches anywhere in the text. */
function keywordPattern(keyword) {
    if (/[\u4e00-\u9fff]/.test(keyword)) return new RegExp(escapeRegExp(keyword));
    return new RegExp("\\b" + escapeRegExp(keyword) + "\\b", "i");
}

/* Elements whose keywords appear in the text, most specific first —
   "most specific" meaning the element with the longest matching
   keyword sorts first (e.g. "block wall" outranks a bare "wall" match
   when both are present, since it is the more informative signal).
   Returns [] rather than a guess when nothing matches. */
function detectElements(text) {
    const t = text || "";
    const hits = [];
    ELEMENTS.forEach(el => {
        let longestMatch = 0;
        const found = el.keywords.some(k => {
            if (keywordPattern(k).test(t)) {
                if (k.length > longestMatch) longestMatch = k.length;
                return true;
            }
            return false;
        });
        if (found) hits.push({ element: el, longestMatch: longestMatch });
    });
    hits.sort((a, b) => b.longestMatch - a.longestMatch);
    return hits.map(h => h.element);
}

/* Related elements for the given (already-detected) element ids,
   excluding any element already in that same detected set, paired
   with the note explaining the relationship. De-duplicated: an
   element related to more than one detected id appears once, with
   the note from the first detected id that names it. */
function relatedElements(ids) {
    const idSet = new Set(ids);
    const seen = new Set();
    const out = [];
    ids.forEach(id => {
        const el = ELEMENTS.find(e => e.id === id);
        if (!el) return;
        el.related.forEach(relId => {
            if (idSet.has(relId) || seen.has(relId)) return;
            const relEl = ELEMENTS.find(e => e.id === relId);
            if (!relEl) return;
            seen.add(relId);
            out.push({ element: relEl, note: el.note, because: el.id });
        });
    });
    return out;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { ELEMENTS, detectElements, relatedElements };
}
