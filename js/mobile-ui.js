// Rotated-timeline renderer for mobile.
// Columns = venues (left to right), rows = time (top to bottom).
// Vertical scroll, touch-first interactions.
import { minutesToTimeString } from './data.js';

const VENUES = [
  'Coachella Stage',
  'Outdoor Theatre',
  'Mojave',
  'Gobi',
  'Sonora',
  'Yuma',
  'Sahara',
  'Quasar',
  'Dolab',
];

// Layout constants (SVG units).
const TOP_GUTTER = 24;         // space above the timeline for venue labels
const LEFT_GUTTER = 22;        // space left of the timeline for hour labels
const RIGHT_PADDING = 1;
const BOTTOM_PADDING = 8;
const PX_PER_MIN = 3;          // time density. 13 hours * 60 * 3 = 2340 px tall.
const BAR_HORIZONTAL_PADDING = 1;

// Tier cycle: none -> want -> must -> none
const TIER_CYCLE = { none: 'want', want: 'must', must: 'none' };
function nextTier(t) { return TIER_CYCLE[t] ?? 'want'; }

export function renderMobileTimeline(svg, acts, solveResult, picks, handlers) {
  const {
    onCycleTier,
    onSlideWindow,
    onResizeDeparture,
    onDragStart,
    onDragEnd,
  } = handlers;

  // Clear.
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Time extent. Match the desktop rule: 1 PM (= 0 min) through 1 AM (= 720 min).
  let minMin = 0;
  let maxMin = 720;
  for (const act of acts) {
    if (act.startMin < minMin) minMin = act.startMin;
    if (act.endMin > maxMin) maxMin = act.endMin;
  }
  const totalMin = maxMin - minMin;

  // Work out the drawing area. We build the viewBox to a fixed nominal width
  // so columns are positioned in svg units, then let CSS scale to actual
  // container width. The svg height is set so scrolling works naturally.
  const nominalWidth = 400;
  const columnAreaWidth = nominalWidth - LEFT_GUTTER - RIGHT_PADDING;
  const columnWidth = columnAreaWidth / VENUES.length;
  const height = TOP_GUTTER + totalMin * PX_PER_MIN + BOTTOM_PADDING;

  svg.setAttribute('viewBox', `0 0 ${nominalWidth} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
  // Height in CSS pixels: let the svg take the height it needs. The element
  // is styled width:100% in CSS; we explicitly set height to match aspect.
  svg.style.height = 'auto';

  // Diagonal-hatch pattern for dropped acts.
  const defs = svgEl('defs', {});
  const pattern = svgEl('pattern', {
    id: 'hatch-dropped',
    patternUnits: 'userSpaceOnUse',
    width: 6, height: 6,
    patternTransform: 'rotate(45)',
  });
  pattern.appendChild(svgEl('rect', { width: 6, height: 6, class: 'hatch-bg' }));
  pattern.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-line' }));
  defs.appendChild(pattern);
  svg.appendChild(defs);

  // Venue column headers (top).
  for (let i = 0; i < VENUES.length; i++) {
    const x = LEFT_GUTTER + i * columnWidth + columnWidth / 2;
    const label = svgEl('text', {
      x,
      y: TOP_GUTTER - 10,
      'text-anchor': 'middle',
      class: 'venue-label',
    });
    // Abbreviate long venue names so they fit.
    label.textContent = abbreviateVenue(VENUES[i]);
    svg.appendChild(label);
  }

  // Hour ticks + labels on the left side.
  const firstHour = Math.ceil(minMin / 60) * 60;
  for (let m = firstHour; m <= maxMin; m += 60) {
    const y = TOP_GUTTER + (m - minMin) * PX_PER_MIN;
    svg.appendChild(svgEl('line', {
      x1: LEFT_GUTTER,
      y1: y,
      x2: nominalWidth - RIGHT_PADDING,
      y2: y,
      class: 'tick-line',
    }));
    const label = svgEl('text', {
      x: LEFT_GUTTER - 4,
      y: y + 3,
      'text-anchor': 'end',
      class: 'hour-label',
    });
    label.textContent = shortTime(m);
    svg.appendChild(label);
  }

  // Vertical grid lines between columns.
  for (let i = 0; i <= VENUES.length; i++) {
    const x = LEFT_GUTTER + i * columnWidth;
    svg.appendChild(svgEl('line', {
      x1: x, y1: TOP_GUTTER,
      x2: x, y2: height - BOTTOM_PADDING,
      class: 'grid-line',
    }));
  }

  // --- Act bars ---

  const scheduledById = new Map();
  const droppedById = new Map();
  for (const s of solveResult.scheduled) scheduledById.set(s.id, s);
  for (const d of solveResult.dropped) droppedById.set(d.id, d);

  for (const act of acts) {
    const colIdx = VENUES.indexOf(act.venue);
    if (colIdx < 0) continue;

    const x = LEFT_GUTTER + colIdx * columnWidth + BAR_HORIZONTAL_PADDING;
    const w = columnWidth - BAR_HORIZONTAL_PADDING * 2;
    const y = TOP_GUTTER + (act.startMin - minMin) * PX_PER_MIN;
    const h = Math.max(12, (act.endMin - act.startMin) * PX_PER_MIN);

    let cls = 'act-bar';
    if (scheduledById.has(act.id)) cls += ' act-bar-scheduled';
    else if (droppedById.has(act.id)) cls += ' act-bar-dropped';

    const bar = svgEl('rect', {
      x, y, width: w, height: h,
      rx: 3, ry: 3,
      class: cls,
    });
    installTapHandler(svg, bar, () => {
      const tier = picks.get(act.id)?.tier ?? 'none';
      onCycleTier(act.id, nextTier(tier));
    });
    svg.appendChild(bar);

    // Horizontal label with dynamic sizing: shrink font size until the word-
    // wrapped text fits both the bar width and height. Breaks on spaces.
    if (h >= 14 && w >= 12) {
      const barState = scheduledById.has(act.id)
        ? 'scheduled'
        : droppedById.has(act.id)
          ? 'dropped'
          : 'unselected';
      const labelGroup = buildFittedLabel(act.name, w - 2, h - 4, barState);
      if (labelGroup) {
        labelGroup.setAttribute('transform', `translate(${x + 1},${y + 2})`);
        svg.appendChild(labelGroup);
      }
    }
  }

  // --- Walk arrows between scheduled acts ---
  for (const s of solveResult.scheduled) {
    if (!s.walkFromPrev) continue;
    const prev = solveResult.scheduled.find((p) => p.id === s.prevId);
    if (!prev) continue;
    const fromCol = VENUES.indexOf(prev.act.venue);
    const toCol = VENUES.indexOf(s.act.venue);
    if (fromCol < 0 || toCol < 0) continue;

    const x1 = LEFT_GUTTER + fromCol * columnWidth + columnWidth / 2;
    const y1 = TOP_GUTTER + (prev.departure - minMin) * PX_PER_MIN;
    const x2 = LEFT_GUTTER + toCol * columnWidth + columnWidth / 2;
    const y2 = TOP_GUTTER + (s.arrival - minMin) * PX_PER_MIN;

    svg.appendChild(svgEl('line', {
      x1, y1, x2, y2,
      class: 'walk-line',
    }));
  }

  // --- Watch-window overlays (draggable) ---
  for (const s of solveResult.scheduled) {
    const colIdx = VENUES.indexOf(s.act.venue);
    if (colIdx < 0) continue;

    const x = LEFT_GUTTER + colIdx * columnWidth + BAR_HORIZONTAL_PADDING;
    const w = columnWidth - BAR_HORIZONTAL_PADDING * 2;
    const y = TOP_GUTTER + (s.arrival - minMin) * PX_PER_MIN;
    const h = Math.max(6, (s.departure - s.arrival) * PX_PER_MIN);

    const watchCls = s.tier === 'must' ? 'watch-window watch-must' : 'watch-window watch-want';
    const watch = svgEl('rect', {
      x, y, width: w, height: h,
      rx: 2, ry: 2,
      class: watchCls,
    });
    svg.appendChild(watch);

    installVerticalDragHandler(svg, watch, s, minMin, {
      onSlide: onSlideWindow,
      onCycleOnTap: () => onCycleTier(s.id, nextTier(s.tier)),
      onDragStart,
      onDragEnd,
    });

    // Bottom-edge resize handle (drag to change departure). Sized generously
    // for finger targets.
    const handleH = 18;
    const handleY = y + h - handleH / 2;
    const handle = svgEl('rect', {
      x: x + 1,
      y: handleY,
      width: w - 2,
      height: handleH,
      rx: 3, ry: 3,
      class: 'drag-handle',
    });
    svg.appendChild(handle);

    installVerticalResizeHandler(svg, handle, s, minMin, {
      onResize: onResizeDeparture,
      onDragStart,
      onDragEnd,
    });
  }
}

// --- Touch/pointer helpers ---

const TAP_MOVE_THRESHOLD_SQ = 64; // 8 px
const TAP_MAX_MS = 500;

function buildMinutesConverter(svg, minMin) {
  const svgRect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const yScale = svgRect.height / viewBox.height;
  return function toMinutes(clientY) {
    const svgY = (clientY - svgRect.top) / yScale;
    return (svgY - TOP_GUTTER) / PX_PER_MIN + minMin;
  };
}

// Simple tap handler (non-draggable elements). Distinguishes tap from scroll.
function installTapHandler(svg, el, onTap) {
  el.addEventListener('pointerdown', (e) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = performance.now();
    let moved = false;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dx * dx + dy * dy > TAP_MOVE_THRESHOLD_SQ) moved = true;
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!moved && performance.now() - startTime < TAP_MAX_MS) {
        onTap();
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// Mark body as "dragging" so global CSS disables page scrolling for the
// duration of the gesture. This is what actually prevents iOS Safari from
// hijacking the vertical drag for page scroll.
function beginBodyDragLock() {
  document.body.classList.add('dragging');
}
function endBodyDragLock() {
  document.body.classList.remove('dragging');
}

// iOS Safari ignores preventDefault() in pointer handlers if the element's
// touch-action is ambiguous. Adding an explicit non-passive touchstart
// listener that preventDefaults is the reliable way to stop the browser from
// committing to a page scroll. We attach it alongside the pointerdown.
function attachNonPassiveTouch(el) {
  el.addEventListener(
    'touchstart',
    (e) => { e.preventDefault(); },
    { passive: false },
  );
  el.addEventListener(
    'touchmove',
    (e) => { e.preventDefault(); },
    { passive: false },
  );
}

// Watch-window middle: tap to cycle tier, vertical drag to slide.
function installVerticalDragHandler(svg, rect, scheduled, minMin, handlers) {
  attachNonPassiveTouch(rect);
  rect.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { rect.setPointerCapture(e.pointerId); } catch (err) {}
    beginBodyDragLock();
    handlers.onDragStart && handlers.onDragStart(scheduled.id);

    const toMinutes = buildMinutesConverter(svg, minMin);
    const startPointerMin = toMinutes(e.clientY);
    const startArrival = scheduled.arrival;
    const startDeparture = scheduled.departure;
    const duration = startDeparture - startArrival;
    const actStart = scheduled.act.startMin;
    const actEnd = scheduled.act.endMin;

    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = performance.now();
    let moved = false;

    function onMove(ev) {
      if (!moved) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (dx * dx + dy * dy < TAP_MOVE_THRESHOLD_SQ) return;
        moved = true;
      }
      const curMin = toMinutes(ev.clientY);
      const delta = curMin - startPointerMin;
      let newArrival = startArrival + delta;
      newArrival = Math.max(actStart, Math.min(actEnd - duration, newArrival));
      const newDeparture = newArrival + duration;
      handlers.onSlide(scheduled.id, newArrival, newDeparture);
    }
    function onUp() {
      try { rect.releasePointerCapture(e.pointerId); } catch (err) {}
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      endBodyDragLock();
      handlers.onDragEnd && handlers.onDragEnd();
      if (!moved && performance.now() - startTime < TAP_MAX_MS) {
        handlers.onCycleOnTap();
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function installVerticalResizeHandler(svg, handle, scheduled, minMin, handlers) {
  attachNonPassiveTouch(handle);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    beginBodyDragLock();
    handlers.onDragStart && handlers.onDragStart(scheduled.id);

    const toMinutes = buildMinutesConverter(svg, minMin);

    function onMove(ev) {
      const minutes = toMinutes(ev.clientY);
      const clamped = Math.max(
        scheduled.arrival + 1,
        Math.min(scheduled.act.endMin, minutes),
      );
      handlers.onResize(scheduled.id, clamped);
    }
    function onUp() {
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      endBodyDragLock();
      handlers.onDragEnd && handlers.onDragEnd();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// --- Issues panel (same shape as desktop but styled smaller) ---

export function renderIssues(container, solveResult) {
  container.innerHTML = '';

  if (solveResult.errors.length) {
    const errBox = document.createElement('div');
    errBox.className = 'issues-errors';
    errBox.innerHTML = '<h3>Conflicts</h3>';
    const ul = document.createElement('ul');
    for (const err of solveResult.errors) {
      const li = document.createElement('li');
      li.textContent = err;
      ul.appendChild(li);
    }
    errBox.appendChild(ul);
    container.appendChild(errBox);
  }

  if (solveResult.scheduled.length) {
    const listBox = document.createElement('div');
    listBox.className = 'issues-schedule';
    listBox.innerHTML = '<h3>Schedule</h3>';
    const ol = document.createElement('ol');
    for (const s of solveResult.scheduled) {
      const li = document.createElement('li');
      const watchMin = Math.round(s.departure - s.arrival);
      const walkInfo = s.walkFromPrev
        ? ` <span class="muted">(walk ${Math.round(s.walkFromPrev.totalMin)} min from ${escapeHtml(s.walkFromPrev.fromVenue)})</span>`
        : '';
      li.innerHTML =
        `<strong>${escapeHtml(s.act.name)}</strong> @ ${escapeHtml(s.act.venue)} — ` +
        `${minutesToTimeString(s.arrival)}–${minutesToTimeString(s.departure)} ` +
        `(${watchMin} min)${walkInfo}`;
      ol.appendChild(li);
    }
    listBox.appendChild(ol);
    container.appendChild(listBox);
  }

  if (solveResult.dropped.length) {
    const dropBox = document.createElement('div');
    dropBox.className = 'issues-dropped';
    dropBox.innerHTML = '<h3>Dropped</h3>';
    const ul = document.createElement('ul');
    for (const d of solveResult.dropped) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${escapeHtml(d.act.name)}</strong> (${escapeHtml(d.act.venue)}) — ${escapeHtml(d.reason)}`;
      ul.appendChild(li);
    }
    dropBox.appendChild(ul);
    container.appendChild(dropBox);
  }
}

