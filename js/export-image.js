// Export the computed schedule as a portrait PNG and open it in a new tab.
// The image is optimized for offline glance-use at the festival: large type,
// white background for daylight readability, clear must-see highlighting.
//
// Layout: every row is either a "watch" or a "walk", each with a timestamp
// that is the moment you act on (when to start watching, when to start
// walking). Watch rows show name + venue + your watch window + the official
// set time. Walk rows show walk duration and destination, with warning
// styling for long walks.
import { minutesToTimeString } from './data.js';

const DAY_LABELS = {
  w1_fri: 'Weekend 1 · Friday',
  w1_sat: 'Weekend 1 · Saturday',
  w1_sun: 'Weekend 1 · Sunday',
  w2_fri: 'Weekend 2 · Friday',
  w2_sat: 'Weekend 2 · Saturday',
  w2_sun: 'Weekend 2 · Sunday',
};

const SPEED_LABELS = {
  lot8: 'Lot 8 Crawler pace',
  slow: 'Slow pace',
  normal: 'Normal pace',
  fast: 'Fast pace',
};

// Layout constants — all in device pixels. Width is fixed so the design is
// predictable across screens; height grows to fit the content.
const WIDTH = 1080;
const MARGIN_X = 60;
const MARGIN_TOP = 80;
const MARGIN_BOTTOM = 100;

const TITLE_SIZE = 72;
const SUBTITLE_SIZE = 40;
const TIME_SIZE = 40;
const NAME_SIZE = 50;
const META_SIZE = 30;
const OFFICIAL_SIZE = 26;
const WALK_SIZE = 32;
const FOOTER_SIZE = 28;

const ROW_V_PADDING = 20;      // vertical padding inside a row
const ROW_SEPARATOR_GAP = 14;  // gap between rows
const SECTION_GAP = 48;
const LINE_HEIGHT = 1.1;
const META_GAP = 10;           // gap between name and meta lines
const OFFICIAL_GAP = 6;        // gap between meta and official-time line

const TIME_COL_WIDTH = 210;
const BULLET_RADIUS = 11;
const BULLET_GUTTER = 28;      // space between bullet and time

// Colors — fixed light palette regardless of app theme.
const COLOR = {
  bg: '#ffffff',
  divider: '#dcdcdc',
  rowDivider: '#eeeeee',
  title: '#111111',
  subtitle: '#555555',
  time: '#111111',
  name: '#111111',
  meta: '#666666',
  official: '#8a8a8a',
  late: '#c14e1a',
  walk: '#8a6600',
  walkLong: '#c14e1a',
  walkBg: '#fff8e8',
  walkLongBg: '#fde8e0',
  must: '#c1391a',
  want: '#0b66c2',
  footer: '#888888',
};

// Long-walk threshold in minutes — rows longer than this get warning styling.
const LONG_WALK_MIN = 8;

/**
 * Build the image and open it in a new tab.
 *   opts: { dayKey, speed, paddingMin, scheduled }
 */
export function exportScheduleImage(opts) {
  const dataUrl = renderImage(opts);
  openImageInNewTab(dataUrl, opts.dayKey);
}

// --- Event list ---
//
// Build a flat list of events (watch + walk rows) from the solver output.
// Each event has { type, time, ... } and knows its own layout needs.
function buildEvents(scheduled) {
  const events = [];

  for (let i = 0; i < scheduled.length; i++) {
    const s = scheduled[i];
    const watchDur = Math.round(s.departure - s.arrival);
    const officialStart = s.act.startMin;
    const officialEnd = s.act.endMin;
    const officialDur = Math.round(officialEnd - officialStart);

    // Arrive late if you missed more than 1 min of the start.
    const arrivedLate = s.arrival > officialStart + 1;
    const lateMin = Math.round(s.arrival - officialStart);
    // Leave early if you cut more than 1 min of the end.
    const leftEarly = s.departure < officialEnd - 1;
    const earlyMin = Math.round(officialEnd - s.departure);

    events.push({
      type: 'watch',
      time: s.arrival,
      timeLabel: minutesToTimeString(s.arrival),
      name: s.act.name,
      venue: s.act.venue,
      tier: s.tier,
      watchDur,
      officialStart,
      officialEnd,
      officialDur,
      officialLabel:
        `Set: ${minutesToTimeString(officialStart)}–${minutesToTimeString(officialEnd)} (${officialDur} min)`,
      arrivedLate,
      lateMin,
      leftEarly,
      earlyMin,
      leaveAt: s.departure,
    });

    // Walk to the NEXT act, if any. Its walkFromPrev encodes the edge.
    const next = scheduled[i + 1];
    if (next && next.walkFromPrev) {
      const walkMin = Math.round(next.walkFromPrev.totalMin);
      if (walkMin > 0) {
        events.push({
          type: 'walk',
          // The time you start walking = when you leave the current act.
          time: s.departure,
          timeLabel: minutesToTimeString(s.departure),
          minutes: walkMin,
          fromVenue: next.walkFromPrev.fromVenue,
          toVenue: next.walkFromPrev.toVenue,
          isLong: walkMin > LONG_WALK_MIN,
        });
      }
    }
  }
  return events;
}

