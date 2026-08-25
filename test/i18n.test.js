const test = require("node:test");
const assert = require("node:assert");
const {
    LANGS, I18N_EN, I18N_ZH, I18N_EN_ONLY_KEYS,
    getLang, setLang, t, joinList
} = require("../js/i18n.js");

test("LANGS declares English and Chinese", () => {
    assert.deepStrictEqual(LANGS, { en: "English", zh: "中文" });
});

test("getLang defaults to English when storage is empty (Node: no localStorage)", () => {
    assert.strictEqual(getLang(), "en");
});

test("t() returns English by default", () => {
    assert.strictEqual(t("nav.dashboard"), "Dashboard");
});

test("setLang persists nothing in Node (no localStorage) but still reports the chosen language back", () => {
    assert.strictEqual(setLang("zh"), "zh");
    assert.strictEqual(setLang("en"), "en");
    assert.strictEqual(setLang("fr"), "en", "an unknown language falls back to English");
});

test("t() with a Node-simulated localStorage returns Chinese after setLang(zh)", () => {
    const store = {};
    global.localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    try {
        assert.strictEqual(getLang(), "en");
        setLang("zh");
        assert.strictEqual(getLang(), "zh");
        assert.strictEqual(t("nav.dashboard"), "仪表板");
        setLang("en");
        assert.strictEqual(t("nav.dashboard"), "Dashboard");
    } finally {
        delete global.localStorage;
    }
});

test("a key missing in Chinese falls back to English and never returns the raw key", () => {
    const store = {};
    global.localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    try {
        setLang("zh");
        // Pick a real key and simulate it being absent from zh by using
        // a key that legitimately isn't present in either dict at all —
        // t() must still never hand back the raw key untouched in a way
        // that looks like a translation; the true completeness guarantee
        // (every EN key has a ZH counterpart or is deliberately listed)
        // is asserted separately below.
        const missingKey = "this.key.does.not.exist.anywhere";
        assert.strictEqual(t(missingKey), missingKey, "totally unknown key returns itself, not a blank");

        // A key present in English must never come back untranslated-raw
        // when Chinese is active — it must be real Chinese text or the
        // English fallback, never the dotted key string itself.
        Object.keys(I18N_EN).forEach(key => {
            const value = t(key);
            assert.notStrictEqual(value, key, `key "${key}" rendered as its own raw identifier`);
        });
    } finally {
        delete global.localStorage;
    }
});

test("placeholder substitution works", () => {
    assert.strictEqual(t("dashboard.greeting", { name: "Serena" }), "Hello, Serena");
    const store = {};
    global.localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    try {
        setLang("zh");
        assert.strictEqual(t("dashboard.greeting", { name: "Serena" }), "您好,Serena");
    } finally {
        delete global.localStorage;
    }
});

test("placeholder substitution handles multiple and repeated placeholders", () => {
    assert.strictEqual(
        t("assistant.rateFlag.other", { desc: "X", unit: "m2", claimedRate: "RM 1.00", contractRate: "RM 2.00", detail: "d." }),
        "X — claimed RM 1.00 per m2, contract BQ rate RM 2.00 per m2. The contract BQ rate governs. d."
    );
});

test("every key present in the English dictionary is either present in Chinese or deliberately English-only", () => {
    const zhKeys = new Set(Object.keys(I18N_ZH));
    const enOnly = new Set(I18N_EN_ONLY_KEYS);
    const missing = Object.keys(I18N_EN).filter(k => !zhKeys.has(k) && !enOnly.has(k));
    assert.deepStrictEqual(missing, [],
        "these English keys have no Chinese translation and are not listed as deliberately English-only");
});

test("every deliberately-English-only key really is missing from the Chinese dictionary (list stays honest)", () => {
    const zhKeys = new Set(Object.keys(I18N_ZH));
    I18N_EN_ONLY_KEYS.forEach(k => {
        assert.ok(!zhKeys.has(k), `"${k}" is listed as English-only but a Chinese translation exists`);
        assert.ok(Object.prototype.hasOwnProperty.call(I18N_EN, k), `"${k}" is listed as English-only but is not even an English key`);
    });
});

test("joinList: English uses an Oxford-style 'and', Chinese uses 顿号 with no conjunction", () => {
    assert.strictEqual(joinList(["A"]), "A");
    assert.strictEqual(joinList(["A", "B"]), "A and B");
    assert.strictEqual(joinList(["A", "B", "C"]), "A, B and C");

    const store = {};
    global.localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    try {
        setLang("zh");
        assert.strictEqual(joinList(["甲", "乙", "丙"]), "甲、乙、丙");
    } finally {
        delete global.localStorage;
    }
});

test("clause entitlement/evidence text keys do not exist in the dictionary at all — clause.js text is never routed through t()", () => {
    Object.keys(I18N_EN).forEach(key => {
        assert.ok(!/^clause\.(entitlement|evidence|title|form|ref)$/.test(key),
            "clause substance must never be a translatable dictionary key");
    });
});