// --- Helpers ---

// Build a <g> containing word-wrapped <tspan> lines that fit inside the given
// box. Shrinks the font size to fit. Returns null if nothing readable fits.
//
// Uses a rough 0.55 × font-size character-width estimate — plenty accurate for
// sans-serif at small sizes, and avoids the cost of real text measurement.
function buildFittedLabel(text, maxW, maxH, barState = 'unselected') {
  if (maxW < 8 || maxH < 8) return null;

  const MIN_SIZE = 8;
  const MAX_SIZE = 13;
  const LINE_HEIGHT = 1.15;
  const CHAR_W_RATIO = 0.55;

  const bgClass = barState === 'scheduled'
    ? 'act-bar-label-bg act-bar-label-bg-scheduled'
    : barState === 'dropped'
      ? 'act-bar-label-bg act-bar-label-bg-dropped'
      : 'act-bar-label-bg';

  // Try font sizes from large to small until the layout fits.
  for (let size = MAX_SIZE; size >= MIN_SIZE; size--) {
    const charW = size * CHAR_W_RATIO;
    const maxCharsPerLine = Math.max(1, Math.floor(maxW / charW));
    const lines = wrapWords(text, maxCharsPerLine);
    if (!lines) continue;
    const totalH = lines.length * size * LINE_HEIGHT;
    if (totalH > maxH) continue;

    // It fits. Build the group. Using dominant-baseline:hanging (set in CSS)
    // so y is the top of each text line.
    const g = svgEl('g', { class: 'act-bar-label' });
    // Backing rect so the label stays readable over the hatch on dropped bars.
    const widestLineChars = Math.max(...lines.map((l) => l.length));
    const bgW = Math.ceil(widestLineChars * charW) + 4;
    const bgH = Math.ceil(lines.length * size * LINE_HEIGHT) + 2;
    g.appendChild(svgEl('rect', {
      x: -2,
      y: -1,
      width: bgW,
      height: bgH,
      rx: 2,
      ry: 2,
      class: bgClass,
    }));
    for (let i = 0; i < lines.length; i++) {
      const t = svgEl('text', {
        x: 0,
        y: Math.round(i * size * LINE_HEIGHT),
        'font-size': size,
      });
      t.textContent = lines[i];
      g.appendChild(t);
    }
    return g;
  }

  // Even at the minimum size nothing fit cleanly. Last-ditch: truncate to a
  // single line at min size.
  const charW = MIN_SIZE * CHAR_W_RATIO;
  const maxChars = Math.max(1, Math.floor(maxW / charW));
  if (maxChars < 2) return null;
  const g = svgEl('g', { class: 'act-bar-label' });
  const truncated = truncate(text, maxChars);
  const bgW = Math.ceil(truncated.length * charW) + 4;
  const bgH = Math.ceil(MIN_SIZE * LINE_HEIGHT) + 2;
  g.appendChild(svgEl('rect', {
    x: -2,
    y: -1,
    width: bgW,
    height: bgH,
    rx: 2,
    ry: 2,
    class: 'act-bar-label-bg',
  }));
  const t = svgEl('text', {
    x: 0,
    y: 0,
    'font-size': MIN_SIZE,
  });
  t.textContent = truncated;
  g.appendChild(t);
  return g;
}

// Greedy word wrap. Returns an array of lines, or null if a single word can't
// fit on a line (caller should try a smaller font size or truncate).
function wrapWords(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    if (word.length > maxChars) {
      // A single word is too long for this font size — caller will retry
      // smaller, unless we're already at the minimum and have to truncate.
      return null;
    }
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= maxChars) {
      cur += ' ' + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function abbreviateVenue(v) {
  const short = {
    'Coachella Stage': 'Coach',
    'Outdoor Theatre': 'Outdoor',
    'Mojave': 'Mojave',
    'Gobi': 'Gobi',
    'Sonora': 'Sonora',
    'Yuma': 'Yuma',
    'Sahara': 'Sahara',
    'Quasar': 'Quasar',
    'Dolab': 'Dolab',
  };
  return short[v] ?? v;
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// Short time label for the left gutter: "3p", "12a", etc.
function shortTime(mins) {
  const DAY_START = 13;
  const total = Math.round(mins);
  let h = DAY_START + Math.floor(total / 60);
  h = ((h % 24) + 24) % 24;
  const ampm = h >= 12 ? 'p' : 'a';
  let dh = h % 12;
  if (dh === 0) dh = 12;
  return `${dh}${ampm}`;
}
