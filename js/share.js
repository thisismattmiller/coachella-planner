// Shareable-plan encoding.
//
// State encoded: day, speed, padding, picks.
// Picks are keyed by `name||venue` so the encoding survives re-extraction of
// the day's JSON (unlike encoding by array index).
//
// Format (JSON → base64url):
//   {
//     v: 1,           // format version
//     d: "w1_fri",    // day
//     s: "normal",    // speed
//     p: 2,           // padding minutes
//     x: [            // picks; each entry: [name||venue, tier, a?, b?]
//       ["Record Safari||Coachella Stage", "w"],          // want, no pin
//       ["Sabrina Carpenter||Coachella Stage", "m"],      // must
//       ["The xx||Coachella Stage", "w", 245, 300],       // want, pinned
//     ]
//   }
//
// Tier codes: "w" = want, "m" = must. Acts not in the list are skipped.

const VERSION = 1;

function keyFor(act) {
  return `${act.name}||${act.venue}`;
}

export function encodeState({ dayKey, speed, paddingMin, picks, acts }) {
  // Build id -> act map so we can look up name/venue from pick.id.
  const actsById = new Map();
  for (const a of acts) actsById.set(a.id, a);

  const entries = [];
  for (const [id, entry] of picks) {
    const act = actsById.get(id);
    if (!act) continue;
    if (!entry || entry.tier === 'none') continue;
    const tier = entry.tier === 'must' ? 'm' : 'w';
    const row = [keyFor(act), tier];
    if (entry.desiredArrival != null) row.push(Math.round(entry.desiredArrival));
    if (entry.desiredDeparture != null) {
      // Ensure both are present if either is, so positional parsing stays simple.
      if (row.length === 2) row.push(Math.round(act.startMin));
      row.push(Math.round(entry.desiredDeparture));
    }
    entries.push(row);
  }

  const payload = {
    v: VERSION,
    d: dayKey,
    s: speed,
    p: paddingMin,
    x: entries,
  };

  return base64urlEncode(JSON.stringify(payload));
}

// Apply an encoded string to produce a new state slice.
// Returns { dayKey, speed, paddingMin, picksBuilder(acts) } or null on error.
// picksBuilder is a function because the caller needs to load the day's acts
// first before we can map name||venue keys back to act ids.
export function decodeState(encoded) {
  if (!encoded) return null;
  let json;
  try {
    json = base64urlDecode(encoded);
  } catch (e) {
    console.warn('Share link decode failed:', e);
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(json);
  } catch (e) {
    console.warn('Share link JSON parse failed:', e);
    return null;
  }
  if (!payload || payload.v !== VERSION) {
    console.warn('Share link version mismatch:', payload && payload.v);
    return null;
  }

  return {
    dayKey: payload.d,
    speed: payload.s,
    paddingMin: payload.p,
    picksBuilder(acts) {
      // Build name||venue -> act lookup.
      const byKey = new Map();
      for (const a of acts) byKey.set(keyFor(a), a);

      const picks = new Map();
      for (const row of payload.x || []) {
        const [key, tierCode, a, b] = row;
        const act = byKey.get(key);
        if (!act) {
          console.warn('Share link references unknown act:', key);
          continue;
        }
        const tier = tierCode === 'm' ? 'must' : 'want';
        const entry = { tier };
        if (a != null) entry.desiredArrival = a;
        if (b != null) entry.desiredDeparture = b;
        picks.set(act.id, entry);
      }
      return picks;
    },
  };
}

// --- base64url helpers (URL-safe, no padding) ---

function base64urlEncode(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(encoded) {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  return decodeURIComponent(escape(atob(padded)));
}
