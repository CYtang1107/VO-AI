const test = require("node:test");
const assert = require("node:assert");
const m = require("../js/media.js");
const { checkablePhotos } = require("../js/photocheck.js");

test("a photo is told from a video by its kind, else its name", () => {
    assert.ok(m.isPhotoDoc({ name: "a.JPG" }) && !m.isVideoDoc({ name: "a.JPG" }));
    assert.ok(m.isVideoDoc({ name: "clip.mov" }) && !m.isPhotoDoc({ name: "clip.mov" }));
    assert.ok(m.isVideoDoc({ name: "x.bin", kind: "video" }));
});

test("what still stops a step: the description and a before photo; a measured row and a completed photo", () => {
    assert.deepStrictEqual(m.describeMissing({}), ["media.need.description", "media.need.before"]);
    assert.deepStrictEqual(m.describeMissing({ description: "x", beforeMedia: [{ name: "v.mp4", kind: "video" }] }), ["media.need.before"]);
    assert.deepStrictEqual(m.describeMissing({ description: "x", beforeMedia: [{ name: "p.jpg", kind: "photo" }] }), []);
    assert.deepStrictEqual(m.submitMissing({ measurement: [{ description: "a", qty: 2 }] }), ["media.need.after"]);
    assert.deepStrictEqual(m.submitMissing({ measurement: [], afterMedia: [{ name: "p.jpg" }] }), ["wf.c.needRow"]);
});

test("the AI checks the completed photos when there are any, else the supporting photos; never a video", () => {
    const vo = { supportingDocs: [{ id: "S", name: "s.jpg", stored: true }],
                 afterMedia: [{ id: "A", name: "a.jpg", kind: "photo", stored: true }, { id: "V", name: "v.mp4", kind: "video", stored: true }] };
    assert.deepStrictEqual(checkablePhotos(vo).map(d => d.id), ["A"]);
    assert.deepStrictEqual(checkablePhotos({ supportingDocs: vo.supportingDocs }).map(d => d.id), ["S"]);
});

test("the media field: required mark, photos and videos, and take / album / video when editable", () => {
    const vo = { afterMedia: [{ id: "A", name: "IMG-1.jpg", kind: "photo", geo: { lat: 3, lng: 101 } }, { id: "V", name: "VID-1.mp4", kind: "video" }] };
    const html = m.renderMediaField(vo, "afterMedia", { editable: true, required: true });
    assert.match(html, /<img alt="" data-media-thumb="A">/);
    assert.match(html, /<video controls preload="metadata" playsinline data-media-thumb="V">/);
    assert.match(html, /class="media-remove"/);
    assert.equal((html.match(/class="media-picker"/g) || []).length, 3);
    assert.doesNotMatch(m.renderMediaField(vo, "afterMedia", {}), /media-picker|media-remove/);
});
