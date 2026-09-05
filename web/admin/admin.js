import {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
} from "../config.js";

import {
    createClient
} from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

const $ = (selector) =>
    document.querySelector(selector);

const loginView = $("#loginView");
const appView = $("#appView");

let currentAllocations = [];
let currentUnallocated = [];
let currentRooms = [];
let currentAudit = [];


/* ============================================================
   Utilities
   ============================================================ */

function showToast(message, type = "") {

    const toast = $("#toast");

    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.className = "toast";
    }, 3000);
}


function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function formatDate(value) {

    if (!value) {
        return "—";
    }

    return new Intl.DateTimeFormat(
        undefined,
        {
            dateStyle: "medium",
            timeStyle: "short"
        }
    ).format(new Date(value));
}


function toNumber(value, fallback = 0) {

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


/* ============================================================
   Authentication
   ============================================================ */

async function getAdminRole() {

    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error || !user) {
        throw new Error(
            "Authentication session not found."
        );
    }

    const {
        data,
        error: profileError
    } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (profileError || !data) {
        throw new Error(
            "Administrator profile not found."
        );
    }

    if (
        !["admin", "super_admin"]
            .includes(data.role)
    ) {

        await supabase.auth.signOut();

        throw new Error(
            "This account is not authorised for administration."
        );
    }

    return data.role;
}


/* ============================================================
   RPC helper
   ============================================================ */

async function rpc(name, args = {}) {

    const {
        data,
        error
    } = await supabase.rpc(
        name,
        args
    );

    if (error) {

        console.error(
            name,
            error
        );

        throw new Error(
            error.message ||
            `Unable to load ${name}.`
        );
    }

    return data;
}


/* ============================================================
   Dashboard
   ============================================================ */

async function loadDashboard() {

    const summary =
        await rpc(
            "admin_dashboard_summary"
        );

    if (!summary) {

        throw new Error(
            "Dashboard summary returned no data."
        );
    }

    /*
     * admin_dashboard_summary() returns:
     *
     * {
     *   students: {...},
     *   rooms: {...},
     *   beds: {...},
     *   holds: {...},
     *   allocations: {...},
     *   gender: {...},
     *   allocation_open: true/false
     * }
     */

    const students =
        summary.students || {};

    const rooms =
        summary.rooms || {};

    const beds =
        summary.beds || {};

    const holds =
        summary.holds || {};

    const allocations =
        summary.allocations || {};

    $("#totalRooms").textContent =
        toNumber(rooms.total);

    $("#totalBeds").textContent =
        toNumber(beds.total);

    $("#occupiedBeds").textContent =
        toNumber(beds.occupied);

    $("#availableBeds").textContent =
        toNumber(beds.available);

    $("#activeHolds").textContent =
        toNumber(holds.active);

    $("#activeAllocations").textContent =
        toNumber(
            allocations.active ??
            students.allocated
        );

    $("#unallocatedStudents").textContent =
        toNumber(students.unallocated);

    const allocationOpen =
        summary.allocation_open === true;

    $("#allocationStatus").textContent =
        allocationOpen
            ? "OPEN"
            : "CLOSED";

    $("#lastUpdated").textContent =
        `Updated ${new Date().toLocaleTimeString()}`;
}


/* ============================================================
   Rooms
   ============================================================ */

async function loadRooms() {

    const block =
        $("#blockFilter").value;

    currentRooms =
        await rpc(
            "admin_rooms",
            {
                p_block:
                    block || null
            }
        );

    renderRooms();
}


