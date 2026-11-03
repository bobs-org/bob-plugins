// --- Ledger Event link times: pure core ---------------------------------
// Owned by the `docs/event-link-times.md` display contract in bob-cli
// (bob-cli-gg phase `pill`). A ledger Task Link that points at one of the
// same daily note's Event Tasks wears the same time pill the Event Task
// wears in `## Events` (meeting span, past/running/future state, MEET hue,
// off-clock dash, buffer wings), in Live Preview and Reading view.
// Display-only: nothing writes, and every helper is synchronous and never
// throws; bad input yields null or an empty list.
//
// Qualification mirrors the Mac agenda's event chip: a dedicated ledger
// Task Link row (`taskLinkMarkIsLedgerTaskLinkLine`) whose target resolves
// to the rendered note itself and whose block id belongs to exactly one
// Event Task row (`eventRunById`). Unresolved or cross-note targets,
// duplicate ids, context or all-day rows, missing source text, and any
// thrown error show no pill and no warning.

// The Live Preview widget sits at the link start, before the ledger type
// mark (`side: -2`) and the progress mark (`side: -1`), so a row that also
// wears those reads `pill #TYPE ◐ link`.
const EVENT_LINK_TIME_SIDE = -3;
const EVENT_LINK_TIME_TITLE_LIMIT = 80;

// Lazy refresh effect, defined on first use so requiring the module never
// adds an eager `StateEffect.define()` call.
let eventLinkTimesRefresh = null;
function ensureEventLinkTimesRefresh() {
  if (eventLinkTimesRefresh) return eventLinkTimesRefresh;
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      eventLinkTimesRefresh = StateEffect.define();
    }
  } catch (error) {
    eventLinkTimesRefresh = null;
  }
  return eventLinkTimesRefresh;
}

// Whether `linkpath` names the rendered note itself: an empty linkpath is
// the note, otherwise `resolve(linkpath)` must equal `sourcePath` under
// `samePath`. Never throws.
function eventLinkTimeIsSameNote(linkpath, sourcePath, resolve, samePath) {
  try {
    const raw = String(linkpath || "").trim();
    const source = String(sourcePath || "");
    if (raw === "") return source !== "";
    if (source === "" || typeof resolve !== "function") return false;
    let resolved = null;
    try {
      resolved = resolve(raw);
    } catch (error) {
      return false;
    }
    if (!resolved) return false;
    if (typeof samePath === "function") {
      try {
        return samePath(resolved, source) === true;
      } catch (error) {
        return false;
      }
    }
    return String(resolved) === source;
  } catch (error) {
    return false;
  }
}

