/* VO-AI | permissions.js
   The template's "each role can only edit the yellow things" rule,
   in exactly one place. No dependencies. */

const ROLE_LABEL = {
    contractor: "Contractor QS",
    consultant: "Consultant QS",
    client: "Client / Developer"
};

const FIELD_OWNER = {
    /* contractor's columns */
    description: "contractor",
    dateIssued: "contractor",
    typeOfInstruction: "contractor",
    instructionNo: "contractor",
    revisedDrawing: "contractor",
    oldDrawing: "contractor",
    supportingDocs: "contractor",
    measurement: "contractor",
    contractorRemark: "contractor",

    /* consultant's columns */
    dueDate: "consultant",
    assessment: "consultant",
    assessmentNote: "consultant",
    timeImpact: "consultant",
    evaluateStatus: "consultant",
    consultantRemark: "consultant",

    /* client's columns */
    certifiedStatus: "client",
    finalPrice: "client",
    clientRemark: "client"
};

function canEdit(field, vo, role) {
    if (FIELD_OWNER[field] !== role) return false;

    if (role === "contractor") {
        return vo.evaluateStatus === "Draft" ||
               vo.evaluateStatus === "Pending" ||
               vo.evaluateStatus === "Rejected";
    }
    if (role === "consultant") {
        return vo.submitted === true;
    }
    if (role === "client") {
        return vo.evaluateStatus === "Approved";
    }
    return false;
}

function lockReason(field, vo, role) {
    if (canEdit(field, vo, role)) return "";

    const owner = FIELD_OWNER[field];
    if (!owner) return "This field is calculated by VO-AI and cannot be edited.";
    if (owner !== role) {
        return "Read-only — this column belongs to the " + ROLE_LABEL[owner] + ".";
    }
    if (role === "contractor") {
        return "Locked — the consultant has already assessed this VO.";
    }
    if (role === "consultant") {
        return "Locked — waiting for the contractor to submit the VO.";
    }
    return "Locked — waiting for the consultant's approval.";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { FIELD_OWNER, ROLE_LABEL, canEdit, lockReason };
}
