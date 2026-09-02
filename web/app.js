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

const loginSection =
  document.getElementById('login');

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

const grid =
  document.getElementById('grid');

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

  if (error) {
    throw new Error(
      'Unable to start secure session. Please try again.'
    );
  }

  return data.session;
}

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

    showMessage(
      `Welcome, ${data.student.student_name}.`
    );

    loginSection.hidden = true;

    await loadRooms();

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

async function loadRooms() {

  roomsSection.hidden = false;

  grid.innerHTML =
    '<p>Loading available rooms...</p>';

  const {
    data,
    error
  } = await supabase.functions.invoke(
    'rooms'
  );

  if (error) {

    grid.innerHTML =
      '<p>Unable to load rooms.</p>';

    return;
  }

  const rooms =
    data?.rooms ?? [];

  if (!rooms.length) {

    grid.innerHTML =
      '<p>No rooms are currently available.</p>';

    return;
  }

  grid.innerHTML =
    rooms.map(room => `
      <article class="room-card">
        <h3>
          ${escapeHtml(room.room_code)}
        </h3>

        <p>
          ${escapeHtml(room.block)}
          · Floor ${escapeHtml(room.floor)}
        </p>

        <p>
          Room ${escapeHtml(room.room_number)}
        </p>

        <p>
          <strong>
            ${room.available_beds}
          </strong>
          bed(s) available
        </p>

        <button
          class="select-room"
          data-room-id="${escapeHtml(room.id)}"
        >
          Select Room
        </button>
      </article>
    `).join('');

  document
    .querySelectorAll('.select-room')
    .forEach(button => {

      button.addEventListener(
        'click',
        () => holdRoom(button.dataset.roomId)
      );

    });
}

async function holdRoom(roomId) {

  const buttons =
    document.querySelectorAll('.select-room');

  buttons.forEach(
    button => button.disabled = true
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

    showHoldConfirmation(data);

  } catch (error) {

    alert(
      error.message ||
      'Unable to hold this room.'
    );

    await loadRooms();

  }
}

function showHoldConfirmation(hold) {

  allocationSection.hidden = false;

  allocationSection.innerHTML = `
    <div class="hold-box">

      <h2>Room temporarily held</h2>

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

      <p>
        You have a short time to confirm this allocation.
      </p>

      <button id="confirmAllocation">
        Confirm Allocation
      </button>

      <p id="holdMessage"></p>

    </div>
  `;

  document
    .getElementById('confirmAllocation')
    .addEventListener(
      'click',
      () => confirmAllocation(hold.hold_id)
    );
}

async function confirmAllocation(holdId) {

  const button =
    document.getElementById(
      'confirmAllocation'
    );

  const message =
    document.getElementById(
      'holdMessage'
    );

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

    allocationSection.innerHTML = `
      <div class="success-box">

        <h2>Allocation Confirmed</h2>

        <p>
          Allocation Number:
          <strong>
            ${escapeHtml(data.allocation_number)}
          </strong>
        </p>

        <p>
          Student:
          ${escapeHtml(data.student_name)}
        </p>

        <p>
          Room:
          <strong>
            ${escapeHtml(data.room_code)}
          </strong>
        </p>

        <p>
          Block:
          ${escapeHtml(data.block)}
        </p>

        <p>
          Room Number:
          ${escapeHtml(data.room_number)}
        </p>

        <p>
          Bed:
          <strong>
            ${escapeHtml(data.bed_number)}
          </strong>
        </p>

        <p>
          Please save your allocation number.
        </p>

      </div>
    `;

    roomsSection.hidden = true;

  } catch (error) {

    message.textContent =
      error.message ||
      'Unable to confirm allocation.';

    button.disabled = false;

    await loadRooms();

  }
}

async function loadExistingAllocation() {

  try {

    const {
      data,
      error
    } = await supabase.functions.invoke(
      'my-allocation'
    );

    if (error || !data?.allocation) {
      return false;
    }

    loginSection.hidden = true;
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

        <h2>Your Allocation</h2>

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
          ${escapeHtml(room?.block)}
        </p>

        <p>
          Room Number:
          ${escapeHtml(room?.room_number)}
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
    `;

    return true;

  } catch {

    return false;

  }
}

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


/*
 * Restore an existing browser session.
 */
(async () => {

  try {

    const {
      data: {
        session
      }
    } = await supabase.auth.getSession();

    if (session) {
      await loadExistingAllocation();
    }

  } catch {
    // Remain on login screen.
  }

})();