import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
} from './config.js';

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);


// ==================================================
// UHAS ASOGLI HALL ROOM ALLOCATION
// Frontend application controller
// ==================================================


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

const phoneNumberInput =
  document.getElementById('phoneNumber');

const genderChoices =
  document.getElementById('genderChoices');

const savePhoneButton =
  document.getElementById('savePhoneButton');

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
// BRANDING
// --------------------------------------------------

function applyBranding() {
  document.title =
    'UHAS Asogli Hall Room Allocation';

  const brandElements =
    document.querySelectorAll(
      '[data-brand], .brand-name, .site-title'
    );

  brandElements.forEach(element => {
    element.textContent =
      'UHAS Asogli Hall Room Allocation';
  });
}


// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function showMessage(text, type = '') {
  if (!msg) return;

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


function normalizePhoneNumber(value) {
  return String(value ?? '')
    .trim();
}


function isValidGhanaPhone(value) {
  const phone =
    normalizePhoneNumber(value);

  return /^(0[2356789][0-9]{8}|\+233[2356789][0-9]{8})$/
    .test(phone);
}


function showSection(section) {
  [
    genderSection,
    blockSection,
    roomsSection,
    allocationSection
  ].forEach(element => {
    if (element) {
      element.hidden = true;
    }
  });

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


function setLoading(
  button,
  loading,
  text = 'Loading...'
) {
  if (!button) return;

  if (loading) {
    button.dataset.originalText =
      button.textContent;

    button.disabled = true;

    button.innerHTML =
      `<span class="button-spinner" aria-hidden="true"></span>${escapeHtml(text)}`;
  } else {
    button.disabled = false;

    button.textContent =
      button.dataset.originalText ||
      button.textContent;
  }
}


// --------------------------------------------------
// APPLICATION HEADER
// --------------------------------------------------

function createApplicationHeader() {
  if (
    document.querySelector('.app-brand-header')
  ) {
    return;
  }

  const header =
    document.createElement('div');

  header.className =
    'app-brand-header';

  header.innerHTML = `
    <div class="app-brand-mark">

      <div class="brand-monogram">
        UHAS
      </div>

      <div class="brand-copy">
        <strong>Asogli Hall</strong>
        <span>Room Allocation</span>
      </div>

    </div>

    <div class="brand-status">

      <span class="status-dot"></span>

      Accommodation Portal

    </div>
  `;

  document.body.prepend(header);
}


// --------------------------------------------------
// PROGRESS INDICATOR
// --------------------------------------------------

function updateProgress(step) {
  let progress =
    document.querySelector(
      '.allocation-progress'
    );

  if (!progress) {
    progress =
      document.createElement('div');

    progress.className =
      'allocation-progress';

    document.body.appendChild(progress);
  }

  const steps = [
    ['01', 'Sign in'],
    ['02', 'Your details'],
    ['03', 'Choose block'],
    ['04', 'Choose room'],
    ['05', 'Confirm']
  ];

  progress.innerHTML =
    steps.map((item, index) => {
      const number =
        index + 1;

      let state = '';

      if (number < step) {
        state = 'completed';
      } else if (number === step) {
        state = 'active';
      }

      return `
        <div class="progress-step ${state}">
          <span>${item[0]}</span>
          <label>${item[1]}</label>
        </div>
      `;
    }).join('');
}


// --------------------------------------------------
// SUPABASE SESSION
// --------------------------------------------------

async function ensureSession() {
  const {
    data: {
      session
    }
  } =
    await supabase.auth.getSession();

  if (session) {
    return session;
  }

  const {
    data,
    error
  } =
    await supabase.auth.signInAnonymously();

  if (
    error ||
    !data?.session
  ) {
    throw new Error(
      'Unable to start a secure session. Please try again.'
    );
  }

  return data.session;
}


// --------------------------------------------------
// LOGIN
// --------------------------------------------------

async function activateStudent() {
  if (!indexInput || !accessCodeInput) {
    showMessage(
      'Login form is unavailable.',
      'error'
    );

    return;
  }

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

  setLoading(
    loginButton,
    true,
    'Verifying...'
  );

  showMessage(
    'Securely verifying your accommodation access...'
  );

  try {
    await ensureSession();

    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        'student-login',
        {
          body: {
            student_id: studentId,
            access_code: accessCode
          }
        }
      );

    if (
      error ||
      !data?.success
    ) {
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

    if (loginSection) {
      loginSection.hidden = true;
    }

    const alreadyAllocated =
      await loadExistingAllocation();

    if (alreadyAllocated) {
      return;
    }

    await showGenderSelection();

  } catch (error) {
    console.error(
      'Student login error:',
      error
    );

    showMessage(
      error?.message ||
      'Unable to sign in.',
      'error'
    );

  } finally {
    setLoading(
      loginButton,
      false
    );
  }
}


// --------------------------------------------------
// STUDENT PHONE NUMBER
// --------------------------------------------------

async function loadStudentPhone() {
  const {
    data,
    error
  } =
    await supabase.rpc(
      'get_student_phone'
    );

  if (error) {
    console.error(
      'get_student_phone error:',
      error
    );

    throw new Error(
      'Unable to load your phone number. Please contact the accommodation administrator.'
    );
  }

  return data || '';
}


async function saveStudentPhone() {
  const phone =
    normalizePhoneNumber(
      phoneNumberInput?.value
    );

  if (!phone) {
    throw new Error(
      'Enter your phone number to continue.'
    );
  }

  if (!isValidGhanaPhone(phone)) {
    throw new Error(
      'Enter a valid Ghanaian phone number, e.g. 0241234567 or +233241234567.'
    );
  }

  const {
    data,
    error
  } =
    await supabase.rpc(
      'update_student_phone',
      {
        p_phone: phone
      }
    );

  if (error) {
    console.error(
      'update_student_phone error:',
      error
    );

    throw new Error(
      error.message ||
      'Unable to save your phone number.'
    );
  }

  if (currentStudent) {
    currentStudent.phone_number =
      data || phone;
  }

  return data || phone;
}


// --------------------------------------------------
// GENDER / PHONE PROFILE SCREEN
// --------------------------------------------------

async function showGenderSelection() {
  updateProgress(2);

  showSection(
    genderSection
  );

  if (genderMessage) {
    genderMessage.className = '';
    genderMessage.textContent = '';
  }

  if (!phoneNumberInput) {
    if (genderMessage) {
      genderMessage.className =
        'error';

      genderMessage.textContent =
        'Phone number field is unavailable. Please contact the administrator.';
    }

    return;
  }

  try {
    const existingPhone =
      await loadStudentPhone();

    phoneNumberInput.value =
      existingPhone || '';

  } catch (error) {
    console.error(
      'Unable to load phone:',
      error
    );

    if (genderMessage) {
      genderMessage.className =
        'error';

      genderMessage.textContent =
        error.message;
    }

    return;
  }

  const gender =
    normalizeGender(
      currentStudent?.gender
    );

  /*
   * If the student already has a gender,
   * don't ask them to select it again.
   *
   * They only need to confirm/save
   * their phone number.
   */

  if (
    gender === 'MALE' ||
    gender === 'FEMALE'
  ) {
    if (genderChoices) {
      genderChoices.hidden = true;
    }

    if (savePhoneButton) {
      savePhoneButton.hidden = false;
    }

    if (genderMessage) {
      genderMessage.textContent =
        'Please confirm your phone number before continuing.';
    }

    return;
  }

  /*
   * No gender yet.
   * Show the gender choices.
   */

  if (genderChoices) {
    genderChoices.hidden = false;
  }

  if (savePhoneButton) {
    savePhoneButton.hidden = true;
  }

  if (genderMessage) {
    genderMessage.textContent =
      'Enter your phone number, then select your gender to continue.';
  }
}


// --------------------------------------------------
// SAVE PHONE AND CONTINUE
// --------------------------------------------------

async function savePhoneAndContinue() {
  if (!savePhoneButton) {
    return;
  }

  setLoading(
    savePhoneButton,
    true,
    'Saving...'
  );

  if (genderMessage) {
    genderMessage.className = '';

    genderMessage.textContent =
      'Saving your phone number securely...';
  }

  try {
    await saveStudentPhone();

    if (genderMessage) {
      genderMessage.className =
        'success-message';

      genderMessage.textContent =
        'Phone number saved securely.';
    }

    setTimeout(() => {
      showBlockSelection();
    }, 350);

  } catch (error) {
    if (genderMessage) {
      genderMessage.className =
        'error';

      genderMessage.textContent =
        error.message ||
        'Unable to save your phone number.';
    }

    setLoading(
      savePhoneButton,
      false
    );
  }
}


// --------------------------------------------------
// SELECT GENDER
// --------------------------------------------------

async function selectGender(gender) {
  const normalized =
    normalizeGender(gender);

  if (
    normalized !== 'MALE' &&
    normalized !== 'FEMALE'
  ) {
    return;
  }

  const buttons =
    document.querySelectorAll(
      '.gender-choice'
    );

  buttons.forEach(button => {
    button.disabled = true;
  });

  if (genderMessage) {
    genderMessage.className = '';

    genderMessage.textContent =
      'Saving your details securely...';
  }

  try {
    /*
     * Phone number must be saved first.
     */

    await saveStudentPhone();

    /*
     * Save gender through the existing RPC.
     */

    const {
      data,
      error
    } =
      await supabase.rpc(
        'set_student_gender',
        {
          p_gender: normalized
        }
      );

    if (error) {
      throw new Error(
        error.message ||
        'Unable to save your gender.'
      );
    }

    /*
     * Update local student state.
     */

    if (currentStudent) {
      currentStudent.gender =
        data ||
        normalized;
    }

    if (genderMessage) {
      genderMessage.className =
        'success-message';

      genderMessage.textContent =
        'Your details have been saved.';
    }

    setTimeout(() => {
      showBlockSelection();
    }, 350);

  } catch (error) {
    console.error(
      'Gender selection error:',
      error
    );

    if (genderMessage) {
      genderMessage.className =
        'error';

      genderMessage.textContent =
        error.message ||
        'Unable to save your details.';
    }

    buttons.forEach(button => {
      button.disabled = false;
    });
  }
}


// --------------------------------------------------
// BLOCK SELECTION
// --------------------------------------------------

function showBlockSelection() {
  updateProgress(3);

  if (blockMessage) {
    blockMessage.textContent = '';
  }

  showSection(
    blockSection
  );
}


function selectBlock(block) {
  const validBlocks = [
    'Ahoe',
    'Bankoe',
    'Dome',
    'Hliha'
  ];

  if (
    !validBlocks.includes(block)
  ) {
    return;
  }

  selectedBlock =
    block;

  loadRooms(block);
}


// --------------------------------------------------
// ROOM LOADING
// --------------------------------------------------

async function loadRooms(
  block = selectedBlock
) {
  if (!block) {
    showBlockSelection();
    return;
  }

  selectedBlock =
    block;

  updateProgress(4);

  showSection(
    roomsSection
  );

  if (roomSubtitle) {
    roomSubtitle.textContent =
      `${block} Block`;
  }

  if (!grid) {
    return;
  }

  grid.innerHTML = `
    <div class="rooms-loading">

      <div class="loading-orbit"></div>

      <h3>Finding available rooms</h3>

      <p>
        Checking current availability in
        ${escapeHtml(block)} Block.
      </p>

    </div>
  `;

  try {
    const {
      data,
      error
    } =
      await supabase.functions.invoke(
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
      throw new Error(
        data.error
      );
    }

    const rooms =
      data?.rooms ?? [];

    if (!rooms.length) {
      grid.innerHTML = `
        <div class="empty-state modern-empty">

          <div class="empty-icon">
            <span>⌂</span>
          </div>

          <h3>No rooms available</h3>

          <p>
            There are currently no bookable rooms
            available in ${escapeHtml(block)} Block.
          </p>

          <button
            id="returnToBlocks"
            class="secondary-button"
            type="button"
          >
            Choose another block
          </button>

        </div>
      `;

      const returnButton =
        document.getElementById(
          'returnToBlocks'
        );

      if (returnButton) {
        returnButton.addEventListener(
          'click',
          showBlockSelection
        );
      }

      return;
    }

    grid.innerHTML =
      rooms.map(room => {
        const availableBeds =
          Number(
            room.available_beds ?? 0
          );

        const occupiedBeds =
          Number(
            room.occupied_beds ?? 0
          );

        const capacity =
          Number(
            room.capacity ?? 4
          );

        const roomGender =
          normalizeGender(
            room.gender
          );

        let genderLabel =
          'Gender not established';

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
         * Dome rooms 31–40 are permanently
         * male-only.
         */

        const isDomeMaleOnly =
          room.block === 'Dome' &&
          /^(3[1-9]|40)$/.test(
            String(room.room_number)
          );

        if (isDomeMaleOnly) {
          genderLabel =
            'Male only';

          genderClass =
            'male-only';
        }

        const occupancyPercent =
          capacity > 0
            ? Math.min(
                100,
                Math.round(
                  (occupiedBeds / capacity) * 100
                )
              )
            : 0;

        const bedVisual =
          Array.from(
            { length: capacity },
            (_, index) => {
              const occupied =
                index < occupiedBeds;

              return `
                <span
                  class="bed-indicator ${occupied ? 'occupied' : 'available'}"
                  title="${occupied ? 'Occupied' : 'Available'}"
                >
                  ${occupied ? '●' : '○'}
                </span>
              `;
            }
          ).join('');

        return `
          <article
            class="room-card modern-room-card"
          >

            <div class="room-card-top">

              <span class="room-block-label">
                ${escapeHtml(room.block)}
              </span>

              <span
                class="gender-badge ${genderClass}"
              >
                ${escapeHtml(genderLabel)}
              </span>

            </div>


            <div class="room-card-header">

              <div>

                <h3>
                  ${escapeHtml(room.room_code)}
                </h3>

                <p class="room-location">
                  Floor ${escapeHtml(room.floor)}
                  · Room ${escapeHtml(room.room_number)}
                </p>

              </div>

            </div>


            <div class="room-visual">

              <div class="bed-indicators">
                ${bedVisual}
              </div>

              <span class="occupancy-percent">
                ${occupancyPercent}%
              </span>

            </div>


            <div class="room-capacity">

              <div>

                <strong>
                  ${availableBeds}
                </strong>

                <span>
                  ${availableBeds === 1 ? 'bed' : 'beds'}
                  available
                </span>

              </div>

              <div class="capacity-text">
                ${occupiedBeds}/${capacity}
                occupied
              </div>

            </div>


            <div class="occupancy-bar">

              <span
                style="width:${occupancyPercent}%"
              ></span>

            </div>


            <button
              type="button"
              class="select-room modern-select-room"
              data-room-id="${escapeHtml(room.id)}"
              ${availableBeds <= 0 ? 'disabled' : ''}
            >

              <span>Select this room</span>

              <span aria-hidden="true">→</span>

            </button>

          </article>
        `;
      }).join('');

    document
      .querySelectorAll('.select-room')
      .forEach(button => {
        button.addEventListener(
          'click',
          () =>
            holdRoom(
              button.dataset.roomId
            )
        );
      });

  } catch (error) {
    console.error(
      'Room loading error:',
      error
    );

    grid.innerHTML = `
      <div class="empty-state modern-empty">

        <div class="empty-icon error-icon">
          !
        </div>

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
          type="button"
        >
          Try again
        </button>

      </div>
    `;

    const retryButton =
      document.getElementById(
        'retryRooms'
      );

    if (retryButton) {
      retryButton.addEventListener(
        'click',
        () => loadRooms(block)
      );
    }
  }
}


// --------------------------------------------------
// CHANGE BLOCK
// --------------------------------------------------

if (changeBlockButton) {
  changeBlockButton.addEventListener(
    'click',
    showBlockSelection
  );
}


// --------------------------------------------------
// ROOM HOLD
// --------------------------------------------------

async function holdRoom(roomId) {
  if (!roomId) {
    return;
  }

  disableButtons(
    '.select-room',
    true
  );

  try {
    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        'allocate-room',
        {
          body: {
            action: 'hold',
            room_id: roomId
          }
        }
      );

    if (error) {
      throw new Error(
        error.message ||
        'Unable to hold room.'
      );
    }

    if (data?.error) {
      throw new Error(
        data.error
      );
    }

    currentHold =
      data;

    showHoldConfirmation(
      data
    );

  } catch (error) {
    console.error(
      'Room hold error:',
      error
    );

    alert(
      error.message ||
      'Unable to hold this room.'
    );

    await loadRooms(
      selectedBlock
    );
  }
}


