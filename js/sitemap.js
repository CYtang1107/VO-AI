/* VO-AI | sitemap.js — where the site is, and where each site photo was
   taken, on an OpenStreetMap map (Leaflet).

   - The project's site: project.site = {lat, lng, address}, set by the
     consultant on the dashboard map (address search through OpenStreetMap's
     Nominatim, or a click on the map).
   - A site photo's place: doc.geo = {lat, lng, acc, src}, recorded when the
     contractor takes it on the phone (js/page-capture.js): the photo's own
     EXIF GPS when it has one, else the phone's position at that moment.
   - The map: on the dashboard (every VO's photos) and on a VO page (that
     VO's photos), each pin opening the photo.

   The map needs the internet (Leaflet and the map tiles come from the
   web); without it the card says so and the rest of the page is unchanged. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
    var { escapeHtml } = require("./ui.js");
}

var LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
var LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
var OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
var OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
/* Satellite view: Esri World Imagery, with Esri's place names on top. */
var SAT_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
var SAT_LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
var SAT_ATTRIBUTION = "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community";
var MAP_VIEW_KEY = "voai.mapView.v1";
var GEO_FIELDS = ["supportingDocs", "revisedDrawing", "oldDrawing", "contractDocs"];

/* ---------- pure (tested in test/sitemap.test.js) ---------- */

function validLatLng(lat, lng) {
    return typeof lat === "number" && typeof lng === "number" && isFinite(lat) && isFinite(lng) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

/* The GPS position a JPEG's EXIF records, or null. */
function exifGps(buffer) {
    try {
        const v = new DataView(buffer);
        if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
        let off = 2;
        while (off + 4 <= v.byteLength) {
            const marker = v.getUint16(off);
            const size = v.getUint16(off + 2);
            if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return tiffGps(v, off + 10);
            if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) return null;
            off += 2 + size;
        }
    } catch (e) { /* not a readable JPEG */ }
    return null;
}

function tiffGps(v, tiff) {
    const little = v.getUint16(tiff) === 0x4949;
    const u16 = o => v.getUint16(o, little);
    const u32 = o => v.getUint32(o, little);
    function entries(ifd) {
        const n = u16(ifd), out = {};
        for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
        }
        return out;
    }
    const ifd0 = entries(tiff + u32(tiff + 4));
    if (!ifd0[0x8825]) return null;
    const gps = entries(tiff + u32(ifd0[0x8825].at));
    function ref(tag) {
        const e = gps[tag];
        return e ? String.fromCharCode(v.getUint8(e.at)) : "";
    }
    function dms(tag) {
        const e = gps[tag];
        if (!e || e.type !== 5 || e.count < 3) return null;
        const p = tiff + u32(e.at);
        const r = k => { const d = u32(p + k * 8 + 4); return d ? u32(p + k * 8) / d : 0; };
        return r(0) + r(1) / 60 + r(2) / 3600;
    }
    let lat = dms(2), lng = dms(4);
    if (lat === null || lng === null) return null;
    if (ref(1) === "S") lat = -lat;
    if (ref(3) === "W") lng = -lng;
    return validLatLng(lat, lng) ? { lat: round6(lat), lng: round6(lng) } : null;
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

/* Where a photo was: its EXIF GPS if it has one, else the phone's
   position if it is recent (taken within the last 10 minutes). */
function photoGeo(exif, position, nowMs) {
    if (exif && validLatLng(exif.lat, exif.lng)) return { lat: exif.lat, lng: exif.lng, src: "exif" };
    if (position && validLatLng(position.lat, position.lng) && nowMs - position.at <= 10 * 60 * 1000) {
        return { lat: round6(position.lat), lng: round6(position.lng), acc: Math.round(position.acc || 0), src: "gps" };
    }
    return null;
}

function siteOf(project) {
    const s = project && project.site;
    return s && validLatLng(s.lat, s.lng) ? s : null;
}

/* Every document with a recorded place, one pin each; only `voId`'s when
   given. */
function photoPins(project, voId) {
    const pins = [];
    ((project && project.vos) || []).forEach(vo => {
        if (voId && vo.id !== voId) return;
        GEO_FIELDS.forEach(field => (vo[field] || []).forEach(doc => {
            const g = doc.geo;
            if (!g || !validLatLng(g.lat, g.lng)) return;
            pins.push({ voId: vo.id, voNo: vo.no, docId: doc.id, name: doc.name, at: doc.at || "",
                        lat: g.lat, lng: g.lng, src: g.src || "", doc: doc });
        }));
    });
    return pins;
}

