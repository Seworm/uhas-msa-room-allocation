import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
} from './config.js';

const sb = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const $ = (id) => document.getElementById(id);
let availableRooms = [];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}


// ============================================================
// STUDENT ACCESS
// ============================================================

$('activate').onclick = activateStudent;

restoreStudentSession();

$('accessCode').addEventListener('input', () => {
  $('accessCode').value =
    $('accessCode').value
      .replace(/\s/g, '')
      .toUpperCase();
});


async function activateStudent() {

  const studentId =
    $('studentId').value
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');

  const accessCode =
    $('accessCode').value
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');

  if (!studentId) {
    $('msg').textContent =
      'Enter your index number.';
    return;
  }

  if (!accessCode) {
    $('msg').textContent =
      'Enter your access code.';
    return;
  }

  $('activate').disabled = true;
  $('msg').textContent =
    'Verifying your access code...';

  try {

    // Access-code verification happens only in the Edge Function. It creates
    // a standard Supabase Auth identity and returns its session on success.
    await sb.auth.signOut();

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/student-login`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          student_id: studentId,
          access_code: accessCode
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data?.session) {
      throw new Error(
        data?.error || 'Unable to verify your access code.'
      );
    }

    const { error: sessionError } = await sb.auth.setSession(data.session);

    if (sessionError) throw sessionError;

    $('login').hidden = true;

    $('studentInfo').hidden = false;

    $('studentInfo').innerHTML = `
      <h2>Welcome</h2>

      <p>
        <b>${esc(data.student.student_name)}</b>
      </p>

      <p>
        Index Number:
        <b>${esc(data.student.index_number)}</b>
      </p>

      <p>
        Your access code has been successfully activated.
      </p>
    `;

    $('msg').textContent =
      'Access verified. Loading available rooms...';

    await startBookingFlow();

  } catch (error) {

    console.error(error);

    $('activate').disabled = false;

    let message =
      error?.message ||
      'Unable to verify your access code.';

    if (
      message.toLowerCase().includes('already been used')
    ) {
      message =
        'This access code has already been used.';
    }

    if (
      message.toLowerCase().includes('invalid index')
    ) {
      message =
        'Invalid index number or access code.';
    }

    $('msg').textContent = message;
  }
}

async function restoreStudentSession() {
  const {
    data: { user }
  } = await sb.auth.getUser();

  if (!user) return;

  const { data: student, error } = await sb
    .from('students')
    .select('student_id, student_name, gender')
    .maybeSingle();

  if (error || !student) {
    await sb.auth.signOut();
    return;
  }

  $('login').hidden = true;
  $('studentInfo').hidden = false;
  $('studentInfo').innerHTML = `
    <h2>Welcome back</h2>
    <p><b>${esc(student.student_name)}</b></p>
    <p>Index Number: <b>${esc(student.student_id)}</b></p>
  `;
  if (student.gender) {
    await loadRooms();
  } else {
    showGenderSelection();
  }
}

async function startBookingFlow() {
  const { data: student, error } = await sb
    .from('students')
    .select('gender')
    .maybeSingle();

  if (error) throw error;
  if (student?.gender) {
    await loadRooms();
  } else {
    showGenderSelection();
  }
}

function showGenderSelection() {
  $('genderSelection').hidden = false;
  $('blocks').hidden = true;
  $('rooms').hidden = true;
  $('msg').textContent = 'Choose your gender to continue.';

  document.querySelectorAll('[data-gender]').forEach((button) => {
    button.onclick = () => saveGender(button.dataset.gender);
  });
}

async function saveGender(gender) {
  $('msg').textContent = 'Saving your gender selection...';
  const genderButtons = [...document.querySelectorAll('[data-gender]')];
  genderButtons.forEach((button) => { button.disabled = true; });
  try {
    const { error } = await sb.rpc('set_student_gender', { p_gender: gender });
    if (error) throw error;
    $('genderSelection').hidden = true;
    await loadRooms();
  } catch (error) {
    console.error(error);
    const message = error?.message || 'Unable to save your gender selection.';
    $('msg').textContent = message.includes('set_student_gender')
      ? 'Gender selection is not available yet. Please apply the latest Supabase migration and try again.'
      : message;
    genderButtons.forEach((button) => { button.disabled = false; });
  }
}


// ============================================================
// LOAD ROOMS
// ============================================================

async function loadRooms() {

  $('msg').textContent =
    'Checking available rooms...';

  try {

    const {
      data: { session }
    } = await sb.auth.getSession();

    if (!session) {
      throw new Error(
        'Your session has expired. Please reload the page.'
      );
    }

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/rooms`,
      {
        method: 'GET',

        headers: {
          Authorization:
            `Bearer ${session.access_token}`,

          apikey:
            SUPABASE_PUBLISHABLE_KEY
        }
      }
    );

    const data =
      await response.json();

    if (!response.ok || data.error) {
      throw new Error(
        data.error ||
        'Unable to load available rooms.'
      );
    }

    availableRooms = data.rooms || [];

    if (availableRooms.length === 0) {

      $('blocks').hidden = false;
      $('blockGrid').innerHTML =
        '<p>No rooms are currently available.</p>';

      $('msg').textContent =
        'There are currently no rooms available.';

      return;
    }

    renderBlocks();

  } catch (error) {

    console.error(error);

    $('msg').textContent =
      error?.message ||
      'Unable to connect to the allocation server.';
  }
}

