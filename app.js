/* ═══════════════════════════════════════════════════════════
   Reminder App – app.js
   Audio + Visual reminders, LocalStorage persistence, PWA
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ── Constants ──────────────────────────────────────────── */
const STORAGE_KEY = 'reminder_app_v1';
const TICK_INTERVAL = 10_000; // check every 10 s

/* ── State ──────────────────────────────────────────────── */
let reminders = [];
let audioEnabled = true;
let audioCtx = null;
let deferredInstallPrompt = null;
let currentlyFiringId = null;

/* ── DOM refs ───────────────────────────────────────────── */
const form           = document.getElementById('reminder-form');
const titleInput     = document.getElementById('title');
const datetimeInput  = document.getElementById('datetime');
const notesInput     = document.getElementById('notes');
const repeatSelect   = document.getElementById('repeat');
const snoozeSelect   = document.getElementById('snooze-min');
const editIdInput    = document.getElementById('edit-id');
const submitBtn      = document.getElementById('submit-btn');
const cancelEditBtn  = document.getElementById('cancel-edit-btn');
const formHeading    = document.getElementById('form-heading');
const list           = document.getElementById('reminders-list');
const statsRow       = document.getElementById('stats-row');
const searchInput    = document.getElementById('search-input');
const filterSelect   = document.getElementById('filter-select');
const clearDoneBtn   = document.getElementById('clear-done-btn');
const notifBanner    = document.getElementById('notif-banner');
const notifAllowBtn  = document.getElementById('notif-allow-btn');
const installBtn     = document.getElementById('install-btn');
const audioToggle    = document.getElementById('audio-toggle');
const alertOverlay   = document.getElementById('alert-overlay');
const alertTitle     = document.getElementById('alert-title');
const alertBody      = document.getElementById('alert-body');
const snoozeAlertBtn = document.getElementById('snooze-alert-btn');
const dismissAlertBtn= document.getElementById('dismiss-alert-btn');
const toastContainer = document.getElementById('toast-container');

/* ══════════════════════════════════════════════════════════
   STORAGE
   ══════════════════════════════════════════════════════════ */
function loadReminders() {
  try {
    reminders = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (_) {
    reminders = [];
  }
}

function saveReminders() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
}

/* ══════════════════════════════════════════════════════════
   AUDIO
   ══════════════════════════════════════════════════════════ */
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/** Play a simple tri-tone chime. */
function playAlertSound() {
  if (!audioEnabled) return;
  try {
    const ctx = getAudioContext();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.22);
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.22);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + i * 0.22 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.45);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.5);
    });
  } catch (err) {
    console.warn('Audio playback failed:', err);
  }
}

