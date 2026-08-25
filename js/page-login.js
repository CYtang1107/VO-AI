/* VO-AI | page-login.js — Stage 1: pick a role and sign in. */

(function () {
    let selectedRole = null;

    const grid = document.getElementById("roleGrid");
    const nameInput = document.getElementById("userName");

    /* Every static [data-i18n*] element on the sign-in page (there is no
       sidebar/topbar here, so no mountChrome to do this for us), and the
       language switch itself — must be usable BEFORE sign-in, so a
       Chinese-speaking judge can switch language first. */
    applyI18n(document);
    const langSwitchHost = document.getElementById("langSwitchLogin");
    if (langSwitchHost) {
        langSwitchHost.innerHTML = renderLangSwitch();
        wireLangSwitch(langSwitchHost);
    }

    /* Suggested ids make the demo faster to walk through. */
    const SUGGESTED = {
        contractor: "ong.weihan",
        consultant: "serena.wong",
        client: "tan.ziqian"
    };

    grid.innerHTML = Object.values(ROLES).map(r =>
        '<button type="button" class="role-option" data-role="' + r.id + '">' +
            '<div class="role-icon" style="background:' + r.colour + '">' + r.icon + "</div>" +
            "<strong>" + escapeHtml(t("role." + r.id + ".label", {})) + "</strong>" +
            "<span>" + escapeHtml(t("role." + r.id + ".blurb", {})) + "</span>" +
        "</button>"
    ).join("");

    grid.addEventListener("click", e => {
        const btn = e.target.closest(".role-option");
        if (!btn) return;
        selectedRole = btn.dataset.role;
        grid.querySelectorAll(".role-option")
            .forEach(b => b.classList.toggle("selected", b === btn));
        if (!nameInput.value.trim()) nameInput.value = SUGGESTED[selectedRole] || "";
    });

    /* ---------- sign in ----------
       No passcode gate here any more — that control now protects
       OPENING A PROJECT (see js/page-projects.js), not the front door,
       so a competition judge (or anyone) reaches the role picker
       immediately. */

    function attemptSignIn() {
        const name = nameInput.value.trim();
        if (!name) { toast(t("toast.enterUserId"), "warn"); nameInput.focus(); return; }
        if (!selectedRole) { toast(t("toast.chooseRole"), "warn"); return; }

        setSession({ name: name, role: selectedRole, projectId: null });
        window.location.href = "projects.html";
    }

    document.getElementById("signInBtn").addEventListener("click", () => { attemptSignIn(); });

    /* Enter submits. */
    nameInput.addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("signInBtn").click();
    });
})();
