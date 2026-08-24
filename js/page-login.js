/* VO-AI | page-login.js — Stage 1: pick a role and sign in. */

(function () {
    let selectedRole = null;

    const grid = document.getElementById("roleGrid");
    const nameInput = document.getElementById("userName");

    /* Suggested ids make the demo faster to walk through. */
    const SUGGESTED = {
        contractor: "ong.weihan",
        consultant: "serena.wong",
        client: "tan.ziqian"
    };

    grid.innerHTML = Object.values(ROLES).map(r =>
        '<button type="button" class="role-option" data-role="' + r.id + '">' +
            '<div class="role-icon" style="background:' + r.colour + '">' + r.icon + "</div>" +
            "<strong>" + r.label + "</strong>" +
            "<span>" + r.blurb + "</span>" +
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

    document.getElementById("signInBtn").addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) { toast("Enter your user ID to continue.", "warn"); nameInput.focus(); return; }
        if (!selectedRole) { toast("Choose the role you are acting as.", "warn"); return; }

        setSession({ name: name, role: selectedRole, projectId: null });
        window.location.href = "projects.html";
    });

    /* Enter submits. */
    nameInput.addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("signInBtn").click();
    });
})();
