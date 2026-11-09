// Event Task clock marks and Google clock deprecation notices.
// Inherited off-clock rows reuse the dashed time pill; explicit `#off`
// tags keep their chip; `#on` is a neutral override tooltip. The daily
// auto-sync Notice reads additive `deprecations[]` from bob gcal sync.

const GCAL_EVENTS_OFF_CLOCK_TITLE = "Off-clock · on the calendar, off the clock";
const GCAL_EVENTS_ON_CLOCK_TITLE = "On the clock (override)";

function gcalEventsFromNoteTitle(notePath) {
  const stem = pomodoroHomeStem(notePath);
  if (!stem) return "Off-clock · from note";
  return `Off-clock · from ${stem}`;
}

function gcalEventsClockTooltip(row) {
  if (!row) return "";
  if (row.clockSource === "on_tag") return GCAL_EVENTS_ON_CLOCK_TITLE;
  if (row.offClock && row.clockSource === "note") return gcalEventsFromNoteTitle(row.clockNote);
  return "";
}

function gcalEventsApplyClockToRow(row, line, path, metadataCache, vault) {
  if (!row) return row;
  const tag = eventTaskClockTag(line);
  row.offClock = tag.offClock;
  row.clockSource = tag.source;
  row.clockNote = tag.note;
  if (row.offClockTag === undefined) {
    row.offClockTag = eventTaskOffClockTagRange(line);
  }
  if (tag.source !== "default") return row;
  try {
    const effective = taskEffectiveOffClock(path, line, metadataCache, vault);
    if (effective && typeof effective.offClock === "boolean") {
      row.offClock = effective.offClock;
      row.clockSource = effective.source;
      row.clockNote = effective.notePath;
    }
  } catch (error) {
    // Tag-only is the safe fallback when note metadata is unavailable.
  }
  return row;
}

function gcalEventsEnrichScannedClocks(scanned, lines, options = {}) {
  if (!scanned || !Array.isArray(scanned.rows)) return scanned;
  const opts = options && typeof options === "object" ? options : {};
  const path = typeof opts.path === "string" ? opts.path : "";
  const cache = opts.metadataCache;
  const vault = opts.vault;
  for (const row of scanned.rows) {
    if (!row || row.kind !== "task") continue;
    const line = Array.isArray(lines) ? String(lines[row.line] || "") : "";
    gcalEventsApplyClockToRow(row, line, path, cache, vault);
  }
  return scanned;
}

function gcalEventsClockTagDecorations(row, base, line, selectionRanges) {
  const extras = [];
  if (!row || !row.offClockTag || !Decoration) return extras;
  const { start, end } = row.offClockTag;
  const lineStart = base;
  const lineEnd = base + String(line || "").length;
  let revealed = false;
  for (const selection of selectionRanges || []) {
    try {
      if (
        selection &&
        typeof selection.from === "number" &&
        typeof selection.to === "number" &&
        selection.from <= lineEnd &&
        selection.to >= lineStart
      ) {
        revealed = true;
        break;
      }
    } catch (error) {
      continue;
    }
  }
  if (!revealed && CalendarEventOffClockChipWidget && typeof Decoration.replace === "function") {
    const raw = String(line || "").slice(start, end);
    const label = raw.startsWith("#") ? raw.slice(1) : raw;
    extras.push({
      from: base + start,
      to: base + end,
      decoration: Decoration.replace({
        widget: new CalendarEventOffClockChipWidget(label),
      }),
    });
  }
  return extras;
}

function gcalEventsPaintOffClockTag(row, timeEl) {
  try {
    const tags = row && row.querySelectorAll ? row.querySelectorAll("a.tag") : [];
    for (const tag of tags || []) {
      const text = String(tag.textContent || "").trim();
      if (!eventTaskLineIsOffClock(text)) continue;
      if (tag.classList) tag.classList.add("bob-calendar-event-off-clock");
      tag.setAttribute("data-off-clock", "true");
      tag.setAttribute("title", GCAL_EVENTS_OFF_CLOCK_TITLE);
      const doc = tag.ownerDocument;
      if (doc && typeof doc.createElement === "function" && typeof tag.replaceChildren === "function") {
        const hash = doc.createElement("span");
        hash.className = "bob-calendar-event-off-clock-hash";
        hash.textContent = "#";
        tag.replaceChildren(hash, doc.createTextNode(text.slice(1)));
      }
      if (timeEl) timeEl.setAttribute("data-off-clock", "true");
      return true;
    }
  } catch (error) {}
  return false;
}

