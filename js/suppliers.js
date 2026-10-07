/* VO-AI | suppliers.js — building suppliers and plant hire near the site.

   For the cost planning card: where the materials and plant of a
   built-up rate can be bought or hired near the project's site, from
   OpenStreetMap (the Overpass API, free, no key), nearest first:
     - "materials": hardware, building materials, tiles, flooring, paint,
       sanitary ware, timber (shop=hardware|doityourself|trade|tiles|...);
     - "hire": tool and plant hire (shop=tool_hire, or a trade shop or
       company whose name says rental / hire / sewa).
   Each with its distance from the site, address and phone when OSM has
   them, and a link to directions. OSM's coverage varies; the list says
   what it found and never invents a shop.

   The query runs in the browser, only when the person asks. Pure parts
   are tested in test/suppliers.test.js. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
    var { escapeHtml } = require("./ui.js");
    var { metresBetween, siteOf } = require("./sitemap.js");
}

var OVERPASS_URL = "https://overpass-api.de/api/interpreter";
var SUPPLIER_RADIUS_M = 10000;
var MATERIAL_SHOPS = ["hardware", "doityourself", "trade", "tiles", "flooring", "paint", "building_materials", "bathroom_furnishing", "timber", "glaziery"];
var HIRE_WORDS = /\b(rental|rent|hire|hiring|sewa|leasing)\b|租/i;

function supplierQuery(site, radius) {
    const r = Math.round(radius || SUPPLIER_RADIUS_M);
    const at = "(around:" + r + "," + site.lat + "," + site.lng + ")";
    return "[out:json][timeout:25];(" +
        "nwr" + at + '["shop"~"^(' + MATERIAL_SHOPS.concat(["tool_hire"]).join("|") + ')$"];' +
        "nwr" + at + '["craft"="builder"]["name"];' +
        "nwr" + at + '["office"="company"]["name"~"rental|hire|sewa|machinery|equipment",i];' +
        ");out center tags 120;";
}

function supplierKind(tags) {
    if (tags.shop === "tool_hire" || HIRE_WORDS.test(tags.name || "") || HIRE_WORDS.test(tags.description || "")) return "hire";
    if (tags.office === "company") return /machinery|equipment/i.test(tags.name || "") ? "hire" : null;
    return "materials";
}

function addressOf(tags) {
    const line = [[tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
                  tags["addr:city"] || tags["addr:suburb"], tags["addr:postcode"]].filter(Boolean).join(", ");
    return line || tags["addr:full"] || "";
}

/* Overpass's answer → [{id, name, kind, metres, lat, lng, address,
   phone, hours, website}], named places only, nearest first. */
function parseSuppliers(json, site) {
    const seen = new Set();
    return ((json && json.elements) || []).map(e => {
        const tags = e.tags || {};
        const lat = e.lat !== undefined ? e.lat : e.center && e.center.lat;
        const lng = e.lon !== undefined ? e.lon : e.center && e.center.lon;
        const kind = supplierKind(tags);
        if (!tags.name || !kind || typeof lat !== "number" || typeof lng !== "number") return null;
        return {
            id: e.type + "/" + e.id, name: tags.name, kind: kind,
            what: tags.shop || tags.craft || tags.office || "",
            metres: metresBetween(site, { lat: lat, lng: lng }), lat: lat, lng: lng,
            address: addressOf(tags), phone: tags.phone || tags["contact:phone"] || "",
            hours: tags.opening_hours || "", website: tags.website || tags["contact:website"] || ""
        };
    }).filter(x => {
        if (!x) return false;
        const key = x.name.toLowerCase() + "|" + Math.round(x.lat * 1000) + "|" + Math.round(x.lng * 1000);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => a.metres - b.metres);
}

function distanceText(m) {
    return m < 1000 ? t("suppliers.m", { m: m }) : t("suppliers.km", { km: (m / 1000).toFixed(1) });
}

function renderSupplierList(list, kind, max) {
    const items = list.filter(s => s.kind === kind).slice(0, max || 8);
    if (!items.length) return '<p class="assistant-note">' + escapeHtml(t("suppliers.none." + kind)) + "</p>";
    return '<ul class="supplier-list">' + items.map(s =>
        "<li><div><strong>" + escapeHtml(s.name) + "</strong> " +
            '<span class="rate-detail">' + escapeHtml(distanceText(s.metres)) +
            (s.what ? " · " + escapeHtml(t("suppliers.what." + s.what) !== "suppliers.what." + s.what ? t("suppliers.what." + s.what) : s.what) : "") + "</span></div>" +
            (s.address ? '<div class="rate-detail">' + escapeHtml(s.address) + "</div>" : "") +
            '<div class="supplier-links">' +
                (s.phone ? '<a href="tel:' + escapeHtml(s.phone.replace(/[^\d+]/g, "")) + '">' + escapeHtml(s.phone) + "</a>" : "") +
                (s.hours ? '<span class="rate-detail">' + escapeHtml(s.hours) + "</span>" : "") +
                '<a href="https://www.google.com/maps/dir/?api=1&destination=' + s.lat + "," + s.lng + '" target="_blank" rel="noopener">' + escapeHtml(t("suppliers.directions")) + "</a>" +
                '<a href="https://www.openstreetmap.org/' + escapeHtml(s.id) + '" target="_blank" rel="noopener">OSM</a>' +
            "</div></li>").join("") + "</ul>";
}

/* state: null (not asked), {loading}, {error}, {list} */
function renderSuppliers(project, state) {
    const site = siteOf(project);
    if (!site) return '<p class="assistant-note">' + escapeHtml(t("suppliers.noSite")) + "</p>";
    const btn = '<button type="button" class="secondary-button" id="findSuppliersBtn"' + (state && state.loading ? " disabled" : "") + ">" +
        escapeHtml(t(state && state.list ? "suppliers.again" : "suppliers.find", { km: SUPPLIER_RADIUS_M / 1000 })) + "</button>";
    let body = "";
    if (state && state.loading) body = '<p class="assistant-note">' + escapeHtml(t("suppliers.loading")) + "</p>";
    else if (state && state.error) body = '<p class="assistant-note">' + escapeHtml(t("suppliers.error", { reason: state.error })) + "</p>";
    else if (state && state.list) {
        body = '<p class="assistant-note">' + escapeHtml(t("suppliers.found", { n: state.list.length, km: SUPPLIER_RADIUS_M / 1000 })) + "</p>" +
            '<div class="supplier-cols"><div><h5>' + escapeHtml(t("suppliers.materials")) + "</h5>" + renderSupplierList(state.list, "materials") + "</div>" +
            "<div><h5>" + escapeHtml(t("suppliers.hire")) + "</h5>" + renderSupplierList(state.list, "hire") + "</div></div>";
    }
    return btn + body + '<p class="assistant-note">' + escapeHtml(t("suppliers.note")) + "</p>";
}

async function findSuppliers(project) {
    const site = siteOf(project);
    const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(supplierQuery(site))
    });
    if (!res.ok) throw new Error("OpenStreetMap " + res.status);
    return parseSuppliers(await res.json(), site);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { supplierQuery, supplierKind, parseSuppliers, renderSuppliers, renderSupplierList, SUPPLIER_RADIUS_M };
}
