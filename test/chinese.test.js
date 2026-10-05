const test = require("node:test");
const assert = require("node:assert");

/* Chinese interface for this file: a minimal localStorage with the
   language set, before any module reads it. */
const backing = new Map([["voai.lang.v1", "zh"]]);
globalThis.localStorage = {
    getItem: k => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: k => backing.delete(k)
};

const { classifyVariation, elementAnalysis, classificationBasis } = require("../js/analysis.js");
const { seedDB, SEED_ZH } = require("../js/store.js");
const { seedText } = require("../js/ui.js");
const { translateHistoryAction } = require("../js/page-vo.js");

const vo = description => ({ description: description, measurement: [] });

test("a variation described in Chinese is classified, with its work section", () => {
    const cases = [
        ["客厅地砖由瓷砖改为大理石", "specification", "装修工程"],
        ["主卧加一道门", "addition", "门窗工程"],
        ["删除后院的排水管", "omission", "外部工程与排水"],
        ["主人房天花重新设计", "design", "天花工程"],
        ["重新计量二楼地砖", "quantity", "装修工程"]
    ];
    cases.forEach(([text, id, work]) => {
        const c = classifyVariation(vo(text));
        assert.strictEqual(c.id, id, text);
        assert.strictEqual(c.affectedWork, work, text);
        assert.notDeepStrictEqual(classificationBasis(vo(text)).signals, [], text + " shows its signal");
    });
});

test("Chinese descriptions trigger the consequential-measurement checks too", () => {
    const e = elementAnalysis(vo("把砖墙改成石膏板隔墙"));
    assert.deepStrictEqual(e.detected.map(x => x.id), ["wall"]);
    assert.deepStrictEqual(e.related.map(r => r.element.id).sort(), ["dpc", "painting", "skirting", "wall-finishes"]);
    assert.deepStrictEqual(elementAnalysis(vo("客厅地砖由瓷砖改为大理石")).related.map(r => r.element.id).sort(), ["screed", "skirting"]);
});

test("every free-text field of the demo has its Chinese, and only untouched demo text is replaced", () => {
    const p = seedDB().projects[0];
    p.vos.forEach(v => {
        ["description", "contractorRemark", "assessmentNote", "consultantRemark", "clientRemark"].forEach(f => {
            if (v[f]) assert.ok(SEED_ZH[v[f]], v.no + " " + f + " has no Chinese");
        });
    });
    assert.strictEqual(seedText(p.vos[0].description), "客厅地面饰面由瓷砖改为大理石");
    assert.strictEqual(seedText("我自己写的说明"), "我自己写的说明");
    assert.strictEqual(seedText(""), "");
});

test("the activity log reads in Chinese, including entries this version adds", () => {
    assert.strictEqual(translateHistoryAction("Assessment completed — Approved"), "完成评估：已批准");
    assert.strictEqual(translateHistoryAction("Recorded on site with 2 photos"), "现场记录，附 2 张照片");
    assert.strictEqual(translateHistoryAction("Added row 2 to the contract BQ as new item VO-002/1 at RM 1100/no, based on 3 past project rate(s)"),
        "将第 2 行加入合同清单，新增项目 VO-002/1，单价 RM 1100/no，参考 3 个过往项目单价");
});
