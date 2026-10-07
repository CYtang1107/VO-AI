const test = require("node:test");
const assert = require("node:assert");

const s = require("../js/suppliers.js");

const site = { lat: 3.0857, lng: 101.7425, address: "Demo site" };

/* the shape the Overpass API answers with (out center tags) */
const fixture = { elements: [
    { type: "node", id: 1, lat: 3.0901, lon: 101.7440, tags: { shop: "hardware", name: "Kedai Hardware Maju", phone: "+60 3-9131 0000", "addr:street": "Jalan Cheras", "addr:housenumber": "12", "addr:city": "Kuala Lumpur" } },
    { type: "way", id: 2, center: { lat: 3.0700, lon: 101.7300 }, tags: { shop: "tiles", name: "Tile Gallery", opening_hours: "Mo-Sa 09:00-18:00" } },
    { type: "node", id: 3, lat: 3.1000, lon: 101.7600, tags: { shop: "tool_hire", name: "Cheras Tool Rental" } },
    { type: "node", id: 4, lat: 3.0950, lon: 101.7500, tags: { shop: "trade", name: "ABC Machinery Sewa Jentera" } },
    { type: "node", id: 5, lat: 3.0860, lon: 101.7430, tags: { shop: "hardware" } },
    { type: "node", id: 6, lat: 3.0902, lon: 101.7441, tags: { shop: "hardware", name: "Kedai Hardware Maju" } },
    { type: "node", id: 7, lat: 3.0910, lon: 101.7450, tags: { office: "company", name: "Sunrise Trading" } }
] };

test("the query asks for building suppliers and plant hire around the site", () => {
    const q = s.supplierQuery(site, 10000);
    assert.match(q, /\[out:json\]/);
    assert.match(q, /around:10000,3\.0857,101\.7425/);
    assert.match(q, /hardware\|doityourself\|trade\|tiles/);
    assert.match(q, /tool_hire/);
    assert.match(q, /out center tags/);
});

test("named places only, sorted nearest first, hire told apart from materials, duplicates dropped", () => {
    const list = s.parseSuppliers(fixture, site);
    assert.deepStrictEqual(list.map(x => x.name), ["Kedai Hardware Maju", "ABC Machinery Sewa Jentera", "Tile Gallery", "Cheras Tool Rental"]);
    assert.deepStrictEqual(list.map(x => x.kind), ["materials", "hire", "materials", "hire"]);
    assert.strictEqual(list[0].address, "12 Jalan Cheras, Kuala Lumpur");
    assert.strictEqual(list[0].phone, "+60 3-9131 0000");
    assert.ok(list[0].metres > 400 && list[0].metres < 600);
    assert.strictEqual(list[2].hours, "Mo-Sa 09:00-18:00", "a way's centre is used");
    assert.deepStrictEqual(s.parseSuppliers({}, site), []);
});

test("the list shows distance, phone and directions; an empty kind says so; no site, no search", () => {
    const list = s.parseSuppliers(fixture, site);
    const html = s.renderSuppliers({ site: site }, { list: list });
    assert.match(html, /Building materials[\s\S]*Kedai Hardware Maju[\s\S]*Plant and tool hire[\s\S]*Cheras Tool Rental/);
    assert.match(html, /href="tel:\+60391310000"/);
    assert.match(html, /google\.com\/maps\/dir\/\?api=1&destination=3\.0901,101\.744/);
    assert.match(s.renderSuppliers({ site: site }, { list: list.filter(x => x.kind === "materials") }), /no plant hire here/);
    assert.match(s.renderSuppliers({ site: site }, null), /id="findSuppliersBtn">Find within 10 km/);
    assert.match(s.renderSuppliers({}, null), /Set the site on the dashboard map first/);
});
