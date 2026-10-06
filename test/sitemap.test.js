const test = require("node:test");
const assert = require("node:assert");

const { validLatLng, exifGps, photoGeo, siteOf, photoPins, metresBetween, mapSummary } = require("../js/sitemap.js");
const { applySiteRecord } = require("../js/capture.js");
const { seedDB } = require("../js/store.js");

/* A minimal JPEG whose EXIF holds a GPS position, written byte by byte
   (big-endian TIFF), as a phone camera writes it. */
function jpegWithGps(lat, latRef, lng, lngRef) {
    const dms = v => { const d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60 * 100); return [[d, 1], [m, 1], [s, 100]]; };
    const tiff = [];
    const u16 = n => tiff.push((n >> 8) & 255, n & 255);
    const u32 = n => tiff.push((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
    tiff.push(0x4D, 0x4D); u16(42); u32(8);                     // header, IFD0 at 8
    u16(1); u16(0x8825); u16(4); u32(1); u32(26); u32(0);       // IFD0: GPS IFD at 26
    const latAt = 26 + 2 + 4 * 12 + 4, lngAt = latAt + 24;
    u16(4);
    u16(1); u16(2); u32(2); tiff.push(latRef.charCodeAt(0), 0, 0, 0);
    u16(2); u16(5); u32(3); u32(latAt);
    u16(3); u16(2); u32(2); tiff.push(lngRef.charCodeAt(0), 0, 0, 0);
    u16(4); u16(5); u32(3); u32(lngAt);
    u32(0);
    dms(lat).concat(dms(lng)).forEach(([a, b]) => { u32(a); u32(b); });
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0].concat(tiff);
    const size = app1.length + 2;
    return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, size >> 8, size & 255].concat(app1, [0xFF, 0xD9])).buffer;
}

test("a photo's own GPS is read from its EXIF, south and west negative", () => {
    const north = exifGps(jpegWithGps(3.0859, "N", 101.7427, "E"));
    assert.ok(Math.abs(north.lat - 3.0859) < 0.0001 && Math.abs(north.lng - 101.7427) < 0.0001, JSON.stringify(north));
    const south = exifGps(jpegWithGps(33.8688, "S", 151.2093, "W"));
    assert.ok(south.lat < 0 && south.lng < 0);
});

test("a photo without EXIF GPS, or not a JPEG, has no place from EXIF", () => {
    assert.strictEqual(exifGps(new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0, 2]).buffer), null);
    assert.strictEqual(exifGps(new Uint8Array([0x89, 0x50, 0x4E, 0x47]).buffer), null);
    assert.strictEqual(exifGps(new ArrayBuffer(0)), null);
});

test("a photo is placed by its EXIF first, else by a recent phone position, else not at all", () => {
    const now = Date.parse("2026-10-07T10:00:00Z");
    const pos = { lat: 3.1, lng: 101.7, acc: 12.4, at: now - 60000 };
    assert.deepStrictEqual(photoGeo({ lat: 3.2, lng: 101.8 }, pos, now), { lat: 3.2, lng: 101.8, src: "exif" });
    assert.deepStrictEqual(photoGeo(null, pos, now), { lat: 3.1, lng: 101.7, acc: 12, src: "gps" });
    assert.strictEqual(photoGeo(null, Object.assign({}, pos, { at: now - 11 * 60000 }), now), null, "a stale position places nothing");
    assert.strictEqual(photoGeo(null, null, now), null);
    assert.strictEqual(validLatLng(0, 0), false, "0,0 is a GPS failure, not a site");
});

test("a site photo recorded on the phone keeps its place on the VO", () => {
    const vo = { supportingDocs: [] };
    applySiteRecord(vo, { description: "Add door", photos: [
        { id: "P1", name: "a.jpg", size: 1, stored: true, geo: { lat: 3.1, lng: 101.7, src: "gps" } },
        { id: "P2", name: "b.jpg", size: 1, stored: true, geo: null }
    ] }, { name: "Ong" }, "2026-10-07");
    assert.deepStrictEqual(vo.supportingDocs[0].geo, { lat: 3.1, lng: 101.7, src: "gps" });
    assert.ok(!("geo" in vo.supportingDocs[1]));
});

test("pins: every placed document, or one VO's; the demo has a site and a placed photo", () => {
    const project = seedDB().projects[0];
    assert.ok(siteOf(project));
    const all = photoPins(project);
    const perVo = {};
    all.forEach(p => { perVo[p.voNo] = (perVo[p.voNo] || 0) + 1; });
    assert.ok(perVo["VO-001"] >= 2 && perVo["VO-002"] >= 2 && perVo["VO-003"] >= 2, JSON.stringify(perVo));
    assert.ok(photoPins(project, "VO-SEED-2").every(p => p.voNo === "VO-002"));
    assert.ok(all.every(p => /\.jpg$/.test(p.name)), "only photos are placed, not the PDFs");
    assert.strictEqual(photoPins({ vos: [{ id: "V", supportingDocs: [{ id: "x", name: "a.pdf" }] }] }).length, 0);
    assert.strictEqual(siteOf({ site: { lat: "x" } }), null);
});

test("the summary says how far the farthest photo is, and warns past 1 km", () => {
    const site = { lat: 3.0857, lng: 101.7425, address: "Demo site" };
    const near = { lat: 3.08594, lng: 101.74271 };
    assert.ok(metresBetween(site, near) > 20 && metresBetween(site, near) < 60);
    assert.match(mapSummary(site, [near]), /Site: Demo site · 1 photo\(s\) placed · farthest \d+ m from the site/);
    assert.match(mapSummary(site, [{ lat: 3.13, lng: 101.74 }]), /check it was taken on this site/);
    assert.match(mapSummary(null, []), /No site location set/);
});

test("photos without a place are counted, so the page can ask before saving them", () => {
    const { unplacedPhotos } = require("../js/capture.js");
    assert.strictEqual(unplacedPhotos([{ geo: { lat: 3.1, lng: 101.7 } }, { geo: null }, {}]), 2);
    assert.strictEqual(unplacedPhotos([{ geo: { lat: 3.1, lng: 101.7 } }]), 0);
    assert.strictEqual(unplacedPhotos([]), 0);
});

test("demo data saved before the site map gets the demo site and its placed photos", () => {
    const { upgradeDemo } = require("../js/store.js");
    const old = seedDB();
    const demo = old.projects[0];
    delete demo.site;
    demo.vos.forEach(v => { v.supportingDocs = (v.supportingDocs || []).filter(d => !/^P\d$/.test(d.id)); });
    const f4 = demo.vos[0].supportingDocs.find(d => d.id === "F4");
    delete f4.geo;
    assert.strictEqual(photoPins(demo).length, 0);

    upgradeDemo(old);
    assert.ok(siteOf(demo));
    assert.strictEqual(photoPins(demo).length, photoPins(seedDB().projects[0]).length);

    /* a site the consultant set is kept */
    demo.site = { lat: 3.2, lng: 101.6, address: "Our own site" };
    upgradeDemo(old);
    assert.strictEqual(demo.site.address, "Our own site");
});
