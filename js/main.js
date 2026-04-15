// App wiring.
import { loadDay, loadVenues, getDefaultDayKey } from './data.js';
import { solve } from './solver.js';
import { renderActsList, renderTimeline, renderIssues } from './ui.js';
import { encodeState, decodeState } from './share.js';
import { exportScheduleImage } from './export-image.js';
import { maybeShowOnboarding, showOnboarding } from './onboarding.js';

const state = {
  dayKey: getDefaultDayKey(),
  speed: 'normal',
  paddingMin: 2,
  acts: [],
  picks: new Map(), // id -> { tier, desiredDeparture?, desiredArrival? }
  venues: null,
  activeId: null, // id currently being dragged/slid
};

const el = {
  daySelect: document.getElementById('day-select'),
  speedSelect: document.getElementById('speed-select'),
  paddingInput: document.getElementById('padding-input'),
  actsList: document.getElementById('acts-list'),
  timeline: document.getElementById('timeline'),
  issues: document.getElementById('issues'),
  btnSelectAll: document.getElementById('btn-select-all'),
  btnDeselectAll: document.getElementById('btn-deselect-all'),
  btnRandom: document.getElementById('btn-random'),
  btnSeeMost: document.getElementById('btn-see-most'),
  btnImage: document.getElementById('btn-image'),
  btnShare: document.getElementById('btn-share'),
  btnHelp: document.getElementById('btn-help'),
  linkMobile: document.getElementById('link-mobile'),
  themeToggle: document.getElementById('theme-toggle'),
};

// --- Theme handling ---
// Two states: 'light' or 'dark'. First load uses prefers-color-scheme as the
// initial value; subsequent choices are persisted in localStorage under 'theme'.
function getInitialTheme() {
  // Default is light; only honor dark if the user explicitly saved it.
  return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  el.themeToggle.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
}

async function init() {
  applyTheme(getInitialTheme());
  el.themeToggle.addEventListener('click', toggleTheme);
  el.btnHelp.addEventListener('click', () => showOnboarding('desktop'));
  maybeShowOnboarding('desktop');

  state.venues = await loadVenues();

  // If the URL hash encodes a shared plan, decode it and use it as the
  // initial state. Otherwise start with nothing selected — the user picks
  // what they want (or hits "Select all" / "x-games mode" to populate).
  const shared = readHashState();
  if (shared) {
    state.dayKey = shared.dayKey ?? state.dayKey;
    state.speed = shared.speed ?? state.speed;
    state.paddingMin = shared.paddingMin ?? state.paddingMin;
    el.daySelect.value = state.dayKey;
    el.speedSelect.value = state.speed;
    el.paddingInput.value = String(state.paddingMin);
    await loadDayData(state.dayKey, { picksBuilder: shared.picksBuilder });
  } else {
    // Sync the day-picker to whatever default we computed (today's festival
    // day or the next one upcoming).
    el.daySelect.value = state.dayKey;
    await loadDayData(state.dayKey);
  }

  el.daySelect.addEventListener('change', async () => {
    state.dayKey = el.daySelect.value;
    await loadDayData(state.dayKey);
  });
  el.speedSelect.addEventListener('change', () => {
    state.speed = el.speedSelect.value;
    rerender();
  });
  el.paddingInput.addEventListener('input', () => {
    const v = parseFloat(el.paddingInput.value);
    state.paddingMin = Number.isFinite(v) ? v : 0;
    rerender();
  });

  el.btnSelectAll.addEventListener('click', () => {
    state.picks = new Map();
    for (const act of state.acts) state.picks.set(act.id, { tier: 'want' });
    rerender();
  });

  el.btnDeselectAll.addEventListener('click', () => {
    state.picks = new Map();
    rerender();
  });

  el.btnRandom.addEventListener('click', () => {
    state.picks = new Map();
    for (const act of state.acts) {
      if (Math.random() < 0.5) state.picks.set(act.id, { tier: 'want' });
    }
    rerender();
  });

  el.btnSeeMost.addEventListener('click', () => {
    const ok = window.confirm(
      'This will clear all your current selections and pinning, then automatically pick the maximum number of acts you could physically see for at least 5 minutes each.\n\nContinue?',
    );
    if (!ok) return;
    runSeeMost();
  });

  el.btnImage.addEventListener('click', onImageClick);
  el.btnShare.addEventListener('click', onShareClick);

  // Persist the user's manual switch so the auto-dispatcher honors it.
  if (el.linkMobile) {
    el.linkMobile.addEventListener('click', () => {
      try { localStorage.setItem('preferred_version', 'mobile'); } catch (e) {}
    });
    el.linkMobile.href = 'mobile.html' + window.location.hash;
  }
}

