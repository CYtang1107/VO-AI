/* VO-AI | store.js
   Data model, seed data and localStorage persistence.
   One database key, one session key. No backend. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { today } = require("./calc.js");
}

const DB_KEY = "voai.db.v1";
const SESSION_KEY = "voai.session.v1";

/* `var`, not `const`: same parse-time-hoisting hazard as ROLES below —
   ui.js/page-login.js share this global scope in the browser.
   Session-storage (not localStorage) — a tab-session record of which
   projects have already had their passcode entered, so navigating
   between register/dashboard/analysis pages within an opened project
   never re-prompts. Cleared on sign-out so a fresh sign-in re-prompts. */
var UNLOCKED_PROJECTS_KEY = "voai.unlockedProjects.v1";

/* `var`, not `const`: js/ui.js re-declares this name in a parse-time-hoisted
   guarded `var` for its Node import. `const` here would be a SyntaxError in the
   browser, where both files share one global scope. */
var ROLES = {
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
        contractDocs: [],
        measurement: [],
        contractorRemark: "",
        submitted: false,

        /* consultant's columns */
        dueDate: "",
        assessmentNote: "",
        timeImpact: 0,
        evaluateStatus: "Draft",
        consultantRemark: "",
        infoRequestedAt: null,
        infoRequestNote: "",

        /* client's columns */
        certifiedStatus: "Pending",
        finalPrice: null,
        clientRemark: "",
        clientInfoRequestedAt: null,
        clientInfoRequestNote: "",

        history: []
    };
}

/* ---------- persistence ---------- */

/* A team-account session (js/cloud.js) keeps its own cache of the shared
   register under a separate key, so the offline demo's data and the
   team's real projects never mix. */
var CLOUD_DB_KEY = "voai.db.cloud.v1";

function cloudSession() {
    const s = getSession();
    return !!(s && s.cloud);
}

function loadDB() {
    if (typeof localStorage === "undefined") return seedDB();
    if (cloudSession()) {
        try { return JSON.parse(localStorage.getItem(CLOUD_DB_KEY)) || { projects: [] }; }
        catch (e) { return { projects: [] }; }
    }
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
        const fresh = demoDB(today());
        saveDB(fresh);
        return fresh;
    }
    try {
        return upgradeDemo(JSON.parse(raw));
    } catch (e) {
        const fresh = demoDB(today());
        saveDB(fresh);
        return fresh;
    }
}

/* A register saved before the demo project had its conditions of
   contract (D3) gets it added, so the contract-based analysis
   (js/contractread.js) works there too. Touches only the demo project. */
function upgradeDemo(db) {
    const demo = db && (db.projects || []).find(p => p.id === "PRJ-CADANGAN");
    if (demo && !(demo.documents || []).some(d => d.id === "D3")) {
        const d3 = seedDB().projects[0].documents.find(d => d.id === "D3");
        demo.documents = (demo.documents || []).concat([d3]);
        saveDB(db);
    }
    return db;
}

/* The demo data the browser starts from: seedDB(), with each seeded VO's
   dates moved so it is issued a set number of days before `todayIso`.
   seedDB() keeps fixed dates (the tests depend on them); without this
   shift, a first-time viewer opening the demo months later would see
   every contractual clock long overdue. VO-001 (fully certified) sits
   two months back and carries the project's own dates with it; VO-002
   (awaiting assessment) is three weeks in, inside its 30-day clock;
   VO-003 (contractor draft) was raised this week. */
var DEMO_ISSUED_DAYS_AGO = [60, 20, 5];

function shiftIsoDays(value, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
    if (!m) return value;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + days * 86400000);
    const pad = n => String(n).padStart(2, "0");
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + m[4];
}

function shiftDates(node, days) {
    if (typeof node === "string") return shiftIsoDays(node, days);
    if (Array.isArray(node)) return node.map(n => shiftDates(n, days));
    if (node && typeof node === "object") {
        const out = {};
        Object.keys(node).forEach(k => { out[k] = shiftDates(node[k], days); });
        return out;
    }
    return node;
}

function demoDB(todayIso) {
    const db = seedDB();
    const daysFrom = (fromIso, toIso) =>
        Math.round((Date.parse(toIso.slice(0, 10) + "T00:00:00Z") -
                    Date.parse(fromIso.slice(0, 10) + "T00:00:00Z")) / 86400000);
    db.projects = db.projects.map(project => {
        const vos = project.vos || [];
        if (vos.length === 0) return project;
        const offsetFor = i => {
            const ago = DEMO_ISSUED_DAYS_AGO[Math.min(i, DEMO_ISSUED_DAYS_AGO.length - 1)];
            return daysFrom(vos[i].dateIssued, shiftIsoDays(todayIso, -ago));
        };
        const shifted = shiftDates(Object.assign({}, project, { vos: [] }), offsetFor(0));
        shifted.vos = vos.map((vo, i) => shiftDates(vo, offsetFor(i)));
        return shifted;
    });
    return db;
}