// Every ledger row that qualifies for a link time pill: one frozen
// `{line, ch, pathPart, blockId, linktext}` per line
// `taskLinkMarkIsLedgerTaskLinkLine` accepts, honouring fences,
// frontmatter, and comments through the ring's document context
// (`inert`/`excluded`, never `eligible`, which skips dedicated ledger
// rows by design). `ch` is the link start (the opening `~~` of a struck
// link, else `[[`). `options.isSameNote(pathPart)` decides rule 4, and
// `options.isVisible(line, ch)` limits a Live Preview build. Both are
// optional; without them only same-note `[[#^id]]` links qualify and
// every row is visible. Never throws.
function eventLinkTimeLinks(lines, path, options) {
  try {
    const list = Array.isArray(lines) ? lines : [];
    const sourcePath = String(path || "");
    if (list.length === 0 || sourcePath === "") return Object.freeze([]);
    try {
      if (typeof PLAN_DAILY_PATH_RE !== "undefined" && PLAN_DAILY_PATH_RE && !PLAN_DAILY_PATH_RE.test(sourcePath)) {
        return Object.freeze([]);
      }
    } catch (error) {
      return Object.freeze([]);
    }
    const opts = options && typeof options === "object" ? options : {};
    const isSameNote = typeof opts.isSameNote === "function"
      ? opts.isSameNote
      : (pathPart) => String(pathPart || "").trim() === "";
    const isVisible = typeof opts.isVisible === "function" ? opts.isVisible : null;
    let ctx = null;
    try {
      ctx = taskLinkMarkDocContext(list, sourcePath);
    } catch (error) {
      ctx = null;
    }
    const out = [];
    for (let index = 0; index < list.length; index += 1) {
      try {
        const text = String(list[index] || "");
        if (text.indexOf("#^") === -1 && text.toLowerCase().indexOf("#%5e") === -1) continue;
        if (ctx && typeof ctx.inert === "function" && ctx.inert(index)) continue;
        if (!taskLinkMarkIsLedgerTaskLinkLine(list, index, sourcePath)) continue;
        let excluded = null;
        try {
          excluded = ctx && typeof ctx.excluded === "function" ? ctx.excluded(index) : null;
        } catch (error) {
          excluded = null;
        }
        const spans = taskLinkMarkSpans(text, excluded);
        if (!spans || spans.length === 0) continue;
        const span = spans[0];
        let same = false;
        try {
          same = isSameNote(span.linkpath) === true;
        } catch (error) {
          same = false;
        }
        if (!same) continue;
        const ch = span.at;
        if (isVisible) {
          let visible = false;
          try {
            visible = isVisible(index, ch) === true;
          } catch (error) {
            visible = false;
          }
          if (!visible) continue;
        }
        out.push(Object.freeze({
          line: index,
          ch,
          pathPart: String(span.linkpath || ""),
          blockId: String(span.blockId || ""),
          linktext: String(span.linkpath || "") + "#^" + String(span.blockId || ""),
        }));
      } catch (error) {
        continue;
      }
    }
    return Object.freeze(out);
  } catch (error) {
    return Object.freeze([]);
  }
}

// The Event row's cleaned title, cut to 80 characters (79 plus `…`), or
// `Calendar event` when the title is empty. Never throws.
function eventLinkTimeCutTitle(title) {
  try {
    const text = String(title || "").trim();
    if (text === "") return "Calendar event";
    if (text.length > EVENT_LINK_TIME_TITLE_LIMIT) {
      return text.slice(0, EVENT_LINK_TIME_TITLE_LIMIT - 1) + "…";
    }
    return text;
  } catch (error) {
    return "Calendar event";
  }
}

// The host tooltip for a link pill model: line 1 is the Event row's
// cleaned title, line 2 (only when non-empty) is the Events pill's own
// tooltip for the same row. Any stray `::` becomes `:`. Never throws.
function eventLinkTimeTooltip(model) {
  try {
    const input = model && typeof model === "object" ? model : {};
    const first = eventLinkTimeCutTitle(input.title);
    const detail = String(input.detail || "").trim();
    const label = detail ? first + "\n" + detail : first;
    return label.replace(/::/g, ":");
  } catch (error) {
    return "Calendar event";
  }
}