// Re-solve on demand and hand off to the image renderer.
function onImageClick() {
  const result = solveCurrent();
  exportScheduleImage({
    dayKey: state.dayKey,
    speed: state.speed,
    paddingMin: state.paddingMin,
    scheduled: result.scheduled,
  });
}

function solveCurrent() {
  const picksArray = [];
  for (const act of state.acts) {
    const entry = state.picks.get(act.id);
    if (!entry || entry.tier === 'none') continue;
    picksArray.push({
      id: act.id,
      act,
      tier: entry.tier,
      desiredArrival: entry.desiredArrival,
      desiredDeparture: entry.desiredDeparture,
    });
  }
  return solve(picksArray, {
    walkSeconds: state.venues.walkSeconds,
    speed: state.speed,
    paddingMin: state.paddingMin,
    activeId: null,
  });
}

// --- Share link handling ---

function readHashState() {
  const hash = window.location.hash;
  if (!hash.startsWith('#p=')) return null;
  const encoded = hash.slice(3);
  return decodeState(encoded);
}

function writeHashState(encoded) {
  // history.replaceState avoids adding a new entry for every share.
  const newHash = `#p=${encoded}`;
  const url = window.location.pathname + window.location.search + newHash;
  history.replaceState(null, '', url);
}

async function onShareClick() {
  const encoded = encodeState({
    dayKey: state.dayKey,
    speed: state.speed,
    paddingMin: state.paddingMin,
    picks: state.picks,
    acts: state.acts,
  });
  writeHashState(encoded);

  const fullUrl = window.location.href;
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(fullUrl);
      copied = true;
    }
  } catch (e) {
    // Clipboard blocked (insecure context, permission denied, etc.) — the
    // URL is still visible in the address bar, so the user can copy manually.
  }
  flashShareFeedback(copied);
}

let shareFlashTimer = null;
function flashShareFeedback(copied) {
  const original = el.btnShare.textContent;
  el.btnShare.textContent = copied ? 'Copied!' : 'Link updated';
  el.btnShare.classList.add('flash-ok');
  clearTimeout(shareFlashTimer);
  shareFlashTimer = setTimeout(() => {
    el.btnShare.textContent = original;
    el.btnShare.classList.remove('flash-ok');
  }, 1500);
}

