import { supabase } from "../supabase.js";

/* =========================================================
   UHAS ASOGLI HALL ROOM ALLOCATION
   ADMIN PORTAL
   CLEAN PRODUCTION JAVASCRIPT
   ========================================================= */

/* =========================================================
   STATE
   ========================================================= */

let currentUser = null;
let currentProfile = null;
let isInitialising = false;
let searchTimer = null;
let unallocatedSearchTimer = null;
let adminManagementInitialised = false;


/* =========================================================
   DOM HELPERS
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function setText(selector, value) {
    const element = $(selector);

    if (element) {
        element.textContent =
            value === null || value === undefined ? "" : String(value);
    }
}

function showElement(selector) {
    const element = $(selector);

    if (element) {
        element.hidden = false;
        element.style.display = "";
    }
}

function hideElement(selector) {
    const element = $(selector);

    if (element) {
        element.hidden = true;
        element.style.display = "none";
    }
}

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDate(value) {
    if (!value) {
        return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("en-GH", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function formatDateOnly(value) {
    if (!value) {
        return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleDateString("en-GH", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function normalise(value) {
    return String(value || "").trim().toLowerCase();
}

function csvEscape(value) {
    const text =
        value === null || value === undefined
            ? ""
            : String(value);

    return `"${text.replace(/"/g, '""')}"`;
}

function showToast(message, type = "success") {
    const toast = $("#toast");

    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add("show");

    window.clearTimeout(showToast.timer);

    showToast.timer = window.setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}

function showError(message) {
    console.error(message);
    showToast(message, "error");
}

function setButtonLoading(button, loading, loadingText = "Processing...") {
    if (!button) {
        return;
    }

    if (loading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }

        button.disabled = true;
        button.textContent = loadingText;
    } else {
        button.disabled = false;

        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
    }
}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

async function getCurrentSession() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
        console.error("Unable to get session:", error);
        return null;
    }

    return data?.session || null;
}

async function loadCurrentProfile() {
    if (!currentUser?.id) {
        currentProfile = null;
        return null;
    }

    const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("auth_user_id", currentUser.id)
        .maybeSingle();

    if (error) {
        console.error("Unable to load admin profile:", error);
        currentProfile = null;
        return null;
    }

    currentProfile = data || null;

    return currentProfile;
}

function getUserRole() {
    if (!currentProfile) {
        return null;
    }

    return (
        currentProfile.role ||
        currentProfile.user_role ||
        currentProfile.admin_role ||
        null
    );
}

function isSuperAdmin() {
    const roleElement = $("#adminRole");

    if (roleElement) {
        const roleText = normalise(roleElement.textContent);

        if (roleText.includes("super admin")) {
            return true;
        }
    }

    const role = normalise(getUserRole());

    return role === "super_admin" || role === "super admin";
}

function updateRoleDisplay() {
    const role = getUserRole();

    let displayRole = "ADMIN";

    if (role === "super_admin" || role === "super admin") {
        displayRole = "SUPER ADMIN";
    }

    setText("#adminRole", displayRole);
    setText("#mobileAdminRole", displayRole);
    setText("#sidebarAdminRole", displayRole);

    const managementNav = $("#administratorsNavItem");
    const managementSection = $("#adminManagementSection");

    if (isSuperAdmin()) {
        if (managementNav) {
            managementNav.style.display = "";
        }
    } else {
        if (managementNav) {
            managementNav.style.display = "none";
        }

        if (managementSection) {
            managementSection.style.display = "none";
        }
    }
}

async function handleLogin(event) {
    event.preventDefault();

    const email = $("#email")?.value.trim();
    const password = $("#password")?.value || "";
    const button = $("#loginButton");
    const errorElement = $("#loginError");

    if (errorElement) {
        errorElement.textContent = "";
    }

    if (!email || !password) {
        if (errorElement) {
            errorElement.textContent = "Enter your email and password.";
        }

        return;
    }

    setButtonLoading(button, true, "Signing in...");

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw error;
        }

        currentUser = data.user;

        await loadCurrentProfile();

        showApp();

        updateRoleDisplay();

        await initialiseAdminManagement();

        await loadEverything();

        showToast("Login successful.");
    } catch (error) {
        console.error("Login error:", error);

        if (errorElement) {
            errorElement.textContent =
                error?.message || "Unable to sign in.";
        }
    } finally {
        setButtonLoading(button, false);
    }
}

async function handleLogout() {
    try {
        await supabase.auth.signOut();
    } catch (error) {
        console.error("Logout error:", error);
    }

    currentUser = null;
    currentProfile = null;

    showLogin();

    showToast("You have been logged out.");
}

function showLogin() {
    const loginView = $("#loginView");
    const appView = $("#appView");

    if (loginView) {
        loginView.style.display = "";
        loginView.hidden = false;
    }

    if (appView) {
        appView.style.display = "none";
        appView.hidden = true;
    }
}

function showApp() {
    const loginView = $("#loginView");
    const appView = $("#appView");

    if (loginView) {
        loginView.style.display = "none";
        loginView.hidden = true;
    }

    if (appView) {
        appView.style.display = "";
        appView.hidden = false;
    }
}

async function handlePasswordReset(event) {
    event.preventDefault();

    const email = $("#email")?.value.trim();

    if (!email) {
        showToast(
            "Enter your administrator email address first.",
            "error"
        );

        return;
    }

    try {
        const redirectUrl =
            `${window.location.origin}${window.location.pathname}`;

        const { error } = await supabase.auth.resetPasswordForEmail(
            email,
            {
                redirectTo: redirectUrl
            }
        );

        if (error) {
            throw error;
        }

        showToast(
            "Password reset instructions have been sent to your email."
        );
    } catch (error) {
        console.error("Password reset error:", error);

        showToast(
            error?.message || "Unable to send password reset email.",
            "error"
        );
    }
}


/* =========================================================
   RPC HELPER
   ========================================================= */

async function callRpc(functionName, params = {}) {
    const { data, error } = await supabase.rpc(
        functionName,
        params
    );

    if (error) {
        console.error(`RPC ${functionName} failed:`, error);
        throw error;
    }

    return data;
}


