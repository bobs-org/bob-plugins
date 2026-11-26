// --- Snooze row paint: pure display model --------------------------------
// Owned by the display contract `docs/snooze-marks.md` in bob-cli
// (child epic `plan:202611/snooze_display_marks.md`, phase
// `snoozed-row-paint`). Pure helpers only: the SM-R vector model for
// daily Snoozed row paint (asleep / due / blocked / history /
// ignored / none / historical) plus the heading-summary model. This
// file never touches Obsidian state and never throws: bad input
// yields neutral paint (`none`) or no summary (`null`).

// `HHMM` target into minutes since midnight, or null. Never throws.
function snoozeRowPaintTargetMinutes(target) {
  try {
    if (typeof target !== "string" || !/^\d{4}$/.test(target)) {
      return null;
    }
    const hours = Number(target.slice(0, 2));
    const minutes = Number(target.slice(2, 4));
    if (hours > 23 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  } catch (error) {
    return null;
  }
}

// `HHMM` into `HH:MM`, or null. Never throws.
function snoozeRowPaintColonTime(target) {
  try {
    if (typeof target !== "string" || !/^\d{4}$/.test(target)) {
      return null;
    }
    const hours = Number(target.slice(0, 2));
    const minutes = Number(target.slice(2, 4));
    if (hours > 23 || minutes > 59) {
      return null;
    }
    return target.slice(0, 2) + ":" + target.slice(2, 4);
  } catch (error) {
    return null;
  }
}

// `HH:MM` clock text into minutes since midnight, or null. Never
// throws.
function snoozeRowPaintNowMinutes(now) {
  try {
    if (typeof now !== "string") {
      return null;
    }
    const match = /^(\d{1,2}):(\d{2})$/.exec(now.trim());
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  } catch (error) {
    return null;
  }
}

// A non-negative minute gap into countdown words (`2h 30m`, `45m`,
// `1h`, `0m`). Never throws.
function snoozeRowPaintCountdownText(gapMinutes) {
  try {
    const gap =
      typeof gapMinutes === "number" && Number.isFinite(gapMinutes)
        ? Math.max(0, Math.floor(gapMinutes))
        : 0;
    const hours = Math.floor(gap / 60);
    const minutes = gap % 60;
    if (hours <= 0) {
      return "in " + minutes + "m";
    }
    if (minutes <= 0) {
      return "in " + hours + "h";
    }
    return "in " + hours + "h " + minutes + "m";
  } catch (error) {
    return "in 0m";
  }
}

// The muted reason chip for an ignored row, derived from task facts.
// Precedence mirrors the shared classifier: non-task, event, missing,
// ambiguous, done, cancelled, then Ready, then duplicate. Never
// throws; unknown ignored input falls back to the duplicate words.
function snoozeRowPaintIgnoredReason(task, target) {
  try {
    const facts =
      task && typeof task === "object" ? task : {};
    if (facts.is_task !== true) {
      return "Not a task \u2014 won't wake";
    }
    if (facts.is_event === true) {
      return "Event \u2014 won't wake";
    }
    if (facts.resolution === "missing") {
      return "Missing \u2014 won't wake";
    }
    if (facts.resolution === "ambiguous") {
      return "Ambiguous \u2014 won't wake";
    }
    const status =
      typeof facts.status === "string" ? facts.status : null;
    if (status === "x" || status === "X") {
      return "Done \u2014 won't wake";
    }
    if (status === "-") {
      return "Cancelled \u2014 won't wake";
    }
    if (status === " ") {
      return "Ready \u2014 won't wake";
    }
    if (snoozeRowPaintTargetMinutes(target) === null) {
      return "Unrecognized row";
    }
    return "Duplicate \u2014 earliest wins";
  } catch (error) {
    return "Duplicate \u2014 earliest wins";
  }
}

// Extract `woke HH:MM` from a struck history row's source text.
// Returns the `HH:MM` label or null. Never throws.
function snoozeRowPaintWokeLabel(lineText) {
  try {
    const text = typeof lineText === "string" ? lineText : "";
    const match = /woke\s+(\d{2}):(\d{2})/.exec(text);
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      return null;
    }
    return match[1] + ":" + match[2];
  } catch (error) {
    return null;
  }
}