// The pill model for one unique Event Task row, or null unless the row is
// a timed Event Task. `eventRow` is an `eventRunEventRows` row;
// `options` carries `{isToday, nowMinutes, hue, line, path,
// metadataCache, vault}`. State and phase come from the shared calendar
// Event helpers (after the midnight-crossing fix), the clock from
// `gcalEventsApplyClockToRow` (tag, then inherited `offclock:`), and the
// wings from `gcalEventsWingModel`. Never throws.
function eventLinkTimeModel(eventRow, options) {
  try {
    if (!eventRow || typeof eventRow !== "object") return null;
    if (typeof eventRow.blockId !== "string" || eventRow.blockId === "") return null;
    if (typeof eventRow.timeRange !== "string" || !/^\d{4}-\d{4}$/.test(eventRow.timeRange)) return null;
    const opts = options && typeof options === "object" ? options : {};
    const isToday = opts.isToday === true;
    const nowMinutes = Number(opts.nowMinutes);
    const hue = typeof opts.hue === "string" && opts.hue !== "" ? opts.hue : null;
    const line = String(opts.line != null ? opts.line : "");
    const path = String(opts.path || "");
    const clockRow = { offClock: false, clockSource: null, clockNote: null };
    try {
      gcalEventsApplyClockToRow(clockRow, line, path, opts.metadataCache, opts.vault);
    } catch (error) {
      // Tag-only is the safe fallback when note metadata is unavailable.
    }
    const buffer = eventRow.buffer && !eventBufferIsEmpty(eventRow.buffer) ? eventRow.buffer : null;
    const state = gcalEventsTimeState(eventRow.timeRange, nowMinutes, isToday, true, eventRow.buffer);
    const bufferPhase = gcalEventsBufferPhase(eventRow.timeRange, nowMinutes, isToday, true, eventRow.buffer);
    const row = {
      time: eventRow.timeRange,
      state,
      buffer,
      bufferPhase,
      offClock: Boolean(clockRow.offClock),
      clockSource: clockRow.clockSource || null,
      clockNote: clockRow.clockNote || null,
      startMinutes: eventRow.startMin,
      endMinutes: eventRow.endMin,
      bufferedStartMinutes: eventRow.bufferedStartMin,
      bufferedEndMinutes: eventRow.bufferedEndOnTimeline,
      bufferedTimeRange: eventRow.bufferedTimeRange,
    };
    let attributes = {};
    try {
      attributes = gcalEventsTimeAttributes(row, hue);
    } catch (error) {
      attributes = {};
    }
    const detail = String((attributes && attributes.title) || "");
    const before = gcalEventsWingModel(row, "before", hue);
    const after = gcalEventsWingModel(row, "after", hue);
    const tooltip = eventLinkTimeTooltip({ title: eventRow.title, detail });
    return Object.freeze({
      time: eventRow.timeRange,
      blockId: eventRow.blockId,
      row: Object.freeze({ ...row }),
      hue,
      before: before ? Object.freeze({ ...before }) : null,
      after: after ? Object.freeze({ ...after }) : null,
      title: String(eventRow.title || ""),
      detail,
      tooltip,
    });
  } catch (error) {
    return null;
  }
}

// Listener-free host element, shared by the Live Preview widget and the
// Reading-view post-processor. Produces a
// `span.bob-event-link-time.bob-calendar-event-time-wrap[role=img][aria-label][data-tooltip-position=top][data-block-id]`
// holding an optional before wing, the existing
// `bob-calendar-event-time` pill (with the `gcalEventsTimeAttributes`
// attributes minus `title`), and an optional after wing. No element
// inside the host carries a `title`: the host's `aria-label` is the
// tooltip. `doc` provides `createElement` so tests can pass a fake
// document. Never throws: bad input yields null.
function buildEventLinkTimeElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model || typeof model !== "object") return null;
    if (typeof model.time !== "string" || typeof model.tooltip !== "string") return null;
    const host = doc.createElement("span");
    host.setAttribute("class", "bob-event-link-time bob-calendar-event-time-wrap");
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", String(model.tooltip).replace(/::/g, ":"));
    host.setAttribute("data-tooltip-position", "top");
    host.setAttribute("data-block-id", String(model.blockId || ""));
    const appendWing = (wing) => {
      if (!wing) return;
      let el = null;
      try {
        el = buildCalendarEventBufferWing(doc, wing);
      } catch (error) {
        el = null;
      }
      if (!el) return;
      try {
        if (typeof el.removeAttribute === "function") el.removeAttribute("title");
      } catch (error) {
        // A wing without a title paints the same.
      }
      try {
        host.appendChild(el);
      } catch (error) {
        // A missing wing never breaks the pill.
      }
    };
    appendWing(model.before);
    const inner = doc.createElement("span");
    inner.setAttribute("class", "bob-calendar-event-time");
    try {
      if (typeof inner.textContent !== "undefined") inner.textContent = String(model.time);
    } catch (error) {
      // An empty pill still carries its attributes.
    }
    try {
      const attributes = gcalEventsTimeAttributes(model.row, model.hue);
      for (const [name, value] of Object.entries(attributes || {})) {
        if (name === "title") continue;
        if (value == null || value === "") {
          if (typeof inner.removeAttribute === "function") inner.removeAttribute(name);
          continue;
        }
        inner.setAttribute(name, value);
      }
    } catch (error) {
      // Attribute paint is best-effort; the host still identifies the row.
    }
    try {
      host.appendChild(inner);
    } catch (error) {
      return null;
    }
    appendWing(model.after);
    return host;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one link pill. Zero-width and position-free: it