/* =========================================================
   DASHBOARD
   ========================================================= */

async function loadDashboard() {
    try {
        const data = await callRpc("admin_dashboard_summary");

        const summary = Array.isArray(data)
            ? data[0]
            : data || {};

        setText("#totalRooms", summary.total_rooms ?? 0);
        setText("#totalBeds", summary.total_beds ?? 0);
        setText("#occupiedBeds", summary.occupied_beds ?? 0);
        setText("#availableBeds", summary.available_beds ?? 0);
        setText("#activeHolds", summary.active_holds ?? 0);
        setText("#activeAllocations", summary.active_allocations ?? 0);
        setText(
            "#unallocatedStudents",
            summary.unallocated_students ?? 0
        );

        const totalBeds = Number(summary.total_beds || 0);
        const occupiedBeds = Number(summary.occupied_beds || 0);

        let percentage = 0;

        if (totalBeds > 0) {
            percentage = Math.round(
                (occupiedBeds / totalBeds) * 100
            );
        }

        setText("#allocationStatus", `${percentage}% Allocated`);
        setText("#lastUpdated", formatDate(new Date()));
    } catch (error) {
        console.error("Dashboard load error:", error);

        setText("#totalRooms", "—");
        setText("#totalBeds", "—");
        setText("#occupiedBeds", "—");
        setText("#availableBeds", "—");
        setText("#activeHolds", "—");
        setText("#activeAllocations", "—");
        setText("#unallocatedStudents", "—");
        setText("#allocationStatus", "Unavailable");
    }
}


/* =========================================================
   ROOMS
   ========================================================= */

async function loadRooms() {
    const grid = $("#roomsGrid");

    if (!grid) {
        return;
    }

    const block = $("#blockFilter")?.value || "";

    grid.innerHTML = `
        <div class="loading-state">
            Loading rooms...
        </div>
    `;

    try {
        const data = await callRpc("admin_rooms", {
            p_block: block || null
        });

        const rooms = Array.isArray(data) ? data : [];

        if (!rooms.length) {
            grid.innerHTML = `
                <div class="empty-state">
                    No rooms found.
                </div>
            `;

            return;
        }

        grid.innerHTML = rooms
            .map((room) => renderRoomCard(room))
            .join("");
    } catch (error) {
        console.error("Rooms load error:", error);

        grid.innerHTML = `
            <div class="error-state">
                Unable to load rooms.
            </div>
        `;
    }
}

function renderRoomCard(room) {
    const capacity = Number(room.capacity || 0);
    const occupied = Number(
        room.occupied_beds ??
        room.occupied ??
        room.occupied_count ??
        0
    );

    const available = Math.max(capacity - occupied, 0);

    let status = "available";

    if (room.temporarily_locked) {
        status = "locked";
    } else if (available === 0 && capacity > 0) {
        status = "full";
    } else if (occupied > 0) {
        status = "partial";
    }

    const gender =
        room.gender ||
        room.gender_rule ||
        "Mixed";

    return `
        <button
            type="button"
            class="room-card ${escapeHtml(status)}"
            data-room-id="${escapeHtml(room.id || "")}"
        >
            <div class="room-card-top">
                <span class="room-code">
                    ${escapeHtml(room.room_code || room.room_number || "Room")}
                </span>

                <span class="room-status ${escapeHtml(status)}">
                    ${escapeHtml(status)}
                </span>
            </div>

            <div class="room-card-body">
                <div class="room-number">
                    ${escapeHtml(room.room_number || room.room_code || "—")}
                </div>

                <div class="room-meta">
                    <span>
                        ${escapeHtml(room.block || "—")}
                    </span>

                    <span>
                        Floor ${escapeHtml(room.floor ?? "—")}
                    </span>
                </div>

                <div class="room-capacity">
                    <strong>${occupied}</strong>
                    <span>occupied</span>

                    <strong>${available}</strong>
                    <span>available</span>

                    <strong>${capacity}</strong>
                    <span>capacity</span>
                </div>

                <div class="room-gender">
                    ${escapeHtml(gender)}
                </div>
            </div>
        </button>
    `;
}

async function openRoomModal(roomId) {
    if (!roomId) {
        return;
    }

    const modal = $("#roomModal");
    const occupantsContainer = $("#roomOccupants");

    if (!modal || !occupantsContainer) {
        return;
    }

    const roomTitle = $("#modalRoomTitle");
    const roomSubtitle = $("#modalRoomSubtitle");

    if (roomTitle) {
        roomTitle.textContent = "Room Occupants";
    }

    if (roomSubtitle) {
        roomSubtitle.textContent = "Loading...";
    }

    occupantsContainer.innerHTML = `
        <div class="loading-state">
            Loading occupants...
        </div>
    `;

    modal.classList.add("open");
    modal.style.display = "";

    try {
        const data = await callRpc("admin_room_occupants", {
            p_room_id: roomId
        });

        const occupants = Array.isArray(data) ? data : [];

        if (occupants.length) {
            const first = occupants[0];

            if (roomTitle) {
                roomTitle.textContent =
                    first.room_code ||
                    first.room_number ||
                    "Room Occupants";
            }

            if (roomSubtitle) {
                roomSubtitle.textContent =
                    `${first.block || ""} · ${occupants.length} occupant(s)`;
            }
        }

        if (!occupants.length) {
            occupantsContainer.innerHTML = `
                <div class="empty-state">
                    No current occupants.
                </div>
            `;

            return;
        }

        occupantsContainer.innerHTML = `
            <div class="occupants-list">
                ${occupants
                    .map(
                        (student) => `
                            <div class="occupant-row">
                                <div>
                                    <strong>
                                        ${escapeHtml(
                                            student.student_name ||
                                            student.full_name ||
                                            "Unknown"
                                        )}
                                    </strong>

                                    <div>
                                        ${escapeHtml(
                                            student.student_id || "—"
                                        )}
                                    </div>
                                </div>

                                <div>
                                    ${escapeHtml(
                                        student.bed_code ||
                                        student.bed_number ||
                                        student.bed_label ||
                                        "—"
                                    )}
                                </div>

                                <div>
                                    ${escapeHtml(
                                        student.level || "—"
                                    )}
                                </div>
                            </div>
                        `
                    )
                    .join("")}
            </div>
        `;
    } catch (error) {
        console.error("Room occupants error:", error);

        occupantsContainer.innerHTML = `
            <div class="error-state">
                Unable to load room occupants.
            </div>
        `;
    }
}