function saveDB(db) {
    if (typeof localStorage === "undefined") return;
    if (cloudSession()) {
        localStorage.setItem(CLOUD_DB_KEY, JSON.stringify(db));
        if (typeof Cloud !== "undefined" && Cloud.schedulePush) Cloud.schedulePush();
        return;
    }
    localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function resetDB() {
    if (cloudSession()) return loadDB();
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
    clearUnlockedProjects();
}

/* ---------- per-tab project-passcode unlock state ----------
   Session-scoped only (sessionStorage, not the persisted DB/session):
   once a project's passcode has been entered correctly in this browser
   tab, further navigation within it does not re-prompt. Opening the
   project afresh from the Projects screen after signing out — or in a
   new tab — starts from locked again. */

function isProjectUnlocked(projectId) {
    if (typeof sessionStorage === "undefined") return false;
    try {
        const raw = sessionStorage.getItem(UNLOCKED_PROJECTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) && list.includes(projectId);
    } catch (e) {
        return false;
    }
}

function markProjectUnlocked(projectId) {
    if (typeof sessionStorage === "undefined") return;
    let list = [];
    try {
        const raw = sessionStorage.getItem(UNLOCKED_PROJECTS_KEY);
        list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) list = [];
    } catch (e) {
        list = [];
    }
    if (!list.includes(projectId)) list.push(projectId);
    sessionStorage.setItem(UNLOCKED_PROJECTS_KEY, JSON.stringify(list));
}

function clearUnlockedProjects() {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(UNLOCKED_PROJECTS_KEY);
}

/* ---------- project passcode ----------
   Optional, off by default, and set only by the Consultant QS who
   created the project. Hashed with Web Crypto SHA-256 plus a per-project
   random salt: only the salt and the hex digest are ever stored, never
   the plain passcode. This gates opening the project on THIS device and
   browser only — it does not encrypt the project data, which stays
   readable in this browser's localStorage regardless. See the honesty
   note next to the passcode control on the Projects screen. The hash +
   salt live directly on the project record (project.passcode), so they
   travel with export/import like any other project field. */

function getCrypto() {
    return (typeof globalThis !== "undefined" && globalThis.crypto) || null;
}

/* crypto.subtle needs a secure context (HTTPS or localhost). When it is
   missing we must not throw or silently accept any input — callers use
   this to skip the passcode feature entirely and say so. */
function passcodeSupported() {
    const c = getCrypto();
    return !!(c && c.subtle && typeof c.subtle.digest === "function");
}