function renderImage({ dayKey, speed, paddingMin, scheduled }) {
  const events = buildEvents(scheduled);

  // Measure first so we can size the canvas.
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d');
  const measured = measureLayout(sctx, events);
  const height = measured.totalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Background.
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, WIDTH, height);

  // Header.
  let y = MARGIN_TOP;
  ctx.fillStyle = COLOR.title;
  ctx.font = weightFont(800, TITLE_SIZE);
  ctx.textBaseline = 'top';
  ctx.fillText('COACHELLA', MARGIN_X, y);
  y += TITLE_SIZE + 8;

  ctx.fillStyle = COLOR.subtitle;
  ctx.font = weightFont(500, SUBTITLE_SIZE);
  ctx.fillText(DAY_LABELS[dayKey] ?? dayKey, MARGIN_X, y);
  y += SUBTITLE_SIZE + 32;

  // Top divider.
  ctx.strokeStyle = COLOR.divider;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, y);
  ctx.lineTo(WIDTH - MARGIN_X, y);
  ctx.stroke();
  y += SECTION_GAP;

  // Events.
  if (events.length === 0) {
    ctx.fillStyle = COLOR.meta;
    ctx.font = weightFont(500, NAME_SIZE);
    ctx.fillText('No acts selected.', MARGIN_X, y);
    y += NAME_SIZE + SECTION_GAP;
  } else {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const m = measured.eventMeasurements[i];
      if (ev.type === 'watch') {
        y = drawWatchRow(ctx, ev, y, m);
      } else {
        y = drawWalkRow(ctx, ev, y, m);
      }
      if (i < events.length - 1) y += ROW_SEPARATOR_GAP;
    }
  }

  // Footer.
  y += SECTION_GAP;
  ctx.strokeStyle = COLOR.divider;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, y);
  ctx.lineTo(WIDTH - MARGIN_X, y);
  ctx.stroke();
  y += 28;

  ctx.fillStyle = COLOR.footer;
  ctx.font = weightFont(500, FOOTER_SIZE);
  const watchCount = events.filter((e) => e.type === 'watch').length;
  const mustCount = events.filter((e) => e.type === 'watch' && e.tier === 'must').length;
  const mustPart = mustCount ? ` · ${mustCount} must-see` : '';
  const footerText = `${SPEED_LABELS[speed] ?? speed} · +${paddingMin} min walk padding · ${watchCount} act${watchCount === 1 ? '' : 's'}${mustPart}`;
  ctx.fillText(footerText, MARGIN_X, y);

  return canvas.toDataURL('image/png');
}

// --- Measurement ---

function measureLayout(ctx, events) {
  const eventMeasurements = [];
  let y = MARGIN_TOP;
  y += TITLE_SIZE + 8;
  y += SUBTITLE_SIZE + 32;
  y += SECTION_GAP;

  if (events.length === 0) {
    y += NAME_SIZE + SECTION_GAP;
  } else {
    const nameMaxWidth = WIDTH - MARGIN_X - MARGIN_X - TIME_COL_WIDTH - BULLET_GUTTER;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'watch') {
        ctx.font = weightFont(ev.tier === 'must' ? 800 : 700, NAME_SIZE);
        const nameLines = wrapText(ctx, ev.name, nameMaxWidth);
        const nameBlock = nameLines.length * NAME_SIZE * LINE_HEIGHT;
        const metaBlock = META_GAP + META_SIZE * LINE_HEIGHT;
        const officialBlock = OFFICIAL_GAP + OFFICIAL_SIZE * LINE_HEIGHT;
        const innerH = nameBlock + metaBlock + officialBlock;
        const rowH = ROW_V_PADDING * 2 + innerH;
        eventMeasurements.push({ type: 'watch', nameLines, height: rowH });
        y += rowH;
      } else {
        // Walk row.
        const innerH = WALK_SIZE * LINE_HEIGHT;
        const rowH = ROW_V_PADDING * 1.2 + innerH;
        eventMeasurements.push({ type: 'walk', height: rowH });
        y += rowH;
      }
      if (i < events.length - 1) y += ROW_SEPARATOR_GAP;
    }
  }

  y += SECTION_GAP;
  y += FOOTER_SIZE;
  y += MARGIN_BOTTOM;
  return { totalHeight: Math.ceil(y), eventMeasurements };
}

// --- Row drawing ---

