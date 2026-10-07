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
    administrator: "Design Team",
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
    supportingDocs: "contractor",
    contractDocs: "contractor",
    measurement: "contractor",
    contractorRemark: "contractor",
    /* the contractor's reply to the consultant's request for information */
    infoResponse: "contractor",

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
    issuedInstruction: "administrator",
    /* the design team's documents for the instruction it approves */
    oldDrawing: "administrator",
    revisedDrawing: "administrator",
    designDocs: "administrator",

    /* client's columns */
    certifiedStatus: "client",
    finalPrice: "client",
    clientRemark: "client",
    clientInfoRequestedAt: "client",
    clientInfoRequestNote: "client"
};

/* ---------- the workflow ----------
   A VO moves through these stages, each worked by one role:
     describe        contractor: describes the change; the contract agent
                     (js/claimcheck.js) checks it is a variation
     design          design team: adds the original and revised drawings and
                     the supporting documents, then approves (issuing the
                     AI / EI) or rejects
     designRejected  contractor: revises the description and sends it again
     measure         contractor: measures, checks the rates against the BQ,
                     builds up new rates, then submits to the consultant QS
     consultant      consultant QS: checks the VO (and its photos), assesses
                     it, then submits it to the client, rejects it, or asks
                     for further information
     info            contractor: answers the consultant's request and sends it
                     back
     rejected        contractor: the consultant rejected it; correct and
                     submit again
     client          client: approves (certifies) or rejects
     done / closed   approved by the client / rejected by the client
   The stage is worked out from the VO's fields, never stored, so a VO
   saved by an older version still lands in the right stage. */
var VO_STAGES = ["describe", "design", "designRejected", "measure", "consultant", "info", "rejected", "client", "done", "closed"];

/* The consultant's request for information, as a key: the contractor's
   reply names the request it answers, so a new request needs a new reply. */
function infoRequestKey(vo) {
    return vo && vo.infoRequestedAt ? vo.infoRequestedAt + "|" + (vo.infoRequestNote || "") : null;
}

function infoAnswered(vo) {
    const key = infoRequestKey(vo);
    return !key || !!(vo.infoResponse && vo.infoResponse.forRequest === key);
}

function voStage(vo) {
    if (!vo) return "describe";
    if (vo.certifiedStatus === "Approved") return "done";
    if (vo.certifiedStatus === "Rejected") return "closed";
    if (vo.evaluateStatus === "Approved") return "client";
    if (vo.evaluateStatus === "Rejected") return "rejected";
    if (vo.submitted) {
        /* submitted under the earlier workflow, before the design team had
           confirmed the instruction */
        if (vo.instructionStatus === "Pending") return "design";
        if (vo.instructionStatus === "Returned") return "designRejected";
        return infoAnswered(vo) ? "consultant" : "info";
    }
    if (vo.instructionStatus === "Confirmed") return "measure";
    if (vo.sentToDesign) return "design";
    if (vo.instructionStatus === "Returned") return "designRejected";
    return "describe";
}

/* Which of a role's fields are open at which stage. */
var STAGE_FIELDS = {
    contractor: {
        describe: ["description", "contractorRemark", "dateIssued", "typeOfInstruction", "instructionNo", "supportingDocs"],
        designRejected: ["description", "contractorRemark", "dateIssued", "typeOfInstruction", "instructionNo", "supportingDocs"],
        measure: ["measurement", "supportingDocs", "contractorRemark"],
        rejected: ["measurement", "supportingDocs", "contractorRemark"],
        info: ["infoResponse", "supportingDocs", "measurement"]
    },
    administrator: {
        design: ["instructionStatus", "instructionNote", "issuedInstruction", "oldDrawing", "revisedDrawing", "designDocs"]
    },
    consultant: {
        consultant: ["dueDate", "assessment", "assessmentNote", "timeImpact", "evaluateStatus", "consultantRemark", "infoRequestedAt", "infoRequestNote"]
    },
    client: {
        client: ["certifiedStatus", "finalPrice", "clientRemark", "clientInfoRequestedAt", "clientInfoRequestNote"]
    }
};

/* Kept for the report and older callers: has the design team confirmed
   the instruction / (earlier workflow) certified the value? */
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

function canEdit(field, vo, role) {
    if (FIELD_OWNER[field] !== role) return false;
    const open = (STAGE_FIELDS[role] || {})[voStage(vo)] || [];
    return open.indexOf(field) !== -1;
}

/* A draft VO (not yet submitted) raised by mistake can be deleted by the
   contractor or the consultant; a submitted VO is part of the record and
   can only be rejected. Same rule as delete_vo in
   supabase/migrations/0002_delete_vo.sql. */
function canDeleteVO(vo, role) {
    const stage = voStage(vo);
    return !!vo && !vo.submitted && (stage === "describe" || stage === "designRejected") &&
        (role === "contractor" || role === "consultant");
}

function lockReason(field, vo, role) {
    if (canEdit(field, vo, role)) return "";

    const owner = FIELD_OWNER[field];
    if (!owner) return t("lock.calculated");
    if (owner !== role) {
        return t("lock.notOwner", { role: t("role." + owner + ".label", {}) });
    }
    /* whose turn it is now */
    return t("lock.stage." + voStage(vo));
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
    caCertifiedStatus: "vo.field.caCertifiedStatus", caRemark: "vo.field.caRemark",
    designDocs: "documents.field.designDocs", infoResponse: "vo.field.infoResponse",
    issuedInstruction: "instr.fieldLabel"
};

function fieldLabel(name) {
    const key = FIELD_LABEL_KEY[name];
    return key ? t(key) : name;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        VO_STAGES, voStage, infoRequestKey, infoAnswered, STAGE_FIELDS, canDeleteVO, instructionConfirmed, caCertified, FIELD_OWNER, ROLE_LABEL, canEdit, lockReason, FIELD_LABEL_KEY, fieldLabel };
}
