// VO-AI | notify/rules.mjs — whose turn a VO is, and the email that says so.
// Same as nextStep in js/notify.js (test/notify.test.js keeps them equal).

export function nextStep(vo) {
    if (!vo) return null;
    const round = (vo.history || []).filter((h) => /^Submitted to /.test(String(h.action || ""))).length;
    const step = (id, role) => ({ id, role, key: vo.id + ":" + id + ":" + round });
    const confirmed = vo.instructionStatus === undefined || vo.instructionStatus === null
        ? vo.submitted === true : vo.instructionStatus === "Confirmed";
    const caDone = vo.caCertifiedStatus === undefined || vo.caCertifiedStatus === null
        ? vo.evaluateStatus === "Approved" : vo.caCertifiedStatus === "Certified";

    if (!vo.submitted) return vo.instructionStatus === "Returned" ? step("returned", "contractor") : null;
    if (vo.evaluateStatus === "Rejected") return step("rejected", "contractor");
    if (!confirmed) return step("issue", "administrator");
    if (vo.evaluateStatus !== "Approved") return step("value", "consultant");
    if (!caDone) return step("certify", "administrator");
    if (vo.certifiedStatus === "Pending" || !vo.certifiedStatus) return step("approve", "client");
    return null;
}

const WHAT = {
    returned: ["was returned by the design team: correct it and submit again", "被设计团队退回：请修改后重新提交"],
    rejected: ["was rejected by the consultant QS: correct it and submit again", "被咨询工料测量师拒绝：请修改后重新提交"],
    issue: ["was submitted by the contractor: issue the AI / EI, or return it", "已由承包商提交：请发出 AI / EI，或退回"],
    value: ["has its instruction issued: measure and value it", "已发出指示：请计量估价"],
    certify: ["was approved by the consultant QS: certify the value", "已由咨询工料测量师批准：请核证金额"],
    approve: ["was certified by the design team: approve it for payment", "已由设计团队核证：请批准付款"],
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