/* Distance in metres between two points (haversine). */
function metresBetween(a, b) {
    const rad = d => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/* The line under the map: how many photos are placed, and how far the
   farthest is from the site (a photo 5 km away is worth a second look). */
function mapSummary(site, pins) {
    if (!site && pins.length === 0) return t("map.none");
    const parts = [];
    if (site) parts.push(t("map.siteAt", { address: site.address || (site.lat.toFixed(5) + ", " + site.lng.toFixed(5)) }));
    if (pins.length) {
        parts.push(t("map.photoCount", { n: pins.length }));
        if (site) {
            const far = Math.max.apply(null, pins.map(p => metresBetween(site, p)));
            parts.push(t(far > 1000 ? "map.farWarning" : "map.farthest", { m: far }));
        }
    }
    return parts.join(" · ");
}

/* ---------- browser ---------- */

/* Leaflet's script AND its stylesheet: a map drawn before the stylesheet
   applies measures itself wrongly (tiles out of place, the view fitted to
   the wrong size, so it opens zoomed out on half the world). */
var leafletReady = null;
function loadLeaflet() {
    if (leafletReady) return leafletReady;
    const css = new Promise(resolve => {
        const el = document.createElement("link");
        el.rel = "stylesheet"; el.href = LEAFLET_CSS; el.setAttribute("data-leaflet", "");
        el.onload = resolve;
        el.onerror = resolve;   /* the map still works, only less tidy */
        document.head.appendChild(el);
    });
    const js = window.L && window.L.map ? Promise.resolve() : new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = LEAFLET_JS;
        el.onload = resolve;
        el.onerror = () => reject(new Error("leaflet"));
        document.head.appendChild(el);
    });
    leafletReady = Promise.all([css, js]).then(() => window.L);
    leafletReady.catch(() => { leafletReady = null; });
    return leafletReady;
}

/* The phone's current position, watched from when the capture page opens,
   so a photo can be placed the moment it is taken. */
var SiteGeo = (function () {
    let last = null, state = "idle";
    function start(onChange) {
        if (typeof navigator === "undefined" || !navigator.geolocation) { state = "unsupported"; onChange && onChange(state); return; }
        state = "waiting"; onChange && onChange(state);
        navigator.geolocation.watchPosition(pos => {
            last = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() };
            state = "ok"; onChange && onChange(state);
        }, err => {
            state = err && err.code === 1 ? "denied" : "unavailable"; onChange && onChange(state);
        }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 });
    }
    return { start: start, position: () => last, state: () => state };
})();

async function photoUrl(doc) {
    if (doc.stored && typeof FileStore !== "undefined") {
        try {
            const rec = await FileStore.get(doc.id);
            if (rec && rec.blob) return URL.createObjectURL(rec.blob);
        } catch (e) { /* not reachable */ }
    }
    return typeof demoFileUrl === "function" ? demoFileUrl(doc) : "";
}

