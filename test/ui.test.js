const test = require("node:test");
const assert = require("node:assert");
const { statusPill, initials, escapeHtml, renderSidebar } = require("../js/ui.js");

test("statusPill maps each status to its colour class", () => {
    assert.match(statusPill("Approved"), /class="status approved"/);
    assert.match(statusPill("Pending"), /class="status pending"/);
    assert.match(statusPill("Under Review"), /class="status review"/);
    assert.match(statusPill("Rejected"), /class="status rejected"/);
    assert.match(statusPill("Draft"), /class="status draft"/);
});

test("statusPill shows the status text", () => {
    assert.match(statusPill("Approved"), />\s*Approved\s*</);
});

test("initials takes the first letter of the first two words", () => {
    assert.strictEqual(initials("Serena Wong"), "SW");
    assert.strictEqual(initials("Ong Wei Han"), "OW");
    assert.strictEqual(initials("Serena"), "S");
    assert.strictEqual(initials(""), "?");
});

test("escapeHtml neutralises user-entered markup", () => {
    assert.strictEqual(escapeHtml('<script>alert("x")</script>'),
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    assert.strictEqual(escapeHtml("Ong & Sons"), "Ong &amp; Sons");
});

test("the sidebar names the signed-in user and their role", () => {
    const html = renderSidebar("dashboard",
        { name: "Serena Wong", role: "consultant" },
        { name: "ABC Residence" });
    assert.match(html, /Serena Wong/);
    assert.match(html, /Consultant QS/);
    assert.match(html, /SW/);
});

test("the sidebar marks the active page", () => {
    const html = renderSidebar("register",
        { name: "Serena Wong", role: "consultant" },
        { name: "ABC Residence" });
    assert.match(html, /nav-item active[^>]*>[\s\S]{0,80}VO Register/);
});

test("the sidebar renders no nav items and a select-a-project note until a project is chosen", () => {
    const html = renderSidebar("projects", { name: "serena.wong", role: "consultant" }, null);
    assert.ok(!/nav-item/.test(html), "no nav items should render with no project");
    assert.ok(!/VO Register/.test(html), "VO Register must be hidden with no project");
    assert.ok(!/Dashboard/.test(html), "Dashboard must be hidden with no project");
    assert.ok(!/VO Reports/.test(html), "VO Reports must be hidden with no project");
    assert.match(html, /project-chip-empty/);
    assert.match(html, /Select a project to begin/);
});

test("the sidebar shows Dashboard, VO Register, Documents and VO Reports once a project is chosen, but not Projects", () => {
    const html = renderSidebar("dashboard", { name: "serena.wong", role: "consultant" },
        { name: "ABC Residence" });
    assert.match(html, /Dashboard/);
    assert.match(html, /VO Register/);
    assert.match(html, /Documents/);
    assert.match(html, /VO Reports/);
    assert.ok(!/nav-item[^>]*>[\s\S]{0,40}Projects</.test(html), "Projects must not be a nav item");
    assert.match(html, /ABC Residence/);
});

test("the sidebar places Documents right after VO Register", () => {
    const html = renderSidebar("dashboard", { name: "serena.wong", role: "consultant" },
        { name: "ABC Residence" });
    assert.match(html, /VO Register<\/a><a[^>]*class="nav-item[^"]*"[^>]*>[\s\S]{0,20}Documents/);
});

test("the AI Analysis page is gone: the Copilot is last in the menu", () => {
    const html = renderSidebar("dashboard", { name: "serena.wong", role: "consultant" },
        { name: "ABC Residence" });
    assert.doesNotMatch(html, /AI Analysis|analysis\.html/);
    assert.match(html, /VO Reports<\/a><a[^>]*class="nav-item[^"]*"[^>]*>[\s\S]{0,20}Copilot<\/a><\/nav>/);
});

test("the sidebar names the current project, per the template rule", () => {
    /* the demo's Malay name reads in English (SEED_EN) */
    const html = renderSidebar("dashboard",
        { name: "Tan Zi Qian", role: "client" },
        { name: "Cadangan Pembangunan ABC Residence" });
    assert.match(html, /ABC Residence Project/);
});

test("the project chip menu shows the client and contract number", () => {
    const html = renderSidebar("dashboard",
        { name: "Serena Wong", role: "consultant" },
        { name: "ABC Residence", client: "ABC Development Sdn Bhd", contractNo: "ABC/2026/014" });
    assert.match(html, /ABC Development Sdn Bhd/);
    assert.match(html, /ABC\/2026\/014/);
});

test("the project chip offers a switch-project action to projects.html", () => {
    const html = renderSidebar("dashboard",
        { name: "Serena Wong", role: "consultant" },
        { name: "ABC Residence" });
    assert.match(html, /href="projects\.html"[^>]*>Switch project</);
});

test("the sidebar shows no chip menu content when no project is selected", () => {
    const html = renderSidebar("projects", { name: "serena.wong", role: "consultant" }, null);
    assert.ok(!/project-chip-menu/.test(html), "no chip menu should render with no project");
    assert.ok(!/Switch project/.test(html), "no switch-project action should render with no project");
});

test("a stored document's name is a link that opens it; a name-only one is tagged", () => {
    const { fileLink } = require("../js/ui.js");
    const stored = fileLink({ id: "DOC-1", name: "A-201 <Rev C>.pdf", stored: true });
    assert.match(stored, /class="file-name file-open"/);
    assert.match(stored, /data-file-id="DOC-1"/);
    assert.match(stored, /A-201 &lt;Rev C&gt;\.pdf/);
    const nameOnly = fileLink({ id: "DOC-2", name: "old.pdf" });
    assert.ok(!/file-open/.test(nameOnly));
    assert.match(nameOnly, /file-no-content/);
});

test("every demo document links to a sample file that exists, with its real size", () => {
    const fs = require("fs");
    const path = require("path");
    const { seedDB } = require("../js/store.js");
    const p = seedDB().projects[0];
    const docs = [].concat(p.documents, ...p.vos.map(v =>
        [].concat(v.revisedDrawing, v.oldDrawing, v.supportingDocs, v.contractDocs || [])));
    assert.ok(docs.length >= 10);
    assert.ok(p.vos[0].contractDocs.length > 0, "VO-001 shows the contract it is assessed against");
    docs.forEach(d => {
        assert.ok(d.url, d.name + " has no sample file");
        const file = path.join(__dirname, "..", d.url);
        assert.ok(fs.existsSync(file), d.url + " is missing");
        assert.strictEqual(fs.statSync(file).size, d.size, d.name + " size does not match its file");
    });
});

test("a demo document saved before urls existed still opens by its id", () => {
    const { fileLink } = require("../js/ui.js");
    const html = fileLink({ id: "F1", name: "A-201 Rev C - Floor Finishes.pdf" });
    assert.match(html, /href="demo-files\/A-201-revC-floor-finishes\.pdf"/);
    assert.ok(!/file-no-content/.test(html));
});

test("the phone tab bar gives only the contractor the centre camera button to record on site", () => {
    const { renderBottomTabs } = require("../js/ui.js");
    const contractor = renderBottomTabs("dashboard", { role: "contractor" });
    assert.ok(contractor.includes('href="register.html?new=1"'));
    assert.ok(contractor.includes("has-capture"));
    assert.ok(/class="tab-item active"[^>]*href|href="dashboard.html" class="tab-item active"/.test(contractor));
    for (const role of ["consultant", "client"]) {
        const html = renderBottomTabs("register", { role: role });
        assert.ok(!html.includes("?new=1"));
        assert.ok(html.includes('href="register.html" class="tab-item active"'));
    }
});
