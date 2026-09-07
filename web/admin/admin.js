import { supabase } from "../supabase.js";

/* =========================================================
   UHAS ASOGLI HALL ROOM ALLOCATION
   ADMIN PORTAL - PRODUCTION JAVASCRIPT
   ========================================================= */

let currentUser = null;
let currentProfile = null;

let isInitialising = false;
let authStateInitialised = false;
let applicationInitialised = false;

let searchTimer = null;
let unallocatedSearchTimer = null;
let autoRefreshTimer = null;
let realtimeChannel = null;

let adminManagementInitialised = false;

/* =========================================================
   DOM HELPERS
   ========================================================= */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function setText(selector, value) {
    const element = $(selector);
    if (!element) return;
    element.textContent = value === null || value === undefined ? "" : String(value);
}

function showElement(selector) {
    const element = $(selector);
    if (!element) return;
    element.hidden = false;
    element.style.display = "";
}

function hideElement(selector) {
    const element = $(selector);
    if (!element) return;
    element.hidden = true;
    element.style.display = "none";
}

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
}

function normalise(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function csvEscape(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

/* =========================================================
   TOASTS & UI HELPERS
   ========================================================= */

function showToast(message, type = "success") {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message || "";
    toast.className = `toast ${type}`;
    toast.classList.add("show");

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}

function setButtonLoading(button, loading, loadingText = "Processing...") {
    if (!button) return;
    if (loading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }
        button.disabled = true;
        button.textContent = loadingText;
        return;
    }
    button.disabled = false;
    if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
    }
}

/* =========================================================
   AUTHENTICATION & PROFILES
   ========================================================= */

async function loadCurrentProfile() {
    currentProfile = null;
    if (!currentUser?.id) return null;

    try {
        const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", currentUser.id)
            .maybeSingle();

        if (error) {
            console.warn("Admin profile lookup failed:", error);
            currentProfile = null;
            return null;
        }

        currentProfile = data || null;
        return currentProfile;
    } catch (error) {
        console.warn("Unable to load admin profile:", error);
        currentProfile = null;
        return null;
    }
}

function getUserRole() {
    const profileRole =
        currentProfile?.role ||
        currentProfile?.user_role ||
        currentProfile?.admin_role ||
        currentProfile?.access_level ||
        currentProfile?.account_role;

    if (profileRole) return profileRole;

    const metadata = currentUser?.user_metadata || {};
    return metadata.role || metadata.user_role || metadata.admin_role || metadata.access_level || null;
}

function isSuperAdmin() {
    const role = normalise(getUserRole());
    if (role === "super_admin" || role === "superadmin" || role === "super_admin_role") {
        return true;
    }

    const roleElements = ["#adminRole", "#mobileAdminRole", "#sidebarAdminRole"];
    return roleElements.some((selector) => {
        const element = $(selector);
        if (!element) return false;
        const text = normalise(element.textContent);
        return text === "super_admin" || text === "superadmin" || text.includes("super_admin") || text.includes("super admin");
    });
}

function updateRoleDisplay() {
    const superAdmin = isSuperAdmin();
    const displayRole = superAdmin ? "SUPER ADMIN" : "ADMIN";

    setText("#adminRole", displayRole);
    setText("#mobileAdminRole", displayRole);
    setText("#sidebarAdminRole", displayRole);

    const managementNav = $("#administratorsNavItem");
    const managementSection = $("#adminManagementSection");

    if (superAdmin) {
        if (managementNav) { managementNav.style.display = ""; managementNav.hidden = false; }
    } else {
        if (managementNav) { managementNav.style.display = "none"; managementNav.hidden = true; }
        if (managementSection) { managementSection.style.display = "none"; managementSection.hidden = true; }
    }
}

/* =========================================================
   LOGIN & LOGOUT
   ========================================================= */

async function handleLogin(event) {
    if (event) event.preventDefault();
    if (isInitialising) return;

    const emailInput = $("#loginEmail") || $("#email");
    const passwordInput = $("#loginPassword") || $("#password");

    const email = emailInput?.value?.trim();
    const password = passwordInput?.value || "";

    if (!email || !password) {
        showToast("Please enter your email and password.", "error");
        return;
    }

    const loginButton = $("#loginButton") || $("#loginForm button[type='submit']");

    try {
        isInitialising = true;
        if (loginButton) loginButton.disabled = true;

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        if (!data?.user) {
            throw new Error("Login succeeded but no authenticated user was returned.");
        }

        currentUser = data.user;
        await loadCurrentProfile();

        showApp();
        updateRoleDisplay();

        authStateInitialised = true;
        applicationInitialised = true;

        try {
            await initialiseAdminManagement();
        } catch (error) {
            console.error("Admin management initialisation failed:", error);
        }

        try {
            await loadEverything();
            setupRealtimeSubscriptions();
            startAutoRefresh();
        } catch (error) {
            console.error("Dashboard loading failed:", error);
            showToast("Some dashboard data could not be loaded.", "error");
        }

        activateSection("dashboardSection");
        showToast("Login successful.", "success");

    } catch (error) {
        console.error("Login error:", error);
        showToast(error?.message || "Unable to sign in.", "error");
        showLogin();
    } finally {
        isInitialising = false;
        if (loginButton) loginButton.disabled = false;
    }
}

