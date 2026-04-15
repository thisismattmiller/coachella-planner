// Mobile wiring. Reuses the existing data/solver/share modules unchanged.
import { loadDay, loadVenues, getDefaultDayKey } from './data.js';
import { solve } from './solver.js';
import { encodeState, decodeState } from './share.js';
import { exportScheduleImage } from './export-image.js';
import { maybeShowOnboarding, showOnboarding } from './onboarding.js';
import { renderMobileTimeline, renderIssues } from './mobile-ui.js';

const state = {
  dayKey: getDefaultDayKey(),
  speed: 'normal',
  paddingMin: 2,
  acts: [],
  picks: new Map(),
  venues: null,
  activeId: null,
};

const el = {
  daySelect: document.getElementById('day-select'),
  speedSelect: document.getElementById('speed-select'),
  paddingInput: document.getElementById('padding-input'),
  timeline: document.getElementById('timeline'),
  issues: document.getElementById('issues'),
  btnDeselectAll: document.getElementById('btn-deselect-all'),
  btnSeeMost: document.getElementById('btn-see-most'),
  btnImage: document.getElementById('btn-image'),
  btnShare: document.getElementById('btn-share'),
  btnHelp: document.getElementById('btn-help'),
  linkDesktop: document.getElementById('link-desktop'),
  themeToggle: document.getElementById('theme-toggle'),
};

// --- Theme ---
function getInitialTheme() {
  // Default is light; only honor dark if the user explicitly saved it.
  return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
}

async function init() {
  applyTheme(getInitialTheme());
  el.themeToggle.addEventListener('click', toggleTheme);
  el.btnHelp.addEventListener('click', () => showOnboarding('mobile'));
  maybeShowOnboarding('mobile');

  state.venues = await loadVenues();

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
    // Sync the day-picker to the computed default.
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

  el.btnDeselectAll.addEventListener('click', () => {
    state.picks = new Map();
    rerender();
  });

  el.btnSeeMost.addEventListener('click', () => {
    if (!window.confirm('Clear current plan and auto-select the maximum number of acts you could see for 5+ min each?')) return;
    runSeeMost();
  });

  el.btnImage.addEventListener('click', onImageClick);
  el.btnShare.addEventListener('click', onShareClick);

  // Persist the user's manual switch so the auto-dispatcher honors it.
  if (el.linkDesktop) {
    el.linkDesktop.addEventListener('click', () => {
      try { localStorage.setItem('preferred_version', 'desktop'); } catch (e) {}
    });
    // Preserve the current plan hash across the jump.
    el.linkDesktop.href = 'index.html' + window.location.hash;
  }
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

function onImageClick() {
  const result = solveCurrent();
  exportScheduleImage({
    dayKey: state.dayKey,
    speed: state.speed,
    paddingMin: state.paddingMin,
    scheduled: result.scheduled,
  });
}

async function loadDayData(dayKey, { picksBuilder = null } = {}) {
  try {
    state.acts = await loadDay(dayKey);
  } catch (e) {
    state.acts = [];
    el.issues.innerHTML = `<div class="issues-errors"><h3>Error</h3><p>${e.message}</p></div>`;
    while (el.timeline.firstChild) el.timeline.removeChild(el.timeline.firstChild);
    return;
  }
  state.picks = picksBuilder ? picksBuilder(state.acts) : new Map();
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

  renderMobileTimeline(el.timeline, state.acts, result, state.picks, {
    onCycleTier,
    onSlideWindow,
    onResizeDeparture,
    onDragStart,
    onDragEnd,
  });
  renderIssues(el.issues, result);
}

function onCycleTier(actId, nextTier) {
  if (nextTier === 'none') state.picks.delete(actId);
  else state.picks.set(actId, { tier: nextTier });
  rerender();
}

function onSlideWindow(actId, newArrivalMin, newDepartureMin) {
  const entry = state.picks.get(actId);
  if (!entry) return;
  state.picks.set(actId, { ...entry, desiredArrival: newArrivalMin, desiredDeparture: newDepartureMin });
  rerender();
}

function onResizeDeparture(actId, newDepartureMin) {
  const entry = state.picks.get(actId);
  if (!entry) return;
  state.picks.set(actId, { ...entry, desiredDeparture: newDepartureMin });
  rerender();
}

function onDragStart(actId) { state.activeId = actId; }
function onDragEnd() { state.activeId = null; rerender(); }

// --- Greedy scheduler (copy of desktop's, intentionally duplicated so the
// mobile page doesn't import from main.js and stays independent). ---
function runSeeMost() {
  const MIN_WATCH = 5;
  const PROXIMITY_ALPHA = 0.3;

  const acts = [...state.acts].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const walk = (from, to) => {
    if (from === to) return 0;
    return state.venues.walkSeconds(from, to, state.speed) / 60 + state.paddingMin;
  };

  const picked = [];
  let currentTime = -Infinity;
  let currentVenue = null;

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
      const score = watchEnd + PROXIMITY_ALPHA * walkMin;
      if (score < bestScore) {
        best = act;
        bestScore = score;
        bestEnd = watchEnd;
        bestArrival = earliestArrival;
      }
    }
    if (!best) break;
    picked.push({ id: best.id, act: best, arrival: bestArrival, departure: bestEnd });
    currentTime = bestEnd;
    currentVenue = best.venue;
  }

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

// --- Share link handling (same format as desktop) ---
function readHashState() {
  const hash = window.location.hash;
  if (!hash.startsWith('#p=')) return null;
  return decodeState(hash.slice(3));
}

function writeHashState(encoded) {
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
  } catch (e) {}
  flashShareFeedback(copied);
}

let shareFlashTimer = null;
function flashShareFeedback(copied) {
  const orig = el.btnShare.textContent;
  el.btnShare.textContent = copied ? 'Copied!' : 'Linked';
  el.btnShare.classList.add('flash-ok');
  clearTimeout(shareFlashTimer);
  shareFlashTimer = setTimeout(() => {
    el.btnShare.textContent = orig;
    el.btnShare.classList.remove('flash-ok');
  }, 1500);
}

init();
