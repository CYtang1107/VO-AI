/* VO-AI | clauses.js
   Bundled contract clause knowledge base. The "contract clause analysis"
   function from the proposal is a lookup against this table — deterministic
   and auditable, not generated text. No dependencies. */

const CLAUSES = [
    {
        id: "pam-11-1",
        form: "PAM 2018",
        ref: "Clause 11.1",
        title: "Meaning of Variation",
        appliesTo: ["specification", "addition", "omission", "design"],
        entitlement:
            "A variation includes the alteration or modification of the design, quality " +
            "or quantity of the Works, including substitution of materials or goods. " +
            "Work instructed under this clause ranks for valuation.",
        evidence:
            "The written Architect's Instruction, the superseded and revised drawings, " +
            "and a measurement showing what was omitted and what was added."
    },
    {
        id: "pam-11-2",
        form: "PAM 2018",
        ref: "Clause 11.2",
        title: "Provisional and Approximate Quantities",
        appliesTo: ["quantity"],
        entitlement:
            "Where the quantity executed differs from the quantity in the Contract " +
            "Bills, the work is remeasured and valued at the Contract Bills rate. A " +
            "substantial change in quantity may justify a rate review.",
        evidence:
            "The remeasurement, site records supporting the measured quantity, and the " +
            "original Bills item for comparison."
    },
    {
        id: "pam-11-6",
        form: "PAM 2018",
        ref: "Clause 11.6",
        title: "Valuation of Variations",
        appliesTo: ["specification", "addition", "omission", "quantity", "design"],
        entitlement:
            "Work of similar character executed under similar conditions is valued at " +
            "the Contract Bills rates. Where the character or conditions differ, the " +
            "Contract Bills rates form the basis of a fair valuation. Where there is no " +
            "comparable rate, a fair market rate is agreed as a star rate.",
        evidence:
            "The relevant priced Bills of Quantities items, and for a star rate, a " +
            "supplier quotation or build-up showing labour, material and plant."
    },
    {
        id: "pam-23-8",
        form: "PAM 2018",
        ref: "Clause 23.8",
        title: "Extension of Time — Architect's Instruction",
        appliesTo: ["addition", "design", "specification"],
        entitlement:
            "Where a variation instruction delays completion, the Contractor may claim " +
            "an extension of time. The claim must be notified within the contractual " +
            "period and supported by a demonstration of critical-path impact.",
        evidence:
            "The notice of delay, the updated construction programme showing the " +
            "critical path before and after, and the date the instruction was received."
    },
    {
        id: "pwd-24",
        form: "PWD 203A",
        ref: "Clause 24",
        title: "Variations and Provisional Sums",
        appliesTo: ["specification", "addition", "omission", "quantity", "design"],
        entitlement:
            "The Superintending Officer may issue instructions varying the Works. " +
            "Such variations are measured and valued at Schedule of Rates prices where " +
            "the work is of similar character, and at agreed rates where it is not.",
        evidence:
            "The S.O. Instruction, the measured quantities, and the Schedule of Rates " +
            "item relied upon for each rate."
    },
];

function clausesFor(classification) {
    return CLAUSES.filter(c => c.appliesTo.includes(classification));
}

/* The governing clause is the first applicable one — the table is ordered
   most-specific first. Returns null rather than guessing. */
function matchClause(classification) {
    const list = clausesFor(classification);
    return list.length > 0 ? list[0] : null;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { CLAUSES, clausesFor, matchClause };
}
