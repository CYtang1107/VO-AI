/* VO-AI | page-costplan.js — the S-curve page: the dashboard's cost
   overview given the whole screen, one view at a time (js/costplan.js). */

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("dashboard", t("costplan.detailTitle"), t("crumb.dashboard"));
        if (!ctx) return;
        const { session, project } = ctx;
        /* the cost overview is not the consultant QS's (costOverviewVisible) */
        if (!costOverviewVisible(session.role)) { location.replace("dashboard.html"); return; }
        const crumbEl = document.querySelector(".breadcrumb");
        if (crumbEl) crumbEl.textContent = t("crumb.project", { name: project.name });

        const host = document.getElementById("costDetail");
        const editable = costOverviewEditable(session.role);
        let range = "toDate";
        try { if (localStorage.getItem("voai.scRange.v1") === "all") range = "all"; } catch (e) { /* default */ }
        let tab = (location.hash || "").slice(1);
        if (COST_TABS.indexOf(tab) === -1) tab = "curve";

        /* the curve takes what is left of the screen above its figures */
        function chartHeight() {
            if (window.innerWidth <= 760) return null;
            const top = host.getBoundingClientRect().top + window.scrollY;
            return window.innerHeight - top - 60 - 40 - 110 - 76;
        }
        function draw() {
            const p = getProject(project.id) || project;
            keepFolds(() => {
                host.innerHTML = renderCostDetail(p, today(), { tab: tab, editable: editable, width: host.clientWidth, height: chartHeight(), range: range });
            });
            if (tab === "curve") mountCostChart(host, viewCurve(sCurve(p, today()), range));
            if (typeof fitPanels === "function") fitPanels();
        }

        host.addEventListener("click", e => {
            const tabBtn = e.target.closest(".cd-tab");
            if (tabBtn) {
                tab = tabBtn.dataset.tab;
                history.replaceState(null, "", "#" + tab);
                draw();
                return;
            }
            const rangeBtn = e.target.closest(".sc-range-btn");
            if (rangeBtn) {
                range = rangeBtn.dataset.range;
                try { localStorage.setItem("voai.scRange.v1", range); } catch (err) { /* not kept */ }
                draw();
                return;
            }
            if (!editable) return;
            if (e.target.id === "cpCertAdd") {
                const date = document.getElementById("cpCertDate").value;
                const amount = Number(document.getElementById("cpCertAmount").value);
                if (!date || !(amount > 0)) { toast(t("costplan.badCert"), "error"); return; }
                const actualRaw = document.getElementById("cpCertActual").value;
                const cert = { date: date, amount: amount };
                if (actualRaw !== "" && Number(actualRaw) >= 0) cert.actual = Number(actualRaw);
                updateProject(project.id, p => { p.certificates = (p.certificates || []).concat([cert]); });
                toast(t("costplan.certAdded"));
                draw();
                return;
            }
            const rem = e.target.closest(".cp-cert-remove");
            if (rem) {
                updateProject(project.id, p => {
                    const i = (p.certificates || []).findIndex(c => c.date === rem.dataset.date && String(c.amount) === rem.dataset.amount);
                    if (i >= 0) p.certificates.splice(i, 1);
                });
                draw();
            }
        });
        host.addEventListener("change", e => {
            if (!editable) return;
            if (e.target.id === "evmMethod") { updateProject(project.id, p => { p.eacMethod = e.target.value; }); draw(); return; }
            if (e.target.id === "evmEtc") {
                const v = e.target.value;
                updateProject(project.id, p => { p.etcEstimate = v === "" ? null : Number(v); });
                draw();
                return;
            }
            if (e.target.id !== "cpStart" && e.target.id !== "cpEnd") return;
            const start = document.getElementById("cpStart").value, end = document.getElementById("cpEnd").value;
            if (start && end && end <= start) { toast(t("costplan.badProgramme"), "error"); return; }
            updateProject(project.id, p => { p.programme = { start: start, end: end }; });
            draw();
        });

        draw();
        let w = host.clientWidth, h = window.innerHeight, timer = null;
        window.addEventListener("resize", () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (Math.abs(host.clientWidth - w) > 40 || Math.abs(window.innerHeight - h) > 60) { w = host.clientWidth; h = window.innerHeight; draw(); }
            }, 200);
        });
    })();
}
