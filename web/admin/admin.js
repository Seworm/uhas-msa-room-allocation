import {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
} from "../config.js";

import {
    createClient
} from "https://esm.sh/@supabase/supabase-js@2";


/* ============================================================
   Supabase
   ============================================================ */

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);


/* ============================================================
   DOM helper
   ============================================================ */

const $ = (selector) =>
    document.querySelector(selector);


/* ============================================================
   Main views
   ============================================================ */

const loginView = $("#loginView");
const appView = $("#appView");


/* ============================================================
   Application state
   ============================================================ */

let currentAllocations = [];
let currentUnallocated = [];
let currentRooms = [];
let currentAudit = [];


/* ============================================================
   Utilities
   ============================================================ */

function showToast(message, type = "") {
    const toast = $("#toast");

    if (!toast) {
        return;
    }

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

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return new Intl.DateTimeFormat(
        undefined,
        {
            dateStyle: "medium",
            timeStyle: "short"
        }
    ).format(date);
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

    /*
     * An anonymous Supabase session must never be accepted
     * as an administrator session.
     */
    if (user.is_anonymous === true) {
        await supabase.auth.signOut();

        throw new Error(
            "Administrator authentication is required."
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
    /*
     * Make sure we still have a valid authenticated session
     * before calling protected RPCs.
     */
    const {
        data: { session },
        error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) {
        throw new Error(
            sessionError.message ||
            "Unable to verify administrator session."
        );
    }

    if (!session || session.user?.is_anonymous) {
        throw new Error(
            "Your administrator session has expired. Please sign in again."
        );
    }

    const {
        data,
        error
    } = await supabase.rpc(
        name,
        args
    );

    if (error) {
        console.error(
            `RPC ${name} failed:`,
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

    if ($("#totalRooms")) {
        $("#totalRooms").textContent =
            toNumber(rooms.total);
    }

    if ($("#totalBeds")) {
        $("#totalBeds").textContent =
            toNumber(beds.total);
    }

    if ($("#occupiedBeds")) {
        $("#occupiedBeds").textContent =
            toNumber(beds.occupied);
    }

    if ($("#availableBeds")) {
        $("#availableBeds").textContent =
            toNumber(beds.available);
    }

    if ($("#activeHolds")) {
        $("#activeHolds").textContent =
            toNumber(holds.active);
    }

    if ($("#activeAllocations")) {
        $("#activeAllocations").textContent =
            toNumber(
                allocations.active ??
                students.allocated
            );
    }

    if ($("#unallocatedStudents")) {
        $("#unallocatedStudents").textContent =
            toNumber(students.unallocated);
    }

    const allocationOpen =
        summary.allocation_open === true;

    if ($("#allocationStatus")) {
        $("#allocationStatus").textContent =
            allocationOpen
                ? "OPEN"
                : "CLOSED";
    }

    if ($("#lastUpdated")) {
        $("#lastUpdated").textContent =
            `Updated ${new Date().toLocaleTimeString()}`;
    }
}


/* ============================================================
   Rooms
   ============================================================ */

async function loadRooms() {
    const block =
        $("#blockFilter")?.value || "";

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

    if (!container) {
        return;
    }

    if (!currentRooms?.length) {
        container.innerHTML = `
            <div class="empty-state">
                No rooms found.
            </div>
        `;

        return;
    }

    container.innerHTML =
        currentRooms
            .map(room => {
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

                const roomId =
                    room.room_id;

                return `
                    <button
                        type="button"
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
            })
            .join("");

    container
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
    if (!roomId) {
        return;
    }

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

        if ($("#modalRoomTitle")) {
            $("#modalRoomTitle").textContent =
                room?.room_code ||
                "Room";
        }

        if ($("#modalRoomSubtitle")) {
            $("#modalRoomSubtitle").textContent =
                room
                    ? `${room.block} · Room ${room.room_number}`
                    : "";
        }

        renderOccupants(
            occupants
        );

        $("#roomModal")
            ?.classList
            .remove("hidden");

    } catch (error) {
        console.error(error);

        showToast(
            error.message ||
            "Unable to load room occupants.",
            "error"
        );
    }
}


function renderOccupants(occupants) {
    const container =
        $("#roomOccupants");

    if (!container) {
        return;
    }

    if (!occupants?.length) {
        container.innerHTML = `
            <div class="empty-state">
                No occupants in this room.
            </div>
        `;

        return;
    }

    container.innerHTML =
        occupants
            .map(student => `
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
            `)
            .join("");
}


/* ============================================================
   Student allocations
   ============================================================ */

async function loadAllocations() {
    currentAllocations =
        await rpc(
            "admin_student_allocations",
            {
                p_search:
                    $("#studentSearch")
                        ?.value
                        .trim() || null,

                p_block:
                    $("#allocationBlockFilter")
                        ?.value || null,

                p_gender:
                    $("#genderFilter")
                        ?.value || null
            }
        );

    renderAllocations();
}


function renderAllocations() {
    const tbody =
        $("#allocationsTable");

    if (!tbody) {
        return;
    }

    if (!currentAllocations?.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        No allocations found.
                    </div>
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML =
        currentAllocations
            .map(row => `
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

                </tr>
            `)
            .join("");
}


/* ============================================================
   Unallocated students
   ============================================================ */

async function loadUnallocated() {
    currentUnallocated =
        await rpc(
            "admin_unallocated_students",
            {
                p_search:
                    $("#unallocatedSearch")
                        ?.value
                        .trim() || null
            }
        );

    renderUnallocated();
}


function renderUnallocated() {
    const tbody =
        $("#unallocatedTable");

    if (!tbody) {
        return;
    }

    if (!currentUnallocated?.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        No unallocated eligible students found.
                    </div>
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML =
        currentUnallocated
            .map(row => `
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
            `)
            .join("");
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

    if (!tbody) {
        return;
    }

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
        currentAudit
            .map(row => `
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
            `)
            .join("");
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
            error.message ||
            "Unable to load the administrator dashboard.",
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
   Administrator login
   ============================================================ */

async function signIn(event) {
    event.preventDefault();

    const email =
        $("#email")
            ?.value
            .trim();

    const password =
        $("#password")
            ?.value;

    const button =
        $("#loginButton");

    if (!email || !password) {
        $("#loginError").textContent =
            "Enter your email and password.";

        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent =
            "Signing in…";
    }

    if ($("#loginError")) {
        $("#loginError")
            .textContent = "";
    }

    try {
        /*
         * Always clear any stale/anonymous session before
         * starting administrator authentication.
         */
        const {
            data: { session }
        } = await supabase.auth.getSession();

        if (session) {
            await supabase.auth.signOut();
        }

        const {
            data,
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

        if (!data?.session) {
            throw new Error(
                "Administrator authentication did not return a session."
            );
        }

        const role =
            await getAdminRole();

        if ($("#adminRole")) {
            $("#adminRole")
                .textContent =
                role === "super_admin"
                    ? "SUPER ADMIN"
                    : "ADMIN";
        }

        loginView
            ?.classList
            .add("hidden");

        appView
            ?.classList
            .remove("hidden");

        await loadEverything();

    } catch (error) {
        console.error(
            "Administrator sign-in failed:",
            error
        );

        if ($("#loginError")) {
            $("#loginError")
                .textContent =
                error.message ||
                "Unable to sign in.";
        }

        await supabase.auth.signOut();

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent =
                "Sign in";
        }
    }
}


/* ============================================================
   Administrator logout
   ============================================================ */

async function signOut() {
    try {
        await supabase.auth.signOut();

    } catch (error) {
        console.error(
            "Administrator sign-out failed:",
            error
        );

    } finally {
        currentAllocations = [];
        currentUnallocated = [];
        currentRooms = [];
        currentAudit = [];

        appView
            ?.classList
            .add("hidden");

        loginView
            ?.classList
            .remove("hidden");

        if ($("#password")) {
            $("#password").value = "";
        }

        if ($("#loginError")) {
            $("#loginError").textContent = "";
        }
    }
}


/* ============================================================
   Initialisation
   ============================================================ */

async function initialise() {
    try {
        const {
            data: { session },
            error
        } = await supabase.auth.getSession();

        if (error) {
            throw error;
        }

        if (!session) {
            return;
        }

        /*
         * Never restore an anonymous session into the admin portal.
         */
        if (session.user?.is_anonymous === true) {
            await supabase.auth.signOut();
            return;
        }

        const role =
            await getAdminRole();

        if ($("#adminRole")) {
            $("#adminRole")
                .textContent =
                role === "super_admin"
                    ? "SUPER ADMIN"
                    : "ADMIN";
        }

        loginView
            ?.classList
            .add("hidden");

        appView
            ?.classList
            .remove("hidden");

        await loadEverything();

    } catch (error) {
        console.error(
            "Administrator initialisation failed:",
            error
        );

        await supabase.auth.signOut();

        loginView
            ?.classList
            .remove("hidden");

        appView
            ?.classList
            .add("hidden");
    }
}


/* ============================================================
   Event listeners
   ============================================================ */

$("#loginForm")
    ?.addEventListener(
        "submit",
        signIn
    );


$("#logoutButton")
    ?.addEventListener(
        "click",
        signOut
    );


$("#refreshButton")
    ?.addEventListener(
        "click",
        loadEverything
    );


$("#blockFilter")
    ?.addEventListener(
        "change",
        loadRooms
    );


$("#genderFilter")
    ?.addEventListener(
        "change",
        loadAllocations
    );


$("#allocationBlockFilter")
    ?.addEventListener(
        "change",
        loadAllocations
    );


$("#studentSearch")
    ?.addEventListener(
        "input",
        loadAllocations
    );


$("#unallocatedSearch")
    ?.addEventListener(
        "input",
        loadUnallocated
    );


$("#closeModal")
    ?.addEventListener(
        "click",
        () =>
            $("#roomModal")
                ?.classList
                .add("hidden")
    );


$(".modal-backdrop")
    ?.addEventListener(
        "click",
        () =>
            $("#roomModal")
                ?.classList
                .add("hidden")
    );


$("#exportAllocations")
    ?.addEventListener(
        "click",
        () =>
            downloadCsv(
                "asogli-hall-allocations.csv",
                currentAllocations
            )
    );


$("#exportUnallocated")
    ?.addEventListener(
        "click",
        () =>
            downloadCsv(
                "asogli-hall-unallocated.csv",
                currentUnallocated
            )
    );


$("#printReport")
    ?.addEventListener(
        "click",
        () =>
            window.print()
    );


/* ============================================================
   Start
   ============================================================ */

initialise();