function closeRoomModal() {
    const modal = $("#roomModal");

    if (!modal) {
        return;
    }

    modal.classList.remove("open");
    modal.style.display = "none";
}


/* =========================================================
   ALLOCATIONS
   ========================================================= */

async function loadAllocations() {
    const table = $("#allocationsTable");

    if (!table) {
        return;
    }

    const block = $("#allocationBlockFilter")?.value || "";
    const gender = $("#genderFilter")?.value || "";
    const search = $("#studentSearch")?.value.trim() || "";

    const tbody =
        table.querySelector("tbody") ||
        table;

    tbody.innerHTML = `
        <tr>
            <td colspan="20">
                Loading allocations...
            </td>
        </tr>
    `;

    try {
        const data = await callRpc("admin_student_allocations", {
            p_search: search || null,
            p_block: block || null,
            p_gender: gender || null
        });

        const allocations = Array.isArray(data) ? data : [];

        if (!allocations.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="20">
                        No allocations found.
                    </td>
                </tr>
            `;

            return;
        }

        tbody.innerHTML = allocations
            .map((allocation) => renderAllocationRow(allocation))
            .join("");
    } catch (error) {
        console.error("Allocations load error:", error);

        tbody.innerHTML = `
            <tr>
                <td colspan="20">
                    Unable to load allocations.
                </td>
            </tr>
        `;
    }
}

function renderAllocationRow(allocation) {
    const allocationId =
        allocation.allocation_id ||
        allocation.id ||
        "";

    const studentId =
        allocation.student_id ||
        allocation.student_uuid ||
        "";

    const studentName =
        allocation.student_name ||
        allocation.full_name ||
        "—";

    const studentNumber =
        allocation.student_number ||
        allocation.student_id_number ||
        allocation.student_code ||
        allocation.student_id ||
        "—";

    const room =
        allocation.room_code ||
        allocation.room_number ||
        "—";

    const bed =
        allocation.bed_code ||
        allocation.bed_number ||
        allocation.bed_label ||
        "—";

    const block = allocation.block || "—";
    const gender = allocation.gender || "—";
    const level = allocation.level || "—";
    const status = allocation.status || "active";

    return `
        <tr
            data-allocation-id="${escapeHtml(allocationId)}"
            data-student-id="${escapeHtml(studentId)}"
        >
            <td>
                ${escapeHtml(allocation.allocation_number || "—")}
            </td>

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

            <td>
                <span class="status-badge ${escapeHtml(
                    normalise(status)
                )}">
                    ${escapeHtml(status)}
                </span>
            </td>

            <td>
                ${escapeHtml(
                    formatDate(
                        allocation.allocated_at ||
                        allocation.created_at
                    )
                )}
            </td>

            <td>
                <div class="table-actions">
                    <button
                        type="button"
                        class="btn btn-small btn-secondary allocation-reassign"
                        data-allocation-id="${escapeHtml(allocationId)}"
                        data-student-id="${escapeHtml(studentId)}"
                        data-current-bed-id="${escapeHtml(
                            allocation.bed_id || ""
                        )}"
                    >
                        Reassign
                    </button>

                    ${
                        isSuperAdmin()
                            ? `
                                <button
                                    type="button"
                                    class="btn btn-small btn-danger allocation-unassign"
                                    data-allocation-id="${escapeHtml(
                                        allocationId
                                    )}"
                                >
                                    Unassign
                                </button>
                            `
                            : ""
                    }
                </div>
            </td>
        </tr>
    `;
}


/* =========================================================
   AVAILABLE BEDS
   ========================================================= */

async function getAvailableBeds(gender) {
    const data = await callRpc("admin_available_beds", {
        p_gender: gender || null
    });

    return Array.isArray(data) ? data : [];
}

function buildBedOptions(beds) {
    if (!beds.length) {
        return "";
    }

    return beds
        .map((bed) => {
            const bedId =
                bed.bed_id ||
                bed.id ||
                "";

            const room =
                bed.room_code ||
                bed.room_number ||
                "Room";

            const bedName =
                bed.bed_code ||
                bed.bed_number ||
                bed.bed_label ||
                bed.name ||
                bedId;

            const block = bed.block || "";
            const floor =
                bed.floor === null ||
                bed.floor === undefined
                    ? ""
                    : `Floor ${bed.floor}`;

            const labelParts = [
                room,
                bedName,
                block,
                floor
            ].filter(Boolean);

            return `
                <option value="${escapeHtml(bedId)}">
                    ${escapeHtml(labelParts.join(" · "))}
                </option>
            `;
        })
        .join("");
}


/* =========================================================
   REASSIGN ALLOCATION
   ========================================================= */

async function reassignAllocation(allocationId, currentBedId) {
    if (!allocationId) {
        showToast("Allocation ID is missing.", "error");
        return;
    }

    let gender = "";

    const row = document.querySelector(
        `tr[data-allocation-id="${CSS.escape(allocationId)}"]`
    );

    if (row) {
        const cells = row.querySelectorAll("td");

        if (cells.length >= 5) {
            gender = cells[4]?.textContent.trim() || "";
        }
    }

    try {
        const beds = await getAvailableBeds(gender);

        if (!beds.length) {
            showToast(
                "There are no available beds for this student.",
                "error"
            );

            return;
        }

        const options = beds
            .map((bed, index) => {
                const bedId =
                    bed.bed_id ||
                    bed.id ||
                    "";

                const room =
                    bed.room_code ||
                    bed.room_number ||
                    "Room";

                const bedName =
                    bed.bed_code ||
                    bed.bed_number ||
                    bed.bed_label ||
                    "Bed";

                return `${index + 1}. ${room} · ${bedName} [${bedId}]`;
            })
            .join("\n");

        const answer = window.prompt(
            `Select the new bed by entering its number:\n\n${options}`
        );

        if (answer === null) {
            return;
        }

        const index = Number(answer) - 1;

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= beds.length
        ) {
            showToast("Invalid bed selection.", "error");
            return;
        }

        const selectedBed = beds[index];

        const newBedId =
            selectedBed.bed_id ||
            selectedBed.id;

        if (!newBedId) {
            showToast("Selected bed has no valid ID.", "error");
            return;
        }

        if (
            currentBedId &&
            String(currentBedId) === String(newBedId)
        ) {
            showToast(
                "Please select a different bed.",
                "error"
            );

            return;
        }

        const confirmed = window.confirm(
            "Are you sure you want to reassign this student to the selected bed?"
        );

        if (!confirmed) {
            return;
        }

        await callRpc("reassign_student", {
            p_allocation_id: allocationId,
            p_new_bed_id: newBedId
        });

        showToast("Student successfully reassigned.");

        await loadEverything();
    } catch (error) {
        console.error("Reassignment error:", error);

        showToast(
            error?.message ||
                "Unable to reassign the student.",
            "error"
        );
    }
}


/* =========================================================
   UNASSIGN
   ========================================================= */

async function unassignAllocation(allocationId) {
    if (!allocationId) {
        showToast("Allocation ID is missing.", "error");
        return;
    }

    if (!isSuperAdmin()) {
        showToast(
            "Only a Super Admin can unassign students.",
            "error"
        );

        return;
    }

    const confirmed = window.confirm(
        "Are you sure you want to unassign this student?\n\nThis will remove the current room allocation."
    );

    if (!confirmed) {
        return;
    }

    try {
        await callRpc("unassign_student", {
            p_allocation_id: allocationId
        });

        showToast("Student successfully unassigned.");

        await loadEverything();
    } catch (error) {
        console.error("Unassign error:", error);

        showToast(
            error?.message ||
                "Unable to unassign the student.",
            "error"
        );
    }
}


/* =========================================================
   UNALLOCATED STUDENTS
   ========================================================= */

async function loadUnallocated() {
    const tbody = $("#unallocatedTableBody");

    if (!tbody) {
        console.warn(
            "Element #unallocatedTableBody was not found."
        );

        return;
    }

    const search =
        $("#unallocatedSearch")?.value.trim() || "";

    tbody.innerHTML = `
        <tr>
            <td colspan="20">
                Loading unallocated students...
            </td>
        </tr>
    `;

    try {
        const data = await callRpc(
            "admin_unallocated_students",
            {
                p_search: search || null
            }
        );

        const students = Array.isArray(data) ? data : [];

        console.log(
            "Unallocated students returned:",
            students.length,
            students
        );

        if (!students.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="20">
                        ${
                            search
                                ? "No unallocated students match your search."
                                : "No unallocated students found."
                        }
                    </td>
                </tr>
            `;

            return;
        }

        tbody.innerHTML = students
            .map((student) => renderUnallocatedRow(student))
            .join("");
    } catch (error) {
        console.error(
            "Unallocated students load error:",
            error
        );

        tbody.innerHTML = `
            <tr>
                <td colspan="20">
                    Unable to load unallocated students.
                </td>
            </tr>
        `;

        showToast(
            error?.message ||
                "Unable to load unallocated students.",
            "error"
        );
    }
}

