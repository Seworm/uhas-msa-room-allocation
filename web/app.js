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
  document.getElementById('printAllocation')?.addEventListener('click', () => window.print());
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
  document.getElementById('printStudentAllocation')?.addEventListener('click', () => window.print());
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

  return `
    <section class="portal-panel">
      <div class="portal-panel-heading">
        <span class="eyebrow">YOUR ACCOMMODATION</span>
        <h3>My Room</h3>
        <p>Your currently assigned room and bed.</p>
      </div>
      <div class="my-room-card">
        <div class="my-room-primary">
          <span class="room-label">ROOM</span>
          <strong class="portal-room-code">${escapeHtml(room?.room_code || '—')}</strong>
          <span class="room-location">${escapeHtml(room?.block || '')} · Floor ${escapeHtml(room?.floor ?? '—')} · Room ${escapeHtml(room?.room_number ?? '—')}</span>
        </div>
        <div class="my-room-bed">
          <span class="room-label">ASSIGNED BED</span>
          <strong>Bed ${escapeHtml(bed?.bed_number ?? '—')}</strong>
        </div>
      </div>
      <div class="portal-info-grid">
        <div class="portal-info-card"><span>BLOCK</span><strong>${escapeHtml(room?.block || '—')}</strong></div>
        <div class="portal-info-card"><span>ROOM</span><strong>${escapeHtml(room?.room_number ?? '—')}</strong></div>
        <div class="portal-info-card"><span>FLOOR</span><strong>${escapeHtml(room?.floor ?? '—')}</strong></div>
        <div class="portal-info-card"><span>BED</span><strong>${escapeHtml(bed?.bed_number ?? '—')}</strong></div>
      </div>
    </section>
  `;
}

function renderRoommatesTab() {
  const roommates = Array.isArray(currentPortalData?.roommates) ? currentPortalData.roommates : [];
  if (!roommates.length) {
    return `
      <section class="portal-panel">
        <div class="portal-panel-heading">
          <span class="eyebrow">YOUR ROOM</span>
          <h3>Roommates</h3>
          <p>Other students assigned to your room.</p>
        </div>
        <div class="portal-empty-state">
          <div class="empty-icon">◉</div>
          <h4>No other roommates found</h4>
          <p>There are currently no other allocated students returned for this room.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="portal-panel">
      <div class="portal-panel-heading">
        <span class="eyebrow">YOUR ROOM</span>
        <h3>Roommates</h3>
        <p>${roommates.length} ${roommates.length === 1 ? 'other student' : 'other students'} currently assigned to your room.</p>
      </div>
      <div class="roommate-list">
        ${roommates.map(r => `
          <article class="roommate-card">
            <div class="roommate-avatar">${escapeHtml(String(r?.student_name || '?').trim().charAt(0).toUpperCase())}</div>
            <div class="roommate-details">
              <strong>${escapeHtml(r?.student_name || 'Student')}</strong>
              <span>${escapeHtml(r?.programme || 'Programme not available')}</span>
              <span>Level ${escapeHtml(r?.level ?? '—')}</span>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderAllocationDetailsTab() {
  const allocation = currentAllocation;
  const bed = allocation?.beds;
  const room = bed?.rooms;
  const createdAt = allocation?.created_at ? new Date(allocation.created_at).toLocaleString() : '—';

  return `
    <section class="portal-panel">
      <div class="portal-panel-heading">
        <span class="eyebrow">CONFIRMED ALLOCATION</span>
        <h3>Allocation Details</h3>
        <p>Your official accommodation assignment.</p>
      </div>
      <div class="allocation-ticket portal-ticket">
        <div class="ticket-header">
          <div><span>ALLOCATION NUMBER</span><strong>${escapeHtml(allocation?.allocation_number || '—')}</strong></div>
          <span class="ticket-confirmed">${escapeHtml(allocation?.status || 'CONFIRMED').toUpperCase()}</span>
        </div>
        <div class="ticket-student">
          <span>STUDENT</span>
          <strong>${escapeHtml(currentStudent?.student_name || '—')}</strong>
        </div>
        <div class="ticket-grid">
          <div><span>BLOCK</span><strong>${escapeHtml(room?.block || '—')}</strong></div>
          <div><span>ROOM</span><strong>${escapeHtml(room?.room_number ?? '—')}</strong></div>
          <div><span>BED</span><strong>${escapeHtml(bed?.bed_number ?? '—')}</strong></div>
          <div><span>ROOM CODE</span><strong>${escapeHtml(room?.room_code || '—')}</strong></div>
        </div>
        <div class="allocation-created">
          <span>ALLOCATION DATE</span>
          <strong>${escapeHtml(createdAt)}</strong>
        </div>
      </div>
      <button type="button" class="primary-action" id="printStudentAllocation">Print / Save allocation <span aria-hidden="true">↗</span></button>
    </section>
  `;
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

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      if (loginSection) loginSection.hidden = false;
      return;
    }

    const session = sessionData?.session;

    if (wasStudentLoggedOut()) {
      if (session) await supabase.auth.signOut();
      if (loginSection) loginSection.hidden = false;
      return;
    }

    if (!session || session.user?.is_anonymous) {
      if (session?.user?.is_anonymous) await supabase.auth.signOut();
      if (loginSection) loginSection.hidden = false;
      return;
    }

    const existingAllocation = await loadExistingAllocation();
    if (existingAllocation) return;

    try {
      const { data, error } = await invokeStudentFunction('my-allocation');
      if (!error && data?.student) {
        currentStudent = data.student;
        currentPortalData = data;
      }
    } catch (error) {
      console.warn('Unable to restore student profile:', error);
    }

    if (loginSection) loginSection.hidden = true;
    await showGenderSelection();
  } catch (error) {
    if (loginSection) loginSection.hidden = false;
  }
})();