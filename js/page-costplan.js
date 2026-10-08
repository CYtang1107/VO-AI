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
            const modeSel = document.getElementById("cfMode");
            if (modeSel) modeSel.value = cfMode;
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
            if (e.target.id === "cfReset") {
                updateProject(project.id, p => { delete p.cashflow; });
                toast(t("costplan.cf.resetDone"));
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
        /* the monthly figures: an uploaded cash-flow sheet, or typed over */
        let cfMode = "auto";
        async function importCashflow(file) {
            let rows;
            try {
                rows = /\.csv$/i.test(file.name) ? parseCsv(await file.text()) : await parseXlsx(await file.arrayBuffer());
            } catch (err) { toast(t("costplan.cf.error.read", { reason: err.message || String(err) }), "error"); return; }
            const r = readCashflowSheet(rows, cfMode === "auto" ? null : cfMode);
            if (r.error) { toast(t("costplan.cf.error." + r.error), "error"); return; }
            const curve = sCurve(getProject(project.id) || project, today());
            const inProgramme = new Set(curve ? curve.points.map(x => x.date.slice(0, 7)) : []);
            const months = {};
            let outside = 0;
            Object.keys(r.months).forEach(k => { if (inProgramme.has(k)) months[k] = r.months[k]; else outside++; });
            if (!Object.keys(months).length) { toast(t("costplan.cf.outside", { n: outside }), "error"); return; }
            updateProject(project.id, p => { p.cashflow = { months: months, source: { name: file.name, at: today() } }; });
            const mode = r.mode.planned || r.mode.forecast;
            toast(t("costplan.cf.imported", { n: Object.keys(months).length, name: file.name, mode: t("costplan.cf.modeWord." + mode) }) +
                (outside ? " " + t("costplan.cf.outside", { n: outside }) : ""));
            draw();
        }
        host.addEventListener("change", e => {
            if (!editable) return;
            if (e.target.id === "cfMode") { cfMode = e.target.value; return; }
            if (e.target.id === "cfFile") { const f = e.target.files && e.target.files[0]; if (f) importCashflow(f); e.target.value = ""; return; }
            if (e.target.dataset.cfKey) {
                const key = e.target.dataset.cfKey, k = e.target.dataset.cfK;
                const v = e.target.value.replace(/^(RM|MYR)\s*/i, "").replace(/[,\s]/g, "");
                updateProject(project.id, p => {
                    p.cashflow = p.cashflow || { months: {} };
                    p.cashflow.months = p.cashflow.months || {};
                    const m = p.cashflow.months[key] = p.cashflow.months[key] || {};
                    if (v === "" || !(Number(v) >= 0)) delete m[k]; else m[k] = Number(v);
                    if (!Object.keys(m).length) delete p.cashflow.months[key];
                });
                draw();
                return;
            }
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