// Daily-note path (`2026/20261105.md`) into `YYYY-MM-DD`, or null.
// Never throws.
function snoozeRowPaintNoteDate(note) {
  try {
    const text = typeof note === "string" ? note : "";
    const match = /(^|\/)(\d{4})(\d{4})(\d{2})(\d{2})\.md$/.exec(text);
    if (!match) {
      return null;
    }
    return match[2] + "-" + match[3] + "-" + match[4];
  } catch (error) {
    return null;
  }
}

function snoozeRowPaintNone() {
  return Object.freeze({
    live_countdown: false,
    paint: "none",
    status_text: null,
    time_pill: null,
  });
}

// The SM-R paint model for one vector-shaped input: `{ paint:
// 'asleep' | 'due' | 'blocked' | 'history' | 'ignored' | 'none' |
// 'historical', status_text, time_pill, live_countdown }`. Mirrors
// the canonical `marks.json` `rows` group verbatim: the snooze
// toggle gates everything, fenced and indented row-like text never
// paints, history stays dim, ignored rows carry the state's muted
// reason, earlier notes keep neutral historical paint, and live
// rows split into asleep (indigo countdown), due (amber waking),
// and blocked (muted prerequisites). Never throws.
function snoozeRowPaintModelForVector(input) {
  try {
    const value =
      input && typeof input === "object" ? input : {};
    const toggles =
      value.toggles && typeof value.toggles === "object"
        ? value.toggles
        : {};
    if (toggles.snooze_marks !== true) {
      return snoozeRowPaintNone();
    }
    const row =
      value.row && typeof value.row === "object" ? value.row : {};
    const task =
      value.task && typeof value.task === "object"
        ? value.task
        : {};
    const kind = typeof row.kind === "string" ? row.kind : "";
    if (kind === "fenced" || kind === "indented") {
      return snoozeRowPaintNone();
    }
    if (kind === "history") {
      const woke = snoozeRowPaintWokeLabel(row.line_text);
      if (!woke) {
        return Object.freeze({
          live_countdown: false,
          paint: "history",
          status_text: null,
          time_pill: null,
        });
      }
      return Object.freeze({
        live_countdown: false,
        paint: "history",
        status_text: "woke " + woke,
        time_pill: null,
      });
    }
    if (kind === "ignored") {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: snoozeRowPaintIgnoredReason(task, row.target),
        time_pill: null,
      });
    }
    if (kind !== "active") {
      return snoozeRowPaintNone();
    }
    const target = typeof row.target === "string" ? row.target : "";
    const colonTime = snoozeRowPaintColonTime(target);
    if (!colonTime) {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: "Unrecognized row",
        time_pill: null,
      });
    }
    // Guard active rows with non-actionable task facts: they paint
    // the ignored reason instead of inventing a live membership.
    if (task.is_task !== true) {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: "Not a task \u2014 won't wake",
        time_pill: null,
      });
    }
    if (task.is_event === true) {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: "Event \u2014 won't wake",
        time_pill: null,
      });
    }
    if (task.resolution !== "found") {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: snoozeRowPaintIgnoredReason(task, target),
        time_pill: null,
      });
    }
    const status =
      typeof task.status === "string" ? task.status : null;
    if (status === "x" || status === "X") {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: "Done \u2014 won't wake",
        time_pill: null,
      });
    }
    if (status === "-") {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: "Cancelled \u2014 won't wake",
        time_pill: null,
      });
    }
    if (status === " ") {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: "Ready \u2014 won't wake",
        time_pill: null,
      });
    }
    // An earlier daily note keeps neutral historical paint: the time
    // pill stays, but there is no live countdown and no today-state
    // heading summary.
    try {
      const noteDate =
        typeof value.note_date === "string" && value.note_date
          ? value.note_date
          : snoozeRowPaintNoteDate(value.note);
      const today = typeof value.today === "string" ? value.today : "";
      if (
        noteDate &&
        today &&
        /^\d{4}-\d{2}-\d{2}$/.test(noteDate) &&
        /^\d{4}-\d{2}-\d{2}$/.test(today) &&
        noteDate !== today
      ) {
        return Object.freeze({
          live_countdown: false,
          paint: "historical",
          status_text: null,
          time_pill: colonTime,
        });
      }
    } catch (error) {
      // A date failure falls through to live paint.
    }
    if (status === "?") {
      return Object.freeze({
        live_countdown: false,
        paint: "blocked",
        status_text: "waits on prerequisites",
        time_pill: colonTime,
      });
    }
    if (status !== "*" && status !== "/") {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: snoozeRowPaintIgnoredReason(task, target),
        time_pill: null,
      });
    }
    const targetMinutes = snoozeRowPaintTargetMinutes(target);
    const nowMinutes = snoozeRowPaintNowMinutes(value.now);
    if (targetMinutes === null || nowMinutes === null) {
      return Object.freeze({
        live_countdown: false,
        paint: "ignored",
        status_text: "Unrecognized row",
        time_pill: null,
      });
    }
    if (targetMinutes <= nowMinutes) {
      return Object.freeze({
        live_countdown: false,
        paint: "due",
        status_text: "due \u00b7 waking",
        time_pill: colonTime,
      });
    }
    return Object.freeze({
      live_countdown: true,
      paint: "asleep",
      status_text: snoozeRowPaintCountdownText(
        targetMinutes - nowMinutes,
      ),
      time_pill: colonTime,
    });
  } catch (error) {
    return snoozeRowPaintNone();
  }
}

