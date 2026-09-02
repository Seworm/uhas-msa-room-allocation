import { createClient } from
  'https://esm.sh/@supabase/supabase-js@2';

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
} from './config.js';

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);


// --------------------------------------------------
// DOM ELEMENTS
// --------------------------------------------------

const loginSection =
  document.getElementById('login');

const genderSection =
  document.getElementById('genderSelection');

const blockSection =
  document.getElementById('blockSelection');

const roomsSection =
  document.getElementById('rooms');

const allocationSection =
  document.getElementById('allocation');

const indexInput =
  document.getElementById('index');

const accessCodeInput =
  document.getElementById('accessCode');

const loginButton =
  document.getElementById('loginButton');

const msg =
  document.getElementById('msg');

const genderMessage =
  document.getElementById('genderMessage');

const blockMessage =
  document.getElementById('blockMessage');

const roomSubtitle =
  document.getElementById('roomSubtitle');

const grid =
  document.getElementById('grid');

const changeBlockButton =
  document.getElementById('changeBlockButton');


// --------------------------------------------------
// STATE
// --------------------------------------------------

let currentStudent = null;
let selectedBlock = null;
let currentHold = null;
let holdTimer = null;


// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function showMessage(text, type = '') {
  msg.textContent = text;
  msg.className = type;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeGender(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function showSection(section) {
  genderSection.hidden = true;
  blockSection.hidden = true;
  roomsSection.hidden = true;
  allocationSection.hidden = true;

  if (section) {
    section.hidden = false;
  }
}

function disableButtons(selector, disabled) {
  document
    .querySelectorAll(selector)
    .forEach(button => {
      button.disabled = disabled;
    });
}


// --------------------------------------------------
// SUPABASE SESSION
// --------------------------------------------------

async function ensureSession() {

  const {
    data: {
      session
    }
  } = await supabase.auth.getSession();

  if (session) {
    return session;
  }

  const {
    data,
    error
  } = await supabase.auth.signInAnonymously();

  if (error || !data?.session) {
    throw new Error(
      'Unable to start secure session. Please try again.'
    );
  }

  return data.session;
}


// --------------------------------------------------
// LOGIN
// --------------------------------------------------

async function activateStudent() {

  const studentId =
    indexInput.value.trim();

  const accessCode =
    accessCodeInput.value.trim();

  if (!studentId || !accessCode) {

    showMessage(
      'Enter your index number and access code.',
      'error'
    );

    return;
  }

  loginButton.disabled = true;

  showMessage(
    'Verifying your details...'
  );

  try {

    await ensureSession();

    const {
      data,
      error
    } = await supabase.functions.invoke(
      'student-login',
      {
        body: {
          student_id: studentId,
          access_code: accessCode,
        },
      }
    );

    if (error || !data?.success) {

      throw new Error(
        data?.error ||
        'Invalid index number or access code.'
      );
    }

    currentStudent =
      data.student;

    showMessage(
      `Welcome, ${data.student.student_name}.`
    );

    loginSection.hidden = true;

    /*
     * If this student already has an allocation,
     * display it immediately.
     */
    const alreadyAllocated =
      await loadExistingAllocation();

    if (alreadyAllocated) {
      return;
    }

    /*
     * Gender is already stored:
     * skip the gender selection screen.
     */
    const gender =
      normalizeGender(
        data.student.gender
      );

    if (
      gender === 'MALE' ||
      gender === 'FEMALE'
    ) {

      showBlockSelection();

    } else {

      showGenderSelection();

    }

  } catch (error) {

    showMessage(
      error.message ||
      'Unable to sign in.',
      'error'
    );

  } finally {

    loginButton.disabled = false;

  }
}


// --------------------------------------------------
// GENDER
// --------------------------------------------------

function showGenderSelection() {

  genderMessage.textContent = '';

  showSection(genderSection);
}

async function selectGender(gender) {

  const normalized =
    normalizeGender(gender);

  if (
    normalized !== 'MALE' &&
    normalized !== 'FEMALE'
  ) {
    return;
  }

  disableButtons(
    '.gender-choice',
    true
  );

  genderMessage.className = '';

  genderMessage.textContent =
    'Saving your selection...';

  try {

    const {
      data,
      error
    } = await supabase.rpc(
      'set_student_gender',
      {
        p_gender: normalized
      }
    );

    if (error) {
      throw new Error(
        error.message ||
        'Unable to save gender selection.'
      );
    }

    /*
     * The RPC returns text.
     *
     * We don't trust the browser state alone.
     * The database has now permanently recorded
     * the student's gender.
     */
    currentStudent.gender =
      normalized;

    genderMessage.className =
      'success-message';

    genderMessage.textContent =
      'Gender recorded successfully.';

    setTimeout(() => {
      showBlockSelection();
    }, 300);

  } catch (error) {

    genderMessage.className =
      'error';

    genderMessage.textContent =
      error.message ||
      'Unable to save gender selection.';

    disableButtons(
      '.gender-choice',
      false
    );

  }
}


// --------------------------------------------------
// BLOCK SELECTION
// --------------------------------------------------

function showBlockSelection() {

  blockMessage.textContent = '';

  showSection(blockSection);
}

function selectBlock(block) {

  const validBlocks = [
    'Ahoe',
    'Bankoe',
    'Dome',
    'Hliha'
  ];

  if (!validBlocks.includes(block)) {
    return;
  }

  selectedBlock = block;

  loadRooms(block);
}


// --------------------------------------------------
// ROOM LOADING
// --------------------------------------------------

async function loadRooms(block = selectedBlock) {

  if (!block) {
    showBlockSelection();
    return;
  }

  selectedBlock = block;

  showSection(roomsSection);

  roomSubtitle.textContent =
    `${block} Block`;

  grid.innerHTML =
    '<p>Loading available rooms...</p>';

  try {

    const {
      data,
      error
    } = await supabase.functions.invoke(
      'rooms',
      {
        body: {
          block
        }
      }
    );

    if (error) {

      throw new Error(
        error.message ||
        'Unable to load rooms.'
      );

    }

    if (data?.error) {
      throw new Error(data.error);
    }

    const rooms =
      data?.rooms ?? [];

    if (!rooms.length) {

      grid.innerHTML = `
        <div class="empty-state">

          <h3>No rooms currently available</h3>

          <p>
            There are currently no bookable rooms
            available in ${escapeHtml(block)}.
          </p>

          <button
            id="returnToBlocks"
            class="secondary-button"
          >
            Choose Another Block
          </button>

        </div>
      `;

      document
        .getElementById('returnToBlocks')
        .addEventListener(
          'click',
          showBlockSelection
        );

      return;
    }

    grid.innerHTML =
      rooms.map(room => {

        const availableBeds =
          Number(room.available_beds ?? 0);

        const occupiedBeds =
          Number(room.occupied_beds ?? 0);

        const capacity =
          Number(room.capacity ?? 4);

        const roomGender =
          normalizeGender(room.gender);

        let genderLabel =
          'Gender not yet established';

        let genderClass =
          'neutral';

        if (
          roomGender === 'MALE'
        ) {

          genderLabel =
            'Male room';

          genderClass =
            'male';

        } else if (
          roomGender === 'FEMALE'
        ) {

          genderLabel =
            'Female room';

          genderClass =
            'female';

        }

        /*
         * Dome 31–40 are permanently male-only.
         */
        const isDomeMaleOnly =
          room.block === 'Dome' &&
          /^(3[1-9]|40)$/.test(
            String(room.room_number)
          );

        if (isDomeMaleOnly) {

          genderLabel =
            'Male-only room';

          genderClass =
            'male-only';

        }

        return `
          <article class="room-card">

            <div class="room-card-header">

              <h3>
                ${escapeHtml(room.room_code)}
              </h3>

              <span class="gender-badge ${genderClass}">
                ${escapeHtml(genderLabel)}
              </span>

            </div>

            <p class="room-location">
              ${escapeHtml(room.block)}
              · Floor ${escapeHtml(room.floor)}
              · Room ${escapeHtml(room.room_number)}
            </p>

            <div class="occupancy">

              <strong>
                ${availableBeds}
              </strong>

              <span>
                bed${availableBeds === 1 ? '' : 's'}
                available
              </span>

            </div>

            <p class="occupancy-detail">
              ${occupiedBeds} / ${capacity}
              beds occupied
            </p>

            <button
              class="select-room"
              data-room-id="${escapeHtml(room.id)}"
            >
              Select Room
            </button>

          </article>
        `;

      }).join('');

    document
      .querySelectorAll('.select-room')
      .forEach(button => {

        button.addEventListener(
          'click',
          () => holdRoom(
            button.dataset.roomId
          )
        );

      });

  } catch (error) {

    grid.innerHTML = `
      <div class="empty-state">

        <h3>Unable to load rooms</h3>

        <p>
          ${escapeHtml(
            error.message ||
            'Please try again.'
          )}
        </p>

        <button
          id="retryRooms"
          class="secondary-button"
        >
          Try Again
        </button>

      </div>
    `;

    document
      .getElementById('retryRooms')
      .addEventListener(
        'click',
        () => loadRooms(block)
      );

  }
}


// --------------------------------------------------
// CHANGE BLOCK
// --------------------------------------------------

changeBlockButton.addEventListener(
  'click',
  showBlockSelection
);


// --------------------------------------------------
// ROOM HOLD
// --------------------------------------------------

async function holdRoom(roomId) {

  disableButtons(
    '.select-room',
    true
  );

  try {

    const {
      data,
      error
    } = await supabase.functions.invoke(
      'allocate-room',
      {
        body: {
          action: 'hold',
          room_id: roomId,
        },
      }
    );

    if (error) {

      throw new Error(
        error.message ||
        'Unable to hold room.'
      );

    }

    if (data?.error) {
      throw new Error(data.error);
    }

    currentHold = data;

    showHoldConfirmation(data);

  } catch (error) {

    alert(
      error.message ||
      'Unable to hold this room.'
    );

    await loadRooms(selectedBlock);

  }
}


// --------------------------------------------------
// HOLD SCREEN
// --------------------------------------------------

function showHoldConfirmation(hold) {

  showSection(allocationSection);

  allocationSection.innerHTML = `

    <div class="hold-box">

      <h2>Room Temporarily Held</h2>

      <p>
        You have temporarily reserved:
      </p>

      <div class="hold-details">

        <p>
          Room:
          <strong>
            ${escapeHtml(hold.room_code)}
          </strong>
        </p>

        <p>
          Bed:
          <strong>
            ${escapeHtml(hold.bed_number)}
          </strong>
        </p>

      </div>

      <p>
        You must confirm this allocation before
        your hold expires.
      </p>

      <div
        id="countdown"
        class="countdown"
      >
        Checking hold time...
      </div>

      <button id="confirmAllocation">
        Confirm Allocation
      </button>

      <button
        id="cancelHoldView"
        class="secondary-button"
      >
        Return to Rooms
      </button>

      <p id="holdMessage"></p>

    </div>

  `;

  document
    .getElementById('confirmAllocation')
    .addEventListener(
      'click',
      () => confirmAllocation(
        hold.hold_id
      )
    );

  document
    .getElementById('cancelHoldView')
    .addEventListener(
      'click',
      () => {

        stopHoldTimer();

        allocationSection.hidden = true;

        loadRooms(selectedBlock);

      }
    );

  startHoldCountdown(hold);
}


// --------------------------------------------------
// HOLD COUNTDOWN
// --------------------------------------------------

function startHoldCountdown(hold) {

  stopHoldTimer();

  const countdown =
    document.getElementById(
      'countdown'
    );

  /*
   * The database uses expires_at.
   */
  const expiresAt =
    hold.expires_at ||
    hold.expiresAt;

  if (!expiresAt) {

    countdown.textContent =
      'Hold active — please confirm now.';

    return;
  }

  const expiry =
    new Date(expiresAt).getTime();

  function updateCountdown() {

    const remaining =
      Math.max(
        0,
        expiry - Date.now()
      );

    if (remaining <= 0) {

      countdown.textContent =
        'Your hold has expired.';

      countdown.classList.add(
        'expired'
      );

      const confirmButton =
        document.getElementById(
          'confirmAllocation'
        );

      if (confirmButton) {
        confirmButton.disabled = true;
      }

      stopHoldTimer();

      setTimeout(() => {

        allocationSection.hidden = true;

        loadRooms(selectedBlock);

      }, 1500);

      return;
    }

    const totalSeconds =
      Math.ceil(
        remaining / 1000
      );

    const minutes =
      Math.floor(
        totalSeconds / 60
      );

    const seconds =
      totalSeconds % 60;

    countdown.textContent =
      `Hold expires in ${minutes}:${String(
        seconds
      ).padStart(2, '0')}`;

  }

  updateCountdown();

  holdTimer =
    setInterval(
      updateCountdown,
      1000
    );
}

function stopHoldTimer() {

  if (holdTimer) {

    clearInterval(
      holdTimer
    );

    holdTimer = null;

  }
}


// --------------------------------------------------
// CONFIRM ALLOCATION
// --------------------------------------------------

async function confirmAllocation(holdId) {

  const button =
    document.getElementById(
      'confirmAllocation'
    );

  const message =
    document.getElementById(
      'holdMessage'
    );

  if (!button || !message) {
    return;
  }

  button.disabled = true;

  message.textContent =
    'Confirming allocation...';

  try {

    const {
      data,
      error
    } = await supabase.functions.invoke(
      'allocate-room',
      {
        body: {
          action: 'confirm',
          hold_id: holdId,
        },
      }
    );

    if (error) {

      throw new Error(
        error.message ||
        'Unable to confirm allocation.'
      );

    }

    if (data?.error) {
      throw new Error(data.error);
    }

    stopHoldTimer();

    showAllocationReceipt(data);

  } catch (error) {

    message.className =
      'error';

    message.textContent =
      error.message ||
      'Unable to confirm allocation.';

    button.disabled = false;

  }
}


// --------------------------------------------------
// ALLOCATION RECEIPT
// --------------------------------------------------

function showAllocationReceipt(data) {

  showSection(allocationSection);

  allocationSection.innerHTML = `

    <div class="success-box">

      <div class="success-icon">
        ✓
      </div>

      <h2>Allocation Confirmed</h2>

      <p>
        Your accommodation allocation has been
        successfully confirmed.
      </p>

      <div class="receipt">

        <p>
          Allocation Number:
          <strong>
            ${escapeHtml(
              data.allocation_number
            )}
          </strong>
        </p>

        <p>
          Student:
          ${escapeHtml(
            data.student_name
          )}
        </p>

        <p>
          Room:
          <strong>
            ${escapeHtml(
              data.room_code
            )}
          </strong>
        </p>

        <p>
          Block:
          ${escapeHtml(
            data.block
          )}
        </p>

        <p>
          Room Number:
          ${escapeHtml(
            data.room_number
          )}
        </p>

        <p>
          Bed:
          <strong>
            ${escapeHtml(
              data.bed_number
            )}
          </strong>
        </p>

      </div>

      <p class="important-note">
        Please save your allocation number for
        future reference.
      </p>

    </div>

  `;

  roomsSection.hidden = true;
}


// --------------------------------------------------
// EXISTING ALLOCATION
// --------------------------------------------------

async function loadExistingAllocation() {

  try {

    const {
      data,
      error
    } = await supabase.functions.invoke(
      'my-allocation'
    );

    if (
      error ||
      !data?.allocation
    ) {
      return false;
    }

    loginSection.hidden = true;
    genderSection.hidden = true;
    blockSection.hidden = true;
    roomsSection.hidden = true;
    allocationSection.hidden = false;

    const allocation =
      data.allocation;

    const bed =
      allocation.beds;

    const room =
      bed?.rooms;

    allocationSection.innerHTML = `

      <div class="success-box">

        <div class="success-icon">
          ✓
        </div>

        <h2>Your Allocation</h2>

        <p>
          You already have a confirmed
          accommodation allocation.
        </p>

        <div class="receipt">

          <p>
            Allocation Number:
            <strong>
              ${escapeHtml(
                allocation.allocation_number
              )}
            </strong>
          </p>

          <p>
            Room:
            <strong>
              ${escapeHtml(
                room?.room_code
              )}
            </strong>
          </p>

          <p>
            Block:
            ${escapeHtml(
              room?.block
            )}
          </p>

          <p>
            Room Number:
            ${escapeHtml(
              room?.room_number
            )}
          </p>

          <p>
            Bed:
            <strong>
              ${escapeHtml(
                bed?.bed_number
              )}
            </strong>
          </p>

        </div>

      </div>

    `;

    return true;

  } catch {

    return false;

  }
}


// --------------------------------------------------
// EVENT LISTENERS
// --------------------------------------------------

loginButton.addEventListener(
  'click',
  activateStudent
);

accessCodeInput.addEventListener(
  'keydown',
  event => {

    if (event.key === 'Enter') {
      activateStudent();
    }

  }
);

indexInput.addEventListener(
  'keydown',
  event => {

    if (event.key === 'Enter') {
      activateStudent();
    }

  }
);

document
  .querySelectorAll('.gender-choice')
  .forEach(button => {

    button.addEventListener(
      'click',
      () => selectGender(
        button.dataset.gender
      )
    );

  });

document
  .querySelectorAll('.block-choice')
  .forEach(button => {

    button.addEventListener(
      'click',
      () => selectBlock(
        button.dataset.block
      )
    );

  });


// --------------------------------------------------
// RESTORE EXISTING BROWSER SESSION
// --------------------------------------------------

(async () => {

  try {

    const {
      data: {
        session
      }
    } = await supabase.auth.getSession();

    if (session) {

      const existingAllocation =
        await loadExistingAllocation();

      if (!existingAllocation) {

        /*
         * We deliberately do not attempt to infer
         * the student's identity from the anonymous
         * session. The student must authenticate
         * through the login flow.
         */

        loginSection.hidden = false;

      }

    }

  } catch {

    // Remain on login screen.

  }

})();