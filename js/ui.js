// UI rendering: acts list, SVG timeline with draggable watch windows, issues.
import { minutesToTimeString } from './data.js';

// --- Custom tooltip (instant, no native-title delay) ---

let tooltipEl = null;
function getTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'custom-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function attachTooltip(el, getContent) {
  el.addEventListener('pointerenter', (e) => {
    const tt = getTooltip();
    tt.innerHTML = getContent();
    tt.style.display = 'block';
    positionTooltip(tt, e);
  });
  el.addEventListener('pointermove', (e) => {
    if (tooltipEl && tooltipEl.style.display === 'block') {
      positionTooltip(tooltipEl, e);
    }
  });
  el.addEventListener('pointerleave', () => {
    if (tooltipEl) tooltipEl.style.display = 'none';
  });
}

function positionTooltip(tt, e) {
  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const rect = tt.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 8) {
    x = e.clientX - rect.width - pad;
  }
  if (y + rect.height > window.innerHeight - 8) {
    y = e.clientY - rect.height - pad;
  }
  tt.style.left = `${x}px`;
  tt.style.top = `${y}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

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

// Timeline layout constants
const ROW_HEIGHT = 44;
const ROW_PADDING = 6;
const LEFT_GUTTER = 130;
const TOP_GUTTER = 30;
const PX_PER_MIN = 4;

// Tier cycling: none -> want -> must -> none
const TIER_CYCLE = { none: 'want', want: 'must', must: 'none' };

export function renderActsList(container, acts, picks, onCycle) {
  container.innerHTML = '';

  // Group by venue for readability.
  const byVenue = new Map();
  for (const v of VENUES) byVenue.set(v, []);
  for (const act of acts) {
    if (!byVenue.has(act.venue)) byVenue.set(act.venue, []);
    byVenue.get(act.venue).push(act);
  }

  for (const [venue, venueActs] of byVenue) {
    if (venueActs.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'venue-group';
    const header = document.createElement('h3');
    header.textContent = venue;
    group.appendChild(header);

    for (const act of venueActs) {
      const tier = picks.get(act.id)?.tier ?? 'none';
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `act-row tier-${tier}`;
      row.innerHTML = `
        <span class="act-name">${escapeHtml(act.name)}</span>
        <span class="act-time">${escapeHtml(act.displayTime)}</span>
      `;
      row.addEventListener('click', () => {
        const next = TIER_CYCLE[tier];
        onCycle(act.id, next);
      });
      group.appendChild(row);
    }
    container.appendChild(group);
  }
}

export function renderTimeline(svg, acts, solveResult, picks, handlers) {
  const {
    onDragDeparture,
    onSlideWindow,
    onDragStart,
    onDragEnd,
    onCycleTier,
  } = handlers;
  // Clear.
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  hideTooltip();

  // Time extent: 14:00 (= 0 min) to 01:00 (= 660 min), but also extend to
  // cover every act in the input and every scheduled entry.
  let minMin = 0;
  let maxMin = 660;
  for (const act of acts) {
    if (act.startMin < minMin) minMin = act.startMin;
    if (act.endMin > maxMin) maxMin = act.endMin;
  }

  const totalMin = maxMin - minMin;
  const width = LEFT_GUTTER + totalMin * PX_PER_MIN + 20;
  const height = TOP_GUTTER + VENUES.length * ROW_HEIGHT + 20;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  // Diagonal-hatch pattern for dropped acts, so they visually read as
  // "unavailable" without competing with the must-see red color.
  const defs = svgEl('defs', {});
  const pattern = svgEl('pattern', {
    id: 'hatch-dropped',
    patternUnits: 'userSpaceOnUse',
    width: 6,
    height: 6,
    patternTransform: 'rotate(45)',
  });
  pattern.appendChild(svgEl('rect', { width: 6, height: 6, class: 'hatch-bg' }));
  pattern.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-line' }));
  defs.appendChild(pattern);
  svg.appendChild(defs);

  // Venue row labels + horizontal grid lines.
  for (let i = 0; i < VENUES.length; i++) {
    const y = TOP_GUTTER + i * ROW_HEIGHT;
    const label = svgEl('text', {
      x: LEFT_GUTTER - 8,
      y: y + ROW_HEIGHT / 2 + 4,
      'text-anchor': 'end',
      class: 'venue-label',
    });
    label.textContent = VENUES[i];
    svg.appendChild(label);

    svg.appendChild(svgEl('line', {
      x1: LEFT_GUTTER,
      y1: y + ROW_HEIGHT - ROW_PADDING / 2,
      x2: width - 10,
      y2: y + ROW_HEIGHT - ROW_PADDING / 2,
      class: 'grid-line',
    }));
  }

  // Hour ticks.
  const firstHour = Math.ceil(minMin / 60) * 60;
  for (let m = firstHour; m <= maxMin; m += 60) {
    const x = LEFT_GUTTER + (m - minMin) * PX_PER_MIN;
    svg.appendChild(svgEl('line', {
      x1: x,
      y1: TOP_GUTTER - 5,
      x2: x,
      y2: height - 10,
      class: 'tick-line',
    }));
    const label = svgEl('text', {
      x,
      y: TOP_GUTTER - 10,
      'text-anchor': 'middle',
      class: 'hour-label',
    });
    label.textContent = minutesToTimeString(m);
    svg.appendChild(label);
  }

  // All acts as faint background bars.
  const scheduledById = new Map();
  const droppedById = new Map();
  for (const s of solveResult.scheduled) scheduledById.set(s.id, s);
  for (const d of solveResult.dropped) droppedById.set(d.id, d);

  for (const act of acts) {
    const rowIdx = VENUES.indexOf(act.venue);
    if (rowIdx < 0) continue;
    const y = TOP_GUTTER + rowIdx * ROW_HEIGHT + ROW_PADDING;
    const x = LEFT_GUTTER + (act.startMin - minMin) * PX_PER_MIN;
    const w = Math.max(2, (act.endMin - act.startMin) * PX_PER_MIN);
    const barHeight = ROW_HEIGHT - ROW_PADDING * 2;

    const tier = picks.get(act.id)?.tier ?? 'none';
    let cls = 'act-bar clickable';
    if (scheduledById.has(act.id)) cls += ' act-bar-scheduled';
    else if (droppedById.has(act.id)) cls += ' act-bar-dropped';

    const bar = svgEl('rect', {
      x, y, width: w, height: barHeight,
      rx: 4, ry: 4,
      class: cls,
    });
    attachTooltip(bar, () => {
      const status = scheduledById.has(act.id)
        ? '<span class="tt-ok">Scheduled</span>'
        : droppedById.has(act.id)
          ? `<span class="tt-drop">Dropped</span><br>${escapeHtml(droppedById.get(act.id).reason)}`
          : tier === 'none'
            ? '<span class="tt-muted">Not selected</span>'
            : `<span class="tt-muted">Selected (${tier})</span>`;
      return `<strong>${escapeHtml(act.name)}</strong><br>` +
        `${escapeHtml(act.venue)} · ${escapeHtml(act.displayTime)}<br>` +
        status +
        '<br><span class="tt-muted">Click to cycle selection</span>';
    });
    installClickHandler(bar, () => onCycleTier(act.id, nextTier(tier)));
    svg.appendChild(bar);

    // Label over the bar if there's room. A solid backing rect behind the
    // text matches whichever bar type it's on (so it looks invisible on flat
    // bars and cuts through the hatch on dropped bars).
    if (w > 40) {
      const labelText = act.name.length * 7 < w
        ? act.name
        : act.name.slice(0, Math.floor(w / 7)) + '…';
      const textY = y + barHeight / 2 + 4;
      const textX = x + 4;
      const estimatedTextWidth = Math.min(w - 8, labelText.length * 6 + 4);

      let bgClass = 'act-bar-label-bg';
      if (scheduledById.has(act.id)) bgClass += ' act-bar-label-bg-scheduled';
      else if (droppedById.has(act.id)) bgClass += ' act-bar-label-bg-dropped';

      svg.appendChild(svgEl('rect', {
        x: textX - 2,
        y: textY - 10,
        width: estimatedTextWidth,
        height: 13,
        rx: 2,
        ry: 2,
        class: bgClass,
      }));

      const text = svgEl('text', {
        x: textX,
        y: textY,
        class: 'act-bar-label',
      });
      text.textContent = labelText;
      svg.appendChild(text);
    }
  }

  // Walk-path arrows between scheduled acts.
  for (const s of solveResult.scheduled) {
    if (!s.walkFromPrev) continue;
    const prev = solveResult.scheduled.find((x) => x.id === s.prevId);
    if (!prev) continue;
    const fromRow = VENUES.indexOf(prev.act.venue);
    const toRow = VENUES.indexOf(s.act.venue);
    if (fromRow < 0 || toRow < 0) continue;

    const x1 = LEFT_GUTTER + (prev.departure - minMin) * PX_PER_MIN;
    const y1 = TOP_GUTTER + fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
    const x2 = LEFT_GUTTER + (s.arrival - minMin) * PX_PER_MIN;
    const y2 = TOP_GUTTER + toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

    svg.appendChild(svgEl('line', {
      x1, y1, x2, y2,
      class: 'walk-line',
    }));
  }

  // Watch-window overlays on scheduled acts.
  // Middle of the bar = slide (fixed duration). Right edge handle = resize.
  for (const s of solveResult.scheduled) {
    const rowIdx = VENUES.indexOf(s.act.venue);
    if (rowIdx < 0) continue;
    const y = TOP_GUTTER + rowIdx * ROW_HEIGHT + ROW_PADDING;
    const x = LEFT_GUTTER + (s.arrival - minMin) * PX_PER_MIN;
    const w = Math.max(2, (s.departure - s.arrival) * PX_PER_MIN);
    const barHeight = ROW_HEIGHT - ROW_PADDING * 2;

    const watchCls = s.tier === 'must' ? 'watch-window watch-must' : 'watch-window watch-want';
    const watch = svgEl('rect', {
      x, y, width: w, height: barHeight,
      rx: 3, ry: 3,
      class: watchCls,
    });
    svg.appendChild(watch);

    attachTooltip(watch, () => {
      const watchMin = s.departure - s.arrival;
      const totalMin = s.act.endMin - s.act.startMin;
      return `<strong>${escapeHtml(s.act.name)}</strong><br>` +
        `${escapeHtml(s.act.venue)} · set ${escapeHtml(s.act.displayTime)}<br>` +
        `Watching ${minutesToTimeString(s.arrival)} – ${minutesToTimeString(s.departure)} ` +
        `<span class="tt-muted">(${Math.round(watchMin)} of ${Math.round(totalMin)} min)</span><br>` +
        `<span class="tt-muted">Drag middle to slide · drag right edge to resize</span>`;
    });

    // Slide handler on the main rect. Also handles click-to-cycle-tier when
    // the pointer barely moved.
    installSlideHandler(svg, watch, s, minMin, onSlideWindow, onDragStart, onDragEnd, () => onCycleTier(s.id, nextTier(s.tier)));

    // Resize handle on the right edge.
    const handleX = x + w - 3;
    const handle = svgEl('rect', {
      x: handleX,
      y,
      width: 6,
      height: barHeight,
      class: 'drag-handle',
    });
    handle.dataset.actId = s.id;
    svg.appendChild(handle);

    installResizeHandler(svg, handle, s, minMin, onDragDeparture, onDragStart, onDragEnd);
  }
}

function installResizeHandler(svg, handle, scheduled, minMin, onDragDeparture, onDragStart, onDragEnd) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    hideTooltip();
    onDragStart && onDragStart(scheduled.id);

    const toMinutes = buildMinutesConverter(svg, minMin);

    function onMove(ev) {
      const minutes = toMinutes(ev.clientX);
      const clamped = Math.max(
        scheduled.arrival + 1,
        Math.min(scheduled.act.endMin, minutes),
      );
      onDragDeparture(scheduled.id, clamped);
    }

    function onUp() {
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onDragEnd && onDragEnd();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function installSlideHandler(svg, rect, scheduled, minMin, onSlideWindow, onDragStart, onDragEnd, onClick) {
  rect.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    rect.setPointerCapture(e.pointerId);
    hideTooltip();
    onDragStart && onDragStart(scheduled.id);

    const toMinutes = buildMinutesConverter(svg, minMin);
    const startPointerMin = toMinutes(e.clientX);
    const startArrival = scheduled.arrival;
    const startDeparture = scheduled.departure;
    const duration = startDeparture - startArrival;
    const actStart = scheduled.act.startMin;
    const actEnd = scheduled.act.endMin;

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startTime = performance.now();
    let moved = false;

    rect.classList.add('sliding');

    function onMove(ev) {
      if (!moved) {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        if (dx * dx + dy * dy < CLICK_MOVE_THRESHOLD_SQ) return;
        moved = true;
      }
      const curPointerMin = toMinutes(ev.clientX);
      const deltaMin = curPointerMin - startPointerMin;
      let newArrival = startArrival + deltaMin;
      // Clamp so the window stays inside the scheduled act bounds.
      newArrival = Math.max(actStart, Math.min(actEnd - duration, newArrival));
      const newDeparture = newArrival + duration;
      onSlideWindow(scheduled.id, newArrival, newDeparture);
    }

    function onUp() {
      try { rect.releasePointerCapture(e.pointerId); } catch (err) {}
      rect.classList.remove('sliding');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onDragEnd && onDragEnd();
      // Treat as click if the pointer barely moved and it was quick.
      if (!moved && performance.now() - startTime < CLICK_MAX_MS && onClick) {
        onClick();
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// Simple click handler for elements that aren't draggable (background bars).
function installClickHandler(el, onClick) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = performance.now();

    function onUp(ev) {
      window.removeEventListener('pointerup', onUp);
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dx * dx + dy * dy < CLICK_MOVE_THRESHOLD_SQ &&
          performance.now() - startTime < CLICK_MAX_MS) {
        onClick();
      }
    }
    window.addEventListener('pointerup', onUp);
  });
}

const CLICK_MOVE_THRESHOLD_SQ = 25; // 5 px
const CLICK_MAX_MS = 400;

const TIMELINE_TIER_CYCLE = { none: 'want', want: 'must', must: 'none' };
function nextTier(current) {
  return TIMELINE_TIER_CYCLE[current] ?? 'want';
}

function buildMinutesConverter(svg, minMin) {
  const svgRect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const scale = svgRect.width / viewBox.width;
  return function toMinutes(clientX) {
    const svgX = (clientX - svgRect.left) / scale;
    return (svgX - LEFT_GUTTER) / PX_PER_MIN + minMin;
  };
}

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
    dropBox.innerHTML = '<h3>Dropped Acts</h3>';
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

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