async function handleLogout() {
    try {
        stopAutoRefresh();
        teardownRealtimeSubscriptions();
        await supabase.auth.signOut();
    } catch (error) {
        console.error("Logout error:", error);
    }

    currentUser = null;
    currentProfile = null;
    authStateInitialised = false;
    applicationInitialised = false;
    adminManagementInitialised = false;

    showLogin();
}

function showLogin() {
    const loginView = $("#loginView");
    const appView = $("#appView");
    if (loginView) { loginView.style.display = ""; loginView.hidden = false; }
    if (appView) { appView.style.display = "none"; appView.hidden = true; appView.classList.add("hidden"); }
}

function showApp() {
    const loginView = $("#loginView");
    const appView = $("#appView");
    if (loginView) { loginView.style.display = "none"; loginView.hidden = true; }
    if (appView) { appView.style.display = ""; appView.hidden = false; appView.classList.remove("hidden"); }
}

async function handlePasswordReset(event) {
    event.preventDefault();
    const email = $("#email")?.value.trim() || $("#loginEmail")?.value.trim();

    if (!email) {
        showToast("Enter your administrator email address first.", "error");
        return;
    }

    try {
        const redirectUrl = `${window.location.origin}${window.location.pathname}`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
        if (error) throw error;
        showToast("Password reset instructions have been sent to your email.");
    } catch (error) {
        console.error("Password reset error:", error);
        showToast(error?.message || "Unable to send password reset email.", "error");
    }
}

/* =========================================================
   RPC HELPER
   ========================================================= */

async function callRpc(functionName, params = {}) {
    if (!functionName) throw new Error("RPC function name is missing.");

    try {
        const { data, error } = await supabase.rpc(functionName, params);
        if (error) {
            console.error(`RPC ${functionName} failed:`, error);
            throw error;
        }
        return data;
    } catch (error) {
        console.error(`RPC ${functionName} exception:`, error);
        throw error;
    }
}

/* =========================================================
   DASHBOARD
   ========================================================= */

async function loadDashboard() {
    try {
        const data = await callRpc("admin_dashboard_summary");
        const summary = Array.isArray(data) ? data[0] || {} : data || {};

        setText("#totalRooms", summary.total_rooms ?? 0);
        setText("#totalBeds", summary.total_beds ?? 0);
        setText("#occupiedBeds", summary.occupied_beds ?? 0);
        setText("#availableBeds", summary.available_beds ?? 0);
        setText("#activeHolds", summary.active_holds ?? 0);
        setText("#activeAllocations", summary.active_allocations ?? 0);
        setText("#unallocatedStudents", summary.unallocated_students ?? 0);

        const totalBeds = Number(summary.total_beds || 0);
        const occupiedBeds = Number(summary.occupied_beds || 0);
        const percentage = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

        setText("#allocationStatus", `${percentage}% Allocated`);
        setText("#lastUpdated", formatDate(new Date()));

    } catch (error) {
        console.error("Dashboard load error:", error);
        ["#totalRooms", "#totalBeds", "#occupiedBeds", "#availableBeds", "#activeHolds", "#activeAllocations", "#unallocatedStudents"].forEach((selector) => {
            setText(selector, "—");
        });
        setText("#allocationStatus", "Unavailable");
    }
}

/* =========================================================
   ROOMS
   ========================================================= */

async function loadRooms() {
    const grid = $("#roomsGrid");
    if (!grid) return;

    const block = $("#blockFilter")?.value || "";
    grid.innerHTML = `<div class="loading-state">Loading rooms...</div>`;

    try {
        const data = await callRpc("admin_rooms", { p_block: block || null });
        const rooms = Array.isArray(data) ? data : [];

        if (!rooms.length) {
            grid.innerHTML = `<div class="empty-state">No rooms found.</div>`;
            return;
        }

        grid.innerHTML = rooms.map(renderRoomCard).join("");
    } catch (error) {
        console.error("Rooms load error:", error);
        grid.innerHTML = `<div class="error-state">Unable to load rooms.</div>`;
    }
}

function renderRoomCard(room) {
    const capacity = Number(room.capacity || 0);
    const occupied = Number(room.occupied_beds ?? room.occupied ?? room.occupied_count ?? 0);
    const available = Math.max(capacity - occupied, 0);

    let status = "available";
    if (room.temporarily_locked) {
        status = "locked";
    } else if (available === 0 && capacity > 0) {
        status = "full";
    } else if (occupied > 0) {
        status = "partial";
    }

    const gender = room.gender || room.gender_rule || "Mixed";

    return `
        <button type="button" class="room-card ${escapeHtml(status)}" data-room-id="${escapeHtml(room.id || "")}">
            <div class="room-card-top">
                <span class="room-code">${escapeHtml(room.room_code || room.room_number || "Room")}</span>
                <span class="room-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
            </div>
            <div class="room-card-body">
                <div class="room-number">${escapeHtml(room.room_number || room.room_code || "—")}</div>
                <div class="room-meta">
                    <span>${escapeHtml(room.block || "—")}</span>
                    <span>Floor ${escapeHtml(room.floor ?? "—")}</span>
                </div>
                <div class="room-capacity">
                    <strong>${occupied}</strong><span>occupied</span>
                    <strong>${available}</strong><span>available</span>
                    <strong>${capacity}</strong><span>capacity</span>
                </div>
                <div class="room-gender">${escapeHtml(gender)}</div>
            </div>
        </button>
    `;
}

