# VO-AI Role-Based Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the two static VO-AI mockup pages into a working three-role Variation Order application that walks the five-stage flow from `template.xlsx` end to end, with a real contract-BQ rate cross-check.

**Architecture:** Zero-dependency static site. Pure logic lives in `js/*.js` modules that export via CommonJS in Node (so `node --test` can test them) and fall back to browser globals when loaded with `<script src>`. Pages are plain HTML that call render functions from those modules. All state lives in one `localStorage` key.

**Tech Stack:** Vanilla HTML / CSS / ES2020 JavaScript. Node 25 built-in test runner (`node --test`). No npm packages, no build step, no CDN. Hosted on GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-24-vo-ai-spec.md`

## Global Constraints

- **Deadline: 31 August 2026.** Tasks 1–11 are the submission; Task 12 is deploy.
- **Zero dependencies.** No npm install, no CDN `<script>`, no build step. If a task seems to need a library, solve it with vanilla JS instead.
- **No backend.** Static files only, served from the repo root so GitHub Pages works.
- **Persistence:** `localStorage`, single key `voai.db.v1`. Session key `voai.session.v1`.
- **No `alert()`, `confirm()` or `prompt()`** in shipped code. Use `toast()` from `js/ui.js`.
- **Currency:** always `rm(n)` from `js/calc.js` → `"RM 1,234.00"`, locale `en-MY`, 2 decimals.
- **No fabricated numbers.** Every figure rendered must derive from stored data. The mockup's hardcoded `94%` confidence and `Clause 13.1` must not survive into the final build.
- **Disclaimer:** every page that renders a generated assessment must include the existing `.disclaimer` block.
- **Module dual-export footer** — every file in `js/` ends with:
  ```js
  if (typeof module !== "undefined" && module.exports) {
      module.exports = { /* named exports */ };
  }
  ```
- **Module import guard** — files with dependencies begin with:
  ```js
  if (typeof require !== "undefined" && typeof module !== "undefined") {
      var { rm } = require("./calc.js");
  }
  ```
  In the browser this block never runs and the browser globals are used instead.
- **Field names are fixed by the spec's data model.** Do not rename `evaluateStatus`, `certifiedStatus`, `finalPrice`, `timeImpact`, `submitted`, `measurement`, `bqItemId`, `assessedQty`, `assessedRate`.
- **Status vocabularies are closed sets.** `evaluateStatus` ∈ `Draft | Pending | Under Review | Approved | Rejected`. `certifiedStatus` ∈ `Pending | Approved | Rejected`. `role` ∈ `contractor | consultant | client`.
- **Commit after every task** with a `feat:` / `test:` / `chore:` prefix.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `js/calc.js` | Money/date formatting, line and VO totals, project roll-up. No dependencies. |
| `js/permissions.js` | The role edit matrix — `canEdit`, `lockReason`. No dependencies. |
| `js/clauses.js` | Contract clause knowledge base + classification→clause matcher. No dependencies. |
| `js/analysis.js` | Variation classification, BQ rate cross-check, full assessment. Depends on `calc`, `clauses`. |
| `js/store.js` | Data model, seed data, localStorage CRUD, session. Depends on `calc`. |
| `js/ui.js` | Shared chrome: sidebar, topbar, route guards, toast, status pills. Depends on `store`, `calc`. |
| `js/page-projects.js` | Project create/select + BQ and contract upload. |
| `js/page-dashboard.js` | Role-aware KPIs and recent VO list. |
| `js/page-register.js` | The VO register table with per-role editable columns. |
| `js/page-vo.js` | Single VO detail: measurement editor, cross-check, role panels. |
| `js/page-report.js` | Printable VO report. |
| `projects.html`, `dashboard.html`, `register.html`, `vo.html`, `report.html` | The five screens. |
| `test/*.test.js` | One test file per pure module. |

**Modified:**

| File | Change |
|---|---|
| `index.html` | Becomes the Stage 1 login / role picker (replaces the mockup dashboard). |
| `style.css` | Extended with new components. Existing rules kept — the pages reuse them. |
| `variation.html` | Redirects to `vo.html`; the standalone calculator is superseded. |
| `script.js` | Deleted — its two `alert()` functions are replaced by `js/page-vo.js`. |

---

## Suggested schedule (7 days)

| Day | Tasks |
|---|---|
| 25 Aug | 1, 2, 3 — logic core |
| 26 Aug | 4, 5 — analysis + store |
| 27 Aug | 6, 7 — chrome, login, projects |
| 28 Aug | 8, 9 — dashboard, register |
| 29 Aug | 10, 11 — VO detail, report |
| 30 Aug | 12 — cleanup, deploy, screenshots for proposal §3.2 |
| 31 Aug | Proposal §2.2/§2.4/§2.5/§3/§4 written against the shipped app; submit |

---

### Task 1: Money, dates and totals (`js/calc.js`)

**Files:**
- Create: `js/calc.js`
- Test: `test/calc.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `rm(value: number|string): string` — `"RM 1,234.00"`
  - `today(): string` — `"YYYY-MM-DD"`
  - `prettyDate(iso: string): string` — `"14 Jul 2026"`, `"—"` for empty
  - `lineTotal(qty, rate): number`
  - `contractorTotal(vo): number`
  - `assessedTotal(vo): number` — falls back to contractor qty/rate per row when the consultant has not assessed that row
  - `voValue(vo): number` — certified `finalPrice` if certified-approved, else `assessedTotal`
  - `projectStats(project): {total, draft, pending, approved, rejected, certified, value, timeImpact}`

- [ ] **Step 1: Write the failing test**

Create `test/calc.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const {
    rm, today, prettyDate, lineTotal,
    contractorTotal, assessedTotal, voValue, projectStats
} = require("../js/calc.js");

test("rm formats ringgit with two decimals and thousands separators", () => {
    assert.strictEqual(rm(1234), "RM 1,234.00");
    assert.strictEqual(rm(0), "RM 0.00");
    assert.strictEqual(rm(-500.5), "RM -500.50");
    assert.strictEqual(rm(""), "RM 0.00");
    assert.strictEqual(rm(null), "RM 0.00");
});

test("today returns an ISO date string", () => {
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test("prettyDate renders a readable date and an em dash for empty", () => {
    assert.strictEqual(prettyDate(""), "—");
    assert.strictEqual(prettyDate(null), "—");
    assert.match(prettyDate("2026-07-14"), /Jul/);
});

test("lineTotal multiplies quantity by rate and tolerates blanks", () => {
    assert.strictEqual(lineTotal(10, 5), 50);
    assert.strictEqual(lineTotal(-320, 85), -27200);
    assert.strictEqual(lineTotal("", 5), 0);
});

test("contractorTotal sums the contractor's claimed rows", () => {
    const vo = { measurement: [
        { qty: -320, rate: 85 },
        { qty: 320, rate: 265 }
    ] };
    assert.strictEqual(contractorTotal(vo), 57600);
});

test("assessedTotal falls back to contractor figures on unassessed rows", () => {
    const vo = { measurement: [
        { qty: 100, rate: 10, assessedQty: 90, assessedRate: 10 },
        { qty: 100, rate: 10, assessedQty: "", assessedRate: "" }
    ] };
    assert.strictEqual(assessedTotal(vo), 900 + 1000);
});

test("voValue prefers the certified final price", () => {
    const base = { measurement: [{ qty: 1, rate: 100 }] };
    assert.strictEqual(voValue({ ...base, certifiedStatus: "Pending", finalPrice: null }), 100);
    assert.strictEqual(voValue({ ...base, certifiedStatus: "Approved", finalPrice: 88 }), 88);
});

test("projectStats counts by status and excludes drafts from value", () => {
    const project = { vos: [
        { evaluateStatus: "Draft", certifiedStatus: "Pending", timeImpact: 5,
          measurement: [{ qty: 1, rate: 1000 }] },
        { evaluateStatus: "Pending", certifiedStatus: "Pending", timeImpact: 0,
          measurement: [{ qty: 1, rate: 200 }] },
        { evaluateStatus: "Approved", certifiedStatus: "Approved", finalPrice: 300,
          timeImpact: 7, measurement: [{ qty: 1, rate: 400 }] }
    ] };
    const s = projectStats(project);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.draft, 1);
    assert.strictEqual(s.pending, 1);
    assert.strictEqual(s.approved, 1);
    assert.strictEqual(s.certified, 1);
    assert.strictEqual(s.value, 500);      // 200 + 300, draft excluded
    assert.strictEqual(s.timeImpact, 7);   // approved only
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/calc.test.js`
Expected: FAIL — `Cannot find module '../js/calc.js'`

- [ ] **Step 3: Write the implementation**

Create `js/calc.js`:

```js
/* VO-AI | calc.js — money, dates and totals. No dependencies. */

function rm(value) {
    const n = Number(value) || 0;
    return "RM " + n.toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function prettyDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-MY", {
        day: "2-digit", month: "short", year: "numeric"
    });
}

function lineTotal(qty, rate) {
    return (Number(qty) || 0) * (Number(rate) || 0);
}

/* Use the assessed figure when the consultant has entered one,
   otherwise fall back to what the contractor claimed. */
function assessedOr(row, key) {
    const assessed = row["assessed" + key[0].toUpperCase() + key.slice(1)];
    if (assessed === "" || assessed === null || assessed === undefined) {
        return Number(row[key]) || 0;
    }
    return Number(assessed) || 0;
}

function contractorTotal(vo) {
    return (vo.measurement || []).reduce(
        (sum, row) => sum + lineTotal(row.qty, row.rate), 0);
}

function assessedTotal(vo) {
    return (vo.measurement || []).reduce(
        (sum, row) => sum + assessedOr(row, "qty") * assessedOr(row, "rate"), 0);
}

function voValue(vo) {
    if (vo.certifiedStatus === "Approved" &&
        vo.finalPrice !== null && vo.finalPrice !== undefined && vo.finalPrice !== "") {
        return Number(vo.finalPrice) || 0;
    }
    return assessedTotal(vo);
}

