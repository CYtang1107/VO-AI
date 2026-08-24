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
        { name: "Serena Wong", role: "consultant" }, null);
    assert.match(html, /nav-item active[^>]*>[\s\S]{0,80}VO Register/);
});

test("the sidebar names the current project, per the template rule", () => {
    const html = renderSidebar("dashboard",
        { name: "Tan Zi Qian", role: "client" },
        { name: "Cadangan Pembangunan ABC Residence" });
    assert.match(html, /Cadangan Pembangunan ABC Residence/);
});