/* =========================================================
   ROOM MODAL (CLICK ROOM -> VIEW OCCUPANTS)
   ========================================================= */

async function openRoomModal(roomId) {
    if (!roomId) return;

    const modal = $("#roomModal");
    const occupantsContainer = $("#roomOccupants");
    if (!modal || !occupantsContainer) return;

    const roomTitle = $("#modalRoomTitle");
    const roomSubtitle = $("#modalRoomSubtitle");

    if (roomTitle) roomTitle.textContent = "Room Occupants";
    if (roomSubtitle) roomSubtitle.textContent = "Loading...";

    occupantsContainer.innerHTML = `<div class="loading-state">Loading occupants...</div>`;

    modal.classList.add("open");
    modal.classList.remove("hidden");
    modal.style.display = "";

    try {
        const data = await callRpc("admin_room_occupants", { p_room_id: roomId });
        const occupants = Array.isArray(data) ? data : [];

        if (occupants.length) {
            const first = occupants[0];
            if (roomTitle) roomTitle.textContent = first.room_code || first.room_number || "Room Occupants";
            if (roomSubtitle) roomSubtitle.textContent = `${first.block || ""} · ${occupants.length} occupant(s)`;
        }

        if (!occupants.length) {
            occupantsContainer.innerHTML = `<div class="empty-state">No current occupants.</div>`;
            return;
        }

        occupantsContainer.innerHTML = `
            <div class="occupants-list">
                ${occupants.map((student) => `
                    <div class="occupant-row">
                        <div>
                            <strong>${escapeHtml(student.student_name || student.full_name || "Unknown")}</strong>
                            <div>${escapeHtml(student.student_id || student.student_number || "—")}</div>
                        </div>
                        <div>${escapeHtml(student.bed_code || student.bed_number || student.bed_label || "—")}</div>
                        <div>${escapeHtml(student.level || "—")}</div>
                    </div>
                `).join("")}
            </div>
        `;

    } catch (error) {
        console.error("Room occupants error:", error);
        occupantsContainer.innerHTML = `<div class="error-state">Unable to load room occupants.</div>`;
    }
}

function closeRoomModal() {
    const modal = $("#roomModal");
    if (!modal) return;

    modal.classList.remove("open");
    modal.classList.add("hidden");
    modal.style.display = "none";
}

/* =========================================================
   ALLOCATIONS
   ========================================================= */

async function loadAllocations() {
    const tbody = $("#allocationsTable");
    if (!tbody) return;

    const block = $("#allocationBlockFilter")?.value || "";
    const gender = $("#genderFilter")?.value || "";
    const search = $("#studentSearch")?.value.trim() || "";

    tbody.innerHTML = `<tr><td colspan="11">Loading allocations...</td></tr>`;

    try {
        const data = await callRpc("admin_student_allocations", {
            p_search: search || null,
            p_block: block || null,
            p_gender: gender || null
        });

        const allocations = Array.isArray(data) ? data : [];

        if (!allocations.length) {
            tbody.innerHTML = `<tr><td colspan="11">No allocations found.</td></tr>`;
            return;
        }

        tbody.innerHTML = allocations.map(renderAllocationRow).join("");

    } catch (error) {
        console.error("Allocations load error:", error);
        tbody.innerHTML = `<tr><td colspan="11">Unable to load allocations.</td></tr>`;
    }
}

