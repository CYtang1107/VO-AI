/* VO-AI | permissions.js
   The template's "each role can only edit the yellow things" rule,
   in exactly one place. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { t } = require("./i18n.js");
}

/* Kept as plain English — a handful of call sites outside the browser
   render path (and any future non-i18n consumer) still want a raw
   label. Display code should prefer t("role.<id>.label") via
   js/i18n.js so it follows the current language; this map is the
   English source of truth those keys are built from. */
const ROLE_LABEL = {
    contractor: "Contractor QS",
    consultant: "Consultant QS",
    client: "Client / Developer"
};

/* `var`, not `const`: js/page-register.js re-declares this name in a parse-time-hoisted
   guarded `var` for its Node import. `const` here would be a SyntaxError in the
   browser, where both files share one global scope. */
var FIELD_OWNER = {
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
    infoRequestedAt: "consultant",
    infoRequestNote: "consultant",

    /* client's columns */
    certifiedStatus: "client",
    finalPrice: "client",
    clientRemark: "client",
    clientInfoRequestedAt: "client",
    clientInfoRequestNote: "client"
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
    if (!owner) return t("lock.calculated");
    if (owner !== role) {
        return t("lock.notOwner", { role: t("role." + owner + ".label", {}) });
    }
    if (role === "contractor") {
        return t("lock.contractorLocked");
    }
    if (role === "consultant") {
        return t("lock.consultantLocked");
    }
    return t("lock.clientLocked");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { FIELD_OWNER, ROLE_LABEL, canEdit, lockReason };
}
