/* VO-AI | page-login.js — Stage 1: pick a role and sign in. */

(function () {
    let selectedRole = null;

    const grid = document.getElementById("roleGrid");
    const nameInput = document.getElementById("userName");
    const passcodeField = document.getElementById("passcodeField");
    const passcodeInput = document.getElementById("passcodeInput");
    const passcodePanel = document.getElementById("passcodePanel");

    /* Suggested ids make the demo faster to walk through. */
    const SUGGESTED = {
        contractor: "ong.weihan",
        consultant: "serena.wong",
        client: "tan.ziqian"
    };

    const HONESTY_NOTE =
        "This passcode locks VO-AI on this device. It does not encrypt your project " +
        "data — anyone with access to this computer and browser can still read it. " +
        "Full user accounts are planned for the next version.";

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

    /* ---------- passcode panel ---------- */

    /* mode: "idle" | "setting" | "clearing" */
    let panelMode = "idle";

    function renderPasscodePanel() {
        passcodeField.hidden = !hasPasscode();

        if (!passcodeSupported()) {
            passcodePanel.innerHTML =
                '<p class="passcode-note">' +
                    "A device passcode is not available in this browser (it needs a secure " +
                    "connection). Sign-in works as normal without one." +
                "</p>";
            return;
        }

        if (panelMode === "setting") {
            passcodePanel.innerHTML =
                '<div class="passcode-form">' +
                    '<div class="field"><label for="newPasscode">New passcode</label>' +
                        '<input type="password" id="newPasscode" autocomplete="new-password"></div>' +
                    '<div class="field"><label for="confirmPasscode">Confirm passcode</label>' +
                        '<input type="password" id="confirmPasscode" autocomplete="new-password"></div>' +
                    '<div class="passcode-actions">' +
                        '<button type="button" class="primary-button" id="savePasscodeBtn">Save passcode</button>' +
                        '<button type="button" class="link-button" id="cancelPasscodeBtn">Cancel</button>' +
                    "</div>" +
                    '<p class="passcode-note">' + HONESTY_NOTE + "</p>" +
                "</div>";
            document.getElementById("savePasscodeBtn").addEventListener("click", onSavePasscode);
            document.getElementById("cancelPasscodeBtn").addEventListener("click", () => {
                panelMode = "idle";
                renderPasscodePanel();
            });
            return;
        }

        if (panelMode === "clearing") {
            passcodePanel.innerHTML =
                '<div class="passcode-form">' +
                    '<div class="field"><label for="currentPasscodeToClear">Current passcode</label>' +
                        '<input type="password" id="currentPasscodeToClear" autocomplete="current-password"></div>' +
                    '<div class="passcode-actions">' +
                        '<button type="button" class="primary-button" id="confirmClearBtn">Clear passcode</button>' +
                        '<button type="button" class="link-button" id="cancelClearBtn">Cancel</button>' +
                    "</div>" +
                    '<p class="passcode-note">' + HONESTY_NOTE + "</p>" +
                "</div>";
            document.getElementById("confirmClearBtn").addEventListener("click", onConfirmClear);
            document.getElementById("cancelClearBtn").addEventListener("click", () => {
                panelMode = "idle";
                renderPasscodePanel();
            });
            return;
        }

        /* idle */
        if (hasPasscode()) {
            passcodePanel.innerHTML =
                '<button type="button" class="link-button" id="clearPasscodeBtn">Clear this device\'s passcode</button>' +
                '<p class="passcode-note">' + HONESTY_NOTE + "</p>";
            document.getElementById("clearPasscodeBtn").addEventListener("click", () => {
                panelMode = "clearing";
                renderPasscodePanel();
            });
        } else {
            passcodePanel.innerHTML =
                '<button type="button" class="link-button" id="setPasscodeBtn">Set a passcode for this device</button>' +
                '<p class="passcode-note">' + HONESTY_NOTE + "</p>";
            document.getElementById("setPasscodeBtn").addEventListener("click", () => {
                panelMode = "setting";
                renderPasscodePanel();
            });
        }
    }

    async function onSavePasscode() {
        const a = document.getElementById("newPasscode").value;
        const b = document.getElementById("confirmPasscode").value;
        if (!a) { toast("Enter a passcode.", "warn"); return; }
        if (a !== b) { toast("Passcodes do not match.", "warn"); return; }
        const ok = await setPasscode(a);
        if (!ok) {
            toast("A device passcode is not available in this browser.", "warn");
            return;
        }
        toast("Passcode set for this device.", "ok");
        panelMode = "idle";
        renderPasscodePanel();
    }

    async function onConfirmClear() {
        const current = document.getElementById("currentPasscodeToClear").value;
        const ok = await verifyPasscode(current);
        if (!ok) { toast("That passcode is wrong.", "error"); return; }
        clearPasscode();
        toast("Passcode cleared for this device.", "ok");
        panelMode = "idle";
        renderPasscodePanel();
    }

    renderPasscodePanel();

    /* ---------- sign in ---------- */

    async function attemptSignIn() {
        const name = nameInput.value.trim();
        if (!name) { toast("Enter your user ID to continue.", "warn"); nameInput.focus(); return; }
        if (!selectedRole) { toast("Choose the role you are acting as.", "warn"); return; }

        if (hasPasscode()) {
            const ok = await verifyPasscode(passcodeInput.value);
            if (!ok) {
                toast("Wrong device passcode.", "error");
                passcodeInput.focus();
                return;
            }
        }

        setSession({ name: name, role: selectedRole, projectId: null });
        window.location.href = "projects.html";
    }

    document.getElementById("signInBtn").addEventListener("click", () => { attemptSignIn(); });

    /* Enter submits. */
    nameInput.addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("signInBtn").click();
    });
    passcodeInput.addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("signInBtn").click();
    });
})();
