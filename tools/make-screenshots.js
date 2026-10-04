/* VO-AI | tools/make-screenshots.js — captures the eight screenshots
   that docs/proposal/3-demo-examples.md §3.2 calls for, from the app
   with fresh demo data, at 1440px wide, into docs/screenshots/.
   Not part of the app. Serve the repository first, then run:

       python3 -m http.server 8765 &
       NODE_PATH=$(npm root -g) node tools/make-screenshots.js [http://localhost:8765] [en|zh]
*/
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8765";
const LANG = process.argv[3] || "en";
const OUT = path.join(__dirname, "..", "docs", "screenshots");
const USERS = { contractor: "ong.weihan", consultant: "serena.wong", client: "tan.ziqian" };
const shot = name => ({ path: path.join(OUT, name + (LANG === "zh" ? "-zh" : "") + ".jpg"), type: "jpeg", quality: 88 });

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

    /* Fresh demo data, then sign in as `role`; returns the seeded VO ids. */
    async function signIn(role, fresh) {
        await page.goto(BASE + "/index.html");
        return page.evaluate(([role, user, lang, fresh]) => {
            if (fresh) localStorage.clear();
            localStorage.setItem("voai.lang.v1", lang);
            const db = loadDB();
            localStorage.setItem("voai.session.v1", JSON.stringify({ name: user, role: role, projectId: db.projects[0].id }));
            return db.projects[0].vos.map(v => v.id);
        }, [role, USERS[role], LANG, fresh]);
    }
    const settle = () => page.waitForTimeout(500);

    /* 1 — sign-in screen with the three role cards */
    await page.goto(BASE + "/index.html");
    await page.evaluate(lang => { localStorage.clear(); localStorage.setItem("voai.lang.v1", lang); }, LANG);
    await page.reload(); await settle();
    await page.screenshot(shot("01-sign-in"));

    /* 2 — create-project panel, after reading the sample priced BQ */
    await signIn("consultant", true);
    await page.goto(BASE + "/projects.html"); await settle();
    await page.fill("#pName", "Cadangan Pembangunan ABC Residence — Phase 2").catch(() => {});
    await page.setInputFiles("#pBqFile", path.join(__dirname, "..", "demo-files", "sample-priced-bq.csv"));
    await settle();
    await page.locator(".card:has(#pBqFile)").screenshot(shot("02-create-project-bq-import"));

    const vos = await signIn("contractor", true);
    const vo1 = BASE + "/vo.html?id=" + encodeURIComponent(vos[0]);

    /* 3 — the contractor's panel on VO-001: instruction, drawings, documents */
    await page.goto(vo1); await settle();
    await page.locator('.role-panel[data-role="contractor"]').screenshot(shot("03-contractor-panel-documents"));

    /* 4, 5 — the consultant's view: the rate cross-check and the assessment */
    await signIn("consultant", false);
    await page.goto(vo1); await settle();
    await page.locator(".card:has(#measurementBody)").screenshot(shot("04-rate-cross-check"));
    await page.locator(".card:has(#assessmentPanel)").screenshot(shot("05-assessment-clause-findings"));

    /* 6 — the client's certification fields, editable once approved */
    await signIn("client", false);
    await page.goto(vo1); await settle();
    await page.locator('.role-panel[data-role="client"]').screenshot(shot("06-client-certification"));

    /* 7 — the draft VO report */
    await page.goto(BASE + "/report.html"); await settle();
    await page.selectOption("#voPicker", vos[0]); await settle();
    await page.locator("#reportHost").screenshot(shot("07-vo-report"));

    /* 8 — the dashboard, and the all-variations summary */
    await signIn("consultant", false);
    await page.goto(BASE + "/dashboard.html"); await settle();
    await page.screenshot(shot("08-dashboard"));
    await page.goto(BASE + "/report.html"); await settle();
    await page.selectOption("#reportMode", "summary"); await settle();
    await page.locator("#reportHost").screenshot(shot("08b-summary-report"));

    await browser.close();
    console.log("screenshots written to", OUT);
})();
