/* VO-AI | page-documents.js — every document in the project, in one place.
   Read-only: this screen never uploads or deletes. The contractor still
   attaches documents from the VO detail page (js/page-vo.js), where the
   contractual ownership rules live — nothing here duplicates them.
   Records file METADATA only (name, size, uploader, date) — there is
   nothing to open or download. */

if (typeof require !== "undefined" && typeof module !== "undefined") {
    var { prettyDate } = require("./calc.js");
    var { escapeHtml } = require("./ui.js");
    var { versionCount } = require("./documents.js");
    var { t, getLang } = require("./i18n.js");
}

/* The three VO-level document fields, in the order they appear on the VO
   detail page, each with the label this screen shows (labelKey — see
   js/i18n.js) and the filter bucket ("drawings" or "supporting") it
   belongs to. */
var VO_DOC_FIELDS = [
    { field: "revisedDrawing", label: "Revised drawing",    labelKey: "documents.field.revisedDrawing", bucket: "drawings" },
    { field: "oldDrawing",     label: "Superseded drawing", labelKey: "documents.field.oldDrawing",      bucket: "drawings" },
    { field: "supportingDocs", label: "Supporting document", labelKey: "documents.field.supportingDocs", bucket: "supporting" }
];

var PROJECT_CATEGORY_KEY = {
    contract: "documents.category.contract",
    bq: "documents.category.bq"
};

/* bytes -> a human-readable size: bytes under 1KB, KB under 1MB, MB
   beyond that. Never throws on 0 or a missing/undefined size. */
function formatSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/* Flatten every document in the project — project-level and VO-level —
   into one normalised list. Each entry carries where it came from
   (`source`: "project" or "vo") and what kind of document it is, plus
   enough VO context to group and link back to it. Never throws on a
   project with no documents at all. */
function collectDocuments(project) {
    var list = [];

    ((project && project.documents) || []).forEach(function (d) {
        list.push({
            id: d.id, name: d.name, size: d.size || 0,
            uploadedBy: d.uploadedBy, at: d.at,
            source: "project", kind: "project",
            category: d.category || "other",
            voId: null, voNo: null, voDescription: null,
            revisionCount: 0
        });
    });

    ((project && project.vos) || []).forEach(function (vo) {
        VO_DOC_FIELDS.forEach(function (f) {
            (vo[f.field] || []).forEach(function (d) {
                list.push({
                    id: d.id, name: d.name, size: d.size || 0,
                    uploadedBy: d.uploadedBy, at: d.at,
                    source: "vo", kind: f.field, bucket: f.bucket,
                    voId: vo.id, voNo: vo.no, voDescription: vo.description,
                    revisionCount: versionCount(d) - 1,
                    revisions: d.revisions || []
                });
            });
        });
    });

    return list;
}

/* filters: { kind: "all" | "drawings" | "supporting" | "project",
              voId: "all" | <vo id> } */
function filterDocuments(list, filters) {
    var f = filters || {};
    return (list || []).filter(function (d) {
        if (f.kind && f.kind !== "all") {
            if (f.kind === "project" && d.source !== "project") return false;
            if (f.kind !== "project" && d.source !== "vo") return false;
            if ((f.kind === "drawings" || f.kind === "supporting") && d.bucket !== f.kind) return false;
        }
        if (f.voId && f.voId !== "all" && d.voId !== f.voId) return false;
        return true;
    });
}

function byNewest(a, b) {
    if (a.at === b.at) return 0;
    return a.at < b.at ? 1 : -1;
}

function renderRevisions(doc) {
    var revs = doc.revisions || [];
    if (revs.length === 0) return "";
    return '<ul class="doc-revisions">' + revs.slice().reverse().map(function (r) {
        return '<li class="doc-revision"><span class="file-name">' + escapeHtml(r.name) + "</span>" +
            '<span class="file-date">' + escapeHtml(prettyDate(r.at)) + " · " +
            escapeHtml(r.uploadedBy) + "</span></li>";
    }).join("") + "</ul>";
}

function renderDocEntry(d) {
    return '<li class="file-item doc-registry-item">' +
        '<div class="doc-current">' +
            '<span class="file-name">' + escapeHtml(d.name) + "</span>" +
            '<span class="file-date">' + escapeHtml(prettyDate(d.at)) + " · " +
                escapeHtml(d.uploadedBy || "—") + "</span>" +
            (d.revisionCount > 0
                ? '<span class="doc-version-count">' + escapeHtml(t("documents.versionsOnRecord", { n: d.revisionCount + 1 })) + "</span>"
                : "") +
        "</div>" +
        renderRevisions(d) +
    "</li>";
}

function renderProjectDocList(docs) {
    if (docs.length === 0) {
        return '<div class="empty-state">' + escapeHtml(t("documents.empty.project")) + '</div>';
    }
    return '<ul class="doc-list">' + docs.map(function (d) {
        var label = t(PROJECT_CATEGORY_KEY[d.category] || "documents.category.other");
        return '<li class="file-item doc-registry-item">' +
            '<div class="doc-current">' +
                '<span class="doc-category-tag">' + escapeHtml(label) + "</span>" +
                '<span class="file-name">' + escapeHtml(d.name) + "</span>" +
                '<span class="file-date">' + escapeHtml(prettyDate(d.at)) + " · " +
                    escapeHtml(d.uploadedBy || "—") + "</span>" +
            "</div>" +
        "</li>";
    }).join("") + "</ul>";
}