function renderRooms() {

    const container =
        $("#roomsGrid");

    if (!currentRooms?.length) {

        container.innerHTML = `
            <div class="empty-state">
                No rooms found.
            </div>
        `;

        return;
    }

    container.innerHTML =
        currentRooms.map(room => {

            const capacity =
                toNumber(room.capacity);

            const occupied =
                toNumber(
                    room.occupied_beds
                );

            const available =
                toNumber(
                    room.available_beds,
                    Math.max(
                        capacity - occupied,
                        0
                    )
                );

            const percent =
                toNumber(
                    room.occupancy_percent,
                    capacity
                        ? Math.round(
                            (occupied / capacity) * 100
                        )
                        : 0
                );

            const gender =
                room.room_gender ||
                "Neutral";

            const locked =
                room.temporarily_locked === true ||
                room.bookable === false;

            /*
             * IMPORTANT:
             * RPC returns room_id, not id.
             */
            const roomId =
                room.room_id;

            return `
                <button
                    class="room-card"
                    data-room-id="${escapeHtml(roomId)}"
                >

                    <div class="room-card-top">

                        <span class="room-code">
                            ${escapeHtml(
                                room.room_code
                            )}
                        </span>

                        <span class="room-gender">
                            ${escapeHtml(gender)}
                        </span>

                    </div>

                    <div class="room-number">
                        Room ${escapeHtml(
                            room.room_number
                        )}
                    </div>

                    <div class="room-meta">
                        ${escapeHtml(
                            room.block
                        )}
                        ·
                        ${escapeHtml(
                            room.floor ?? ""
                        )}
                    </div>

                    <div class="progress">
                        <span
                            style="width:${Math.min(
                                Math.max(percent, 0),
                                100
                            )}%"
                        ></span>
                    </div>

                    <div class="room-footer">

                        <span>
                            ${occupied}/${capacity}
                            occupied
                        </span>

                        <span>
                            ${available}
                            available
                        </span>

                    </div>

                    ${
                        locked
                            ? `
                                <div class="room-status locked">
                                    Locked
                                </div>
                            `
                            : ""
                    }

                </button>
            `;

        }).join("");

    document
        .querySelectorAll(".room-card")
        .forEach(card => {

            card.addEventListener(
                "click",
                () =>
                    openRoom(
                        card.dataset.roomId
                    )
            );

        });
}


/* ============================================================
   Room occupants
   ============================================================ */

async function openRoom(roomId) {

    try {

        const room =
            currentRooms.find(
                item =>
                    String(item.room_id) ===
                    String(roomId)
            );

        const occupants =
            await rpc(
                "admin_room_occupants",
                {
                    p_room_id:
                        roomId
                }
            );

        $("#modalRoomTitle").textContent =
            room?.room_code ||
            "Room";

        $("#modalRoomSubtitle").textContent =
            room
                ? `${room.block} · Room ${room.room_number}`
                : "";

        renderOccupants(
            occupants
        );

        $("#roomModal")
            .classList
            .remove("hidden");

    } catch (error) {

        showToast(
            error.message,
            "error"
        );
    }
}

function closeRoomModal() {

    const modal =
        $("#roomModal");

    if (modal) {

        modal.classList.add(
            "hidden"
        );

    }

}
const closeRoomButton =
    $("#closeModal");

if (closeRoomButton) {

    closeRoomButton.addEventListener(
        "click",
        closeRoomModal
    );

}
function renderOccupants(occupants) {

    const container =
        $("#roomOccupants");

    if (!occupants?.length) {

        container.innerHTML = `
            <div class="empty-state">
                No occupants in this room.
            </div>
        `;

        return;
    }

    container.innerHTML =
        occupants.map(student => `

            <div class="occupant-card">

                <div class="occupant-bed">
                    Bed ${escapeHtml(
                        student.bed_number
                    )}
                </div>

                <div>

                    <strong>
                        ${escapeHtml(
                            student.student_name
                        )}
                    </strong>

                    <div class="muted">
                        ${escapeHtml(
                            student.student_id
                        )}
                    </div>

                    <div class="muted">
                        ${escapeHtml(
                            student.level ?? ""
                        )}
                        ·
                        ${escapeHtml(
                            student.programme ?? ""
                        )}
                    </div>

                    <div class="muted">
                        ${escapeHtml(
                            student.email ?? ""
                        )}
                    </div>

                </div>

                <div class="occupant-gender">
                    ${escapeHtml(
                        student.gender ?? "—"
                    )}
                </div>

            </div>

        `).join("");
}


/* ============================================================
   Student allocations
   ============================================================ */

async function loadAllocations() {

    currentAllocations =
        await rpc(
            "admin_student_allocations",
            {
                p_search: null,

                p_block:
                    $("#allocationBlockFilter")
                        .value || null,

                p_gender:
                    $("#genderFilter")
                        .value || null
            }
        );

    renderAllocations();
}