// The SM-R summary model for one vector-shaped heading input:
// `{ summary: string | null }`. Counts unique planned identities
// (on-clock Asleep, Due, Blocked only), omits zero subcounts, omits
// `next` when no live row remains, and stays null for history-only
// or toggle-off sections. Never throws.
function snoozeRowSummaryModelForVector(input) {
  try {
    const value =
      input && typeof input === "object" ? input : {};
    const toggles =
      value.toggles && typeof value.toggles === "object"
        ? value.toggles
        : {};
    if (toggles.snooze_marks !== true) {
      return Object.freeze({ summary: null });
    }
    // An earlier daily note never carries a today-state heading
    // summary, even with live-looking rows.
    try {
      const noteDate = snoozeRowPaintNoteDate(value.note);
      const today = typeof value.today === "string" ? value.today : "";
      if (
        noteDate &&
        today &&
        /^\d{4}-\d{2}-\d{2}$/.test(noteDate) &&
        /^\d{4}-\d{2}-\d{2}$/.test(today) &&
        noteDate !== today
      ) {
        return Object.freeze({ summary: null });
      }
    } catch (error) {
      // A date failure falls through to the live summary.
    }
    const rows = Array.isArray(value.rows) ? value.rows : [];
    const seen = new Set();
    let asleep = 0;
    let due = 0;
    let blocked = 0;
    let nextMinutes = null;
    for (const entry of rows) {
      try {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        if (entry.on_clock !== true) {
          continue;
        }
        const state =
          typeof entry.state === "string" ? entry.state : "";
        if (
          state !== "asleep" &&
          state !== "due" &&
          state !== "blocked"
        ) {
          continue;
        }
        const id =
          typeof entry.id === "string"
            ? entry.id
            : typeof entry.target === "string"
              ? entry.target + "@" + String(rows.indexOf(entry))
              : null;
        if (id && seen.has(id)) {
          continue;
        }
        if (id) {
          seen.add(id);
        }
        if (state === "asleep") {
          asleep += 1;
        } else if (state === "due") {
          due += 1;
        } else {
          blocked += 1;
        }
        if (state === "blocked") {
          continue;
        }
        const minutes = snoozeRowPaintTargetMinutes(entry.target);
        if (minutes === null) {
          continue;
        }
        if (nextMinutes === null || minutes < nextMinutes) {
          nextMinutes = minutes;
        }
      } catch (error) {
        continue;
      }
    }
    if (asleep <= 0 && due <= 0 && blocked <= 0) {
      return Object.freeze({ summary: null });
    }
    const parts = [];
    if (asleep > 0) {
      parts.push(asleep + " asleep");
    }
    if (due > 0) {
      parts.push(due + " due");
    }
    if (blocked > 0) {
      parts.push(blocked + " blocked");
    }
    if (nextMinutes !== null) {
      const label =
        String(Math.floor(nextMinutes / 60)).padStart(2, "0") +
        ":" +
        String(nextMinutes % 60).padStart(2, "0");
      parts.push("next " + label);
    }
    return Object.freeze({ summary: parts.join(" \u00b7 ") });
  } catch (error) {
    return Object.freeze({ summary: null });
  }
}

