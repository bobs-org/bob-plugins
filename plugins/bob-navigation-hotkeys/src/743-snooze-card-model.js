// Snooze Card pure model: ranked suggestions, footer copy, input teaching,
// and card key handling. Pure: snapshots in, frozen facts out. The modal
// fragment renders from these without reimplementing ranking or copy.
function snoozeCardDisplayMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < 0 || value >= 1440) return null;
  return String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
}

function snoozeCardNormalizeUsedTimes(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (Number.isInteger(entry) && entry >= 0 && entry < 1440) {
      out.push(entry);
      continue;
    }
    if (typeof entry === "string") {
      const text = entry.trim();
      let parsed = null;
      const colon = /^(\d{1,2}):(\d{2})$/.exec(text);
      if (colon) {
        const hour = Number(colon[1]);
        const minute = Number(colon[2]);
        if (hour <= 23 && minute <= 59) parsed = hour * 60 + minute;
      } else if (/^\d{3,4}$/.test(text)) {
        const hour = Number(text.length === 3 ? text.slice(0, 1) : text.slice(0, 2));
        const minute = Number(text.length === 3 ? text.slice(1) : text.slice(2));
        if (hour <= 23 && minute <= 59) parsed = hour * 60 + minute;
      }
      if (parsed !== null) out.push(parsed);
    }
  }
  return out;
}

// Rank future same-day suggestions in groups: remaining event end times
// (chronological, `15:30 · after <title>`), `+30m`, `+1h`, `+2h`, then
// times used today. Deduplicate resolved instants with the earlier group
// winning; discard invalid/past/next-day candidates via the shared
// `snoozeParseWhen` twin and the zone target check.
function rankSnoozeSuggestions(input) {
  const options = input && typeof input === "object" ? input : {};
  const date = typeof options.date === "string" ? options.date : "";
  const zone = typeof options.zone === "string" ? options.zone : "";
  const nowMinutes = Number.isInteger(options.nowMinutes) ? options.nowMinutes : null;
  if (!date || !zone || nowMinutes === null) return Object.freeze([]);
  const clock = { date, nowMinutes, zone };
  const seen = new Set();
  const ranked = [];
  const consider = (minutes, suggestion) => {
    if (!Number.isInteger(minutes) || minutes <= nowMinutes || minutes >= 1440) return;
    if (seen.has(minutes)) return;
    let resolved = null;
    try {
      resolved = typeof snoozeResolveTarget === "function" ? snoozeResolveTarget(date, minutes, zone) : { minutes };
    } catch (_) {
      return;
    }
    if (!resolved) return;
    seen.add(minutes);
    ranked.push(Object.freeze({ minutes, ...suggestion }));
  };
  const events = Array.isArray(options.events) ? options.events.slice() : [];
  const orderedEvents = events.map((event, index) => ({ event, index })).sort((left, right) => {
    const byEnd = Number(left.event && left.event.endMin) - Number(right.event && right.event.endMin);
    if (byEnd !== 0) return byEnd;
    const leftOrder = Number.isInteger(left.event && left.event.order) ? left.event.order : left.index;
    const rightOrder = Number.isInteger(right.event && right.event.order) ? right.event.order : right.index;
    return leftOrder - rightOrder;
  });
  for (const { event } of orderedEvents) {
    if (!event || typeof event !== "object") continue;
    const endMin = Number.isInteger(event.endMin) ? event.endMin : null;
    if (endMin === null) continue;
    const title = String(event.title == null || String(event.title).trim() === "" ? "Event" : event.title);
    const display = snoozeCardDisplayMinutes(endMin);
    if (!display) continue;
    consider(endMin, {
      hhmm: String(Math.floor(endMin / 60)).padStart(2, "0") + String(endMin % 60).padStart(2, "0"),
      display,
      input: display,
      label: display + " · after " + title,
      group: "event",
    });
  }
  const quick = [
    { input: "+30m", delta: 30 },
    { input: "+1h", delta: 60 },
    { input: "+2h", delta: 120 },
  ];
  for (const item of quick) {
    let parsed = null;
    try {
      parsed = typeof snoozeParseWhen === "function" ? snoozeParseWhen(item.input, clock) : null;
    } catch (_) {
      parsed = null;
    }
    if (!parsed || parsed.ok !== true || !parsed.value) continue;
    const minutes = Number(parsed.value.minutes);
    const display = snoozeCardDisplayMinutes(minutes);
    if (!display) continue;
    consider(minutes, {
      hhmm: parsed.value.hhmm,
      display,
      input: item.input,
      label: item.input + " · " + display,
      group: "quick",
    });
  }
  const used = snoozeCardNormalizeUsedTimes(options.usedTimesToday).sort((left, right) => left - right);
  for (const minutes of used) {
    const display = snoozeCardDisplayMinutes(minutes);
    if (!display) continue;
    consider(minutes, {
      hhmm: String(Math.floor(minutes / 60)).padStart(2, "0") + String(minutes % 60).padStart(2, "0"),
      display,
      input: display,
      label: display,
      group: "used",
    });
  }
  return Object.freeze(ranked);
}

