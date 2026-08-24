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
