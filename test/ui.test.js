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

test("the sidebar shows Dashboard, VO Register and VO Reports once a project is chosen, but not Projects", () => {
    const html = renderSidebar("dashboard", { name: "serena.wong", role: "consultant" },
        { name: "ABC Residence" });
    assert.match(html, /Dashboard/);
    assert.match(html, /VO Register/);
    assert.match(html, /VO Reports/);
    assert.ok(!/nav-item[^>]*>[\s\S]{0,40}Projects</.test(html), "Projects must not be a nav item");
    assert.match(html, /ABC Residence/);
});

test("the sidebar names the current project, per the template rule", () => {
    const html = renderSidebar("dashboard",
        { name: "Tan Zi Qian", role: "client" },
        { name: "Cadangan Pembangunan ABC Residence" });
    assert.match(html, /Cadangan Pembangunan ABC Residence/);
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
