import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const loginSection = document.getElementById('login');
const genderSection = document.getElementById('genderSelection');
const blockSection = document.getElementById('blockSelection');
const roomsSection = document.getElementById('rooms');
const allocationSection = document.getElementById('allocation');
const indexInput = document.getElementById('index');
const accessCodeInput = document.getElementById('accessCode');
const phoneNumberInput = document.getElementById('phoneNumber');
const genderChoices = document.getElementById('genderChoices');
const savePhoneButton = document.getElementById('savePhoneButton');
const loginButton = document.getElementById('loginButton');
const msg = document.getElementById('msg');
const genderMessage = document.getElementById('genderMessage');
const blockMessage = document.getElementById('blockMessage');
const roomSubtitle = document.getElementById('roomSubtitle');
const grid = document.getElementById('grid');
const changeBlockButton = document.getElementById('changeBlockButton');

// --------------------------------------------------
// STATE
// --------------------------------------------------

let currentStudent = null;
let currentAllocation = null;
let currentPortalData = null;
let selectedBlock = null;
let currentHold = null;
let holdTimer = null;
let portalTab = 'room';

// --------------------------------------------------
// STUDENT LOGOUT MARKER
// --------------------------------------------------

const LOGOUT_MARKER = 'uhas_asogli_student_logged_out';

function markStudentLoggedOut() {
  try {
    sessionStorage.setItem(LOGOUT_MARKER, 'true');
  } catch (error) {
    console.warn('Unable to save logout marker:', error);
  }
}

function clearStudentLoggedOutMarker() {
  try {
    sessionStorage.removeItem(LOGOUT_MARKER);
  } catch (error) {
    console.warn('Unable to clear logout marker:', error);
  }
}

function wasStudentLoggedOut() {
  try {
    return sessionStorage.getItem(LOGOUT_MARKER) === 'true';
  } catch (error) {
    return false;
  }
}

// --------------------------------------------------
// SUPABASE INVOKE HELPER
// --------------------------------------------------

async function invokeStudentFunction(functionName, options = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('Unable to obtain Supabase session:', sessionError);
    throw new Error('Unable to verify your login session. Please sign in again.');
  }

  const session = sessionData?.session;

  if (!session?.access_token) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const existingHeaders = options.headers || {};

  return supabase.functions.invoke(functionName, {
    ...options,
    headers: {
      ...existingHeaders,
      Authorization: `Bearer ${session.access_token}`
    }
  });
}

// --------------------------------------------------
// BRANDING & HELPERS
// --------------------------------------------------

function applyBranding() {
  document.title = 'UHAS Asogli Hall Room Allocation';
  const brandElements = document.querySelectorAll('[data-brand], .brand-name, .site-title');
  brandElements.forEach(element => {
    element.textContent = 'UHAS Asogli Hall Room Allocation';
  });
}

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
  return String(value ?? '').trim().toUpperCase();
}

function normalizePhoneNumber(value) {
  return String(value ?? '').trim();
}

function isValidGhanaPhone(value) {
  const phone = normalizePhoneNumber(value);
  return /^(0[2356789][0-9]{8}|\+233[2356789][0-9]{8})$/.test(phone);
}

function showSection(section) {
  [genderSection, blockSection, roomsSection, allocationSection].forEach(element => {
    if (element) element.hidden = true;
  });
  if (section) section.hidden = false;
}

function disableButtons(selector, disabled) {
  document.querySelectorAll(selector).forEach(button => {
    button.disabled = disabled;
  });
}

function setLoading(button, loading, text = 'Loading...') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span>${escapeHtml(text)}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.originalText;
  }
}

function getFunctionErrorMessage(error, fallback) {
  if (!error) return fallback;
  const message = String(error.message || error.error || '').trim();
  if (message && !message.toLowerCase().includes('failed to send a request')) {
    return message;
  }
  return 'Unable to contact the accommodation server. Please refresh the page and try again.';
}

