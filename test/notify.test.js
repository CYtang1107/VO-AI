const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const { nextStep, waitingFor, stepMessage, unseen, renderNotifyList } = require("../js/notify.js");
const { seedDB } = require("../js/store.js");

const server = () => import(pathToFileURL(path.join(__dirname, "..", "supabase", "functions", "notify", "rules.mjs")).href);
const project = () => seedDB().projects[0];
const base = () => JSON.parse(JSON.stringify(project().vos[2]));   /* VO-003, a draft */

/* every stage of the workflow, in order */
function stages() {
    const s = [];
    const v = base();
    const snap = (name, over) => s.push([name, Object.assign(JSON.parse(JSON.stringify(v)), over || {})]);
    snap("draft");
    v.sentToDesign = true; v.history.push({ action: "Sent to design team" });
    snap("issue");
    snap("returned", { sentToDesign: false, instructionStatus: "Returned" });
    v.instructionStatus = "Confirmed";
    snap("measure");
    Object.assign(v, { submitted: true, evaluateStatus: "Pending" }); v.history.push({ action: "Submitted to consultant" });
    snap("value");
    snap("info", { infoRequestedAt: "2026-10-01", infoRequestNote: "photos" });
    snap("value", { infoRequestedAt: "2026-10-01", infoRequestNote: "photos",
                    infoResponse: { text: "sent", forRequest: "2026-10-01|photos" } });
    snap("rejected", { evaluateStatus: "Rejected" });
    v.evaluateStatus = "Approved";
    snap("approve");
    v.certifiedStatus = "Approved";
    snap("done");
    return s;
}

test("each stage of a VO waits on the right role", () => {
    const want = { draft: null, issue: "administrator", returned: "contractor", measure: "contractor", value: "consultant",
                   info: "contractor", rejected: "contractor", approve: "client", done: null };
    stages().forEach(([name, vo]) => {
        const st = nextStep(vo);
        assert.strictEqual(st ? st.role : null, want[name], name);
        if (st) assert.strictEqual(st.id, name);
    });
});

test("the server's copy of nextStep agrees with the browser's at every stage", async () => {
    const r = await server();
    stages().forEach(([name, vo]) => assert.deepStrictEqual(r.nextStep(vo), nextStep(vo), name));
    project().vos.forEach(vo => assert.deepStrictEqual(r.nextStep(vo), nextStep(vo), vo.no));
});

test("a VO submitted again after being returned notifies again (a new key)", () => {
    const v = stages()[1][1];
    const first = nextStep(v).key;
    v.history.push({ action: "Sent to design team" });
    assert.notStrictEqual(nextStep(v).key, first);
});

test("the demo: VO-002 waits for the consultant QS, VO-001 is finished", () => {
    const p = project();
    assert.deepStrictEqual(waitingFor(p, "consultant").map(x => x.vo.no), ["VO-002"]);
    assert.deepStrictEqual(waitingFor(p, "client").map(x => x.vo.no), []);
    const msg = stepMessage(p.vos[1], nextStep(p.vos[1]));
    assert.match(msg, /VO-002 was submitted by the contractor/);
});

test("what was seen is not shown again; the list links to each VO", () => {
    const p = project();
    const items = waitingFor(p, "consultant");
    assert.strictEqual(unseen(items, [items[0].step.key]).length, 0);
    assert.strictEqual(unseen(items, []).length, 1);
    assert.match(renderNotifyList(items), /href="vo\.html\?id=VO-SEED-2"/);
    assert.match(renderNotifyList([]), /Nothing is waiting/);
});

test("the email names the VO, says what to do in both languages and links to it", async () => {
    const r = await server();
    const v = stages()[1][1];
    const mail = r.emailFor(r.nextStep(v), v, { id: "P", name: "ABC Residence <b>" }, "https://example.org/VO-AI/");
    assert.match(mail.subject, /^VO-AI · VO-003 was sent by the contractor for approval — ABC Residence/);
    assert.match(mail.html, /add the drawings and documents, then approve or reject it/);
    assert.match(mail.html, /请补齐图纸与文件，然后批准或退回/);
    assert.match(mail.html, /https:\/\/example\.org\/VO-AI\/vo\.html\?id=VO-SEED-3/);
    assert.match(mail.html, /&lt;b&gt;/, "escaped");
});
