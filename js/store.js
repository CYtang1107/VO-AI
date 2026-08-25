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
                    /* Issued well over EVALUATION_DAYS/INFO_REQUEST_DAYS ago and still
                       Pending — this VO exists in the seed data specifically to
                       demonstrate an overdue evaluation clock (and an overdue
                       information-request clock) on the deadlines panel. */
                    dateIssued: "2026-07-15",
                    typeOfInstruction: "Engineer's instruction (EI)",
                    instructionNo: "EI-008",
                    revisedDrawing: [{ id: "F5", name: "C-104 Rev A - External Drainage.pdf", size: 990000, uploadedBy: "Ong Wei Han", at: "2026-07-15" }],
                    oldDrawing: [],
                    supportingDocs: [{ id: "F6", name: "Site instruction EI-008.pdf", size: 260000, uploadedBy: "Ong Wei Han", at: "2026-07-15" }],
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
        DB_KEY, SESSION_KEY, UNLOCKED_PROJECTS_KEY, ROLES, uid, newVO,
        loadDB, saveDB, resetDB,
        getSession, setSession, clearSession,
        isProjectUnlocked, markProjectUnlocked, clearUnlockedProjects,
        passcodeSupported,
        projectHasPasscode, setProjectPasscode, verifyProjectPasscode, clearProjectPasscode,
        createProject, getProject, updateProject,
        createVO, updateVO, logHistory, seedDB
    };
}