var VO_FIELD_LABEL = {};
VO_DOC_FIELDS.forEach(function (f) { VO_FIELD_LABEL[f.field] = f.label; });

function renderVoGroup(voId, voNo, voDescription, docs) {
    var byKind = {};
    docs.forEach(function (d) {
        byKind[d.kind] = byKind[d.kind] || [];
        byKind[d.kind].push(d);
    });

    var kindsHtml = VO_DOC_FIELDS.map(function (f) {
        var kindDocs = (byKind[f.field] || []).slice().sort(byNewest);
        if (kindDocs.length === 0) return "";
        return '<div class="doc-kind-group">' +
            '<h4 class="doc-kind-label">' + escapeHtml(t(f.labelKey)) +
                (typeof getLang === "function" && getLang() === "zh" ? "" : "s") +
                ' (' + kindDocs.length + ')</h4>' +
            '<ul class="doc-list">' + kindDocs.map(renderDocEntry).join("") + "</ul>" +
        "</div>";
    }).join("");

    return '<div class="doc-group doc-group-vo">' +
        '<div class="doc-group-head doc-group-head-link" data-vo-id="' + escapeHtml(voId) + '">' +
            '<h3>' + escapeHtml(voNo || "VO") + " — " +
                escapeHtml(voDescription || t("documents.untitled")) + "</h3>" +
            '<span class="doc-group-goto">' + escapeHtml(t("documents.openVo")) + '</span>' +
        "</div>" +
        kindsHtml +
    "</div>";
}

/* The whole read-only Documents screen, as one HTML string: the project
   documents section, then every VO with a matching document, each
   grouped by kind. Empty states are explicit for the project section (it
   is always shown) and implicit for VOs (a VO with nothing to show is
   simply not listed — never an empty box). */
function renderDocumentGroups(list, filters) {
    var filtered = filterDocuments(list, filters);
    var f = filters || {};

    if (filtered.length === 0) {
        return '<div class="empty-state">' + escapeHtml(t("documents.empty.filtered")) + '</div>';
    }

    var showProject = !f.kind || f.kind === "all" || f.kind === "project";
    var showVo = !f.kind || f.kind === "all" || f.kind === "drawings" || f.kind === "supporting";

    var html = "";

    if (showProject) {
        var projectDocs = filtered.filter(function (d) { return d.source === "project"; }).sort(byNewest);
        html += '<div class="doc-group doc-group-project">' +
            '<div class="doc-group-head"><h3>' + escapeHtml(t("documents.projectDocs")) + '</h3></div>' +
            renderProjectDocList(projectDocs) +
        "</div>";
    }

    if (showVo) {
        var voDocs = filtered.filter(function (d) { return d.source === "vo"; });
        var voIds = [];
        voDocs.forEach(function (d) { if (voIds.indexOf(d.voId) === -1) voIds.push(d.voId); });

        var voGroupsHtml = voIds.map(function (id) {
            var docsForVo = voDocs.filter(function (d) { return d.voId === id; });
            var first = docsForVo[0];
            return renderVoGroup(id, first.voNo, first.voDescription, docsForVo);
        }).join("");

        if (voIds.length === 0 && !showProject) {
            voGroupsHtml = '<div class="empty-state">' + escapeHtml(t("documents.empty.voFiltered")) + '</div>';
        }

        html += voGroupsHtml;
    }

    return html;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        formatSize, collectDocuments, filterDocuments, renderDocumentGroups,
        VO_DOC_FIELDS
    };
}

if (typeof document !== "undefined") {
    (function () {
        const ctx = mountChrome("documents", t("nav.documents"), t("crumb.documents"));
        if (!ctx) return;
        const { project } = ctx;

        const list = collectDocuments(project);
        const totalSize = list.reduce((sum, d) => sum + (d.size || 0), 0);

        document.getElementById("docSummary").innerHTML =
            t("documents.summary", {
                count: list.length,
                plural: list.length === 1 ? "" : "s",
                size: formatSize(totalSize)
            }) +
            '<span class="doc-metadata-note">' + escapeHtml(t("documents.summaryNote")) + "</span>";

        const voOptions = ((project.vos) || []).map(v =>
            '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.no) + "</option>").join("");
        document.getElementById("voFilter").innerHTML =
            '<option value="all">' + escapeHtml(t("documents.allVos")) + '</option>' + voOptions;

        function draw() {
            const filters = {
                kind: document.getElementById("kindFilter").value,
                voId: document.getElementById("voFilter").value
            };
            document.getElementById("docGroups").innerHTML = renderDocumentGroups(list, filters);
        }

        document.getElementById("kindFilter").addEventListener("change", draw);
        document.getElementById("voFilter").addEventListener("change", draw);

        document.getElementById("docGroups").addEventListener("click", e => {
            const head = e.target.closest(".doc-group-head-link");
            if (!head) return;
            window.location.href = "vo.html?id=" + encodeURIComponent(head.dataset.voId);
        });

        draw();
    })();
}
