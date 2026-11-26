// Shared pure snooze row classification. Keep this fragment byte-identical
// in bob-navigation-hotkeys, block-id-prompt, and task-status-cycler.

function snoozeIdentityKey(route, blockId) {
  if (typeof route !== "string" || !route || typeof blockId !== "string" || !blockId) return null;
  return route + "#^" + blockId;
}

function snoozeBaseRowState(row, noteIsToday, nowMinutes) {
  if (row.history) return "woken";
  if (!noteIsToday) return "previous_day";
  if (row.malformed || !Number.isInteger(row.minutes)) return "malformed";
  if (row.resolution === "missing") return "missing";
  if (row.resolution === "ambiguous") return "ambiguous";
  if (row.resolution !== "found") return "missing";
  if (!row.is_task) return "not_task";
  if (row.is_event) return "event_task";
  if (row.status === "x" || row.status === "X") return "done";
  if (row.status === "-") return "cancelled";
  if (row.live_link) return "already_linked";
  if (row.status === "?") return "blocked";
  if (row.status === " ") return "ready";
  if (row.status === "*" || row.status === "/") return row.minutes <= nowMinutes ? "due" : "asleep";
  return "not_task";
}

function snoozeClassifyRows(input) {
  const source = input && typeof input === "object" ? input : {};
  const today = String(source.today || "");
  const noteDate = String(source.note_date || "");
  const nowMinutes = snoozeParseNowMinutes(source.now_minutes !== undefined ? source.now_minutes : source.now);
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const base = rows.map((row) => snoozeBaseRowState(row || {}, noteDate === today, nowMinutes === null ? -1 : nowMinutes));
  const best = new Map();
  for (let position = 0; position < rows.length; position += 1) {
    if (!["asleep", "due", "blocked"].includes(base[position])) continue;
    const row = rows[position] || {};
    const key = row.resolution === "found" ? snoozeIdentityKey(row.route, row.block) : null;
    if (!key) continue;
    const minutes = Number.isInteger(row.minutes) ? row.minutes : Number.MAX_SAFE_INTEGER;
    const previous = best.get(key);
    if (!previous || minutes < previous.minutes || (minutes === previous.minutes && position < previous.position)) {
      best.set(key, { minutes, position });
    }
  }
  const winners = new Set(Array.from(best.values(), (entry) => entry.position));
  const classified = rows.map((row, position) => {
    const sourceRow = row || {};
    let state = base[position];
    const key = sourceRow.resolution === "found" ? snoozeIdentityKey(sourceRow.route, sourceRow.block) : null;
    if (key && ["asleep", "due", "blocked"].includes(state) && !winners.has(position)) state = "duplicate";
    return {
      line: Number(sourceRow.line) || 0,
      minutes: Number.isInteger(sourceRow.minutes) ? sourceRow.minutes : null,
      hhmm: Number.isInteger(sourceRow.minutes) ? snoozeFormatHhmm(sourceRow.minutes) : null,
      route: key ? sourceRow.route : null,
      block: key ? sourceRow.block : null,
      identity: key,
      state,
      eventLint: !sourceRow.history && sourceRow.resolution === "found" && sourceRow.is_task === true && sourceRow.is_event === true,
    };
  });
  let next = null;
  for (let position = 0; position < classified.length; position += 1) {
    const row = classified[position];
    if (row.state !== "asleep" && row.state !== "due") continue;
    if (row.minutes === null) continue;
    if (!next || row.minutes < next.minutes || (row.minutes === next.minutes && position < next.position)) {
      next = { minutes: row.minutes, position };
    }
  }
  const nextWakeAt = next ? snoozeResolveTarget(today, next.minutes, String(source.zone || "")) : null;
  const planned = Array.from(new Set(classified
    .filter((row) => row.identity && ["asleep", "due", "blocked"].includes(row.state))
    .map((row) => row.identity))).sort();
  const blocked = Array.from(new Set(classified
    .filter((row) => row.identity && row.state === "blocked")
    .map((row) => row.identity))).sort();
  return {
    rows: classified,
    planned,
    blocked,
    nextWakeAt: nextWakeAt ? nextWakeAt.rfc3339 : null,
    eventLints: classified.filter((row) => row.eventLint).map((row) => row.line),
  };
}

function snoozeLiveTargets(classified) {
  const value = classified && typeof classified === "object" ? classified : {};
  return {
    planned: Array.isArray(value.planned) ? value.planned.slice() : [],
    blocked: Array.isArray(value.blocked) ? value.blocked.slice() : [],
    nextWakeAt: value.nextWakeAt || null,
  };
}
