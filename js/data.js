// Data loading + parsing for acts and walk matrix.

const SPEED_COLUMNS = {
  slow: 'Slow Walker 0.8 m/s',
  normal: 'Normal Walker 1.2 m/s',
  fast: 'Fast Walker 1.5 m/s',
};

// Speeds that don't have their own CSV column are computed from the Meter
// column as meters / (m/s). lot8 is the festival-shuffle "crawler" speed.
const COMPUTED_SPEEDS = {
  lot8: 0.1, // m/s — Lot 8 Crawler
};

// Parse a CSV line honoring simple double-quoted fields (one field has "1,028.43").
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i];
    });
    return row;
  });
}

// Returns { venues: Set, walkSeconds(a, b, speed) -> number }
export async function loadVenues() {
  const res = await fetch('data/venues.csv');
  const text = await res.text();
  const rows = parseCsv(text);

  // Map: "A||B" -> { slow, normal, fast, lot8 } in seconds
  const pairs = new Map();
  const venues = new Set();
  for (const row of rows) {
    const a = row['Dest A'];
    const b = row['Dest B'];
    venues.add(a);
    venues.add(b);
    const entry = {};
    for (const [k, col] of Object.entries(SPEED_COLUMNS)) {
      // CSV value is seconds (the header says "0.8 m/s" etc. but the numbers
      // match meters / (m/s) = seconds, confirmed by checking a couple rows).
      const raw = row[col].replace(/,/g, '');
      entry[k] = parseFloat(raw);
    }
    const meters = parseFloat(row['Meter'].replace(/,/g, ''));
    for (const [k, mps] of Object.entries(COMPUTED_SPEEDS)) {
      entry[k] = meters / mps;
    }
    pairs.set(`${a}||${b}`, entry);
    pairs.set(`${b}||${a}`, entry);
  }

  function walkSeconds(a, b, speed) {
    if (a === b) return 0;
    const entry = pairs.get(`${a}||${b}`);
    if (!entry) {
      console.warn('Missing walk entry:', a, b);
      return 0;
    }
    return entry[speed];
  }

  return { venues, walkSeconds };
}

// Convert a "HH:MM" string to minutes-since-festival-day-start (13:00 = 0).
// Gates open at 1 PM; times run 13:00 through 01:00 next day.
// Hours < DAY_START_HOUR are treated as after midnight.
const DAY_START_HOUR = 13; // 1 PM

function timeStringToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  // If hour < DAY_START_HOUR, it's after midnight -> add 24h.
  const absolute = h < DAY_START_HOUR ? h + 24 : h;
  return (absolute - DAY_START_HOUR) * 60 + m;
}

export function minutesToTimeString(minutes) {
  const total = Math.round(minutes);
  let hourAbs = DAY_START_HOUR + Math.floor(total / 60);
  const min = ((total % 60) + 60) % 60;
  hourAbs = ((hourAbs % 24) + 24) % 24;
  const ampm = hourAbs >= 12 && hourAbs < 24 ? 'PM' : 'AM';
  let displayHour = hourAbs % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:${String(min).padStart(2, '0')} ${ampm}`;
}

const DEFAULT_END_MINUTES = timeStringToMinutes('01:00'); // 1 AM = 11 hours after 14:00 = 660 min

export async function loadDay(dayKey) {
  const res = await fetch(`data/${dayKey}.json`);
  if (!res.ok) throw new Error(`Could not load data/${dayKey}.json`);
  const raw = await res.json();

  return raw.map((a, idx) => {
    const t = a['24HourTime'];
    let startStr, endStr;
    if (t.includes('-')) {
      [startStr, endStr] = t.split('-');
    } else {
      startStr = t;
      endStr = null;
    }
    const startMin = timeStringToMinutes(startStr);
    const endMin = endStr ? timeStringToMinutes(endStr) : DEFAULT_END_MINUTES;
    return {
      id: `${dayKey}-${idx}`,
      name: a.name,
      venue: a.venue,
      startMin,
      endMin,
      displayTime: a.time,
    };
  }).sort((a, b) => a.startMin - b.startMin || a.name.localeCompare(b.name));
}
