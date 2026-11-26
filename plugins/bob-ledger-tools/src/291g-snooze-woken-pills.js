// Snoozed wake-history pills: pure presentation model and Live Preview host.
// The shared Snoozed parser supplies exact history rows; the ledger parser
// supplies exact Task Link lines. Nothing here writes note text.

const SNOOZE_WOKEN_SIDE = -3;
const SNOOZE_WOKEN_CLICK_HINT = "Ctrl-click to open the struck row";

function snoozeWokenTimeMinutes(value, allowColon = true) {
  try {
    const text = String(value == null ? "" : value).trim();
    const match = allowColon
      ? /^(\d{2}):?(\d{2})$/.exec(text)
      : /^(\d{2})(\d{2})$/.exec(text);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  } catch (error) {
    return null;
  }
}

function snoozeWokenTimeLabel(value) {
  try {
    const minutes = snoozeWokenTimeMinutes(value);
    if (minutes === null) return null;
    return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
      String(minutes % 60).padStart(2, "0");
  } catch (error) {
    return null;
  }
}

function snoozeWokenOutcome(wokeMinutes, targetMinutes) {
  try {
    let delta = wokeMinutes - targetMinutes;
    if (delta > 720) delta -= 1440;
    if (delta < -720) delta += 1440;
    if (delta === 0) return "on time";
    return Math.abs(delta) + "m " + (delta < 0 ? "early" : "late");
  } catch (error) {
    return "on time";
  }
}

function snoozeWokenNone() {
  return Object.freeze({ pill: "none", text: null, tooltip: null, navigates_to: null });
}

// Pure contract adapter for the canonical SM-W vectors. Runtime builders
// resolve each target and pass only history rows with the same canonical
// path/block identity. Optional `link.route` makes that identity explicit
// for callers that have already resolved it.
function snoozeWokenPillModel(input = {}) {
  try {
    const source = input && typeof input === "object" ? input : {};
    const link = source.link && typeof source.link === "object" ? source.link : {};
    const entry = source.entry && typeof source.entry === "object" ? source.entry : {};
    const toggles = source.toggles && typeof source.toggles === "object" ? source.toggles : {};
    if (toggles.snooze_marks === false || toggles.snoozeMarks === false) return snoozeWokenNone();
    if (entry.open !== true || source.active_row_for_identity === true) return snoozeWokenNone();
    if (
      link.struck === true || link.is_event === true || link.is_prose === true ||
      link.is_embed === true || link.in_fence === true ||
      source.resolution !== "found" ||
      (link.aliased !== undefined && link.aliased !== true && link.aliased !== false) ||
      (source.target_status !== "*" && source.target_status !== "/")
    ) return snoozeWokenNone();
    const block = String(link.block || "");
    const note = String(source.note || "");
    const noteDate = String(source.note_date || "");
    const today = String(source.today || "");
    const nowMinutes = snoozeWokenTimeMinutes(source.now);
    if (!block || !note || !/^\d{4}-\d{2}-\d{2}$/.test(noteDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(today) || nowMinutes === null || noteDate > today) {
      return snoozeWokenNone();
    }
    const wantedRoute = typeof link.route === "string" ? link.route : null;
    const candidates = [];
    for (const row of Array.isArray(source.history) ? source.history : []) {
      try {
        if (!row || String(row.block || "") !== block) continue;
        if (wantedRoute !== null && String(row.route || "") !== wantedRoute) continue;
        const wokeMinutes = snoozeWokenTimeMinutes(row.woke_at);
        const targetMinutes = snoozeWokenTimeMinutes(row.target, false);
        if (wokeMinutes === null || targetMinutes === null || !Number.isInteger(row.line) || row.line < 1) continue;
        candidates.push({ row, wokeMinutes, targetMinutes });
      } catch (error) {
        continue;
      }
    }
    if (!candidates.length) return snoozeWokenNone();
    candidates.sort((left, right) =>
      left.wokeMinutes - right.wokeMinutes || Number(left.row.line) - Number(right.row.line),
    );
    const latest = candidates[candidates.length - 1];
    const woke = snoozeWokenTimeLabel(latest.row.woke_at);
    const target = snoozeWokenTimeLabel(latest.row.target);
    if (!woke || !target) return snoozeWokenNone();
    const age = nowMinutes - latest.wokeMinutes;
    if (noteDate === today && age < 0) return snoozeWokenNone();
    const pill = noteDate < today ? "quiet" : age < 60 ? "fresh" : "settled";
    const text = "⏰ woke " + woke;
    const tooltip = ("Woke " + woke + " (snoozed until " + target + ", " +
      snoozeWokenOutcome(latest.wokeMinutes, latest.targetMinutes) + ")\n" +
      SNOOZE_WOKEN_CLICK_HINT).replace(/::/g, ":");
    return Object.freeze({
      pill,
      text,
      tooltip,
      navigates_to: Object.freeze({ note, line: latest.row.line }),
    });
  } catch (error) {
    return snoozeWokenNone();
  }
}

// Empty host: generated words stay out of copy/yank output and source
// positions. `model` is the current, path-resolved display result.
function buildSnoozeWokenElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model || model.pill === "none") return null;
    const target = model.navigates_to && typeof model.navigates_to === "object" ? model.navigates_to : {};
    const host = doc.createElement("span");
    host.setAttribute("class", "bob-snooze-woke bob-snooze-woke--" + String(model.pill));
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", String(model.tooltip || "Woken task history").replace(/::/g, ":"));
    host.setAttribute("data-tooltip-position", "top");
    host.setAttribute("data-bob-snooze-woke-time", String(model.text || "").replace(/^⏰ woke /, ""));
    host.setAttribute("data-bob-snooze-woke-note", String(target.note || ""));
    host.setAttribute("data-bob-snooze-woke-line", String(target.line || ""));
    return host;
  } catch (error) {
    return null;
  }
}

let SnoozeWokenWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  SnoozeWokenWidget = class extends WidgetType {
    constructor(model, sourcePath, targetPath, blockId, onJump) {
      super();
      this.model = model || snoozeWokenNone();
      this.sourcePath = String(sourcePath || "");
      this.targetPath = String(targetPath || "");
      this.blockId = String(blockId || "");
      this.onJump = typeof onJump === "function" ? onJump : null;
      this.key = [this.model.pill, this.model.text, this.model.tooltip,
        this.model.navigates_to && this.model.navigates_to.line,
        this.sourcePath, this.targetPath, this.blockId].join("|");
    }

    eq(other) {
      return Boolean(other && other instanceof SnoozeWokenWidget && other.key === this.key);
    }

    toDOM(view) {
      let host = null;
      try {
        host = buildSnoozeWokenElement(typeof document !== "undefined" ? document : null, this.model);
      } catch (error) {
        host = null;
      }
      if (!host) {
        try { return typeof document !== "undefined" ? document.createElement("span") : null; }
        catch (error) { return null; }
      }
      const self = this;
      try {
        host.addEventListener("mousedown", (event) => {
          try {
            if (event && event.button !== undefined && event.button !== 0) return;
            const isMac = Boolean(Platform && Platform.isMacOS);
            const modified = typeof todayMarkModifierPressed === "function"
              ? todayMarkModifierPressed(event, isMac)
              : (isMac ? Boolean(event && event.metaKey) : Boolean(event && event.ctrlKey));
            if (modified) {
              if (event && typeof event.preventDefault === "function") event.preventDefault();
              if (event && typeof event.stopPropagation === "function") event.stopPropagation();
              if (self.onJump) self.onJump(self.model.navigates_to, self.targetPath, self.blockId);
              return;
            }
            if (event && typeof event.preventDefault === "function") event.preventDefault();
            const anchor = view && typeof view.posAtDOM === "function" ? view.posAtDOM(host) : null;
            if (Number.isInteger(anchor) && view && typeof view.dispatch === "function") {
              view.dispatch({ selection: { anchor } });
            }
            if (view && typeof view.focus === "function") view.focus();
          } catch (error) {
            // A failed gesture never affects the document.
          }
        });
      } catch (error) {
        // A listener-free host still paints.
      }
      return host;
    }
  };
}