// --------------------------------------------------
// HOLD SCREEN
// --------------------------------------------------

function showHoldConfirmation(hold) {
  updateProgress(5);

  showSection(
    allocationSection
  );

  if (!allocationSection) {
    return;
  }

  allocationSection.innerHTML = `
    <div class="reservation-shell">

      <div class="reservation-status">

        <span class="status-dot"></span>

        Room temporarily reserved

      </div>


      <div class="reservation-heading">

        <span class="eyebrow">
          YOUR RESERVATION
        </span>

        <h2>
          Confirm your room
        </h2>

        <p>
          This room is being held exclusively
          for you while you complete confirmation.
        </p>

      </div>


      <div class="reservation-room">

        <div class="reservation-room-code">
          ${escapeHtml(hold.room_code)}
        </div>

        <div class="reservation-bed">
          Bed ${escapeHtml(hold.bed_number)}
        </div>

      </div>


      <div class="reservation-warning">

        <div class="warning-icon">
          !
        </div>

        <div>

          <strong>
            Your reservation is temporary
          </strong>

          <p>
            Confirm your allocation before the
            reservation expires.
          </p>

        </div>

      </div>


      <div class="countdown-panel">

        <span>
          RESERVATION EXPIRES IN
        </span>

        <strong
          id="countdown"
          class="countdown"
        >
          Checking...
        </strong>

      </div>


      <div class="reservation-actions">

        <button
          type="button"
          id="confirmAllocation"
          class="primary-action"
        >

          Confirm room

          <span aria-hidden="true">
            →
          </span>

        </button>


        <button
          type="button"
          id="cancelHoldView"
          class="secondary-button"
        >

          Return to rooms

        </button>

      </div>


      <p
        id="holdMessage"
        class="hold-message"
      ></p>

    </div>
  `;


  const confirmButton =
    document.getElementById(
      'confirmAllocation'
    );

  if (confirmButton) {
    confirmButton.addEventListener(
      'click',
      () =>
        confirmAllocation(
          hold.hold_id
        )
    );
  }


  const cancelButton =
    document.getElementById(
      'cancelHoldView'
    );

  if (cancelButton) {
    cancelButton.addEventListener(
      'click',
      () => {
        stopHoldTimer();

        if (allocationSection) {
          allocationSection.hidden =
            true;
        }

        loadRooms(
          selectedBlock
        );
      }
    );
  }


  startHoldCountdown(
    hold
  );
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

  if (!countdown) {
    return;
  }

  const expiresAt =
    hold.expires_at ||
    hold.expiresAt;

  if (!expiresAt) {
    countdown.textContent =
      'Please confirm now';

    return;
  }

  const expiry =
    new Date(
      expiresAt
    ).getTime();


  function updateCountdown() {
    const remaining =
      Math.max(
        0,
        expiry - Date.now()
      );

    if (remaining <= 0) {
      countdown.textContent =
        '00:00';

      countdown.classList.add(
        'expired'
      );

      const confirmButton =
        document.getElementById(
          'confirmAllocation'
        );

      if (confirmButton) {
        confirmButton.disabled =
          true;
      }

      stopHoldTimer();

      setTimeout(() => {
        if (allocationSection) {
          allocationSection.hidden =
            true;
        }

        loadRooms(
          selectedBlock
        );
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
      `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    if (remaining <= 30000) {
      countdown.classList.add(
        'urgent'
      );
    } else {
      countdown.classList.remove(
        'urgent'
      );
    }
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

    holdTimer =
      null;
  }
}


// --------------------------------------------------
// CONFIRM ALLOCATION
// --------------------------------------------------

async function confirmAllocation(
  holdId
) {
  const button =
    document.getElementById(
      'confirmAllocation'
    );

  const message =
    document.getElementById(
      'holdMessage'
    );

  if (
    !button ||
    !message
  ) {
    return;
  }

  button.disabled =
    true;

  button.innerHTML = `
    <span
      class="button-spinner"
      aria-hidden="true"
    ></span>

    Confirming...
  `;

  message.className =
    'hold-message';

  message.textContent =
    'Finalising your accommodation allocation...';

  try {
    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        'allocate-room',
        {
          body: {
            action: 'confirm',
            hold_id: holdId
          }
        }
      );

    if (error) {
      throw new Error(
        error.message ||
        'Unable to confirm allocation.'
      );
    }

    if (data?.error) {
      throw new Error(
        data.error
      );
    }

    stopHoldTimer();

    showAllocationReceipt(
      data
    );

  } catch (error) {
    console.error(
      'Allocation confirmation error:',
      error
    );

    message.className =
      'hold-message error';

    message.textContent =
      error.message ||
      'Unable to confirm allocation.';

    button.disabled =
      false;

    button.innerHTML = `
      Confirm room

      <span aria-hidden="true">
        →
      </span>
    `;
  }
}


// --------------------------------------------------
// ALLOCATION RECEIPT
// --------------------------------------------------

function showAllocationReceipt(
  data
) {
  showSection(
    allocationSection
  );

  if (!allocationSection) {
    return;
  }

  allocationSection.innerHTML = `
    <div class="allocation-success">

      <div class="success-mark">
        ✓
      </div>


      <span class="eyebrow">
        UHAS ASOGLI HALL
      </span>


      <h2>
        Allocation confirmed
      </h2>


      <p class="success-lead">

        Your accommodation has been successfully
        allocated. Please keep this information
        for your records.

      </p>


      <div class="allocation-ticket">

        <div class="ticket-header">

          <div>

            <span>
              ALLOCATION NUMBER
            </span>

            <strong>
              ${escapeHtml(
                data.allocation_number
              )}
            </strong>

          </div>

          <span class="ticket-confirmed">
            CONFIRMED
          </span>

        </div>


        <div class="ticket-student">

          <span>
            STUDENT
          </span>

          <strong>
            ${escapeHtml(
              data.student_name
            )}
          </strong>

        </div>


        <div class="ticket-grid">

          <div>

            <span>
              BLOCK
            </span>

            <strong>
              ${escapeHtml(
                data.block
              )}
            </strong>

          </div>


          <div>

            <span>
              ROOM
            </span>

            <strong>
              ${escapeHtml(
                data.room_number
              )}
            </strong>

          </div>


          <div>

            <span>
              BED
            </span>

            <strong>
              ${escapeHtml(
                data.bed_number
              )}
            </strong>

          </div>


          <div>

            <span>
              ROOM CODE
            </span>

            <strong>
              ${escapeHtml(
                data.room_code
              )}
            </strong>

          </div>

        </div>

      </div>


      <div class="success-note">

        <span>
          ✓
        </span>

        <p>

          Your allocation is now recorded in the
          UHAS Asogli Hall accommodation system.

        </p>

      </div>


      <button
        type="button"
        class="primary-action"
        id="printAllocation"
      >

        Print / Save allocation

        <span aria-hidden="true">
          ↗
        </span>

      </button>

    </div>
  `;


  if (roomsSection) {
    roomsSection.hidden =
      true;
  }


  const printButton =
    document.getElementById(
      'printAllocation'
    );

  if (printButton) {
    printButton.addEventListener(
      'click',
      () => window.print()
    );
  }
}


// --------------------------------------------------
// EXISTING ALLOCATION
// --------------------------------------------------

async function loadExistingAllocation() {
  try {
    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        'my-allocation'
      );

    if (
      error ||
      !data?.allocation
    ) {
      return false;
    }

    if (loginSection) {
      loginSection.hidden =
        true;
    }

    if (genderSection) {
      genderSection.hidden =
        true;
    }

    if (blockSection) {
      blockSection.hidden =
        true;
    }

    if (roomsSection) {
      roomsSection.hidden =
        true;
    }

    if (allocationSection) {
      allocationSection.hidden =
        false;
    }

    const allocation =
      data.allocation;

    const bed =
      allocation.beds;

    const room =
      bed?.rooms;


    allocationSection.innerHTML = `
      <div class="allocation-success">

        <div class="success-mark">
          ✓
        </div>


        <span class="eyebrow">
          UHAS ASOGLI HALL
        </span>


        <h2>
          Your allocation
        </h2>


        <p class="success-lead">

          You already have a confirmed accommodation
          allocation.

        </p>


        <div class="allocation-ticket">

          <div class="ticket-header">

            <div>

              <span>
                ALLOCATION NUMBER
              </span>

              <strong>
                ${escapeHtml(
                  allocation.allocation_number
                )}
              </strong>

            </div>

            <span class="ticket-confirmed">
              CONFIRMED
            </span>

          </div>


          <div class="ticket-student">

            <span>
              STUDENT
            </span>

            <strong>
              ${escapeHtml(
                currentStudent?.student_name ||
                ''
              )}
            </strong>

          </div>


          <div class="ticket-grid">

            <div>

              <span>
                BLOCK
              </span>

              <strong>
                ${escapeHtml(
                  room?.block
                )}
              </strong>

            </div>


            <div>

              <span>
                ROOM
              </span>

              <strong>
                ${escapeHtml(
                  room?.room_number
                )}
              </strong>

            </div>


            <div>

              <span>
                BED
              </span>

              <strong>
                ${escapeHtml(
                  bed?.bed_number
                )}
              </strong>

            </div>


            <div>

              <span>
                ROOM CODE
              </span>

              <strong>
                ${escapeHtml(
                  room?.room_code
                )}
              </strong>

            </div>

          </div>

        </div>


        <div class="success-note">

          <span>
            ✓
          </span>

          <p>

            This allocation is already confirmed
            and cannot be booked again.

          </p>

        </div>

      </div>
    `;


    return true;

  } catch (error) {
    console.error(
      'Existing allocation check failed:',
      error
    );

    return false;
  }
}


// --------------------------------------------------
// EVENT LISTENERS
// --------------------------------------------------

if (loginButton) {
  loginButton.addEventListener(
    'click',
    event => {
      event.preventDefault();

      activateStudent();
    }
  );
}


if (accessCodeInput) {
  accessCodeInput.addEventListener(
    'keydown',
    event => {
      if (
        event.key === 'Enter'
      ) {
        event.preventDefault();

        activateStudent();
      }
    }
  );
}


if (indexInput) {
  indexInput.addEventListener(
    'keydown',
    event => {
      if (
        event.key === 'Enter'
      ) {
        event.preventDefault();

        activateStudent();
      }
    }
  );
}


if (savePhoneButton) {
  savePhoneButton.addEventListener(
    'click',
    event => {
      event.preventDefault();

      savePhoneAndContinue();
    }
  );
}


document
  .querySelectorAll('.gender-choice')
  .forEach(button => {
    button.addEventListener(
      'click',
      () =>
        selectGender(
          button.dataset.gender
        )
    );
  });


document
  .querySelectorAll('.block-choice')
  .forEach(button => {
    button.addEventListener(
      'click',
      () =>
        selectBlock(
          button.dataset.block
        )
    );
  });


// --------------------------------------------------
// RESTORE EXISTING BROWSER SESSION
// --------------------------------------------------

(async () => {
  try {
    applyBranding();

    createApplicationHeader();

    updateProgress(1);

    const {
      data: {
        session
      }
    } =
      await supabase.auth.getSession();

    if (session) {
      const existingAllocation =
        await loadExistingAllocation();

      if (!existingAllocation) {
        if (loginSection) {
          loginSection.hidden =
            false;
        }
      }

    } else {
      if (loginSection) {
        loginSection.hidden =
          false;
      }
    }

  } catch (error) {
    console.error(
      'Application startup error:',
      error
    );

    if (loginSection) {
      loginSection.hidden =
        false;
    }
  }
})();
