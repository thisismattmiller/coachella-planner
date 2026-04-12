// Schedule feasibility solver.
//
// Input:
//   picks: Array<{ id, act, tier, desiredArrival?, desiredDeparture? }>
//     tier: 'must' | 'want'
//   ctx: { walkSeconds(a, b, speed), speed, paddingMin, activeId? }
//     activeId: pick id that is currently being dragged/slid. When set, that
//               pick is placed first in pass 2 and its position is honored over
//               other wants — preceding wants get trimmed or dropped if needed.
//
// Output:
//   {
//     scheduled: [{ id, act, tier, arrival, departure, walkFromPrev, prevId }],
//     dropped:   [{ id, act, tier, reason }],
//     errors:    [string]
//   }
//
// Two-pass approach:
//   Pass 1: Anchor all 'must' acts in start-time order. Must acts take their full
//           scheduled window (act.startMin → act.endMin) unless the user has set
//           explicit desiredArrival/desiredDeparture. If two musts truly conflict
//           (the later must can't be reached from the earlier must in time, even
//           after trimming the earlier must's departure), surface a hard error and
//           drop the later one.
//   Pass 2: Fit each 'want' act into the gap between its neighboring scheduled
//           acts (could be musts or already-placed wants). A want is placed if
//           and only if there's a feasible window ≥ MIN_WATCH_MIN that doesn't
//           push any already-scheduled neighbor out of feasibility.
//
// This way, wants can never block musts.

const MIN_WATCH_MIN = 5;

export function solve(picks, ctx) {
  const { walkSeconds, speed, paddingMin, activeId = null } = ctx;

  function walkMinutes(fromVenue, toVenue) {
    if (fromVenue === toVenue) return 0;
    return walkSeconds(fromVenue, toVenue, speed) / 60 + paddingMin;
  }

  function walkInfo(fromVenue, toVenue) {
    if (fromVenue === toVenue) {
      return { fromVenue, toVenue, walkSec: 0, paddingMin: 0, totalMin: 0 };
    }
    const walkSec = walkSeconds(fromVenue, toVenue, speed);
    return {
      fromVenue,
      toVenue,
      walkSec,
      paddingMin,
      totalMin: walkSec / 60 + paddingMin,
    };
  }

  // Split into tiers.
  const musts = picks.filter((p) => p.tier === 'must')
    .sort((a, b) => a.act.startMin - b.act.startMin || a.act.name.localeCompare(b.act.name));
  const wants = picks.filter((p) => p.tier === 'want')
    .sort((a, b) => a.act.startMin - b.act.startMin || a.act.name.localeCompare(b.act.name));

  // Scheduled list is kept sorted by arrival time at all times.
  // Each entry: { id, act, tier, arrival, departure, walkFromPrev, prevId }
  const scheduled = [];
  const dropped = [];
  const errors = [];

  // --- Pass 1: anchor musts ---
  for (const pick of musts) {
    const { act } = pick;
    const prev = scheduled[scheduled.length - 1];

    const desiredArrival = pick.desiredArrival ?? act.startMin;
    const desiredDeparture = pick.desiredDeparture ?? act.endMin;

    let arrival = Math.max(desiredArrival, act.startMin);
    let departure = Math.min(desiredDeparture, act.endMin);
    let walkFromPrev = null;

    if (prev) {
      const wInfo = walkInfo(prev.act.venue, act.venue);
      walkFromPrev = wInfo;
      const earliestArrival = prev.departure + wInfo.totalMin;

      if (earliestArrival > arrival) {
        // We'd need the previous must to leave earlier. Try trimming it.
        const prevMinDeparture = prev.arrival + MIN_WATCH_MIN;
        const neededPrevDeparture = arrival - wInfo.totalMin;

        if (neededPrevDeparture >= prevMinDeparture) {
          // Trim previous must so this one can start on time.
          prev.departure = Math.max(neededPrevDeparture, prevMinDeparture);
          // Recompute arrival — may still need bump.
          arrival = Math.max(arrival, prev.departure + wInfo.totalMin);
        } else {
          // Can't trim prev enough. Bump this one's arrival as far as possible.
          arrival = earliestArrival;
        }
      }
    }

    if (arrival >= departure || departure - arrival < MIN_WATCH_MIN) {
      const watchMin = Math.max(0, departure - arrival);
      const reason = prev
        ? `Conflicts with can't-miss "${prev.act.name}" — need ${Math.round(walkFromPrev.totalMin)} min walk from ${walkFromPrev.fromVenue} to ${walkFromPrev.toVenue}, only ${Math.round(watchMin)} min viewing available.`
        : `Only ${Math.round(watchMin)} min available (minimum ${MIN_WATCH_MIN}).`;
      dropped.push({ id: pick.id, act, tier: 'must', reason });
      errors.push(`Can't-miss conflict: "${act.name}" — ${reason}`);
      continue;
    }

    scheduled.push({
      id: pick.id,
      act,
      tier: 'must',
      arrival,
      departure,
      walkFromPrev,
      prevId: prev ? prev.id : null,
    });
  }

  // --- Pass 2: place wants. ---
  // Order matters because later placements have to fit around earlier ones.
  //   (1) The active (currently-dragged) pick goes first — it's the user's
  //       in-progress intent and must win against everything else.
  //   (2) Then "pinned" wants (any want the user has manually adjusted) go
  //       next, in start-time order, so previous slides persist across drags.
  //   (3) Then plain wants in start-time order.
  // When a higher-priority want is placed, neighboring wants get their windows
  // trimmed. If the trim would drop them below MIN_WATCH_MIN, they're dropped
  // with a reason when they're later attempted.
  const isPinned = (p) => p.desiredArrival != null || p.desiredDeparture != null;
  const activePick = activeId != null ? wants.find((p) => p.id === activeId) : null;

  const wantOrder = [];
  if (activePick) wantOrder.push(activePick);
  for (const p of wants) {
    if (p === activePick) continue;
    if (isPinned(p)) wantOrder.push(p);
  }
  for (const p of wants) {
    if (p === activePick) continue;
    if (!isPinned(p)) wantOrder.push(p);
  }

  for (const pick of wantOrder) {
    const isHighPriority = pick === activePick || isPinned(pick);
    const placed = placeWant(pick, scheduled, walkInfo, isHighPriority);
    if (placed.ok) {
      insertScheduled(scheduled, placed.entry, walkInfo);
    } else {
      dropped.push({ id: pick.id, act: pick.act, tier: 'want', reason: placed.reason });
    }
  }

  return { scheduled, dropped, errors };
}

