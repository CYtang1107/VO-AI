const test = require("node:test");
const assert = require("node:assert");

const { voStage, canEdit, infoRequestKey } = require("../js/permissions.js");
const { renderWorkflow, renderMeasureSubmit } = require("../js/page-vo.js");
const { seedDB } = require("../js/store.js");

const project = () => seedDB().projects[0];
const draft = () => JSON.parse(JSON.stringify(project().vos[2]));   /* VO-003, a draft */

test("the demo VOs: VO-001 done, VO-002 with the consultant QS, VO-003 being described", () => {
    assert.deepStrictEqual(project().vos.map(voStage), ["done", "consultant", "describe"]);
});

test("the contractor describes (step 1), the contract agent checks (step 2), then it can be sent", () => {
    const v = Object.assign(draft(), { beforeMedia: [] });
    let html = renderWorkflow(v, project(), "contractor", { step: 1 });
    /* the site before the work: a photo is required, a video optional */
    assert.match(html, /data-media="beforeMedia" accept="image\/\*" capture="environment"/);
    assert.match(html, /id="wfNext" disabled/);
    assert.match(html, /<li class="todo">○ Before photo \(0\)<\/li>/);
    v.beforeMedia = [{ id: "M0", name: "VID-0.mp4", kind: "video" }];
    assert.match(renderWorkflow(v, project(), "contractor", { step: 1 }), /id="wfNext" disabled/, "a video alone is not enough");
    v.beforeMedia.push({ id: "M1", name: "IMG-0.jpg", kind: "photo" });
    html = renderWorkflow(v, project(), "contractor", { step: 1 });
    assert.match(html, /id="wfNext">/);
    assert.match(html, /Step 1 · Describe the change/);
    assert.match(html, /data-field="description"/);
    assert.match(html, /data-field="contractorRemark"/);
    assert.doesNotMatch(html, /data-field="measurement"|contractDocs/, "only the description and remark");
    assert.match(html, /id="wfNext"/);
    html = renderWorkflow(v, project(), "contractor", { step: 2 });
    assert.match(html, /PAM 2018 Clause 11\.1/);
    assert.match(html, /id="wfSend">Send to the design team for approval<\/button>/);
    /* not a variation: cannot be sent */
    html = renderWorkflow(Object.assign(v, { description: "Rework of defective ceiling" }), project(), "contractor", { step: 2 });
    assert.match(html, /id="wfSend" disabled/);
});

test("sent: the design team adds drawings and documents, then approves or rejects", () => {
    const v = Object.assign(draft(), { sentToDesign: true });
    assert.strictEqual(voStage(v), "design");
    v.beforeMedia = [{ id: "M1", name: "IMG-0.jpg", kind: "photo" }];
    const html = renderWorkflow(v, project(), "administrator", {});
    assert.match(html, /data-media-field="beforeMedia"/, "the design team sees the site before the work");
    assert.doesNotMatch(html, /class="media-picker"/, "but cannot change it");
    ["oldDrawing", "revisedDrawing", "designDocs"].forEach(f => assert.match(html, new RegExp('class="doc-picker" data-field="' + f + '"')));
    assert.match(html, /id="issueInstrBtn">Approve and issue the instruction/);
    assert.match(html, /id="wfReject"/);
    assert.match(renderWorkflow(v, project(), "contractor", {}), /With the design team/);
    /* rejected: back to the contractor with the note */
    const back = Object.assign(draft(), { instructionStatus: "Returned", instructionNote: "Need the ceiling layout" });
    assert.strictEqual(voStage(back), "designRejected");
    assert.match(renderWorkflow(back, project(), "contractor", { step: 1 }), /Need the ceiling layout/);
});

test("approved: the contractor measures, attaches photos and submits to the consultant QS", () => {
    const v = Object.assign(draft(), { instructionStatus: "Confirmed", issuedInstruction: { kind: "AI", no: "AI-027" } });
    assert.strictEqual(voStage(v), "measure");
    assert.strictEqual(canEdit("measurement", v, "contractor"), true);
    let html = renderWorkflow(v, project(), "contractor", {});
    assert.match(html, /Approved · Architect&#39;s Instruction \(AI\) AI-027/);
    assert.match(html, /data-media="afterMedia" accept="image\/\*" capture="environment"/, "take a photo of the completed work");
    assert.match(html, /data-media="afterMedia" accept="video\/\*"/, "a video may be added");
    assert.match(html, /id="wfGoMeasure">Next: measure →/, "photos first, then on to the measurement");
    assert.doesNotMatch(html, /wfSubmitQs/, "submitted from the measurement tab");
    let bar = renderMeasureSubmit(v, "contractor");
    assert.match(bar, /id="wfSubmitQs" disabled/, "not without a completed photo");
    assert.match(bar, /<li class="todo">○ Completed photo \(0\)<\/li>/);
    assert.match(bar, /id="wfGoPhotos"/);
    assert.doesNotMatch(html, /AI photo check/, "nothing to check yet");
    v.afterMedia = [{ id: "M1", name: "IMG-1.jpg", kind: "photo" }, { id: "M2", name: "VID-1.mp4", kind: "video" }];
    html = renderWorkflow(v, project(), "contractor", {});
    assert.match(html, /AI photo check/);
    bar = renderMeasureSubmit(v, "contractor");
    assert.match(bar, /id="wfSubmitQs">Submit to the consultant QS/);
    assert.match(renderMeasureSubmit(Object.assign(v, { measurement: [] }), "contractor"), /id="wfSubmitQs" disabled/,
        "a disabled button with no measured item");
    assert.strictEqual(renderMeasureSubmit(v, "consultant"), "", "only the contractor submits");
});

test("the consultant QS assesses, submits to the client, or asks for information; the contractor answers", () => {
    const v = JSON.parse(JSON.stringify(project().vos[1]));   /* VO-002 */
    let html = renderWorkflow(v, project(), "consultant", {});
    assert.match(html, /AI photo check/);
    assert.match(html, /data-media-field="beforeMedia"[\s\S]*data-media-field="afterMedia"/, "before and after, side by side");
    assert.match(html, /class="photo-check-host"/);
    assert.match(html, /id="wfSubmitClient"/);
    assert.match(html, /id="wfRequestInfo"/);
    Object.assign(v, { infoRequestedAt: "2026-10-01", infoRequestNote: "Show the sump base" });
    assert.strictEqual(voStage(v), "info");
    html = renderWorkflow(v, project(), "contractor", {});
    assert.match(html, /Show the sump base/);
    assert.match(html, /id="wfSendBack"/);
    v.infoResponse = { text: "Photo attached", at: "2026-10-02", forRequest: infoRequestKey(v) };
    assert.strictEqual(voStage(v), "consultant");
    assert.match(renderWorkflow(v, project(), "consultant", {}), /The contractor replied on .*Photo attached/);
    /* asking again opens a new request */
    v.infoRequestNote = "And the cover";
    assert.strictEqual(voStage(v), "info");
});

test("submitted to the client: the client approves or rejects, with no design-team certification in between", () => {
    const v = Object.assign(JSON.parse(JSON.stringify(project().vos[1])), { evaluateStatus: "Approved", caCertifiedStatus: "Pending" });
    assert.strictEqual(voStage(v), "client");
    assert.strictEqual(canEdit("certifiedStatus", v, "client"), true);
    const html = renderWorkflow(v, project(), "client", {});
    assert.match(html, /id="wfClientApprove"/);
    assert.match(html, /id="wfClientReject"/);
    assert.strictEqual(voStage(Object.assign(v, { certifiedStatus: "Rejected" })), "closed");
});