function renderAllocations() {

    const tbody =
        $("#allocationsTable");

    const searchInput =
        $("#studentSearch");

    const search =
        searchInput
            ?.value
            ?.trim()
            ?.toLowerCase() || "";

    const filtered =
        (currentAllocations || []).filter(row => {

            if (!search) {
                return true;
            }

            const searchableText = [
                row.student_id,
                row.student_name,
                row.email,
                row.level,
                row.programme,
                row.gender,
                row.block,
                row.room_code,
                row.room_number,
                row.bed_number,
                row.allocation_number
            ]
                .filter(value =>
                    value !== null &&
                    value !== undefined
                )
                .join(" ")
                .toLowerCase();

            return searchableText.includes(search);
        });


    if (!filtered.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="9">
                    <div class="empty-state">
                        No students match your search.
                    </div>
                </td>
            </tr>
        `;

        return;
    }


    tbody.innerHTML =
        filtered.map(row => `

            <tr>

                <td>
                    ${escapeHtml(
                        row.student_id
                    )}
                </td>

                <td>
                    <strong>
                        ${escapeHtml(
                            row.student_name
                        )}
                    </strong>
                </td>

                <td>
                    ${escapeHtml(
                        row.level ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.gender ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.block ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.room_code ??
                        row.room_number ??
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.bed_number ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.allocation_number ??
                        "—"
                    )}
                </td>

                <td>

                    ${
                        $("#adminRole")
                            ?.textContent
                            ?.trim()
                            ?.toLowerCase() ===
                        "super admin"

                            ? `
                                <div class="table-actions">

                                    <button
                                        type="button"
                                        class="table-action"
                                        data-reassign-allocation="${escapeHtml(
                                            row.id
                                        )}"
                                    >
                                        Reassign
                                    </button>

                                    <button
                                        type="button"
                                        class="table-action danger"
                                        data-unassign-allocation="${escapeHtml(
                                            row.id
                                        )}"
                                    >
                                        Unassign
                                    </button>

                                </div>
                              `

                            : `
                                <span class="muted-text">
                                    —
                                </span>
                              `
                    }

                </td>

            </tr>

        `).join("");
}
async function reassignStudent(allocationId) {

    if (!allocationId) {

        showToast(
            "Allocation ID is missing.",
            "error"
        );

        return;
    }


    if (
        $("#adminRole")
            ?.textContent
            ?.trim()
            ?.toLowerCase() !==
        "super admin"
    ) {

        showToast(
            "Super Admin privileges are required.",
            "error"
        );

        return;
    }


    const allocation =
        (currentAllocations || []).find(
            (row) =>
                String(row.id) ===
                String(allocationId)
        );


    if (!allocation) {

        showToast(
            "Allocation details could not be found.",
            "error"
        );

        return;
    }


    let availableBeds = [];


    try {

        availableBeds =
            await rpc(
                "admin_available_beds",
                {
                    p_gender:
                        allocation.gender || null
                }
            );

    } catch (error) {

        console.error(
            "Available beds error:",
            error
        );

        showToast(
            error.message ||
            "Unable to load available beds.",
            "error"
        );

        return;
    }


    if (!Array.isArray(availableBeds)) {

        showToast(
            "Unable to load available beds.",
            "error"
        );

        return;
    }


    availableBeds =
        availableBeds.map(
            (bed) => ({
                id:
                    bed.bed_id,

                label:
    String(bed.block || "") +
    " - " +
    String(
        bed.room_code ||
        bed.room_number ||
        ""
    ) +
    " - Bed " +
    String(bed.bed_number)
            })
        );


    if (!availableBeds.length) {

        showToast(
            "No suitable available beds were found.",
            "error"
        );

        return;
    }


    const selection =
        window.prompt(
            "Enter the number of the destination bed:\n\n" +
            availableBeds
                .map(
                    (bed, index) =>
                        `${index + 1}. ${bed.label}`
                )
                .join("\n")
        );


    if (
        selection === null ||
        selection.trim() === ""
    ) {

        return;
    }


    const index =
        Number(selection) - 1;


    if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= availableBeds.length
    ) {

        showToast(
            "Invalid bed selection.",
            "error"
        );

        return;
    }


    const destination =
        availableBeds[index];


    const confirmed =
        window.confirm(
            "Confirm reassignment?\n\n" +
            `Student: ${allocation.student_name}\n` +
            `Destination: ${destination.label}\n\n` +
            "The student's current bed will be released " +
            "and the selected bed will become occupied."
        );


    if (!confirmed) {
        return;
    }


    try {

        const result =
            await rpc(
                "reassign_student",
                {
                    p_allocation_id:
                        allocationId,

                    p_new_bed_id:
                        destination.id
                }
            );


        if (!result?.success) {

            throw new Error(
                result?.message ||
                "Unable to reassign student."
            );

        }


        showToast(
            "Student successfully reassigned.",
            "success"
        );


        await loadEverything();

    } catch (error) {

        console.error(
            "Reassign student error:",
            error
        );


        showToast(
            error.message ||
            "Unable to reassign student.",
            "error"
        );

    }

}

async function unassignStudent(allocationId) {

    if (!allocationId) {
        showToast(
            "Allocation ID is missing.",
            "error"
        );
        return;
    }

    const confirmed =
        window.confirm(
            "Are you sure you want to unassign this student?\n\n" +
            "The student's allocation will be revoked and the bed will become available."
        );

    if (!confirmed) {
        return;
    }

    try {

        const result =
            await rpc(
                "unassign_student",
                {
                    p_allocation_id:
                        allocationId
                }
            );

        if (!result?.success) {
            throw new Error(
                result?.message ||
                "Unable to unassign student."
            );
        }

        showToast(
            "Student successfully unassigned.",
            "success"
        );

        await loadEverything();

    } catch (error) {

        console.error(
            "Unassign student error:",
            error
        );

        showToast(
            error.message ||
            "Unable to unassign student.",
            "error"
        );
    }
}
/* ============================================================
   Unallocated students
   ============================================================ */

async function loadUnallocated() {

    currentUnallocated =
        await rpc(
            "admin_unallocated_students",
            {
                p_search: null
            }
        );

    renderUnallocated();
}


function renderUnallocated() {

    const tbody =
        $("#unallocatedTable");

    const searchInput =
        $("#unallocatedSearch");

    const search =
        searchInput
            ?.value
            ?.trim()
            ?.toLowerCase() || "";


    const filtered =
        (currentUnallocated || []).filter(row => {

            if (!search) {
                return true;
            }

            const searchableText = [
                row.student_id,
                row.student_name,
                row.email,
                row.level,
                row.programme,
                row.gender
            ]
                .filter(value =>
                    value !== null &&
                    value !== undefined
                )
                .join(" ")
                .toLowerCase();

            return searchableText.includes(search);
        });


    if (!filtered.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        No students match your search.
                    </div>
                </td>
            </tr>
        `;

        return;
    }


    tbody.innerHTML =
        filtered.map(row => `

            <tr>

                <td>
                    ${escapeHtml(
                        row.student_id
                    )}
                </td>

                <td>
                    <strong>
                        ${escapeHtml(
                            row.student_name
                        )}
                    </strong>
                </td>

                <td>
                    ${escapeHtml(
                        row.level ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.programme ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.gender ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.email ?? "—"
                    )}
                </td>

            </tr>

        `).join("");
}

