// VO-AI | notify/rules.mjs — whose turn a VO is, and the email that says so.
// Same as nextStep in js/notify.js (test/notify.test.js keeps them equal).

// The VO's stage: the same as voStage in js/permissions.js.
function infoRequestKey(vo) {
    return vo && vo.infoRequestedAt ? vo.infoRequestedAt + "|" + (vo.infoRequestNote || "") : null;
}
function infoAnswered(vo) {
    const key = infoRequestKey(vo);
    return !key || !!(vo.infoResponse && vo.infoResponse.forRequest === key);
}
export function voStage(vo) {
    if (!vo) return "describe";
    if (vo.certifiedStatus === "Approved") return "done";
    if (vo.certifiedStatus === "Rejected") return "closed";
    if (vo.evaluateStatus === "Approved") return "client";
    if (vo.evaluateStatus === "Rejected") return "rejected";
    if (vo.submitted) {
        if (vo.instructionStatus === "Pending") return "design";
        if (vo.instructionStatus === "Returned") return "designRejected";
        return infoAnswered(vo) ? "consultant" : "info";
    }
    if (vo.instructionStatus === "Confirmed") return "measure";
    if (vo.sentToDesign) return "design";
    if (vo.instructionStatus === "Returned") return "designRejected";
    return "describe";
}

const STEP_OF_STAGE = {
    design: ["issue", "administrator"], designRejected: ["returned", "contractor"],
    measure: ["measure", "contractor"], consultant: ["value", "consultant"],
    info: ["info", "contractor"], rejected: ["rejected", "contractor"], client: ["approve", "client"],
};

export function nextStep(vo) {
    if (!vo) return null;
    const s = STEP_OF_STAGE[voStage(vo)];
    if (!s) return null;
    const round = (vo.history || []).filter((h) => /^(Submitted to |Sent to design team|Further information sent back)/.test(String(h.action || ""))).length;
    return { id: s[0], role: s[1], key: vo.id + ":" + s[0] + ":" + round };
}

const WHAT = {
    returned: ["was rejected by the design team: revise it and send it again", "被设计团队退回：请修改后重新送出"],
    measure: ["was approved by the design team: measure it, check the rates and submit it to the consultant QS", "已获设计团队批准：请计量、核对单价后提交咨询工料测量师"],
    info: ["has a request for further information from the consultant QS: answer it and send it back", "咨询工料测量师要求补充资料：请填写后送回"],
    rejected: ["was rejected by the consultant QS: correct it and submit again", "被咨询工料测量师拒绝：请修改后重新提交"],
    issue: ["was sent by the contractor for approval: add the drawings and documents, then approve or reject it", "承包商已送审：请补齐图纸与文件，然后批准或退回"],
    value: ["was submitted by the contractor: check it and assess it", "承包商已提交：请核查并评估"],
    certify: ["was approved by the consultant QS: certify the value", "已由咨询工料测量师批准：请核证金额"],
    approve: ["was submitted by the consultant QS: approve it", "咨询工料测量师已提交：请批准"],
};

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// One email, in English and Chinese, with a link to the VO.
export function emailFor(step, vo, project, appUrl) {
    const [en, zh] = WHAT[step.id];
    const link = appUrl.replace(/\/$/, "") + "/vo.html?id=" + encodeURIComponent(vo.id);
    const desc = String(vo.description || "").slice(0, 200);
    return {
        subject: "VO-AI · " + vo.no + " " + en.split(":")[0] + " — " + (project.name || project.id),
        html: "<p><strong>" + esc(vo.no) + "</strong> " + esc(en) + ".<br>" + esc(vo.no) + " " + esc(zh) + "。</p>" +
            "<p>" + esc(project.name || "") + "<br><em>" + esc(desc) + "</em></p>" +
            '<p><a href="' + esc(link) + '">Open ' + esc(vo.no) + " in VO-AI / 打开变更令 →</a></p>" +
            '<p style="color:#64748b;font-size:12px">You get this because you are on the project as the next person to act. ' +
            "您收到此邮件，是因为您是此项目中下一位处理人。</p>",
    };
}