function snoozeCardInText(minutes, nowMinutes) {
  const target = Number(minutes);
  const now = Number(nowMinutes);
  if (!Number.isInteger(target) || !Number.isInteger(now)) return null;
  const delta = target - now;
  if (delta <= 0) return null;
  const hours = Math.floor(delta / 60);
  const rest = delta % 60;
  if (hours <= 0) return "in " + delta + "m";
  if (rest === 0) return "in " + hours + "h";
  return "in " + hours + "h " + rest + "m";
}

// Selected-time footer consequence, e.g.
// `leaves WRITE · wakes into WRITE at 15:30 · in 2h 10m · TODAY 9/13 now, 10/13 after`.
// Missing preview data omits its segment, never invented counts.
// Over-cap is informative text only, never a refusal.
function buildSnoozeCardFooter(input) {
  const options = input && typeof input === "object" ? input : {};
  const parts = [];
  if (typeof options.departure === "string" && options.departure.trim() !== "") {
    parts.push("leaves " + options.departure.trim());
  }
  const display = typeof options.display === "string" && options.display.trim() !== "" ? options.display.trim() : null;
  if (typeof options.destination === "string" && options.destination.trim() !== "" && display) {
    parts.push("wakes into " + options.destination.trim() + " at " + display);
  } else if (display) {
    parts.push("at " + display);
  }
  if (typeof options.inText === "string" && options.inText.trim() !== "") {
    parts.push(options.inText.trim());
  }
  const hasNow = Number.isInteger(options.nowCount) && Number.isInteger(options.nowCap);
  const hasAfter = Number.isInteger(options.afterCount) && Number.isInteger(options.afterCap);
  if (hasNow || hasAfter) {
    const segments = [];
    if (hasNow) segments.push(options.nowCount + "/" + options.nowCap + " now");
    if (hasAfter) segments.push(options.afterCount + "/" + options.afterCap + " after");
    parts.push("TODAY " + segments.join(", "));
  }
  if (options.overCap === true) {
    parts.push("over cap");
  }
  return parts.join(" · ");
}

// Forecast TODAY from the pure planner's daily postimage. `identities` must
// be the budget's canonical, on-clock identities; callers omit the `after`
// segment when either that set or effective clock classification is unknown.
function snoozeCardForecastCounts(input) {
  const options = input && typeof input === "object" ? input : {};
  if (!Number.isInteger(options.nowCount) || !Number.isInteger(options.cap)) return null;
  const result = { nowCount: options.nowCount, nowCap: options.cap, overCap: false };
  if (!Array.isArray(options.identities) || typeof options.onClock !== "boolean") return result;
  const identity = options.identity && typeof options.identity === "object" ? options.identity : {};
  const blockId = String(identity.block || identity.blockId || "");
  const normalize = (value) => String(value || "").replace(/\\/g, "/").replace(/\.md$/i, "").replace(/^\/+/, "");
  const expectedTargets = new Set([identity.route, identity.path, ...(Array.isArray(identity.targets) ? identity.targets : [])].map(normalize).filter(Boolean));
  const counted = blockId !== "" && options.identities.some((link) =>
    link && String(link.blockId || link.block || "") === blockId && expectedTargets.has(normalize(link.target || link.path)),
  );
  const afterCount = options.nowCount + (options.onClock && !counted ? 1 : 0);
  result.afterCount = afterCount;
  result.afterCap = options.cap;
  result.overCap = afterCount > options.cap;
  return result;
}

// Snoozed-mode header: `Snoozed until 15:30 · in 2h`
// (or the truthful due/blocked state when supplied).
function buildSnoozeCardSnoozedHeader(input) {
  const options = input && typeof input === "object" ? input : {};
  const display = typeof options.display === "string" && options.display.trim() !== "" ? options.display.trim() : null;
  if (!display) return "Snoozed";
  const inText = typeof options.inText === "string" && options.inText.trim() !== "" ? " · " + options.inText.trim() : "";
  const state = typeof options.state === "string" ? options.state.trim().toLowerCase() : "";
  if (state === "due") return "Snoozed until " + display + " · due — waking";
  if (state === "blocked") {
    const reason = typeof options.blockedReason === "string" && options.blockedReason.trim() !== ""
      ? options.blockedReason.trim()
      : "waits on prerequisites";
    return "Snoozed until " + display + " · blocked — " + reason;
  }
  if (state === "asleep") return "Snoozed until " + display + inText;
  return "Snoozed until " + display + inText;
}

// Teaching copy for typed input. Past/next-day uses the shared same-day
// line; DST gap reuses the parser's DST text; invalid reuses the format
// hint. Matches `WhenRefusal::message` in `src/native/snooze/when.rs`.
function snoozeCardInputMessage(parseResult) {
  if (!parseResult || typeof parseResult !== "object") return "use 1530, 15:30, 3:30p, 3p, 19, +45m, +2h, or +1h30m";
  if (parseResult.ok === true) return null;
  const refusal = String(parseResult.refusal || "invalid");
  if (refusal === "past" || refusal === "next_day") {
    return "same-day only — Schedule (s:) defers to another day";
  }
  if (refusal === "dst_gap") {
    return "that wall time does not exist today — pick a nearby time";
  }
  return "use 1530, 15:30, 3:30p, 3p, 19, +45m, +2h, or +1h30m";
}