// Listener-free row chip: an empty `span.bob-snooze-row-chip` with
// `role=img`, an accessible label, and `data-bob-snooze-row-time` /
// `data-bob-snooze-row-status` for CSS `::after` words, so copying
// a row never picks up the paint. `doc` provides `createElement`
// so tests can pass a fake document. Never throws: bad input
// yields null.
function buildSnoozeRowChipElement(doc, options) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const opts =
      options && typeof options === "object" ? options : {};
    const paint = typeof opts.paint === "string" ? opts.paint : "";
    if (
      paint !== "asleep" &&
      paint !== "due" &&
      paint !== "blocked" &&
      paint !== "history" &&
      paint !== "ignored" &&
      paint !== "historical"
    ) {
      return null;
    }
    const time =
      typeof opts.timePill === "string" ? opts.timePill : "";
    const status =
      typeof opts.statusText === "string" ? opts.statusText : "";
    if (!/^\d{2}:\d{2}$/.test(time) && paint !== "history" && paint !== "ignored") {
      if (paint === "asleep" || paint === "due" || paint === "blocked" || paint === "historical") {
        return null;
      }
    }
    const label =
      status.trim() !== ""
        ? status
        : time.trim() !== ""
          ? time
          : "Snoozed row";
    const span = doc.createElement("span");
    span.setAttribute(
      "class",
      "bob-snooze-row-chip bob-snooze-row-chip--" + paint,
    );
    span.setAttribute("role", "img");
    span.setAttribute(
      "aria-label",
      String(label).replace(/:{2,}/g, ":"),
    );
    span.setAttribute("data-tooltip-position", "top");
    span.setAttribute("data-bob-snooze-row-paint", paint);
    if (/^\d{2}:\d{2}$/.test(time)) {
      span.setAttribute("data-bob-snooze-row-time", time);
    }
    if (status.trim() !== "") {
      span.setAttribute(
        "data-bob-snooze-row-status",
        String(status).replace(/:{2,}/g, ":"),
      );
    }
    try {
      span.textContent = "";
    } catch (error) {
      // An empty host still renders.
    }
    return span;
  } catch (error) {
    return null;
  }
}

// Listener-free heading summary chip: an empty
// `span.bob-snooze-heading-chip` whose words ride in on
// `data-bob-snooze-heading-summary` through CSS `::after`, so the
// Markdown and copy/yank output never change. Never throws.
function buildSnoozeHeadingChipElement(doc, summary) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    if (typeof summary !== "string" || summary.trim() === "") {
      return null;
    }
    const clean = String(summary).replace(/:{2,}/g, ":");
    const span = doc.createElement("span");
    span.setAttribute(
      "class",
      "bob-snooze-heading-chip",
    );
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", clean);
    span.setAttribute("data-tooltip-position", "top");
    span.setAttribute("data-bob-snooze-heading-summary", clean);
    try {
      span.textContent = "";
    } catch (error) {
      // An empty host still renders.
    }
    return span;
  } catch (error) {
    return null;
  }
}
