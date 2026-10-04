/* VO-AI | calc.js — money, dates and totals. No dependencies. */

function rm(value) {
    const n = Number(value) || 0;
    return "RM " + n.toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function today() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/* "14 Jul 2026" in English, "2026年7月14日" in Chinese. Formatted by hand
   rather than with toLocaleDateString, whose month abbreviations vary by
   browser (some write "Sept", others "Sep"). A bare date is read as the
   calendar date it names; a timestamp is shown in the viewer's local day. */
var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function prettyDate(iso) {
    if (!iso) return "—";
    let y, m, day;
    const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (bare) {
        y = +bare[1]; m = +bare[2]; day = +bare[3];
    } else {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        y = d.getFullYear(); m = d.getMonth() + 1; day = d.getDate();
    }
    if (typeof getLang === "function" && getLang() === "zh") return y + "年" + m + "月" + day + "日";
    return String(day).padStart(2, "0") + " " + MONTHS_SHORT[m - 1] + " " + y;
}

function lineTotal(qty, rate) {
    return (Number(qty) || 0) * (Number(rate) || 0);
}

/* Use the assessed figure when the consultant has entered one,
   otherwise fall back to what the contractor claimed. */
function assessedOr(row, key) {
    const assessed = row["assessed" + key[0].toUpperCase() + key.slice(1)];
    if (assessed === "" || assessed === null || assessed === undefined) {
        return Number(row[key]) || 0;
    }
    return Number(assessed) || 0;
}

function contractorTotal(vo) {
    return (vo.measurement || []).reduce(
        (sum, row) => sum + lineTotal(row.qty, row.rate), 0);
}

function assessedTotal(vo) {
    return (vo.measurement || []).reduce(
        (sum, row) => sum + assessedOr(row, "qty") * assessedOr(row, "rate"), 0);
}

function voValue(vo) {
    if (vo.certifiedStatus === "Approved" &&
        vo.finalPrice !== null && vo.finalPrice !== undefined && vo.finalPrice !== "") {
        return Number(vo.finalPrice) || 0;
    }
    return assessedTotal(vo);
}

function projectStats(project) {
    const vos = project.vos || [];
    const live = vos.filter(v => v.evaluateStatus !== "Draft");
    return {
        total: vos.length,
        draft: vos.filter(v => v.evaluateStatus === "Draft").length,
        pending: vos.filter(v =>
            v.evaluateStatus === "Pending" || v.evaluateStatus === "Under Review").length,
        approved: vos.filter(v => v.evaluateStatus === "Approved").length,
        rejected: vos.filter(v => v.evaluateStatus === "Rejected").length,
        certified: vos.filter(v => v.certifiedStatus === "Approved").length,
        value: live.reduce((s, v) => s + voValue(v), 0),
        timeImpact: live
            .filter(v => v.evaluateStatus === "Approved")
            .reduce((s, v) => s + (Number(v.timeImpact) || 0), 0)
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        rm, today, prettyDate, lineTotal,
        contractorTotal, assessedTotal, voValue, projectStats
    };
}