// Greedy max-count scheduler. Clears all picks and selects as many acts as
// physically fit, each with at least MIN_WATCH_MIN minutes of viewing.
//
// Strategy: walk forward in time, maintaining current location + earliest
// available time. At each step, among the reachable candidates, pick the one
// that minimizes `watchEnd + α × walkMin` — a classic earliest-end-time greedy
// with a small proximity penalty that prevents the algorithm from being dragged
// across the park for a marginally-earlier-ending act and losing nearby ones.
// α=0.3 was empirically best on Saturday (48/53 acts vs 46 with pure greedy).
function runSeeMost() {
  const MIN_WATCH = 5;
  const PROXIMITY_ALPHA = 0.3;

  const acts = [...state.acts].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  const walk = (from, to) => {
    if (from === to) return 0;
    return state.venues.walkSeconds(from, to, state.speed) / 60 + state.paddingMin;
  };

  const picked = [];
  let currentTime = -Infinity; // earliest time we can be "available"
  let currentVenue = null; // where we currently are (null = anywhere)

  while (true) {
    let best = null;
    let bestScore = Infinity;
    let bestEnd = null;
    let bestArrival = null;
    for (const act of acts) {
      if (picked.some((p) => p.id === act.id)) continue;
      const walkMin = currentVenue == null ? 0 : walk(currentVenue, act.venue);
      const earliestArrival = Math.max(act.startMin, currentTime + walkMin);
      const watchEnd = earliestArrival + MIN_WATCH;
      if (watchEnd > act.endMin) continue;
      // Score: earliest end, with a proximity penalty to avoid being dragged
      // into a long walk for a marginally-earlier act.
      const score = watchEnd + PROXIMITY_ALPHA * walkMin;
      if (score < bestScore) {
        best = act;
        bestScore = score;
        bestEnd = watchEnd;
        bestArrival = earliestArrival;
      }
    }
    if (!best) break;

    picked.push({
      id: best.id,
      act: best,
      arrival: bestArrival,
      departure: bestEnd,
    });
    currentTime = bestEnd;
    currentVenue = best.venue;
  }

  // Pass 2: extend each watch window as long as possible without blocking
  // the next picked act. This turns the 5-min stubs into realistic windows.
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    const next = picked[i + 1];
    let latestDeparture = p.act.endMin;
    if (next) {
      const walkMin = walk(p.act.venue, next.act.venue);
      latestDeparture = Math.min(latestDeparture, next.arrival - walkMin);
    }
    p.departure = Math.max(p.departure, latestDeparture);
  }

  // Write results into state.picks. Pin the arrival/departure so they persist
  // and aren't overridden by the main solver's auto-fit logic.
  state.picks = new Map();
  for (const p of picked) {
    state.picks.set(p.id, {
      tier: 'want',
      desiredArrival: p.arrival,
      desiredDeparture: p.departure,
    });
  }

  rerender();
}

async function loadDayData(dayKey, { selectAllAsWant = false, picksBuilder = null } = {}) {
  try {
    state.acts = await loadDay(dayKey);
  } catch (e) {
    state.acts = [];
    el.issues.innerHTML = `<div class="issues-errors"><h3>Error</h3><p>${e.message}</p></div>`;
    el.actsList.innerHTML = '';
    while (el.timeline.firstChild) el.timeline.removeChild(el.timeline.firstChild);
    return;
  }
  if (picksBuilder) {
    state.picks = picksBuilder(state.acts);
  } else if (selectAllAsWant) {
    state.picks = new Map();
    for (const act of state.acts) {
      state.picks.set(act.id, { tier: 'want' });
    }
  } else {
    state.picks = new Map();
  }
  rerender();
}

function rerender() {
  const picksArray = [];
  for (const act of state.acts) {
    const entry = state.picks.get(act.id);
    if (!entry || entry.tier === 'none') continue;
    picksArray.push({
      id: act.id,
      act,
      tier: entry.tier,
      desiredArrival: entry.desiredArrival,
      desiredDeparture: entry.desiredDeparture,
    });
  }

  const result = solve(picksArray, {
    walkSeconds: state.venues.walkSeconds,
    speed: state.speed,
    paddingMin: state.paddingMin,
    activeId: state.activeId,
  });

  renderActsList(el.actsList, state.acts, state.picks, onCycleTier);
  renderTimeline(el.timeline, state.acts, result, state.picks, {
    onDragDeparture,
    onSlideWindow,
    onDragStart,
    onDragEnd,
    onCycleTier,
  });
  renderIssues(el.issues, result);
}

function onCycleTier(actId, nextTier) {
  if (nextTier === 'none') {
    state.picks.delete(actId);
  } else {
    // Cycling tier clears any manual pinning — user is making a coarse change.
    state.picks.set(actId, { tier: nextTier });
  }
  rerender();
}

function onDragDeparture(actId, newDepartureMin) {
  const entry = state.picks.get(actId);
  if (!entry) return;
  state.picks.set(actId, { ...entry, desiredDeparture: newDepartureMin });
  rerender();
}

function onSlideWindow(actId, newArrivalMin, newDepartureMin) {
  const entry = state.picks.get(actId);
  if (!entry) return;
  state.picks.set(actId, {
    ...entry,
    desiredArrival: newArrivalMin,
    desiredDeparture: newDepartureMin,
  });
  rerender();
}

function onDragStart(actId) {
  state.activeId = actId;
}

function onDragEnd() {
  state.activeId = null;
  rerender();
}

init();