function renderAllocationRow(allocation) {
    const allocationId = allocation.allocation_id || allocation.id || "";
    const studentUuid = allocation.student_uuid || allocation.student_id_uuid || allocation.student_pk || "";
    const studentId = allocation.student_id || allocation.student_number || studentUuid || "";
    const studentName = allocation.student_name || allocation.full_name || "—";
    const studentNumber = allocation.student_number || allocation.student_id_number || allocation.student_code || allocation.student_id || "—";
    const room = allocation.room_code || allocation.room_number || "—";
    const bed = allocation.bed_code || allocation.bed_number || allocation.bed_label || "—";
    const block = allocation.block || "—";
    const gender = allocation.gender || "—";
    const level = allocation.level || "—";
    const status = allocation.status || "active";

    return `
        <tr data-allocation-id="${escapeHtml(allocationId)}" data-student-id="${escapeHtml(studentUuid || studentId)}">
            <td>${escapeHtml(allocation.allocation_number || studentNumber)}</td>
            <td>
                <strong>${escapeHtml(studentName)}</strong>
                <small>${escapeHtml(studentNumber)}</small>
            </td>
            <td>${escapeHtml(level)}</td>
            <td>${escapeHtml(allocation.programme || "—")}</td>
            <td>${escapeHtml(gender)}</td>
            <td>${escapeHtml(block)}</td>
            <td>${escapeHtml(room)}</td>
            <td>${escapeHtml(bed)}</td>
            <td><span class="status-badge ${escapeHtml(normalise(status))}">${escapeHtml(status)}</span></td>
            <td>${escapeHtml(formatDate(allocation.allocated_at || allocation.created_at))}</td>
            <td>
                <div class="table-actions">
                    <button type="button" class="btn btn-small btn-secondary allocation-reassign" data-allocation-id="${escapeHtml(allocationId)}" data-student-id="${escapeHtml(studentUuid || studentId)}" data-current-bed-id="${escapeHtml(allocation.bed_id || allocation.current_bed_id || "")}">Reassign</button>
                    ${isSuperAdmin() ? `<button type="button" class="btn btn-small btn-danger allocation-unassign" data-allocation-id="${escapeHtml(allocationId)}">Unassign</button>` : ""}
                </div>
            </td>
        </tr>
    `;
}

/* =========================================================
   AVAILABLE BEDS & REASSIGN / UNASSIGN
   ========================================================= */

async function getAvailableBeds(gender) {
    const data = await callRpc("admin_available_beds", { p_gender: gender || null });
    return Array.isArray(data) ? data : [];
}

async function reassignAllocation(allocationId, currentBedId) {
    if (!allocationId) return showToast("Allocation ID is missing.", "error");

    let gender = "";
    const row = document.querySelector(`tr[data-allocation-id="${CSS.escape(String(allocationId))}"]`);
    if (row) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 5) gender = cells[4]?.textContent.trim() || "";
    }

    try {
        const beds = await getAvailableBeds(gender);
        if (!beds.length) return showToast("There are no available beds for this student.", "error");

        const options = beds.map((bed, index) => `${index + 1}. ${bed.room_code || bed.room_number || "Room"} · ${bed.bed_code || bed.bed_number || "Bed"}`).join("\n");

        const answer = window.prompt(`Select the new bed by entering its number:\n\n${options}`);
        if (answer === null) return;

        const index = Number(answer) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= beds.length) return showToast("Invalid bed selection.", "error");

        const selectedBed = beds[index];
        const newBedId = selectedBed.bed_id || selectedBed.id || "";
        if (!newBedId) return showToast("Selected bed has no valid ID.", "error");
        if (currentBedId && String(currentBedId) === String(newBedId)) return showToast("Please select a different bed.", "error");

        if (!window.confirm("Are you sure you want to reassign this student to the selected bed?")) return;

        await callRpc("reassign_student", { p_allocation_id: allocationId, p_new_bed_id: newBedId });
        showToast("Student successfully reassigned.");
        await loadEverything();

    } catch (error) {
        console.error("Reassignment error:", error);
        showToast(error?.message || "Unable to reassign the student.", "error");
    }
}

async function unassignAllocation(allocationId) {
    if (!allocationId) return showToast("Allocation ID is missing.", "error");
    if (!isSuperAdmin()) return showToast("Only a Super Admin can unassign students.", "error");

    if (!window.confirm("Are you sure you want to unassign this student?\n\nThis will remove the current room allocation.")) return;

    try {
        await callRpc("unassign_student", { p_allocation_id: allocationId });
        showToast("Student successfully unassigned.");
        await loadEverything();
    } catch (error) {
        console.error("Unassign error:", error);
        showToast(error?.message || "Unable to unassign the student.", "error");
    }
}

/* =========================================================
   UNALLOCATED STUDENTS
   ========================================================= */

function getUnallocatedTableBody() {
    let tbody = $("#unallocatedTableBody");
    if (tbody) return tbody;
    const table = $("#unallocatedSection table");
    if (!table) return null;

    tbody = table.querySelector("tbody");
    if (!tbody) {
        tbody = document.createElement("tbody");
        tbody.id = "unallocatedTableBody";
        table.appendChild(tbody);
    } else {
        tbody.id = "unallocatedTableBody";
    }
    return tbody;
}

async function loadUnallocated() {
    const tbody = getUnallocatedTableBody();
    if (!tbody) return;

    const search = $("#unallocatedSearch")?.value.trim() || "";
    tbody.innerHTML = `<tr><td colspan="8">Loading unallocated students...</td></tr>`;

    try {
        const data = await callRpc("admin_unallocated_students", { p_search: search || null });
        const students = Array.isArray(data) ? data : [];

        if (!students.length) {
            tbody.innerHTML = `<tr><td colspan="8">${search ? "No unallocated students match your search." : "No unallocated students found."}</td></tr>`;
            return;
        }

        tbody.innerHTML = students.map(renderUnallocatedRow).join("");
    } catch (error) {
        console.error("Unallocated students load error:", error);
        tbody.innerHTML = `<tr><td colspan="8">Unable to load unallocated students.</td></tr>`;
        showToast(error?.message || "Unable to load unallocated students.", "error");
    }
}