function gcalEventsPaintOnClockTag(row, timeEl) {
  try {
    const tags = row && row.querySelectorAll ? row.querySelectorAll("a.tag") : [];
    for (const tag of tags || []) {
      const text = String(tag.textContent || "").trim();
      if (eventTaskClockTag(text).source !== "on_tag") continue;
      tag.setAttribute("title", GCAL_EVENTS_ON_CLOCK_TITLE);
      if (timeEl && typeof timeEl.setAttribute === "function") {
        timeEl.setAttribute("title", GCAL_EVENTS_ON_CLOCK_TITLE);
      }
      return true;
    }
  } catch (error) {}
  return false;
}

function gcalEventsPaintClockMarks(row, timeEl, model) {
  const tagged = gcalEventsPaintOffClockTag(row, timeEl);
  if (model && model.clockSource === "on_tag") {
    gcalEventsPaintOnClockTag(row, timeEl);
  }
  if (!tagged && timeEl && model && model.offClock && typeof timeEl.setAttribute === "function") {
    timeEl.setAttribute("data-off-clock", "true");
  }
  const tooltip = gcalEventsClockTooltip(model);
  if (tooltip && timeEl && typeof timeEl.setAttribute === "function" && !timeEl.getAttribute("title")) {
    timeEl.setAttribute("title", tooltip);
  }
  return tagged;
}

function gcalEventsDecodeDeprecations(value) {
  if (!Array.isArray(value)) return [];
  const rows = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    rows.push(item);
  }
  return rows;
}

function gcalEventsDeprecationEventKey(item, index) {
  const calendarId = item && typeof item.calendar_id === "string" ? item.calendar_id : "";
  const eventId = item && typeof item.event_id === "string" ? item.event_id : "";
  if (calendarId && eventId) return `${calendarId}\0${eventId}`;
  return `#${index}`;
}

function gcalEventsDeprecationNoticeText(deprecations) {
  const rows = gcalEventsDecodeDeprecations(deprecations);
  const events = new Set();
  const tokens = [];
  const seenToken = new Set();
  rows.forEach((item, index) => {
    events.add(gcalEventsDeprecationEventKey(item, index));
    const token = item && typeof item.token === "string" ? item.token : "";
    if (token && !seenToken.has(token)) {
      seenToken.add(token);
      tokens.push(token);
    }
  });
  const count = events.size || rows.length;
  const token = tokens.length === 1 ? tokens[0] : "deprecated clock tags";
  const verb = count === 1 ? "calendar event still uses" : "calendar events still use";
  return `${count} ${verb} ${token} \u00b7 run bob gcal list`;
}

function gcalEventsShowDeprecationNotice(state, report, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const deprecations = gcalEventsDecodeDeprecations(report && report.deprecations);
  if (!deprecations.length) return false;
  if (!state.gcalDeprecationNoticeDays) state.gcalDeprecationNoticeDays = new Set();
  const now = opts.now instanceof Date ? opts.now : new Date();
  const day = formatLocalDate(now);
  if (state.gcalDeprecationNoticeDays.has(day)) return false;
  state.gcalDeprecationNoticeDays.add(day);
  const text = gcalEventsDeprecationNoticeText(deprecations);
  try {
    if (typeof opts.notice === "function") opts.notice(text);
    else new Notice(text);
  } catch (error) {}
  return true;
}

function gcalEventsDecodeSync(stdout, stderr) {
  let body;
  try {
    body = JSON.parse(String(stdout || ""));
  } catch (error) {
    return { ok: false, code: "bad-json", message: "bob gcal sync returned invalid JSON.", detail: statsFirstLine(stderr) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.schema_version !== 1) {
    return { ok: false, code: "bad-shape", message: "bob gcal sync returned an unexpected JSON shape.", detail: statsFirstLine(stderr) };
  }
  if (body.ok === false) {
    const error = body.error && typeof body.error === "object" ? body.error : {};
    return {
      ok: false,
      code: typeof error.kind === "string" ? error.kind : "bob-error",
      message: typeof error.message === "string" ? error.message : "bob gcal sync failed.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok !== true || !["written", "unchanged", "waiting", "held"].includes(body.status)) {
    return { ok: false, code: "bad-shape", message: "bob gcal sync returned an unexpected report.", detail: statsFirstLine(stderr) };
  }
  return { ok: true, report: Object.assign({}, body, { deprecations: gcalEventsDecodeDeprecations(body.deprecations) }) };
}