/* Draws the map into `host`. opts: {voId, canSetSite, onSiteSaved}. */
async function drawSiteMap(host, project, opts) {
    const o = opts || {};
    const site = siteOf(project);
    const pins = photoPins(project, o.voId);
    host.innerHTML =
        '<div class="site-map" id="' + host.id + 'Canvas"></div>' +
        '<p class="assistant-note site-map-summary">' + escapeHtml(mapSummary(site, pins)) + "</p>" +
        (o.canSetSite ? '<div class="site-map-set">' +
            '<input type="text" class="site-search" placeholder="' + escapeHtml(t("map.searchPlaceholder")) + '">' +
            '<button type="button" class="secondary-button site-search-btn">' + escapeHtml(t("map.search")) + "</button>" +
            '<span class="assistant-note">' + escapeHtml(t("map.clickToSet")) + "</span></div>" : "");
    let L;
    try { L = await loadLeaflet(); }
    catch (e) { host.querySelector(".site-map").innerHTML = '<div class="empty-state">' + escapeHtml(t("map.offline")) + "</div>"; return; }

    const map = L.map(host.querySelector(".site-map"), { scrollWheelZoom: false });
    /* street map or satellite photo, switched top right; the choice is
       remembered in this browser */
    const street = L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION });
    const satellite = L.layerGroup([
        L.tileLayer(SAT_TILES, { maxZoom: 19, maxNativeZoom: 18, attribution: SAT_ATTRIBUTION }),
        L.tileLayer(SAT_LABELS, { maxZoom: 19, maxNativeZoom: 18 })
    ]);
    let view = "satellite";
    try { view = localStorage.getItem(MAP_VIEW_KEY) === "street" ? "street" : "satellite"; } catch (e) { /* default */ }
    (view === "street" ? street : satellite).addTo(map);
    const layers = {};
    layers[t("map.street")] = street;
    layers[t("map.satellite")] = satellite;
    L.control.layers(layers, null, { collapsed: false, position: "topright" }).addTo(map);
    map.on("baselayerchange", ev => {
        try { localStorage.setItem(MAP_VIEW_KEY, ev.layer === street ? "street" : "satellite"); } catch (e) { /* not kept */ }
    });
    const siteIcon = L.divIcon({ className: "site-pin", html: "<span>⌂</span>", iconSize: [30, 30], iconAnchor: [15, 15] });
    let siteMarker = site ? L.marker([site.lat, site.lng], { icon: siteIcon, title: t("map.site") })
        .bindPopup("<strong>" + escapeHtml(t("map.site")) + "</strong><br>" + escapeHtml(site.address || "")).addTo(map) : null;

    function popupHtml(p, i, inner) {
        return '<div class="site-photo-pop"><strong>' + escapeHtml(p.voNo || "") + "</strong> " + escapeHtml(p.name) +
            '<div class="site-photo-img" data-pin="' + i + '">' + inner + "</div>" +
            '<span class="assistant-note">' + escapeHtml(t(p.src === "exif" ? "map.fromExif" : "map.fromGps")) + "</span>" +
            (o.voId ? "" : '<br><a href="vo.html?id=' + encodeURIComponent(p.voId) + '">' + escapeHtml(t("map.openVo")) + "</a>") + "</div>";
    }
    pins.forEach((p, i) => {
        L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#2546c4", fillOpacity: 0.95 })
            .addTo(map).bindPopup(popupHtml(p, i, escapeHtml(t("map.loadingPhoto"))));
    });
    /* a pin's photo is fetched the first time its popup opens; the popup's
       content is then replaced (setContent), since Leaflet redraws a popup
       from its content whenever it updates */
    const loaded = {};
    map.on("popupopen", async ev => {
        const el = ev.popup.getElement && ev.popup.getElement();
        const box = el && el.querySelector(".site-photo-img[data-pin]");
        if (!box) return;
        const i = Number(box.dataset.pin);
        if (loaded[i] === undefined) {
            loaded[i] = null;
            let url = "";
            try { url = await photoUrl(pins[i].doc); } catch (e) { url = ""; }
            loaded[i] = url ? '<img src="' + url + '" alt="">' : escapeHtml(t("map.photoNotHere"));
            ev.popup.setContent(popupHtml(pins[i], i, loaded[i]));
        }
    });

    const points = pins.map(p => [p.lat, p.lng]).concat(site ? [[site.lat, site.lng]] : []);
    function fitAll() {
        if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 18 });
        else if (points.length === 1) map.setView(points[0], 17);
        else map.setView([3.139, 101.6869], 11);   /* Kuala Lumpur until a site is set */
    }
    fitAll();
    /* once the page has laid itself out, measure again and fit again */
    setTimeout(() => { map.invalidateSize(); fitAll(); }, 250);
    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());
    }

    /* a click on the site or on a photo zooms in to it */
    if (siteMarker) siteMarker.on("click", () => map.flyTo(siteMarker.getLatLng(), 18, { duration: 0.8 }));
    map.eachLayer(layer => {
        if (!(layer instanceof L.CircleMarker)) return;
        /* aim above the pin, so its photo popup fits on the map */
        layer.on("click", () => {
            const z = Math.max(map.getZoom(), 19);
            const centre = map.unproject(map.project(layer.getLatLng(), z).subtract([0, 130]), z);
            map.flyTo(centre, z, { duration: 0.8 });
        });
    });

    if (!o.canSetSite) return;
    function setSite(lat, lng, address) {
        const next = { lat: round6(lat), lng: round6(lng), address: address || "" };
        if (siteMarker) siteMarker.setLatLng([next.lat, next.lng]);
        else {
            siteMarker = L.marker([next.lat, next.lng], { icon: siteIcon }).addTo(map);
            siteMarker.on("click", () => map.flyTo(siteMarker.getLatLng(), 18, { duration: 0.8 }));
        }
        siteMarker.bindPopup("<strong>" + escapeHtml(t("map.site")) + "</strong><br>" + escapeHtml(next.address));
        o.onSiteSaved && o.onSiteSaved(next);
        host.querySelector(".site-map-summary").textContent = mapSummary(next, pins);
    }
    map.on("click", ev => setSite(ev.latlng.lat, ev.latlng.lng, ""));
    async function search() {
        const q = host.querySelector(".site-search").value.trim();
        if (!q) return;
        try {
            const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=my&q=" + encodeURIComponent(q));
            const hit = (await res.json())[0];
            if (!hit) { toast(t("map.notFound", { q: q }), "warn"); return; }
            map.setView([+hit.lat, +hit.lon], 17);
            setSite(+hit.lat, +hit.lon, hit.display_name);
        } catch (e) { toast(t("map.offline"), "warn"); }
    }
    host.querySelector(".site-search-btn").addEventListener("click", search);
    host.querySelector(".site-search").addEventListener("keydown", e => { if (e.key === "Enter") search(); });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { validLatLng, exifGps, photoGeo, siteOf, photoPins, metresBetween, mapSummary };
}