function renderBlocks() {
  const blocks = [...new Set(availableRooms.map((room) => room.block))];
  $('blocks').hidden = false;
  $('rooms').hidden = true;
  $('blockGrid').innerHTML = blocks.map((block) => {
    const rooms = availableRooms.filter((room) => room.block === block);
    const beds = rooms.reduce((total, room) => total + Number(room.available_beds), 0);
    return `<article>
      <h3>${esc(block)}</h3>
      <p><b>${esc(rooms.length)}</b> room(s) · <b>${esc(beds)}</b> bed(s) available</p>
      <button data-block="${esc(block)}">Select block</button>
    </article>`;
  }).join('');

  document.querySelectorAll('[data-block]').forEach((button) => {
    button.onclick = () => renderRooms(button.dataset.block);
  });
  $('msg').textContent = 'Select a block.';
}

function renderRooms(block) {
  const rooms = availableRooms.filter((room) => room.block === block);
  $('blocks').hidden = true;
  $('rooms').hidden = false;
  $('roomsHeading').textContent = `${block} — available rooms`;
  $('grid').innerHTML =
    rooms.map((room) => `

        <article>

          <h3>
            ${esc(room.room_number)}
            — ${esc(room.block)}
          </h3>

          <p>
            ${esc(room.floor || '')}
            ·
            ${esc(room.room_type || '')}
          </p>

          <p>
            <b>${esc(room.available_beds)}</b>
            bed(s) available
          </p>

          <button
            data-id="${esc(room.id)}"
          >
            Select room
          </button>

        </article>

      `).join('');

    document
      .querySelectorAll('[data-id]')
      .forEach((button) => {

        button.onclick = () =>
          hold(
            button.dataset.id
          );

      });

  $('backToBlocks').onclick = renderBlocks;
  $('msg').textContent = 'Select an available room.';
}


// ============================================================
// HOLD ROOM
// ============================================================

async function hold(roomId) {

  $('msg').textContent =
    'Reserving a bed temporarily...';

  try {

    const {
      data: { session }
    } = await sb.auth.getSession();

    if (!session) {
      throw new Error(
        'Your session has expired.'
      );
    }

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/allocate-room`,
      {
        method: 'POST',

        headers: {
          Authorization:
            `Bearer ${session.access_token}`,

          apikey:
            SUPABASE_PUBLISHABLE_KEY,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          action: 'hold',
          room_id: roomId
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok || data.error) {
      throw new Error(
        data.error ||
        'Unable to reserve this room.'
      );
    }

    $('rooms').hidden = true;
    $('studentInfo').hidden = true;
    $('allocation').hidden = false;

    $('allocation').innerHTML = `

      <h2>Room Temporarily Held</h2>

      <p>
        Hold expires:
        <b>
          ${new Date(
            data.expires_at
          ).toLocaleString()}
        </b>
      </p>

      <p>
        Please confirm your allocation
        before the hold expires.
      </p>

      <button id="confirm">
        Confirm Allocation
      </button>

    `;

    $('confirm').onclick =
      () => confirmHold(
        data.hold_id
      );

    $('msg').textContent = '';

  } catch (error) {

    console.error(error);

    $('msg').textContent =
      error?.message ||
      'Unable to reserve this room.';
  }
}


// ============================================================
// CONFIRM ALLOCATION
// ============================================================

async function confirmHold(holdId) {

  $('msg').textContent =
    'Confirming your allocation...';

  try {

    const {
      data: { session }
    } = await sb.auth.getSession();

    if (!session) {
      throw new Error(
        'Your session has expired.'
      );
    }

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/allocate-room`,
      {
        method: 'POST',

        headers: {
          Authorization:
            `Bearer ${session.access_token}`,

          apikey:
            SUPABASE_PUBLISHABLE_KEY,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          action: 'confirm',
          hold_id: holdId
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok || data.error) {
      throw new Error(
        data.error ||
        'Unable to confirm allocation.'
      );
    }

    $('allocation').innerHTML = `

      <div class="success">

        <h2>Allocation Confirmed</h2>

        <p>
          <b>Student:</b>
          ${esc(data.student_name)}
        </p>

        <p>
          <b>Room:</b>
          ${esc(data.room_number)}
          (${esc(data.block)})
        </p>

        <p>
          <b>Bed:</b>
          ${esc(data.bed_number)}
        </p>

        <p>
          <b>Allocation ID:</b>
          ${esc(data.allocation_number)}
        </p>

        <p>
          Please save your allocation ID
          for your records.
        </p>

      </div>

    `;

    $('msg').textContent = '';

  } catch (error) {

    console.error(error);

    $('msg').textContent =
      error?.message ||
      'Unable to confirm allocation.';
  }
}