function projectStats(project) {
    const vos = project.vos || [];
    const live = vos.filter(v => v.evaluateStatus !== "Draft");
    return {
        total: vos.length,
        draft: vos.filter(v => v.evaluateStatus === "Draft").length,
        pending: vos.filter(v =>
            v.evaluateStatus === "Pending" || v.evaluateStatus === "Under Review").length,
        approved: vos.filter(v => v.evaluateStatus === "Approved").length,
        rejected: vos.filter(v => v.evaluateStatus === "Rejected").length,
        certified: vos.filter(v => v.certifiedStatus === "Approved").length,
        value: live.reduce((s, v) => s + voValue(v), 0),
        timeImpact: live
            .filter(v => v.evaluateStatus === "Approved")
            .reduce((s, v) => s + (Number(v.timeImpact) || 0), 0)
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        rm, today, prettyDate, lineTotal,
        contractorTotal, assessedTotal, voValue, projectStats
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/calc.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add js/calc.js test/calc.test.js
git commit -m "feat: add money, date and VO total calculations"
```

---

### Task 2: The role edit matrix (`js/permissions.js`)

**Files:**
- Create: `js/permissions.js`
- Test: `test/permissions.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FIELD_OWNER: {[field: string]: "contractor"|"consultant"|"client"}`
  - `canEdit(field: string, vo: object, role: string): boolean`
  - `lockReason(field: string, vo: object, role: string): string` — `""` when editable

- [ ] **Step 1: Write the failing test**

Create `test/permissions.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { FIELD_OWNER, canEdit, lockReason } = require("../js/permissions.js");

const draft     = { submitted: false, evaluateStatus: "Draft",    certifiedStatus: "Pending" };
const submitted = { submitted: true,  evaluateStatus: "Pending",  certifiedStatus: "Pending" };
const approved  = { submitted: true,  evaluateStatus: "Approved", certifiedStatus: "Pending" };

test("every owned field maps to exactly one role", () => {
    assert.strictEqual(FIELD_OWNER.description, "contractor");
    assert.strictEqual(FIELD_OWNER.evaluateStatus, "consultant");
    assert.strictEqual(FIELD_OWNER.finalPrice, "client");
});

test("a role can never edit another role's column", () => {
    assert.strictEqual(canEdit("finalPrice", approved, "contractor"), false);
    assert.strictEqual(canEdit("description", draft, "consultant"), false);
    assert.strictEqual(canEdit("evaluateStatus", submitted, "client"), false);
});

test("contractor edits its own columns until the consultant approves", () => {
    assert.strictEqual(canEdit("description", draft, "contractor"), true);
    assert.strictEqual(canEdit("measurement", submitted, "contractor"), true);
    assert.strictEqual(canEdit("description", approved, "contractor"), false);
});

test("a rejected VO reopens for the contractor", () => {
    const rejected = { submitted: true, evaluateStatus: "Rejected", certifiedStatus: "Pending" };
    assert.strictEqual(canEdit("description", rejected, "contractor"), true);
});

test("consultant cannot assess until the contractor submits", () => {
    assert.strictEqual(canEdit("evaluateStatus", draft, "consultant"), false);
    assert.strictEqual(canEdit("evaluateStatus", submitted, "consultant"), true);
});

test("client cannot certify until the consultant approves", () => {
    assert.strictEqual(canEdit("finalPrice", submitted, "client"), false);
    assert.strictEqual(canEdit("finalPrice", approved, "client"), true);
});

test("lockReason explains the block and is empty when editable", () => {
    assert.strictEqual(lockReason("description", draft, "contractor"), "");
    assert.match(lockReason("evaluateStatus", draft, "consultant"), /submit/i);
    assert.match(lockReason("finalPrice", submitted, "client"), /consultant/i);
    assert.match(lockReason("finalPrice", approved, "contractor"), /Client/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/permissions.test.js`
Expected: FAIL — `Cannot find module '../js/permissions.js'`

- [ ] **Step 3: Write the implementation**

Create `js/permissions.js`:

```js
/* VO-AI | permissions.js
   The template's "each role can only edit the yellow things" rule,
   in exactly one place. No dependencies. */

const ROLE_LABEL = {
    contractor: "Contractor QS",
    consultant: "Consultant QS",
    client: "Client / Developer"
};

const FIELD_OWNER = {
    /* contractor's columns */
    description: "contractor",
    dateIssued: "contractor",
    typeOfInstruction: "contractor",
    instructionNo: "contractor",
    revisedDrawing: "contractor",
    oldDrawing: "contractor",
    supportingDocs: "contractor",
    measurement: "contractor",
    contractorRemark: "contractor",

    /* consultant's columns */
    dueDate: "consultant",
    assessment: "consultant",
    assessmentNote: "consultant",
    timeImpact: "consultant",
    evaluateStatus: "consultant",
    consultantRemark: "consultant",

    /* client's columns */
    certifiedStatus: "client",
    finalPrice: "client",
    clientRemark: "client"
};

function canEdit(field, vo, role) {
    if (FIELD_OWNER[field] !== role) return false;

    if (role === "contractor") {
        return vo.evaluateStatus === "Draft" ||
               vo.evaluateStatus === "Pending" ||
               vo.evaluateStatus === "Rejected";
    }
    if (role === "consultant") {
        return vo.submitted === true;
    }
    if (role === "client") {
        return vo.evaluateStatus === "Approved";
    }
    return false;
}

function lockReason(field, vo, role) {
    if (canEdit(field, vo, role)) return "";

    const owner = FIELD_OWNER[field];
    if (!owner) return "This field is calculated by VO-AI and cannot be edited.";
    if (owner !== role) {
        return "Read-only — this column belongs to the " + ROLE_LABEL[owner] + ".";
    }
    if (role === "contractor") {
        return "Locked — the consultant has already assessed this VO.";
    }
    if (role === "consultant") {
        return "Locked — waiting for the contractor to submit the VO.";
    }
    return "Locked — waiting for the consultant's approval.";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { FIELD_OWNER, ROLE_LABEL, canEdit, lockReason };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/permissions.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add js/permissions.js test/permissions.test.js
git commit -m "feat: enforce per-role column edit permissions"
```

---

### Task 3: Contract clause knowledge base (`js/clauses.js`)

**Files:**
- Create: `js/clauses.js`
- Test: `test/clauses.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CLAUSES: Array<{id, form, ref, title, appliesTo: string[], entitlement, evidence}>`
  - `matchClause(classification: string): object|null`
  - `clausesFor(classification: string): object[]`

`appliesTo` values are the classification ids produced by Task 4: `"specification"`,
`"addition"`, `"omission"`, `"quantity"`, `"design"`, `"unclassified"`.

- [ ] **Step 1: Write the failing test**

Create `test/clauses.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { CLAUSES, matchClause, clausesFor } = require("../js/clauses.js");

test("every clause carries the fields the report needs", () => {
    assert.ok(CLAUSES.length >= 4);
    for (const c of CLAUSES) {
        assert.ok(c.id && c.form && c.ref && c.title, "missing identity: " + c.id);
        assert.ok(Array.isArray(c.appliesTo) && c.appliesTo.length > 0);
        assert.ok(c.entitlement.length > 20, "entitlement too thin: " + c.id);
        assert.ok(c.evidence.length > 20, "evidence too thin: " + c.id);
    }
});

test("matchClause returns a governing clause for each classification", () => {
    for (const k of ["specification", "addition", "omission", "quantity", "design"]) {
        const c = matchClause(k);
        assert.ok(c, "no clause matched for " + k);
        assert.ok(c.appliesTo.includes(k));
    }
});

test("an unknown classification yields no clause rather than a wrong one", () => {
    assert.strictEqual(matchClause("unclassified"), null);
    assert.strictEqual(matchClause("nonsense"), null);
});

test("clausesFor returns every applicable clause", () => {
    const list = clausesFor("addition");
    assert.ok(list.length >= 1);
    assert.ok(list.every(c => c.appliesTo.includes("addition")));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/clauses.test.js`
Expected: FAIL — `Cannot find module '../js/clauses.js'`

- [ ] **Step 3: Write the implementation**

Create `js/clauses.js`. These are the standard Malaysian forms named in the spec; the
wording below is a plain-English summary written for this app, not a quotation of the
contract text.

```js
/* VO-AI | clauses.js
   Bundled contract clause knowledge base. The "contract clause analysis"
   function from the proposal is a lookup against this table — deterministic
   and auditable, not generated text. No dependencies. */

const CLAUSES = [
    {
        id: "pam-11-1",
        form: "PAM 2018",
        ref: "Clause 11.1",
        title: "Meaning of Variation",
        appliesTo: ["specification", "addition", "omission", "design"],
        entitlement:
            "A variation includes the alteration or modification of the design, quality " +
            "or quantity of the Works, including substitution of materials or goods. " +
            "Work instructed under this clause ranks for valuation.",
        evidence:
            "The written Architect's Instruction, the superseded and revised drawings, " +
            "and a measurement showing what was omitted and what was added."
    },
    {
        id: "pam-11-6",
        form: "PAM 2018",
        ref: "Clause 11.6",
        title: "Valuation of Variations",
        appliesTo: ["specification", "addition", "omission", "quantity", "design"],
        entitlement:
            "Work of similar character executed under similar conditions is valued at " +
            "the Contract Bills rates. Where the character or conditions differ, the " +
            "Contract Bills rates form the basis of a fair valuation. Where there is no " +
            "comparable rate, a fair market rate is agreed as a star rate.",
        evidence:
            "The relevant priced Bills of Quantities items, and for a star rate, a " +
            "supplier quotation or build-up showing labour, material and plant."
    },
    {
        id: "pam-23-8",
        form: "PAM 2018",
        ref: "Clause 23.8",
        title: "Extension of Time — Architect's Instruction",
        appliesTo: ["addition", "design", "specification"],
        entitlement:
            "Where a variation instruction delays completion, the Contractor may claim " +
            "an extension of time. The claim must be notified within the contractual " +
            "period and supported by a demonstration of critical-path impact.",
        evidence:
            "The notice of delay, the updated construction programme showing the " +
            "critical path before and after, and the date the instruction was received."
    },
    {
        id: "pwd-24",
        form: "PWD 203A",
        ref: "Clause 24",
        title: "Variations and Provisional Sums",
        appliesTo: ["specification", "addition", "omission", "quantity", "design"],
        entitlement:
            "The Superintending Officer may issue instructions varying the Works. " +
            "Such variations are measured and valued at Schedule of Rates prices where " +
            "the work is of similar character, and at agreed rates where it is not.",
        evidence:
            "The S.O. Instruction, the measured quantities, and the Schedule of Rates " +
            "item relied upon for each rate."
    },
    {
        id: "pam-11-2",
        form: "PAM 2018",
        ref: "Clause 11.2",
        title: "Provisional and Approximate Quantities",
        appliesTo: ["quantity"],
        entitlement:
            "Where the quantity executed differs from the quantity in the Contract " +
            "Bills, the work is remeasured and valued at the Contract Bills rate. A " +
            "substantial change in quantity may justify a rate review.",
        evidence:
            "The remeasurement, site records supporting the measured quantity, and the " +
            "original Bills item for comparison."
    }
];

function clausesFor(classification) {
    return CLAUSES.filter(c => c.appliesTo.includes(classification));
}

/* The governing clause is the first applicable one — the table is ordered
   most-specific first. Returns null rather than guessing. */
function matchClause(classification) {
    const list = clausesFor(classification);
    return list.length > 0 ? list[0] : null;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { CLAUSES, clausesFor, matchClause };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/clauses.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add js/clauses.js test/clauses.test.js
git commit -m "feat: add contract clause knowledge base and matcher"
```

---

### Task 4: Variation classification and BQ rate cross-check (`js/analysis.js`)

This is the spec's §4 — the product's core differentiator. Take the tests seriously.

**Files:**
- Create: `js/analysis.js`
- Test: `test/analysis.test.js`

**Interfaces:**
- Consumes: `rm` from `js/calc.js`; `matchClause` from `js/clauses.js`.
- Produces:
  - `classifyVariation(vo): {id, label, affectedWork}` — `id` is one of the six
    classification ids listed in Task 3.
  - `checkRate(row, bq): {state, label, detail, contractRate?, diff?, pct?}` where
    `state` ∈ `"same" | "different" | "star"` and `bq` is the project's BQ array.
  - `rateSummary(vo, bq): {rows: Array<{row, check}>, same, different, star}`
  - `analyse(vo, project): {classification, clause, rates, contractorTotal, assessedTotal, variance, findings: string[]}`

- [ ] **Step 1: Write the failing test**

Create `test/analysis.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const {
    classifyVariation, checkRate, rateSummary, analyse
} = require("../js/analysis.js");

const bq = [
    { id: "BQ1", code: "B/4.1", description: "Ceramic floor tiles", unit: "m2", rate: 85 },
    { id: "BQ2", code: "B/4.2", description: "Skirting", unit: "m", rate: 22 }
];

/* ---------- rate cross-check: the consultant's core duty ---------- */

test("a rate equal to the contract BQ rate reads as the same rate", () => {
    const c = checkRate({ bqItemId: "BQ1", qty: 10, rate: 85 }, bq);
    assert.strictEqual(c.state, "same");
    assert.match(c.detail, /B\/4\.1/);
});

test("a rate within half a sen of the BQ rate still reads as the same rate", () => {
    const c = checkRate({ bqItemId: "BQ1", qty: 10, rate: 85.004 }, bq);
    assert.strictEqual(c.state, "same");
});

test("an overstated rate is flagged and names the governing rate", () => {
    const c = checkRate({ bqItemId: "BQ2", qty: 168, rate: 31 }, bq);
    assert.strictEqual(c.state, "different");
    assert.match(c.detail, /overstated/);
    assert.match(c.detail, /RM 9\.00/);
    assert.match(c.detail, /contract BQ rate governs/i);
    assert.strictEqual(c.contractRate, 22);
    assert.strictEqual(c.diff, 9);
});

test("an understated rate is flagged as understated", () => {
    const c = checkRate({ bqItemId: "BQ2", qty: 10, rate: 20 }, bq);
    assert.strictEqual(c.state, "different");
    assert.match(c.detail, /understated/);
});

test("a row with no BQ link is a star rate", () => {
    const c = checkRate({ bqItemId: null, qty: 320, rate: 265 }, bq);
    assert.strictEqual(c.state, "star");
    assert.match(c.detail, /star rate/i);
});

test("a row linked to a deleted BQ item is a star rate, not a crash", () => {
    const c = checkRate({ bqItemId: "BQ-GONE", qty: 1, rate: 5 }, bq);
    assert.strictEqual(c.state, "star");
});

test("rateSummary counts each state across the VO", () => {
    const vo = { measurement: [
        { bqItemId: "BQ1", qty: -320, rate: 85 },
        { bqItemId: null,  qty: 320,  rate: 265 },
        { bqItemId: "BQ2", qty: 168,  rate: 31 }
    ] };
    const s = rateSummary(vo, bq);
    assert.strictEqual(s.same, 1);
    assert.strictEqual(s.star, 1);
    assert.strictEqual(s.different, 1);
    assert.strictEqual(s.rows.length, 3);
});

/* ---------- classification ---------- */

test("a substitution is classified as a specification change", () => {
    const vo = { description: "Change floor finish from ceramic tile to marble tile",
                 measurement: [{ qty: -10, rate: 85 }, { qty: 10, rate: 265 }] };
    assert.strictEqual(classifyVariation(vo).id, "specification");
});

test("only-negative quantities are an omission", () => {
    const vo = { description: "Omit the rear canopy",
                 measurement: [{ qty: -10, rate: 85 }] };
    assert.strictEqual(classifyVariation(vo).id, "omission");
});

test("only-positive quantities on new items are an addition", () => {
    const vo = { description: "Additional external drainage works",
                 measurement: [{ qty: 142, rate: 62 }] };
    assert.strictEqual(classifyVariation(vo).id, "addition");
});

test("a remeasurement of an existing BQ item is a quantity variation", () => {
    const vo = { description: "Remeasurement of drainage pipe quantity",
                 measurement: [{ bqItemId: "BQ1", qty: 20, rate: 85 }] };
    assert.strictEqual(classifyVariation(vo).id, "quantity");
});

test("an empty VO is unclassified rather than guessed", () => {
    assert.strictEqual(classifyVariation({ description: "", measurement: [] }).id,
                       "unclassified");
});

/* ---------- full assessment ---------- */

test("analyse reports variance between claimed and assessed totals", () => {
    const project = { bq: bq };
    const vo = {
        description: "Change floor finish from ceramic tile to marble tile",
        measurement: [
            { bqItemId: "BQ2", qty: 100, rate: 31, assessedQty: 100, assessedRate: 22 }
        ]
    };
    const a = analyse(vo, project);
    assert.strictEqual(a.contractorTotal, 3100);
    assert.strictEqual(a.assessedTotal, 2200);
    assert.strictEqual(a.variance, -900);
    assert.ok(a.clause, "a governing clause should be identified");
    assert.strictEqual(a.rates.different, 1);
    assert.ok(a.findings.some(f => /different/i.test(f)));
});

test("analyse never invents a confidence score", () => {
    const a = analyse({ description: "x", measurement: [] }, { bq: [] });
    assert.strictEqual(a.confidence, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/analysis.test.js`
Expected: FAIL — `Cannot find module '../js/analysis.js'`

- [ ] **Step 3: Write the implementation**

Create `js/analysis.js`:

```js
/* VO-AI | analysis.js
   Deterministic variation analysis: classification, contract clause lookup
   and the contract-BQ rate cross-check. No language model, no invented
   numbers — every output traces to data the user entered. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, contractorTotal, assessedTotal } = require("./calc.js");
    var { matchClause } = require("./clauses.js");
}

const RATE_TOLERANCE = 0.005;   /* half a sen */

/* -----------------------------------------------------------
   Rate cross-check — template.xlsx, consultant sheet:
   "show similar rate / different rate, if different state which rate wrong"
----------------------------------------------------------- */

function checkRate(row, bq) {
    const claimed = Number(row.rate) || 0;
    const item = row.bqItemId
        ? (bq || []).find(b => b.id === row.bqItemId)
        : null;

    if (!item) {
        return {
            state: "star",
            label: "Star rate",
            detail: "No matching contract BQ item. This is a star rate and must be " +
                    "agreed separately, supported by a quotation or rate build-up, " +
                    "before certification."
        };
    }

    const contractRate = Number(item.rate) || 0;
    const diff = claimed - contractRate;

    if (Math.abs(diff) < RATE_TOLERANCE) {
        return {
            state: "same",
            label: "Same rate",
            detail: "Matches contract BQ item " + item.code + " at " +
                    rm(contractRate) + " per " + item.unit + ".",
            contractRate: contractRate,
            diff: 0
        };
    }

    const pct = contractRate === 0 ? null : (diff / contractRate) * 100;

    return {
        state: "different",
        label: "Different rate",
        detail: "Contractor claimed " + rm(claimed) + " but contract BQ item " +
                item.code + " is " + rm(contractRate) + " per " + item.unit + ". " +
                "The contract BQ rate governs — the contractor's rate is " +
                (diff > 0 ? "overstated" : "understated") + " by " + rm(Math.abs(diff)) +
                (pct === null ? "" : " (" + Math.abs(pct).toFixed(1) + "%)") + ".",
        contractRate: contractRate,
        diff: diff,
        pct: pct
    };
}

function rateSummary(vo, bq) {
    const rows = (vo.measurement || []).map(row => ({
        row: row,
        check: checkRate(row, bq)
    }));
    return {
        rows: rows,
        same: rows.filter(r => r.check.state === "same").length,
        different: rows.filter(r => r.check.state === "different").length,
        star: rows.filter(r => r.check.state === "star").length
    };
}

/* -----------------------------------------------------------
   Classification — keyword and measurement-shape rules.
   Order matters: the most specific signal wins.
----------------------------------------------------------- */

const WORK_SECTIONS = [
    { key: /tile|marble|finish|skirting|floor|paint|plaster/i, name: "Finishes" },
    { key: /drain|sewer|pipe|sump|manhole/i,                   name: "External Works & Drainage" },
    { key: /ceiling|cornice|cove/i,                            name: "Ceilings" },
    { key: /door|window|ironmonger|glaz/i,                     name: "Doors & Windows" },
    { key: /concrete|rebar|beam|column|slab|structur/i,        name: "Structural Works" },
    { key: /electric|wiring|light|socket|db\b/i,               name: "Electrical Services" },
    { key: /plumb|sanitary|water|toilet/i,                     name: "Plumbing & Sanitary" }
];

function affectedWork(text) {
    const hit = WORK_SECTIONS.find(s => s.key.test(text || ""));
    return hit ? hit.name : "General Works";
}

function classifyVariation(vo) {
    const text = (vo.description || "");
    const rows = vo.measurement || [];

    const label = (id, name) => ({
        id: id,
        label: name,
        affectedWork: affectedWork(text)
    });

    if (!text.trim() && rows.length === 0) {
        return label("unclassified", "Not yet classified");
    }

    /* A substitution shows up as an omission and an addition together,
       or as explicit substitution wording. */
    const hasNegative = rows.some(r => (Number(r.qty) || 0) < 0);
    const hasPositive = rows.some(r => (Number(r.qty) || 0) > 0);

    if (/\bfrom\b.+\bto\b|substitut|replace|change of|upgrade/i.test(text) ||
        (hasNegative && hasPositive)) {
        return label("specification", "Material / specification change");
    }

    if (/remeasure|remeasurement|quantity variation|approximate quantit|provisional quantit/i.test(text)) {
        return label("quantity", "Quantity variation / remeasurement");
    }

    if (/\bomit|omission|delete|remove\b/i.test(text) || (hasNegative && !hasPositive)) {
        return label("omission", "Omission of work");
    }

    if (/redesign|design revision|revised design|revision to/i.test(text)) {
        return label("design", "Design revision");
    }

    if (/additional|extra work|add\b|new\b/i.test(text) || hasPositive) {
        /* Extra quantity of an item already in the BQ is a remeasurement,
           not new work. */
        const allLinked = rows.length > 0 && rows.every(r => r.bqItemId);
        return allLinked
            ? label("quantity", "Quantity variation / remeasurement")
            : label("addition", "Additional work");
    }

    return label("unclassified", "Not yet classified");
}

/* -----------------------------------------------------------
   Full assessment
----------------------------------------------------------- */

function analyse(vo, project) {
    const bq = (project && project.bq) || [];
    const classification = classifyVariation(vo);
    const clause = matchClause(classification.id);
    const rates = rateSummary(vo, bq);

    const claimed = contractorTotal(vo);
    const assessed = assessedTotal(vo);

    const findings = [];

    if (rates.different > 0) {
        findings.push(
            rates.different + " row(s) use a rate that is different from the contract " +
            "BQ. The contract BQ rate governs — correct the assessed rate before approval.");
    }
    if (rates.star > 0) {
        findings.push(
            rates.star + " row(s) have no comparable contract BQ item and must be " +
            "agreed as star rates, supported by a quotation or rate build-up.");
    }
    if (rates.same > 0 && rates.different === 0 && rates.star === 0) {
        findings.push("All rates match the contract BQ. No rate adjustment required.");
    }
    if (Math.abs(assessed - claimed) >= 0.01) {
        findings.push(
            "Assessed value differs from the contractor's claim by " +
            rm(Math.abs(assessed - claimed)) +
            (assessed < claimed ? " (reduction)." : " (increase)."));
    }
    if (!clause) {
        findings.push(
            "The change could not be classified from the description. Enter a clearer " +
            "description so the governing contract clause can be identified.");
    }
    if ((vo.measurement || []).length === 0) {
        findings.push("No measurement has been entered, so no cost impact can be assessed.");
    }

    return {
        classification: classification,
        clause: clause,
        rates: rates,
        contractorTotal: claimed,
        assessedTotal: assessed,
        variance: assessed - claimed,
        findings: findings
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        RATE_TOLERANCE, checkRate, rateSummary,
        classifyVariation, affectedWork, analyse
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/analysis.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole suite**

Run: `node --test test/`
Expected: PASS, 33 tests across 4 files.

- [ ] **Step 6: Commit**

```bash
git add js/analysis.js test/analysis.test.js
git commit -m "feat: add variation classification and contract BQ rate cross-check"
```

---

### Task 5: Data model, seed data and storage (`js/store.js`)

**Files:**
- Create: `js/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: `today` from `js/calc.js`.
- Produces:
  - `ROLES: {contractor|consultant|client: {id, label, blurb, icon, colour}}`
  - `newVO(seq: number): object` — a blank VO with every field from the spec's data model
  - `seedDB(): {projects: object[]}` — the §7 demo scenario
  - `loadDB()`, `saveDB(db)`, `resetDB()`
  - `getSession()`, `setSession(s)`, `clearSession()`
  - `createProject(data, session)`, `getProject(id)`, `updateProject(id, mutator)`
  - `createVO(projectId, session)`, `updateVO(projectId, voId, mutator)`
  - `logHistory(vo, session, action)`
  - `uid(prefix)`

`newVO` and `seedDB` are pure and get tested; the localStorage functions are exercised
manually in the browser (Task 6 onwards) since there is no DOM in Node.

- [ ] **Step 1: Write the failing test**

Create `test/store.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { ROLES, newVO, seedDB } = require("../js/store.js");
const { projectStats } = require("../js/calc.js");
const { rateSummary, classifyVariation } = require("../js/analysis.js");

test("there are exactly three roles", () => {
    assert.deepStrictEqual(Object.keys(ROLES).sort(),
        ["client", "consultant", "contractor"]);
    for (const r of Object.values(ROLES)) {
        assert.ok(r.id && r.label && r.blurb && r.icon && r.colour);
    }
});

test("a new VO carries every field in the data model", () => {
    const vo = newVO(4);
    assert.strictEqual(vo.no, "VO-004");
    for (const f of ["description", "dateIssued", "typeOfInstruction", "instructionNo",
                     "revisedDrawing", "oldDrawing", "supportingDocs", "measurement",
                     "contractorRemark", "submitted", "dueDate", "assessmentNote",
                     "timeImpact", "evaluateStatus", "consultantRemark",
                     "certifiedStatus", "finalPrice", "clientRemark", "history"]) {
        assert.ok(f in vo, "missing field: " + f);
    }
    assert.strictEqual(vo.evaluateStatus, "Draft");
    assert.strictEqual(vo.certifiedStatus, "Pending");
    assert.strictEqual(vo.submitted, false);
});

test("the seed project matches the demo scenario in the spec", () => {
    const db = seedDB();
    assert.strictEqual(db.projects.length, 1);
    const p = db.projects[0];
    assert.match(p.name, /ABC Residence/);
    assert.ok(p.bq.length >= 5, "the BQ needs enough items to link against");
    assert.strictEqual(p.vos.length, 3);
});

test("the seed VOs cover all three workflow states", () => {
    const p = seedDB().projects[0];
    const statuses = p.vos.map(v => v.evaluateStatus);
    assert.ok(statuses.includes("Approved"));
    assert.ok(statuses.includes("Pending"));
    assert.ok(statuses.includes("Draft"));
});

test("VO-001 exercises all three rate states, as the demo requires", () => {
    const p = seedDB().projects[0];
    const vo1 = p.vos.find(v => v.no === "VO-001");
    const s = rateSummary(vo1, p.bq);
    assert.strictEqual(s.same, 1);
    assert.strictEqual(s.star, 1);
    assert.strictEqual(s.different, 1);
});

test("VO-001 classifies as a specification change", () => {
    const p = seedDB().projects[0];
    const vo1 = p.vos.find(v => v.no === "VO-001");
    assert.strictEqual(classifyVariation(vo1).id, "specification");
});

test("every seed measurement row links to a real BQ item or to nothing", () => {
    const p = seedDB().projects[0];
    const ids = p.bq.map(b => b.id);
    for (const vo of p.vos) {
        for (const row of vo.measurement) {
            if (row.bqItemId !== null) {
                assert.ok(ids.includes(row.bqItemId),
                    vo.no + " links to missing BQ item " + row.bqItemId);
            }
        }
    }
});

test("the seed project produces sensible dashboard statistics", () => {
    const p = seedDB().projects[0];
    const s = projectStats(p);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.draft, 1);
    assert.strictEqual(s.approved, 1);
    assert.ok(s.value > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/store.test.js`
Expected: FAIL — `Cannot find module '../js/store.js'`

- [ ] **Step 3: Write the implementation**

Create `js/store.js`. The seed data must satisfy the tests above — in particular VO-001's
three measurement rows must produce exactly one `same`, one `star` and one `different`.

```js
/* VO-AI | store.js
   Data model, seed data and localStorage persistence.
   One database key, one session key. No backend. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { today } = require("./calc.js");
}

const DB_KEY = "voai.db.v1";
const SESSION_KEY = "voai.session.v1";

const ROLES = {
    contractor: {
        id: "contractor",
        label: "Contractor QS",
        blurb: "Upload the site instruction, drawings and measurement, then submit the VO.",
        icon: "▲",
        colour: "#f59e0b"
    },
    consultant: {
        id: "consultant",
        label: "Consultant QS",
        blurb: "Create the project, upload the contract and BQ, then assess cost and time impact.",
        icon: "✦",
        colour: "#2563eb"
    },
    client: {
        id: "client",
        label: "Client / Developer",
        blurb: "Review the consultant's recommendation, certify the value and track every VO.",
        icon: "◉",
        colour: "#7c3aed"
    }
};

function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) +
           Math.random().toString(36).slice(2, 6);
}

function newVO(seq) {
    return {
        id: uid("VO"),
        no: "VO-" + String(seq).padStart(3, "0"),

        /* contractor's columns */
        description: "",
        dateIssued: today(),
        typeOfInstruction: "Architect's Instruction (AI)",
        instructionNo: "",
        revisedDrawing: [],
        oldDrawing: [],
        supportingDocs: [],
        measurement: [],
        contractorRemark: "",
        submitted: false,

        /* consultant's columns */
        dueDate: "",
        assessmentNote: "",
        timeImpact: 0,
        evaluateStatus: "Draft",
        consultantRemark: "",

        /* client's columns */
        certifiedStatus: "Pending",
        finalPrice: null,
        clientRemark: "",

        history: []
    };
}

/* ---------- persistence ---------- */

function loadDB() {
    if (typeof localStorage === "undefined") return seedDB();
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
        const fresh = seedDB();
        saveDB(fresh);
        return fresh;
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        const fresh = seedDB();
        saveDB(fresh);
        return fresh;
    }
}

function saveDB(db) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function resetDB() {
    if (typeof localStorage !== "undefined") localStorage.removeItem(DB_KEY);
    return loadDB();
}

/* ---------- session ---------- */

function getSession() {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

/* ---------- projects ---------- */

function createProject(data, session) {
    const db = loadDB();
    const project = {
        id: uid("PRJ"),
        name: data.name,
        client: data.client || "",
        contractNo: data.contractNo || "",
        contractSum: Number(data.contractSum) || 0,
        createdBy: session.name,
        createdByRole: session.role,
        createdAt: new Date().toISOString(),
        bq: [],
        documents: [],
        vos: []
    };
    db.projects.push(project);
    saveDB(db);
    return project;
}

function getProject(projectId) {
    return loadDB().projects.find(p => p.id === projectId) || null;
}

function updateProject(projectId, mutator) {
    const db = loadDB();
    const project = db.projects.find(p => p.id === projectId);
    if (!project) return null;
    mutator(project);
    saveDB(db);
    return project;
}

/* ---------- variation orders ---------- */

function logHistory(vo, session, action) {
    vo.history = vo.history || [];
    vo.history.push({
        at: new Date().toISOString(),
        by: session.name,
        role: session.role,
        action: action
    });
}

function createVO(projectId, session) {
    let created = null;
    updateProject(projectId, project => {
        const vo = newVO(project.vos.length + 1);
        logHistory(vo, session, "VO created");
        project.vos.push(vo);
        created = vo;
    });
    return created;
}

function updateVO(projectId, voId, mutator) {
    return updateProject(projectId, project => {
        const vo = project.vos.find(v => v.id === voId);
        if (vo) mutator(vo, project);
    });
}

/* ---------- seed: the demo scenario from the spec ---------- */

function seedDB() {
    const bq = [
        { id: "BQ1", code: "B/4.1", description: "Ceramic floor tiles 600x600mm to living area", unit: "m2", rate: 85 },
        { id: "BQ2", code: "B/4.2", description: "Skirting to match floor finish", unit: "m", rate: 22 },
        { id: "BQ3", code: "B/5.1", description: "Plaster and paint to internal walls", unit: "m2", rate: 34 },
        { id: "BQ4", code: "C/2.3", description: "Timber flush door 900x2100mm with ironmongery", unit: "no", rate: 640 },
        { id: "BQ5", code: "D/1.2", description: "100mm dia uPVC drainage pipe laid in trench", unit: "m", rate: 48 },
        { id: "BQ6", code: "E/3.1", description: "Suspended plasterboard ceiling incl. framing", unit: "m2", rate: 76 }
    ];

    return {
        projects: [{
            id: "PRJ-CADANGAN",
            name: "Cadangan Pembangunan ABC Residence",
            client: "ABC Development Sdn Bhd",
            contractNo: "ABC/2026/014",
            contractSum: 12500000,
            createdBy: "Serena Wong",
            createdByRole: "consultant",
            createdAt: "2026-06-01T09:00:00Z",
            bq: bq,
            documents: [
                { id: "D1", name: "Contract Agreement - PAM 2018.pdf", size: 2411000, category: "contract", uploadedBy: "Serena Wong", role: "consultant", at: "2026-06-01T09:10:00Z" },
                { id: "D2", name: "Bills of Quantities (Priced).pdf", size: 5820000, category: "bq", uploadedBy: "Serena Wong", role: "consultant", at: "2026-06-01T09:14:00Z" }
            ],
            vos: [
                {
                    id: "VO-SEED-1",
                    no: "VO-001",
                    description: "Change of living area floor finish from ceramic tile to marble tile",
                    dateIssued: "2026-07-14",
                    typeOfInstruction: "Architect's Instruction (AI)",
                    instructionNo: "AI-021",
                    revisedDrawing: [{ id: "F1", name: "A-201 Rev C - Floor Finishes.pdf", size: 1840000, uploadedBy: "Ong Wei Han", at: "2026-07-14" }],
                    oldDrawing: [{ id: "F2", name: "A-201 Rev B - Floor Finishes.pdf", size: 1790000, uploadedBy: "Ong Wei Han", at: "2026-07-14" }],
                    supportingDocs: [
                        { id: "F3", name: "Marble supplier quotation.pdf", size: 410000, uploadedBy: "Ong Wei Han", at: "2026-07-15" },
                        { id: "F4", name: "Site photos - living area.jpg", size: 2200000, uploadedBy: "Ong Wei Han", at: "2026-07-15" }
                    ],
                    measurement: [
                        /* same: omitted at the contract BQ rate */
                        { id: "M1", bqItemId: "BQ1", description: "Omit ceramic floor tiles to living area",
                          unit: "m2", qty: -320, rate: 85, assessedQty: -320, assessedRate: 85 },
                        /* star: no comparable BQ item, consultant negotiated the rate down */
                        { id: "M2", bqItemId: null, description: "Add marble floor tiles 600x600mm to living area",
                          unit: "m2", qty: 320, rate: 265, assessedQty: 320, assessedRate: 248 },
                        /* different: claimed RM 31 against BQ RM 22 */
                        { id: "M3", bqItemId: "BQ2", description: "Skirting to match new marble finish",
                          unit: "m", qty: 168, rate: 31, assessedQty: 168, assessedRate: 22 }
                    ],
                    contractorRemark: "Marble supplied by nominated supplier. Lead time 4 weeks.",
                    submitted: true,
                    dueDate: "2026-07-28",
                    assessmentNote:
                        "Instructed under AI-021 and outside the original scope, so the change ranks " +
                        "as a variation. The omission is valued at the contract BQ rate. The marble " +
                        "rate has no comparable BQ item and has been agreed as a star rate against the " +
                        "supplier quotation. The skirting rate reverts to the contract BQ rate.",
                    timeImpact: 7,
                    evaluateStatus: "Approved",
                    consultantRemark: "Recommend approval at the assessed value.",
                    certifiedStatus: "Approved",
                    finalPrice: 55856,
                    clientRemark: "Certified for payment in interim certificate no. 8.",
                    history: [
                        { at: "2026-07-14T09:12:00Z", by: "Ong Wei Han", role: "contractor", action: "VO created" },
                        { at: "2026-07-15T16:40:00Z", by: "Ong Wei Han", role: "contractor", action: "Submitted to consultant" },
                        { at: "2026-07-22T11:05:00Z", by: "Serena Wong", role: "consultant", action: "Assessment completed — Approved" },
                        { at: "2026-07-25T10:20:00Z", by: "Tan Zi Qian", role: "client", action: "Certified — Approved" }
                    ]
                },
                {
                    id: "VO-SEED-2",
                    no: "VO-002",
                    description: "Additional external drainage works to rear boundary",
                    dateIssued: "2026-08-03",
                    typeOfInstruction: "Engineer's instruction (EI)",
                    instructionNo: "EI-008",
                    revisedDrawing: [{ id: "F5", name: "C-104 Rev A - External Drainage.pdf", size: 990000, uploadedBy: "Ong Wei Han", at: "2026-08-03" }],
                    oldDrawing: [],
                    supportingDocs: [{ id: "F6", name: "Site instruction EI-008.pdf", size: 260000, uploadedBy: "Ong Wei Han", at: "2026-08-03" }],
                    measurement: [
                        { id: "M4", bqItemId: "BQ5", description: "100mm dia uPVC drainage pipe laid in trench to rear boundary",
                          unit: "m", qty: 142, rate: 62, assessedQty: "", assessedRate: "" },
                        { id: "M5", bqItemId: null, description: "Precast concrete sump 600x600mm with cover",
                          unit: "no", qty: 4, rate: 1250, assessedQty: "", assessedRate: "" }
                    ],
                    contractorRemark: "Works instructed on site by the C&S engineer on 03/08/2026.",
                    submitted: true,
                    dueDate: "2026-08-31",
                    assessmentNote: "",
                    timeImpact: 0,
                    evaluateStatus: "Pending",
                    consultantRemark: "",
                    certifiedStatus: "Pending",
                    finalPrice: null,
                    clientRemark: "",
                    history: [
                        { at: "2026-08-03T08:30:00Z", by: "Ong Wei Han", role: "contractor", action: "VO created" },
                        { at: "2026-08-04T14:02:00Z", by: "Ong Wei Han", role: "contractor", action: "Submitted to consultant" }
                    ]
                },
                {
                    id: "VO-SEED-3",
                    no: "VO-003",
                    description: "Revision to master bedroom ceiling design",
                    dateIssued: "2026-08-18",
                    typeOfInstruction: "Architect's Instruction (AI)",
                    instructionNo: "AI-027",
                    revisedDrawing: [], oldDrawing: [], supportingDocs: [],
                    measurement: [
                        { id: "M6", bqItemId: "BQ6", description: "Suspended plasterboard ceiling with additional cove detail",
                          unit: "m2", qty: 96, rate: 76, assessedQty: "", assessedRate: "" }
                    ],
                    contractorRemark: "",
                    submitted: false,
                    dueDate: "",
                    assessmentNote: "",
                    timeImpact: 0,
                    evaluateStatus: "Draft",
                    consultantRemark: "",
                    certifiedStatus: "Pending",
                    finalPrice: null,
                    clientRemark: "",
                    history: [
                        { at: "2026-08-18T09:00:00Z", by: "Ong Wei Han", role: "contractor", action: "VO created" }
                    ]
                }
            ]
        }]
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        DB_KEY, SESSION_KEY, ROLES, uid, newVO,
        loadDB, saveDB, resetDB,
        getSession, setSession, clearSession,
        createProject, getProject, updateProject,
        createVO, updateVO, logHistory, seedDB
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/store.test.js`
Expected: PASS, 8 tests.

If `VO-001 exercises all three rate states` fails, check that M1's rate equals BQ1's
rate (85), M2 has `bqItemId: null`, and M3's rate (31) differs from BQ2's rate (22).

- [ ] **Step 5: Commit**

```bash
git add js/store.js test/store.test.js
git commit -m "feat: add VO data model, seed scenario and localStorage persistence"
```

---

### Task 6: Shared chrome and the login screen (`js/ui.js`, `index.html`)

**Files:**
- Create: `js/ui.js`
- Modify: `index.html` (replace the mockup dashboard entirely)
- Modify: `style.css` (append the new component block)
- Test: `test/ui.test.js`

**Interfaces:**
- Consumes: `ROLES`, `getSession`, `setSession`, `clearSession`, `loadDB` from `store`;
  `rm`, `prettyDate` from `calc`.
- Produces:
  - `statusPill(status: string): string` — HTML for a `.status` span
  - `initials(name: string): string`
  - `escapeHtml(s: string): string`
  - `renderSidebar(active: string, session: object, project: object|null): string`
  - `renderTopbar(title: string, crumb: string, session: object): string`
  - `mountChrome(active, title, crumb)` — writes sidebar + topbar into the page, guards the route
  - `toast(message: string, kind?: "ok"|"warn"|"error")`
  - `requireSession(): object|null` — redirects to `index.html` when absent
  - `requireProject(): {session, project}|null` — redirects to `projects.html` when absent

- [ ] **Step 1: Write the failing test**

Create `test/ui.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ui.test.js`
Expected: FAIL — `Cannot find module '../js/ui.js'`

- [ ] **Step 3: Write `js/ui.js`**

```js
/* VO-AI | ui.js — shared page chrome, guards and small render helpers. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { ROLES } = require("./store.js");
}

const NAV = [
    { id: "dashboard", href: "dashboard.html", icon: "⌂", label: "Dashboard" },
    { id: "projects",  href: "projects.html",  icon: "▣", label: "Projects" },
    { id: "register",  href: "register.html",  icon: "▤", label: "VO Register" },
    { id: "report",    href: "report.html",    icon: "▧", label: "VO Reports" }
];

function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    return parts.slice(0, 2).map(p => p[0].toUpperCase()).join("");
}

const STATUS_CLASS = {
    "Approved": "approved",
    "Pending": "pending",
    "Under Review": "review",
    "Rejected": "rejected",
    "Draft": "draft"
};

function statusPill(status) {
    const cls = STATUS_CLASS[status] || "draft";
    return '<span class="status ' + cls + '">' + escapeHtml(status) + "</span>";
}

function renderSidebar(active, session, project) {
    const role = ROLES[session.role] || ROLES.contractor;

    const items = NAV.map(n =>
        '<a href="' + n.href + '" class="nav-item' +
        (n.id === active ? " active" : "") + '">' +
        "<span>" + n.icon + "</span>" + n.label + "</a>"
    ).join("");

    /* template.xlsx: "Each sheet need to mention what project at the above" */
    const projectBox = project
        ? '<div class="project-chip"><small>CURRENT PROJECT</small><strong>' +
          escapeHtml(project.name) + "</strong></div>"
        : "";

    return '' +
        '<div class="logo">' +
            '<div class="logo-icon">V</div>' +
            "<div><h2>VO-AI</h2><span>Variation Intelligence</span></div>" +
        "</div>" +
        projectBox +
        "<nav>" + items + "</nav>" +
        '<div class="sidebar-bottom">' +
            '<div class="user-profile">' +
                '<div class="avatar" style="background:' + role.colour + '">' +
                    initials(session.name) + "</div>" +
                "<div><strong>" + escapeHtml(session.name) + "</strong>" +
                "<span>" + role.label + "</span></div>" +
            "</div>" +
            '<button class="signout-button" id="signOutBtn">Switch role / sign out</button>' +
        "</div>";
}

function renderTopbar(title, crumb, session) {
    const role = ROLES[session.role] || ROLES.contractor;
    return '' +
        "<div>" +
            '<p class="breadcrumb">' + escapeHtml(crumb) + "</p>" +
            "<h1>" + escapeHtml(title) + "</h1>" +
        "</div>" +
        '<div class="top-actions">' +
            '<div class="role" style="border-color:' + role.colour + '">' +
                role.icon + " " + role.label +
            "</div>" +
        "</div>";
}

/* ---------- browser-only below ---------- */

function requireSession() {
    const s = getSession();
    if (!s) { window.location.href = "index.html"; return null; }
    return s;
}

function requireProject() {
    const session = requireSession();
    if (!session) return null;
    const db = loadDB();
    const project = db.projects.find(p => p.id === session.projectId);
    if (!project) { window.location.href = "projects.html"; return null; }
    return { session: session, project: project };
}

function toast(message, kind) {
    let host = document.getElementById("toastHost");
    if (!host) {
        host = document.createElement("div");
        host.id = "toastHost";
        host.className = "toast-host";
        document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "toast " + (kind || "ok");
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.classList.add("out"), 3200);
    setTimeout(() => el.remove(), 3600);
}

/* Fills <aside class="sidebar"> and <header class="topbar">, wires sign-out.
   Returns {session, project} or null when the guard has redirected. */
function mountChrome(active, title, crumb, opts) {
    const needProject = !(opts && opts.projectOptional);
    const ctx = needProject ? requireProject()
                            : (requireSession() ? { session: getSession(), project: null } : null);
    if (!ctx) return null;

    const aside = document.querySelector("aside.sidebar");
    const header = document.querySelector("header.topbar");
    if (aside) aside.innerHTML = renderSidebar(active, ctx.session, ctx.project);
    if (header) header.innerHTML = renderTopbar(title, crumb, ctx.session);

    const btn = document.getElementById("signOutBtn");
    if (btn) btn.addEventListener("click", () => {
        clearSession();
        window.location.href = "index.html";
    });
    return ctx;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { NAV, escapeHtml, initials, statusPill, renderSidebar, renderTopbar };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/ui.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Append the new styles to `style.css`**

Add at the end of `style.css` (keep everything already there — the pages reuse it):

```css
/* =========================
   LOGIN / ROLE PICKER
========================= */

.login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    background: linear-gradient(160deg, #111827 0%, #1e3a8a 100%);
}

.login-card {
    background: white;
    border-radius: 16px;
    padding: 40px;
    width: 100%;
    max-width: 720px;
}

.login-card > .logo { padding: 0 0 25px; }
.login-card > .logo h2 { color: #172033; }
.login-card > .logo span { color: #8992a3; }

.login-card h1 { font-size: 22px; margin-bottom: 6px; }
.login-card .lead { font-size: 13px; color: #737d90; margin-bottom: 25px; }

.role-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-bottom: 25px;
}

.role-option {
    border: 2px solid #e8ebf0;
    border-radius: 12px;
    padding: 18px;
    cursor: pointer;
    text-align: left;
    background: white;
    font-family: inherit;
}

.role-option:hover { border-color: #c7d5f5; }
.role-option.selected { border-color: #2563eb; background: #f5f8ff; }

.role-option .role-icon {
    width: 38px; height: 38px;
    border-radius: 9px;
    color: white;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 12px;
    font-size: 16px;
}

.role-option strong { display: block; font-size: 13px; margin-bottom: 5px; }
.role-option span { font-size: 10px; color: #8992a3; line-height: 1.5; }

/* =========================
   FORMS
========================= */

.field { margin-bottom: 16px; }
.field label { display: block; font-size: 11px; font-weight: bold; margin-bottom: 6px; }
.field input, .field select, .field textarea {
    width: 100%;
    border: 1px solid #dfe3e8;
    border-radius: 7px;
    padding: 11px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    background: white;
    color: #172033;
}
.field textarea { min-height: 90px; resize: vertical; }
.field input:focus, .field select:focus, .field textarea:focus { border-color: #2563eb; }
.field .hint { font-size: 10px; color: #8992a3; margin-top: 5px; }

/* The template's "yellow" rule, made visible. */
.field.owned input, .field.owned select, .field.owned textarea,
input.owned, select.owned, textarea.owned {
    background: #fffdf2;
    border-color: #f0d98a;
}

.field.locked input, .field.locked select, .field.locked textarea {
    background: #f4f6f9;
    color: #8992a3;
    cursor: not-allowed;
}

.lock-note {
    display: block;
    font-size: 10px;
    color: #97794a;
    margin-top: 5px;
}

/* =========================
   PROJECT CHIP IN SIDEBAR
========================= */

.project-chip {
    background: #1f2937;
    border-radius: 9px;
    padding: 12px;
    margin-bottom: 18px;
}
.project-chip small { display: block; font-size: 8px; color: #6b7280; letter-spacing: .08em; }
.project-chip strong { display: block; font-size: 11px; color: white; margin-top: 5px; line-height: 1.4; }

.signout-button {
    width: 100%;
    border: 1px solid #374151;
    background: transparent;
    color: #9ca3af;
    padding: 9px;
    border-radius: 7px;
    font-size: 10px;
    cursor: pointer;
    font-family: inherit;
}
.signout-button:hover { background: #1f2937; color: white; }

/* =========================
   EXTRA STATUS COLOURS
========================= */

.rejected { background: #fdeaea; color: #b91c1c; }
.draft    { background: #eef0f3; color: #6b7280; }

/* =========================
   RATE CROSS-CHECK
========================= */

.rate-flag {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 20px;
    font-size: 9px;
    font-weight: bold;
    white-space: nowrap;
}
.rate-flag.same      { background: #e7f8ef; color: #15803d; }
.rate-flag.different { background: #fdeaea; color: #b91c1c; }
.rate-flag.star      { background: #f1eaff; color: #6d28d9; }

.rate-detail { font-size: 10px; color: #687386; line-height: 1.55; margin-top: 5px; }

.finding {
    display: flex;
    gap: 9px;
    padding: 11px 13px;
    border-radius: 8px;
    background: #f8fafc;
    border: 1px solid #e8ebf0;
    font-size: 10px;
    line-height: 1.6;
    margin-bottom: 8px;
    color: #4b5563;
}
.finding::before { content: "▸"; color: #2563eb; }

/* =========================
   TOASTS
========================= */

.toast-host {
    position: fixed;
    right: 22px; bottom: 22px;
    display: flex; flex-direction: column; gap: 8px;
    z-index: 999;
}
.toast {
    background: #111827;
    color: white;
    padding: 12px 16px;
    border-radius: 9px;
    font-size: 11px;
    max-width: 320px;
    opacity: 1;
    transition: opacity .35s ease;
}
.toast.warn  { background: #92400e; }
.toast.error { background: #b91c1c; }
.toast.out   { opacity: 0; }

/* =========================
   MISC
========================= */

.page-actions { display: flex; gap: 9px; flex-wrap: wrap; margin-bottom: 20px; }
.card-body { padding: 20px; }
.empty-state { padding: 45px 20px; text-align: center; color: #8992a3; font-size: 12px; }
.table-scroll { overflow-x: auto; }

.secondary-button {
    padding: 11px 16px;
    border: 1px solid #dce1e8;
    background: white;
    border-radius: 8px;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    color: #172033;
}
.secondary-button:hover { border-color: #2563eb; color: #2563eb; }

.danger-button {
    padding: 11px 16px;
    border: 1px solid #fca5a5;
    background: white;
    color: #b91c1c;
    border-radius: 8px;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
}

@media (max-width: 800px) {
    .role-grid { grid-template-columns: 1fr; }
}

@media print {
    .sidebar, .topbar, .page-actions, .toast-host, .signout-button { display: none !important; }
    .main { margin-left: 0; padding: 0; }
    .card { border: 1px solid #ccc; break-inside: avoid; }
}
```

- [ ] **Step 6: Replace `index.html` with the login screen**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VO-AI | Sign in</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>

<div class="login-page">
    <div class="login-card">

        <div class="logo">
            <div class="logo-icon">V</div>
            <div>
                <h2>VO-AI</h2>
                <span>Variation Intelligence</span>
            </div>
        </div>

        <h1>Sign in to VO-AI</h1>
        <p class="lead">
            Choose the role you are acting as. Each role can only edit its own
            columns of the variation order register.
        </p>

        <div class="field">
            <label for="userName">Your name</label>
            <input type="text" id="userName" placeholder="e.g. Serena Wong" autocomplete="name">
        </div>

        <label style="display:block;font-size:11px;font-weight:bold;margin-bottom:8px">
            Your role
        </label>
        <div class="role-grid" id="roleGrid"></div>

        <button class="primary-button" id="signInBtn" style="width:100%">
            Continue →
        </button>

        <p class="lead" style="margin:18px 0 0;font-size:10px">
            This is a demonstration prototype. No password is used and no data leaves
            your browser — everything is stored locally on this computer.
        </p>

    </div>
</div>

<script src="js/calc.js"></script>
<script src="js/store.js"></script>
<script src="js/ui.js"></script>
<script src="js/page-login.js"></script>

</body>
</html>
```

- [ ] **Step 7: Write `js/page-login.js`**

```js
/* VO-AI | page-login.js — Stage 1: pick a role and sign in. */

(function () {
    let selectedRole = null;

    const grid = document.getElementById("roleGrid");
    const nameInput = document.getElementById("userName");

    /* Suggested names make the demo faster to walk through. */
    const SUGGESTED = {
        contractor: "Ong Wei Han",
        consultant: "Serena Wong",
        client: "Tan Zi Qian"
    };

    grid.innerHTML = Object.values(ROLES).map(r =>
        '<button type="button" class="role-option" data-role="' + r.id + '">' +
            '<div class="role-icon" style="background:' + r.colour + '">' + r.icon + "</div>" +
            "<strong>" + r.label + "</strong>" +
            "<span>" + r.blurb + "</span>" +
        "</button>"
    ).join("");

    grid.addEventListener("click", e => {
        const btn = e.target.closest(".role-option");
        if (!btn) return;
        selectedRole = btn.dataset.role;
        grid.querySelectorAll(".role-option")
            .forEach(b => b.classList.toggle("selected", b === btn));
        if (!nameInput.value.trim()) nameInput.value = SUGGESTED[selectedRole] || "";
    });

    document.getElementById("signInBtn").addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) { toast("Enter your name to continue.", "warn"); nameInput.focus(); return; }
        if (!selectedRole) { toast("Choose the role you are acting as.", "warn"); return; }

        setSession({ name: name, role: selectedRole, projectId: null });
        window.location.href = "projects.html";
    });

    /* Enter submits. */
    nameInput.addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("signInBtn").click();
    });
})();
```

- [ ] **Step 8: Verify in the browser**

Run: `python -m http.server 8080` from the repo root, open `http://localhost:8080/`.
Expected: role cards render; selecting one fills the suggested name; clicking Continue
with an empty name shows a toast rather than an `alert`; a valid sign-in lands on
`projects.html` (which 404s until Task 7 — that is expected).
Check DevTools console: no errors. Check `localStorage` holds `voai.session.v1`.

- [ ] **Step 9: Commit**

```bash
git add js/ui.js js/page-login.js index.html style.css test/ui.test.js
git commit -m "feat: add shared page chrome and role-based sign-in"
```

---

### Task 7: Project create and select (`projects.html`, `js/page-projects.js`)

Stages 2 and 3: the consultant creates a project and uploads the contract and BQ; every
role picks the project to work on.

**Files:**
- Create: `projects.html`, `js/page-projects.js`
- Test: `test/page-projects.test.js`

**Interfaces:**
- Consumes: `loadDB`, `createProject`, `updateProject`, `getSession`, `setSession`, `uid`
  from `store`; `rm`, `prettyDate`, `projectStats` from `calc`; `escapeHtml` from `ui`.
- Produces:
  - `renderProjectCard(project, session): string`
  - `renderBqRow(item, canEdit): string`
  - `parseBqPaste(text: string): Array<{code, description, unit, rate}>` — parses
    tab- or comma-separated pasted BQ lines

- [ ] **Step 1: Write the failing test**

Create `test/page-projects.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { renderProjectCard, parseBqPaste } = require("../js/page-projects.js");

test("parseBqPaste reads tab separated BQ lines", () => {
    const rows = parseBqPaste("B/4.1\tCeramic floor tiles\tm2\t85\nB/4.2\tSkirting\tm\t22");
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0],
        { code: "B/4.1", description: "Ceramic floor tiles", unit: "m2", rate: 85 });
    assert.strictEqual(rows[1].rate, 22);
});

test("parseBqPaste reads comma separated lines and trims spaces", () => {
    const rows = parseBqPaste(" C/2.3 , Timber door , no , 640 ");
    assert.deepStrictEqual(rows[0],
        { code: "C/2.3", description: "Timber door", unit: "no", rate: 640 });
});

test("parseBqPaste skips blank lines and malformed rows", () => {
    const rows = parseBqPaste("B/1\tOK\tm\t10\n\nnot enough columns\n\nB/2\tAlso OK\tm\t20");
    assert.strictEqual(rows.length, 2);
});

test("parseBqPaste treats an unparseable rate as zero rather than NaN", () => {
    const rows = parseBqPaste("B/1\tItem\tm\tabc");
    assert.strictEqual(rows[0].rate, 0);
});

test("a project card shows the name, contract number and VO count", () => {
    const html = renderProjectCard({
        id: "P1", name: "ABC Residence", client: "ABC Sdn Bhd",
        contractNo: "ABC/2026/014", contractSum: 1000000, bq: [], documents: [],
        vos: [{ evaluateStatus: "Approved", certifiedStatus: "Pending", timeImpact: 0,
                measurement: [{ qty: 1, rate: 500 }] }]
    }, { role: "client" });
    assert.match(html, /ABC Residence/);
    assert.match(html, /ABC\/2026\/014/);
    assert.match(html, /RM 500\.00/);
});

test("project card escapes a name containing markup", () => {
    const html = renderProjectCard({
        id: "P1", name: "<img src=x onerror=1>", client: "", contractNo: "",
        contractSum: 0, bq: [], documents: [], vos: []
    }, { role: "client" });
    assert.ok(!html.includes("<img src=x"));
    assert.match(html, /&lt;img/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/page-projects.test.js`
Expected: FAIL — `Cannot find module '../js/page-projects.js'`

- [ ] **Step 3: Write `js/page-projects.js`**

```js
/* VO-AI | page-projects.js — Stage 2 & 3: create and choose a project. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, projectStats } = require("./calc.js");
    var { escapeHtml } = require("./ui.js");
}

/* Accepts a BQ pasted straight out of Excel (tab separated) or a CSV.
   Columns: code, description, unit, rate. */
function parseBqPaste(text) {
    return String(text || "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(line.includes("\t") ? "\t" : ",").map(c => c.trim()))
        .filter(cells => cells.length >= 4)
        .map(cells => ({
            code: cells[0],
            description: cells[1],
            unit: cells[2],
            rate: Number(cells[3]) || 0
        }));
}

function renderProjectCard(project, session) {
    const s = projectStats(project);
    return '' +
        '<div class="card project-card" data-project="' + escapeHtml(project.id) + '">' +
          '<div class="card-body">' +
            "<h3>" + escapeHtml(project.name) + "</h3>" +
            '<p class="lead" style="font-size:11px;margin:6px 0 14px">' +
                escapeHtml(project.client || "—") + " · Contract " +
                escapeHtml(project.contractNo || "—") + "</p>" +
            '<div class="project-meta">' +
                "<div><small>VOs</small><strong>" + s.total + "</strong></div>" +
                "<div><small>Pending</small><strong>" + s.pending + "</strong></div>" +
                "<div><small>VO value</small><strong>" + rm(s.value) + "</strong></div>" +
                "<div><small>BQ items</small><strong>" + (project.bq || []).length + "</strong></div>" +
            "</div>" +
            '<button class="primary-button open-project" style="width:100%;margin-top:16px">' +
                "Open as " + escapeHtml(session.role === "contractor" ? "Contractor QS" :
                    session.role === "consultant" ? "Consultant QS" : "Client") +
            " →</button>" +
          "</div>" +
        "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseBqPaste, renderProjectCard };
}

/* ---------- browser wiring ---------- */

if (typeof document !== "undefined") {
    (function () {
        const session = requireSession();
        if (!session) return;

        const isConsultant = session.role === "consultant";

        function refresh() {
            const db = loadDB();
            const list = document.getElementById("projectList");

            list.innerHTML = db.projects.length === 0
                ? '<div class="empty-state">No projects yet. ' +
                  (isConsultant ? "Create one below to get started."
                                : "Ask the Consultant QS to create the project first.") +
                  "</div>"
                : db.projects.map(p => renderProjectCard(p, session)).join("");

            list.querySelectorAll(".project-card").forEach(card => {
                card.querySelector(".open-project").addEventListener("click", () => {
                    setSession(Object.assign({}, getSession(),
                        { projectId: card.dataset.project }));
                    window.location.href = "dashboard.html";
                });
            });
        }

        /* Stage 2 — only the consultant may create a project. */
        const createBox = document.getElementById("createBox");
        if (!isConsultant) {
            createBox.innerHTML =
                '<div class="empty-state">Only the Consultant QS creates projects and ' +
                "uploads the contract and BQ. Choose an existing project above.</div>";
        } else {
            document.getElementById("createBtn").addEventListener("click", () => {
                const name = document.getElementById("pName").value.trim();
                if (!name) { toast("Give the project a name.", "warn"); return; }

                const project = createProject({
                    name: name,
                    client: document.getElementById("pClient").value.trim(),
                    contractNo: document.getElementById("pContractNo").value.trim(),
                    contractSum: document.getElementById("pSum").value
                }, session);

                const bqRows = parseBqPaste(document.getElementById("pBq").value);
                if (bqRows.length > 0) {
                    updateProject(project.id, p => {
                        bqRows.forEach(r => p.bq.push(Object.assign({ id: uid("BQ") }, r)));
                    });
                }

                const contractName = document.getElementById("pContractFile").value.trim();
                if (contractName) {
                    updateProject(project.id, p => {
                        p.documents.push({
                            id: uid("DOC"), name: contractName, size: 0,
                            category: "contract", uploadedBy: session.name,
                            role: session.role, at: new Date().toISOString()
                        });
                    });
                }

                toast("Project created with " + bqRows.length + " BQ item(s).");
                ["pName", "pClient", "pContractNo", "pSum", "pBq", "pContractFile"]
                    .forEach(id => { document.getElementById(id).value = ""; });
                refresh();
            });
        }

        document.getElementById("resetBtn").addEventListener("click", () => {
            resetDB();
            toast("Demo data restored.");
            refresh();
        });

        refresh();
    })();
}
```

- [ ] **Step 4: Write `projects.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VO-AI | Projects</title>
    <link rel="stylesheet" href="style.css">
    <style>
        .project-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-bottom: 28px; }
        .project-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .project-meta small { display: block; font-size: 9px; color: #8992a3; margin-bottom: 4px; }
        .project-meta strong { font-size: 13px; }
        .create-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        @media (max-width: 900px) {
            .project-list, .create-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>

<aside class="sidebar"></aside>

<main class="main">
    <header class="topbar"></header>

    <section class="welcome">
        <div>
            <h2>Choose a project</h2>
            <p>Every variation order belongs to a project. Open one to continue.</p>
        </div>
        <button class="secondary-button" id="resetBtn">Restore demo data</button>
    </section>

    <div class="project-list" id="projectList"></div>

    <div class="card" id="createBox">
        <div class="card-header">
            <div>
                <h3>Create a new project</h3>
                <p>Stage 2 — the Consultant QS sets up the project and uploads the contract and BQ.</p>
            </div>
        </div>
        <div class="card-body">
            <div class="create-grid">
                <div>
                    <div class="field">
                        <label for="pName">Project name</label>
                        <input type="text" id="pName" placeholder="Cadangan Pembangunan ...">
                    </div>
                    <div class="field">
                        <label for="pClient">Client</label>
                        <input type="text" id="pClient" placeholder="ABC Development Sdn Bhd">
                    </div>
                    <div class="field">
                        <label for="pContractNo">Contract number</label>
                        <input type="text" id="pContractNo" placeholder="ABC/2026/014">
                    </div>
                    <div class="field">
                        <label for="pSum">Contract sum (RM)</label>
                        <input type="number" id="pSum" placeholder="12500000">
                    </div>
                    <div class="field">
                        <label for="pContractFile">Contract document</label>
                        <input type="text" id="pContractFile" placeholder="Contract Agreement - PAM 2018.pdf">
                        <span class="hint">
                            Record the document name. This prototype does not read file
                            contents — see the technical solution section of the proposal.
                        </span>
                    </div>
                </div>
                <div>
                    <div class="field">
                        <label for="pBq">Priced Bills of Quantities</label>
                        <textarea id="pBq" style="min-height:260px" placeholder="Paste from Excel — four columns: code, description, unit, rate

B/4.1&#9;Ceramic floor tiles 600x600mm&#9;m2&#9;85
B/4.2&#9;Skirting to match floor finish&#9;m&#9;22"></textarea>
                        <span class="hint">
                            These rates are what VO-AI cross-checks the contractor's
                            measurement against.
                        </span>
                    </div>
                    <button class="primary-button" id="createBtn" style="width:100%">
                        Create project
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div class="disclaimer">
        <strong>⚠ Professional Review Required</strong>
        <span>
            AI-generated results are decision-support outputs. Final variation assessment,
            certification and approval must be reviewed by the appropriate construction professional.
        </span>
    </div>
</main>

<script src="js/calc.js"></script>
<script src="js/clauses.js"></script>
<script src="js/analysis.js"></script>
<script src="js/permissions.js"></script>
<script src="js/store.js"></script>
<script src="js/ui.js"></script>
<script>mountChrome("projects", "Projects", "VO-AI / Projects", { projectOptional: true });</script>
<script src="js/page-projects.js"></script>

</body>
</html>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/page-projects.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verify in the browser**

Sign in as Consultant QS → the seeded ABC Residence card shows 3 VOs. Paste two BQ lines
into the BQ box, create a project, confirm the card reports 2 BQ items. Sign out, sign in
as Contractor QS → the create box is replaced with the "only the Consultant QS" message.
Click "Restore demo data" → back to one project.

- [ ] **Step 7: Commit**

```bash
git add projects.html js/page-projects.js test/page-projects.test.js
git commit -m "feat: add project creation, BQ upload and project selection"
```

---

### Task 8: Role-aware dashboard (`dashboard.html`, `js/page-dashboard.js`)

**Files:**
- Create: `dashboard.html`, `js/page-dashboard.js`
- Test: `test/page-dashboard.test.js`

**Interfaces:**
- Consumes: `projectStats`, `rm`, `prettyDate`, `voValue` from `calc`; `statusPill`,
  `escapeHtml` from `ui`; `analyse` from `analysis`.
- Produces:
  - `actionItems(project, role): Array<{vo, text}>` — what this role must do next
  - `renderStatCards(stats, role): string`
  - `renderRecentRows(vos): string`

- [ ] **Step 1: Write the failing test**

Create `test/page-dashboard.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { actionItems, renderStatCards, renderRecentRows } = require("../js/page-dashboard.js");
const { seedDB } = require("../js/store.js");
const { projectStats } = require("../js/calc.js");

const project = seedDB().projects[0];

test("the contractor is told to submit the draft VO", () => {
    const items = actionItems(project, "contractor");
    assert.ok(items.some(i => i.vo.no === "VO-003" && /submit/i.test(i.text)));
});

test("the consultant is told to assess the submitted VO", () => {
    const items = actionItems(project, "consultant");
    assert.ok(items.some(i => i.vo.no === "VO-002" && /assess/i.test(i.text)));
    assert.ok(!items.some(i => i.vo.no === "VO-003"),
        "an unsubmitted draft is not the consultant's problem");
});

test("the client only sees VOs that are approved and not yet certified", () => {
    const items = actionItems(project, "client");
    assert.ok(!items.some(i => i.vo.no === "VO-002"));
    assert.ok(!items.some(i => i.vo.no === "VO-001"),
        "VO-001 is already certified");
});

test("stat cards show the four headline numbers", () => {
    const html = renderStatCards(projectStats(project), "consultant");
    assert.match(html, /Total VOs/);
    assert.match(html, /Pending/);
    assert.match(html, /Approved/);
    assert.match(html, /RM /);
});

test("recent rows render newest first and carry a status pill", () => {
    const html = renderRecentRows(project.vos);
    assert.match(html, /class="status/);
    assert.ok(html.indexOf("VO-003") < html.indexOf("VO-001"),
        "newest VO should appear first");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/page-dashboard.test.js`
Expected: FAIL — `Cannot find module '../js/page-dashboard.js'`

- [ ] **Step 3: Write `js/page-dashboard.js`**

```js
/* VO-AI | page-dashboard.js — Stage 4 landing screen, per role. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, voValue, projectStats } = require("./calc.js");
    var { statusPill, escapeHtml } = require("./ui.js");
}

/* What does this role have to do next? */
function actionItems(project, role) {
    const vos = project.vos || [];

    if (role === "contractor") {
        return vos
            .filter(v => !v.submitted || v.evaluateStatus === "Rejected")
            .map(v => ({
                vo: v,
                text: v.evaluateStatus === "Rejected"
                    ? "Rejected by the consultant — revise and submit again."
                    : "Draft — complete the measurement and submit to the consultant."
            }));
    }

    if (role === "consultant") {
        return vos
            .filter(v => v.submitted &&
                (v.evaluateStatus === "Pending" || v.evaluateStatus === "Under Review"))
            .map(v => ({ vo: v, text: "Awaiting your assessment and rate cross-check." }));
    }

    return vos
        .filter(v => v.evaluateStatus === "Approved" && v.certifiedStatus === "Pending")
        .map(v => ({ vo: v, text: "Approved by the consultant — awaiting your certification." }));
}

function renderStatCards(stats, role) {
    const cards = [
        { icon: "▧", cls: "blue",   label: "Total VOs",     value: stats.total,
          note: stats.draft + " still in draft" },
        { icon: "◷", cls: "orange", label: "Pending review", value: stats.pending,
          note: stats.pending > 0 ? "Requires attention" : "Nothing waiting", warn: stats.pending > 0 },
        { icon: "✓", cls: "green",  label: "Approved",       value: stats.approved,
          note: stats.certified + " certified by the client" },
        { icon: "RM", cls: "purple", label: "Total VO value", value: rm(stats.value),
          note: stats.timeImpact + " day(s) approved time impact" }
    ];

    return cards.map(c =>
        '<div class="stat-card">' +
            '<div class="stat-icon ' + c.cls + '">' + c.icon + "</div>" +
            "<div><p>" + c.label + "</p><h2>" + c.value + "</h2>" +
            '<small' + (c.warn ? ' class="warning"' : "") + ">" + escapeHtml(c.note) +
            "</small></div>" +
        "</div>"
    ).join("");
}

function renderRecentRows(vos) {
    const sorted = (vos || []).slice().sort((a, b) =>
        String(b.dateIssued || "").localeCompare(String(a.dateIssued || "")));

    if (sorted.length === 0) {
        return '<tr><td colspan="5" class="empty-state">No variation orders yet.</td></tr>';
    }

    return sorted.slice(0, 6).map(v =>
        '<tr class="vo-row" data-vo="' + escapeHtml(v.id) + '" style="cursor:pointer">' +
            "<td><strong>" + escapeHtml(v.no) + "</strong></td>" +
            "<td>" + escapeHtml(v.description || "—") + "</td>" +
            "<td>" + prettyDate(v.dateIssued) + "</td>" +
            "<td>" + rm(voValue(v)) + "</td>" +
            "<td>" + statusPill(v.evaluateStatus) + "</td>" +
        "</tr>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { actionItems, renderStatCards, renderRecentRows };
}

/* ---------- browser wiring ---------- */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("dashboard", "Dashboard",
            "Project / " + (getSession() || {}).name);
        if (!ctx) return;

        const { session, project } = ctx;
        const stats = projectStats(project);

        document.getElementById("greeting").textContent =
            "Hello, " + session.name;
        document.getElementById("greetingSub").innerHTML =
            "Your variation orders for <strong>" + escapeHtml(project.name) + "</strong>.";

        document.getElementById("statCards").innerHTML = renderStatCards(stats, session.role);
        document.getElementById("recentBody").innerHTML = renderRecentRows(project.vos);

        document.querySelectorAll(".vo-row").forEach(row => {
            row.addEventListener("click", () => {
                window.location.href = "vo.html?id=" + encodeURIComponent(row.dataset.vo);
            });
        });

        /* Action list */
        const items = actionItems(project, session.role);
        document.getElementById("actionList").innerHTML = items.length === 0
            ? '<div class="empty-state">Nothing needs your attention right now.</div>'
            : items.map(i =>
                '<a class="finding" style="text-decoration:none;color:inherit" ' +
                'href="vo.html?id=' + encodeURIComponent(i.vo.id) + '">' +
                "<span><strong>" + escapeHtml(i.vo.no) + "</strong> — " +
                escapeHtml(i.text) + "</span></a>"
            ).join("");

        /* Only the contractor raises a new VO. */
        const newBtn = document.getElementById("newVoBtn");
        if (session.role !== "contractor") {
            newBtn.style.display = "none";
        } else {
            newBtn.addEventListener("click", () => {
                const vo = createVO(project.id, session);
                window.location.href = "vo.html?id=" + encodeURIComponent(vo.id);
            });
        }
    })();
}
```

- [ ] **Step 4: Write `dashboard.html`**

Copy the structure of `projects.html` (same `<aside>`, `<main>`, script block) with this
`<main>` body, and the same script tags plus `<script src="js/page-dashboard.js"></script>`:

```html
    <section class="welcome">
        <div>
            <h2 id="greeting"></h2>
            <p id="greetingSub"></p>
        </div>
        <button class="primary-button" id="newVoBtn">+ New Variation Order</button>
    </section>

    <section class="stats" id="statCards"></section>

    <section class="dashboard-grid">
        <div class="card recent-card">
            <div class="card-header">
                <div>
                    <h3>Recent Variation Orders</h3>
                    <p>Click a row to open it</p>
                </div>
                <button class="view-button" onclick="location.href='register.html'">
                    View register →
                </button>
            </div>
            <div class="table-scroll">
                <table>
                    <thead>
                        <tr>
                            <th>VO REF</th><th>DESCRIPTION</th><th>DATE ISSUED</th>
                            <th>VALUE</th><th>STATUS</th>
                        </tr>
                    </thead>
                    <tbody id="recentBody"></tbody>
                </table>
            </div>
        </div>

        <div class="card ai-card">
            <div class="ai-header">
                <div class="ai-logo">✦</div>
                <div>
                    <h3>Needs your attention</h3>
                    <p>Based on your role in this project</p>
                </div>
            </div>
            <div id="actionList"></div>
        </div>
    </section>

    <div class="disclaimer">
        <strong>⚠ Professional Review Required</strong>
        <span>
            AI-generated results are decision-support outputs. Final variation assessment,
            certification and approval must be reviewed by the appropriate construction professional.
        </span>
    </div>
```

Set the mountChrome call to:
`<script>mountChrome("dashboard", "Dashboard", "VO-AI / Dashboard");</script>`

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/page-dashboard.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify in the browser**

Sign in as each of the three roles in turn and confirm: the "Needs your attention" list
differs per role; "+ New Variation Order" only appears for the contractor; clicking a row
navigates to `vo.html` (404 until Task 10 — expected); the four stat cards read
3 / 1 / 1 and a non-zero ringgit total.

- [ ] **Step 7: Commit**

```bash
git add dashboard.html js/page-dashboard.js test/page-dashboard.test.js
git commit -m "feat: add role-aware dashboard with per-role action list"
```

---

### Task 9: The VO register (`register.html`, `js/page-register.js`)

The template's three role sheets, rendered as one table whose columns are marked owned or
read-only for the signed-in role.

**Files:**
- Create: `register.html`, `js/page-register.js`
- Test: `test/page-register.test.js`

**Interfaces:**
- Consumes: `canEdit`, `FIELD_OWNER` from `permissions`; `rm`, `prettyDate`,
  `contractorTotal`, `assessedTotal`, `voValue` from `calc`; `statusPill`, `escapeHtml`
  from `ui`; `rateSummary` from `analysis`.
- Produces:
  - `COLUMNS: Array<{field, label, render(vo, project): string}>`
  - `columnsForRole(role): Array<column>` — every column, in template order
  - `renderRegisterHead(role): string` — adds a `owned-col` class to that role's columns
  - `renderRegisterBody(project, role): string`

- [ ] **Step 1: Write the failing test**

Create `test/page-register.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { columnsForRole, renderRegisterHead, renderRegisterBody } =
    require("../js/page-register.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];

test("every role sees every column — the client reads everything", () => {
    const contractorCols = columnsForRole("contractor").map(c => c.field);
    const clientCols = columnsForRole("client").map(c => c.field);
    assert.deepStrictEqual(contractorCols, clientCols);
    assert.ok(clientCols.includes("finalPrice"));
    assert.ok(clientCols.includes("measurement"));
});

test("the header marks only the signed-in role's own columns", () => {
    const head = renderRegisterHead("contractor");
    assert.match(head, /owned-col[^>]*>\s*DESCRIPTION/i);
    assert.ok(!/owned-col[^>]*>\s*FINAL PRICE/i.test(head),
        "final price belongs to the client, not the contractor");

    const clientHead = renderRegisterHead("client");
    assert.match(clientHead, /owned-col[^>]*>\s*FINAL PRICE/i);
});

test("the body renders one row per VO", () => {
    const body = renderRegisterBody(project, "consultant");
    assert.strictEqual((body.match(/<tr/g) || []).length, 3);
    assert.match(body, /VO-001/);
    assert.match(body, /VO-003/);
});

test("the register surfaces the rate cross-check result per VO", () => {
    const body = renderRegisterBody(project, "consultant");
    assert.match(body, /rate-flag different/);
});

test("an empty project renders an empty state, not a broken table", () => {
    const body = renderRegisterBody({ vos: [], bq: [] }, "client");
    assert.match(body, /empty-state/);
});

test("descriptions are escaped", () => {
    const body = renderRegisterBody({
        bq: [],
        vos: [{ id: "V", no: "VO-001", description: "<b>x</b>", dateIssued: "",
                measurement: [], evaluateStatus: "Draft", certifiedStatus: "Pending",
                timeImpact: 0, finalPrice: null }]
    }, "client");
    assert.ok(!body.includes("<b>x</b>"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/page-register.test.js`
Expected: FAIL — `Cannot find module '../js/page-register.js'`

- [ ] **Step 3: Write `js/page-register.js`**

Column order follows the `dashboard (CLIENT)` sheet of `template.xlsx`.

```js
/* VO-AI | page-register.js — the VO register, in the template's column order. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, voValue } = require("./calc.js");
    var { statusPill, escapeHtml } = require("./ui.js");
    var { FIELD_OWNER } = require("./permissions.js");
    var { rateSummary } = require("./analysis.js");
}

function rateFlags(vo, project) {
    const s = rateSummary(vo, (project && project.bq) || []);
    const bits = [];
    if (s.same) bits.push('<span class="rate-flag same">' + s.same + " same</span>");
    if (s.different) bits.push('<span class="rate-flag different">' + s.different + " different</span>");
    if (s.star) bits.push('<span class="rate-flag star">' + s.star + " star</span>");
    return bits.join(" ") || "—";
}

const COLUMNS = [
    { field: "no",                label: "VO NO.",           render: v => "<strong>" + escapeHtml(v.no) + "</strong>" },
    { field: "description",       label: "DESCRIPTION",      render: v => escapeHtml(v.description || "—") },
    { field: "dateIssued",        label: "DATE ISSUED",      render: v => prettyDate(v.dateIssued) },
    { field: "dueDate",           label: "VO DUE DATE",      render: v => prettyDate(v.dueDate) },
    { field: "typeOfInstruction", label: "TYPE",             render: v => escapeHtml(v.typeOfInstruction || "—") },
    { field: "measurement",       label: "CONTRACTOR'S MEASUREMENT", render: v => rm(contractorTotal(v)) },
    { field: "assessment",        label: "CONSULTANT'S ASSESSMENT",  render: v => rm(assessedTotal(v)) },
    { field: "rateCheck",         label: "RATE CROSS-CHECK", render: (v, p) => rateFlags(v, p) },
    { field: "timeImpact",        label: "TIME IMPACT",      render: v => (Number(v.timeImpact) || 0) + " d" },
    { field: "evaluateStatus",    label: "EVALUATE STATUS",  render: v => statusPill(v.evaluateStatus) },
    { field: "certifiedStatus",   label: "CERTIFIED STATUS", render: v => statusPill(v.certifiedStatus) },
    { field: "finalPrice",        label: "FINAL PRICE",
      render: v => (v.finalPrice === null || v.finalPrice === "" ? "—" : rm(v.finalPrice)) }
];

/* Every role sees every column — the template only restricts *editing*. */
function columnsForRole(role) {
    return COLUMNS;
}

function renderRegisterHead(role) {
    return "<tr>" + COLUMNS.map(c => {
        const owned = FIELD_OWNER[c.field] === role;
        return "<th" + (owned ? ' class="owned-col"' : "") + ">" + c.label + "</th>";
    }).join("") + "</tr>";
}

function renderRegisterBody(project, role) {
    const vos = (project && project.vos) || [];
    if (vos.length === 0) {
        return '<tr><td colspan="' + COLUMNS.length + '" class="empty-state">' +
               "No variation orders in this project yet.</td></tr>";
    }
    return vos.map(v =>
        '<tr class="vo-row" data-vo="' + escapeHtml(v.id) + '" style="cursor:pointer">' +
        COLUMNS.map(c => {
            const owned = FIELD_OWNER[c.field] === role;
            return "<td" + (owned ? ' class="owned-col"' : "") + ">" +
                   c.render(v, project) + "</td>";
        }).join("") + "</tr>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { COLUMNS, columnsForRole, renderRegisterHead, renderRegisterBody };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", "VO Register", "VO-AI / VO Register");
        if (!ctx) return;
        const { session, project } = ctx;

        document.getElementById("registerHead").innerHTML = renderRegisterHead(session.role);
        document.getElementById("registerBody").innerHTML =
            renderRegisterBody(project, session.role);

        document.getElementById("ownedLegend").textContent =
            "Highlighted columns are the ones you may edit as " +
            (session.role === "contractor" ? "Contractor QS"
             : session.role === "consultant" ? "Consultant QS" : "Client");

        document.querySelectorAll(".vo-row").forEach(row => {
            row.addEventListener("click", () => {
                window.location.href = "vo.html?id=" + encodeURIComponent(row.dataset.vo);
            });
        });
    })();
}
```

- [ ] **Step 4: Add the owned-column style to `style.css`**

```css
th.owned-col { background: #fdf6dd; color: #92400e; }
td.owned-col { background: #fffdf2; }
.legend-bar {
    display: flex; align-items: center; gap: 9px;
    font-size: 10px; color: #92400e;
    background: #fffbeb; border: 1px solid #fef3c7;
    border-radius: 8px; padding: 10px 13px; margin-bottom: 16px;
}
.legend-swatch {
    width: 14px; height: 14px; border-radius: 3px;
    background: #fdf6dd; border: 1px solid #f0d98a;
}
```

- [ ] **Step 5: Write `register.html`**

Same shell as `dashboard.html`, with this `<main>` body:

```html
    <section class="welcome">
        <div>
            <h2>Variation Order Register</h2>
            <p>Every VO in this project. Click a row to open it.</p>
        </div>
    </section>

    <div class="legend-bar">
        <span class="legend-swatch"></span>
        <span id="ownedLegend"></span>
    </div>

    <div class="card">
        <div class="table-scroll">
            <table>
                <thead id="registerHead"></thead>
                <tbody id="registerBody"></tbody>
            </table>
        </div>
    </div>

    <div class="disclaimer">
        <strong>⚠ Professional Review Required</strong>
        <span>
            AI-generated results are decision-support outputs. Final variation assessment,
            certification and approval must be reviewed by the appropriate construction professional.
        </span>
    </div>
```

with `<script>mountChrome("register", "VO Register", "VO-AI / VO Register");</script>`
and `<script src="js/page-register.js"></script>`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/page-register.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 7: Verify in the browser**

Sign in as each role and confirm the highlighted columns move: contractor highlights
DESCRIPTION / DATE ISSUED / TYPE / CONTRACTOR'S MEASUREMENT; consultant highlights VO DUE
DATE / CONSULTANT'S ASSESSMENT / TIME IMPACT / EVALUATE STATUS; client highlights
CERTIFIED STATUS / FINAL PRICE. VO-001's rate cross-check cell shows all three flags.

- [ ] **Step 8: Commit**

```bash
git add register.html js/page-register.js test/page-register.test.js style.css
git commit -m "feat: add VO register with per-role owned column highlighting"
```

---

### Task 10: VO detail — the working screen (`vo.html`, `js/page-vo.js`)

The largest task. Three role panels on one page; each renders its own fields as inputs or
as locked read-only values with a reason.

**Files:**
- Create: `vo.html`, `js/page-vo.js`
- Test: `test/page-vo.test.js`

**Interfaces:**
- Consumes: everything from `calc`, `permissions`, `analysis`, `store`, `ui`.
- Produces:
  - `field(spec: {field, label, type, value, vo, role, options?, hint?}): string` — one
    labelled control, `owned` when editable and `locked` with a `.lock-note` when not
  - `renderMeasurementRows(vo, project, role): string`
  - `renderAssessmentPanel(vo, project, role): string`
  - `renderHistory(vo): string`

- [ ] **Step 1: Write the failing test**

Create `test/page-vo.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { field, renderMeasurementRows, renderHistory } = require("../js/page-vo.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];
const vo1 = project.vos[0];   /* approved + certified */
const vo3 = project.vos[2];   /* contractor draft */

test("a field the role owns and may edit renders as an editable input", () => {
    const html = field({ field: "description", label: "Description", type: "text",
                         value: "x", vo: vo3, role: "contractor" });
    assert.match(html, /class="field owned"/);
    assert.ok(!/disabled/.test(html));
    assert.ok(!/lock-note/.test(html));
});

test("a field owned by another role renders locked with a reason", () => {
    const html = field({ field: "finalPrice", label: "Final price", type: "number",
                         value: "", vo: vo1, role: "contractor" });
    assert.match(html, /class="field locked"/);
    assert.match(html, /disabled/);
    assert.match(html, /lock-note/);
    assert.match(html, /Client/);
});

test("a contractor field on an approved VO is locked with the right reason", () => {
    const html = field({ field: "description", label: "Description", type: "text",
                         value: "x", vo: vo1, role: "contractor" });
    assert.match(html, /class="field locked"/);
    assert.match(html, /already assessed/i);
});

test("select fields render their options and mark the current one", () => {
    const html = field({ field: "evaluateStatus", label: "Status", type: "select",
                         options: ["Pending", "Approved", "Rejected"],
                         value: "Approved", vo: vo1, role: "consultant" });
    assert.match(html, /<select/);
    assert.match(html, /<option value="Approved" selected/);
});

test("field values are escaped", () => {
    const html = field({ field: "description", label: "D", type: "text",
                         value: '"><script>x</script>', vo: vo3, role: "contractor" });
    assert.ok(!html.includes("<script>x</script>"));
});

test("each measurement row shows its rate cross-check verdict", () => {
    const html = renderMeasurementRows(vo1, project, "consultant");
    assert.match(html, /rate-flag same/);
    assert.match(html, /rate-flag star/);
    assert.match(html, /rate-flag different/);
    assert.match(html, /contract BQ rate governs/i);
});

test("the contractor cannot edit assessed columns", () => {
    const html = renderMeasurementRows(vo1, project, "contractor");
    const assessedInputs = html.match(/data-col="assessedRate"[^>]*/g) || [];
    assert.ok(assessedInputs.length > 0);
    assert.ok(assessedInputs.every(i => /disabled/.test(i)),
        "assessed rate inputs must be disabled for the contractor");
});

test("history renders every recorded action, newest last", () => {
    const html = renderHistory(vo1);
    assert.match(html, /VO created/);
    assert.match(html, /Certified/);
    assert.ok(html.indexOf("VO created") < html.indexOf("Certified"));
});

test("a VO with no history renders an empty state", () => {
    assert.match(renderHistory({ history: [] }), /empty-state/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/page-vo.test.js`
Expected: FAIL — `Cannot find module '../js/page-vo.js'`

- [ ] **Step 3: Write `js/page-vo.js`**

```js
/* VO-AI | page-vo.js — one variation order, three role panels. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, lineTotal } = require("./calc.js");
    var { canEdit, lockReason } = require("./permissions.js");
    var { checkRate, analyse } = require("./analysis.js");
    var { escapeHtml, statusPill } = require("./ui.js");
}

/* One labelled control. Editable => .owned (yellow). Locked => .locked + reason. */
function field(spec) {
    const editable = canEdit(spec.field, spec.vo, spec.role);
    const reason = editable ? "" : lockReason(spec.field, spec.vo, spec.role);
    const dis = editable ? "" : " disabled";
    const val = escapeHtml(spec.value === null || spec.value === undefined ? "" : spec.value);

    let control;
    if (spec.type === "select") {
        control = '<select data-field="' + spec.field + '"' + dis + ">" +
            (spec.options || []).map(o =>
                '<option value="' + escapeHtml(o) + '"' +
                (String(o) === String(spec.value) ? " selected" : "") + ">" +
                escapeHtml(o) + "</option>").join("") +
            "</select>";
    } else if (spec.type === "textarea") {
        control = '<textarea data-field="' + spec.field + '"' + dis + ">" + val + "</textarea>";
    } else {
        control = '<input type="' + (spec.type || "text") + '" data-field="' +
            spec.field + '" value="' + val + '"' + dis + ">";
    }

    return '<div class="field ' + (editable ? "owned" : "locked") + '">' +
        "<label>" + escapeHtml(spec.label) + "</label>" +
        control +
        (spec.hint ? '<span class="hint">' + escapeHtml(spec.hint) + "</span>" : "") +
        (reason ? '<span class="lock-note">🔒 ' + escapeHtml(reason) + "</span>" : "") +
    "</div>";
}

function bqOptions(project, selectedId) {
    const opts = ['<option value="">— no comparable BQ item (star rate) —</option>'];
    (project.bq || []).forEach(b => {
        opts.push('<option value="' + escapeHtml(b.id) + '"' +
            (b.id === selectedId ? " selected" : "") + ">" +
            escapeHtml(b.code + " · " + b.description + " · " + rm(b.rate) + "/" + b.unit) +
            "</option>");
    });
    return opts.join("");
}

function renderMeasurementRows(vo, project, role) {
    const rows = vo.measurement || [];
    if (rows.length === 0) {
        return '<tr><td colspan="8" class="empty-state">' +
               "No measurement entered yet.</td></tr>";
    }

    const conEdit = canEdit("measurement", vo, role);
    const conDis = conEdit ? "" : " disabled";
    const assEdit = canEdit("assessment", vo, role);
    const assDis = assEdit ? "" : " disabled";

    return rows.map((row, i) => {
        const check = checkRate(row, project.bq || []);
        const claimed = lineTotal(row.qty, row.rate);

        return '<tr data-row="' + i + '">' +
            '<td><input data-col="description" value="' + escapeHtml(row.description) +
                '"' + conDis + (conEdit ? ' class="owned"' : "") + ' style="width:220px"></td>' +
            '<td><select data-col="bqItemId"' + conDis + (conEdit ? ' class="owned"' : "") +
                ">" + bqOptions(project, row.bqItemId) + "</select></td>" +
            '<td><input data-col="unit" value="' + escapeHtml(row.unit) + '"' + conDis +
                (conEdit ? ' class="owned"' : "") + ' style="width:60px"></td>' +
            '<td><input type="number" data-col="qty" value="' + escapeHtml(row.qty) + '"' +
                conDis + (conEdit ? ' class="owned"' : "") + ' style="width:80px"></td>' +
            '<td><input type="number" data-col="rate" value="' + escapeHtml(row.rate) + '"' +
                conDis + (conEdit ? ' class="owned"' : "") + ' style="width:90px"></td>' +
            "<td><strong>" + rm(claimed) + "</strong></td>" +
            '<td><input type="number" data-col="assessedQty" value="' +
                escapeHtml(row.assessedQty) + '"' + assDis +
                (assEdit ? ' class="owned"' : "") + ' style="width:80px">' +
             '<input type="number" data-col="assessedRate" value="' +
                escapeHtml(row.assessedRate) + '"' + assDis +
                (assEdit ? ' class="owned"' : "") + ' style="width:90px;margin-top:5px"></td>' +
            '<td><span class="rate-flag ' + check.state + '">' + check.label + "</span>" +
                '<div class="rate-detail">' + escapeHtml(check.detail) + "</div></td>" +
        "</tr>";
    }).join("");
}

function renderAssessmentPanel(vo, project, role) {
    const a = analyse(vo, project);

    const clauseBlock = a.clause
        ? '<div class="result-row"><span class="result-label">Governing clause</span>' +
          '<span class="result-value">' + escapeHtml(a.clause.form + " " + a.clause.ref) +
          "</span></div>" +
          '<p class="rate-detail"><strong>' + escapeHtml(a.clause.title) + "</strong><br>" +
          escapeHtml(a.clause.entitlement) + "</p>" +
          '<p class="rate-detail"><strong>Evidence required:</strong> ' +
          escapeHtml(a.clause.evidence) + "</p>"
        : '<p class="rate-detail">No governing clause identified — the description is ' +
          "too vague to classify. Add detail and re-open this VO.</p>";

    return '' +
        '<div class="result-row"><span class="result-label">Classification</span>' +
            '<span class="result-value">' + escapeHtml(a.classification.label) + "</span></div>" +
        '<div class="result-row"><span class="result-label">Affected work</span>' +
            '<span class="result-value">' + escapeHtml(a.classification.affectedWork) + "</span></div>" +
        clauseBlock +
        '<div class="result-row"><span class="result-label">Contractor claimed</span>' +
            '<span class="result-value">' + rm(a.contractorTotal) + "</span></div>" +
        '<div class="result-row"><span class="result-label">Consultant assessed</span>' +
            '<span class="result-value">' + rm(a.assessedTotal) + "</span></div>" +
        '<div class="result-row"><span class="result-label">Variance</span>' +
            '<span class="result-value">' + rm(a.variance) + "</span></div>" +
        "<h4 style=\"font-size:12px;margin:18px 0 10px\">Findings</h4>" +
        (a.findings.length === 0
            ? '<div class="empty-state">Nothing to flag.</div>'
            : a.findings.map(f => '<div class="finding"><span>' + escapeHtml(f) +
                                  "</span></div>").join(""));
}

function renderHistory(vo) {
    const h = vo.history || [];
    if (h.length === 0) return '<div class="empty-state">No activity recorded.</div>';
    return h.map(e =>
        '<div class="finding"><span><strong>' + escapeHtml(e.by) + "</strong> — " +
        escapeHtml(e.action) + "<br><small style=\"color:#8992a3\">" +
        prettyDate(e.at) + "</small></span></div>"
    ).join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { field, renderMeasurementRows, renderAssessmentPanel, renderHistory };
}
```

- [ ] **Step 4: Add the browser wiring to the same file**

Append to `js/page-vo.js`:

```js
if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("register", "Variation Order", "VO-AI / VO Register / Detail");
        if (!ctx) return;
        const { session, project } = ctx;
        const role = session.role;

        const voId = new URLSearchParams(location.search).get("id");
        const vo = (project.vos || []).find(v => v.id === voId);
        if (!vo) { toast("That variation order no longer exists.", "error");
                   setTimeout(() => location.href = "register.html", 1200); return; }

        function draw() {
            const fresh = getProject(project.id);
            const v = fresh.vos.find(x => x.id === voId);

            document.getElementById("voTitle").textContent =
                v.no + " — " + (v.description || "Untitled variation");
            document.getElementById("voStatus").innerHTML =
                statusPill(v.evaluateStatus) + " " + statusPill(v.certifiedStatus);

            document.getElementById("contractorPanel").innerHTML =
                field({ field: "description", label: "Description of the change",
                        type: "textarea", value: v.description, vo: v, role: role }) +
                field({ field: "dateIssued", label: "Date VO issued", type: "date",
                        value: v.dateIssued, vo: v, role: role }) +
                field({ field: "typeOfInstruction", label: "Type of instruction",
                        type: "select",
                        options: ["Architect's Instruction (AI)", "Engineer's instruction (EI)"],
                        value: v.typeOfInstruction, vo: v, role: role }) +
                field({ field: "instructionNo", label: "Instruction no.", type: "text",
                        value: v.instructionNo, vo: v, role: role }) +
                field({ field: "contractorRemark", label: "Contractor's remark",
                        type: "textarea", value: v.contractorRemark, vo: v, role: role });

            document.getElementById("consultantPanel").innerHTML =
                field({ field: "dueDate", label: "VO due date", type: "date",
                        value: v.dueDate, vo: v, role: role }) +
                field({ field: "assessmentNote", label: "Consultant's assessment",
                        type: "textarea", value: v.assessmentNote, vo: v, role: role }) +
                field({ field: "timeImpact", label: "Time impact (days)", type: "number",
                        value: v.timeImpact, vo: v, role: role }) +
                field({ field: "evaluateStatus", label: "Evaluate status", type: "select",
                        options: ["Pending", "Under Review", "Approved", "Rejected"],
                        value: v.evaluateStatus, vo: v, role: role }) +
                field({ field: "consultantRemark", label: "Consultant's remark",
                        type: "textarea", value: v.consultantRemark, vo: v, role: role });

            document.getElementById("clientPanel").innerHTML =
                field({ field: "certifiedStatus", label: "Certified status", type: "select",
                        options: ["Pending", "Approved", "Rejected"],
                        value: v.certifiedStatus, vo: v, role: role }) +
                field({ field: "finalPrice", label: "Final certified price (RM)",
                        type: "number", value: v.finalPrice, vo: v, role: role,
                        hint: "Leave blank to certify at the consultant's assessed value." }) +
                field({ field: "clientRemark", label: "Client's remark", type: "textarea",
                        value: v.clientRemark, vo: v, role: role });

            document.getElementById("measurementBody").innerHTML =
                renderMeasurementRows(v, fresh, role);
            document.getElementById("assessmentPanel").innerHTML =
                renderAssessmentPanel(v, fresh, role);
            document.getElementById("historyPanel").innerHTML = renderHistory(v);

            document.getElementById("addRowBtn").style.display =
                canEdit("measurement", v, role) ? "" : "none";
            document.getElementById("submitBtn").style.display =
                (role === "contractor" && !v.submitted) ? "" : "none";
        }

        /* Persist any panel field on change. */
        document.querySelectorAll(".role-panel").forEach(panel => {
            panel.addEventListener("change", e => {
                const el = e.target.closest("[data-field]");
                if (!el || el.disabled) return;
                const name = el.dataset.field;
                updateVO(project.id, voId, v => {
                    v[name] = el.type === "number"
                        ? (el.value === "" ? (name === "finalPrice" ? null : 0) : Number(el.value))
                        : el.value;
                    logHistory(v, session, "Updated " + name);
                });
                toast("Saved.");
                draw();
            });
        });

        /* Measurement grid. */
        document.getElementById("measurementBody").addEventListener("change", e => {
            const el = e.target.closest("[data-col]");
            if (!el || el.disabled) return;
            const i = Number(el.closest("tr").dataset.row);
            const col = el.dataset.col;
            updateVO(project.id, voId, v => {
                const row = v.measurement[i];
                if (col === "qty" || col === "rate") row[col] = Number(el.value) || 0;
                else if (col === "assessedQty" || col === "assessedRate")
                    row[col] = el.value === "" ? "" : Number(el.value);
                else if (col === "bqItemId") row[col] = el.value || null;
                else row[col] = el.value;
            });
            toast("Measurement updated.");
            draw();
        });

        document.getElementById("addRowBtn").addEventListener("click", () => {
            updateVO(project.id, voId, v => {
                v.measurement.push({ id: uid("M"), bqItemId: null, description: "",
                    unit: "", qty: 0, rate: 0, assessedQty: "", assessedRate: "" });
            });
            draw();
        });

        document.getElementById("submitBtn").addEventListener("click", () => {
            updateVO(project.id, voId, v => {
                v.submitted = true;
                v.evaluateStatus = "Pending";
                logHistory(v, session, "Submitted to consultant");
            });
            toast("Submitted to the consultant.");
            draw();
        });

        document.getElementById("reportBtn").addEventListener("click", () => {
            location.href = "report.html?id=" + encodeURIComponent(voId);
        });

        draw();
    })();
}
```

- [ ] **Step 5: Write `vo.html`**

Same shell, with this `<main>` body and `<script src="js/page-vo.js"></script>` last:

```html
    <section class="welcome">
        <div>
            <h2 id="voTitle"></h2>
            <p id="voStatus"></p>
        </div>
        <div class="page-actions" style="margin:0">
            <button class="secondary-button" id="reportBtn">Generate VO report</button>
            <button class="primary-button" id="submitBtn">Submit to consultant</button>
        </div>
    </section>

    <div class="card" style="margin-bottom:20px">
        <div class="card-header">
            <div>
                <h3>Measurement and rate cross-check</h3>
                <p>Each rate is compared against the priced contract BQ</p>
            </div>
            <button class="secondary-button" id="addRowBtn">+ Add row</button>
        </div>
        <div class="table-scroll">
            <table>
                <thead>
                    <tr>
                        <th>DESCRIPTION</th><th>CONTRACT BQ ITEM</th><th>UNIT</th>
                        <th>QTY</th><th>RATE</th><th>CLAIMED</th>
                        <th>ASSESSED QTY / RATE</th><th>RATE CHECK</th>
                    </tr>
                </thead>
                <tbody id="measurementBody"></tbody>
            </table>
        </div>
    </div>

    <section class="dashboard-grid" style="margin-bottom:20px">
        <div class="card">
            <div class="card-header"><div><h3>VO-AI assessment</h3>
                <p>Derived from the contract BQ and the measurement above</p></div></div>
            <div class="card-body" id="assessmentPanel"></div>
        </div>
        <div class="card">
            <div class="card-header"><div><h3>Activity</h3><p>Who changed what</p></div></div>
            <div class="card-body" id="historyPanel"></div>
        </div>
    </section>

    <section class="dashboard-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="card role-panel">
            <div class="card-header"><div><h3>▲ Contractor</h3>
                <p>Contractor QS columns</p></div></div>
            <div class="card-body" id="contractorPanel"></div>
        </div>
        <div class="card role-panel">
            <div class="card-header"><div><h3>✦ Consultant</h3>
                <p>Consultant QS columns</p></div></div>
            <div class="card-body" id="consultantPanel"></div>
        </div>
        <div class="card role-panel">
            <div class="card-header"><div><h3>◉ Client</h3>
                <p>Client columns</p></div></div>
            <div class="card-body" id="clientPanel"></div>
        </div>
    </section>

    <div class="disclaimer">
        <strong>⚠ Professional Review Required</strong>
        <span>
            AI-generated results are decision-support outputs. Final variation assessment,
            certification and approval must be reviewed by the appropriate construction professional.
        </span>
    </div>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/page-vo.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 7: Walk the full workflow in the browser**

1. Sign in as **Contractor QS** → open VO-003 → its fields are yellow and editable; the
   consultant and client panels are grey with lock notes. Add a measurement row, then
   click "Submit to consultant". Status becomes Pending.
2. Sign in as **Consultant QS** → open VO-002 → assessed qty/rate columns are now editable.
   Change M4's assessed rate to 48 and watch the rate-check cell change from "different"
   to "same". Set Evaluate status to Approved.
3. Sign in as **Client** → open VO-002 → certified status and final price are now editable.
   Certify it.
4. Confirm no `alert()` fires anywhere and the console stays clean.

- [ ] **Step 8: Commit**

```bash
git add vo.html js/page-vo.js test/page-vo.test.js
git commit -m "feat: add VO detail screen with role panels and live rate cross-check"
```

---

### Task 11: Printable VO report (`report.html`, `js/page-report.js`)

Stage 5 of the template flow.

**Files:**
- Create: `report.html`, `js/page-report.js`
- Test: `test/page-report.test.js`

**Interfaces:**
- Consumes: `analyse` from `analysis`; `rm`, `prettyDate`, `contractorTotal`,
  `assessedTotal`, `voValue` from `calc`; `escapeHtml` from `ui`.
- Produces: `renderReport(vo, project): string` — the complete report body

- [ ] **Step 1: Write the failing test**

Create `test/page-report.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { renderReport } = require("../js/page-report.js");
const { seedDB } = require("../js/store.js");

const project = seedDB().projects[0];
const vo1 = project.vos[0];

test("the report names the project and contract, per the template rule", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /Cadangan Pembangunan ABC Residence/);
    assert.match(html, /ABC\/2026\/014/);
});

test("the report carries the VO identity and instruction reference", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /VO-001/);
    assert.match(html, /AI-021/);
});

test("the report itemises every measurement row with its rate verdict", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /Omit ceramic floor tiles/);
    assert.match(html, /contract BQ rate governs/i);
    assert.strictEqual((html.match(/rate-flag/g) || []).length, 3);
});

test("the report states the governing contract clause", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /PAM 2018/);
    assert.match(html, /Clause 11\.1/);
});

test("the report shows claimed, assessed and certified values", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /RM 62,808\.00/);   /* contractor claimed */
    assert.match(html, /RM 55,856\.00/);   /* certified final price */
});

test("the report lists supporting documents", () => {
    const html = renderReport(vo1, project);
    assert.match(html, /Marble supplier quotation\.pdf/);
    assert.match(html, /A-201 Rev C/);
});

test("the report always carries the professional review disclaimer", () => {
    assert.match(renderReport(vo1, project), /Professional Review Required/);
});

test("a report for an empty VO renders without throwing", () => {
    const html = renderReport({
        no: "VO-009", description: "", dateIssued: "", instructionNo: "",
        typeOfInstruction: "", measurement: [], revisedDrawing: [], oldDrawing: [],
        supportingDocs: [], history: [], evaluateStatus: "Draft",
        certifiedStatus: "Pending", finalPrice: null, timeImpact: 0
    }, project);
    assert.match(html, /VO-009/);
});
```

Note: the two ringgit assertions must match the seed data. Contractor claimed for VO-001
is `(-320 × 85) + (320 × 265) + (168 × 31) = -27,200 + 84,800 + 5,208 = 62,808`.
The consultant's assessed total is `(-320 × 85) + (320 × 248) + (168 × 22) = 55,856`, and
the client certified at that assessed value, so the seeded `finalPrice` is `55856`.
If Task 5's seed changes, update the seed and these assertions together.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/page-report.test.js`
Expected: FAIL — `Cannot find module '../js/page-report.js'`

- [ ] **Step 3: Write `js/page-report.js`**

```js
/* VO-AI | page-report.js — Stage 5: the draft VO report. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { rm, prettyDate, contractorTotal, assessedTotal, voValue } = require("./calc.js");
    var { analyse, checkRate } = require("./analysis.js");
    var { escapeHtml } = require("./ui.js");
}

function docList(files, label) {
    if (!files || files.length === 0) {
        return "<p class=\"rate-detail\"><strong>" + label + ":</strong> none attached</p>";
    }
    return "<p class=\"rate-detail\"><strong>" + label + ":</strong> " +
        files.map(f => escapeHtml(f.name)).join(", ") + "</p>";
}

function renderReport(vo, project) {
    const a = analyse(vo, project);

    const rows = (vo.measurement || []).map((row, i) => {
        const check = checkRate(row, project.bq || []);
        const assessedQty = row.assessedQty === "" || row.assessedQty == null ? row.qty : row.assessedQty;
        const assessedRate = row.assessedRate === "" || row.assessedRate == null ? row.rate : row.assessedRate;
        return "<tr>" +
            "<td>" + (i + 1) + "</td>" +
            "<td>" + escapeHtml(row.description || "—") + "</td>" +
            "<td>" + escapeHtml(row.unit || "") + "</td>" +
            "<td>" + escapeHtml(row.qty) + "</td>" +
            "<td>" + rm(row.rate) + "</td>" +
            "<td>" + rm((Number(row.qty) || 0) * (Number(row.rate) || 0)) + "</td>" +
            "<td>" + rm((Number(assessedQty) || 0) * (Number(assessedRate) || 0)) + "</td>" +
            '<td><span class="rate-flag ' + check.state + '">' + check.label + "</span>" +
                '<div class="rate-detail">' + escapeHtml(check.detail) + "</div></td>" +
        "</tr>";
    }).join("") || '<tr><td colspan="8" class="empty-state">No measurement entered.</td></tr>';

    const clauseBlock = a.clause
        ? "<p><strong>" + escapeHtml(a.clause.form + " " + a.clause.ref + " — " +
            a.clause.title) + "</strong></p><p class=\"rate-detail\">" +
            escapeHtml(a.clause.entitlement) + "</p><p class=\"rate-detail\">" +
            "<strong>Evidence required:</strong> " + escapeHtml(a.clause.evidence) + "</p>"
        : "<p class=\"rate-detail\">No governing clause identified from the description.</p>";

    return '' +
    '<div class="report-sheet">' +

      '<div class="report-head">' +
        "<div><h1>Draft Variation Order</h1>" +
        "<p>" + escapeHtml(project.name) + "</p>" +
        "<p>Contract " + escapeHtml(project.contractNo || "—") +
            " · Client " + escapeHtml(project.client || "—") + "</p></div>" +
        '<div class="report-ref"><strong>' + escapeHtml(vo.no) + "</strong>" +
        "<span>Issued " + prettyDate(vo.dateIssued) + "</span></div>" +
      "</div>" +

      "<h3>1. Instruction</h3>" +
      "<p>" + escapeHtml(vo.description || "—") + "</p>" +
      '<p class="rate-detail">' + escapeHtml(vo.typeOfInstruction || "—") +
        " · Reference " + escapeHtml(vo.instructionNo || "—") +
        " · Due " + prettyDate(vo.dueDate) + "</p>" +

      "<h3>2. Classification</h3>" +
      "<p>" + escapeHtml(a.classification.label) +
        " affecting <strong>" + escapeHtml(a.classification.affectedWork) + "</strong></p>" +

      "<h3>3. Contractual basis</h3>" + clauseBlock +

      "<h3>4. Measurement and valuation</h3>" +
      '<div class="table-scroll"><table><thead><tr>' +
        "<th>#</th><th>DESCRIPTION</th><th>UNIT</th><th>QTY</th><th>RATE</th>" +
        "<th>CLAIMED</th><th>ASSESSED</th><th>RATE CROSS-CHECK</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +

      '<div class="report-totals">' +
        "<div><small>Contractor claimed</small><strong>" + rm(a.contractorTotal) + "</strong></div>" +
        "<div><small>Consultant assessed</small><strong>" + rm(a.assessedTotal) + "</strong></div>" +
        "<div><small>Variance</small><strong>" + rm(a.variance) + "</strong></div>" +
        "<div><small>Certified value</small><strong>" + rm(voValue(vo)) + "</strong></div>" +
      "</div>" +

      "<h3>5. Findings</h3>" +
      (a.findings.length === 0 ? "<p>Nothing flagged.</p>"
        : a.findings.map(f => '<div class="finding"><span>' + escapeHtml(f) +
                              "</span></div>").join("")) +

      "<h3>6. Time impact</h3>" +
      "<p>" + (Number(vo.timeImpact) || 0) + " day(s) claimed extension of time.</p>" +

      "<h3>7. Supporting documents</h3>" +
      docList(vo.revisedDrawing, "Revised drawings") +
      docList(vo.oldDrawing, "Superseded drawings") +
      docList(vo.supportingDocs, "Supporting documents") +

      "<h3>8. Status</h3>" +
      "<p>Consultant evaluation: <strong>" + escapeHtml(vo.evaluateStatus) + "</strong><br>" +
      "Client certification: <strong>" + escapeHtml(vo.certifiedStatus) + "</strong></p>" +
      (vo.assessmentNote ? '<p class="rate-detail"><strong>Consultant\'s assessment:</strong> ' +
        escapeHtml(vo.assessmentNote) + "</p>" : "") +

      '<div class="signatures">' +
        "<div><span></span><small>Contractor QS</small></div>" +
        "<div><span></span><small>Consultant QS</small></div>" +
        "<div><span></span><small>Client / Developer</small></div>" +
      "</div>" +

      '<div class="disclaimer"><strong>⚠ Professional Review Required</strong>' +
      "<span>This draft is a decision-support output generated by VO-AI from the data " +
      "entered above. It is not a certificate. The responsible construction professional " +
      "must verify every figure before issue.</span></div>" +

    "</div>";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderReport };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("report", "VO Report", "VO-AI / VO Reports");
        if (!ctx) return;
        const { project } = ctx;

        const voId = new URLSearchParams(location.search).get("id");
        const host = document.getElementById("reportHost");
        const picker = document.getElementById("voPicker");

        picker.innerHTML = (project.vos || []).map(v =>
            '<option value="' + escapeHtml(v.id) + '"' + (v.id === voId ? " selected" : "") +
            ">" + escapeHtml(v.no + " — " + (v.description || "Untitled")) + "</option>"
        ).join("");

        function show(id) {
            const vo = (project.vos || []).find(v => v.id === id) || project.vos[0];
            if (!vo) { host.innerHTML = '<div class="empty-state">No VOs to report on.</div>'; return; }
            host.innerHTML = renderReport(vo, project);
        }

        picker.addEventListener("change", () => show(picker.value));
        document.getElementById("printBtn").addEventListener("click", () => window.print());
        show(voId || (project.vos[0] || {}).id);
    })();
}
```

- [ ] **Step 4: Add report styles to `style.css`**

```css
.report-sheet {
    background: white; border: 1px solid #e8ebf0; border-radius: 12px;
    padding: 38px; font-size: 12px; line-height: 1.7;
}
.report-sheet h1 { font-size: 22px; margin-bottom: 8px; }
.report-sheet h3 {
    font-size: 13px; margin: 26px 0 9px;
    padding-bottom: 6px; border-bottom: 2px solid #2563eb;
}
.report-head {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 20px; border-bottom: 2px solid #111827; margin-bottom: 10px;
}
.report-head p { font-size: 11px; color: #687386; }
.report-ref { text-align: right; }
.report-ref strong { display: block; font-size: 20px; color: #2563eb; }
.report-ref span { font-size: 10px; color: #8992a3; }
.report-totals {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
    margin-top: 18px; padding: 16px; background: #f8fafc; border-radius: 9px;
}
.report-totals small { display: block; font-size: 9px; color: #8992a3; margin-bottom: 4px; }
.report-totals strong { font-size: 15px; }
.signatures {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px; margin-top: 45px;
}
.signatures span {
    display: block; border-bottom: 1px solid #172033; height: 46px; margin-bottom: 7px;
}
.signatures small { font-size: 10px; color: #687386; }

@media print {
    .report-sheet { border: none; padding: 0; }
    .report-totals { background: none; border: 1px solid #ccc; }
}
```

- [ ] **Step 5: Write `report.html`**

Same shell, `<main>` body:

```html
    <section class="welcome">
        <div>
            <h2>VO Report</h2>
            <p>Stage 5 — a draft report assembled from the register.</p>
        </div>
        <div class="page-actions" style="margin:0">
            <select id="voPicker" style="padding:11px;border-radius:8px;border:1px solid #dfe3e8"></select>
            <button class="primary-button" id="printBtn">Print / Save as PDF</button>
        </div>
    </section>

    <div id="reportHost"></div>
```

with `<script>mountChrome("report", "VO Reports", "VO-AI / VO Reports");</script>`
and `<script src="js/page-report.js"></script>`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/page-report.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 7: Verify in the browser**

Open the report for VO-001. Confirm all three rate verdicts appear, the clause block names
PAM 2018 Clause 11.1, and the totals row reads 62,808.00 claimed / 55,856.00 certified.
Press "Print / Save as PDF" and confirm the sidebar and buttons are hidden in the preview
and the sheet fits the page.

- [ ] **Step 8: Commit**

```bash
git add report.html js/page-report.js test/page-report.test.js style.css
git commit -m "feat: add printable draft VO report"
```

---

### Task 12: Retire the mockup, final QA and deploy

**Files:**
- Modify: `variation.html` (replace with a redirect)
- Delete: `script.js`
- Create: `README.md`

- [ ] **Step 1: Replace `variation.html` with a redirect**

The standalone calculator is superseded by `vo.html`. Keep the filename so any link the
team has already shared still lands somewhere sensible.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>VO-AI</title>
    <meta http-equiv="refresh" content="0; url=register.html">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="empty-state">
        This page has moved into the VO register.
        <a href="register.html">Continue →</a>
    </div>
</body>
</html>
```

- [ ] **Step 2: Delete the superseded script**

```bash
git rm script.js
```

Then confirm nothing references it:

Run: `grep -rn "script.js" --include=*.html .`
Expected: no matches (the pages load `js/*.js` instead).

- [ ] **Step 3: Run the whole suite**

Run: `node --test test/`
Expected: PASS. All files green, no skipped tests.

- [ ] **Step 4: Walk the five stages end to end, in one sitting**

With `python -m http.server 8080` running, in a **private window** (so localStorage starts
empty):

1. `http://localhost:8080/` → sign in as Consultant QS.
2. Projects → open ABC Residence.
3. Dashboard → confirm stats and the action list.
4. Register → confirm the consultant's columns are highlighted.
5. Open VO-002 → assess it, approve it.
6. Switch role to Client → certify VO-002.
7. Reports → print VO-002.
8. Switch to Contractor QS → raise a new VO, add measurement, submit.

Check the DevTools console after every step. Any error is a bug — fix it before deploying.

- [ ] **Step 5: Write `README.md`**

```markdown
# VO-AI — Variation Order Intelligence

A decision-support prototype for construction Variation Order management, built for the
"海之子"杯 AI智能体挑战计划 by Team GUD GUD.

**Live demo:** https://serenawong34-rgb.github.io/Project/

## Running locally

No build step and no dependencies. Serve the folder over HTTP:

```bash
python -m http.server 8080
```

Then open http://localhost:8080/. Opening `index.html` directly from the filesystem also
works, but serving it over HTTP matches the deployed behaviour.

## Signing in

There are no passwords — pick a name and a role:

| Role | What it can do |
|---|---|
| Contractor QS | Raise a VO, enter measurement, submit it |
| Consultant QS | Create projects, upload the BQ, cross-check rates, approve |
| Client / Developer | Certify the final price and track every VO |

"Restore demo data" on the Projects page resets everything to the seeded scenario.

## Tests

```bash
node --test test/
```

## How it works

All state lives in your browser's `localStorage` under `voai.db.v1` — nothing is sent
anywhere. The analysis engine (`js/analysis.js`) is deterministic and rule-based: it
classifies the change, looks the governing clause up in `js/clauses.js`, and cross-checks
every claimed rate against the priced contract BQ. There is no language model in this
build, and no figure shown in the UI is invented — see
`docs/superpowers/specs/2026-08-24-vo-ai-spec.md` §5.
```

- [ ] **Step 6: Deploy to GitHub Pages**

```bash
git add -A
git commit -m "chore: retire mockup calculator, add README"
git push origin main
```

Then in the GitHub repo: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)` → Save.**
Wait for the green tick on the Actions tab, then open
`https://serenawong34-rgb.github.io/Project/` in a private window and walk Stage 1 → 5 again.

- [ ] **Step 7: Capture screenshots for the proposal**

Proposal §3.2 needs "images/screenshots + text description". Capture, at 1440px wide:

1. The role picker (Stage 1)
2. The consultant's register with the highlighted columns and the legend (Stage 4)
3. VO-001's measurement table showing all three rate verdicts — this is the money shot
4. The printed VO-001 report

Save them to `docs/screenshots/`.

- [ ] **Step 8: Final commit**

```bash
git add docs/screenshots README.md
git commit -m "docs: add demo screenshots for the proposal"
git push
```

---

## Self-Review

**Spec coverage**

| Spec section | Covered by |
|---|---|
| §2 Five-stage flow | Task 6 (1), Task 7 (2,3), Tasks 8–10 (4), Task 11 (5) |
| §3 Data model | Task 5 `newVO`; Task 9 column order |
| §3 Privacy / yellow rule | Task 2 `canEdit`; Task 9 `owned-col`; Task 10 `field()` |
| §3 Gating rules | Task 2 tests; Task 10 workflow walk |
| §4 Rate cross-check | Task 4 `checkRate` — all three states tested |
| §5.1 Variation detection | Task 4 `classifyVariation` |
| §5.2 Clause analysis | Task 3 `clauses.js`, Task 4 `analyse` |
| §5.3 Cost estimation | Task 1 totals, Task 4 variance |
| §5.4 Time impact | Task 1 `projectStats.timeImpact`, Task 10 field |
| §5.5 Report generation | Task 11 |
| §5 Honesty rule | Task 4 test "never invents a confidence score"; Task 12 removes the mockup |
| §6 Constraints | Global Constraints; Task 12 deploy |
| §7 Demo scenario | Task 5 seed, tested for all three rate states |
| §9 Definition of done | Task 12 steps 3, 4, 6 |

**Not covered by this plan — separate work, flagged rather than silently dropped:**
- Proposal §2.2, §2.4, §2.5, §3.1, §3.2, §4.0 are still blank in `Proposal.docx`. They
  must be written *against the shipped app*, which is why they sit on 31 Aug in the
  schedule rather than being tasks here.
- The competition submission itself (whatever the portal requires beyond the proposal).

**Type consistency check:** `evaluateStatus`, `certifiedStatus`, `finalPrice`, `timeImpact`,
`submitted`, `measurement`, `bqItemId`, `assessedQty`, `assessedRate` are spelled
identically in Tasks 1, 2, 4, 5, 9, 10 and 11. `checkRate(row, bq)` takes the BQ **array**
in every call site (Tasks 4, 9, 10, 11) — not the project. `analyse(vo, project)` takes the
**project**. `rateSummary(vo, bq)` takes the array. `field({...})` is called only from
Task 10.

**Known coupling to watch:** Task 11's report test asserts `RM 62,808.00` and
`RM 55,856.00`, both derived from Task 5's seed data. If the seed changes, those two
assertions change with it.
