/* VO-AI | page-copilot.js — the Copilot page (js/copilot.js). */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("copilot", t("nav.copilot"), t("crumb.copilot"));
        if (!ctx) return;
        const { session, project } = ctx;
        const host = document.getElementById("copilotBody");
        const state = { history: [], busy: false };
        const contract = typeof askContractAvailable === "function" && askContractAvailable(project.id);

        function draw() { host.innerHTML = renderCopilot(state, { contract: contract }); }

        async function ask(question, intentHint) {
            const q = String(question || "").trim();
            if (!q || state.busy) return;
            const fresh = getProject(project.id) || project;
            const intent = intentHint || copilotIntent(q);
            if (intent) {
                state.history.push({ question: q, data: answerFromData(intent, {
                    project: fresh, role: session.role, today: today(), db: loadDB(), question: q }) });
                draw();
                return;
            }
            if (!contract) { state.history.push({ question: q }); draw(); return; }
            /* a question for the contract, with the project's figures */
            state.busy = true;
            const entry = { question: q, contract: { loading: true } };
            state.history.push(entry);
            draw();
            try {
                const body = { project_id: fresh.id, vo_id: null, question: q, engine_facts: projectFacts(fresh, today()) };
                if (askAsGuest(fresh.id)) { body.guest = true; body.role = session.role; }
                entry.contract = await Cloud.ask(body);
            } catch (e) {
                entry.contract = { error: e.message || String(e) };
            }
            state.busy = false;
            draw();
        }

        host.addEventListener("click", e => {
            const btn = e.target.closest(".copilot-q-btn");
            if (btn) { ask(btn.dataset.question, btn.dataset.intent); return; }
            if (e.target.id === "copilotAskBtn") {
                const input = document.getElementById("copilotInput");
                ask(input.value);
            }
        });
        host.addEventListener("keydown", e => {
            if (e.target.id === "copilotInput" && e.key === "Enter") { e.preventDefault(); ask(e.target.value); }
        });
        draw();
    })();
}