// sits at the link token start with `side: -3`, before the ledger type and
// progress marks. `eq` compares the time, state, phase, hue, off-clock,
// buffer, and tooltip (plus the click target, so a reused DOM never
// carries a stale link). Plain mousedown places the caret just before the
// link and focuses the editor; Mod+mousedown behaves exactly like
// Mod+clicking the link text through `onOpen`. Defined only when
// `WidgetType` exists; otherwise null and the extension is not
// registered.
let EventLinkTimeWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  EventLinkTimeWidget = class extends WidgetType {
    constructor(model, sourcePath, linktext, onOpen) {
      super();
      const input = model && typeof model === "object" ? model : {};
      const row = input.row && typeof input.row === "object" ? input.row : {};
      const beforeMin = row.buffer && Number.isFinite(row.buffer.beforeMin) ? row.buffer.beforeMin : 0;
      const afterMin = row.buffer && Number.isFinite(row.buffer.afterMin) ? row.buffer.afterMin : 0;
      this.key = [
        String(input.time || ""),
        String(row.state || ""),
        String(row.bufferPhase || ""),
        String(input.hue || ""),
        row.offClock ? "o" : "",
        String(beforeMin),
        String(afterMin),
        String(input.tooltip || ""),
      ].join("|");
      this.model = input;
      this.sourcePath = String(sourcePath || "");
      this.linktext = String(linktext || "");
      this.onOpen = typeof onOpen === "function" ? onOpen : null;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof EventLinkTimeWidget &&
        other.key === this.key &&
        other.linktext === this.linktext &&
        other.sourcePath === this.sourcePath
      );
    }

    toDOM(view) {
      let host = null;
      try {
        host = buildEventLinkTimeElement(
          typeof document !== "undefined" ? document : null,
          this.model || null,
        );
      } catch (error) {
        host = null;
      }
      if (!host) {
        try {
          return typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        } catch (error) {
          return null;
        }
      }
      const self = this;
      try {
        host.addEventListener("mousedown", (event) => {
          try {
            if (event && event.button !== undefined && event.button !== null && event.button !== 0) return;
            if (event && typeof event.preventDefault === "function") event.preventDefault();
            let isMac = false;
            try {
              isMac = Boolean(Platform && Platform.isMacOS);
            } catch (error) {
              isMac = false;
            }
            const modified = typeof todayMarkModifierPressed === "function"
              ? todayMarkModifierPressed(event, isMac)
              : (isMac ? Boolean(event.metaKey) : Boolean(event.ctrlKey));
            if (modified) {
              if (self.onOpen) {
                try {
                  self.onOpen(self.linktext, self.sourcePath);
                } catch (error) {
                  // An open failure never breaks the editor.
                }
              }
              return;
            }
            let anchor = null;
            try {
              anchor = view && typeof view.posAtDOM === "function" ? view.posAtDOM(host) : null;
            } catch (error) {
              anchor = null;
            }
            if (typeof anchor === "number" && view && typeof view.dispatch === "function") {
              view.dispatch({ selection: { anchor } });
            }
            if (view && typeof view.focus === "function") view.focus();
          } catch (error) {
            // Placing the cursor is best-effort; the pill renders.
          }
        });
      } catch (error) {
        // A listener-free pill still renders.
      }
      return host;
    }
  };
}
