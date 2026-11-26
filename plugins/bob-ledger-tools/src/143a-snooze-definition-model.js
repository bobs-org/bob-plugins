// --- Snooze definition marks: pure display model --------------------------
// Owned by the display contract `docs/snooze-marks.md` in bob-cli
// (child epic `plan:202611/snooze_display_marks.md`, phase
// `definition-marks`). Pure helpers only: the SM-D vector model (clock
// vs tomato vs neutral, tone, visible text, tooltip), the `HHMM`
// formatter, the countdown text, the tooltip builder, the
// listener-free DOM builder, the Live Preview widget, and the
// lazily-defined refresh StateEffect.
//
// The mark is truthful, never guessing: a snoozed-only task earns a
// clock, a live ledger link wins and keeps the tomato, and every
// other input stays neutral. The runtime adapter in
// `277a-plugin-snooze-marks.js` supplies the vector-shaped facts from
// the live Today and snoozed caches; this file never touches Obsidian
// state and never throws: bad input yields the neutral model.

// The task statuses that may carry a snooze clock: open and
// committed Next, In Progress, and Blocked. Ready, done, and
// cancelled tasks never wear a clock, even with a live Snoozed row.
const SNOOZE_DEFINITION_OPEN_STATUSES = Object.freeze(["*", "/", "?"]);

// The Snoozed row states that paint a definition clock. Anything
// else (`none` with an ignored reason, history, missing facts) is
// neutral: ignored rows never create a clock.
const SNOOZE_DEFINITION_CLOCK_STATES = Object.freeze([
  "asleep",
  "due",
  "blocked",
]);