function renderUnallocatedRow(student) {
    const studentUuid = student.student_uuid || student.student_id_uuid || student.student_pk || (typeof student.id === "string" && student.id.includes("-") ? student.id : "");
    const studentNumber = student.student_number || student.student_code || student.student_id_number || (student.student_id && !String(student.student_id).includes("-") ? student.student_id : "") || "—";
    const rowId = studentUuid || student.student_id || student.id || studentNumber || "";
    const studentName = student.student_name || student.full_name || student.name || "—";
    const level = student.level || "—";
    const programme = student.programme || "—";
    const gender = student.gender || "—";
    const priority = student.priority_group || "—";
    const email = student.email || "—";
    const assignId = studentUuid || student.id || student.student_id || "";

    return `
        <tr data-student-id="${escapeHtml(rowId)}">
            <td><strong>${escapeHtml(studentName)}</strong></td>
            <td>${escapeHtml(studentNumber)}</td>
            <td>${escapeHtml(level)}</td>
            <td>${escapeHtml(programme)}</td>
            <td>${escapeHtml(gender)}</td>
            <td>${escapeHtml(priority)}</td>
            <td>${escapeHtml(email)}</td>
            <td>
                <button type="button" class="btn btn-small btn-primary assign-unallocated" data-student-id="${escapeHtml(assignId)}" data-student-number="${escapeHtml(studentNumber)}" data-student-gender="${escapeHtml(gender)}">Assign Room</button>
            </td>
        </tr>
    `;
}

async function assignUnallocatedStudent(studentId, genderFromButton = "") {
    if (!studentId) return showToast("Student ID is missing.", "error");

    try {
        const button = document.querySelector(`.assign-unallocated[data-student-id="${CSS.escape(String(studentId))}"]`);
        const studentRow = button?.closest("tr");
        let gender = genderFromButton || button?.dataset.studentGender || "";

        if (!gender && studentRow) {
            const cells = studentRow.querySelectorAll("td");
            if (cells.length >= 5) gender = cells[4]?.textContent.trim() || "";
        }

        const beds = await getAvailableBeds(gender);
        if (!beds.length) return showToast("There are no available beds for this student.", "error");

        const options = beds.map((bed, index) => `${index + 1}. ${bed.room_code || bed.room_number || "Room"} · ${bed.bed_code || bed.bed_number || "Bed"}`).join("\n");

        const answer = window.prompt(`Select the bed to assign:\n\n${options}`);
        if (answer === null) return;

        const index = Number(answer) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= beds.length) return showToast("Invalid bed selection.", "error");

        const selectedBed = beds[index];
        const bedId = selectedBed.bed_id || selectedBed.id || "";
        if (!bedId) return showToast("Selected bed has no valid ID.", "error");

        if (!window.confirm("Assign this student to the selected bed?")) return;

        await callRpc("admin_assign_student", { p_student_id: studentId, p_bed_id: bedId });
        showToast("Student successfully assigned.");
        await loadEverything();

    } catch (error) {
        console.error("Assign unallocated student error:", error);
        showToast(error?.message || "Unable to assign this student.", "error");
    }
}

/* =========================================================
   AUDIT LOGS & REPORTS
   ========================================================= */