function bufToHex(buf) {
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

function randomSalt() {
    const c = getCrypto();
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === "function") {
        c.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return bufToHex(bytes.buffer);
}

async function defaultDigest(text) {
    const c = getCrypto();
    const data = new TextEncoder().encode(text);
    return c.subtle.digest("SHA-256", data);
}

/* digestFn is injectable so tests can substitute a small digest without
   depending on Web Crypto's actual availability. */
async function digestHex(text, digestFn) {
    const fn = digestFn || defaultDigest;
    const buf = await fn(text);
    return bufToHex(buf);
}

function projectHasPasscode(project) {
    return !!(project && project.passcode);
}

/* Sets (or overwrites) the passcode on the project with this id.
   Returns false — never throws — when Web Crypto is unavailable and no
   test digestFn was injected, so callers can degrade to "no passcode,
   and say so" rather than accepting input that goes nowhere. */
async function setProjectPasscode(projectId, plain, digestFn) {
    if (!passcodeSupported() && !digestFn) return false;
    try {
        const salt = randomSalt();
        const hash = await digestHex(salt + ":" + plain, digestFn);
        const updated = updateProject(projectId, project => {
            project.passcode = { salt: salt, hash: hash };
        });
        return !!updated;
    } catch (e) {
        return false;
    }
}

async function verifyProjectPasscode(project, plain, digestFn) {
    if (!project || !project.passcode) return false;
    if (!passcodeSupported() && !digestFn) return false;
    try {
        const hash = await digestHex(project.passcode.salt + ":" + plain, digestFn);
        return hash === project.passcode.hash;
    } catch (e) {
        return false;
    }
}

function clearProjectPasscode(projectId) {
    updateProject(projectId, project => {
        project.passcode = null;
    });
}

/* ---------- device passcode (sign-in) ----------
   Optional, off by default. Locks VO-AI on THIS device only — a
   personal convenience, independent of any project's passcode above.
   Stored under its own localStorage key (never inside the project
   record, and never alongside session data), hashed with the same
   Web Crypto helpers used for the project passcode: only a per-install
   salt and the hex digest are ever stored, never the plain passcode.
   See the honesty note next to the passcode control on the sign-in
   page. */

/* `var`, not `const`: same parse-time-hoisting hazard as the other
   module-level keys above. */
var PASSCODE_KEY = "voai.passcode.v1";

function loadPasscodeRecord() {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(PASSCODE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function savePasscodeRecord(record) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PASSCODE_KEY, JSON.stringify(record));
}

function hasPasscode() {
    return !!loadPasscodeRecord();
}

async function setPasscode(plain, digestFn) {
    if (!passcodeSupported() && !digestFn) return false;
    try {
        const salt = randomSalt();
        const hash = await digestHex(salt + ":" + plain, digestFn);
        savePasscodeRecord({ salt: salt, hash: hash });
        return true;
    } catch (e) {
        return false;
    }
}

async function verifyPasscode(plain, digestFn) {
    const record = loadPasscodeRecord();
    if (!record) return false;
    if (!passcodeSupported() && !digestFn) return false;
    try {
        const hash = await digestHex(record.salt + ":" + plain, digestFn);
        return hash === record.hash;
    } catch (e) {
        return false;
    }
}

function clearPasscode() {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(PASSCODE_KEY);
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
        vos: [],
        passcode: null
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

/* The demo documents' sample files, served from demo-files/ beside the
   app (generated by tools/make-demo-files.js; every page is marked as a
   demo sample). Keyed by the seeded document id, so a register saved
   before these existed still finds them — see fileLink() in js/ui.js. */
var DEMO_FILES = {
    D1: "demo-files/contract-agreement-pam2018.pdf",
    D2: "demo-files/bills-of-quantities-priced.pdf",
    D3: "demo-files/conditions-of-contract-demo.pdf",
    F1: "demo-files/A-201-revC-floor-finishes.pdf",
    F2: "demo-files/A-201-revB-floor-finishes.pdf",
    F3: "demo-files/marble-supplier-quotation.pdf",
    F4: "demo-files/site-photo-living-area.jpg",
    F5: "demo-files/C-104-revA-external-drainage.pdf",
    F6: "demo-files/site-instruction-EI-008.pdf",
    /* each VO's contract basis: the project's own contract */
    F7: "demo-files/contract-agreement-pam2018.pdf",
    F8: "demo-files/contract-agreement-pam2018.pdf",
    /* site photos: photo-realistic AI images labelled as such on the
       image ("AI-GENERATED · DEMO ONLY"), each placed on the site map */
    P1: "demo-files/site-photo-skirting.jpg",
    P2: "demo-files/site-photo-marble-delivery.jpg",
    P3: "demo-files/site-photo-trench.jpg",
    P4: "demo-files/site-photo-drain-pipe.jpg",
    P5: "demo-files/site-photo-sump.jpg",
    P6: "demo-files/site-photo-ceiling-before.jpg",
    P7: "demo-files/site-photo-ceiling-cove.jpg",
};


/* The demo's own English text as it reads in Chinese. Shown in place of
   the stored text only while that text is still the demo's (see
   seedText in js/ui.js) — anything a user has typed is shown as typed.
   Measurement lines stay in English: they are matched against the
   English priced BQ. */
var SEED_ZH = {
    "Change of living area floor finish from ceramic tile to marble tile": "客厅地面饰面由瓷砖改为大理石",
    "Additional external drainage works to rear boundary": "后方边界加建室外排水工程",
    "Revision to master bedroom ceiling design": "修改主人房天花设计",
    "Marble supplied by nominated supplier. Lead time 4 weeks.": "大理石由指定供应商供货，交货期 4 周。",
    "Instructed under AI-021 and outside the original scope, so the change ranks as a variation. The omission is valued at the contract BQ rate. The marble rate has no comparable BQ item and has been agreed as a star rate against the supplier quotation. The skirting rate reverts to the contract BQ rate.":
        "依据建筑师指令 AI-021 发出，且超出原合同范围，因此构成变更。删减部分按合同工程量清单单价估价；大理石在清单中没有可比项目，已参照供应商报价单商定为新增单价；踢脚线单价按合同清单单价计算。",
    "Recommend approval at the assessed value.": "建议按评估金额批准。",
    "Certified for payment in interim certificate no. 8.": "已列入第 8 期中期付款证书核证付款。",
    "Works instructed on site by the C&S engineer on 15/07/2026.": "土木结构工程师于 2026年7月15日 在现场指示施工。"
};

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
            passcode: null,
            /* a made-up demo location (Cheras, Kuala Lumpur) for the site map */
            site: { lat: 3.0857, lng: 101.7425, address: "Demo site, Cheras, Kuala Lumpur" },
            bq: bq,
            documents: [
                { id: "D1", name: "Contract Agreement - PAM 2018.pdf", size: 81079, url: DEMO_FILES.D1, category: "contract", uploadedBy: "Serena Wong", role: "consultant", at: "2026-06-01T09:10:00Z" },
                { id: "D2", name: "Bills of Quantities (Priced).pdf", size: 80132, url: DEMO_FILES.D2, category: "bq", uploadedBy: "Serena Wong", role: "consultant", at: "2026-06-01T09:14:00Z" },
                { id: "D3", name: "Conditions of Contract (demo extract).pdf", size: 84703, url: DEMO_FILES.D3, category: "contract", uploadedBy: "Serena Wong", role: "consultant", at: "2026-06-01T09:12:00Z" }
            ],
            vos: [
                {
                    id: "VO-SEED-1",
                    no: "VO-001",
                    description: "Change of living area floor finish from ceramic tile to marble tile",
                    dateIssued: "2026-07-14",
                    typeOfInstruction: "Architect's Instruction (AI)",
                    instructionNo: "AI-021",
                    revisedDrawing: [{ id: "F1", name: "A-201 Rev C - Floor Finishes.pdf", size: 126837, url: DEMO_FILES.F1, uploadedBy: "Ong Wei Han", at: "2026-07-14" }],
                    oldDrawing: [{ id: "F2", name: "A-201 Rev B - Floor Finishes.pdf", size: 98363, url: DEMO_FILES.F2, uploadedBy: "Ong Wei Han", at: "2026-07-14" }],
                    supportingDocs: [
                        { id: "F3", name: "Marble supplier quotation.pdf", size: 81540, url: DEMO_FILES.F3, uploadedBy: "Ong Wei Han", at: "2026-07-15" },
                        { id: "F4", name: "Site photos - living area.jpg", size: 163003, url: DEMO_FILES.F4, uploadedBy: "Ong Wei Han", at: "2026-07-15",
                          geo: { lat: 3.08594, lng: 101.74271, acc: 8, src: "gps" } },
                        { id: "P1", name: "Site photo - existing skirting.jpg", size: 178624, url: DEMO_FILES.P1, uploadedBy: "Ong Wei Han", at: "2026-07-15", geo: { lat: 3.08597, lng: 101.74276, acc: 6, src: "gps" } },
                        { id: "P2", name: "Site photo - marble tiles delivered.jpg", size: 272972, url: DEMO_FILES.P2, uploadedBy: "Ong Wei Han", at: "2026-07-16", geo: { lat: 3.08562, lng: 101.74258, acc: 6, src: "gps" } }
                    ],
                    contractDocs: [{ id: "F7", name: "Contract Agreement - PAM 2018.pdf", size: 81079, url: DEMO_FILES.F7, uploadedBy: "Ong Wei Han", at: "2026-07-14" }],
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
                    infoRequestedAt: null,
                    infoRequestNote: "",
                    certifiedStatus: "Approved",
                    finalPrice: 55856,
                    clientRemark: "Certified for payment in interim certificate no. 8.",
                    clientInfoRequestedAt: null,
                    clientInfoRequestNote: "",
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
                    /* With these fixed dates (the tests' view) this VO is well over
                       EVALUATION_DAYS/INFO_REQUEST_DAYS old and still Pending, so the
                       tests exercise overdue clocks; the browser's demoDB() re-dates
                       it to sit inside its clocks instead. */
                    dateIssued: "2026-07-15",
                    typeOfInstruction: "Engineer's instruction (EI)",
                    instructionNo: "EI-008",
                    revisedDrawing: [{ id: "F5", name: "C-104 Rev A - External Drainage.pdf", size: 95122, url: DEMO_FILES.F5, uploadedBy: "Ong Wei Han", at: "2026-07-15" }],
                    oldDrawing: [],
                    supportingDocs: [
                        { id: "F6", name: "Site instruction EI-008.pdf", size: 77160, url: DEMO_FILES.F6, uploadedBy: "Ong Wei Han", at: "2026-07-15" },
                        /* along the rear boundary wall, left to right */
                        { id: "P3", name: "Site photo - trench along rear boundary.jpg", size: 343443, url: DEMO_FILES.P3, uploadedBy: "Ong Wei Han", at: "2026-09-16", geo: { lat: 3.08612, lng: 101.74226, acc: 6, src: "gps" } },
                        { id: "P4", name: "Site photo - uPVC pipe laid in trench.jpg", size: 391980, url: DEMO_FILES.P4, uploadedBy: "Ong Wei Han", at: "2026-09-18", geo: { lat: 3.08611, lng: 101.74252, acc: 6, src: "gps" } },
                        { id: "P5", name: "Site photo - precast sump at rear corner.jpg", size: 516295, url: DEMO_FILES.P5, uploadedBy: "Ong Wei Han", at: "2026-09-19", geo: { lat: 3.08609, lng: 101.74281, acc: 6, src: "gps" } }
                    ],
                    contractDocs: [{ id: "F8", name: "Contract Agreement - PAM 2018.pdf", size: 81079, url: DEMO_FILES.F8, uploadedBy: "Ong Wei Han", at: "2026-07-15" }],
                    measurement: [
                        { id: "M4", bqItemId: "BQ5", description: "100mm dia uPVC drainage pipe laid in trench to rear boundary",
                          unit: "m", qty: 142, rate: 62, assessedQty: "", assessedRate: "" },
                        { id: "M5", bqItemId: null, description: "Precast concrete sump 600x600mm with cover",
                          unit: "no", qty: 4, rate: 1250, assessedQty: "", assessedRate: "" }
                    ],
                    contractorRemark: "Works instructed on site by the C&S engineer on 15/07/2026.",
                    submitted: true,
                    dueDate: "2026-08-31",
                    assessmentNote: "",
                    timeImpact: 0,
                    evaluateStatus: "Pending",
                    consultantRemark: "",
                    infoRequestedAt: null,
                    infoRequestNote: "",
                    certifiedStatus: "Pending",
                    finalPrice: null,
                    clientRemark: "",
                    clientInfoRequestedAt: null,
                    clientInfoRequestNote: "",
                    history: [
                        { at: "2026-07-15T08:30:00Z", by: "Ong Wei Han", role: "contractor", action: "VO created" },
                        { at: "2026-07-16T14:02:00Z", by: "Ong Wei Han", role: "contractor", action: "Submitted to consultant" }
                    ]
                },
                {
                    id: "VO-SEED-3",
                    no: "VO-003",
                    description: "Revision to master bedroom ceiling design",
                    dateIssued: "2026-08-18",
                    typeOfInstruction: "Architect's Instruction (AI)",
                    instructionNo: "AI-027",
                    revisedDrawing: [], oldDrawing: [], contractDocs: [],
                    supportingDocs: [
                        { id: "P6", name: "Site photo - master bedroom ceiling before.jpg", size: 126362, url: DEMO_FILES.P6, uploadedBy: "Ong Wei Han", at: "2026-09-28", geo: { lat: 3.08583, lng: 101.74236, acc: 6, src: "gps" } },
                        { id: "P7", name: "Site photo - ceiling cove framing.jpg", size: 221839, url: DEMO_FILES.P7, uploadedBy: "Ong Wei Han", at: "2026-10-02", geo: { lat: 3.08585, lng: 101.74239, acc: 6, src: "gps" } }
                    ],
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
                    infoRequestedAt: null,
                    infoRequestNote: "",
                    certifiedStatus: "Pending",
                    finalPrice: null,
                    clientRemark: "",
                    clientInfoRequestedAt: null,
                    clientInfoRequestNote: "",
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
        DB_KEY, CLOUD_DB_KEY, cloudSession, SESSION_KEY, UNLOCKED_PROJECTS_KEY, PASSCODE_KEY, ROLES, uid, newVO,
        loadDB, saveDB, resetDB, demoDB, upgradeDemo, SEED_ZH, shiftIsoDays, DEMO_FILES,
        getSession, setSession, clearSession,
        isProjectUnlocked, markProjectUnlocked, clearUnlockedProjects,
        passcodeSupported,
        projectHasPasscode, setProjectPasscode, verifyProjectPasscode, clearProjectPasscode,
        hasPasscode, setPasscode, verifyPasscode, clearPasscode,
        createProject, getProject, updateProject,
        createVO, updateVO, logHistory, seedDB
    };
}