function drawWatchRow(ctx, ev, yStart, m) {
  const yTop = yStart;
  let y = yTop + ROW_V_PADDING;

  // Bullet in left margin.
  const bulletX = MARGIN_X + BULLET_RADIUS;
  const bulletY = y + NAME_SIZE * 0.55;
  ctx.fillStyle = ev.tier === 'must' ? COLOR.must : COLOR.want;
  ctx.beginPath();
  ctx.arc(bulletX, bulletY, BULLET_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Time column.
  const timeX = MARGIN_X + BULLET_GUTTER;
  ctx.fillStyle = COLOR.time;
  ctx.font = weightFont(600, TIME_SIZE);
  ctx.textBaseline = 'top';
  ctx.fillText(ev.timeLabel, timeX, y + (NAME_SIZE - TIME_SIZE) / 2);

  // Name column.
  const nameX = MARGIN_X + BULLET_GUTTER + TIME_COL_WIDTH;
  ctx.fillStyle = COLOR.name;
  ctx.font = weightFont(ev.tier === 'must' ? 800 : 700, NAME_SIZE);
  for (const line of m.nameLines) {
    ctx.fillText(line, nameX, y);
    y += NAME_SIZE * LINE_HEIGHT;
  }

  // Meta line: venue · watch duration · MUST-SEE tag.
  y += META_GAP;
  ctx.fillStyle = COLOR.meta;
  ctx.font = weightFont(500, META_SIZE);
  const metaParts = [ev.venue, `watch ${ev.watchDur} min`];
  if (ev.tier === 'must') metaParts.push('MUST-SEE');
  ctx.fillText(metaParts.join(' · '), nameX, y);
  y += META_SIZE * LINE_HEIGHT;

  // Official set time + late/early hints.
  y += OFFICIAL_GAP;
  ctx.font = weightFont(500, OFFICIAL_SIZE);
  let officialText = ev.officialLabel;
  const flags = [];
  if (ev.arrivedLate) flags.push(`arrive ${ev.lateMin} min late`);
  if (ev.leftEarly) flags.push(`leave ${ev.earlyMin} min early`);
  if (flags.length) {
    officialText += ' · ' + flags.join(', ');
    ctx.fillStyle = COLOR.late;
  } else {
    ctx.fillStyle = COLOR.official;
  }
  ctx.fillText(officialText, nameX, y);

  return yTop + m.height;
}

function drawWalkRow(ctx, ev, yStart, m) {
  const yTop = yStart;
  const rowH = m.height;

  // Light background band so the walk stands apart from watch rows.
  ctx.fillStyle = ev.isLong ? COLOR.walkLongBg : COLOR.walkBg;
  roundRect(ctx, MARGIN_X, yTop, WIDTH - MARGIN_X * 2, rowH, 8);
  ctx.fill();

  let y = yTop + ROW_V_PADDING * 0.6;

  // Time column.
  ctx.fillStyle = COLOR.time;
  ctx.font = weightFont(600, TIME_SIZE);
  ctx.textBaseline = 'top';
  ctx.fillText(ev.timeLabel, MARGIN_X + BULLET_GUTTER, y + (WALK_SIZE - TIME_SIZE) / 2);

  // Walk label.
  ctx.fillStyle = ev.isLong ? COLOR.walkLong : COLOR.walk;
  ctx.font = weightFont(700, WALK_SIZE);
  const icon = ev.isLong ? '⚠ ' : '↓ ';
  const tail = ev.isLong ? ` (${ev.minutes} min walk — long)` : ` (${ev.minutes} min walk)`;
  const label = `${icon}head to ${ev.toVenue}${tail}`;
  ctx.fillText(label, MARGIN_X + BULLET_GUTTER + TIME_COL_WIDTH, y);

  return yTop + rowH;
}

// --- Canvas helpers ---

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function weightFont(weight, size) {
  return `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

// Canvas word-wrap. Breaks on whitespace.
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const attempt = cur ? cur + ' ' + word : word;
    if (ctx.measureText(attempt).width <= maxWidth) {
      cur = attempt;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// --- New-tab presentation ---

function openImageInNewTab(dataUrl, dayKey) {
  const win = window.open('', '_blank');
  if (!win) {
    window.location.href = dataUrl;
    return;
  }
  const title = `Coachella Schedule — ${DAY_LABELS[dayKey] ?? dayKey}`;
  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: #222;
    color: #ddd;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .wrap {
    max-width: 600px;
    margin: 0 auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .hint {
    font-size: 13px;
    color: #aaa;
    text-align: center;
    line-height: 1.4;
  }
  img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .download {
    display: inline-block;
    padding: 10px 18px;
    background: #4aa3ff;
    color: #fff;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 14px;
  }
</style>
</head>
<body>
  <div class="wrap">
    <p class="hint">Long-press the image (mobile) or right-click → Save image as… (desktop) to save for offline use.</p>
    <img src="${dataUrl}" alt="${escapeHtml(title)}">
    <a class="download" href="${dataUrl}" download="coachella-${dayKey}.png">Download image</a>
  </div>
</body>
</html>`);
  win.document.close();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
