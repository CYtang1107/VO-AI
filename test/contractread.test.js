const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
    contractFileText, splitClauses, contractPeriods, contractProvisions, clauseExcerpt, makeReading,
    contractSourceDocs, contractAnalysis, renderContractBlock, parseToUnicode
} = require("../js/contractread.js");
const { seedDB } = require("../js/store.js");
const { analyse } = require("../js/analysis.js");
const { xlsxZip } = require("../js/xlsxexport.js");

const demo = name => fs.readFileSync(path.join(__dirname, "..", "demo-files", name));

test("reads the text out of the demo contract PDF by itself (no PDF library)", async () => {
    const r = await contractFileText("conditions.pdf", demo("conditions-of-contract-demo.pdf"));
    assert.ok(!r.error, r.error);
    assert.ok(r.text.includes("11.3 Valuation of Variations"));
    assert.ok(r.text.includes("valued at fair rates agreed between the Quantity Surveyor and the Contractor"));
    assert.ok(r.text.includes("Contract Bills rates"), "words in a line are spaced, not run together");
});

test("table columns on the same line are kept apart with a space", async () => {
    const r = await contractFileText("agreement.pdf", demo("contract-agreement-pam2018.pdf"));
    assert.ok(r.text.includes("Contract no. ABC/2026/014"));
    assert.ok(!r.text.includes("ProjectCadangan"));
});

test("a Word .docx is read from its document.xml", async () => {
    const xml = '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
        '<w:p><w:r><w:t>11.3 Valuation of Variations</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Variations shall be valued by the Quantity Surveyor at the Contract Bills rates &amp; fair rates.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>11.4 Claims</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>The Contractor shall submit the claim within 28 days of completing the work.</w:t></w:r></w:p>' +
        "</w:body></w:document>";
    const zip = xlsxZip([{ name: "word/document.xml", text: xml }]);
    const r = await contractFileText("contract.docx", zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
    assert.ok(!r.error, r.error);
    const clauses = splitClauses(r.text);
    assert.deepStrictEqual(clauses.map(c => c.no), ["11.3", "11.4"]);
    assert.ok(clauses[0].text.includes("Contract Bills rates & fair rates"));
});

test("an unsupported or empty file is reported, never guessed at", async () => {
    assert.deepStrictEqual(await contractFileText("photo.jpg", new Uint8Array([1, 2, 3]).buffer), { error: "contract.read.unsupported" });
    assert.deepStrictEqual(await contractFileText("blank.txt", new TextEncoder().encode("  \n ").buffer), { error: "contract.read.noText" });
});

test("a ToUnicode map decodes ranges and single codes", () => {
    const map = parseToUnicode("begincodespacerange <0000> <FFFF> endcodespacerange " +
        "beginbfchar <0003> <0020> endbfchar beginbfrange <0024> <0026> <0041> endbfrange");
    assert.strictEqual(map.width, 2);
    assert.strictEqual(map.codes["0003"], " ");
    assert.strictEqual(map.codes["0025"], "B");
});

test("clauses are split on their numbers; headings stay headings, numbers in text do not start a clause", () => {
    const text = "Conditions of Contract\n11 Variations\n11.1 Meaning of Variation\nA Variation means a change to the Works.\n" +
        "11.4 Submission of claims\nThe Contractor shall submit\n28 days after completion all documents.\n23.1 Notice of Delay\nNotice shall be given within 28 days.";
    const c = splitClauses(text);
    assert.deepStrictEqual(c.map(x => x.no), ["11", "11.1", "11.4", "23.1"]);
    assert.strictEqual(c[1].title, "Meaning of Variation");
    assert.ok(c[2].text.includes("28 days after completion"));
});

test("on the demo contract, each topic finds its clause and every period is listed once per sentence", async () => {
    const r = await contractFileText("c.pdf", demo("conditions-of-contract-demo.pdf"));
    const p = contractProvisions({ clauses: splitClauses(r.text) });
    const byTopic = Object.fromEntries(p.topics.map(tp => [tp.id, tp.clause && tp.clause.no]));
    assert.deepStrictEqual(byTopic, { meaning: "11.1", valuation: "11.3", time: "23.1", notice: "23.1" });
    assert.deepStrictEqual(p.periods.map(x => x.clause + ":" + x.days),
        ["11.2:7", "11.4:28", "11.4:28", "11.5:30", "23.1:28", "23.2:28", "30.1:30"]);
    const valuation = p.periods.find(x => x.clause === "11.5");
    assert.ok(valuation.sentence.endsWith("next Interim Certificate."), "a sentence is not cut at the point in 11.4");
});

test("excerpts end at a sentence", () => {
    const c = { text: "First sentence here. Second sentence is a good deal longer than the first one is. Third." };
    assert.strictEqual(clauseExcerpt(c, 30), "First sentence here. …");
    assert.strictEqual(clauseExcerpt(c, 500), c.text);
});

test("a VO's contract: its own contract basis first, then the project's contract documents", () => {
    const db = seedDB();
    const p = db.projects[0];
    const docs = contractSourceDocs(p, p.vos[0]);
    assert.deepStrictEqual(docs.map(d => d.id), ["F7", "D1", "D3"]);
});

test("analysis states: none, unread, read — and when read, findings cite this contract's clause", async () => {
    const db = seedDB();
    const p = db.projects[0];
    const vo2 = p.vos[1];

    const bare = Object.assign({}, p, { documents: [] });
    const noContract = Object.assign({}, vo2, { contractDocs: [] });
    assert.strictEqual(contractAnalysis(noContract, bare).state, "none");
    assert.ok(analyse(noContract, bare).findings.some(f => /No contract has been uploaded/.test(f)));

    assert.strictEqual(contractAnalysis(vo2, p).state, "unread");

    const r = await contractFileText("c.pdf", demo("conditions-of-contract-demo.pdf"));
    p.contractReadings = { D3: makeReading({ id: "D3", name: "Conditions of Contract (demo extract).pdf" }, r.text, "2026-10-05") };
    const c = contractAnalysis(vo2, p);
    assert.strictEqual(c.state, "read");
    assert.deepStrictEqual(c.docNames, ["Conditions of Contract (demo extract).pdf"]);
    const a = analyse(vo2, p);
    assert.ok(a.findings.some(f => f.includes("Clause 11.3") && f.includes("Conditions of Contract")));

    const html = renderContractBlock(c);
    assert.ok(html.includes("Valuation of Variations"));
    assert.ok(html.includes("<blockquote>"));
    assert.ok(html.includes("not legal advice"));
});

test("a contract that yields no clauses is said so, and the standard form is used", () => {
    const db = seedDB();
    const p = db.projects[0];
    p.contractReadings = { F8: { docId: "F8", docName: "x.pdf", clauses: [] }, D1: { docId: "D1", docName: "y.pdf", clauses: [] },
                           D3: { docId: "D3", docName: "scan.pdf", error: "contract.read.noText", clauses: [] } };
    assert.strictEqual(contractAnalysis(p.vos[1], p).state, "noText");
    assert.ok(analyse(p.vos[1], p).clause, "the bundled clause is still there");
});