async function loadAuditLogs() {
    const tbody = $("#auditTable");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5">Loading audit logs...</td></tr>`;

    try {
        const data = await callRpc("admin_audit_logs", { p_limit: 100 });
        const logs = Array.isArray(data) ? data : [];

        if (!logs.length) {
            tbody.innerHTML = `<tr><td colspan="5">No audit records found.</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map((log) => `
            <tr>
                <td>${escapeHtml(formatDate(log.created_at || log.timestamp))}</td>
                <td>${escapeHtml(log.action || log.event || "—")}</td>
                <td>${escapeHtml(log.actor_email || log.user_email || "—")}</td>
                <td>${escapeHtml(log.target || log.target_type || "—")}</td>
                <td>${escapeHtml(typeof log.details === "object" ? JSON.stringify(log.details) : (log.details || log.description || ""))}</td>
            </tr>
        `).join("");
    } catch (error) {
        console.error("Audit log error:", error);
        tbody.innerHTML = `<tr><td colspan="5">Unable to load audit logs.</td></tr>`;
    }
}

/* =========================================================
   LOAD EVERYTHING & DYNAMIC REALTIME UPDATES
   ========================================================= */

async function loadEverything() {
    setText("#lastUpdated", "Refreshing...");
    const results = await Promise.allSettled([
        loadDashboard(),
        loadRooms(),
        loadAllocations(),
        loadUnallocated(),
        loadAuditLogs()
    ]);

    results.forEach((result, index) => {
        if (result.status === "rejected") {
            console.error(`Admin section ${index} failed:`, result.reason);
        }
    });

    setText("#lastUpdated", formatDate(new Date()));
}

function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = window.setInterval(() => {
        loadEverything();
    }, 30000);
}

function stopAutoRefresh() {
    if (autoRefreshTimer) {
        window.clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

function setupRealtimeSubscriptions() {
    teardownRealtimeSubscriptions();

    realtimeChannel = supabase
        .channel("admin-realtime-changes")
        .on("postgres_changes", { event: "*", schema: "public" }, () => {
            loadEverything();
        })
        .subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log("Realtime dynamic update listener attached.");
            }
        });
}

function teardownRealtimeSubscriptions() {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
}

/* =========================================================
   EXPORT / PRINT
   ========================================================= */

function downloadCsv(filename, rows) {
    if (!rows || !rows.length) return showToast("There is no data to export.", "error");

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function exportAllocations() {
    try {
        const block = $("#allocationBlockFilter")?.value || "";
        const gender = $("#genderFilter")?.value || "";
        const search = $("#studentSearch")?.value.trim() || "";

        const data = await callRpc("admin_student_allocations", { p_search: search || null, p_block: block || null, p_gender: gender || null });
        const allocations = Array.isArray(data) ? data : [];

        const rows = [["Allocation Number", "Student Name", "Student ID", "Level", "Programme", "Gender", "Block", "Room", "Bed", "Status", "Allocated At"]];
        allocations.forEach((item) => {
            rows.push([
                item.allocation_number || "",
                item.student_name || "",
                item.student_number || item.student_id_number || item.student_id || "",
                item.level || "",
                item.programme || "",
                item.gender || "",
                item.block || "",
                item.room_code || item.room_number || "",
                item.bed_code || item.bed_number || "",
                item.status || "",
                formatDate(item.allocated_at || item.created_at)
            ]);
        });

        downloadCsv("uhas-asogli-hall-allocations.csv", rows);
        showToast("Allocations exported successfully.");
    } catch (error) {
        console.error("Allocation export error:", error);
        showToast("Unable to export allocations.", "error");
    }
}

async function exportUnallocated() {
    try {
        const search = $("#unallocatedSearch")?.value.trim() || "";
        const data = await callRpc("admin_unallocated_students", { p_search: search || null });
        const students = Array.isArray(data) ? data : [];

        const rows = [["Student Name", "Student ID", "Level", "Programme", "Gender", "Priority Group", "Email"]];
        students.forEach((student) => {
            rows.push([
                student.student_name || student.full_name || "",
                student.student_number || student.student_id || student.id || "",
                student.level || "",
                student.programme || "",
                student.gender || "",
                student.priority_group || "",
                student.email || ""
            ]);
        });

        downloadCsv("uhas-asogli-hall-unallocated-students.csv", rows);
        showToast("Unallocated students exported successfully.");
    } catch (error) {
        console.error("Unallocated export error:", error);
        showToast("Unable to export unallocated students.", "error");
    }
}

/* =========================================================
   NAVIGATION & SECTION ACTIVATION
   ========================================================= */

function activateSection(sectionId) {
    if (!sectionId) return;

    $$(".admin-section").forEach((section) => {
        const matches = section.id === sectionId;
        section.classList.toggle("active", matches);
        section.classList.toggle("active-section", matches);
        section.style.display = matches ? "" : "none";
    });

    $$(".nav-item[data-section]").forEach((item) => {
        item.classList.toggle("active", item.dataset.section === sectionId);
    });

    const pageTitle = $("#pageTitle");
    const activeNav = document.querySelector(`.nav-item[data-section="${CSS.escape(sectionId)}"]`);
    if (pageTitle && activeNav) {
        pageTitle.textContent = activeNav.dataset.title || activeNav.textContent.trim();
    }

    const sidebar = $("#adminSidebar");
    if (sidebar) sidebar.classList.remove("open");
}

function initialiseNavigation() {
    document.addEventListener("click", (event) => {
        const targetNav = event.target.closest("[data-section]");
        if (!targetNav) return;

        event.preventDefault();
        const sectionId = targetNav.dataset.section;
        if (!sectionId) return;

        if (sectionId === "adminManagementSection" && !isSuperAdmin()) {
            showToast("Only a Super Admin can access administrator management.", "error");
            return;
        }

        activateSection(sectionId);
    });

    const menuButton = $("#mobileMenuButton");
    if (menuButton && !menuButton.dataset.eventsAttached) {
        menuButton.dataset.eventsAttached = "true";
        menuButton.addEventListener("click", () => {
            const sidebar = $("#adminSidebar");
            if (sidebar) sidebar.classList.toggle("open");
        });
    }
}

/* =========================================================
   DROPDOWNS & FILTER HANDLERS
   ========================================================= */

function initialiseSearchAndFilters() {
    document.addEventListener("change", (event) => {
        if (event.target.id === "blockFilter") {
            loadRooms();
        } else if (event.target.id === "allocationBlockFilter" || event.target.id === "genderFilter") {
            loadAllocations();
        }
    });

    document.addEventListener("input", (event) => {
        if (event.target.id === "studentSearch") {
            window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(loadAllocations, 300);
        } else if (event.target.id === "unallocatedSearch") {
            window.clearTimeout(unallocatedSearchTimer);
            unallocatedSearchTimer = window.setTimeout(loadUnallocated, 300);
        }
    });
}

/* =========================================================
   ADMIN MANAGEMENT & MODAL ACTIONS
   ========================================================= */

async function initialiseAdminManagement() {
    if (!isSuperAdmin()) {
        hideElement("#adminManagementSection");
        hideElement("#administratorsNavItem");
        return;
    }

    showElement("#administratorsNavItem");
    if (adminManagementInitialised) {
        await loadAdministrators();
        return;
    }

    adminManagementInitialised = true;

    const addButton = $("#addAdminButton");
    if (addButton) addButton.addEventListener("click", () => openAdminModal());

    const closeButton = $("#closeAdminModalButton");
    if (closeButton) closeButton.addEventListener("click", closeAdminModal);

    const cancelButton = $("#cancelAdminButton");
    if (cancelButton) cancelButton.addEventListener("click", closeAdminModal);

    const form = $("#adminForm");
    if (form) form.addEventListener("submit", handleAdminFormSubmit);

    await loadAdministrators();
}

async function loadAdministrators() {
    if (!isSuperAdmin()) return;
    const tbody = $("#administratorsTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="4">Loading administrators...</td></tr>`;

    try {
        const { data, error } = await supabase.functions.invoke("admin-management", { body: { action: "list" } });
        if (error) throw error;

        const administrators = Array.isArray(data) ? data : Array.isArray(data?.administrators) ? data.administrators : [];
        if (!administrators.length) {
            tbody.innerHTML = `<tr><td colspan="4">No administrators found.</td></tr>`;
            return;
        }

        tbody.innerHTML = administrators.map((admin) => `
            <tr>
                <td>${escapeHtml(admin.email || "—")}</td>
                <td>${escapeHtml(admin.role || "admin")}</td>
                <td>${escapeHtml(formatDate(admin.created_at))}</td>
                <td>
                    <div class="table-actions">
                        <button type="button" class="btn btn-small btn-secondary edit-admin" data-admin-id="${escapeHtml(admin.id || admin.user_id || "")}" data-admin-email="${escapeHtml(admin.email || "")}" data-admin-role="${escapeHtml(admin.role || "admin")}">Edit</button>
                        <button type="button" class="btn btn-small btn-danger delete-admin" data-admin-id="${escapeHtml(admin.id || admin.user_id || "")}" data-admin-email="${escapeHtml(admin.email || "")}">Remove</button>
                    </div>
                </td>
            </tr>
        `).join("");
    } catch (error) {
        console.error("Administrator load error:", error);
        tbody.innerHTML = `<tr><td colspan="4">Unable to load administrators.</td></tr>`;
    }
}

function openAdminModal(admin = null) {
    if (!isSuperAdmin()) return showToast("Only a Super Admin can manage administrators.", "error");

    const modal = $("#adminManagementModal");
    const form = $("#adminForm");
    if (!modal || !form) return;

    form.reset();
    setText("#adminModalTitle", admin ? "Edit Administrator" : "Add Administrator");

    if ($("#adminEmail")) $("#adminEmail").value = admin?.email || "";
    if ($("#adminRoleSelect")) $("#adminRoleSelect").value = admin?.role || "admin";
    if ($("#adminPassword")) $("#adminPassword").value = "";
    if ($("#adminFormError")) $("#adminFormError").textContent = "";

    form.dataset.adminId = admin?.id || admin?.user_id || "";
    modal.classList.add("open");
    modal.style.display = "";
}

function closeAdminModal() {
    const modal = $("#adminManagementModal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.style.display = "none";
}

async function handleAdminFormSubmit(event) {
    event.preventDefault();
    if (!isSuperAdmin()) return showToast("Only a Super Admin can manage administrators.", "error");

    const form = $("#adminForm");
    const email = $("#adminEmail")?.value.trim();
    const password = $("#adminPassword")?.value || "";
    const role = $("#adminRoleSelect")?.value || "admin";
    const errorElement = $("#adminFormError");
    const saveButton = $("#saveAdminButton");

    if (errorElement) errorElement.textContent = "";
    if (!email) {
        if (errorElement) errorElement.textContent = "Email address is required.";
        return;
    }

    const adminId = form?.dataset.adminId || "";
    if (!adminId && !password) {
        if (errorElement) errorElement.textContent = "Password is required for a new administrator.";
        return;
    }

    setButtonLoading(saveButton, true, "Saving...");

    try {
        const payload = { action: adminId ? "update" : "create", email, role };
        if (adminId) payload.user_id = adminId;
        if (password) payload.password = password;

        const { data, error } = await supabase.functions.invoke("admin-management", { body: payload });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        closeAdminModal();
        showToast(adminId ? "Administrator updated successfully." : "Administrator created successfully.");
        await loadAdministrators();
    } catch (error) {
        console.error("Administrator save error:", error);
        if (errorElement) errorElement.textContent = error?.message || "Unable to save administrator.";
    } finally {
        setButtonLoading(saveButton, false);
    }
}

async function deleteAdministrator(adminId, email) {
    if (!isSuperAdmin()) return showToast("Only a Super Admin can remove administrators.", "error");
    if (!adminId) return showToast("Administrator ID is missing.", "error");

    if (!window.confirm(`Remove administrator ${email}?\n\nThis action cannot be undone.`)) return;

    try {
        const { data, error } = await supabase.functions.invoke("admin-management", { body: { action: "delete", user_id: adminId } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        showToast("Administrator removed successfully.");
        await loadAdministrators();
    } catch (error) {
        console.error("Administrator delete error:", error);
        showToast(error?.message || "Unable to remove administrator.", "error");
    }
}

/* =========================================================
   GLOBAL ACTION DELEGATION & BUTTON HANDLERS
   ========================================================= */

function initialiseActions() {
    document.addEventListener("click", async (event) => {
        const reassignButton = event.target.closest(".allocation-reassign");
        if (reassignButton) {
            await reassignAllocation(reassignButton.dataset.allocationId, reassignButton.dataset.currentBedId);
            return;
        }

        const unassignButton = event.target.closest(".allocation-unassign");
        if (unassignButton) {
            await unassignAllocation(unassignButton.dataset.allocationId);
            return;
        }

        const assignBtn = event.target.closest(".assign-unallocated");
        if (assignBtn) {
            await assignUnallocatedStudent(assignBtn.dataset.studentId, assignBtn.dataset.studentGender);
            return;
        }

        const editAdminBtn = event.target.closest(".edit-admin");
        if (editAdminBtn) {
            openAdminModal({ id: editAdminBtn.dataset.adminId, email: editAdminBtn.dataset.adminEmail, role: editAdminBtn.dataset.adminRole });
            return;
        }

        const deleteAdminBtn = event.target.closest(".delete-admin");
        if (deleteAdminBtn) {
            await deleteAdministrator(deleteAdminBtn.dataset.adminId, deleteAdminBtn.dataset.adminEmail);
            return;
        }

        const roomCard = event.target.closest(".room-card");
        if (roomCard) {
            await openRoomModal(roomCard.dataset.roomId);
            return;
        }

        if (event.target.id === "refreshButton") {
            const refreshButton = event.target;
            setButtonLoading(refreshButton, true, "Refreshing...");
            try {
                await loadEverything();
                showToast("Dashboard refreshed.");
            } finally {
                setButtonLoading(refreshButton, false);
            }
            return;
        }

        if (event.target.id === "exportAllocations") exportAllocations();
        if (event.target.id === "exportUnallocated") exportUnallocated();
        if (event.target.id === "printReport") window.print();
        if (event.target.id === "closeModal") closeRoomModal();

        if (event.target.id === "roomModal") closeRoomModal();
        if (event.target.id === "adminManagementModal") closeAdminModal();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeRoomModal();
            closeAdminModal();
        }
    });

    const loginForm = $("#loginForm");
    if (loginForm) loginForm.addEventListener("submit", handleLogin);

    const logoutButton = $("#logoutButton");
    if (logoutButton) logoutButton.addEventListener("click", handleLogout);

    const forgotPasswordLink = $("#forgotPasswordLink");
    if (forgotPasswordLink) forgotPasswordLink.addEventListener("click", handlePasswordReset);
}

/* =========================================================
   APPLICATION INITIALISATION
   ========================================================= */

function initialiseAllUI() {
    initialiseNavigation();
    initialiseSearchAndFilters();
    initialiseActions();
}

async function initialise() {
    if (applicationInitialised || isInitialising) return;
    isInitialising = true;

    try {
        initialiseAllUI();

        const { data: { session } = {}, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!session?.user) {
            currentUser = null;
            currentProfile = null;
            authStateInitialised = false;
            applicationInitialised = false;
            showLogin();
            return;
        }

        currentUser = session.user;
        await loadCurrentProfile();

        showApp();
        updateRoleDisplay();

        authStateInitialised = true;
        applicationInitialised = true;

        await initialiseAdminManagement();
        await loadEverything();

        setupRealtimeSubscriptions();
        startAutoRefresh();

        activateSection("dashboardSection");

    } catch (error) {
        console.error("Application initialisation error:", error);
        if (currentUser) {
            showApp();
            showToast(error?.message || "Some components failed to load.", "error");
        } else {
            showLogin();
        }
    } finally {
        isInitialising = false;
    }
}

/* =========================================================
   AUTH STATE LISTENERS
   ========================================================= */

supabase.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION") return;

    if (event === "SIGNED_IN") {
        if (!applicationInitialised && session?.user) {
            initialise();
        }
        return;
    }

    if (event === "SIGNED_OUT") {
        currentUser = null;
        currentProfile = null;
        authStateInitialised = false;
        applicationInitialised = false;
        adminManagementInitialised = false;
        stopAutoRefresh();
        teardownRealtimeSubscriptions();
        showLogin();
    }
});

/* =========================================================
   START APPLICATION
   ========================================================= */

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initialise());
} else {
    initialise();
}