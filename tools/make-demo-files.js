/* VO-AI | tools/make-demo-files.js — renders the demo project's sample
   documents into demo-files/ (PDF, and one JPEG "site photo").

   Every page carries a DEMO SAMPLE banner: these illustrate the seeded
   scenario in js/store.js (same BQ items, rates and quantities) and are
   not real project documents. Not part of the app — run by hand when
   the samples change:

       NODE_PATH=$(npm root -g) node tools/make-demo-files.js
*/
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = path.join(__dirname, "..", "demo-files");
const BQ = [
    ["B/4.1", "Ceramic floor tiles 600x600mm to living area", "m2", 85],
    ["B/4.2", "Skirting to match floor finish", "m", 22],
    ["B/5.1", "Plaster and paint to internal walls", "m2", 34],
    ["C/2.3", "Timber flush door 900x2100mm with ironmongery", "no", 640],
    ["D/1.2", "100mm dia uPVC drainage pipe laid in trench", "m", 48],
    ["E/3.1", "Suspended plasterboard ceiling incl. framing", "m2", 76]
];
const PROJECT = "Cadangan Pembangunan ABC Residence";
const rm = n => "RM " + n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const css = `
  * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; color: #161d2e; margin: 0; font-size: 12px; }
  .page { padding: 28px 34px; }
  .demo { background: #fdebc8; color: #7a3b00; border: 1px solid #d4a72c; padding: 6px 10px; font-weight: bold;
          font-size: 11px; letter-spacing: .03em; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 18px 0 8px; }
  .muted { color: #4b5568; } table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #a9b1c0; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #e3e7ee; } td.num, th.num { text-align: right; }
  .grid { display: grid; grid-template-columns: 170px 1fr; gap: 6px 12px; }
  .grid div:nth-child(odd) { color: #4b5568; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; }
  .sign div { border-top: 1px solid #161d2e; padding-top: 6px; }
  .titleblock { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; border: 2px solid #161d2e; margin-top: 10px; }
  .titleblock div { border-left: 1px solid #161d2e; padding: 6px 8px; } .titleblock div:first-child { border-left: none; }
  p.clause { margin: 0 0 10px; line-height: 1.45; }
  .titleblock small { display: block; color: #4b5568; font-size: 9px; text-transform: uppercase; }
`;
const banner = `<div class="demo">VO-AI DEMO SAMPLE — illustrates the demo project only; not a real project document · 示范文件,非真实项目文件</div>`;
const wrap = body => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="page">${banner}${body}</div></body></html>`;

function titleBlock(no, rev, title) {
    return `<div class="titleblock">
      <div><small>Project</small>${PROJECT}<br><small style="margin-top:4px">Drawing title</small>${title}</div>
      <div><small>Drawing no.</small><b>${no}</b></div><div><small>Revision</small><b>${rev}</b></div>
      <div><small>Scale</small>NTS (demo)</div></div>`;
}

/* Living area 20m x 16m = 320 m2, with 168 m of skirting around it and the openings. */
function floorPlan(marble) {
    const fill = marble ? "url(#marble)" : "url(#ceramic)";
    return `<svg viewBox="0 0 760 470" height="300" style="display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="ceramic" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#f6f1e6"/><path d="M24 0V24H0" fill="none" stroke="#c9b98f" stroke-width="1"/></pattern>
        <pattern id="marble" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#f3f4f7"/><path d="M24 0V24H0" fill="none" stroke="#9aa3b8" stroke-width="1"/><path d="M2 18 Q10 10 22 6" fill="none" stroke="#c3c9d4" stroke-width="1"/></pattern>
      </defs>
      <rect x="60" y="40" width="500" height="400" fill="${fill}" stroke="#161d2e" stroke-width="8"/>
      <rect x="560" y="40" width="160" height="200" fill="#fff" stroke="#161d2e" stroke-width="8"/>
      <text x="640" y="145" text-anchor="middle" font-size="14" fill="#4b5568">KITCHEN</text>
      <rect x="560" y="240" width="160" height="200" fill="#fff" stroke="#161d2e" stroke-width="8"/>
      <text x="640" y="345" text-anchor="middle" font-size="14" fill="#4b5568">BEDROOM 3</text>
      <rect x="250" y="436" width="110" height="10" fill="#fff"/>
      <text x="310" y="225" text-anchor="middle" font-size="22" font-weight="bold">LIVING AREA</text>
      <text x="310" y="252" text-anchor="middle" font-size="14">${marble ? "600x600mm MARBLE TILES" : "600x600mm CERAMIC TILES"}</text>
      <text x="310" y="272" text-anchor="middle" font-size="12" fill="#4b5568">AREA 320 m² · SKIRTING ${marble ? "TO MATCH MARBLE" : "TO MATCH TILES"}</text>
      <line x1="60" y1="22" x2="560" y2="22" stroke="#161d2e"/><text x="310" y="16" text-anchor="middle" font-size="12">20 000</text>
      <line x1="40" y1="40" x2="40" y2="440" stroke="#161d2e"/><text x="32" y="240" text-anchor="middle" font-size="12" transform="rotate(-90 32 240)">16 000</text>
      ${marble ? `<path d="M90 80 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 q20 -25 40 0 v330 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 q-20 25 -40 0 z" fill="none" stroke="#b3261e" stroke-width="2"/>
      <polygon points="520,70 545,95 495,95" fill="#fff" stroke="#b3261e" stroke-width="2"/><text x="520" y="91" text-anchor="middle" font-size="12" fill="#b3261e" font-weight="bold">C</text>` : ""}
    </svg>`;
}

const docs = {
    "contract-agreement-pam2018.pdf": wrap(`
      <h1>Contract Agreement — Particulars</h1><div class="muted">PAM Contract 2018 (With Quantities) · demo extract of the particulars only</div>
      <h2>Articles of Agreement</h2>
      <div class="grid">
        <div>Project</div><div>${PROJECT}</div>
        <div>Employer</div><div>ABC Development Sdn Bhd</div>
        <div>Contractor</div><div>Demo Contractor Sdn Bhd</div>
        <div>Contract no.</div><div>ABC/2026/014</div>
        <div>Contract sum</div><div>${rm(12500000)}</div>
        <div>Form of contract</div><div>PAM Contract 2018 (With Quantities)</div>
        <div>Contract documents</div><div>These Articles, the Conditions of Contract, the Contract Drawings and the Contract Bills (priced Bills of Quantities)</div>
      </div>
      <h2>Variations</h2>
      <p>Variations are instructed by the Architect and valued under the Conditions of Contract: at Contract Bills rates where the work is of similar character and executed under similar conditions, and otherwise at rates agreed (star rates) supported by quotations or build-ups.</p>
      <p class="muted">The Conditions of Contract are the published PAM 2018 standard form and are not reproduced in this demo.</p>
      <div class="sign"><div>For the Employer</div><div>For the Contractor</div></div>`),

    "conditions-of-contract-demo.pdf": wrap(`
      <h1>Conditions of Contract — demo extract</h1><div class="muted">${PROJECT} · Contract ABC/2026/014 · written for the VO-AI demo in the style of a building contract; not the text of PAM 2018 or any published form</div>
      <h2>11. Variations</h2>
      <p class="clause"><b>11.1 Meaning of Variation</b><br>In these Conditions a Variation means a change to the design, quality or quantity of the Works shown in the Contract Documents, including the addition, omission or substitution of any work, materials or goods, instructed in writing by the Architect.</p>
      <p class="clause"><b>11.2 Instructions for Variations</b><br>The Architect may issue instructions requiring a Variation and the Contractor shall comply with them. An oral instruction shall be confirmed in writing by the Contractor within 7 days, and takes effect as an instruction unless the Architect dissents in writing within 7 days of receiving the confirmation.</p>
      <p class="clause"><b>11.3 Valuation of Variations</b><br>Variations shall be measured and valued by the Quantity Surveyor. Work of similar character executed under similar conditions to work priced in the Contract Bills shall be valued at the Contract Bills rates. Where the work is not of similar character or is not executed under similar conditions, the Contract Bills rates shall be the basis of a fair valuation. Where there are no comparable rates, the work shall be valued at fair rates agreed between the Quantity Surveyor and the Contractor, supported by quotations or rate build-ups. An omission shall be valued at the Contract Bills rates.</p>
      <p class="clause"><b>11.4 Submission of Variation Claims</b><br>The Contractor shall submit to the Quantity Surveyor all documents necessary for the valuation of a Variation, including measurements, quotations and rate build-ups, within 28 days of completing the varied work. The Quantity Surveyor may request further information, which the Contractor shall provide within 28 days of the request.</p>
      <p class="clause"><b>11.5 Period for Valuation</b><br>The Quantity Surveyor shall complete the valuation of a Variation within 30 days of receiving the documents required under Clause 11.4, and the value so ascertained shall be included in the next Interim Certificate.</p>
      <h2>23. Extension of Time</h2>
      <p class="clause"><b>23.1 Notice of Delay</b><br>If the Contractor considers that the completion of the Works is or will be delayed by a Relevant Event, including a Variation, the Contractor shall give written notice to the Architect within 28 days of the start of the delay, stating the cause and its likely effect on completion. A Contractor who fails to give notice within that period shall not be entitled to an extension of time for that event.</p>
      <p class="clause"><b>23.2 Particulars and Decision</b><br>The Contractor shall submit full particulars of the claim for extension of time, with an updated programme showing the critical path before and after the event, within 28 days after the end of the delay. The Architect shall grant a fair and reasonable extension of time, or give reasons for refusing one, within 6 weeks of receiving the particulars.</p>
      <h2>30. Certificates and Payment</h2>
      <p class="clause"><b>30.1 Interim Certificates</b><br>The Architect shall issue Interim Certificates at monthly intervals, stating the value of work properly executed including the value of Variations ascertained under Clause 11.5. The Employer shall pay the amount certified within 30 days of the date of the certificate.</p>`),

    "bills-of-quantities-priced.pdf": wrap(`
      <h1>Bills of Quantities (Priced) — extract</h1><div class="muted">${PROJECT} · Contract ABC/2026/014 · the items VO-AI cross-checks rates against</div>
      <table><tr><th>Item</th><th>Description</th><th>Unit</th><th class="num">Rate</th></tr>
      ${BQ.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="num">${rm(r[3])}</td></tr>`).join("")}
      </table><p class="muted">Quantities and the remaining bills are omitted from this demo extract.</p>`),

    "A-201-revB-floor-finishes.pdf": wrap(`<h1>A-201 Floor Finishes — Living Area</h1><div class="muted">Revision B · superseded by Revision C</div>
      ${floorPlan(false)}${titleBlock("A-201", "B", "Floor Finishes — Living Area")}`),

    "A-201-revC-floor-finishes.pdf": wrap(`<h1>A-201 Floor Finishes — Living Area</h1><div class="muted">Revision C · issued with Architect's Instruction AI-021</div>
      ${floorPlan(true)}
      <table><tr><th>Rev</th><th>Description</th><th>Ref</th></tr>
        <tr><td>C</td><td>Living area floor finish changed from 600x600mm ceramic tiles to 600x600mm marble tiles; skirting to match.</td><td>AI-021</td></tr>
        <tr><td>B</td><td>Issued for construction.</td><td>—</td></tr></table>
      ${titleBlock("A-201", "C", "Floor Finishes — Living Area")}`),

    "marble-supplier-quotation.pdf": wrap(`
      <h1>Quotation</h1><div class="muted">Demo Marble Supplier Sdn Bhd · to the Contractor, for ${PROJECT}</div>
      <div class="grid" style="margin-top:12px"><div>Quotation ref.</div><div>DMS/Q/0715</div><div>Validity</div><div>60 days</div></div>
      <table><tr><th>Description</th><th>Unit</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
        <tr><td>Supply 600x600x20mm polished marble tiles, incl. 5% wastage</td><td>m2</td><td class="num">320</td><td class="num">${rm(190)}</td><td class="num">${rm(60800)}</td></tr>
        <tr><td>Lay and fix on cement-sand screed, grouting and polishing</td><td>m2</td><td class="num">320</td><td class="num">${rm(58)}</td><td class="num">${rm(18560)}</td></tr>
        <tr><th colspan="4" class="num">Total</th><th class="num">${rm(79360)}</th></tr></table>
      <p>Equivalent all-in rate: <b>${rm(248)} per m2</b> (supply ${rm(190)} + laying ${rm(58)}). Lead time 4 weeks from order.</p>`),

    "C-104-revA-external-drainage.pdf": wrap(`<h1>C-104 External Drainage — Rear Boundary</h1><div class="muted">Revision A · issued with Engineer's Instruction EI-008</div>
      <svg viewBox="0 0 760 360" height="250" style="display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">
        <rect x="200" y="60" width="360" height="200" fill="#f3f4f7" stroke="#161d2e" stroke-width="4"/><text x="380" y="165" text-anchor="middle" font-size="18">HOUSE</text>
        <line x1="40" y1="320" x2="720" y2="320" stroke="#161d2e" stroke-width="3" stroke-dasharray="12 6"/><text x="380" y="345" text-anchor="middle" font-size="12">REAR BOUNDARY</text>
        <polyline points="60,295 700,295" fill="none" stroke="#2546c4" stroke-width="4"/>
        ${[60, 273, 487, 700].map((x, i) => `<rect x="${x - 10}" y="285" width="20" height="20" fill="#fff" stroke="#2546c4" stroke-width="3"/><text x="${x}" y="278" text-anchor="middle" font-size="11">S${i + 1}</text>`).join("")}
        <text x="380" y="288" text-anchor="middle" font-size="12" fill="#2546c4">100mm dia uPVC pipe in trench · 142 m</text>
      </svg>
      <table><tr><th>Item</th><th>Description</th><th class="num">Qty</th></tr>
        <tr><td>1</td><td>100mm dia uPVC drainage pipe laid in trench along rear boundary</td><td class="num">142 m</td></tr>
        <tr><td>2</td><td>Precast concrete sump 600x600mm with cover (S1–S4)</td><td class="num">4 no</td></tr></table>
      ${titleBlock("C-104", "A", "External Drainage — Rear Boundary")}`),

    "site-instruction-EI-008.pdf": wrap(`
      <h1>Engineer's Instruction</h1><div class="muted">${PROJECT} · Contract ABC/2026/014</div>
      <div class="grid" style="margin-top:12px"><div>Instruction no.</div><div><b>EI-008</b></div><div>Issued by</div><div>C&amp;S Engineer (demo)</div><div>To</div><div>Demo Contractor Sdn Bhd</div></div>
      <h2>Instruction</h2>
      <p>Provide additional external drainage along the rear boundary as shown on drawing C-104 Rev A:</p>
      <ol><li>100mm dia uPVC drainage pipe laid in trench — approximately 142 m.</li><li>Four (4) precast concrete sumps 600x600mm with cover.</li></ol>
      <p>Instructed on site; to be valued as a variation.</p>
      <div class="sign"><div>C&amp;S Engineer</div><div>Received by Contractor</div></div>`)
};

const photoHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${css} body{margin:0}</style></head><body>
  <svg viewBox="0 0 1200 800" width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="t" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="60" height="60" fill="#e9dfc8"/><path d="M60 0V60H0" fill="none" stroke="#b9a77c" stroke-width="2"/></pattern>
    <linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5f2ea"/><stop offset="1" stop-color="#e5e0d4"/></linearGradient></defs>
    <rect width="1200" height="430" fill="url(#w)"/>
    <polygon points="0,430 1200,430 1200,800 0,800" fill="url(#t)"/>
    <rect x="0" y="418" width="1200" height="14" fill="#d8ccb0"/>
    <rect x="780" y="120" width="260" height="250" fill="#cfe3f3" stroke="#9aa3b8" stroke-width="10"/>
    <rect x="160" y="150" width="200" height="280" fill="#d9cbb0" stroke="#a08a5c" stroke-width="6"/>
    <rect x="0" y="0" width="1200" height="56" fill="#fdebc8"/>
    <text x="600" y="36" text-anchor="middle" font-family="Arial" font-size="24" font-weight="bold" fill="#7a3b00">VO-AI DEMO SAMPLE — illustration, not a real site photo</text>
    <rect x="0" y="740" width="1200" height="60" fill="rgba(22,29,46,.75)"/>
    <text x="30" y="778" font-family="Arial" font-size="24" fill="#fff">Living area — existing 600x600mm ceramic floor tiles and skirting, before the change (VO-001)</text>
  </svg></body></html>`;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    for (const [name, html] of Object.entries(docs)) {
        await page.setContent(html, { waitUntil: "load" });
        await page.pdf({ path: path.join(OUT, name), format: "A4", landscape: /^(A-201|C-104)/.test(name), printBackground: true });
        console.log("wrote", name);
    }
    /* site-photo-living-area.jpg is now a photo-realistic AI image the team
       supplied, labelled "AI-GENERATED · DEMO ONLY" on the image itself;
       the drawn illustration below is only written when that file is
       missing. */
    if (!fs.existsSync(path.join(OUT, "site-photo-living-area.jpg"))) {
        await page.setViewportSize({ width: 1200, height: 800 });
        await page.setContent(photoHtml, { waitUntil: "load" });
        await page.screenshot({ path: path.join(OUT, "site-photo-living-area.jpg"), type: "jpeg", quality: 82 });
        console.log("wrote site-photo-living-area.jpg");
    }
    await browser.close();
})();