/* ============================================================
   Audit logs
   ============================================================ */

async function loadAudit() {

    currentAudit =
        await rpc(
            "admin_audit_logs",
            {
                p_limit: 100
            }
        );

    renderAudit();
}


function renderAudit() {

    const tbody =
        $("#auditTable");

    if (!currentAudit?.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state">
                        No audit activity found.
                    </div>
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML =
        currentAudit.map(row => `

            <tr>

                <td>
                    ${escapeHtml(
                        formatDate(
                            row.created_at
                        )
                    )}
                </td>

                <td>
                    <span class="action-badge">
                        ${escapeHtml(
                            row.action
                        )}
                    </span>
                </td>

                <td>
                    ${escapeHtml(
                        row.entity
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        row.entity_id ?? "—"
                    )}
                </td>

                <td>
                    <code>
                        ${escapeHtml(
                            JSON.stringify(
                                row.details ?? {}
                            )
                        )}
                    </code>
                </td>

            </tr>

        `).join("");
}


/* ============================================================
   Load everything
   ============================================================ */

async function loadEverything() {

    try {

        await Promise.all([
            loadDashboard(),
            loadRooms(),
            loadAllocations(),
            loadUnallocated(),
            loadAudit()
        ]);

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* ============================================================
   CSV export
   ============================================================ */

function csvEscape(value) {

    const text =
        value === null ||
        value === undefined
            ? ""
            : String(value);

    return `"${text.replaceAll(
        '"',
        '""'
    )}"`;
}


function downloadCsv(
    filename,
    rows
) {

    if (!rows?.length) {

        showToast(
            "There is no data to export.",
            "error"
        );

        return;
    }

    const headers =
        Object.keys(rows[0]);

    const csv = [
        headers
            .map(csvEscape)
            .join(","),

        ...rows.map(row =>
            headers
                .map(key =>
                    csvEscape(
                        row[key]
                    )
                )
                .join(",")
        )

    ].join("\r\n");

    const blob =
        new Blob(
            [csv],
            {
                type:
                    "text/csv;charset=utf-8;"
            }
        );

    const url =
        URL.createObjectURL(blob);

    const link =
        document.createElement("a");

    link.href = url;
    link.download = filename;

    document
        .body
        .appendChild(link);

    link.click();

    link.remove();

    URL.revokeObjectURL(url);
}

/* ============================================================
   REPORT BUTTONS
   ============================================================ */

function exportAllocationsReport() {

    downloadCsv(
        "uhas-asogli-allocations.csv",
        currentAllocations
    );

}


function exportUnallocatedReport() {

    downloadCsv(
        "uhas-asogli-unallocated-students.csv",
        currentUnallocated
    );

}


function printReport() {

    window.print();

}


/* ============================================================
   REPORT BUTTON INITIALISATION
   ============================================================ */

function initialiseReportButtons() {

    const exportAllocations =
        $("#exportAllocations");

    const exportUnallocated =
        $("#exportUnallocated");

    const printReportButton =
        $("#printReport");


    if (exportAllocations) {

        exportAllocations.addEventListener(
            "click",
            exportAllocationsReport
        );

    }


    if (exportUnallocated) {

        exportUnallocated.addEventListener(
            "click",
            exportUnallocatedReport
        );

    }


    if (printReportButton) {

        printReportButton.addEventListener(
            "click",
            printReport
        );

    }

}
/* ============================================================
   Login
   ============================================================ */

async function signIn(event) {

    event.preventDefault();

    const email =
        $("#email")
            .value
            .trim();

    const password =
        $("#password")
            .value;

    const button =
        $("#loginButton");

    $("#loginError")
        .textContent = "";

    button.disabled = true;
    button.textContent =
        "Signing in…";

    try {

        const {
            error
        } =
            await supabase.auth
                .signInWithPassword({
                    email,
                    password
                });

        if (error) {
            throw error;
        }

        const role =
            await getAdminRole();

        $("#adminRole")
            .textContent =
            role === "super_admin"
                ? "SUPER ADMIN"
                : "ADMIN";

        loginView
            .classList
            .add("hidden");

        appView
            .classList
            .remove("hidden");

        await loadEverything();

    } catch (error) {

        console.error(error);

        $("#loginError")
            .textContent =
            error.message ||
            "Unable to sign in.";

        await supabase.auth.signOut();

    } finally {

        button.disabled = false;

        button.textContent =
            "Sign in";
    }
}


async function signOut() {

    await supabase.auth.signOut();

    appView
        .classList
        .add("hidden");

    loginView
        .classList
        .remove("hidden");

    $("#password")
        .value = "";
}


/* ============================================================
   Initialisation
   ============================================================ */

async function initialise() {

    const {
        data: {
            session
        }
    } =
        await supabase.auth
            .getSession();

    if (!session) {
        return;
    }

    try {

        const role =
    await getAdminRole();

$("#adminRole")
    .textContent =
    role === "super_admin"
        ? "SUPER ADMIN"
        : "ADMIN";

loginView
    .classList
    .add("hidden");

appView
    .classList
    .remove("hidden");

initialiseAdminManagement();

await loadEverything();

    } catch (error) {

        console.error(error);

        await supabase.auth.signOut();
    }
}


/* ============================================================
   Event listeners
   ============================================================ */

/* ============================================================
   Password reset
   ============================================================ */

$("#forgotPasswordLink")
    .addEventListener(
        "click",
        async (event) => {

            event.preventDefault();

            const email =
                $("#email")
                    .value
                    .trim();

            const errorBox =
                $("#loginError");

            errorBox.textContent = "";

            if (!email) {

                errorBox.textContent =
                    "Enter your administrator email address first.";

                $("#email").focus();

                return;
            }

            const link =
                $("#forgotPasswordLink");

            link.textContent =
                "Sending reset link…";

            link.style.pointerEvents =
                "none";

            try {

                const {
                    error
                } =
                    await supabase.auth
                        .resetPasswordForEmail(
                            email,
                            {
                                redirectTo:
                                    `${window.location.origin}/admin/reset-password.html`
                            }
                        );

                if (error) {
                    throw error;
                }

                errorBox.className =
                    "success";

                errorBox.textContent =
                    "Password reset link sent. Check your email.";

            } catch (error) {

                console.error(
                    "Password reset error:",
                    error
                );

                errorBox.className =
                    "error";

                errorBox.textContent =
                    error.message ||
                    "Unable to send password reset email.";

            } finally {

                link.textContent =
                    "Forgot password?";

                link.style.pointerEvents =
                    "";
            }
        }
    );

$("#loginForm")
    .addEventListener(
        "submit",
        signIn
    );

$("#logoutButton")
    .addEventListener(
        "click",
        signOut
    );

$("#refreshButton")
    .addEventListener(
        "click",
        loadEverything
    );

$("#blockFilter")
    .addEventListener(
        "change",
        loadRooms
    );

$("#genderFilter")
    .addEventListener(
        "change",
        loadAllocations
    );

$("#allocationBlockFilter")
    .addEventListener(
        "change",
        loadAllocations
    );

/* ============================================================
   LIVE STUDENT SEARCH
   ============================================================ */

const studentSearch =
    $("#studentSearch");

if (studentSearch) {

    studentSearch.addEventListener(
        "input",
        () => {
            renderAllocations();
        }
    );
}
/* ============================================================
   Allocation actions
   ============================================================ */

const allocationsTable =
    $("#allocationsTable");

if (allocationsTable) {

    allocationsTable.addEventListener(
        "click",
        async (event) => {

            const reassignButton =
                event.target.closest(
                    "[data-reassign-allocation]"
                );

            const unassignButton =
                event.target.closest(
                    "[data-unassign-allocation]"
                );


            if (reassignButton) {

                const allocationId =
                    reassignButton.dataset
                        .reassignAllocation;

                await reassignStudent(
                    allocationId
                );

                return;
            }


            if (unassignButton) {

                const allocationId =
                    unassignButton.dataset
                        .unassignAllocation;

                unassignButton.disabled = true;

                unassignButton.textContent =
                    "Unassigning…";

                try {

                    await unassignStudent(
                        allocationId
                    );

                } finally {

                    unassignButton.disabled =
                        false;

                    unassignButton.textContent =
                        "Unassign";

                }

            }

        }
    );

}
/* =========================================================
   ADMIN DASHBOARD NAVIGATION
   ========================================================= */

function initialiseAdminNavigation() {

    const navItems =
        document.querySelectorAll(
            ".nav-item[data-section]"
        );

    const sections =
        document.querySelectorAll(
            ".admin-section"
        );

    const pageTitle =
        document.querySelector("#pageTitle");

    const mobileMenuButton =
        document.querySelector("#mobileMenuButton");

    const sidebar =
        document.querySelector("#adminSidebar");

    const titleMap = {
        dashboardSection: "Dashboard",
        roomsSection: "Rooms",
        allocationsSection: "Allocations",
        unallocatedSection: "Unallocated Students",
        auditSection: "Audit Log",
        reportsSection: "Reports",
        adminManagementSection: "Administrators"
    };

    function showSection(sectionId) {

        sections.forEach(
            (section) => {

                section.classList.toggle(
                    "active-section",
                    section.id === sectionId
                );

            }
        );

        navItems.forEach(
            (item) => {

                item.classList.toggle(
                    "active",
                    item.dataset.section === sectionId
                );

            }
        );

        if (pageTitle) {

            pageTitle.textContent =
                titleMap[sectionId] ||
                "Dashboard";

        }

        if (sidebar) {
            sidebar.classList.remove(
                "mobile-open"
            );
        }

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }

    navItems.forEach(
        (item) => {

            item.addEventListener(
                "click",
                () => {

                    showSection(
                        item.dataset.section
                    );

                }
            );

        }
    );

    document
        .querySelectorAll(
            "[data-section]:not(.nav-item)"
        )
        .forEach(
            (button) => {

                button.addEventListener(
                    "click",
                    () => {

                        showSection(
                            button.dataset.section
                        );

                    }
                );

            }
        );

    if (mobileMenuButton && sidebar) {

        mobileMenuButton.addEventListener(
            "click",
            () => {

                sidebar.classList.toggle(
                    "mobile-open"
                );

            }
        );

    }

    showSection(
        "dashboardSection"
    );
}

initialiseAdminNavigation();

initialiseReportButtons();

initialise();
// ============================================================
// SUPER ADMIN MANAGEMENT
// ============================================================

let administrators = [];

async function adminManagementRequest(action, payload = {}) {
    const {
        data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
        throw new Error("Your administrator session has expired.");
    }

    const { data, error } = await supabase.functions.invoke(
        "admin-management",
        {
            body: {
                action,
                ...payload
            }
        }
    );

    if (error) {
        throw error;
    }

    if (data?.error) {
        throw new Error(data.error);
    }

    return data;
}

async function loadAdministrators() {
    const tableBody = $("#administratorsTableBody");

    if (!tableBody) return;

    tableBody.innerHTML = `
        <tr>
            <td colspan="4">Loading administrators…</td>
        </tr>
    `;

    try {
        const data = await adminManagementRequest("list");

        administrators = data.administrators || [];

        renderAdministrators();
    } catch (error) {
        console.error("Administrator loading error:", error);

        tableBody.innerHTML = `
            <tr>
                <td colspan="4">
                    Unable to load administrators.
                </td>
            </tr>
        `;
    }
}

function renderAdministrators() {
    const tableBody = $("#administratorsTableBody");

    if (!tableBody) return;

    if (!administrators.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4">
                    No administrator accounts found.
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = administrators.map((admin) => {
        const created = admin.created_at
            ? new Date(admin.created_at).toLocaleDateString()
            : "—";

        return `
            <tr>
                <td>${escapeHtml(admin.email || "—")}</td>

                <td>
                    <span class="role-badge ${admin.role}">
                        ${admin.role === "super_admin"
                            ? "Super Admin"
                            : "Admin"}
                    </span>
                </td>

                <td>${created}</td>

                <td>
                    <div class="admin-actions">

                        <button
                            type="button"
                            class="secondary-button"
                            data-admin-role="${admin.id}"
                        >
                            Change Role
                        </button>

                        <button
                            type="button"
                            class="danger-button"
                            data-admin-delete="${admin.id}"
                        >
                            Remove
                        </button>

                    </div>
                </td>
            </tr>
        `;
    }).join("");
}


function openAdminManagementModal() {
    const modal = $("#adminManagementModal");
    const form = $("#adminForm");

    if (!modal || !form) return;

    form.reset();

    $("#adminModalTitle").textContent = "Add Administrator";
    $("#saveAdminButton").textContent = "Create Administrator";
    $("#adminPassword").required = true;
    $("#adminFormError").textContent = "";

    modal.style.display = "flex";
}

function closeAdminManagementModal() {
    const modal = $("#adminManagementModal");

    if (modal) {
        modal.style.display = "none";
    }
}

async function createAdministrator(event) {
    event.preventDefault();

    const email = $("#adminEmail").value.trim();
    const password = $("#adminPassword").value;
    const role = $("#adminRoleSelect").value;
    const errorBox = $("#adminFormError");
    const saveButton = $("#saveAdminButton");

    errorBox.textContent = "";

    if (!email) {
        errorBox.textContent = "Enter an email address.";
        return;
    }

    if (password.length < 8) {
        errorBox.textContent =
            "Password must contain at least 8 characters.";
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Creating…";

    try {
        await adminManagementRequest("create", {
            email,
            password,
            role
        });

        closeAdminManagementModal();

        await loadAdministrators();

        alert("Administrator created successfully.");
    } catch (error) {
        console.error("Administrator creation error:", error);

        errorBox.textContent =
            error.message ||
            "Unable to create administrator.";
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Create Administrator";
    }
}

async function changeAdministratorRole(id) {
    const admin = administrators.find(
        (item) => item.id === id
    );

    if (!admin) return;

    const newRole =
        admin.role === "admin"
            ? "super_admin"
            : "admin";

    const confirmed = confirm(
        `Change ${admin.email}'s role to ${
            newRole === "super_admin"
                ? "Super Admin"
                : "Admin"
        }?`
    );

    if (!confirmed) return;

    try {
        await adminManagementRequest("change_role", {
            user_id: id,
            role: newRole
        });

        await loadAdministrators();

        alert("Administrator role updated.");
    } catch (error) {
        console.error("Role change error:", error);

        alert(
            error.message ||
            "Unable to change administrator role."
        );
    }
}

async function removeAdministrator(id) {
    const admin = administrators.find(
        (item) => item.id === id
    );

    if (!admin) return;

    const confirmed = confirm(
        `Remove administrator access from ${admin.email}?\n\n` +
        "This will delete the administrator's authentication account."
    );

    if (!confirmed) return;

    try {
        await adminManagementRequest("delete", {
            user_id: id
        });

        await loadAdministrators();

        alert("Administrator removed successfully.");
    } catch (error) {
        console.error("Administrator removal error:", error);

        alert(
            error.message ||
            "Unable to remove administrator."
        );
    }
}
```js
function initialiseAdminManagement() {

    const managementSection =
        $("#adminManagementSection");

    const managementNavItem =
        $("#administratorsNavItem");

    if (!managementSection) return;

    const role =
        $("#adminRole")?.textContent
            ?.trim()
            ?.toLowerCase();

    const isSuperAdmin =
        role === "super admin";


    /*
     * Administrators is a Super Admin-only area.
     */
    if (managementNavItem) {

        managementNavItem.style.display =
            isSuperAdmin
                ? ""
                : "none";
    }


    if (!isSuperAdmin) {

        managementSection.style.display =
            "none";

        return;
    }


    managementSection.style.display =
        "block";


    $("#addAdminButton")
        ?.addEventListener(
            "click",
            openAdminManagementModal
        );


    $("#closeAdminModalButton")
        ?.addEventListener(
            "click",
            closeAdminManagementModal
        );


    $("#cancelAdminButton")
        ?.addEventListener(
            "click",
            closeAdminManagementModal
        );


    $("#adminForm")
        ?.addEventListener(
            "submit",
            createAdministrator
        );


    $("#administratorsTableBody")
        ?.addEventListener(
            "click",
            (event) => {

                const roleButton =
                    event.target.closest(
                        "[data-admin-role]"
                    );

                const deleteButton =
                    event.target.closest(
                        "[data-admin-delete]"
                    );


                if (roleButton) {

                    changeAdministratorRole(
                        roleButton.dataset.adminRole
                    );

                    return;
                }


                if (deleteButton) {

                    removeAdministrator(
                        deleteButton.dataset.adminDelete
                    );
                }

            }
        );


    loadAdministrators();
}
```
/* ============================================================
   SEARCH
   ============================================================ */


const unallocatedSearch = $("#unallocatedSearch");

if (unallocatedSearch) {
    let searchTimer;

    unallocatedSearch.addEventListener("input", () => {
        clearTimeout(searchTimer);

        searchTimer = setTimeout(() => {
            loadUnallocated();
        }, 300);
    });
}