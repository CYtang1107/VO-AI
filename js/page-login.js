/* VO-AI | page-login.js — Stage 1: pick a role and sign in. */

(function () {
    let selectedRole = null;

    const grid = document.getElementById("roleGrid");
    const nameInput = document.getElementById("userName");
    const passcodeField = document.getElementById("passcodeField");
    const passcodeInput = document.getElementById("passcodeInput");
    const passcodePanel = document.getElementById("passcodePanel");

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

    /* ---------- device passcode panel ----------
       A personal, per-device convenience — distinct from the project
       passcode a Consultant QS sets on a project (see js/page-projects.js).
       This one locks VO-AI itself on this device at sign-in; it never
       sets, clears or checks a project's passcode, and vice versa. */

    /* mode: "idle" | "setting" | "clearing" */
    let panelMode = "idle";

    function renderPasscodePanel() {
        passcodeField.hidden = !hasPasscode();

        if (!passcodeSupported()) {
            passcodePanel.innerHTML =
                '<p class="passcode-note">' + escapeHtml(t("login.passcode.unavailable")) + "</p>";
            return;
        }

        if (panelMode === "setting") {
            passcodePanel.innerHTML =
                '<div class="passcode-form">' +
                    '<div class="field"><label for="newPasscode">' + escapeHtml(t("login.passcode.newLabel")) + '</label>' +
                        '<input type="password" id="newPasscode" autocomplete="new-password"></div>' +
                    '<div class="field"><label for="confirmPasscode">' + escapeHtml(t("login.passcode.confirmLabel")) + '</label>' +
                        '<input type="password" id="confirmPasscode" autocomplete="new-password"></div>' +
                    '<div class="passcode-actions">' +
                        '<button type="button" class="primary-button" id="savePasscodeBtn">' + escapeHtml(t("login.passcode.save")) + '</button>' +
                        '<button type="button" class="link-button" id="cancelPasscodeBtn">' + escapeHtml(t("login.passcode.cancel")) + '</button>' +
                    "</div>" +
                    '<p class="passcode-note">' + escapeHtml(t("login.passcode.honesty")) + "</p>" +
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
                    '<div class="field"><label for="currentPasscodeToClear">' + escapeHtml(t("login.passcode.currentLabel")) + '</label>' +
                        '<input type="password" id="currentPasscodeToClear" autocomplete="current-password"></div>' +
                    '<div class="passcode-actions">' +
                        '<button type="button" class="primary-button" id="confirmClearBtn">' + escapeHtml(t("login.passcode.clear")) + '</button>' +
                        '<button type="button" class="link-button" id="cancelClearBtn">' + escapeHtml(t("login.passcode.cancel")) + '</button>' +
                    "</div>" +
                    '<p class="passcode-note">' + escapeHtml(t("login.passcode.honesty")) + "</p>" +
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
                '<button type="button" class="link-button" id="clearPasscodeBtn">' + escapeHtml(t("login.passcode.clearThisDevice")) + '</button>' +
                '<p class="passcode-note">' + escapeHtml(t("login.passcode.honesty")) + "</p>";
            document.getElementById("clearPasscodeBtn").addEventListener("click", () => {
                panelMode = "clearing";
                renderPasscodePanel();
            });
        } else {
            passcodePanel.innerHTML =
                '<button type="button" class="link-button" id="setPasscodeBtn">' + escapeHtml(t("login.passcode.setForDevice")) + '</button>' +
                '<p class="passcode-note">' + escapeHtml(t("login.passcode.honesty")) + "</p>";
            document.getElementById("setPasscodeBtn").addEventListener("click", () => {
                panelMode = "setting";
                renderPasscodePanel();
            });
        }
    }

    async function onSavePasscode() {
        const a = document.getElementById("newPasscode").value;
        const b = document.getElementById("confirmPasscode").value;
        if (!a) { toast(t("toast.enterPasscode"), "warn"); return; }
        if (a !== b) { toast(t("toast.passcodesMismatch"), "warn"); return; }
        const ok = await setPasscode(a);
        if (!ok) {
            toast(t("toast.passcodeUnavailable"), "warn");
            return;
        }
        toast(t("toast.devicePasscodeSet"), "ok");
        panelMode = "idle";
        renderPasscodePanel();
    }

    async function onConfirmClear() {
        const current = document.getElementById("currentPasscodeToClear").value;
        const ok = await verifyPasscode(current);
        if (!ok) { toast(t("toast.passcodeWrong"), "error"); return; }
        clearPasscode();
        toast(t("toast.devicePasscodeCleared"), "ok");
        panelMode = "idle";
        renderPasscodePanel();
    }

    renderPasscodePanel();

    /* ---------- sign in ---------- */

    async function attemptSignIn() {
        const name = nameInput.value.trim();
        if (!name) { toast(t("toast.enterUserId"), "warn"); nameInput.focus(); return; }
        if (!selectedRole) { toast(t("toast.chooseRole"), "warn"); return; }

        if (hasPasscode()) {
            const ok = await verifyPasscode(passcodeInput.value);
            if (!ok) {
                toast(t("toast.wrongDevicePasscode"), "error");
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
