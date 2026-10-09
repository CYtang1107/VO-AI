/* VO-AI | page-copilot.js — the Copilot page (js/copilot.js). */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("copilot", t("nav.copilot"), t("crumb.copilot"));
        if (!ctx) return;
        const { session, project } = ctx;
        const host = document.getElementById("copilotBody");
        const state = { history: [], busy: false };
        /* the general AI mode: a team account, or the demo's guest allowance */
        const ai = typeof aiAvailable === "function" && aiAvailable();

        /* the page is drawn once; each question redraws only the conversation */
        host.innerHTML = renderCopilot(state, { ai: ai, role: session.role });
        const thread = document.getElementById("copilotThread");
        const input = document.getElementById("copilotInput");
        function draw() {
            thread.innerHTML = renderThread(state, { ai: ai, role: session.role });
            thread.scrollTop = thread.scrollHeight;
        }

        async function askAi(q) {
            if (state.busy) return;
            const fresh = getProject(project.id) || project;
            state.busy = true;
            const entry = { question: q, ai: { loading: true } };
            state.history.push(entry);
            draw();
            try {
                const body = { project_id: fresh.id, question: q, project_data: projectData(fresh, today(), session.role) };
                if (aiAsGuest()) { body.guest = true; body.role = session.role; }
                entry.ai = await Cloud.invoke("copilot", body);
            } catch (e) {
                entry.ai = { error: e.message || String(e) };
            }
            state.busy = false;
            draw();
        }

        function ask(question, intentHint) {
            const q = String(question || "").trim();
            if (!q || state.busy) return;
            input.value = "";
            const intent = intentHint || copilotIntent(q);
            if (intent) {
                const fresh = getProject(project.id) || project;
                state.history.push({ question: q, data: answerFromData(intent, {
                    project: fresh, role: session.role, today: today(), db: loadDB(), question: q }) });
                draw();
                return;
            }
            if (!ai) { state.history.push({ question: q }); draw(); return; }
            askAi(q);
        }

        host.addEventListener("click", e => {
            const again = e.target.closest(".copilot-reask");
            if (again) { if (ai) askAi(again.dataset.question); return; }
            const btn = e.target.closest(".copilot-q-btn");
            if (btn) { ask(btn.dataset.question, btn.dataset.intent); return; }
            if (e.target.id === "copilotAskBtn") { ask(input.value); input.focus(); }
        });
        host.addEventListener("keydown", e => {
            if (e.target.id === "copilotInput" && e.key === "Enter") { e.preventDefault(); ask(e.target.value); }
        });
        draw();
    })();
}
