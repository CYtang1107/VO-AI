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
    administrator: "Contract Administrator",
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
    contractDocs: "contractor",
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

    /* contract administrator's columns (the Architect, Engineer or SO
       named in the contract): confirms the instruction behind a submitted
       VO, then certifies the value the consultant QS approved */
    instructionStatus: "administrator",
    instructionNote: "administrator",
    caCertifiedStatus: "administrator",
    caRemark: "administrator",

    /* client's columns */
    certifiedStatus: "client",
    finalPrice: "client",
    clientRemark: "client",
    clientInfoRequestedAt: "client",
    clientInfoRequestNote: "client"
};

/* The four steps of a variation under the contract (PAM 2018 cl. 11,
   PWD 203A cl. 24): the contractor submits; the contract administrator
   confirms it rests on a valid instruction; the consultant QS values it;
   the contract administrator certifies the value; the client approves.
   A VO saved before the contract administrator role existed has neither
   field: a submitted one counts as confirmed, an approved one as
   certified, so nothing that already moved on is held back. */
function instructionConfirmed(vo) {
    if (!vo) return false;
    if (vo.instructionStatus === undefined || vo.instructionStatus === null) return vo.submitted === true;
    return vo.instructionStatus === "Confirmed";
}

function caCertified(vo) {
    if (!vo) return false;
    if (vo.caCertifiedStatus === undefined || vo.caCertifiedStatus === null) return vo.evaluateStatus === "Approved";
    return vo.caCertifiedStatus === "Certified";
}

var CA_INSTRUCTION_FIELDS = ["instructionStatus", "instructionNote"];

function canEdit(field, vo, role) {
    if (FIELD_OWNER[field] !== role) return false;

    if (role === "contractor") {
        return vo.evaluateStatus === "Draft" ||
               vo.evaluateStatus === "Pending" ||
               vo.evaluateStatus === "Rejected";
    }
    if (role === "administrator") {
        /* confirms the instruction once submitted; certifies once the
           consultant QS has approved the value */
        return CA_INSTRUCTION_FIELDS.indexOf(field) !== -1
            ? vo.submitted === true
            : vo.evaluateStatus === "Approved";
    }
    if (role === "consultant") {
        return vo.submitted === true && instructionConfirmed(vo);
    }
    if (role === "client") {
        return vo.evaluateStatus === "Approved" && caCertified(vo);
    }
    return false;
}

/* A draft VO (not yet submitted) raised by mistake can be deleted by the
   contractor or the consultant; a submitted VO is part of the record and
   can only be rejected. Same rule as delete_vo in
   supabase/migrations/0002_delete_vo.sql. */
function canDeleteVO(vo, role) {
    return !!vo && !vo.submitted && (role === "contractor" || role === "consultant");
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
        return vo.submitted && !instructionConfirmed(vo) ? t("lock.consultantAwaitingCa") : t("lock.consultantLocked");
    }
    if (role === "administrator") {
        return t("lock.administratorLocked");
    }
    return vo.evaluateStatus === "Approved" && !caCertified(vo) ? t("lock.clientAwaitingCa") : t("lock.clientLocked");
}

/* Each column's display name (a js/i18n.js key), for anything that names
   a field to the user: the VO activity log and the assistant's
   "what can I edit" answer. */
var FIELD_LABEL_KEY = {
    description: "vo.field.description", dateIssued: "vo.field.dateIssued",
    typeOfInstruction: "vo.field.typeOfInstruction", instructionNo: "vo.field.instructionNo",
    contractorRemark: "vo.field.contractorRemark",
    revisedDrawing: "documents.field.revisedDrawing", oldDrawing: "documents.field.oldDrawing",
    supportingDocs: "documents.field.supportingDocs", contractDocs: "documents.field.contractDocs",
    dueDate: "vo.field.dueDate", assessmentNote: "vo.field.assessmentNote",
    timeImpact: "vo.field.timeImpact", evaluateStatus: "vo.field.evaluateStatus",
    consultantRemark: "vo.field.consultantRemark", certifiedStatus: "vo.field.certifiedStatus",
    finalPrice: "vo.field.finalPrice", clientRemark: "vo.field.clientRemark",
    measurement: "vo.field.measurement", infoRequestedAt: "vo.field.infoRequestedAt",
    clientInfoRequestedAt: "vo.field.clientInfoRequestedAt",
    assessment: "vo.field.assessedMeasurement",
    instructionStatus: "vo.field.instructionStatus", instructionNote: "vo.field.instructionNote",
    caCertifiedStatus: "vo.field.caCertifiedStatus", caRemark: "vo.field.caRemark"
};

function fieldLabel(name) {
    const key = FIELD_LABEL_KEY[name];
    return key ? t(key) : name;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        canDeleteVO, instructionConfirmed, caCertified, FIELD_OWNER, ROLE_LABEL, canEdit, lockReason, FIELD_LABEL_KEY, fieldLabel };
}