// Compute where a want pick should go in the current scheduled list.
// Returns { ok: true, entry } or { ok: false, reason }.
// If canFlexNeighbors, the pick's desiredArrival/Departure take priority over previous
// want neighbors (which will be trimmed when this entry is inserted).
function placeWant(pick, scheduled, walkInfo, canFlexNeighbors) {
  const { act } = pick;

  // Find insertion point: the last scheduled entry whose arrival is at or
  // before this act's start. Using act.startMin (not endMin) is important —
  // otherwise an act whose window merely overlaps a previously-placed entry
  // gets placed *after* that entry even when it actually starts earlier in
  // real time. That wrong ordering would make the solver compute feasibility
  // against the wrong neighbor and spuriously drop the act.
  let prevIdx = -1;
  for (let i = 0; i < scheduled.length; i++) {
    if (scheduled[i].arrival <= act.startMin) prevIdx = i;
    else break;
  }
  const prev = prevIdx >= 0 ? scheduled[prevIdx] : null;
  const next = prevIdx + 1 < scheduled.length ? scheduled[prevIdx + 1] : null;

  // Compute feasible bounds. For the active pick, previous WANT neighbors are
  // flexible (we'll trim them), so earliestArrival is bounded only by prev's
  // minimum 5-min watch plus walk. Must neighbors are hard.
  let walkFromPrev = null;
  let earliestArrival = act.startMin;
  if (prev) {
    const w = walkInfo(prev.act.venue, act.venue);
    walkFromPrev = w;
    if (canFlexNeighbors && prev.tier === 'want') {
      // Flex: previous want can be shrunk to its arrival + MIN_WATCH_MIN.
      const prevMinDeparture = prev.arrival + MIN_WATCH_MIN;
      earliestArrival = Math.max(act.startMin, prevMinDeparture + w.totalMin);
    } else {
      earliestArrival = Math.max(act.startMin, prev.departure + w.totalMin);
    }
  }

  let walkToNext = null;
  let latestDeparture = act.endMin;
  if (next) {
    const w = walkInfo(act.venue, next.act.venue);
    walkToNext = w;
    if (canFlexNeighbors && next.tier === 'want') {
      const nextMaxArrival = next.departure - MIN_WATCH_MIN;
      latestDeparture = Math.min(act.endMin, nextMaxArrival - w.totalMin);
    } else {
      latestDeparture = Math.min(act.endMin, next.arrival - w.totalMin);
    }
  }

  // Apply user overrides (slide keeps duration; edge drag adjusts one side).
  const slidingDuration =
    pick.desiredArrival != null && pick.desiredDeparture != null
      ? pick.desiredDeparture - pick.desiredArrival
      : null;

  let arrival, departure;
  if (slidingDuration != null) {
    const feasibleWidth = latestDeparture - earliestArrival;
    const duration = Math.min(slidingDuration, feasibleWidth);
    arrival = Math.max(
      earliestArrival,
      Math.min(latestDeparture - duration, pick.desiredArrival),
    );
    departure = arrival + duration;
  } else {
    const desiredArrival = pick.desiredArrival ?? earliestArrival;
    const desiredDeparture = pick.desiredDeparture ?? latestDeparture;
    arrival = Math.max(earliestArrival, desiredArrival);
    departure = Math.min(latestDeparture, desiredDeparture);
  }
  const watchMin = departure - arrival;

  if (watchMin < MIN_WATCH_MIN) {
    const reason = buildWantDropReason(act, prev, next, walkFromPrev, walkToNext, earliestArrival, latestDeparture, watchMin);
    return { ok: false, reason };
  }

  return {
    ok: true,
    entry: {
      id: pick.id,
      act,
      tier: 'want',
      arrival,
      departure,
      walkFromPrev,
      prevId: prev ? prev.id : null,
      _insertAt: prevIdx + 1,
    },
  };
}