function renderUnallocatedRow(student) {
    const studentId =
        student.student_id ||
        student.id ||
        "";

    const studentName =
        student.student_name ||
        student.full_name ||
        "—";

    const level =
        student.level ||
        "—";

    const programme =
        student.programme ||
        "—";

    const gender =
        student.gender ||
        "—";

    const priority =
        student.priority_group ||
        "—";

    const email =
        student.email ||
        "—";

    return `
        <tr data-student-id="${escapeHtml(studentId)}">

            <td>
                <strong>
                    ${escapeHtml(studentName)}
                </strong>
            </td>

            <td>
                ${escapeHtml(studentId)}
            </td>

            <td>
                ${escapeHtml(level)}
            </td>

            <td>
                ${escapeHtml(programme)}
            </td>

            <td>
                ${escapeHtml(gender)}
            </td>

            <td>
                ${escapeHtml(priority)}
            </td>

            <td>
                ${escapeHtml(email)}
            </td>

            <td>
                <button
                    type="button"
                    class="btn btn-small btn-primary assign-unallocated"
                    data-student-id="${escapeHtml(studentId)}"
                >
                    Assign Room
                </button>
            </td>

        </tr>
    `;
}


/* =========================================================
   ASSIGN UNALLOCATED STUDENT
   ========================================================= */

async function assignUnallocatedStudent(studentId) {
    if (!studentId) {
        showToast("Student ID is missing.", "error");
        return;
    }

    try {
        const studentRow = document.querySelector(
            `tr[data-student-id="${CSS.escape(studentId)}"]`
        );

        let gender = "";

        if (studentRow) {
            const cells = studentRow.querySelectorAll("td");

            if (cells.length >= 5) {
                gender =
                    cells[4]?.textContent.trim() || "";
            }
        }

        let beds = await getAvailableBeds(gender);

        if (!beds.length) {
            showToast(
                "There are no available beds for this student.",
                "error"
            );

            return;
        }

        const options = beds
            .map((bed, index) => {
                const room =
                    bed.room_code ||
                    bed.room_number ||
                    "Room";

                const bedName =
                    bed.bed_code ||
                    bed.bed_number ||
                    bed.bed_label ||
                    "Bed";

                const block =
                    bed.block || "";

                return `${index + 1}. ${room} · ${bedName}${block ? ` · ${block}` : ""}`;
            })
            .join("\n");

        const answer = window.prompt(
            `Select the bed to assign:\n\n${options}`
        );

        if (answer === null) {
            return;
        }

        const index = Number(answer) - 1;

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= beds.length
        ) {
            showToast(
                "Invalid bed selection.",
                "error"
            );

            return;
        }

        const selectedBed = beds[index];

        const bedId =
            selectedBed.bed_id ||
            selectedBed.id;

        if (!bedId) {
            showToast(
                "Selected bed has no valid ID.",
                "error"
            );

            return;
        }

        const confirmed = window.confirm(
            "Assign this student to the selected bed?"
        );

        if (!confirmed) {
            return;
        }

        await callRpc("admin_assign_student", {
            p_student_id: studentId,
            p_bed_id: bedId
        });

        showToast(
            "Student successfully assigned."
        );

        await loadEverything();
    } catch (error) {
        console.error(
            "Assign unallocated student error:",
            error
        );

        showToast(
            error?.message ||
                "Unable to assign this student.",
            "error"
        );
    }
}