// Event/new Blocked/done/cancelled/non-task teaching for refusal states.
// Includes the Event span or the known prerequisite/schedule/project
// reason when available.
function snoozeCardRefusalMessage(input) {
  const options = input && typeof input === "object" ? input : {};
  const refusal = String(options.refusal || "unavailable");
  const reason = typeof options.reason === "string" && options.reason.trim() !== "" ? " · " + options.reason.trim() : "";
  const span = typeof options.span === "string" && options.span.trim() !== "" ? " (" + options.span.trim() + ")" : "";
  switch (refusal) {
    case "event_task":
      return "Calendar Event Tasks cannot be snoozed" + span;
    case "blocked":
      return "That task is Blocked" + reason;
    case "done":
      return "That task is already done";
    case "cancelled":
      return "That task is cancelled";
    case "not_task":
      return "That row is not an open task";
    case "fenced":
      return "Snooze is unavailable inside a code fence";
    case "prose_mention":
      return "Snooze needs a task or its dedicated Task Link, not a prose mention";
    case "ambiguous_target":
    case "ambiguous":
      return "That link matches more than one task; qualify it before snoozing";
    case "multi_task":
      return "Snooze handles one task; pick a single row";
    case "missing_task":
      return "No task found at the cursor";
    case "no_pomodoros":
      return "Today's note has no Pomodoros section to snooze from";
    case "needs_naming":
      return "That task needs a block ID before it can be snoozed";
    case "stale":
      return "The note changed while the card was open; try again";
    case "day_changed":
      return "The day changed while the card was open; try again";
    case "unavailable":
      return "Snooze is unavailable here";
    default:
      return (options.message && String(options.message)) || "Snooze cannot be made here";
  }
}

// Pure card key handling: Ctrl+N/P and arrows move; Tab completes the
// selection; Enter confirms the current valid time or selected action.
// Typed invalid input never silently submits a suggestion. Close aliases
// (Esc, q outside a text control, Ctrl+[) dispatch through the shared
// close route. Repeat action keys are ignored; IME/composing is ignored.
function resolveSnoozeCardKey(model, event) {
  if (!model || typeof model !== "object" || !event) return null;
  if (event.isComposing === true || event.keyCode === 229) return null;
  if (event.inTextInput === true && String(event.key || "").toLowerCase() !== "tab" && event.key !== "Enter") {
    if (!isTaskCardCloseKeydown(event)) return null;
  }
  const target = event.target;
  const inTextControl = Boolean(target && (target.isContentEditable === true
    || /^(INPUT|TEXTAREA|SELECT)$/.test(String(target.tagName || "").toUpperCase())));
  const key = String(event.key || "");
  const lower = key.toLowerCase();
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const shift = event.shiftKey === true;
  const alt = event.altKey === true;
  const modified = ctrl || meta || shift || alt;
  if (isTaskCardCloseKeydown(event)) {
    if (lower === "q" && inTextControl) return null;
    return Object.freeze({ type: "close-card" });
  }
  if (event.repeat === true) {
    if ((!modified && (key === "Enter" || lower === "tab")) || (!modified && (key === "ArrowUp" || key === "ArrowDown"))) {
      return Object.freeze({ type: "ignored", reason: "repeated-action-key" });
    }
  }
  if ((!modified && key === "ArrowUp") || (ctrl && !meta && !shift && !alt && lower === "p")) {
    return Object.freeze({ type: "move-selection", direction: "previous" });
  }
  if ((!modified && key === "ArrowDown") || (ctrl && !meta && !shift && !alt && lower === "n")) {
    return Object.freeze({ type: "move-selection", direction: "next" });
  }
  if (!modified && lower === "tab") {
    return Object.freeze({ type: "complete-selection" });
  }
  if (!modified && key === "Enter") {
    return Object.freeze({ type: "confirm" });
  }
  return null;
}

Object.assign(module.exports.helpers, {
  snoozeCardDisplayMinutes,
  snoozeCardNormalizeUsedTimes,
  rankSnoozeSuggestions,
  snoozeCardInText,
  buildSnoozeCardFooter,
  snoozeCardForecastCounts,
  buildSnoozeCardSnoozedHeader,
  snoozeCardInputMessage,
  snoozeCardRefusalMessage,
  resolveSnoozeCardKey,
});

function snoozeCardIsAltZEvent(event) {
  if (!event || typeof event !== "object") return false;
  if (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true) return false;
  if (event.altKey !== true) return false;
  if (String(event.code || "") === "KeyZ") return true;
  return String(event.key || "").toLowerCase() === "z";
}

Object.assign(module.exports.helpers, {
  snoozeCardIsAltZEvent,
});