function createApplicationHeader() {
  if (document.querySelector('.app-brand-header')) return;
  const header = document.createElement('div');
  header.className = 'app-brand-header';
  header.innerHTML = `
    <div class="app-brand-mark">
      <div class="brand-monogram">UHAS</div>
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

function updateProgress(step) {
  let progress = document.querySelector('.allocation-progress');
  if (!progress) {
    progress = document.createElement('div');
    progress.className = 'allocation-progress';
    document.body.appendChild(progress);
  }
  const steps = [
    ['01', 'Sign in'],
    ['02', 'Your details'],
    ['03', 'Choose block'],
    ['04', 'Choose room'],
    ['05', 'Confirm']
  ];
  progress.innerHTML = steps
    .map((item, index) => {
      const number = index + 1;
      let state = number < step ? 'completed' : number === step ? 'active' : '';
      return `
        <div class="progress-step ${state}">
          <span>${item[0]}</span>
          <label>${item[1]}</label>
        </div>
      `;
    })
    .join('');
}

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

async function activateStudent() {
  const index = String(indexInput?.value || '').trim().toUpperCase();
  const accessCode = String(accessCodeInput?.value || '').trim();

  if (!index) {
    showMessage('Enter your index number.', 'error');
    indexInput?.focus();
    return;
  }

  if (!accessCode) {
    showMessage('Enter your access code.', 'error');
    accessCodeInput?.focus();
    return;
  }

  setLoading(loginButton, true, 'Signing in...');
  showMessage('Verifying your student account...');

  try {
    clearStudentLoggedOutMarker();

    const { data, error } = await supabase.functions.invoke('student-login', {
      body: {
        student_id: index,
        access_code: accessCode,
        index_number: index,
        p_index_number: index,
        p_access_code: accessCode
      }
    });

    if (error) {
      console.error('student-login error:', error);
      throw new Error(getFunctionErrorMessage(error, 'Unable to sign in.'));
    }

    if (!data) {
      throw new Error('The login server returned an empty response.');
    }

    if (data.error) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }

    const accessToken = data.access_token || data.session?.access_token;
    const refreshToken = data.refresh_token || data.session?.refresh_token;

    if (!accessToken || !refreshToken) {
      console.error('Invalid student-login response:', data);
      throw new Error('The student account was verified, but the login session could not be created.');
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (sessionError) {
      console.error('setSession failed:', sessionError);
      throw new Error('Your account was verified, but your secure session could not be established.');
    }

    if (!sessionData?.session) {
      throw new Error('Your secure login session could not be established.');
    }

    let portalData = null;

    try {
      const { data: allocationData, error: allocationError } = await invokeStudentFunction('my-allocation');
      if (!allocationError && allocationData?.student) {
        portalData = allocationData;
      }
    } catch (error) {
      console.warn('Initial my-allocation check failed:', error);
    }

    if (portalData?.allocation) {
      currentStudent = portalData.student;
      currentPortalData = portalData;
      currentAllocation = portalData.allocation;

      if (!Array.isArray(currentPortalData.roommates)) {
        currentPortalData.roommates = [];
      }

      if (loginSection) loginSection.hidden = true;
      renderStudentPortal();
      showMessage('');
      return;
    }

    if (portalData?.student) {
      currentStudent = portalData.student;
      currentPortalData = portalData;
    } else if (data.student) {
      currentStudent = data.student;
    } else {
      currentStudent = null;
    }

    if (loginSection) loginSection.hidden = true;
    showMessage('');
    await showGenderSelection();

  } catch (error) {
    console.error('Student login failed:', error);
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      console.warn('Unable to clear failed login session:', signOutError);
    }

    currentStudent = null;
    currentAllocation = null;
    currentPortalData = null;

    showMessage(error?.message || 'Unable to sign in. Please check your index number and access code.', 'error');
  } finally {
    setLoading(loginButton, false);
  }
}

// --------------------------------------------------
// STUDENT PHONE NUMBER & GENDER
// --------------------------------------------------

async function loadStudentPhone() {
  const { data, error } = await invokeStudentFunction('get-student-phone');
  if (error) {
    throw new Error(getFunctionErrorMessage(error, 'Unable to load your phone number.'));
  }
  return data?.phone_number ?? '';
}

async function saveStudentPhone() {
  const phone = normalizePhoneNumber(phoneNumberInput?.value);
  if (!phone) throw new Error('Enter your phone number to continue.');
  if (!isValidGhanaPhone(phone)) {
    throw new Error('Enter a valid Ghanaian phone number, e.g. 0241234567 or +233241234567.');
  }

  const { data, error } = await invokeStudentFunction('update-student-phone', {
    body: { p_phone: phone }
  });

  if (error) {
    throw new Error(getFunctionErrorMessage(error, 'Unable to save your phone number.'));
  }
  if (data?.error) {
    throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
  }

  const savedPhone = data?.phone_number ?? phone;
  if (currentStudent) currentStudent.phone_number = savedPhone;
  return savedPhone;
}

async function showGenderSelection() {
  updateProgress(2);
  showSection(genderSection);

  if (genderMessage) {
    genderMessage.className = '';
    genderMessage.textContent = '';
  }

  if (!phoneNumberInput) return;

  try {
    const existingPhone = await loadStudentPhone();
    phoneNumberInput.value = existingPhone || '';
  } catch (error) {
    if (genderMessage) {
      genderMessage.className = 'error';
      genderMessage.textContent = error.message || 'Unable to load your phone number.';
    }
    return;
  }

  const gender = normalizeGender(currentStudent?.gender);

  if (gender === 'MALE' || gender === 'FEMALE') {
    if (genderChoices) genderChoices.hidden = true;
    if (savePhoneButton) savePhoneButton.hidden = false;
    if (genderMessage) genderMessage.textContent = 'Please confirm your phone number before continuing.';
    return;
  }

  if (genderChoices) genderChoices.hidden = false;
  if (savePhoneButton) savePhoneButton.hidden = true;
  if (genderMessage) genderMessage.textContent = 'Enter your phone number, then select your gender to continue.';
}

async function savePhoneAndContinue() {
  if (!savePhoneButton) return;
  setLoading(savePhoneButton, true, 'Saving...');

  try {
    await saveStudentPhone();
    if (genderMessage) {
      genderMessage.className = 'success-message';
      genderMessage.textContent = 'Phone number saved securely.';
    }
    setTimeout(() => showBlockSelection(), 350);
  } catch (error) {
    if (genderMessage) {
      genderMessage.className = 'error';
      genderMessage.textContent = error.message || 'Unable to save your phone number.';
    }
    setLoading(savePhoneButton, false);
  }
}

async function selectGender(gender) {
  const normalized = normalizeGender(gender);
  if (normalized !== 'MALE' && normalized !== 'FEMALE') return;

  const buttons = document.querySelectorAll('.gender-choice');
  buttons.forEach(button => (button.disabled = true));

  try {
    await saveStudentPhone();
    const { data, error } = await supabase.rpc('set_student_gender', { p_gender: normalized });

    if (error) throw new Error(error.message || 'Unable to save your gender.');
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));

    if (currentStudent) currentStudent.gender = data || normalized;
    if (genderMessage) {
      genderMessage.className = 'success-message';
      genderMessage.textContent = 'Your details have been saved.';
    }
    setTimeout(() => showBlockSelection(), 350);
  } catch (error) {
    if (genderMessage) {
      genderMessage.className = 'error';
      genderMessage.textContent = error.message || 'Unable to save your details.';
    }
    buttons.forEach(button => (button.disabled = false));
  }
}

// --------------------------------------------------
// ROOMS & ALLOCATION MANAGEMENT
// --------------------------------------------------

function showBlockSelection() {
  updateProgress(3);
  if (blockMessage) blockMessage.textContent = '';
  showSection(blockSection);
}

function selectBlock(block) {
  const validBlocks = ['Ahoe', 'Bankoe', 'Dome', 'Hliha'];
  if (!validBlocks.includes(block)) return;
  selectedBlock = block;
  loadRooms(block);
}

async function loadRooms(block = selectedBlock) {
  if (!block) {
    showBlockSelection();
    return;
  }
  selectedBlock = block;
  updateProgress(4);
  showSection(roomsSection);

  if (roomSubtitle) roomSubtitle.textContent = `${block} Block`;
  if (!grid) return;

  grid.innerHTML = `
    <div class="rooms-loading">
      <div class="loading-orbit"></div>
      <h3>Finding available rooms</h3>
      <p>Checking current availability in ${escapeHtml(block)} Block.</p>
    </div>
  `;

  try {
    const { data, error } = await invokeStudentFunction('rooms', { body: { block } });
    if (error) throw new Error(getFunctionErrorMessage(error, 'Unable to load rooms.'));
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));

    const rooms = data?.rooms ?? [];
    if (!rooms.length) {
      grid.innerHTML = `
        <div class="empty-state modern-empty">
          <div class="empty-icon"><span>⌂</span></div>
          <h3>No rooms available</h3>
          <p>There are currently no bookable rooms available in ${escapeHtml(block)} Block.</p>
          <button id="returnToBlocks" class="secondary-button" type="button">Choose another block</button>
        </div>
      `;
      document.getElementById('returnToBlocks')?.addEventListener('click', showBlockSelection);
      return;
    }

    grid.innerHTML = rooms.map(room => {
      const availableBeds = Number(room.available_beds ?? 0);
      const occupiedBeds = Number(room.occupied_beds ?? 0);
      const capacity = Number(room.capacity ?? 4);
      const roomGender = normalizeGender(room.gender);

      let genderLabel = roomGender === 'MALE' ? 'Male room' : roomGender === 'FEMALE' ? 'Female room' : 'Gender not established';
      let genderClass = roomGender === 'MALE' ? 'male' : roomGender === 'FEMALE' ? 'female' : 'neutral';

      if (room.block === 'Dome' && /^(3[1-9]|40)$/.test(String(room.room_number))) {
        genderLabel = 'Male only';
        genderClass = 'male-only';
      }

      const occupancyPercent = capacity > 0 ? Math.min(100, Math.round((occupiedBeds / capacity) * 100)) : 0;
      const bedVisual = Array.from({ length: capacity }, (_, i) => `<span class="bed-indicator ${i < occupiedBeds ? 'occupied' : 'available'}">${i < occupiedBeds ? '●' : '○'}</span>`).join('');

      return `
        <article class="room-card modern-room-card">
          <div class="room-card-top">
            <span class="room-block-label">${escapeHtml(room.block)}</span>
            <span class="gender-badge ${genderClass}">${escapeHtml(genderLabel)}</span>
          </div>
          <div class="room-card-header">
            <div>
              <h3>${escapeHtml(room.room_code)}</h3>
              <p class="room-location">Floor ${escapeHtml(room.floor)} · Room ${escapeHtml(room.room_number)}</p>
            </div>
          </div>
          <div class="room-visual">
            <div class="bed-indicators">${bedVisual}</div>
            <span class="occupancy-percent">${occupancyPercent}%</span>
          </div>
          <div class="room-capacity">
            <div>
              <strong>${availableBeds}</strong>
              <span>${availableBeds === 1 ? 'bed' : 'beds'} available</span>
            </div>
            <div class="capacity-text">${occupiedBeds}/${capacity} occupied</div>
          </div>
          <div class="occupancy-bar"><span style="width:${occupancyPercent}%"></span></div>
          <button type="button" class="select-room modern-select-room" data-room-id="${escapeHtml(room.id)}" ${availableBeds <= 0 ? 'disabled' : ''}>
            <span>Select this room</span>
            <span aria-hidden="true">→</span>
          </button>
        </article>
      `;
    }).join('');

    document.querySelectorAll('.select-room').forEach(button => {
      button.addEventListener('click', () => holdRoom(button.dataset.roomId));
    });
  } catch (error) {
    grid.innerHTML = `
      <div class="empty-state modern-empty">
        <div class="empty-icon error-icon">!</div>
        <h3>Unable to load rooms</h3>
        <p>${escapeHtml(error.message || 'Please try again.')}</p>
        <button id="retryRooms" class="secondary-button" type="button">Try again</button>
      </div>
    `;
    document.getElementById('retryRooms')?.addEventListener('click', () => loadRooms(block));
  }
}

async function holdRoom(roomId) {
  if (!roomId) return;
  disableButtons('.select-room', true);

  try {
    const { data, error } = await invokeStudentFunction('allocate-room', {
      body: { action: 'hold', room_id: roomId }
    });

    if (error) throw new Error(getFunctionErrorMessage(error, 'Unable to reserve this room.'));
    if (!data) throw new Error('The server returned an empty response.');
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    if (!data.hold_id) throw new Error('The room reservation was not created correctly.');

    currentHold = data;
    showHoldConfirmation(data);
  } catch (error) {
    alert(error?.message || 'Unable to reserve this room.');
    await loadRooms(selectedBlock);
  }
}

function showHoldConfirmation(hold) {
  if (!allocationSection) return;
  updateProgress(5);
  showSection(allocationSection);

  allocationSection.innerHTML = `
    <div class="reservation-shell">
      <div class="reservation-status"><span class="status-dot"></span>Room temporarily reserved</div>
      <div class="reservation-heading">
        <span class="eyebrow">YOUR RESERVATION</span>
        <h2>Confirm your room</h2>
        <p>This room is being held exclusively for you while you complete confirmation.</p>
      </div>
      <div class="reservation-room">
        <div class="reservation-room-code">${escapeHtml(hold.room_code)}</div>
        <div class="reservation-bed">Bed ${escapeHtml(hold.bed_number)}</div>
      </div>
      <div class="reservation-warning">
        <div class="warning-icon">!</div>
        <div>
          <strong>Your reservation is temporary</strong>
          <p>Confirm your allocation before the reservation expires.</p>
        </div>
      </div>
      <div class="countdown-panel">
        <span>RESERVATION EXPIRES IN</span>
        <strong id="countdown" class="countdown">Checking...</strong>
      </div>
      <div class="reservation-actions">
        <button type="button" id="confirmAllocation" class="primary-action">Confirm room <span aria-hidden="true">→</span></button>
        <button type="button" id="cancelHoldView" class="secondary-button">Return to rooms</button>
      </div>
      <p id="holdMessage" class="hold-message"></p>
    </div>
  `;

  document.getElementById('confirmAllocation')?.addEventListener('click', () => confirmAllocation(hold.hold_id));
  document.getElementById('cancelHoldView')?.addEventListener('click', async () => {
    const cancelButton = document.getElementById('cancelHoldView');
    setLoading(cancelButton, true, 'Cancelling...');
    try {
      if (hold?.hold_id) {
        const { data, error } = await invokeStudentFunction('allocate-room', {
          body: { action: 'cancel', hold_id: hold.hold_id }
        });
        if (error) {
          throw new Error(getFunctionErrorMessage(error, 'Unable to cancel your reservation.'));
        }
        if (data?.error) {
          throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
        }
      }
      stopHoldTimer();
      currentHold = null;
      if (allocationSection) allocationSection.hidden = true;
      await loadRooms(selectedBlock);
    } catch (error) {
      setLoading(cancelButton, false);
      const holdMessage = document.getElementById('holdMessage');
      if (holdMessage) {
        holdMessage.className = 'hold-message error';
        holdMessage.textContent = error?.message || 'Unable to cancel your reservation.';
      }
    }
  });

  startHoldCountdown(hold);
}

function stopHoldTimer() {
  if (holdTimer) {
    clearInterval(holdTimer);
    holdTimer = null;
  }
}

function startHoldCountdown(hold) {
  stopHoldTimer();
  const countdown = document.getElementById('countdown');
  const holdMessage = document.getElementById('holdMessage');
  if (!countdown) return;

  const expiresAt = new Date(hold.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) {
    countdown.textContent = 'Unavailable';
    if (holdMessage) {
      holdMessage.className = 'hold-message error';
      holdMessage.textContent = 'The reservation expiry time could not be determined.';
    }
    return;
  }

  function updateCountdown() {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      countdown.textContent = 'Expired';
      stopHoldTimer();
      currentHold = null;
      if (holdMessage) {
        holdMessage.textContent = 'Your reservation has expired. Please choose another room.';
        holdMessage.className = 'hold-message error';
      }
      const confirmButton = document.getElementById('confirmAllocation');
      if (confirmButton) confirmButton.disabled = true;
      setTimeout(() => loadRooms(selectedBlock), 1500);
      return;
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    countdown.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  updateCountdown();
  holdTimer = setInterval(updateCountdown, 1000);
}

async function confirmAllocation(holdId) {
  if (!holdId) return;
  const confirmButton = document.getElementById('confirmAllocation');
  const holdMessage = document.getElementById('holdMessage');

  setLoading(confirmButton, true, 'Confirming...');
  if (holdMessage) {
    holdMessage.className = 'hold-message';
    holdMessage.textContent = 'Confirming your accommodation securely...';
  }

  try {
    const { data, error } = await invokeStudentFunction('allocate-room', {
      body: { action: 'confirm', hold_id: holdId }
    });

    if (error) throw new Error(getFunctionErrorMessage(error, 'Unable to confirm your allocation.'));
    if (!data) throw new Error('The server returned an empty response.');
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));

    stopHoldTimer();
    currentHold = null;

    const portalLoaded = await loadStudentPortal();
    if (!portalLoaded) showAllocationReceipt(data);
  } catch (error) {
    if (holdMessage) {
      holdMessage.className = 'hold-message error';
      holdMessage.textContent = error?.message || 'Unable to confirm your allocation.';
    }
    setLoading(confirmButton, false);
  }
}

function showAllocationReceipt(data) {
  if (!allocationSection) return;
  showSection(allocationSection);

  allocationSection.innerHTML = `
    <div class="allocation-success">
      <div class="success-mark">✓</div>
      <span class="eyebrow">UHAS ASOGLI HALL</span>
      <h2>Allocation confirmed</h2>
      <p class="success-lead">Your accommodation has been successfully allocated.</p>
      <div class="allocation-ticket">
        <div class="ticket-header">
          <div><span>ALLOCATION NUMBER</span><strong>${escapeHtml(data.allocation_number)}</strong></div>
          <span class="ticket-confirmed">CONFIRMED</span>
        </div>
        <div class="ticket-student">
          <span>STUDENT</span>
          <strong>${escapeHtml(data.student_name || currentStudent?.student_name || '')}</strong>
        </div>
        <div class="ticket-grid">
          <div><span>BLOCK</span><strong>${escapeHtml(data.block)}</strong></div>
          <div><span>ROOM</span><strong>${escapeHtml(data.room_number)}</strong></div>
          <div><span>BED</span><strong>${escapeHtml(data.bed_number)}</strong></div>
          <div><span>ROOM CODE</span><strong>${escapeHtml(data.room_code)}</strong></div>
        </div>
      </div>
      <div class="reservation-actions">
        <button type="button" class="primary-action" id="openStudentPortal">Open student portal <span aria-hidden="true">→</span></button>
        <button type="button" class="secondary-button" id="printAllocation">Print / Save allocation</button>
      </div>
    </div>
  `;

  if (roomsSection) roomsSection.hidden = true;
  document.getElementById('printAllocation')?.addEventListener(
  'click',
  printStudentAllocation
);
  document.getElementById('openStudentPortal')?.addEventListener('click', async () => {
    const loaded = await loadStudentPortal();
    if (!loaded) showMessage('Unable to load student portal. Please refresh the page.', 'error');
  });
}

// --------------------------------------------------
// STUDENT PORTAL & NAVIGATION
// --------------------------------------------------

async function loadStudentPortal() {
  try {
    const { data, error } = await invokeStudentFunction('my-allocation');
    if (error || !data?.student) return false;

    currentStudent = data.student;
    currentPortalData = data;
    if (!Array.isArray(currentPortalData.roommates)) currentPortalData.roommates = [];
    if (!data.allocation) {
      currentAllocation = null;
      return false;
    }

    currentAllocation = data.allocation;
    if (loginSection) loginSection.hidden = true;
    if (genderSection) genderSection.hidden = true;
    if (blockSection) blockSection.hidden = true;
    if (roomsSection) roomsSection.hidden = true;

    portalTab = 'room';
    renderStudentPortal();
    return true;
  } catch (error) {
    return false;
  }
}

function renderStudentPortal() {
  if (!allocationSection) return;
  stopHoldTimer();
  showSection(allocationSection);

  allocationSection.innerHTML = `
    <div class="student-portal">
      <header class="student-portal-header">
        <div>
          <span class="eyebrow">UHAS ASOGLI HALL</span>
          <h2>Student Accommodation Portal</h2>
          <p>Welcome, ${escapeHtml(currentStudent?.student_name || '')}.</p>
        </div>
        <button type="button" id="studentLogout" class="secondary-button portal-logout">Logout</button>
      </header>
      <nav class="student-portal-nav" aria-label="Student accommodation navigation">
        <button type="button" class="portal-tab ${portalTab === 'room' ? 'active' : ''}" data-portal-tab="room">My Room</button>
        <button type="button" class="portal-tab ${portalTab === 'roommates' ? 'active' : ''}" data-portal-tab="roommates">Roommates</button>
        <button type="button" class="portal-tab ${portalTab === 'details' ? 'active' : ''}" data-portal-tab="details">Allocation Details</button>
      </nav>
      <main class="student-portal-content" id="studentPortalContent">
        ${renderPortalTab()}
      </main>
    </div>
  `;

  document.querySelectorAll('[data-portal-tab]').forEach(button => {
    button.addEventListener('click', () => {
      portalTab = button.dataset.portalTab;
      renderStudentPortal();
    });
  });

  document.getElementById('studentLogout')?.addEventListener('click', logoutStudent);
  document.getElementById('printStudentAllocation')?.addEventListener(
  'click',
  printStudentAllocation
);
}

function renderPortalTab() {
  if (portalTab === 'roommates') return renderRoommatesTab();
  if (portalTab === 'details') return renderAllocationDetailsTab();
  return renderMyRoomTab();
}
function renderMyRoomTab() {
  const allocation = currentAllocation;
  const bed = allocation?.beds;
  const room = bed?.rooms;

  const roomCode = room?.room_code || '—';
  const block = room?.block || '—';
  const floor = room?.floor ?? '—';
  const roomNumber = room?.room_number ?? '—';
  const bedNumber = bed?.bed_number ?? '—';

  const allocationNumber =
    allocation?.allocation_number || '—';

  const status =
    allocation?.status || 'CONFIRMED';

  const createdAt =
    allocation?.created_at
      ? new Date(allocation.created_at).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      : '—';

  const roommates = Array.isArray(currentPortalData?.roommates)
    ? currentPortalData.roommates
    : [];

  const occupantCount = roommates.length + 1;

  return `
    <section class="portal-panel my-room-panel">

      <!-- HEADER -->
      <div class="portal-panel-heading my-room-heading">

        <div>
          <span class="eyebrow">
            YOUR ACCOMMODATION
          </span>

          <h3>
            My Room
          </h3>

          <p>
            Your confirmed room assignment at UHAS Asogli Hall.
          </p>
        </div>

        <span class="allocation-status-badge">
          <span class="status-dot"></span>
          ${escapeHtml(status)}
        </span>

      </div>


      <!-- ROOM HERO -->
      <div class="my-room-hero">

        <div class="my-room-hero-main">

          <span class="allocation-hero-label">
            ROOM
          </span>

          <strong class="my-room-code">
            ${escapeHtml(roomCode)}
          </strong>

          <span class="my-room-location">
            ${escapeHtml(block)} Block
            <span>•</span>
            Floor ${escapeHtml(floor)}
            <span>•</span>
            Room ${escapeHtml(roomNumber)}
          </span>

        </div>


        <div class="my-room-bed-highlight">

          <span>
            YOUR BED
          </span>

          <strong>
            ${escapeHtml(bedNumber)}
          </strong>

          <small>
            Assigned bed
          </small>

        </div>

      </div>


      <!-- ROOM SUMMARY -->
      <div class="allocation-section-title">

        <span class="allocation-section-icon">
          ⌂
        </span>

        <div>
          <strong>
            Accommodation Assignment
          </strong>

          <span>
            Your assigned location within Asogli Hall
          </span>
        </div>

      </div>


      <div class="allocation-room-grid">

        <div class="allocation-room-item primary">
          <span>
            BLOCK
          </span>

          <strong>
            ${escapeHtml(block)}
          </strong>
        </div>


        <div class="allocation-room-item primary">
          <span>
            ROOM
          </span>

          <strong>
            ${escapeHtml(roomNumber)}
          </strong>
        </div>


        <div class="allocation-room-item highlight">
          <span>
            ASSIGNED BED
          </span>

          <strong>
            Bed ${escapeHtml(bedNumber)}
          </strong>
        </div>


        <div class="allocation-room-item">
          <span>
            FLOOR
          </span>

          <strong>
            ${escapeHtml(floor)}
          </strong>
        </div>

      </div>


      <!-- ROOM OCCUPANCY -->
      <div class="allocation-section-title">

        <span class="allocation-section-icon">
          ◉
        </span>

        <div>
          <strong>
            Room Occupancy
          </strong>

          <span>
            Students currently assigned to this room
          </span>
        </div>

      </div>


      <div class="room-occupancy-card">

        <div class="occupancy-icon">
          👥
        </div>

        <div class="occupancy-copy">

          <strong>
            ${occupantCount}
            ${occupantCount === 1 ? 'Student' : 'Students'}
          </strong>

          <span>
            Currently assigned to this room
          </span>

        </div>

        <div class="occupancy-action">

          <button
            type="button"
            class="secondary-button"
            data-portal-tab="roommates"
            id="viewRoommatesFromRoom"
          >
            View roommates
            <span aria-hidden="true">→</span>
          </button>

        </div>

      </div>


      <!-- ALLOCATION RECORD -->
      <div class="allocation-record">

        <div>
          <span>
            ALLOCATION NUMBER
          </span>

          <strong>
            ${escapeHtml(allocationNumber)}
          </strong>
        </div>

        <div>
          <span>
            ALLOCATION DATE
          </span>

          <strong>
            ${escapeHtml(createdAt)}
          </strong>
        </div>

      </div>

    </section>
  `;
}
function renderRoommatesTab() {

  const roommates = Array.isArray(currentPortalData?.roommates)
    ? currentPortalData.roommates
    : [];

  const bed = currentAllocation?.beds;
  const room = bed?.rooms;

  const roomCode = room?.room_code || '—';
  const block = room?.block || '—';
  const roomNumber = room?.room_number ?? '—';

  const occupantCount = roommates.length + 1;

  // --------------------------------------------------
  // EMPTY STATE
  // --------------------------------------------------

  if (!roommates.length) {

    return `
      <section class="portal-panel roommates-panel">

        <div class="portal-panel-heading roommates-heading">

          <div>
            <span class="eyebrow">
              YOUR ROOM
            </span>

            <h3>
              My Roommates
            </h3>

            <p>
              Students currently assigned to your room.
            </p>
          </div>

          <span class="room-occupancy-pill">
            1 occupant
          </span>

        </div>


        <!-- ROOM SUMMARY -->
        <div class="roommates-room-summary">

          <div>

            <span>
              ROOM
            </span>

            <strong>
              ${escapeHtml(roomCode)}
            </strong>

          </div>

          <div>

            <span>
              BLOCK
            </span>

            <strong>
              ${escapeHtml(block)}
            </strong>

          </div>

          <div>

            <span>
              ROOM NUMBER
            </span>

            <strong>
              ${escapeHtml(roomNumber)}
            </strong>

          </div>

        </div>


        <div class="roommates-empty-state">

          <div class="roommates-empty-icon">
            👥
          </div>

          <span class="eyebrow">
            ROOM STATUS
          </span>

          <h4>
            You currently have no roommates
          </h4>

          <p>
            No other students are currently assigned
            to your room.
          </p>

        </div>

      </section>
    `;
  }


  // --------------------------------------------------
  // ROOMMATE DIRECTORY
  // --------------------------------------------------

  return `
    <section class="portal-panel roommates-panel">

      <!-- HEADER -->
      <div class="portal-panel-heading roommates-heading">

        <div>

          <span class="eyebrow">
            YOUR ROOM
          </span>

          <h3>
            My Roommates
          </h3>

          <p>
            Students currently assigned to your room.
          </p>

        </div>

        <span class="room-occupancy-pill">
          ${occupantCount}
          ${occupantCount === 1 ? 'occupant' : 'occupants'}
        </span>

      </div>


      <!-- ROOM SUMMARY -->
      <div class="roommates-room-summary">

        <div>

          <span>
            ROOM
          </span>

          <strong>
            ${escapeHtml(roomCode)}
          </strong>

        </div>


        <div>

          <span>
            BLOCK
          </span>

          <strong>
            ${escapeHtml(block)}
          </strong>

        </div>


        <div>

          <span>
            OCCUPANCY
          </span>

          <strong>
            ${occupantCount}
            ${occupantCount === 1 ? 'student' : 'students'}
          </strong>

        </div>

      </div>


      <!-- DIRECTORY TITLE -->
      <div class="allocation-section-title">

        <span class="allocation-section-icon">
          ◉
        </span>

        <div>

          <strong>
            Students in Your Room
          </strong>

          <span>
            Other students assigned to ${escapeHtml(roomCode)}
          </span>

        </div>

      </div>


      <!-- ROOMMATES -->
      <div class="modern-roommate-grid">

        ${roommates.map((roommate, index) => {

          const name =
            String(roommate?.student_name || 'Student').trim();

          const programme =
            roommate?.programme || 'Programme not available';

          const level =
            roommate?.level ?? '—';

          const initials =
            name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map(part => part.charAt(0).toUpperCase())
              .join('') || '?';

          return `
            <article class="modern-roommate-card">

              <div class="roommate-card-top">

                <div class="modern-roommate-avatar">
                  ${escapeHtml(initials)}
                </div>

                <span class="roommate-number">
                  ROOMMATE ${index + 1}
                </span>

              </div>


              <div class="modern-roommate-details">

                <h4>
                  ${escapeHtml(name)}
                </h4>

                <div class="roommate-programme">
                  ${escapeHtml(programme)}
                </div>

                <div class="roommate-level">
                  Level ${escapeHtml(level)}
                </div>

              </div>

              <div class="roommate-card-footer">

                <span>
                  Assigned to room
                </span>

                <strong>
                  ${escapeHtml(roomCode)}
                </strong>

              </div>

            </article>
          `;

        }).join('')}

      </div>


      <!-- PRIVACY NOTE -->
      <div class="roommates-privacy-note">

        <span class="privacy-icon">
          ✓
        </span>

        <div>

          <strong>
            Student privacy protected
          </strong>

          <p>
            Only basic accommodation information is displayed.
            Private contact and identification details are not
            shown.
          </p>

        </div>

      </div>

    </section>
  `;
}
function renderAllocationDetailsTab() {

  const allocation = currentAllocation;
  const bed = allocation?.beds;
  const room = bed?.rooms;

  const createdAt = allocation?.created_at
    ? new Date(allocation.created_at).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '—';

  const studentName =
    currentStudent?.student_name || '—';

  const studentId =
    currentStudent?.student_id || '—';

  const programme =
    currentStudent?.programme || '—';

  const level =
    currentStudent?.level ?? '—';

  const gender =
    currentStudent?.gender || '—';

  const phone =
    currentStudent?.phone_number || '—';

  const allocationNumber =
    allocation?.allocation_number || '—';

  const status =
    allocation?.status || 'CONFIRMED';

  return `
    <section class="portal-panel allocation-details-panel">

      <div class="portal-panel-heading allocation-details-heading">

        <div>
          <span class="eyebrow">
            OFFICIAL ACCOMMODATION RECORD
          </span>

          <h3>
            Allocation Details
          </h3>

          <p>
            Your confirmed UHAS Asogli Hall accommodation assignment.
          </p>
        </div>

        <span class="allocation-status-badge">
          <span class="status-dot"></span>
          ${escapeHtml(status)}
        </span>

      </div>


      <!-- ALLOCATION HERO -->

      <div class="allocation-hero">

        <div class="allocation-hero-main">

          <span class="allocation-hero-label">
            ALLOCATION NUMBER
          </span>

          <strong class="allocation-number">
            ${escapeHtml(allocationNumber)}
          </strong>

          <span class="allocation-confirmed">
            Accommodation confirmed
          </span>

        </div>

        <div class="allocation-hero-room">

          <span class="allocation-hero-label">
            ROOM
          </span>

          <strong>
            ${escapeHtml(room?.room_code || '—')}
          </strong>

          <span>
            ${escapeHtml(room?.block || '—')} Block
          </span>

        </div>

      </div>


      <!-- ROOM ASSIGNMENT -->

      <div class="allocation-section-title">

        <span class="allocation-section-icon">
          ⌂
        </span>

        <div>
          <strong>
            Accommodation Assignment
          </strong>

          <span>
            Your assigned location within Asogli Hall
          </span>
        </div>

      </div>


      <div class="allocation-room-grid">

        <div class="allocation-room-item primary">

          <span>BLOCK</span>

          <strong>
            ${escapeHtml(room?.block || '—')}
          </strong>

        </div>


        <div class="allocation-room-item primary">

          <span>ROOM</span>

          <strong>
            ${escapeHtml(room?.room_number ?? '—')}
          </strong>

        </div>


        <div class="allocation-room-item highlight">

          <span>ASSIGNED BED</span>

          <strong>
            Bed ${escapeHtml(bed?.bed_number ?? '—')}
          </strong>

        </div>


        <div class="allocation-room-item">

          <span>FLOOR</span>

          <strong>
            ${escapeHtml(room?.floor ?? '—')}
          </strong>

        </div>

      </div>


      <!-- STUDENT INFORMATION -->

      <div class="allocation-section-title">

        <span class="allocation-section-icon">
          ◉
        </span>

        <div>
          <strong>
            Student Information
          </strong>

          <span>
            Details associated with this allocation
          </span>
        </div>

      </div>


      <div class="allocation-student-grid">

        <div>
          <span>STUDENT NAME</span>
          <strong>
            ${escapeHtml(studentName)}
          </strong>
        </div>

        <div>
          <span>INDEX NUMBER</span>
          <strong>
            ${escapeHtml(studentId)}
          </strong>
        </div>

        <div>
          <span>PROGRAMME</span>
          <strong>
            ${escapeHtml(programme)}
          </strong>
        </div>

        <div>
          <span>LEVEL</span>
          <strong>
            ${escapeHtml(level)}
          </strong>
        </div>

        <div>
          <span>GENDER</span>
          <strong>
            ${escapeHtml(gender)}
          </strong>
        </div>

        <div>
          <span>PHONE NUMBER</span>
          <strong>
            ${escapeHtml(phone)}
          </strong>
        </div>

      </div>


      <!-- RECORD INFORMATION -->

      <div class="allocation-record">

        <div>
          <span>ALLOCATION DATE</span>
          <strong>
            ${escapeHtml(createdAt)}
          </strong>
        </div>

        <div>
          <span>STATUS</span>
          <strong class="record-status">
            ${escapeHtml(status)}
          </strong>
        </div>

      </div>


      <!-- ACTIONS -->

      <div class="allocation-actions">

        <button
          type="button"
          class="primary-action allocation-print-button"
          id="printStudentAllocation"
        >
          <span aria-hidden="true">▣</span>
          Print / Save Allocation
        </button>

      </div>


      <p class="allocation-print-note">
        Your allocation record can be printed or saved as a PDF
        for your records.
      </p>

    </section>
  `;
}

function printStudentAllocation() {

  const allocation = currentAllocation;
  const bed = allocation?.beds;
  const room = bed?.rooms;

  if (!allocation || !currentStudent) {
    alert('Your allocation details are not available.');
    return;
  }

  const studentName =
    currentStudent.student_name || '—';

  const studentId =
    currentStudent.student_id || '—';

  const programme =
    currentStudent.programme || '—';

  const level =
    currentStudent.level ?? '—';

  const gender =
    currentStudent.gender || '—';

  const phone =
    currentStudent.phone_number || '—';

  const allocationNumber =
    allocation.allocation_number || '—';

  const status =
    allocation.status || 'CONFIRMED';

  const createdAt =
    allocation.created_at
      ? new Date(allocation.created_at).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';


  const printWindow = window.open(
    '',
    '_blank',
    'width=900,height=1100'
  );

  if (!printWindow) {

    alert(
      'The print window was blocked by your browser. Please allow pop-ups and try again.'
    );

    return;
  }


  printWindow.document.open();

  printWindow.document.write(`
    <!doctype html>

    <html lang="en">

    <head>

      <meta charset="utf-8">

      <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
      >

      <title>
        UHAS Asogli Hall Allocation - ${escapeHtml(studentId)}
      </title>

      <style>

        @page {
          size: A4;
          margin: 14mm 15mm 16mm 15mm;
        }


        * {
          box-sizing: border-box;
        }


        html,
        body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          color: #10251c;
          font-family:
            Arial,
            Helvetica,
            sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }


        body {
          font-size: 12px;
          line-height: 1.5;
        }


        .document {
          width: 100%;
          max-width: 780px;
          margin: 0 auto;
        }


        /* HEADER */

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;

          padding-bottom: 18px;

          border-bottom: 3px solid #075b3a;
        }


        .brand {
          display: flex;
          align-items: center;
          gap: 13px;
        }


        .brand-mark {
          width: 48px;
          height: 48px;

          display: flex;
          align-items: center;
          justify-content: center;

          border-radius: 12px;

          background: #075b3a;
          color: #ffffff;

          font-size: 13px;
          font-weight: 800;
          letter-spacing: .04em;
        }


        .institution {
          font-size: 13px;
          font-weight: 800;
          letter-spacing: .08em;
          color: #075b3a;
          text-transform: uppercase;
        }


        .hall {
          margin-top: 2px;

          font-size: 19px;
          font-weight: 800;
          color: #10251c;
        }


        .document-label {
          text-align: right;
        }


        .document-label span {
          display: block;

          font-size: 9px;
          font-weight: 700;
          letter-spacing: .12em;
          color: #63766d;
          text-transform: uppercase;
        }


        .document-label strong {
          display: block;

          margin-top: 3px;

          font-size: 12px;
          color: #075b3a;
        }


        /* TITLE */

        .title-area {
          padding: 25px 0 20px;
        }


        .title-area h1 {
          margin: 0;

          font-size: 25px;
          line-height: 1.15;

          color: #075b3a;
        }


        .title-area p {
          margin: 7px 0 0;

          color: #5c6d65;
          font-size: 11px;
        }


        /* ALLOCATION NUMBER */

        .allocation-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;

          gap: 20px;

          padding: 18px 20px;

          background: #075b3a;
          color: #ffffff;

          border-radius: 10px;

          margin-bottom: 22px;
        }


        .allocation-banner-label {
          display: block;

          font-size: 8px;
          font-weight: 700;
          letter-spacing: .14em;

          opacity: .78;
        }


        .allocation-number {
          display: block;

          margin-top: 3px;

          font-size: 22px;
          font-weight: 800;
          letter-spacing: .02em;
        }


        .confirmed {
          display: inline-flex;
          align-items: center;
          gap: 6px;

          padding: 7px 11px;

          border-radius: 999px;

          background: rgba(255,255,255,.14);

          font-size: 9px;
          font-weight: 800;
          letter-spacing: .08em;
        }


        .confirmed::before {
          content: "";
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #c9f45b;
        }


        /* SECTIONS */

        .section {
          margin-bottom: 22px;
          break-inside: avoid;
        }


        .section-heading {
          display: flex;
          align-items: center;
          gap: 9px;

          padding-bottom: 8px;

          border-bottom: 1px solid #d9e3de;

          margin-bottom: 11px;
        }


        .section-heading strong {
          font-size: 12px;
          color: #075b3a;
        }


        .section-heading span {
          display: block;

          margin-top: 1px;

          font-size: 9px;
          color: #718179;
        }


        .section-icon {
          width: 27px;
          height: 27px;

          display: flex;
          align-items: center;
          justify-content: center;

          border-radius: 7px;

          background: #e9f6ef;
          color: #075b3a;

          font-weight: 800;
        }


        /* ROOM DETAILS */

        .room-grid {
          display: grid;
          grid-template-columns:
            repeat(4, 1fr);

          border: 1px solid #d9e3de;
          border-radius: 9px;

          overflow: hidden;
        }


        .room-item {
          padding: 13px 14px;

          border-right: 1px solid #d9e3de;
          background: #f8faf9;
        }


        .room-item:last-child {
          border-right: 0;
        }


        .room-item span,
        .student-item span,
        .record-item span {
          display: block;

          font-size: 8px;
          font-weight: 700;
          letter-spacing: .09em;

          color: #728078;
          text-transform: uppercase;
        }


        .room-item strong {
          display: block;

          margin-top: 4px;

          font-size: 15px;
          color: #10251c;
        }


        .room-item.highlight {
          background: #effbd0;
        }


        .room-item.highlight strong {
          color: #075b3a;
        }


        /* STUDENT */

        .student-grid {
          display: grid;

          grid-template-columns:
            repeat(2, 1fr);

          border: 1px solid #d9e3de;
          border-radius: 9px;

          overflow: hidden;
        }


        .student-item {
          padding: 12px 14px;

          border-bottom: 1px solid #d9e3de;
        }


        .student-item:nth-child(odd) {
          border-right: 1px solid #d9e3de;
        }


        .student-item:nth-last-child(-n+2) {
          border-bottom: 0;
        }


        .student-item strong {
          display: block;

          margin-top: 4px;

          font-size: 11px;
          color: #10251c;
        }


        /* RECORD */

        .record {
          display: grid;

          grid-template-columns: 1fr 1fr;

          gap: 12px;
        }


        .record-item {
          padding: 13px 14px;

          border: 1px solid #d9e3de;

          border-radius: 8px;
        }


        .record-item strong {
          display: block;

          margin-top: 4px;

          font-size: 10px;
        }


        .record-status {
          color: #087443;
          text-transform: uppercase;
        }


        /* FOOTER */

        .footer {
          margin-top: 28px;
          padding-top: 13px;

          border-top: 1px solid #d9e3de;

          display: flex;
          justify-content: space-between;
          gap: 20px;

          color: #738078;
          font-size: 8px;
        }


        .footer strong {
          color: #075b3a;
        }


        .notice {
          margin-top: 18px;

          padding: 10px 12px;

          border-left: 3px solid #b7e33f;

          background: #f6f9f5;

          color: #52625a;

          font-size: 9px;
        }


        @media print {

          body {
            background: #ffffff;
          }

          .document {
            max-width: none;
          }

        }

      </style>

    </head>


    <body>

      <main class="document">


        <!-- HEADER -->

        <header class="header">

          <div class="brand">

            <div class="brand-mark">
              UHAS
            </div>

            <div>

              <div class="institution">
                University of Health and Allied Sciences
              </div>

              <div class="hall">
                Asogli Hall
              </div>

            </div>

          </div>


          <div class="document-label">

            <span>
              Accommodation Record
            </span>

            <strong>
              Official Student Copy
            </strong>

          </div>

        </header>


        <!-- TITLE -->

        <section class="title-area">

          <h1>
            Room Allocation
          </h1>

          <p>
            Student accommodation allocation record
          </p>

        </section>


        <!-- ALLOCATION NUMBER -->

        <section class="allocation-banner">

          <div>

            <span class="allocation-banner-label">
              ALLOCATION NUMBER
            </span>

            <strong class="allocation-number">
              ${escapeHtml(allocationNumber)}
            </strong>

          </div>


          <div class="confirmed">
            ${escapeHtml(status)}
          </div>

        </section>


        <!-- ROOM -->

        <section class="section">

          <div class="section-heading">

            <div class="section-icon">
              ⌂
            </div>

            <div>

              <strong>
                Accommodation Assignment
              </strong>

              <span>
                Assigned location within Asogli Hall
              </span>

            </div>

          </div>


          <div class="room-grid">

            <div class="room-item">

              <span>
                Block
              </span>

              <strong>
                ${escapeHtml(room?.block || '—')}
              </strong>

            </div>


            <div class="room-item">

              <span>
                Room
              </span>

              <strong>
                ${escapeHtml(room?.room_number ?? '—')}
              </strong>

            </div>


            <div class="room-item highlight">

              <span>
                Assigned Bed
              </span>

              <strong>
                Bed ${escapeHtml(bed?.bed_number ?? '—')}
              </strong>

            </div>


            <div class="room-item">

              <span>
                Floor
              </span>

              <strong>
                ${escapeHtml(room?.floor ?? '—')}
              </strong>

            </div>

          </div>

        </section>


        <!-- STUDENT -->

        <section class="section">

          <div class="section-heading">

            <div class="section-icon">
              ◉
            </div>

            <div>

              <strong>
                Student Information
              </strong>

              <span>
                Information associated with this allocation
              </span>

            </div>

          </div>


          <div class="student-grid">

            <div class="student-item">

              <span>
                Student Name
              </span>

              <strong>
                ${escapeHtml(studentName)}
              </strong>

            </div>


            <div class="student-item">

              <span>
                Index Number
              </span>

              <strong>
                ${escapeHtml(studentId)}
              </strong>

            </div>


            <div class="student-item">

              <span>
                Programme
              </span>

              <strong>
                ${escapeHtml(programme)}
              </strong>

            </div>


            <div class="student-item">

              <span>
                Level
              </span>

              <strong>
                ${escapeHtml(level)}
              </strong>

            </div>


            <div class="student-item">

              <span>
                Gender
              </span>

              <strong>
                ${escapeHtml(gender)}
              </strong>

            </div>


            <div class="student-item">

              <span>
                Phone Number
              </span>

              <strong>
                ${escapeHtml(phone)}
              </strong>

            </div>

          </div>

        </section>


        <!-- RECORD -->

        <section class="section">

          <div class="section-heading">

            <div class="section-icon">
              ✓
            </div>

            <div>

              <strong>
                Allocation Record
              </strong>

              <span>
                Confirmation information
              </span>

            </div>

          </div>


          <div class="record">

            <div class="record-item">

              <span>
                Allocation Date
              </span>

              <strong>
                ${escapeHtml(createdAt)}
              </strong>

            </div>


            <div class="record-item">

              <span>
                Status
              </span>

              <strong class="record-status">
                ${escapeHtml(status)}
              </strong>

            </div>

          </div>

        </section>


        <div class="notice">

          <strong>
            Important:
          </strong>

          This document confirms the accommodation assignment
          recorded for the student in the UHAS Asogli Hall
          accommodation system. Students should retain this
          document for their records.

        </div>


        <!-- FOOTER -->

        <footer class="footer">

          <div>
            UHAS Asogli Hall Accommodation Portal
          </div>

          <div>
            <strong>
              Official Student Copy
            </strong>
          </div>

        </footer>


      </main>


      <script>

        window.addEventListener(
          'load',
          function () {

            setTimeout(
              function () {

                window.print();

              },
              250
            );

          }
        );

        window.addEventListener(
          'afterprint',
          function () {

            window.close();

          }
        );

      <\/script>

    </body>

    </html>
  `);

  printWindow.document.close();
}

async function logoutStudent() {
  if (!window.confirm('Are you sure you want to log out of your accommodation portal?')) return;

  stopHoldTimer();
  currentStudent = null;
  currentAllocation = null;
  currentPortalData = null;
  currentHold = null;
  selectedBlock = null;
  portalTab = 'room';

  markStudentLoggedOut();

  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error('Logout error:', error);
  }

  if (allocationSection) { allocationSection.innerHTML = ''; allocationSection.hidden = true; }
  if (genderSection) genderSection.hidden = true;
  if (blockSection) blockSection.hidden = true;
  if (roomsSection) roomsSection.hidden = true;
  if (loginSection) loginSection.hidden = false;

  if (indexInput) indexInput.value = '';
  if (accessCodeInput) accessCodeInput.value = '';
  if (phoneNumberInput) phoneNumberInput.value = '';

  showMessage('You have been logged out. Enter your index number and access code to continue.');
  updateProgress(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadExistingAllocation() {
  try {
    const { data, error } = await invokeStudentFunction('my-allocation');
    if (error || !data?.student) return false;

    currentStudent = data.student;
    currentPortalData = data;
    if (!Array.isArray(currentPortalData.roommates)) currentPortalData.roommates = [];
    if (!data.allocation) {
      currentAllocation = null;
      return false;
    }

    currentAllocation = data.allocation;
    if (loginSection) loginSection.hidden = true;
    if (genderSection) genderSection.hidden = true;
    if (blockSection) blockSection.hidden = true;
    if (roomsSection) roomsSection.hidden = true;

    portalTab = 'room';
    renderStudentPortal();
    return true;
  } catch (error) {
    return false;
  }
}

// --------------------------------------------------
// INITIALIZATION & LISTENERS
// --------------------------------------------------

if (changeBlockButton) {
  changeBlockButton.addEventListener('click', () => {
    selectedBlock = null;
    showBlockSelection();
  });
}

if (loginButton) {
  loginButton.addEventListener('click', event => {
    event.preventDefault();
    activateStudent();
  });
}

if (accessCodeInput) {
  accessCodeInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      activateStudent();
    }
  });
}

if (indexInput) {
  indexInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      activateStudent();
    }
  });
}

if (savePhoneButton) {
  savePhoneButton.addEventListener('click', event => {
    event.preventDefault();
    savePhoneAndContinue();
  });
}

document.querySelectorAll('.gender-choice').forEach(button => {
  button.addEventListener('click', () => selectGender(button.dataset.gender));
});

document.querySelectorAll('.block-choice').forEach(button => {
  button.addEventListener('click', () => selectBlock(button.dataset.block));
});

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_OUT') {
    currentStudent = null;
    currentAllocation = null;
    currentPortalData = null;
    currentHold = null;
    stopHoldTimer();

    if (!wasStudentLoggedOut() && session === null) {
      if (loginSection) loginSection.hidden = false;
    }
  }
});
(async () => {
  try {
    applyBranding();
    createApplicationHeader();
    updateProgress(1);

    if (genderSection) genderSection.hidden = true;
    if (blockSection) blockSection.hidden = true;
    if (roomsSection) roomsSection.hidden = true;
    if (allocationSection) allocationSection.hidden = true;

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      console.error('Unable to get Supabase session:', sessionError);

      if (loginSection) loginSection.hidden = false;
      return;
    }

    const session = sessionData?.session;

    // No authenticated session
    if (!session || session.user?.is_anonymous) {
      if (session?.user?.is_anonymous) {
        await supabase.auth.signOut();
      }

      if (loginSection) loginSection.hidden = false;
      return;
    }

    // --------------------------------------------------
    // RESTORE STUDENT
    // --------------------------------------------------

    const { data, error } =
      await invokeStudentFunction('my-allocation');

    if (error) {
      console.error(
        'my-allocation failed while restoring session:',
        error
      );

      /*
       * DO NOT sign the student out here.
       *
       * A 403 may be an Edge Function configuration
       * problem rather than an expired login.
       */

      if (loginSection) loginSection.hidden = false;

      return;
    }

    if (!data?.student) {
      console.warn('No student record returned.');

      if (loginSection) loginSection.hidden = false;

      return;
    }

    // Successfully restored student
    currentStudent = data.student;
    currentPortalData = data;

    if (!Array.isArray(currentPortalData.roommates)) {
      currentPortalData.roommates = [];
    }

    // --------------------------------------------------
    // EXISTING ALLOCATION
    // --------------------------------------------------

    if (data.allocation) {

      currentAllocation = data.allocation;

      if (loginSection) loginSection.hidden = true;
      if (genderSection) genderSection.hidden = true;
      if (blockSection) blockSection.hidden = true;
      if (roomsSection) roomsSection.hidden = true;

      portalTab = 'room';

      renderStudentPortal();

      return;
    }

    // --------------------------------------------------
    // NO ALLOCATION
    // --------------------------------------------------

    currentAllocation = null;

    if (loginSection) {
      loginSection.hidden = true;
    }

    const hasPhone =
      Boolean(
        currentStudent?.phone_number &&
        String(currentStudent.phone_number).trim()
      );

    const hasGender =
      Boolean(
        currentStudent?.gender &&
        String(currentStudent.gender).trim()
      );

    // Profile incomplete
    if (!hasPhone || !hasGender) {
      await showGenderSelection();
      return;
    }

    // Profile complete → choose block
    showBlockSelection();

  } catch (error) {

    console.error(
      'Application initialization failed:',
      error
    );

    if (loginSection) loginSection.hidden = false;

    if (genderSection) genderSection.hidden = true;
    if (blockSection) blockSection.hidden = true;
    if (roomsSection) roomsSection.hidden = true;
    if (allocationSection) allocationSection.hidden = true;
  }
})();