/* =========================================================
   AUDIT LOGS
   ========================================================= */

async function loadAuditLogs() {
    const table = $("#auditTable");

    if (!table) {
        return;
    }

    const tbody =
        table.querySelector("tbody") ||
        table;

    tbody.innerHTML = `
        <tr>
            <td colspan="20">
                Loading audit logs...
            </td>
        </tr>
    `;

    try {
        const data = await callRpc(
            "admin_audit_logs",
            {
                p_limit: 100
            }
        );

        const logs = Array.isArray(data)
            ? data
            : [];

        if (!logs.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="20">
                        No audit records found.
                    </td>
                </tr>
            `;

            return;
        }

        tbody.innerHTML = logs
            .map((log) => {
                return `
                    <tr>
                        <td>
                            ${escapeHtml(
                                formatDate(
                                    log.created_at ||
                                    log.timestamp
                                )
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                log.action ||
                                log.event ||
                                "—"
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                log.actor_email ||
                                log.user_email ||
                                "—"
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                log.target ||
                                log.target_type ||
                                "—"
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                log.details ||
                                log.description ||
                                ""
                            )}
                        </td>
                    </tr>
                `;
            })
            .join("");
    } catch (error) {
        console.error("Audit log error:", error);

        tbody.innerHTML = `
            <tr>
                <td colspan="20">
                    Unable to load audit logs.
                </td>
            </tr>
        `;
    }
}


/* =========================================================
   LOAD EVERYTHING
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
            console.error(
                `Admin section ${index} failed:`,
                result.reason
            );
        }
    });

    setText("#lastUpdated", formatDate(new Date()));
}


/* =========================================================
   CSV EXPORT
   ========================================================= */

function downloadCsv(filename, rows) {
    if (!rows || !rows.length) {
        showToast(
            "There is no data to export.",
            "error"
        );

        return;
    }

    const csv = rows
        .map((row) =>
            row
                .map((value) => csvEscape(value))
                .join(",")
        )
        .join("\r\n");

    const blob = new Blob(
        [csv],
        {
            type: "text/csv;charset=utf-8;"
        }
    );

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
        const block =
            $("#allocationBlockFilter")?.value || "";

        const gender =
            $("#genderFilter")?.value || "";

        const search =
            $("#studentSearch")?.value.trim() || "";

        const data = await callRpc(
            "admin_student_allocations",
            {
                p_search: search || null,
                p_block: block || null,
                p_gender: gender || null
            }
        );

        const allocations =
            Array.isArray(data)
                ? data
                : [];

        const rows = [
            [
                "Allocation Number",
                "Student Name",
                "Student ID",
                "Level",
                "Programme",
                "Gender",
                "Block",
                "Room",
                "Bed",
                "Status",
                "Allocated At"
            ]
        ];

        allocations.forEach((item) => {
            rows.push([
                item.allocation_number || "",
                item.student_name || "",
                item.student_number ||
                    item.student_id_number ||
                    item.student_id ||
                    "",
                item.level || "",
                item.programme || "",
                item.gender || "",
                item.block || "",
                item.room_code ||
                    item.room_number ||
                    "",
                item.bed_code ||
                    item.bed_number ||
                    "",
                item.status || "",
                formatDate(
                    item.allocated_at ||
                    item.created_at
                )
            ]);
        });

        downloadCsv(
            "uhas-asogli-hall-allocations.csv",
            rows
        );

        showToast(
            "Allocations exported successfully."
        );
    } catch (error) {
        console.error(
            "Allocation export error:",
            error
        );

        showToast(
            "Unable to export allocations.",
            "error"
        );
    }
}

async function exportUnallocated() {
    try {
        const search =
            $("#unallocatedSearch")?.value.trim() || "";

        const data = await callRpc(
            "admin_unallocated_students",
            {
                p_search: search || null
            }
        );

        const students =
            Array.isArray(data)
                ? data
                : [];

        const rows = [
            [
                "Student Name",
                "Student ID",
                "Level",
                "Programme",
                "Gender",
                "Priority Group",
                "Email"
            ]
        ];

        students.forEach((student) => {
            rows.push([
                student.student_name ||
                    student.full_name ||
                    "",
                student.student_id ||
                    student.id ||
                    "",
                student.level || "",
                student.programme || "",
                student.gender || "",
                student.priority_group || "",
                student.email || ""
            ]);
        });

        downloadCsv(
            "uhas-asogli-hall-unallocated-students.csv",
            rows
        );

        showToast(
            "Unallocated students exported successfully."
        );
    } catch (error) {
        console.error(
            "Unallocated export error:",
            error
        );

        showToast(
            "Unable to export unallocated students.",
            "error"
        );
    }
}

function printReport() {
    window.print();
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function activateSection(sectionId) {
    const sections = $$(".admin-section");
    const navItems = $$(".nav-item[data-section]");

    sections.forEach((section) => {
        const matches =
            section.id === sectionId;

        section.classList.toggle(
            "active",
            matches
        );

        if (matches) {
            section.style.display = "";
        } else {
            section.style.display = "none";
        }
    });

    navItems.forEach((item) => {
        item.classList.toggle(
            "active",
            item.dataset.section === sectionId
        );
    });

    const pageTitle = $("#pageTitle");

    const activeNav = document.querySelector(
        `.nav-item[data-section="${CSS.escape(sectionId)}"]`
    );

    if (pageTitle && activeNav) {
        pageTitle.textContent =
            activeNav.dataset.title ||
            activeNav.textContent.trim();
    }

    const sidebar =
        $("#adminSidebar");

    if (sidebar) {
        sidebar.classList.remove("open");
    }
}

function initialiseNavigation() {
    $$(".nav-item[data-section]").forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();

            const sectionId =
                item.dataset.section;

            if (!sectionId) {
                return;
            }

            activateSection(sectionId);
        });
    });

    const menuButton =
        $("#mobileMenuButton");

    if (menuButton) {
        menuButton.addEventListener(
            "click",
            () => {
                const sidebar =
                    $("#adminSidebar");

                if (sidebar) {
                    sidebar.classList.toggle(
                        "open"
                    );
                }
            }
        );
    }
}


/* =========================================================
   ADMIN MANAGEMENT
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

    const addButton =
        $("#addAdminButton");

    if (addButton) {
        addButton.addEventListener(
            "click",
            () => openAdminModal()
        );
    }

    const closeButton =
        $("#closeAdminModalButton");

    if (closeButton) {
        closeButton.addEventListener(
            "click",
            closeAdminModal
        );
    }

    const cancelButton =
        $("#cancelAdminButton");

    if (cancelButton) {
        cancelButton.addEventListener(
            "click",
            closeAdminModal
        );
    }

    const form =
        $("#adminForm");

    if (form) {
        form.addEventListener(
            "submit",
            handleAdminFormSubmit
        );
    }

    await loadAdministrators();
}

async function loadAdministrators() {
    if (!isSuperAdmin()) {
        return;
    }

    const tbody =
        $("#administratorsTableBody");

    if (!tbody) {
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td colspan="10">
                Loading administrators...
            </td>
        </tr>
    `;

    try {
        const { data, error } =
            await supabase.functions.invoke(
                "admin-management",
                {
                    body: {
                        action: "list"
                    }
                }
            );

        if (error) {
            throw error;
        }

        const administrators =
            Array.isArray(data)
                ? data
                : Array.isArray(data?.administrators)
                    ? data.administrators
                    : [];

        if (!administrators.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10">
                        No administrators found.
                    </td>
                </tr>
            `;

            return;
        }

        tbody.innerHTML =
            administrators
                .map(
                    (admin) => `
                        <tr>
                            <td>
                                ${escapeHtml(
                                    admin.email || "—"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    admin.role || "admin"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    formatDate(
                                        admin.created_at
                                    )
                                )}
                            </td>

                            <td>
                                <div class="table-actions">

                                    <button
                                        type="button"
                                        class="btn btn-small btn-secondary edit-admin"
                                        data-admin-id="${escapeHtml(
                                            admin.id ||
                                            admin.user_id ||
                                            ""
                                        )}"
                                        data-admin-email="${escapeHtml(
                                            admin.email || ""
                                        )}"
                                        data-admin-role="${escapeHtml(
                                            admin.role || "admin"
                                        )}"
                                    >
                                        Edit
                                    </button>

                                    <button
                                        type="button"
                                        class="btn btn-small btn-danger delete-admin"
                                        data-admin-id="${escapeHtml(
                                            admin.id ||
                                            admin.user_id ||
                                            ""
                                        )}"
                                        data-admin-email="${escapeHtml(
                                            admin.email || ""
                                        )}"
                                    >
                                        Remove
                                    </button>

                                </div>
                            </td>
                        </tr>
                    `
                )
                .join("");
    } catch (error) {
        console.error(
            "Administrator load error:",
            error
        );

        tbody.innerHTML = `
            <tr>
                <td colspan="10">
                    Unable to load administrators.
                </td>
            </tr>
        `;
    }
}

function openAdminModal(admin = null) {
    if (!isSuperAdmin()) {
        showToast(
            "Only a Super Admin can manage administrators.",
            "error"
        );

        return;
    }

    const modal =
        $("#adminManagementModal");

    const form =
        $("#adminForm");

    if (!modal || !form) {
        return;
    }

    form.reset();

    setText(
        "#adminModalTitle",
        admin ? "Edit Administrator" : "Add Administrator"
    );

    if ($("#adminEmail")) {
        $("#adminEmail").value =
            admin?.email || "";
    }

    if ($("#adminRoleSelect")) {
        $("#adminRoleSelect").value =
            admin?.role || "admin";
    }

    if ($("#adminPassword")) {
        $("#adminPassword").value = "";
    }

    if ($("#adminFormError")) {
        $("#adminFormError").textContent = "";
    }

    form.dataset.adminId =
        admin?.id ||
        admin?.user_id ||
        "";

    modal.classList.add("open");
    modal.style.display = "";
}

function closeAdminModal() {
    const modal =
        $("#adminManagementModal");

    if (!modal) {
        return;
    }

    modal.classList.remove("open");
    modal.style.display = "none";
}

async function handleAdminFormSubmit(event) {
    event.preventDefault();

    if (!isSuperAdmin()) {
        showToast(
            "Only a Super Admin can manage administrators.",
            "error"
        );

        return;
    }

    const form =
        $("#adminForm");

    const email =
        $("#adminEmail")?.value.trim();

    const password =
        $("#adminPassword")?.value || "";

    const role =
        $("#adminRoleSelect")?.value ||
        "admin";

    const errorElement =
        $("#adminFormError");

    const saveButton =
        $("#saveAdminButton");

    if (errorElement) {
        errorElement.textContent = "";
    }

    if (!email) {
        if (errorElement) {
            errorElement.textContent =
                "Email address is required.";
        }

        return;
    }

    const adminId =
        form?.dataset.adminId || "";

    if (!adminId && !password) {
        if (errorElement) {
            errorElement.textContent =
                "Password is required for a new administrator.";
        }

        return;
    }

    setButtonLoading(
        saveButton,
        true,
        "Saving..."
    );

    try {
        const action =
            adminId ? "update" : "create";

        const payload = {
            action,
            email,
            role
        };

        if (adminId) {
            payload.user_id = adminId;
        }

        if (password) {
            payload.password = password;
        }

        const { data, error } =
            await supabase.functions.invoke(
                "admin-management",
                {
                    body: payload
                }
            );

        if (error) {
            throw error;
        }

        if (data?.error) {
            throw new Error(data.error);
        }

        closeAdminModal();

        showToast(
            adminId
                ? "Administrator updated successfully."
                : "Administrator created successfully."
        );

        await loadAdministrators();
    } catch (error) {
        console.error(
            "Administrator save error:",
            error
        );

        if (errorElement) {
            errorElement.textContent =
                error?.message ||
                "Unable to save administrator.";
        }
    } finally {
        setButtonLoading(
            saveButton,
            false
        );
    }
}

async function changeAdministratorRole(
    adminId,
    email,
    currentRole
) {
    if (!isSuperAdmin()) {
        showToast(
            "Only a Super Admin can change administrator roles.",
            "error"
        );

        return;
    }

    const newRole =
        normalise(currentRole) ===
        "super_admin"
            ? "admin"
            : "super_admin";

    const confirmed = window.confirm(
        `Change ${email}'s role to ${
            newRole === "super_admin"
                ? "Super Admin"
                : "Admin"
        }?`
    );

    if (!confirmed) {
        return;
    }

    try {
        const { data, error } =
            await supabase.functions.invoke(
                "admin-management",
                {
                    body: {
                        action: "update",
                        user_id: adminId,
                        role: newRole
                    }
                }
            );

        if (error) {
            throw error;
        }

        if (data?.error) {
            throw new Error(data.error);
        }

        showToast(
            "Administrator role updated."
        );

        await loadAdministrators();
    } catch (error) {
        console.error(
            "Role change error:",
            error
        );

        showToast(
            error?.message ||
                "Unable to change administrator role.",
            "error"
        );
    }
}

async function deleteAdministrator(
    adminId,
    email
) {
    if (!isSuperAdmin()) {
        showToast(
            "Only a Super Admin can remove administrators.",
            "error"
        );

        return;
    }

    const confirmed = window.confirm(
        `Remove administrator ${email}?\n\nThis action cannot be undone.`
    );

    if (!confirmed) {
        return;
    }

    try {
        const { data, error } =
            await supabase.functions.invoke(
                "admin-management",
                {
                    body: {
                        action: "delete",
                        user_id: adminId
                    }
                }
            );

        if (error) {
            throw error;
        }

        if (data?.error) {
            throw new Error(data.error);
        }

        showToast(
            "Administrator removed successfully."
        );

        await loadAdministrators();
    } catch (error) {
        console.error(
            "Administrator delete error:",
            error
        );

        showToast(
            error?.message ||
                "Unable to remove administrator.",
            "error"
        );
    }
}


/* =========================================================
   EVENT DELEGATION
   ========================================================= */

function initialiseAllocationActions() {
    const table =
        $("#allocationsTable");

    if (!table || table.dataset.eventsAttached) {
        return;
    }

    table.dataset.eventsAttached = "true";

    table.addEventListener(
        "click",
        async (event) => {
            const reassignButton =
                event.target.closest(
                    ".allocation-reassign"
                );

            if (reassignButton) {
                const allocationId =
                    reassignButton.dataset.allocationId;

                const currentBedId =
                    reassignButton.dataset.currentBedId;

                await reassignAllocation(
                    allocationId,
                    currentBedId
                );

                return;
            }

            const unassignButton =
                event.target.closest(
                    ".allocation-unassign"
                );

            if (unassignButton) {
                await unassignAllocation(
                    unassignButton.dataset.allocationId
                );
            }
        }
    );
}

function initialiseUnallocatedActions() {
    const tbody =
        $("#unallocatedTableBody");

    if (!tbody || tbody.dataset.eventsAttached) {
        return;
    }

    tbody.dataset.eventsAttached = "true";

    tbody.addEventListener(
        "click",
        async (event) => {
            const button =
                event.target.closest(
                    ".assign-unallocated"
                );

            if (!button) {
                return;
            }

            await assignUnallocatedStudent(
                button.dataset.studentId
            );
        }
    );
}

function initialiseAdminManagementActions() {
    const tbody =
        $("#administratorsTableBody");

    if (!tbody || tbody.dataset.eventsAttached) {
        return;
    }

    tbody.dataset.eventsAttached = "true";

    tbody.addEventListener(
        "click",
        async (event) => {
            const editButton =
                event.target.closest(
                    ".edit-admin"
                );

            if (editButton) {
                openAdminModal({
                    id:
                        editButton.dataset.adminId,
                    email:
                        editButton.dataset.adminEmail,
                    role:
                        editButton.dataset.adminRole
                });

                return;
            }

            const deleteButton =
                event.target.closest(
                    ".delete-admin"
                );

            if (deleteButton) {
                await deleteAdministrator(
                    deleteButton.dataset.adminId,
                    deleteButton.dataset.adminEmail
                );
            }
        }
    );
}

function initialiseRoomActions() {
    const grid =
        $("#roomsGrid");

    if (!grid || grid.dataset.eventsAttached) {
        return;
    }

    grid.dataset.eventsAttached = "true";

    grid.addEventListener(
        "click",
        async (event) => {
            const card =
                event.target.closest(
                    ".room-card"
                );

            if (!card) {
                return;
            }

            await openRoomModal(
                card.dataset.roomId
            );
        }
    );
}


/* =========================================================
   SEARCH / FILTERS
   ========================================================= */

function initialiseSearchAndFilters() {
    const blockFilter =
        $("#blockFilter");

    if (
        blockFilter &&
        !blockFilter.dataset.eventsAttached
    ) {
        blockFilter.dataset.eventsAttached =
            "true";

        blockFilter.addEventListener(
            "change",
            loadRooms
        );
    }

    const allocationBlockFilter =
        $("#allocationBlockFilter");

    if (
        allocationBlockFilter &&
        !allocationBlockFilter.dataset.eventsAttached
    ) {
        allocationBlockFilter.dataset.eventsAttached =
            "true";

        allocationBlockFilter.addEventListener(
            "change",
            loadAllocations
        );
    }

    const genderFilter =
        $("#genderFilter");

    if (
        genderFilter &&
        !genderFilter.dataset.eventsAttached
    ) {
        genderFilter.dataset.eventsAttached =
            "true";

        genderFilter.addEventListener(
            "change",
            loadAllocations
        );
    }

    const studentSearch =
        $("#studentSearch");

    if (
        studentSearch &&
        !studentSearch.dataset.eventsAttached
    ) {
        studentSearch.dataset.eventsAttached =
            "true";

        studentSearch.addEventListener(
            "input",
            () => {
                window.clearTimeout(
                    searchTimer
                );

                searchTimer =
                    window.setTimeout(
                        loadAllocations,
                        300
                    );
            }
        );
    }

    const unallocatedSearch =
        $("#unallocatedSearch");

    if (
        unallocatedSearch &&
        !unallocatedSearch.dataset.eventsAttached
    ) {
        unallocatedSearch.dataset.eventsAttached =
            "true";

        unallocatedSearch.addEventListener(
            "input",
            () => {
                window.clearTimeout(
                    unallocatedSearchTimer
                );

                unallocatedSearchTimer =
                    window.setTimeout(
                        loadUnallocated,
                        300
                    );
            }
        );
    }
}


/* =========================================================
   BUTTONS
   ========================================================= */

function initialiseButtons() {
    const refreshButton =
        $("#refreshButton");

    if (
        refreshButton &&
        !refreshButton.dataset.eventsAttached
    ) {
        refreshButton.dataset.eventsAttached =
            "true";

        refreshButton.addEventListener(
            "click",
            async () => {
                setButtonLoading(
                    refreshButton,
                    true,
                    "Refreshing..."
                );

                try {
                    await loadEverything();

                    showToast(
                        "Dashboard refreshed."
                    );
                } finally {
                    setButtonLoading(
                        refreshButton,
                        false
                    );
                }
            }
        );
    }

    const exportAllocationsButton =
        $("#exportAllocations");

    if (
        exportAllocationsButton &&
        !exportAllocationsButton.dataset.eventsAttached
    ) {
        exportAllocationsButton.dataset.eventsAttached =
            "true";

        exportAllocationsButton.addEventListener(
            "click",
            exportAllocations
        );
    }

    const exportUnallocatedButton =
        $("#exportUnallocated");

    if (
        exportUnallocatedButton &&
        !exportUnallocatedButton.dataset.eventsAttached
    ) {
        exportUnallocatedButton.dataset.eventsAttached =
            "true";

        exportUnallocatedButton.addEventListener(
            "click",
            exportUnallocated
        );
    }

    const printButton =
        $("#printReport");

    if (
        printButton &&
        !printButton.dataset.eventsAttached
    ) {
        printButton.dataset.eventsAttached =
            "true";

        printButton.addEventListener(
            "click",
            printReport
        );
    }

    const closeRoomButton =
        $("#closeModal");

    if (
        closeRoomButton &&
        !closeRoomButton.dataset.eventsAttached
    ) {
        closeRoomButton.dataset.eventsAttached =
            "true";

        closeRoomButton.addEventListener(
            "click",
            closeRoomModal
        );
    }

    const modal =
        $("#roomModal");

    if (
        modal &&
        !modal.dataset.eventsAttached
    ) {
        modal.dataset.eventsAttached =
            "true";

        modal.addEventListener(
            "click",
            (event) => {
                if (
                    event.target === modal
                ) {
                    closeRoomModal();
                }
            }
        );
    }

    const adminModal =
        $("#adminManagementModal");

    if (
        adminModal &&
        !adminModal.dataset.eventsAttached
    ) {
        adminModal.dataset.eventsAttached =
            "true";

        adminModal.addEventListener(
            "click",
            (event) => {
                if (
                    event.target === adminModal
                ) {
                    closeAdminModal();
                }
            }
        );
    }
}


/* =========================================================
   GLOBAL KEYBOARD HANDLERS
   ========================================================= */

function initialiseKeyboardHandlers() {
    if (
        document.body.dataset.keyboardAttached
    ) {
        return;
    }

    document.body.dataset.keyboardAttached =
        "true";

    document.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key === "Escape"
            ) {
                closeRoomModal();
                closeAdminModal();
            }
        }
    );
}


/* =========================================================
   INITIALISE
   ========================================================= */

async function initialise() {
    if (isInitialising) {
        return;
    }

    isInitialising = true;

    try {
        initialiseNavigation();
        initialiseAllocationActions();
        initialiseUnallocatedActions();
        initialiseAdminManagementActions();
        initialiseRoomActions();
        initialiseSearchAndFilters();
        initialiseButtons();
        initialiseKeyboardHandlers();

        const session =
            await getCurrentSession();

        if (!session) {
            showLogin();
            return;
        }

        currentUser =
            session.user;

        await loadCurrentProfile();

        showApp();

        updateRoleDisplay();

        await initialiseAdminManagement();

        await loadEverything();

        activateSection("dashboardSection");
    } catch (error) {
        console.error(
            "Admin initialisation error:",
            error
        );

        showLogin();

        showToast(
            error?.message ||
                "Unable to initialise the admin portal.",
            "error"
        );
    } finally {
        isInitialising = false;
    }
}


/* =========================================================
   AUTH STATE CHANGES
   ========================================================= */

supabase.auth.onAuthStateChange(
    async (_event, session) => {
        if (!session) {
            currentUser = null;
            currentProfile = null;

            showLogin();

            return;
        }

        currentUser =
            session.user;

        await loadCurrentProfile();

        showApp();

        updateRoleDisplay();

        await initialiseAdminManagement();

        await loadEverything();
    }
);


/* =========================================================
   FORM EVENTS
   ========================================================= */

const loginForm =
    $("#loginForm");

if (loginForm) {
    loginForm.addEventListener(
        "submit",
        handleLogin
    );
}

const logoutButton =
    $("#logoutButton");

if (logoutButton) {
    logoutButton.addEventListener(
        "click",
        handleLogout
    );
}

const forgotPasswordLink =
    $("#forgotPasswordLink");

if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener(
        "click",
        handlePasswordReset
    );
}


/* =========================================================
   START APPLICATION
   ========================================================= */

initialise();