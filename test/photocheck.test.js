const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const pc = require("../js/photocheck.js");
const { seedDB } = require("../js/store.js");

/* The Edge Function's rules (an ES module, shared with Deno). */
const rules = () => import(pathToFileURL(path.join(__dirname, "..", "supabase", "functions", "photo-check", "rules.mjs")).href);

const img = id => ({ id: id, data: "QUJD" });

test("a photo-check request needs a project, a mode, 1–4 base64 photos, and a description to check against", async () => {
    const r = await rules();
    const ok = { project_id: "P", mode: "check", description: "Marble floor", images: [img("a")] };
    assert.strictEqual(r.validPhotoRequest(ok), null);
    assert.strictEqual(r.validPhotoRequest({ project_id: "P", mode: "describe", images: [img("a")] }), null);
    assert.match(r.validPhotoRequest(Object.assign({}, ok, { mode: "guess" })), /mode/);
    assert.match(r.validPhotoRequest(Object.assign({}, ok, { images: [] })), /images/);
    assert.match(r.validPhotoRequest(Object.assign({}, ok, { images: ["a", "b", "c", "d", "e"].map(img) })), /At most 4/);
    assert.match(r.validPhotoRequest(Object.assign({}, ok, { description: "  " })), /description/);
    assert.match(r.validPhotoRequest(Object.assign({}, ok, { images: [{ id: "a", data: "data:image/jpeg;base64,QUJD" }] })), /base64/);
    assert.match(r.validPhotoRequest(Object.assign({}, ok, { images: [img("a"), img("a")] })), /different/);
    assert.match(r.validPhotoRequest(Object.assign({}, ok, { images: [{ id: "a", data: "A".repeat(r.MAX_IMAGE_CHARS + 1) }] })), /too large/);
});

test("money and quantities are caught; product sizes, levels and plain words are not", async () => {
    const r = await rules();
    ["RM 2,500", "about 320 m2 of tiles", "12 m of skirting", "3 nos doors", "320平方米", "约 12 米踢脚线", "5块瓷砖", "15 square metres"]
        .forEach(s => assert.ok(r.hasQuantity(s), s));
    ["600x600mm marble tiles", "Level 2 corridor", "大理石地砖 600毫米", "Ceiling board removed at the cove", "客厅地面铺设瓷砖"]
        .forEach(s => assert.ok(!r.hasQuantity(s), s));
});

test("a check answer gives one result per photo asked about, in order, and unknown verdicts read as unclear", async () => {
    const r = await rules();
    const text = "```json\n" + JSON.stringify({ results: [
        { id: "P2", verdict: "mismatch", seen: "A ceiling", reason: "Not the floor" },
        { id: "P1", verdict: "match", seen: "Marble tiles laid", reason: "Same work" },
        { id: "P3", verdict: "maybe", seen: "Dark", reason: "" }
    ] }) + "\n```";
    const out = r.parseCheck(text, ["P1", "P2", "P3", "P4"]);
    assert.deepStrictEqual(out.results.map(x => x.id + ":" + x.verdict), ["P1:match", "P2:mismatch", "P3:unclear", "P4:unclear"]);
    assert.deepStrictEqual(out.problems, []);
    assert.deepStrictEqual(r.parseCheck("I think they match", ["P1"]).problems, ["format"]);
    const withQty = JSON.stringify({ results: [{ id: "P1", verdict: "match", seen: "About 320 m2 of marble", reason: "" }] });
    assert.deepStrictEqual(r.parseCheck(withQty, ["P1"]).problems, ["quantity"]);
});

test("a draft description is clipped, and refused when it states a quantity", async () => {
    const r = await rules();
    assert.strictEqual(r.parseDescribe('{"description":"Change of living area floor finish to marble tiles."}').description,
        "Change of living area floor finish to marble tiles.");
    assert.deepStrictEqual(r.parseDescribe('{"description":"Lay 320 m2 marble"}').problems, ["quantity"]);
    assert.deepStrictEqual(r.parseDescribe("no json").problems, ["format"]);
    assert.ok(r.parseDescribe(JSON.stringify({ description: "x".repeat(900) })).description.length <= r.MAX_DRAFT);
});

test("the prompts carry the description, the photo ids, the reply language and the no-quantity rule", async () => {
    const r = await rules();
    const p = r.checkPrompt("客厅地面饰面由瓷砖改为大理石", ["F4", "P1"], "zh");
    assert.match(p, /客厅地面饰面由瓷砖改为大理石/);
    assert.match(p, /F4, P1/);
    assert.match(p, /Simplified Chinese/);
    assert.match(p, /never state a quantity/i);
    assert.match(r.describePrompt(["photo-1"], "en"), /in English/);
    assert.match(r.correction(["quantity"]), /quantity/);
});

test("the photos a check reads are the VO's image files with content, the first four", () => {
    const db = seedDB();
    const vo1 = db.projects[0].vos[0];
    const photos = pc.checkablePhotos(vo1);
    assert.ok(photos.length >= 1);
    assert.ok(photos.every(d => pc.isPhotoName(d.name)));
    assert.ok(!photos.some(d => /\.pdf$/i.test(d.name)));
    const many = { id: "V", supportingDocs: ["a", "b", "c", "d", "e"].map(n => ({ id: n, name: n + ".jpg", stored: true }))
        .concat([{ id: "x", name: "name-only.jpg" }]) };
    assert.strictEqual(pc.checkablePhotos(many).length, 5);
    assert.deepStrictEqual(pc.photosToCheck(many).map(d => d.id), ["a", "b", "c", "d"]);
});

test("a kept result belongs to one description and one set of photos", () => {
    const vo = { id: "V", description: "Marble floor" };
    const docs = [{ id: "a" }, { id: "b" }];
    const k = pc.photoCheckKey(vo, docs);
    assert.notStrictEqual(k, pc.photoCheckKey({ id: "V", description: "Ceiling" }, docs));
    assert.notStrictEqual(k, pc.photoCheckKey(vo, [{ id: "a" }]));
    assert.strictEqual(k, pc.photoCheckKey({ id: "V", description: " Marble floor " }, docs));
});

test("the check result shows a verdict per photo, a summary, and says when only the first photos were read", () => {
    const docs = [{ id: "a", name: "site-a.jpg" }, { id: "b", name: "site-b.jpg" }];
    const html = pc.renderPhotoCheck({ results: [
        { id: "a", verdict: "match", seen: "Marble tiles", reason: "Same work" },
        { id: "b", verdict: "mismatch", seen: "A <ceiling>", reason: "Different area" }
    ] }, docs, { a: "demo-files/a.jpg" }, 6);
    assert.match(html, /1 match · 1 do not match · 0 unclear/);
    assert.match(html, /photo-verdict match/);
    assert.match(html, /photo-verdict mismatch/);
    assert.match(html, /A &lt;ceiling&gt;/);
    assert.match(html, /src="demo-files\/a.jpg"/);
    assert.match(html, /first 2 of 6 photos/);
    assert.match(pc.renderPhotoCheck({ results: null, reason: "quantity-check" }, docs, {}, 2), /quantities or amounts/);
    assert.match(pc.renderPhotoCheck({ results: null, reason: "guest-limit" }, docs, {}, 2), /limit/);
    assert.match(pc.renderPhotoCheck(null, [], {}, 0), /No site photos/);
});