/** Shorter "confirm" ding. */
function playConfirmSound() {
  if (!audioEnabled) return;
  try {
    const ctx = getAudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

/* ══════════════════════════════════════════════════════════
   VISUAL NOTIFICATION
   ══════════════════════════════════════════════════════════ */
function sendBrowserNotification(reminder) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(`🔔 ${reminder.title}`, {
    body: reminder.notes || 'Your reminder is due!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: reminder.id,
    renotify: true,
  });
  n.onclick = () => { window.focus(); n.close(); };
}

/* ══════════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════════ */
function showToast(title, message = '', type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<strong>${escHtml(title)}</strong>${message ? escHtml(message) : ''}`;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

/* ══════════════════════════════════════════════════════════
   ALERT OVERLAY (fires when reminder is due)
   ══════════════════════════════════════════════════════════ */
function showAlertOverlay(reminder) {
  currentlyFiringId = reminder.id;
  alertTitle.textContent = reminder.title;
  alertBody.textContent  = reminder.notes
    ? `${formatDt(reminder.datetime)}\n${reminder.notes}`
    : formatDt(reminder.datetime);
  alertOverlay.classList.add('visible');
  alertOverlay.focus();
  // Repeat chime every 3 s while overlay is open
  playAlertSound();
  const interval = setInterval(() => {
    if (!alertOverlay.classList.contains('visible')) {
      clearInterval(interval);
      return;
    }
    playAlertSound();
  }, 3000);
  alertOverlay._chimeInterval = interval;
}

function closeAlertOverlay() {
  clearInterval(alertOverlay._chimeInterval);
  alertOverlay.classList.remove('visible');
  currentlyFiringId = null;
}

dismissAlertBtn.addEventListener('click', () => {
  if (currentlyFiringId) markDone(currentlyFiringId);
  closeAlertOverlay();
});

snoozeAlertBtn.addEventListener('click', () => {
  if (currentlyFiringId) snoozeReminder(currentlyFiringId);
  closeAlertOverlay();
});

/* Close overlay with Escape key */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && alertOverlay.classList.contains('visible')) {
    if (currentlyFiringId) snoozeReminder(currentlyFiringId);
    closeAlertOverlay();
  }
});

/* ══════════════════════════════════════════════════════════
   REMINDER TICK – check for due reminders
   ══════════════════════════════════════════════════════════ */
function tick() {
  const now = Date.now();
  let changed = false;

  reminders.forEach((reminder) => {
    if (reminder.status !== 'pending' && reminder.status !== 'snoozed') return;
    const due = new Date(reminder.datetime).getTime();
    if (now >= due) {
      // Mark as firing visually
      reminder.status = 'firing';
      changed = true;
      fireReminder(reminder);
    }
  });

  if (changed) {
    saveReminders();
    renderList();
  }
}

function fireReminder(reminder) {
  playAlertSound();
  sendBrowserNotification(reminder);
  showAlertOverlay(reminder);
  showToast(`🔔 ${reminder.title}`, reminder.notes || '', 'warn');
}

/* ══════════════════════════════════════════════════════════
   CRUD
   ══════════════════════════════════════════════════════════ */
function addOrUpdateReminder(data) {
  if (data.id) {
    const idx = reminders.findIndex((reminder) => reminder.id === data.id);
    if (idx >= 0) {
      reminders[idx] = { ...reminders[idx], ...data, status: 'pending' };
      showToast('Reminder updated ✏️', data.title, 'success');
    }
  } else {
    const newReminder = {
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: data.title,
      datetime: data.datetime,
      notes: data.notes,
      repeat: data.repeat,
      snoozeMins: data.snoozeMins,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    reminders.unshift(newReminder);
    playConfirmSound();
    showToast('Reminder saved 🎉', data.title, 'success');
  }
  saveReminders();
  renderList();
}

function deleteReminder(id) {
  reminders = reminders.filter((reminder) => reminder.id !== id);
  saveReminders();
  renderList();
  showToast('Reminder deleted', '', 'error');
}

function markDone(id) {
  const reminder = reminders.find((reminder) => reminder.id === id);
  if (!reminder) return;
  if (reminder.repeat !== 'none' && reminder.status !== 'done') {
    // Advance to next occurrence
    const dt = new Date(reminder.datetime);
    if (reminder.repeat === 'daily')  dt.setDate(dt.getDate() + 1);
    if (reminder.repeat === 'weekly') dt.setDate(dt.getDate() + 7);
    reminder.datetime = dt.toISOString().slice(0, 16);
    reminder.status = 'pending';
    showToast('Repeated 🔁', `Next: ${formatDt(reminder.datetime)}`, 'info');
  } else {
    reminder.status = reminder.status === 'done' ? 'pending' : 'done';
  }
  saveReminders();
  renderList();
}

function snoozeReminder(id) {
  const reminder = reminders.find((reminder) => reminder.id === id);
  if (!reminder) return;
  const mins = parseInt(reminder.snoozeMins, 10) || 15;
  const newDt = new Date(Date.now() + mins * 60_000);
  reminder.datetime = newDt.toISOString().slice(0, 16);
  reminder.status = 'snoozed';
  saveReminders();
  renderList();
  showToast('Snoozed 😴', `Remind me in ${mins} min`, 'warn');
}

function startEdit(id) {
  const reminder = reminders.find((reminder) => reminder.id === id);
  if (!reminder) return;
  editIdInput.value   = reminder.id;
  titleInput.value    = reminder.title;
  datetimeInput.value = reminder.datetime;
  notesInput.value    = reminder.notes || '';
  repeatSelect.value  = reminder.repeat || 'none';
  snoozeSelect.value  = reminder.snoozeMins || '15';
  formHeading.textContent = '✏️ Edit Reminder';
  submitBtn.textContent   = '💾 Update Reminder';
  cancelEditBtn.style.display = '';
  titleInput.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  form.reset();
  editIdInput.value = '';
  formHeading.textContent = '➕ Add Reminder';
  submitBtn.textContent   = '💾 Save Reminder';
  cancelEditBtn.style.display = 'none';
}

/* ══════════════════════════════════════════════════════════
   RENDER
   ══════════════════════════════════════════════════════════ */
function getFilteredReminders() {
  const query  = searchInput.value.trim().toLowerCase();
  const filter = filterSelect.value;
  return reminders.filter((reminder) => {
    if (filter !== 'all' && reminder.status !== filter) return false;
    if (query && !reminder.title.toLowerCase().includes(query) &&
        !(reminder.notes || '').toLowerCase().includes(query)) return false;
    return true;
  });
}

function renderList() {
  const filtered = getFilteredReminders();

  // Stats
  const counts = { pending: 0, done: 0, missed: 0, snoozed: 0, firing: 0 };
  reminders.forEach((reminder) => { if (counts[reminder.status] !== undefined) counts[reminder.status]++; });
  statsRow.innerHTML = [
    ['Total',   reminders.length],
    ['Pending', counts.pending + counts.snoozed + counts.firing],
    ['Done',    counts.done],
    ['Missed',  counts.missed],
  ].map(([label, val]) =>
    `<span class="stat-chip">${label}: <span>${val}</span></span>`
  ).join('');

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">🗒️</div>
        <p>${reminders.length === 0
          ? 'No reminders yet. Add one above!'
          : 'No reminders match your filter.'}</p>
      </div>`;
    return;
  }

  // Sort: firing first, then by datetime asc
  const sorted = [...filtered].sort((a, b) => {
    if (a.status === 'firing' && b.status !== 'firing') return -1;
    if (b.status === 'firing' && a.status !== 'firing') return  1;
    return new Date(a.datetime) - new Date(b.datetime);
  });

  list.innerHTML = sorted.map((reminder) => {
    const statusClass = reminder.status === 'firing' ? 'pending' : reminder.status;
    const badgeClass  = reminder.status === 'firing' ? 'badge-firing' : `badge-${reminder.status}`;
    const badgeLabel  = reminder.status === 'firing' ? '🔔 FIRING' : reminder.status.charAt(0).toUpperCase() + reminder.status.slice(1);

    return `
    <div class="reminder-item ${statusClass}" data-id="${escAttr(reminder.id)}" role="listitem">
      <input type="checkbox" class="reminder-checkbox"
             ${reminder.status === 'done' ? 'checked' : ''}
             aria-label="Mark '${escAttr(reminder.title)}' as done"
             data-action="toggle" data-id="${escAttr(reminder.id)}" />
      <div class="reminder-body">
        <div class="reminder-title">${escHtml(reminder.title)}</div>
        <div class="reminder-meta">
          <span>📅 ${formatDt(reminder.datetime)}</span>
          ${reminder.repeat !== 'none' ? `<span>🔁 ${reminder.repeat}</span>` : ''}
          <span class="badge ${badgeClass}">${badgeLabel}</span>
        </div>
        ${reminder.notes ? `<div class="reminder-note">${escHtml(reminder.notes)}</div>` : ''}
      </div>
      <div class="reminder-actions">
        ${reminder.status !== 'done'
          ? `<button class="btn-icon" title="Snooze" data-action="snooze" data-id="${escAttr(reminder.id)}" aria-label="Snooze reminder">😴</button>`
          : ''}
        <button class="btn-icon" title="Edit" data-action="edit" data-id="${escAttr(reminder.id)}" aria-label="Edit reminder">✏️</button>
        <button class="btn-icon" title="Delete" data-action="delete" data-id="${escAttr(reminder.id)}" aria-label="Delete reminder">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   EVENT DELEGATION on list
   ══════════════════════════════════════════════════════════ */
list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === 'delete') deleteReminder(id);
  if (action === 'edit')   startEdit(id);
  if (action === 'snooze') snoozeReminder(id);
  if (action === 'toggle') markDone(id);
});

list.addEventListener('change', (e) => {
  if (e.target.matches('.reminder-checkbox')) {
    markDone(e.target.dataset.id);
  }
});

/* ══════════════════════════════════════════════════════════
   FORM SUBMIT
   ══════════════════════════════════════════════════════════ */
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  const dt    = datetimeInput.value;
  if (!title) { showToast('Title required', '', 'error'); titleInput.focus(); return; }
  if (!dt)    { showToast('Date & Time required', '', 'error'); datetimeInput.focus(); return; }

  const data = {
    id:        editIdInput.value || null,
    title,
    datetime:  dt,
    notes:     notesInput.value.trim(),
    repeat:    repeatSelect.value,
    snoozeMins: snoozeSelect.value,
  };
  addOrUpdateReminder(data);
  cancelEdit();
});

cancelEditBtn.addEventListener('click', cancelEdit);

/* ══════════════════════════════════════════════════════════
   SEARCH / FILTER
   ══════════════════════════════════════════════════════════ */
searchInput.addEventListener('input', renderList);
filterSelect.addEventListener('change', renderList);

/* ══════════════════════════════════════════════════════════
   CLEAR DONE
   ══════════════════════════════════════════════════════════ */
clearDoneBtn.addEventListener('click', () => {
  const before = reminders.length;
  reminders = reminders.filter((reminder) => reminder.status !== 'done');
  if (reminders.length < before) {
    saveReminders();
    renderList();
    showToast('Cleared completed reminders', '', 'success');
  }
});

/* ══════════════════════════════════════════════════════════
   NOTIFICATION PERMISSION
   ══════════════════════════════════════════════════════════ */
function updateNotifBanner() {
  if (!('Notification' in window)) return;
  notifBanner.classList.toggle('visible', Notification.permission === 'default');
}

notifAllowBtn.addEventListener('click', async () => {
  const perm = await Notification.requestPermission();
  updateNotifBanner();
  if (perm === 'granted') showToast('Notifications enabled 🔔', '', 'success');
  else showToast('Notifications blocked', 'You can still use in-app alerts.', 'warn');
});

/* ══════════════════════════════════════════════════════════
   AUDIO TOGGLE
   ══════════════════════════════════════════════════════════ */
audioToggle.addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  audioToggle.classList.toggle('on', audioEnabled);
  audioToggle.querySelector('.audio-icon').textContent = audioEnabled ? '🔊' : '🔇';
  audioToggle.lastChild.textContent = audioEnabled ? ' Sound On' : ' Sound Off';
  audioToggle.setAttribute('aria-pressed', String(audioEnabled));
  if (audioEnabled) playConfirmSound();
});

/* ══════════════════════════════════════════════════════════
   PWA INSTALL
   ══════════════════════════════════════════════════════════ */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.classList.add('visible');
});

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    showToast('App installed! 🎉', 'Find it in your app launcher.', 'success');
    installBtn.classList.remove('visible');
  }
  deferredInstallPrompt = null;
});

window.addEventListener('appinstalled', () => {
  installBtn.classList.remove('visible');
  showToast('App installed! 🎉', '', 'success');
});

/* ══════════════════════════════════════════════════════════
   SERVICE WORKER REGISTRATION
   ══════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

/* ══════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Set the datetime-local input's min to now */
function setMinDatetime() {
  const now = new Date();
  now.setSeconds(0, 0);
  datetimeInput.min = now.toISOString().slice(0, 16);
}

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */
function init() {
  loadReminders();
  setMinDatetime();
  updateNotifBanner();
  audioToggle.classList.add('on');
  audioToggle.setAttribute('aria-pressed', 'true');
  renderList();
  setInterval(tick, TICK_INTERVAL);
  tick(); // immediate first check
}

init();