// Insert a computed entry into the scheduled list, trimming want neighbors
// whose windows now overlap the new entry's walk requirements.
function insertScheduled(scheduled, entry, walkInfo) {
  const insertAt = entry._insertAt;
  delete entry._insertAt;

  const prev = insertAt > 0 ? scheduled[insertAt - 1] : null;
  const next = insertAt < scheduled.length ? scheduled[insertAt] : null;

  // Trim previous want's departure if needed.
  if (prev && prev.tier === 'want') {
    const w = walkInfo(prev.act.venue, entry.act.venue);
    const maxPrevDeparture = entry.arrival - w.totalMin;
    if (prev.departure > maxPrevDeparture) {
      prev.departure = Math.max(prev.arrival, maxPrevDeparture);
    }
  }

  scheduled.splice(insertAt, 0, entry);

  // Fix the (new) next entry's walkFromPrev link.
  if (next) {
    next.walkFromPrev = walkInfo(entry.act.venue, next.act.venue);
    next.prevId = entry.id;
    // Trim the next want if its arrival needs to be later.
    if (next.tier === 'want') {
      const minNextArrival = entry.departure + next.walkFromPrev.totalMin;
      if (next.arrival < minNextArrival) {
        next.arrival = Math.min(next.departure, minNextArrival);
      }
    }
  }
}

function buildWantDropReason(act, prev, next, walkFromPrev, walkToNext, earliestArrival, latestDeparture, watchMin) {
  const parts = [];
  if (prev && walkFromPrev && walkFromPrev.totalMin > 0) {
    parts.push(`after "${prev.act.name}" (${prev.act.venue}) need ${Math.round(walkFromPrev.totalMin)} min walk`);
  }
  if (next && walkToNext && walkToNext.totalMin > 0) {
    parts.push(`before "${next.act.name}" (${next.act.venue}) need ${Math.round(walkToNext.totalMin)} min walk`);
  }
  const context = parts.length ? ` — ${parts.join(', ')}` : '';
  if (watchMin <= 0) {
    return `Not reachable between neighboring acts${context}.`;
  }
  return `Only ${Math.round(watchMin)} min available (minimum ${MIN_WATCH_MIN})${context}.`;
}