// `HHMM` target plus explicit clock into display text and minutes.
// Returns null for a malformed target. Never throws.
function snoozeDefinitionTargetMinutes(target) {
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

// `HHMM` plus explicit clock into `HH:MM`, or null. Never throws.
function snoozeDefinitionColonTime(target) {
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
function snoozeDefinitionNowMinutes(now) {
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
function snoozeDefinitionCountdownText(gapMinutes) {
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

// The navigation hint line for tooltips (`mac`, `other`; omitted on
// `mobile`). Never throws and never contains `::`.
function snoozeDefinitionHintLine(platform) {
  try {
    const raw =
      typeof platform === "string" ? platform.trim().toLowerCase() : "";
    if (raw === "mobile") {
      return "";
    }
    if (raw === "mac" || raw === "macos") {
      return "\u2318-click to open the Snoozed row";
    }
    return "Ctrl-click to open the Snoozed row";
  } catch (error) {
    return "Ctrl-click to open the Snoozed row";
  }
}

// The two-line tooltip for a clock: state words on line one, the
// navigation hint on line two. Due ends in `due \u2014 waking`;
// Blocked ends in `waits on prerequisites`. Never contains `::`.
// Never throws.
function snoozeDefinitionTooltip(state, colonTime, countdownText, platform) {
  try {
    const time = typeof colonTime === "string" ? colonTime : "";
    let first = "Snoozed until " + time;
    if (state === "due") {
      first += " \u00b7 due \u2014 waking";
    } else if (state === "blocked") {
      first += " \u00b7 waits on prerequisites";
    } else {
      first +=
        " \u00b7 " +
        (typeof countdownText === "string" && countdownText
          ? countdownText
          : "in 0m");
    }
    const hint = snoozeDefinitionHintLine(platform);
    const tooltip = hint ? first + "\n" + hint : first;
    return String(tooltip).replace(/:{2,}/g, ":");
  } catch (error) {
    return "Snoozed";
  }
}

// The SM-D display model for one vector-shaped input: `{ mark:
// 'clock' | 'tomato' | 'none', text, tone: 'indigo' | 'amber' |
// 'muted' | null, tooltip, navigates_to: 'snoozed-row' | 'task-link'
// | null }`. `options.platform` selects the hint line (`other`
// default). Mirrors the canonical `marks.json` `definition` group
// verbatim: precedence is Today tomato first, then the planned
// Snoozed clock, then absent. Never throws.
function snoozeDefinitionMarkForVector(input, options) {
  try {
    const value =
      input && typeof input === "object" ? input : {};
    const task =
      value.task && typeof value.task === "object" ? value.task : {};
    const snooze =
      value.snooze && typeof value.snooze === "object"
        ? value.snooze
        : {};
    const host =
      value.host && typeof value.host === "object" ? value.host : {};
    const toggles =
      value.toggles && typeof value.toggles === "object"
        ? value.toggles
        : {};
    let platform = "other";
    try {
      const raw =
        options && typeof options.platform === "string"
          ? options.platform.trim().toLowerCase()
          : "";
      if (raw === "mac" || raw === "macos" || raw === "mobile") {
        platform = raw === "macos" ? "mac" : raw;
      }
    } catch (error) {
      platform = "other";
    }
    const neutral = Object.freeze({
      mark: "none",
      navigates_to: null,
      text: null,
      tone: null,
      tooltip: null,
    });
    // A live dedicated Task Link wins: the clock leaves and the
    // tomato stays.
    if (value.today_link === true) {
      return Object.freeze({
        mark: "tomato",
        navigates_to: "task-link",
        text: "\u{1F345}",
        tone: null,
        tooltip: null,
      });
    }
    // Both toggles share the identity slot: either toggle off hides
    // the clock while source text stays readable.
    if (toggles.snooze_marks !== true || toggles.today_marks !== true) {
      return neutral;
    }
    if (value.cache_ready !== true) {
      return neutral;
    }
    // Canonical daily notes never carry definition clocks, and neither
    // does content rendered inside one.
    if (host.is_daily === true || host.rendered_in_daily === true) {
      return neutral;
    }
    // Only exact `#task` lines outside code and fences qualify.
    if (
      task.is_task !== true ||
      task.in_code === true ||
      task.in_fence === true ||
      task.duplicate_id === true
    ) {
      return neutral;
    }
    if (
      SNOOZE_DEFINITION_OPEN_STATUSES.indexOf(task.status) === -1
    ) {
      return neutral;
    }
    const state = snooze.state;
    if (SNOOZE_DEFINITION_CLOCK_STATES.indexOf(state) === -1) {
      return neutral;
    }
    const colonTime = snoozeDefinitionColonTime(snooze.target);
    if (!colonTime) {
      return neutral;
    }
    if (state === "due") {
      return Object.freeze({
        mark: "clock",
        navigates_to: "snoozed-row",
        text: "\u23F0 " + colonTime + " \u00b7 due",
        tone: "amber",
        tooltip: snoozeDefinitionTooltip(state, colonTime, null, platform),
      });
    }
    if (state === "blocked") {
      return Object.freeze({
        mark: "clock",
        navigates_to: "snoozed-row",
        text: "\u23F0 " + colonTime,
        tone: "muted",
        tooltip: snoozeDefinitionTooltip(state, colonTime, null, platform),
      });
    }
    const targetMinutes = snoozeDefinitionTargetMinutes(snooze.target);
    const nowMinutes = snoozeDefinitionNowMinutes(value.now);
    const gap =
      targetMinutes !== null && nowMinutes !== null
        ? Math.max(0, targetMinutes - nowMinutes)
        : 0;
    return Object.freeze({
      mark: "clock",
      navigates_to: "snoozed-row",
      text: "\u23F0 " + colonTime,
      tone: "indigo",
      tooltip: snoozeDefinitionTooltip(
        state,
        colonTime,
        snoozeDefinitionCountdownText(gap),
        platform,
      ),
    });
  } catch (error) {
    return Object.freeze({
      mark: "none",
      navigates_to: null,
      text: null,
      tone: null,
      tooltip: null,
    });
  }
}

// Whether the mousedown used the jump modifier on the primary
// button: `metaKey` on macOS, `ctrlKey` elsewhere. Shared with the
// Today slot so both marks jump alike. Never throws.
function snoozeMarkModifierPressed(event, isMac) {
  try {
    if (!event || typeof event !== "object") {
      return false;
    }
    if (
      event.button !== undefined &&
      event.button !== null &&
      event.button !== 0
    ) {
      return false;
    }
    return isMac
      ? Boolean(event.metaKey)
      : Boolean(event.ctrlKey);
  } catch (error) {
    return false;
  }
}

// Listener-free mark element, so copying a line never copies the
// clock: an empty `span.bob-snooze-mark` (plus
// `bob-snooze-mark--<tone>`) with `role=img`, an accessible label,
// a top-positioned Obsidian tooltip, `data-bob-snooze-key`, and
// `data-bob-snooze-time` (the `HH:MM` the time rides in on through
// `::after`). It has no text and no `title`. `doc` provides
// `createElement` so tests can pass a fake document. Never throws:
// bad input yields null.
function buildSnoozeMarkElement(doc, options) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const opts =
      options && typeof options === "object" ? options : {};
    const key = typeof opts.key === "string" ? opts.key : "";
    if (key === "") {
      return null;
    }
    const time = typeof opts.time === "string" ? opts.time : "";
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return null;
    }
    const tone = opts.tone === "amber" || opts.tone === "muted"
      ? opts.tone
      : "indigo";
    const rawTooltip =
      typeof opts.tooltip === "string" ? opts.tooltip : "";
    const tooltip =
      rawTooltip.trim() !== "" ? rawTooltip : "Snoozed";
    const span = doc.createElement("span");
    span.setAttribute(
      "class",
      "bob-snooze-mark bob-snooze-mark--" +
        tone +
        (opts.pulse === true ? " is-pulsing" : ""),
    );
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", tooltip);
    span.setAttribute("data-tooltip-position", "top");
    span.setAttribute("data-bob-snooze-key", key);
    span.setAttribute("data-bob-snooze-time", time);
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

// Live Preview widget for one snooze clock. `eq` compares the
// class, key, time, tone, and tooltip only: the pulse and the jump
// callback are deliberately excluded, so a later rebuild never
// swaps the DOM and never replays the due pulse, while a tooltip
// or retime change (Asleep countdown, retiming) swaps it quietly.
// `toDOM` builds the element and adds one `mousedown` listener: it
// always calls `preventDefault`; with the modifier pressed it calls
// `onJump(key)`, otherwise it moves the cursor to the title start
// and focuses. Defined only when `WidgetType` exists; otherwise null
// and the extension is not registered.
let SnoozeMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  SnoozeMarkWidget = class extends WidgetType {
    constructor(key, time, tone, tooltip, pulse, onJump) {
      super();
      this.key = typeof key === "string" ? key : String(key || "");
      this.time =
        typeof time === "string" && /^\d{2}:\d{2}$/.test(time)
          ? time
          : "";
      this.tone =
        tone === "amber" || tone === "muted" ? tone : "indigo";
      const rawTooltip =
        typeof tooltip === "string" ? tooltip : "";
      this.tooltip =
        rawTooltip.trim() !== "" ? rawTooltip : "Snoozed";
      this.pulse = pulse === true;
      this.onJump = typeof onJump === "function" ? onJump : null;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof SnoozeMarkWidget &&
        other.key === this.key &&
        other.time === this.time &&
        other.tone === this.tone &&
        other.tooltip === this.tooltip
      );
    }

    toDOM(view) {
      const dom = buildSnoozeMarkElement(
        typeof document !== "undefined" ? document : null,
        {
          key: this.key,
          time: this.time,
          tone: this.tone,
          tooltip: this.tooltip,
          pulse: this.pulse,
        },
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildSnoozeMarkElement` directly; never throw here.
      if (!dom) {
        const fallback =
          typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        return fallback;
      }
      try {
        dom.addEventListener("mousedown", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let isMac = false;
            try {
              isMac = Boolean(Platform && Platform.isMacOS);
            } catch (error) {
              isMac = false;
            }
            if (snoozeMarkModifierPressed(event, isMac)) {
              if (this.onJump) {
                try {
                  this.onJump(this.key);
                } catch (error) {
                  // A jump failure never breaks the editor.
                }
              }
              return;
            }
            let anchor = null;
            try {
              anchor =
                view && typeof view.posAtDOM === "function"
                  ? view.posAtDOM(dom)
                  : null;
            } catch (error) {
              anchor = null;
            }
            if (
              typeof anchor === "number" &&
              view &&
              typeof view.dispatch === "function"
            ) {
              view.dispatch({ selection: { anchor } });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
          } catch (error) {
            // Placing the cursor is best-effort; the mark renders.
          }
        });
      } catch (error) {
        // A listener-free mark still renders.
      }
      return dom;
    }
  };
}

// Snooze marks (definition-marks phase): a StateEffect the snoozed
// refresh fan-out dispatches so Live Preview clocks rebuild without
// a doc change, covering countdown changes, Asleep-to-Due flips,
// retiming with unchanged membership, Blocked transitions, toggle
// changes, and midnight. Defined lazily on first dispatch so
// requiring the module never adds a second eager
// `StateEffect.define()` call.
let snoozeMarksRefresh = null;
function ensureSnoozeMarksRefresh() {
  if (snoozeMarksRefresh) {
    return snoozeMarksRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      snoozeMarksRefresh = StateEffect.define();
    }
  } catch (error) {
    snoozeMarksRefresh = null;
  }
  return snoozeMarksRefresh;
}
